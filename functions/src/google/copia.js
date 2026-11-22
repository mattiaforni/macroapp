// App → Drive (22/11, docs/PIANO-DRIVE-MCP.md, passo 2): nella cartella di ogni progetto (cartelle.js)
// 1. la copia leggibile del progetto, nella sottocartella «Copia dall'app»: un Documento Google «Sintesi e da fare» (la
//    sintesi e i task aperti) e uno per mese con le note («Note 2026-11 (novembre)»). Si rifà dopo ogni modifica (l'app
//    chiama `copia` qualche secondo dopo l'ultima, e segna `projects.copiaRichiesta`, che il giro di 5 minuti recupera
//    se la chiamata si perde), ma si riscrive solo un documento il cui contenuto è cambiato (hash dell'HTML);
// 2. «Apri come documento» da una nota o dalla sintesi: un Documento Google nella cartella del progetto, creato una volta
//    e poi riaperto (`documento`);
// 3. le foto delle note, nella sottocartella «Foto» (Firestore resta la fonte, journal_photos).
//
// Niente cicli e niente perdite (piano, «Attenzioni»): di ogni documento scritto dall'app si tiene `modifiedTime` e il
// testo com'è dopo la scrittura (drive_file/{progetto}_{file}: il testo della versione precedente, che il controllo delle
// novità confronta). Un documento della copia modificato da qualcuno su Drive non si sovrascrive finché quella modifica
// non è stata letta (passo 3): se il suo testo è ancora quello scritto dall'app, sì.
//
// Privacy: le copie seguono la visibilità. Un progetto condiviso ha la cartella condivisa con l'altra persona, quindi la
// copia porta solo le note e i task condivisi; un progetto privato quelli che vede il proprietario.
//
// Stato (solo server): drive_cartelle/{progetto} = { ownerUid, projectId, sottocartelle: { copia, foto }, copie: { <chiave>:
// { id, hash, modifiedTime } }, foto: { <id foto>: { id } }, documenti: { <chiave>: { id, link, nome } }, copiaAt,
// copiaInCorso, copiaAncora }.
import { createHash } from "node:crypto";
import { drive, seEsiste, creaCartellaDrive, progettoVisibile, tokenProprietario, creaCartella } from "./cartelle.js";

export const DOC = "application/vnd.google-apps.document";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const STATO = "drive_cartelle";
export const FILE = "drive_file";
const IN_CORSO_MS = 150_000;   // una copia «in corso» più vecchia di così è morta (funzione a 120 s)
const MAX_FOTO = 20;           // foto caricate per giro (le altre al giro dopo)
const MAX_TESTO = 200_000;     // caratteri del testo tenuto in drive_file (un documento di Firestore sta sotto 1 MiB)
const FUSO = "Europe/Rome";
const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

const s = (x) => (typeof x === "string" ? x.trim() : "");
const ms = (t) => (t?.toMillis ? t.toMillis() : t?.toDate ? t.toDate().getTime() : typeof t === "number" ? t : t ? new Date(t).getTime() || 0 : 0);
const hash = (x) => createHash("sha1").update(x).digest("hex");
const giornoIso = (t) => new Intl.DateTimeFormat("sv-SE", { timeZone: FUSO }).format(new Date(ms(t) || Date.now()));
const giornoLungo = (t) => new Intl.DateTimeFormat("it-IT", { timeZone: FUSO, weekday: "long", day: "numeric", month: "long" }).format(new Date(ms(t) || Date.now()));
const dataBreve = (g) => { const [y, m, d] = String(g).split("-").map(Number); return d && m ? `${d} ${MESI[m - 1]}${y !== new Date().getFullYear() ? ` ${y}` : ""}` : ""; };
/** Il testo come lo si confronta: senza spazi in più, senza i segni degli elenchi che Docs aggiunge esportando. */
export const normalizzaTesto = (t) => String(t || "").replace(/\r/g, "").replace(/^[ \t]*[*•\-–]\s+/gm, "").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();

// ───────────── Testo → HTML (i Documenti Google lo convertono) ─────────────

const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

