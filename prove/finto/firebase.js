// Stub in-memory di Firebase per il test del guscio senza rete.
// I dati restano in sessionStorage: sopravvivono a un ricaricamento della pagina (come Firestore),
// che serve per provare il passaggio dalla pagina di Google.
const PERSIST = "finto.firestore";
const DATA_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const store = new Map(); // coll -> Map(id -> data)
const listeners = new Set();
let seq = 0;
const UID = "uid-test";
try {
  const salvato = JSON.parse(sessionStorage.getItem(PERSIST) || "null", (_k, v) => (typeof v === "string" && DATA_ISO.test(v) ? new Date(v) : v));
  if (salvato) { seq = salvato.seq; for (const [c, docs] of salvato.store) store.set(c, new Map(docs)); }
} catch (e) { console.warn("stub: dati non ripresi", e); }

function coll(name) { if (!store.has(name)) store.set(name, new Map()); return store.get(name); }
function notify() {
  try { sessionStorage.setItem(PERSIST, JSON.stringify({ seq, store: [...store].map(([c, m]) => [c, [...m]]) })); } catch (e) {}
  for (const l of listeners) l();
}
export const serverTimestamp = () => new Date();
export const arrayUnion = (...v) => ({ __arrayUnion: v });
export class Timestamp {}

export function initializeApp() { return {}; }
export function getAuth() { return {}; }
export class GoogleAuthProvider {
  addScope() {}
  setCustomParameters() {}
  static credentialFromResult() { return { accessToken: "token-finto" }; }
}
export function reauthenticateWithPopup(user) { return Promise.resolve({ user, operationType: "reauthenticate" }); }
export function reauthenticateWithRedirect() { return Promise.resolve(); }
export function getFirestore() { return {}; }
export function enableIndexedDbPersistence() { return Promise.resolve(); }
export function getFunctions() { return {}; }
// Google Contatti: «avvio» rimanda a /google-contatti come farebbe Google dopo il consenso.
function contatti(data) {
  const utenti = coll("users");
  const u = utenti.get(UID) || {};
  const errore = (motivo) => Object.assign(new Error(motivo), { code: "functions/failed-precondition", details: { motivo } });
  const token = { email: "mattia@example.com", accessToken: "token-finto", scade: Date.now() + 3600 * 1000 };
  if (data.azione === "avvio") return { url: `${location.origin}/google-contatti?code=codice-finto&state=s1` };
  if (data.azione === "collega") {
    if (data.code !== "codice-finto" || data.state !== "s1") throw errore("state");
    utenti.set(UID, { ...u, contattiGoogle: { collegato: true, scaduto: false, email: token.email } }); notify();
    return token;
  }
  if (data.azione === "token") { if (!u.contattiGoogle?.collegato) throw errore("non-collegato"); return token; }
  if (data.azione === "scollega") { const { contattiGoogle, ...resto } = u; utenti.set(UID, resto); notify(); return {}; }
  throw errore("azione");
}

export function httpsCallable(_f, name) {
  if (name === "bank") return bankFinto;
  return async (data) => {
    if (name === "contatti") return { data: contatti(data) };
    if (name !== "analyzeEntry") return { data: {} };
    const hid = coll("users").get(UID)?.householdId || null;
    const base = { ownerUid: UID, householdId: hid, source: "agent", status: "pending", sourceEntryId: data.entryId, createdAt: new Date() };
    const P = coll("proposals");
    // Nota di un progetto con istruzioni: riepilogo nella nota e una sola azione.
    const nota = coll("journal_entries").get(data.entryId);
    const progetto = nota?.projectId ? coll("projects").get(nota.projectId) : null;
    if (progetto?.istruzioni) {
      nota.riepilogo = "## Cosa ho imparato\n- Dritto: **chiudere prima** la spalla\n- Rovescio a due mani: piedi più larghi\n\n## Da ricordare\n- Torna la correzione sulla spalla della settimana scorsa";
      P.set("p" + (++seq), { ...base, visibility: "private", kind: "task", summary: "Comprare le corde nuove", payload: { text: "Comprare le corde nuove", due: "", project: progetto.name, people: "" } });
      notify();
      return { data: { proposals: 1, riepilogo: true } };
    }
    P.set("p" + (++seq), { ...base, visibility: "private", kind: "task", summary: "Preparare l'assemblea del circolo entro venerdì", payload: { text: "Preparare l'assemblea", due: "2026-10-30", project: "Circolo", people: "Marco" } });
    P.set("p" + (++seq), { ...base, visibility: "shared", kind: "shopping_item", summary: "Comprare lampadine", payload: { text: "Lampadine" } });
    P.set("p" + (++seq), { ...base, visibility: "private", kind: "draft", summary: "Mail a Marco per l'assemblea", payload: { channel: "email", to: "Marco", subject: "Assemblea del circolo", body: "Ciao Marco,\nti propongo di vederci venerdì alle 21 per preparare l'assemblea.\n\nMattia" } });
    notify();
    return { data: { proposals: 3 } };
  };
}
export function signInWithPopup() { return Promise.resolve(); }
export function signInWithRedirect() { return Promise.resolve(); }
export function signOut() { return Promise.resolve(); }
export function onAuthStateChanged(_a, cb) { setTimeout(() => cb({ uid: UID, displayName: "Test", email: "t@example.com", photoURL: "" }), 0); }

