// Drive → app (22/11, docs/PIANO-DRIVE-MCP.md, passo 3). Ogni 5 minuti (giroAvvisi) il server guarda, con il permesso
// Google del proprietario del progetto, i file nella cartella del progetto (e nella sua «Copia dall'app») e i documenti
// collegati a mano (`projects.documenti`): una chiamata a Drive per progetto, con `modifiedTime`, che non costa token.
// Un file nuovo o cambiato e poi **fermo da 30 minuti** (Google Docs salva da solo mentre scrivi) si legge una volta:
// l'agente riceve **solo la parte nuova** (differenze con il testo della versione precedente, tenuto in
// drive_file/{progetto}_{file}) e propone sintesi aggiornata, task nuovi, task fatti e una nota «Avanzamento da Drive».
// Niente entra nei moduli senza conferma (CLAUDE.md, regola 5): solo `proposals`, con `source: "drive"` e `projectId`,
// visibili nella pagina del progetto e in Proposte, con la visibilità del progetto.
//
// Niente cicli: ciò che l'app scrive (copia leggibile, «Apri come documento») ha in drive_file il suo `modifiedTime`, quindi
// non torna come novità; una modifica a mano alla copia sì, come le altre. Un documento collegato a mano visto per la
// prima volta fa solo da punto di partenza (lo legge già l'agente come contesto delle note); un file nuovo nella cartella
// si legge tutto.
//
// Formati letti: Documenti, Fogli e Presentazioni di Google (esportati come testo), file di testo, PDF (con Haiku, come
// per l'agente: src/google/drive.js). Gli altri si ignorano. Costi in `consumi` (voce «drive»): il modello dell'agente per
// il progetto (`modelloPer`), Haiku per le differenze piccole.
import { FieldValue } from "firebase-admin/firestore";
import { drive, tokenProprietario } from "./cartelle.js";
import { FILE, normalizzaTesto, testoDoc } from "./copia.js";
import { MODELLI } from "../ai/claude.js";

export const FERMO_MS = 30 * 60e3;        // un file si legge quando nessuno lo tocca da 30 minuti
const IN_CORSO_MS = 6 * 60e3;              // una lettura «in corso» più vecchia di così è morta
const PICCOLA = 1500;                      // caratteri: sotto, le differenze le legge Haiku
const MAX_DIFF = 14000;                    // caratteri di differenze date all'agente
const MAX_TESTO = 200_000;
const MAX_ANALISI = 3;                     // letture con l'AI per giro (le altre al giro dopo)
const DOC = "application/vnd.google-apps.document";
const EXPORT = { [DOC]: "text/plain", "application/vnd.google-apps.spreadsheet": "text/csv", "application/vnd.google-apps.presentation": "text/plain" };
const TESTO = /^text\/|^application\/(json|xml|x-yaml)$/;
const PDF = "application/pdf";

const s = (x) => (typeof x === "string" ? x.trim() : "");
const ms = (t) => (t?.toMillis ? t.toMillis() : t?.toDate ? t.toDate().getTime() : typeof t === "number" ? t : t ? new Date(t).getTime() || 0 : 0);
const leggibile = (mime) => !!EXPORT[mime] || TESTO.test(mime || "") || mime === PDF;
const giorno = (t) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date(t));

// ───────────── Differenze ─────────────

/**
 * Le differenze tra due testi, per righe (LCS; oltre 3000 righe per parte, per conteggio). Ritorna { testo, aggiunte,
 * tolte }: `testo` come un diff unificato breve («+ » righe nuove, «- » righe tolte, «  » una riga di contesto prima di
 * ogni gruppo), `aggiunte` e `tolte` i caratteri cambiati. Righe vuote e spazi non contano.
 */