/** Il testo dell'app (sintesi, riepilogo: «## » titoli, «- » elenchi, **grassetto**, righe «Rubrica:») in HTML. */
export function htmlDaTesto(testo, { livello = 2 } = {}) {
  const out = [];
  let lista = false;
  const chiudi = () => { if (lista) { out.push("</ul>"); lista = false; } };
  for (const riga of String(testo || "").replace(/\r/g, "").split("\n")) {
    const r = riga.trim();
    if (!r) { chiudi(); continue; }
    if (/^#{1,4}\s/.test(r)) { chiudi(); out.push(`<h${livello}>${inline(r.replace(/^#+\s*/, ""))}</h${livello}>`); continue; }
    if (/^[-*•]\s/.test(r)) { if (!lista) { out.push("<ul>"); lista = true; } out.push(`<li>${inline(r.replace(/^[-*•]\s+/, ""))}</li>`); continue; }
    chiudi();
    out.push(/^Stato:/i.test(r) ? `<p><i>${inline(r)}</i></p>` : /:$/.test(r) && r.length <= 60 ? `<p><b>${inline(r)}</b></p>` : `<p>${inline(r)}</p>`);
  }
  chiudi();
  return out.join("\n");
}
const pagina = (titolo, corpo) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(titolo)}</title></head><body>\n${corpo}\n</body></html>`;

// ───────────── Cosa va nella copia ─────────────

/**
 * Le note e i task del progetto che la copia può mostrare: in un progetto condiviso (cartella condivisa) solo quelli
 * condivisi della sua casa; in uno privato quelli del proprietario e quelli condivisi della casa. Più i nomi della casa.
 */
export async function contenutoProgetto(db, p) {
  const condiviso = p.visibility === "shared";
  const ammesso = (d) => (d.visibility === "shared" && d.householdId === p.householdId) || (!condiviso && d.ownerUid === p.ownerUid);
  const [n, t, h] = await Promise.all([
    db.collection("journal_entries").where("projectId", "==", p.id).get(),
    db.collection("tasks").where("projectId", "==", p.id).get(),
    p.householdId ? db.collection("households").doc(p.householdId).get() : null,
  ]);
  const note = n.docs.map((d) => ({ id: d.id, ...d.data() })).filter(ammesso).sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  const task = t.docs.map((d) => ({ id: d.id, ...d.data() })).filter(ammesso);
  return { note, task, nomi: h?.data()?.memberNames || {} };
}

const titoloNota = (n) => s(n.titolo) || s(n.text).split("\n")[0].slice(0, 80) || "Nota";

/** Il documento «Sintesi e da fare». */
export function htmlSintesi(p, task, nomi = {}) {
  const aperti = task.filter((t) => !t.done).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || s(a.text).localeCompare(s(b.text)));
  const righe = aperti.map((t) => {
    const altro = [t.due ? `entro il ${dataBreve(t.due)}` : "", s(t.people), t.ownerUid !== p.ownerUid && nomi[t.ownerUid] ? `di ${s(nomi[t.ownerUid]).split(" ")[0]}` : ""].filter(Boolean);
    return `<li>${inline(s(t.text))}${altro.length ? ` <i>(${esc(altro.join(" · "))})</i>` : ""}${s(t.note) ? `<br>${inline(s(t.note))}` : ""}</li>`;
  });
  return pagina(`${p.name} · Sintesi e da fare`, [
    `<h1>${esc(p.name)}</h1>`,
    `<p><i>Copia dall'app Debiti e Doveri: la riscrive l'app quando il progetto cambia. Una modifica fatta qui torna nell'app come proposta da confermare.</i></p>`,
    "<h2>Sintesi</h2>",
    s(p.sintesi) ? htmlDaTesto(p.sintesi, { livello: 3 }) : "<p><i>Ancora senza sintesi.</i></p>",
    "<h2>Da fare</h2>",
    righe.length ? `<ul>\n${righe.join("\n")}\n</ul>` : "<p><i>Niente da fare.</i></p>",
  ].join("\n"));
}