export function collection(_db, name) { return { coll: name }; }
export function doc(_dbOrColl, a, b) {
  if (_dbOrColl && _dbOrColl.coll) return { coll: _dbOrColl.coll, id: "auto" + (++seq) };
  return { coll: a, id: b };
}
export async function getDoc(ref) {
  const d = coll(ref.coll).get(ref.id);
  return { exists: () => !!d, id: ref.id, data: () => d };
}
export async function setDoc(ref, data) { coll(ref.coll).set(ref.id, { ...data }); notify(); }
export async function updateDoc(ref, data) {
  const d = coll(ref.coll).get(ref.id) || {};
  for (const [k, v] of Object.entries(data)) {
    if (k.includes(".")) { const [a, b] = k.split("."); d[a] = { ...(d[a] || {}), [b]: v }; continue; }
    if (v && v.__arrayUnion) d[k] = [...new Set([...(d[k] || []), ...v.__arrayUnion])];
    else d[k] = v;
  }
  coll(ref.coll).set(ref.id, d); notify();
}
export async function addDoc(c, data) { const id = "auto" + (++seq); coll(c.coll).set(id, { ...data }); notify(); return { id }; }
export async function deleteDoc(ref) { coll(ref.coll).delete(ref.id); notify(); }
export function where(f, op, v) { return { f, op, v }; }
export function or(...c) { return { or: c }; }
export function and(...c) { return { and: c }; }
export function orderBy(f, dir) { return { orderBy: f, dir }; }
export function limit(n) { return { limit: n }; }
export function query(c, ...parts) { return { coll: c.coll, parts }; }
// Function `bank` finta: elenco di banche, consenso che torna subito su /banca?code=…, conti e movimenti inventati.
async function bankFinto(data = {}) {
  const B = coll("bank_connections");
  const hid = coll("users").get(UID)?.householdId || null;
  if (data.azione === "banche") {
    return { data: { banche: [
      { name: "Banca di Prova", country: "IT", beta: false, maxConsentSeconds: 90 * 86400 },
      { name: "Cassa Rurale Finta", country: "IT", beta: true, maxConsentSeconds: 30 * 86400 },
    ] } };
  }
  if (data.azione === "avvia") {
    const state = "state-prova";
    B.set(UID, { ...(B.get(UID) || {}), ownerUid: UID, householdId: hid, pending: { state, aspsp: data.aspsp } });
    notify();
    return { data: { url: `/banca?code=codice-prova&state=${state}` } };
  }
  if (data.azione === "concludi") {
    // Come Intesa: name è l'intestatario, uguale per tutti i conti; una carta senza IBAN.
    const accounts = [
      { uid: "conto-1", name: "ROSSI MARIO", product: "", currency: "EUR", type: "CACC", ibanMask: "IT…1234", idMask: "" },
      { uid: "carta-1", name: "ROSSI MARIO", product: "", currency: "EUR", type: "CARD", ibanMask: "", idMask: "…9876" },
    ];
    B.set(UID, { ownerUid: UID, householdId: hid, active: true, aspsp: { name: "Banca di Prova", country: "IT" }, sessionId: "sessione-prova",
      accounts, accountIds: accounts.map((a) => a.uid), consentExpiresAt: new Date(Date.now() + 175 * 86400e3), linkedAt: new Date(),
      lastError: null, needsRenewal: false, sessionStatus: "AUTHORIZED", letture: 0 });
    notify();
    return { data: { accounts } };
  }
  if (data.azione === "scollega") {
    B.set(UID, { ...(B.get(UID) || {}), active: false, sessionId: null, accounts: [], accountIds: [], consentExpiresAt: null });
    notify();
    return { data: { ok: true } };
  }
  if (data.azione === "sincronizza") {
    const c = B.get(UID) || {};
    // Dalla seconda lettura la banca ha chiuso il consenso (come Intesa dopo un giorno).
    if (c.letture >= 1) {
      B.set(UID, { ...c, lastAttemptAt: new Date(), lastError: null, needsRenewal: true, sessionStatus: "EXPIRED", sessionEndedAt: c.sessionEndedAt || new Date() });
      notify();
      throw Object.assign(new Error("La banca ha chiuso il consenso: rinnovalo per riprendere la lettura"), { code: "functions/failed-precondition" });
    }
    const P = coll("proposals");
    const base = { ownerUid: UID, householdId: hid, visibility: "private", kind: "expense", source: "bank", status: "pending", createdAt: new Date() };
    const ieri = new Date(Date.now() - 86400e3);
    P.set("eb_prova_1", { ...base, summary: "ESSELUNGA FIRENZE · 42,10 €", payload: { amount: 42.1, description: "ESSELUNGA FIRENZE", paidBy: UID, split: "equal", date: ieri, source: "bank", bankTxId: "eb_prova_1", account: "Conto corrente" } });
    P.set("eb_prova_2", { ...base, summary: "Enel Energia · 61,30 €", payload: { amount: 61.3, description: "Enel Energia", paidBy: UID, split: "equal", date: ieri, source: "bank", bankTxId: "eb_prova_2", account: "Conto corrente" } });
    P.set("eb_prova_3", { ...base, summary: "AMAZON EU · 24,99 €", payload: { amount: 24.99, description: "AMAZON EU", paidBy: UID, split: "equal", date: ieri, source: "bank", bankTxId: "eb_prova_3", account: "Carta" } });
    const scartati = [{ key: "eb_saldo", giorno: ieri.toISOString().slice(0, 10), descrizione: "ADDEBITO SALDO E/C CARTA 9876", importo: 312.4, conto: "Conto corrente", motivo: "Saldo della carta, importo abbinato" }];
    const lettura = {
      conti: [
        { uid: "conto-1", conto: "Conto corrente", tipo: "CACC", letti: 14, stati: { "DBIT BOOK": 9, "CRDT BOOK": 5 }, ultimo: ieri.toISOString().slice(0, 10) },
        { uid: "carta-1", conto: "Carta", tipo: "CARD", letti: 6, stati: { "DBIT BOOK": 3, "DBIT PDNG": 2, "CRDT BOOK": 1 }, ultimo: ieri.toISOString().slice(0, 10) },
      ],
      inAttesa: [
        { giorno: ieri.toISOString().slice(0, 10), descrizione: "RISTORANTE DA PINO", importo: 58, conto: "Carta", stato: "PDNG" },
        { giorno: ieri.toISOString().slice(0, 10), descrizione: "Q8 FIRENZE", importo: 40, conto: "Carta", stato: "PDNG" },
      ],
    };
    B.set(UID, { ...c, lastSyncAt: new Date(), lastSyncCreated: 3, lastError: null, letture: (c.letture || 0) + 1, scartati, lettura });
    notify();
    return { data: { created: 3 } };
  }
  return { data: {} };
}
function matches(d, cond) {
  if (!cond) return true;
  if (cond.or) return cond.or.some((c) => matches(d, c));
  if (cond.and) return cond.and.every((c) => matches(d, c));
  if (cond.f) return d[cond.f] === cond.v;
  return true;
}
export function onSnapshot(q, cb) {
  // Su un singolo documento (es. bank_connections/{uid}): snapshot con exists() e data().
  if (!q.parts && q.coll && q.id) {
    const run = () => { const d = coll(q.coll).get(q.id); cb({ id: q.id, exists: () => !!d, data: () => d }); };
    listeners.add(run); run();
    return () => listeners.delete(run);
  }
  const run = () => {
    const cond = q.parts.find((p) => p.or || p.and || p.f);
    const ord = q.parts.find((p) => p.orderBy);
    let docs = [...coll(q.coll).entries()].filter(([, d]) => matches(d, cond));
    if (ord) docs.sort(([, a], [, b]) => { const x = a[ord.orderBy], y = b[ord.orderBy]; const r = x > y ? 1 : x < y ? -1 : 0; return ord.dir === "desc" ? -r : r; });
    cb({ docs: docs.map(([id, d]) => ({ id, data: () => d })) });
  };
  listeners.add(run); run();
  return () => listeners.delete(run);
}
export function getRedirectResult() { return Promise.resolve(null); }