export function differenze(prima, dopo) {
  const a = String(prima || "").replace(/\r/g, "").split("\n").map((r) => r.trim()).filter(Boolean);
  const b = String(dopo || "").replace(/\r/g, "").split("\n").map((r) => r.trim()).filter(Boolean);
  const op = []; // [tipo, riga] con tipo " " | "+" | "-"
  if (a.length * b.length <= 9_000_000) {
    const n = a.length, m = b.length;
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { op.push([" ", a[i]]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) op.push(["-", a[i++]]); else op.push(["+", b[j++]]);
    }
    while (i < n) op.push(["-", a[i++]]);
    while (j < m) op.push(["+", b[j++]]);
  } else {
    const conta = (l) => l.reduce((x, r) => x.set(r, (x.get(r) || 0) + 1), new Map());
    const ca = conta(a), cb = conta(b);
    for (const r of b) { if ((ca.get(r) || 0) > 0) { ca.set(r, ca.get(r) - 1); op.push([" ", r]); } else op.push(["+", r]); }
    for (const r of a) if ((cb.get(r) || 0) > 0) cb.set(r, cb.get(r) - 1); else op.push(["-", r]);
  }
  const righe = [];
  let aggiunte = 0, tolte = 0;
  op.forEach(([t, r], k) => {
    if (t === " ") return;
    if (t === "+") aggiunte += r.length; else tolte += r.length;
    // Una riga di contesto prima di ogni gruppo di cambiamenti (spesso il titolo della sezione).
    if (k > 0 && op[k - 1][0] === " " && righe[righe.length - 1] !== `  ${op[k - 1][1]}`) righe.push(`  ${op[k - 1][1]}`);
    righe.push(`${t} ${r}`);
  });
  return { testo: righe.join("\n"), aggiunte, tolte };
}

// ───────────── Lettura dei file ─────────────

/** Il testo di un file di Drive (Documenti, Fogli, Presentazioni, testo; PDF con `leggiPdf`), o null se non si legge. */
async function testoFile(token, f, leggiPdf) {
  if (f.mimeType === DOC) return testoDoc(token, f.id);
  const url = EXPORT[f.mimeType]
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}/export?mimeType=${encodeURIComponent(EXPORT[f.mimeType])}`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}?alt=media&supportsAllDrives=true`;
  if (f.mimeType === PDF) {
    if (!leggiPdf || Number(f.size || 0) > 10_000_000) return null;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) { const e = new Error(`Drive ${r.status}`); e.status = r.status; throw e; }
    return s(await leggiPdf(Buffer.from(await r.arrayBuffer()).toString("base64"), f.name));
  }
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) { const e = new Error(`Drive ${r.status}`); e.status = r.status; throw e; }
  return (await r.text()).replace(/^﻿/, "").replace(/\r/g, "").trim();
}

const CAMPI = "id,name,mimeType,parents,modifiedTime,size,webViewLink,trashed,lastModifyingUser(displayName,emailAddress)";