/** Le note di un mese, dalla prima: giorno, titolo, chi l'ha scritta, persone, temi, foto; riepilogo e testo. */
export function htmlMese(p, mese, note, nomi = {}) {
  const [y, m] = mese.split("-").map(Number);
  const pezzi = [`<h1>${esc(p.name)} · ${MESI[m - 1]} ${y}</h1>`];
  for (const n of note) {
    pezzi.push(`<h2>${esc(giornoLungo(n.createdAt))} · ${inline(titoloNota(n))}</h2>`);
    const info = [
      n.ownerUid !== p.ownerUid && nomi[n.ownerUid] ? `di ${s(nomi[n.ownerUid]).split(" ")[0]}` : "",
      (n.persone || []).map((x) => s(x?.nome)).filter(Boolean).join(", "),
      (n.temi || []).length ? `temi: ${n.temi.join(", ")}` : "",
      (n.foto || []).length ? `${n.foto.length === 1 ? "una foto" : `${n.foto.length} foto`} nella cartella Foto` : "",
    ].filter(Boolean);
    if (info.length) pezzi.push(`<p><i>${esc(info.join(" · "))}</i></p>`);
    if (s(n.riepilogo)) pezzi.push(htmlDaTesto(n.riepilogo, { livello: 3 }), s(n.text) ? "<h3>Trascrizione</h3>" : "");
    if (s(n.text)) pezzi.push(...s(n.text).split(/\n+/).map((r) => `<p>${inline(r)}</p>`));
  }
  return pagina(`${p.name} · ${MESI[m - 1]} ${y}`, pezzi.filter(Boolean).join("\n"));
}

/** I documenti della copia: { chiave: { nome, html } }. Chiavi: «sintesi» e «AAAA-MM» per mese. */
export function documentiCopia(p, { note, task, nomi }) {
  const out = { sintesi: { nome: "Sintesi e da fare", html: htmlSintesi(p, task, nomi) } };
  const mesi = new Map();
  for (const n of note) {
    const k = giornoIso(n.createdAt).slice(0, 7);
    if (!mesi.has(k)) mesi.set(k, []);
    mesi.get(k).push(n);
  }
  for (const [k, lista] of mesi) out[k] = { nome: `Note ${k} (${MESI[Number(k.slice(5)) - 1]})`, html: htmlMese(p, k, lista, nomi) };
  return out;
}

// ───────────── Drive ─────────────

const CAMPI = "id,name,version,modifiedTime,webViewLink,trashed";

/** Crea un Documento Google (HTML convertito) o ne sostituisce il contenuto. Ritorna i metadati. */
export async function scriviDoc(token, { id = null, nome, genitore, html, props = {} }) {
  const multipart = { metadati: id ? { name: nome } : { name: nome, mimeType: DOC, parents: [genitore], appProperties: props }, mime: "text/html; charset=UTF-8", dati: html };
  return id
    ? drive(token, "PATCH", `${UPLOAD}/files/${encodeURIComponent(id)}`, { query: { uploadType: "multipart", fields: CAMPI, supportsAllDrives: "true" }, multipart })
    : drive(token, "POST", `${UPLOAD}/files`, { query: { uploadType: "multipart", fields: CAMPI, supportsAllDrives: "true" }, multipart });
}

