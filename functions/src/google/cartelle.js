// Cartelle dei progetti su Google Drive (22/11, docs/PIANO-DRIVE-MCP.md, passo 1).
//
// Ogni progetto ha una cartella `D&D/<nome del progetto>` nel Drive di chi l'ha creato (il proprietario del progetto),
// creata dall'app alla creazione del progetto o con un tocco dalla pagina del progetto. Un progetto condiviso ha la
// cartella condivisa con l'altra persona della casa (permesso di modifica); privato, no. Cambiando la visibilità o il
// nome del progetto, la cartella si allinea (`allineaCartella`), anche dal giro ogni 5 minuti (`giroCartelle`) se la
// chiamata dall'app si fosse persa.
//
// Permessi: il server scrive sempre con il permesso Google del proprietario del progetto (tokenServer), con lo scope
// `drive.file` (i file creati dall'app: `permessi.cartelle`). Chi chiama deve vedere il progetto: suo, o condiviso nella
// sua casa. Le funzioni usano l'Admin SDK, che salta le regole: il controllo è qui.
//
// Dati: projects/{id}.cartella = { id, link, nome, ownerUid, condivisaCon (email o null), visibilita (quella a cui è
// allineata), creataAt, allineataAt, persa? (nel cestino o tolta: la ricrea un tocco su «Drive») } (lo
// scrive solo il server: firestore.rules vieta all'app di toccarlo); users/{uid}.cartelleDrive.radice = { id, link }
// (la cartella «D&D»). Le cartelle e i file creati dall'app portano `appProperties.dd` («radice», «progetto»…): così si
// ritrovano anche se il loro id si perde.
import { HttpsError } from "firebase-functions/v2/https";

const API = "https://www.googleapis.com/drive/v3";
export const CARTELLA = "application/vnd.google-apps.folder";
export const RADICE = "D&D";
const CREAZIONE_MS = 60_000; // una creazione «in corso» più vecchia di così è morta

const s = (x) => (typeof x === "string" ? x.trim() : "");
const ms = (t) => (t?.toMillis ? t.toMillis() : t?.toDate ? t.toDate().getTime() : typeof t === "number" ? t : t ? new Date(t).getTime() || 0 : 0);
const errore = (codice, testo, motivo, extra = {}) => new HttpsError(codice, testo, { motivo, ...extra });

/** Errore di una chiamata a Drive: `status` HTTP e il `motivo` di Google (reason). */
export class DriveError extends Error {
  constructor(status, cosa, motivo = "", testo = "") {
    super(`Drive ${status} ${cosa}${motivo ? ` (${motivo})` : ""}${testo ? `: ${testo}` : ""}`);
    this.status = status;
    this.motivo = motivo;
  }
}

/**
 * Una chiamata all'API di Drive v3 con il permesso `token`. `percorso` relativo ad API (o un URL intero, per
 * l'upload); `query` → parametri; `body` → JSON; `multipart` = { metadati, mime, dati (Buffer o stringa) } per creare o
 * aggiornare un file con il contenuto. Ritorna il JSON ({} per una risposta vuota).
 */