/** I file da guardare di un progetto: nella cartella, nella «Copia dall'app», e i documenti collegati. */
async function fileDelProgetto(db, p, token) {
  const stato = (await db.collection("drive_cartelle").doc(p.id).get()).data() || {};
  const cartelle = [p.cartella.id, stato.sottocartelle?.copia].filter(Boolean);
  const q = `(${cartelle.map((c) => `'${c}' in parents`).join(" or ")}) and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
  const j = await drive(token, "GET", "/files", { query: { q, fields: `files(${CAMPI})`, pageSize: "200", supportsAllDrives: "true", includeItemsFromAllDrives: "true" } });
  const out = new Map((j.files || []).map((f) => [f.id, { ...f, collegato: false, copia: !!stato.sottocartelle?.copia && (f.parents || []).includes(stato.sottocartelle.copia) }]));
  for (const d of Array.isArray(p.documenti) ? p.documenti.slice(0, 12) : []) {
    if (!d?.id || out.has(d.id)) continue;
    try {
      const f = await drive(token, "GET", `/files/${encodeURIComponent(d.id)}`, { query: { fields: CAMPI, supportsAllDrives: "true" } });
      if (!f.trashed) out.set(f.id, { ...f, collegato: true });
    } catch (e) { if (e.status !== 404 && e.status !== 403) throw e; }
  }
  return [...out.values()].filter((f) => leggibile(f.mimeType));
}

// ───────────── L'agente ─────────────

const SCHEMA = {
  type: "object",
  properties: {
    riassunto: { type: "string" },
    nota: { type: "object", properties: { titolo: { type: "string" }, testo: { type: "string" } }, required: ["titolo", "testo"], additionalProperties: false },
    sintesi: { type: "string" },
    task: { type: "array", items: { type: "object", properties: { text: { type: "string" }, due: { type: "string" }, people: { type: "string" } }, required: ["text", "due", "people"], additionalProperties: false } },
    task_fatti: { type: "array", items: { type: "string" } },
  },
  required: ["riassunto", "nota", "sintesi", "task", "task_fatti"],
  additionalProperties: false,
};

export function sistema({ p, aperti, oggi, file, copia, nuovo }) {
  const conSintesi = !!(s(p.istruzioni) || s(p.sintesi));
  return `Sei l'assistente di «Debiti e Doveri», un'app personale e di coppia. Il progetto «${p.name}» ha una cartella su
Google Drive. Un file di quella cartella ${nuovo ? "è nuovo" : "è stato cambiato"}: ricevi ${nuovo ? "il suo testo" : "SOLO le differenze rispetto alla versione che l'app conosceva"}.
Oggi è ${oggi}.

${copia ? `Il file è la copia leggibile del progetto che l'app scrive su Drive («${file}»): chi l'ha cambiato ha corretto a mano
la copia. Riporta le sue correzioni come proposte: la sintesi corretta, i task aggiunti, i task tolti o segnati fatti.` : `Il file è «${file}», un documento di lavoro del progetto.`}

Proponi, solo a partire dalla parte ${nuovo ? "del file" : "nuova o cambiata"} (le righe che iniziano con «+»; quelle con «-» sono state tolte, quelle
con due spazi sono contesto):
- "nota": una nota del diario «Avanzamento da Drive» che dica in poche righe cosa è cambiato o cosa porta di nuovo il file,
  come lo scriverebbe la persona («Aggiornato il programma: …»). "titolo" breve. Testo vuoto se la modifica non porta niente
  da ricordare (correzioni di battitura, formattazione, una riga spostata).
- "sintesi": ${conSintesi ? `la sintesi del progetto aggiornata con ciò che la parte nuova cambia, nello stesso formato di quella attuale
  (sezioni "## Tema", prima riga facoltativa "Stato: …", righe "Rubrica:" ed elenchi "- "), rispettandone struttura e scelte.
  Stringa vuota se non cambia niente.` : `stringa vuota (il progetto non ha una sintesi).`}
- "task": le cose da fare che la parte nuova chiede (frase breve all'infinito, "due" AAAA-MM-GG se c'è una scadenza, se no
  vuoto; "people" le persone coinvolte). Non proporre un task che c'è già tra quelli aperti, nemmeno con altre parole.
- "task_fatti": i codici ([t3] → "t3") dei task aperti che la parte nuova dice fatti, o che nella copia sono stati tolti
  o segnati come fatti.
- "riassunto": una riga su cosa è cambiato.
Non inventare: se la parte nuova non chiede niente, liste vuote, sintesi e testo della nota vuoti.

${conSintesi ? `Sintesi attuale del progetto:
<sintesi>
${s(p.sintesi) || "(ancora vuota)"}
</sintesi>
${s(p.istruzioni) ? `Istruzioni della persona per il progetto:\n<istruzioni>\n${s(p.istruzioni).slice(0, 4000)}\n</istruzioni>` : ""}` : ""}
Task aperti del progetto:
<task_aperti>
${aperti.length ? aperti.map((t) => `[${t.ref}] ${t.text}${t.due ? ` · scadenza ${t.due}` : ""}`).join("\n") : "(nessuno)"}
</task_aperti>`;
}

/**
 * Legge un file cambiato (o nuovo) di un progetto e scrive le proposte. `chiedi(opzioni)` = reason() del provider (per
 * le prove si passa un finto). Ritorna { proposte, modello, vuota }.
 */
export async function leggiCambiamento(db, p, f, { prima, dopo, nuovo, chiedi, key, profilo = {} }) {
  const diff = nuovo ? { testo: dopo.split("\n").filter((r) => r.trim()).map((r) => `+ ${r.trim()}`).join("\n"), aggiunte: dopo.length, tolte: 0 } : differenze(prima, dopo);
  if (!diff.testo.trim()) return { proposte: 0, vuota: true };
  const condiviso = p.visibility === "shared";
  const ammesso = (d) => (d.visibility === "shared" && d.householdId === p.householdId) || (!condiviso && d.ownerUid === p.ownerUid);
  const aperti = (await db.collection("tasks").where("projectId", "==", p.id).get()).docs
    .map((d) => ({ id: d.id, ...d.data() })).filter((t) => !t.done && ammesso(t) && s(t.text))
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999")).slice(0, 60)
    .map((t, i) => ({ ref: `t${i + 1}`, id: t.id, text: s(t.text).slice(0, 140), due: t.due || "" }));
  // Il modello: quello dell'agente per il progetto, Haiku per le differenze piccole (piano, «Costi»).
  const piccola = diff.aggiunte + diff.tolte < PICCOLA;
  const { modelloPer } = await import("../agent.js");
  const modello = piccola ? "haiku" : modelloPer(profilo, !!s(p.istruzioni));
  const oggi = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  let uso = null, idModello = MODELLI[modello];
  const out = await chiedi({
    system: sistema({ p, aperti, oggi, file: f.name, copia: !!f.copia, nuovo }),
    user: `${nuovo ? "Testo del file" : "Differenze"} («${f.name}»${f.lastModifyingUser?.displayName ? `, cambiato da ${f.lastModifyingUser.displayName}` : ""}):\n<file>\n${diff.testo.slice(0, MAX_DIFF)}\n</file>${diff.testo.length > MAX_DIFF ? "\n(Il resto è tagliato.)" : ""}`,
    schema: SCHEMA, keys: { anthropic: key }, maxTokens: modello === "haiku" ? 8000 : 24000, model: modello,
    onUso: (u, id) => { uso = u; idModello = id || idModello; },
  });
  const { registra } = await import("../consumi.js");
  await registra(db, p.ownerUid, "drive", { modello: idModello, uso }).catch(() => {});

  const base = {
    ownerUid: p.ownerUid, householdId: p.householdId || null, visibility: condiviso ? "shared" : "private",
    source: "drive", status: "pending", sourceEntryId: null, projectId: p.id,
    driveFile: { id: f.id, nome: s(f.name).slice(0, 120), link: f.webViewLink || "" },
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  };
  const batch = db.batch();
  let n = 0;
  // Niente doppioni con le proposte da Drive ancora in attesa per lo stesso progetto (un task, un task fatto, la stessa nota).
  const inAttesa = (await db.collection("proposals").where("ownerUid", "==", p.ownerUid).where("status", "==", "pending").get()).docs
    .map((d) => d.data()).filter((x) => x.projectId === p.id);
  const chiave = (kind, x) => `${kind}|${kind === "task_done" ? x.taskId : String(x.text || "").toLowerCase().replace(/\W+/g, " ").trim()}`;
  const viste = new Set(inAttesa.filter((x) => x.kind !== "project_summary").map((x) => chiave(x.kind, x.payload || {})));
  const aggiungi = (kind, payload, summary) => {
    if (kind !== "project_summary") { const k = chiave(kind, payload); if (viste.has(k)) return; viste.add(k); }
    batch.set(db.collection("proposals").doc(), { ...base, kind, payload, summary: s(summary).slice(0, 160) }); n++;
  };
  const nota = out.nota || {};
  if (s(nota.testo)) {
    aggiungi("journal_entry", { projectId: p.id, titolo: s(nota.titolo).slice(0, 80) || "Avanzamento da Drive", text: s(nota.testo).slice(0, 4000),
      giorno: giorno(Date.now()), analizza: false, fonte: { tipo: "drive", fileId: f.id, nome: s(f.name).slice(0, 120), link: f.webViewLink || "" } },
    `Avanzamento da Drive: ${s(nota.titolo) || s(f.name)}`);
  }
  const sintesi = s(out.sintesi);
  if (sintesi && sintesi !== s(p.sintesi) && (s(p.istruzioni) || s(p.sintesi))) {
    // Una sintesi proposta sostituisce quella ancora in attesa dello stesso progetto (come per l'agente).
    const attesa = await db.collection("proposals").where("ownerUid", "==", p.ownerUid).where("kind", "==", "project_summary").where("status", "==", "pending").get();
    attesa.docs.filter((d) => d.data().payload?.projectId === p.id).forEach((d) => batch.delete(d.ref));
    aggiungi("project_summary", { projectId: p.id, projectName: p.name, sintesi, prima: !s(p.sintesi) }, `Sintesi di ${p.name} aggiornata da Drive`);
  }
  for (const t of (Array.isArray(out.task) ? out.task : []).slice(0, 8)) {
    if (!s(t.text)) continue;
    aggiungi("task", { text: s(t.text).slice(0, 200), due: /^\d{4}-\d{2}-\d{2}$/.test(s(t.due)) ? s(t.due) : "", project: p.name, people: s(t.people).slice(0, 200), visibilita: base.visibility }, s(t.text));
  }
  const perRef = new Map(aperti.map((t) => [t.ref, t]));
  for (const r of new Set((Array.isArray(out.task_fatti) ? out.task_fatti : []).map((x) => s(x).replace(/[[\]]/g, "")))) {
    const t = perRef.get(r);
    if (t) aggiungi("task_done", { taskId: t.id, text: t.text, prima: t.due }, `Segna fatto: ${t.text}`);
  }
  if (n) await batch.commit();
  return { proposte: n, modello, riassunto: s(out.riassunto) };
}

// ───────────── Il giro ─────────────

/**
 * Guarda le novità nelle cartelle dei progetti. `adesso` e `chiedi` per le prove. Ritorna { file, letti, proposte }.
 * Per ogni file: nessuna traccia in drive_file → nuovo (un documento collegato fa solo da punto di partenza); traccia
 * con lo stesso `modifiedTime` → niente; diverso → cambiato. Nuovo o cambiato si legge quando è fermo da FERMO_MS.
 */
export async function giroNovita(db, { client, tokenServer, key, chiedi = null, leggiPdf = null, adesso = Date.now() }) {
  const reason = chiedi || (await import("../ai/provider.js")).reason;
  // I PDF li trascrive Haiku, come per l'agente (src/agent.js), e il costo va al proprietario del progetto.
  const pdfDi = (uid) => leggiPdf || ((dati, nome) => reason({
    system: "Trascrivi il testo dei documenti che ricevi, così com'è, in testo semplice.",
    user: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: dati } },
      { type: "text", text: `Trascrivi il testo del PDF «${nome}»: titoli, paragrafi ed elenchi nell'ordine; le tabelle come righe con i valori separati da « | ». Niente commenti né riassunti. Al più 30.000 caratteri.` }],
    schema: { type: "object", properties: { testo: { type: "string" } }, required: ["testo"], additionalProperties: false },
    keys: { anthropic: key }, maxTokens: 24000, model: "haiku",
    onUso: (uso, id) => import("../consumi.js").then(({ registra }) => registra(db, uid, "pdf", { modello: id, uso })).catch(() => {}),
  }).then((o) => o.testo));
  const snap = await db.collection("projects").where("cartella.id", ">", "").get();
  const esito = { file: 0, letti: 0, proposte: 0 };
  let analisi = 0;
  for (const d of snap.docs) {
    const p = { id: d.id, ...d.data() };
    if (p.cartella?.persa || p.archived) continue;
    let token;
    try {
      token = await tokenProprietario(db, p, p.ownerUid, { client, tokenServer });
    } catch (e) { continue; } // senza permesso del proprietario non si guarda (la pagina Google lo dice)
    let files;
    try { files = await fileDelProgetto(db, p, token); }
    catch (e) { console.warn("giroNovita: elenco", p.id, e.status || "", String(e.message).slice(0, 120)); continue; }
    const profilo = (await db.collection("users").doc(p.ownerUid).get()).data() || {};
    for (const f of files) {
      esito.file++;
      const ref = db.collection(FILE).doc(`${p.id}_${f.id}`);
      const noto = (await ref.get()).data();
      if (noto?.modifiedTime === f.modifiedTime) continue;               // niente di nuovo (o scritto dall'app)
      const fermo = adesso - Date.parse(f.modifiedTime || 0) >= FERMO_MS;
      if (!noto && f.collegato) {                                       // collegato a mano: punto di partenza
        const t = await testoFile(token, f, pdfDi(p.ownerUid)).catch(() => null);
        await ref.set({ ownerUid: p.ownerUid, projectId: p.id, fileId: f.id, nome: f.name, ruolo: "collegato", modifiedTime: f.modifiedTime, testo: s(t).slice(0, MAX_TESTO), daApp: false, letto: FieldValue.serverTimestamp() });
        continue;
      }
      if (!fermo || analisi >= MAX_ANALISI) continue;                   // ancora in scrittura, o al giro dopo
      if (noto?.analisi?.inCorso && adesso - ms(noto.analisi.inCorso) < IN_CORSO_MS) continue;
      if (noto?.analisi?.versione === f.modifiedTime && (noto.analisi.errori || 0) >= 3) continue; // tre errori su questa versione: basta
      // Una lettura per versione del file: due giri insieme non leggono due volte.
      const mia = await db.runTransaction(async (t) => {
        const x = (await t.get(ref)).data();
        if (x?.modifiedTime === f.modifiedTime || (x?.analisi?.inCorso && adesso - ms(x.analisi.inCorso) < IN_CORSO_MS)) return false;
        t.set(ref, { analisi: { inCorso: adesso } }, { merge: true });
        return true;
      });
      if (!mia) continue;
      analisi++;
      try {
        const dopo = await testoFile(token, f, pdfDi(p.ownerUid));
        let r = { proposte: 0 };
        if (dopo != null && normalizzaTesto(dopo) !== normalizzaTesto(noto?.testo || "")) {
          r = await leggiCambiamento(db, p, { ...f, copia: f.copia || noto?.ruolo === "copia" }, { prima: noto?.testo || "", dopo, nuovo: !noto?.testo, chiedi: reason, key, profilo });
          esito.letti++;
          esito.proposte += r.proposte;
        }
        // La versione letta diventa quella «precedente»: la prossima volta conta solo ciò che cambia dopo.
        await ref.set({ ownerUid: p.ownerUid, projectId: p.id, fileId: f.id, nome: f.name, ruolo: noto?.ruolo || (f.collegato ? "collegato" : "cartella"),
          chiave: noto?.chiave || "", modifiedTime: f.modifiedTime, testo: s(dopo).slice(0, MAX_TESTO), daApp: false,
          letto: FieldValue.serverTimestamp(), analisi: { fatta: adesso, proposte: r.proposte || 0, modello: r.modello || null } });
        console.log(`giroNovita: un file letto, ${r.proposte || 0} proposte${r.modello ? ` (${r.modello})` : ""}`);
      } catch (e) {
        const errori = noto?.analisi?.versione === f.modifiedTime ? (noto.analisi.errori || 0) + 1 : 1;
        await ref.set({ analisi: { inCorso: adesso, versione: f.modifiedTime, errori, errore: String(e.message).slice(0, 200) } }, { merge: true }).catch(() => {});
        console.warn("giroNovita: lettura", p.id, e.status || "", String(e.message).slice(0, 160));
      }
    }
  }
  return esito;
}