/** Il testo di un Documento Google com'è adesso (export in testo semplice). */
export async function testoDoc(token, id) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export?mimeType=text%2Fplain`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) { const e = new Error(`Drive ${r.status} export`); e.status = r.status; throw e; }
  return (await r.text()).replace(/^﻿/, "").replace(/\r/g, "").trim();
}

/** Una sottocartella dell'app nella cartella del progetto («Copia dall'app», «Foto»): quella salvata o una nuova. */
async function sottocartella(token, stato, chiave, nome, p) {
  const id = stato.sottocartelle?.[chiave];
  if (id && await seEsiste(token, id)) return id;
  const f = await creaCartellaDrive(token, { nome, genitore: p.cartella.id, props: { dd: chiave, progetto: p.id } });
  stato.sottocartelle = { ...(stato.sottocartelle || {}), [chiave]: f.id };
  return f.id;
}

/**
 * Ricorda ciò che l'app ha appena scritto (drive_file/{progetto}_{file}): modifiedTime e testo, la «versione
 * precedente» con cui il controllo delle novità (passo 3) riconosce le modifiche fatte da altri.
 */
export async function ricordaScritto(db, p, f, { ruolo, chiave, testo }) {
  const { FieldValue } = await import("firebase-admin/firestore");
  await db.collection(FILE).doc(`${p.id}_${f.id}`).set({
    ownerUid: p.ownerUid, projectId: p.id, fileId: f.id, nome: f.name || "", ruolo, chiave: chiave || "",
    modifiedTime: f.modifiedTime || "", testo: String(testo || "").slice(0, MAX_TESTO), daApp: true, letto: FieldValue.serverTimestamp(),
  });
}

/**
 * Un documento dell'app è stato cambiato da qualcuno su Drive, con una modifica non ancora letta? La versione nota è in
 * drive_file: quella scritta dall'app o quella già letta dal controllo delle novità (passo 3, novita.js). Se è cambiato
 * ma il testo è uguale a quello noto, no.
 */
async function cambiatoAMano(db, token, p, st) {
  const meta = await seEsiste(token, st.id, CAMPI);
  if (!meta) return { perso: true };
  if (meta.modifiedTime === st.modifiedTime) return { meta, cambiato: false };
  const noto = (await db.collection(FILE).doc(`${p.id}_${st.id}`).get()).data();
  if (noto?.modifiedTime === meta.modifiedTime) return { meta, cambiato: false };
  const ora = await testoDoc(token, st.id);
  return { meta, cambiato: normalizzaTesto(ora) !== normalizzaTesto(noto?.testo || "") };
}

// ───────────── Copia leggibile e foto ─────────────

/** Rifà la copia del progetto (solo i documenti cambiati) e allinea le foto. Ritorna { scritti, tenuti, foto }. */
export async function rifaiCopia(db, p, token, stato) {
  const dati = await contenutoProgetto(db, p);
  const voluti = documentiCopia(p, dati);
  const cartellaCopia = await sottocartella(token, stato, "copia", "Copia dall'app", p);
  const copie = { ...(stato.copie || {}) };
  const esito = { scritti: 0, tenuti: 0, foto: 0, tolti: 0 };
  for (const [k, d] of Object.entries(voluti)) {
    const h = hash(d.html);
    const st = copie[k];
    if (st?.id && st.hash === h) continue;
    let id = st?.id || null;
    if (id) {
      const c = await cambiatoAMano(db, token, p, st);
      if (c.perso) id = null;
      else if (c.cambiato) { esito.tenuti++; continue; } // modificato a mano: lo legge prima il controllo delle novità
    }
    const props = { dd: "copia", progetto: p.id, chiave: k };
    let f;
    try {
      f = await scriviDoc(token, { id, nome: d.nome, genitore: cartellaCopia, html: d.html, props });
    } catch (e) {
      // Se Google non accetta di sostituire il contenuto del documento, se ne scrive uno nuovo e il vecchio va nel cestino:
      // la copia resta aggiornata (cambia solo il link a quel documento).
      if (!id || ![400, 403].includes(e.status)) throw e;
      console.warn("copia: documento non sostituito, ne scrivo uno nuovo", e.status, e.motivo || "");
      f = await scriviDoc(token, { nome: d.nome, genitore: cartellaCopia, html: d.html, props });
      await drive(token, "PATCH", `/files/${encodeURIComponent(id)}`, { body: { trashed: true }, query: { supportsAllDrives: "true" } }).catch(() => {});
    }
    await ricordaScritto(db, p, f, { ruolo: "copia", chiave: k, testo: await testoDoc(token, f.id).catch(() => "") });
    copie[k] = { id: f.id, hash: h, modifiedTime: f.modifiedTime || "" };
    esito.scritti++;
  }
  // Un mese rimasto senza note: il suo documento va nel cestino (se nessuno l'ha cambiato a mano).
  for (const [k, st] of Object.entries(copie)) {
    if (voluti[k] || !st?.id) continue;
    const c = await cambiatoAMano(db, token, p, st).catch(() => ({ perso: true }));
    if (!c.perso && !c.cambiato) await drive(token, "PATCH", `/files/${encodeURIComponent(st.id)}`, { body: { trashed: true }, query: { supportsAllDrives: "true" } }).catch(() => {});
    if (c.perso || !c.cambiato) { delete copie[k]; esito.tolti++; }
  }
  stato.copie = copie;
  esito.foto = await allineaFoto(db, p, token, stato, dati.note);
  return esito;
}

/** Le foto delle note della copia nella sottocartella «Foto»: carica quelle nuove, mette nel cestino quelle tolte. */
async function allineaFoto(db, p, token, stato, note) {
  const volute = new Map();
  for (const n of note) (n.foto || []).forEach((f, i) => { if (f?.id) volute.set(f.id, { n, i, tot: n.foto.length }); });
  const foto = { ...(stato.foto || {}) };
  let fatte = 0;
  const mancanti = [...volute.keys()].filter((id) => !foto[id]);
  if (mancanti.length) {
    const cartellaFoto = await sottocartella(token, stato, "foto", "Foto", p);
    for (const id of mancanti.slice(0, MAX_FOTO)) {
      const { n, i, tot } = volute.get(id);
      const d = (await db.collection("journal_photos").doc(id).get()).data();
      if (!d?.dati || d.entryId !== n.id) continue;
      const nome = `${giornoIso(n.createdAt)} ${titoloNota(n).replace(/[\\/:*?"<>|]/g, " ").slice(0, 60)}${tot > 1 ? ` (${i + 1})` : ""}.jpg`;
      const f = await drive(token, "POST", `${UPLOAD}/files`, {
        query: { uploadType: "multipart", fields: "id,name", supportsAllDrives: "true" },
        multipart: { metadati: { name: nome, parents: [cartellaFoto], appProperties: { dd: "foto", progetto: p.id, foto: id } }, mime: d.mime || "image/jpeg", dati: Buffer.from(d.dati, "base64") },
      });
      foto[id] = { id: f.id };
      fatte++;
    }
  }
  for (const [id, st] of Object.entries(foto)) {
    if (volute.has(id)) continue;
    await drive(token, "PATCH", `/files/${encodeURIComponent(st.id)}`, { body: { trashed: true }, query: { supportsAllDrives: "true" } }).catch(() => {});
    delete foto[id];
    fatte++;
  }
  stato.foto = foto;
  return fatte;
}