export async function drive(token, metodo, percorso, { query = {}, body = null, multipart = null, media = null } = {}) {
  const u = new URL(percorso.startsWith("http") ? percorso : API + percorso);
  for (const [k, v] of Object.entries(query)) if (v !== "" && v != null) u.searchParams.set(k, String(v));
  const headers = { Authorization: `Bearer ${token}` };
  let corpo;
  if (multipart) {
    const confine = `dd${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const dati = Buffer.isBuffer(multipart.dati) ? multipart.dati : Buffer.from(String(multipart.dati ?? ""), "utf8");
    corpo = Buffer.concat([
      Buffer.from(`--${confine}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(multipart.metadati || {})}\r\n--${confine}\r\ncontent-type: ${multipart.mime}\r\n\r\n`, "utf8"),
      dati, Buffer.from(`\r\n--${confine}--`, "utf8"),
    ]);
    headers["content-type"] = `multipart/related; boundary=${confine}`;
  } else if (media) {
    corpo = Buffer.isBuffer(media.dati) ? media.dati : Buffer.from(String(media.dati ?? ""), "utf8");
    headers["content-type"] = media.mime;
  } else if (body) {
    corpo = JSON.stringify(body);
    headers["content-type"] = "application/json";
  }
  const r = await fetch(u, { method: metodo, headers, body: corpo });
  if (r.status === 204) return {};
  const testo = await r.text();
  let j = {};
  try { j = testo ? JSON.parse(testo) : {}; } catch (e) { j = { testo }; }
  if (!r.ok) {
    const motivo = j.error?.errors?.[0]?.reason || j.error?.status || "";
    throw new DriveError(r.status, `${metodo} ${u.pathname.replace(/\/files\/[^/]+/, "/files/…")}`, motivo, String(j.error?.message || "").slice(0, 160));
  }
  return j;
}

/** Il file, se c'è, non è nel cestino e l'app lo raggiunge; altrimenti null. */
export async function seEsiste(token, id, campi = "id,name,trashed,webViewLink") {
  if (!id) return null;
  try {
    const f = await drive(token, "GET", `/files/${encodeURIComponent(id)}`, { query: { fields: campi, supportsAllDrives: "true" } });
    return f.trashed ? null : f;
  } catch (e) {
    if (e.status === 404 || e.status === 403) return null;
    throw e;
  }
}

/** Il primo file dell'app con queste appProperties ({ dd: "radice" }…), dal più vecchio; null se non c'è. */
async function trovaDellApp(token, props, { cartella = true } = {}) {
  const q = [...Object.entries(props).map(([k, v]) => `appProperties has { key='${k}' and value='${String(v).replace(/'/g, "\\'")}' }`),
    "trashed = false", ...(cartella ? [`mimeType = '${CARTELLA}'`] : [])].join(" and ");
  const j = await drive(token, "GET", "/files", { query: { q, fields: "files(id,name,webViewLink,createdTime)", orderBy: "createdTime", pageSize: "5", spaces: "drive" } });
  return j.files?.[0] || null;
}

/** Crea una cartella. */
export async function creaCartellaDrive(token, { nome, genitore = null, descrizione = "", props = {} }) {
  return drive(token, "POST", "/files", {
    query: { fields: "id,name,webViewLink", supportsAllDrives: "true" },
    body: { name: nome, mimeType: CARTELLA, ...(genitore ? { parents: [genitore] } : {}), ...(descrizione ? { description: descrizione } : {}), appProperties: props },
  });
}

const linkCartella = (f) => f.webViewLink || `https://drive.google.com/drive/folders/${f.id}`;
/** Il nome della cartella di un progetto: il nome del progetto, su una riga. */
export const nomeCartella = (p) => s(p?.name).replace(/\s+/g, " ").slice(0, 120) || "Progetto senza nome";

// ───────────── Chi chiama, il progetto, il permesso del proprietario ─────────────

/** Il progetto, se chi chiama lo vede (suo, o condiviso nella sua casa); altrimenti un errore. */
export async function progettoVisibile(db, uid, pid) {
  if (typeof pid !== "string" || !pid || pid.includes("/")) throw errore("invalid-argument", "Progetto mancante", "progetto");
  const snap = await db.collection("projects").doc(pid).get();
  if (!snap.exists) throw errore("not-found", "Progetto non trovato", "progetto");
  const p = { id: snap.id, ...snap.data() };
  if (p.ownerUid === uid) return p;
  if (p.visibility === "shared" && p.householdId) {
    const h = (await db.collection("households").doc(p.householdId).get()).data();
    if (Array.isArray(h?.members) && h.members.includes(uid)) return p;
  }
  throw errore("permission-denied", "Progetto non trovato", "progetto");
}

/** Il nome breve di una persona della casa (per i messaggi: «La cartella sta nel Drive di Mattia»). */
async function nomeDi(db, p, uid) {
  if (!p.householdId) return "";
  const h = (await db.collection("households").doc(p.householdId).get().catch(() => null))?.data();
  return s(h?.memberNames?.[uid]).split(" ")[0];
}

/**
 * Il permesso Google del proprietario del progetto, con lo scope dei file dell'app. Errori con `motivo`:
 * «cartelle» (manca la spunta: va ricollegato Google), «non-collegato», «scaduto»; `proprietario` = il suo nome se
 * non è chi chiama (allora è lui che deve ricollegare).
 */
export async function tokenProprietario(db, p, uid, { client, tokenServer }) {
  const altro = p.ownerUid !== uid ? (await nomeDi(db, p, p.ownerUid)) || "chi ha creato il progetto" : "";
  const chi = altro ? { proprietario: altro } : {};
  let t;
  try {
    t = await tokenServer(db, p.ownerUid, client);
  } catch (e) {
    const m = e.details?.motivo || "";
    if (m === "non-collegato" || m === "scaduto") {
      throw errore("failed-precondition", altro ? `La cartella sta nel Drive di ${altro}: deve collegare Google` : (m === "scaduto" ? "Il collegamento con Google è scaduto: ricollegalo" : "Google non è collegato"), m, chi);
    }
    throw e;
  }
  if (!t.permessi?.cartelle) {
    throw errore("failed-precondition", altro
      ? `La cartella sta nel Drive di ${altro}: deve ricollegare Google e lasciare la spunta per i file creati dall'app`
      : "Ricollega Google e lascia la spunta per i file creati dall'app", "cartelle", chi);
  }
  return t.accessToken;
}