/**
 * La copia di un progetto, con il permesso del proprietario. Una copia alla volta per progetto: una richiesta mentre ne
 * gira un'altra la segna (`copiaAncora`) e quella in corso ricomincia alla fine, così l'ultima modifica entra sempre.
 * Ritorna l'esito o { inCorso: true }.
 */
export async function copiaProgetto(db, p, token) {
  const { FieldValue } = await import("firebase-admin/firestore");
  const ref = db.collection(STATO).doc(p.id);
  const mia = await db.runTransaction(async (t) => {
    const st = (await t.get(ref)).data() || {};
    if (st.copiaInCorso && Date.now() - ms(st.copiaInCorso) < IN_CORSO_MS) { t.set(ref, { copiaAncora: true }, { merge: true }); return false; }
    t.set(ref, { ownerUid: p.ownerUid, projectId: p.id, copiaInCorso: Date.now(), copiaAncora: false }, { merge: true });
    return true;
  });
  if (!mia) return { inCorso: true };
  const totale = { scritti: 0, tenuti: 0, foto: 0, tolti: 0 };
  try {
    for (let giro = 0; giro < 3; giro++) {
      const inizio = Date.now();
      const stato = (await ref.get()).data() || {};
      // Il progetto si rilegge: tra un giro e l'altro può essere cambiato.
      const ora = giro ? { id: p.id, ...(await db.collection("projects").doc(p.id).get()).data() } : p;
      const e = await rifaiCopia(db, ora, token, stato);
      for (const k of Object.keys(totale)) totale[k] += e[k] || 0;
      await ref.set({ sottocartelle: stato.sottocartelle || {}, copie: stato.copie || {}, foto: stato.foto || {}, copiaAt: inizio }, { mergeFields: ["sottocartelle", "copie", "foto", "copiaAt"] });
      const ancora = await db.runTransaction(async (t) => {
        const st = (await t.get(ref)).data() || {};
        if (st.copiaAncora) { t.update(ref, { copiaAncora: false, copiaInCorso: Date.now() }); return true; }
        t.update(ref, { copiaInCorso: FieldValue.delete() });
        return false;
      });
      if (!ancora) return totale;
    }
    await ref.update({ copiaInCorso: FieldValue.delete() });
    return totale;
  } catch (e) {
    await ref.update({ copiaInCorso: FieldValue.delete() }).catch(() => {});
    throw e;
  }
}

// ───────────── «Apri come documento» ─────────────

/**
 * Un Documento Google con una nota o con la sintesi, nella cartella del progetto (creata se manca). La seconda volta
 * riapre lo stesso, che nel frattempo può essere stato cambiato su Drive. Ritorna { link, nome, nuovo }.
 */
export async function apriComeDocumento(db, uid, { projectId, entryId = null }, opz) {
  let p = await progettoVisibile(db, uid, projectId);
  const token = await tokenProprietario(db, p, uid, opz);
  if (!p.cartella?.id) {
    await creaCartella(db, uid, projectId, opz);
    p = await progettoVisibile(db, uid, projectId);
    if (!p.cartella?.id) throw Object.assign(new Error("La cartella del progetto si sta creando: riprova tra poco"), { status: 409 });
  }
  let nota = null;
  if (entryId) {
    const d = typeof entryId === "string" && !entryId.includes("/") ? await db.collection("journal_entries").doc(entryId).get() : null;
    nota = d?.exists ? { id: d.id, ...d.data() } : null;
    const casa = nota?.householdId ? (await db.collection("households").doc(nota.householdId).get()).data() : null;
    const vede = nota && (nota.ownerUid === uid || (nota.visibility === "shared" && casa?.members?.includes(uid)));
    if (!vede || nota.projectId !== p.id) throw Object.assign(new Error("Nota non trovata"), { codice: "not-found" });
    // Nella cartella condivisa la vedrebbe anche l'altra persona: una nota privata non ci va.
    if (p.visibility === "shared" && nota.visibility !== "shared") throw Object.assign(new Error("La nota è privata e la cartella del progetto è condivisa"), { codice: "privata" });
  }
  const chiave = nota ? `nota:${nota.id}` : "sintesi";
  const ref = db.collection(STATO).doc(p.id);
  const stato = (await ref.get()).data() || {};
  const gia = stato.documenti?.[chiave];
  if (gia?.id) {
    const f = await seEsiste(token, gia.id, CAMPI);
    if (f) return { link: f.webViewLink || gia.link, nome: f.name, nuovo: false };
  }
  const nome = nota ? `${giornoIso(nota.createdAt)} ${titoloNota(nota)}`.slice(0, 120) : `Sintesi di ${p.name}`;
  const corpo = nota
    ? [`<h1>${inline(titoloNota(nota))}</h1>`, `<p><i>${esc(giornoLungo(nota.createdAt))} · nota del progetto ${esc(p.name)}</i></p>`,
      s(nota.riepilogo) ? htmlDaTesto(nota.riepilogo, { livello: 2 }) : "", s(nota.riepilogo) && s(nota.text) ? "<h2>Trascrizione</h2>" : "",
      ...s(nota.text).split(/\n+/).filter(Boolean).map((r) => `<p>${inline(r)}</p>`)].filter(Boolean).join("\n")
    : [`<h1>Sintesi di ${esc(p.name)}</h1>`, s(p.sintesi) ? htmlDaTesto(p.sintesi, { livello: 2 }) : "<p></p>"].join("\n");
  const f = await scriviDoc(token, { nome, genitore: p.cartella.id, html: pagina(nome, corpo), props: { dd: "documento", progetto: p.id, chiave } });
  await ricordaScritto(db, p, f, { ruolo: "documento", chiave, testo: await testoDoc(token, f.id).catch(() => "") });
  const link = f.webViewLink || `https://docs.google.com/document/d/${f.id}/edit`;
  await ref.set({ ownerUid: p.ownerUid, projectId: p.id, documenti: { [chiave]: { id: f.id, link, nome: f.name || nome } } }, { merge: true });
  return { link, nome: f.name || nome, nuovo: true };
}

/** `copia` dalla function `cartella`: chi chiama deve vedere il progetto; senza cartella non c'è niente da copiare. */
export async function copiaDaApp(db, uid, projectId, opz) {
  const p = await progettoVisibile(db, uid, projectId);
  if (!p.cartella?.id || p.cartella.persa) return { cartella: null };
  const token = await tokenProprietario(db, p, uid, opz);
  return copiaProgetto(db, p, token);
}

/**
 * Dal giro ogni 5 minuti: i progetti con la cartella la cui copia è indietro (`copiaRichiesta` dopo l'ultima copia:
 * una chiamata dall'app persa, un'analisi finita con l'app chiusa). Ritorna quante copie ha rifatto.
 */
export async function giroCopie(db, opz) {
  const snap = await db.collection("projects").where("cartella.id", ">", "").get();
  let n = 0;
  for (const d of snap.docs) {
    const p = { id: d.id, ...d.data() };
    if (!p.copiaRichiesta || p.cartella?.persa) continue;
    const st = (await db.collection(STATO).doc(p.id).get()).data() || {};
    if (ms(p.copiaRichiesta) <= ms(st.copiaAt)) continue;
    try {
      const token = await tokenProprietario(db, p, p.ownerUid, opz);
      await copiaProgetto(db, p, token);
      n++;
    } catch (e) {
      console.warn("giroCopie", p.id, e.details?.motivo || e.status || "", String(e.message).slice(0, 120));
    }
  }
  return n;
}