// ───────────── Cartelle ─────────────

/** La cartella «D&D» nel Drive di `uid`: quella salvata, o una dell'app che c'è già, o una nuova. Ritorna l'id. */
export async function radiceDi(db, uid, token) {
  const ref = db.collection("users").doc(uid);
  const salvata = (await ref.get()).data()?.cartelleDrive?.radice;
  if (salvata?.id && await seEsiste(token, salvata.id)) return salvata.id;
  const f = (await trovaDellApp(token, { dd: "radice" })) || await creaCartellaDrive(token, {
    nome: RADICE, descrizione: "Le cartelle dei progetti di Debiti e Doveri, create dall'app.", props: { dd: "radice" },
  });
  await ref.set({ cartelleDrive: { radice: { id: f.id, link: linkCartella(f) } } }, { merge: true });
  return f.id;
}

/** L'email Google dell'altra persona della casa (o quella del suo accesso): "" se non c'è. Anche le altre sue email note. */
async function emailAltri(db, p) {
  if (!p.householdId) return { email: "", tutte: [] };
  const h = (await db.collection("households").doc(p.householdId).get()).data();
  const altri = (h?.members || []).filter((u) => u !== p.ownerUid);
  const tutte = [];
  let email = "";
  for (const u of altri) {
    const d = (await db.collection("users").doc(u).get()).data() || {};
    const g = s(d.google?.email).toLowerCase(), a = s(d.email).toLowerCase();
    if (!email) email = g || a;
    for (const e of [g, a]) if (e && !tutte.includes(e)) tutte.push(e);
  }
  return { email, tutte };
}

/**
 * Allinea la cartella al progetto: nome, e condivisione con l'altra persona (progetto condiviso → permesso di modifica;
 * privato → tolto). Scrive in projects/{id}.cartella lo stato (condivisaCon, nome, allineataAt). Ritorna la cartella.
 */
export async function allineaCartella(db, p, token) {
  const { FieldValue } = await import("firebase-admin/firestore");
  const c = p.cartella;
  if (!c?.id) return null;
  const f = await seEsiste(token, c.id);
  if (!f) return null; // nel cestino o tolta: la ricrea `creaCartella` al prossimo tocco
  const nome = nomeCartella(p);
  if (f.name !== nome) await drive(token, "PATCH", `/files/${encodeURIComponent(c.id)}`, { query: { fields: "id,name" }, body: { name: nome } });
  const { email, tutte } = await emailAltri(db, p);
  const elenco = await drive(token, "GET", `/files/${encodeURIComponent(c.id)}/permissions`, { query: { fields: "permissions(id,type,role,emailAddress)", supportsAllDrives: "true" } });
  const persone = (elenco.permissions || []).filter((x) => x.type === "user" && x.role !== "owner");
  const condivisa = p.visibility === "shared" && !!email;
  if (condivisa && !persone.some((x) => s(x.emailAddress).toLowerCase() === email)) {
    const permesso = { type: "user", role: "writer", emailAddress: email };
    try {
      await drive(token, "POST", `/files/${encodeURIComponent(c.id)}/permissions`, { query: { sendNotificationEmail: "false", supportsAllDrives: "true", fields: "id" }, body: permesso });
    } catch (e) {
      // Un indirizzo che non è un account Google vuole l'invito per mail (Drive non condivide in silenzio).
      if (e.status !== 400) throw e;
      await drive(token, "POST", `/files/${encodeURIComponent(c.id)}/permissions`, { query: { sendNotificationEmail: "true", supportsAllDrives: "true", fields: "id" }, body: permesso });
    }
  }
  if (!condivisa) {
    const togli = new Set([...tutte, s(c.condivisaCon).toLowerCase()].filter(Boolean));
    for (const x of persone.filter((y) => togli.has(s(y.emailAddress).toLowerCase()))) {
      await drive(token, "DELETE", `/files/${encodeURIComponent(c.id)}/permissions/${encodeURIComponent(x.id)}`, { query: { supportsAllDrives: "true" } });
    }
  }
  const nuova = { ...c, nome, link: c.link || linkCartella(f), condivisaCon: condivisa ? email : null };
  await db.collection("projects").doc(p.id).update({
    "cartella.nome": nuova.nome, "cartella.link": nuova.link, "cartella.condivisaCon": nuova.condivisaCon,
    "cartella.visibilita": p.visibility || "private", // a quale visibilità è allineata (il giro confronta questa)
    "cartella.allineataAt": FieldValue.serverTimestamp(),
  });
  return nuova;
}

/**
 * La cartella del progetto: se c'è già (e non è nel cestino) la allinea e la restituisce; se no la crea in «D&D» nel
 * Drive del proprietario, poi la allinea. Due richieste insieme (i due telefoni) non ne creano due: la seconda trova
 * la creazione in corso e risponde { inCorso: true }.
 */
export async function creaCartella(db, uid, pid, { client, tokenServer }) {
  const { FieldValue } = await import("firebase-admin/firestore");
  const p = await progettoVisibile(db, uid, pid);
  const token = await tokenProprietario(db, p, uid, { client, tokenServer });
  if (p.cartella?.id && await seEsiste(token, p.cartella.id)) return { cartella: await allineaCartella(db, p, token) };
  const ref = db.collection("projects").doc(pid);
  const mia = await db.runTransaction(async (t) => {
    const c = (await t.get(ref)).data()?.cartella || {};
    if (c.id && c.id !== p.cartella?.id) return false; // creata intanto da un'altra richiesta
    if (c.creando && Date.now() - ms(c.creando) < CREAZIONE_MS) return false;
    t.update(ref, { cartella: { creando: Date.now() } });
    return true;
  });
  if (!mia) return { cartella: (await ref.get()).data()?.cartella || null, inCorso: true };
  try {
    // Una cartella dell'app per questo progetto che c'è già (l'id si era perso): si riprende quella.
    const gia = await trovaDellApp(token, { dd: "progetto", progetto: pid });
    const f = gia || await creaCartellaDrive(token, {
      nome: nomeCartella(p), genitore: await radiceDi(db, p.ownerUid, token),
      descrizione: `Cartella del progetto «${nomeCartella(p)}» di Debiti e Doveri: la crea e la tiene allineata l'app.`,
      props: { dd: "progetto", progetto: pid },
    });
    const cartella = { id: f.id, link: linkCartella(f), nome: f.name || nomeCartella(p), ownerUid: p.ownerUid, condivisaCon: null, creataAt: FieldValue.serverTimestamp() };
    await ref.update({ cartella });
    return { cartella: await allineaCartella(db, { ...p, cartella }, token), creata: !gia };
  } catch (e) {
    await ref.update({ cartella: p.cartella?.id ? p.cartella : FieldValue.delete() }).catch(() => {});
    throw e;
  }
}

/** La function `cartella`: { azione: "crea" | "allinea", projectId }. */
export async function gestisci(db, uid, data = {}, { client, tokenServer }) {
  if (data.azione === "crea") return creaCartella(db, uid, data.projectId, { client, tokenServer });
  if (data.azione === "allinea") {
    const p = await progettoVisibile(db, uid, data.projectId);
    if (!p.cartella?.id) return { cartella: null };
    const token = await tokenProprietario(db, p, uid, { client, tokenServer });
    return { cartella: await allineaCartella(db, p, token) };
  }
  throw errore("invalid-argument", "Azione sconosciuta", "azione");
}

/**
 * Dal giro ogni 5 minuti: le cartelle il cui stato non corrisponde al progetto (visibilità cambiata, nome cambiato)
 * si allineano. Solo confronti su Firestore; Drive si chiama solo per quelle da sistemare. Ritorna quante.
 */
export async function giroCartelle(db, { client, tokenServer }) {
  const snap = await db.collection("projects").where("cartella.id", ">", "").get();
  let n = 0;
  for (const d of snap.docs) {
    const p = { id: d.id, ...d.data() };
    const c = p.cartella || {};
    if (c.persa || (c.visibilita === (p.visibility || "private") && c.nome === nomeCartella(p))) continue;
    try {
      const token = await tokenProprietario(db, p, p.ownerUid, { client, tokenServer });
      // Cartella nel cestino o tolta: si segna, e la ricrea un tocco su «Drive» nella pagina del progetto.
      if (!(await allineaCartella(db, p, token))) await d.ref.update({ "cartella.persa": true });
      n++;
    } catch (e) {
      console.warn("giroCartelle", p.id, e.details?.motivo || e.status || "", String(e.message).slice(0, 120));
    }
  }
  return n;
}
