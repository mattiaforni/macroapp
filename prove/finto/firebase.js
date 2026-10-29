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
export const deleteField = () => ({ __delete: true });
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
// Account Google (contatti, calendario, Drive): «avvio» rimanda a /google-contatti come farebbe Google
// dopo il consenso; tutti e tre i permessi sono dati. Le API di Google le finge la prova (pg.route).
function google(data) {
  const utenti = coll("users");
  const u = utenti.get(UID) || {};
  const errore = (motivo) => Object.assign(new Error(motivo), { code: "functions/failed-precondition", details: { motivo } });
  const permessi = { contatti: true, calendario: true, drive: true };
  const token = { email: "mattia@example.com", accessToken: "token-finto", scade: Date.now() + 3600 * 1000, permessi };
  if (data.azione === "avvio") return { url: `${location.origin}/google-contatti?code=codice-finto&state=s1` };
  if (data.azione === "collega") {
    if (data.code !== "codice-finto" || data.state !== "s1") throw errore("state");
    utenti.set(UID, { ...u, google: { collegato: true, scaduto: false, email: token.email, permessi, dal: new Date() } }); notify();
    return token;
  }
  if (data.azione === "token") { if (!u.google?.collegato) throw errore("non-collegato"); return token; }
  if (data.azione === "scollega") { const { google: _g, ...resto } = u; utenti.set(UID, resto); notify(); return {}; }
  throw errore("azione");
}

// Messaging finto: un token fisso, sempre supportato.
export function getMessaging() { return {}; }
export async function isSupported() { return true; }
export async function getToken() { return "token-finto"; }
export async function deleteToken() { return true; }

// Funzione `avvisa` finta: tiene l'elenco delle chiamate (sessionStorage «finto.avvisi»), che la prova controlla.
function avvisaFinto(data = {}) {
  let elenco = [];
  try { elenco = JSON.parse(sessionStorage.getItem("finto.avvisi") || "[]"); } catch (e) {}
  elenco.push(data);
  try { sessionStorage.setItem("finto.avvisi", JSON.stringify(elenco)); } catch (e) {}
  return { inviati: data.prova ? 1 : 0 };
}

// Funzione `prodotto` finta: una scheda piena per il codice degli spaghetti, una senza ingredienti,
// «non trovato» per gli altri. Stesso formato di functions/src/prodotti/off.js → normalizza().
const SCHEDE_FINTE = {
  8076809513753: {
    trovato: true, fonte: "off", tipo: "food", nome: "Spaghetti n.5", marca: "Barilla", quantita: "500 g", descrizione: "Pasta di semola di grano duro",
    categoria: "Spaghetti", categorie: ["Cereali e patate", "Paste alimentari", "Spaghetti"], immagine: null,
    nutriscore: { grado: "a", punteggio: -3 }, nova: 1, additivi: [], etichette: [], bio: false,
    nutrienti: { kcal: 359, grassi: 2, saturi: 0.5, zuccheri: 3.5, sale: 0, fibre: 3, proteine: 12.5 },
    livelli: { fat: "low", "saturated-fat": "low", sugars: "low", salt: "low" }, ambiente: "a", completezza: 0.9, ingredientiNoti: true,
    aggiornatoOff: 1760000000000, indice: 90, fascia: "eccellente", parziale: false, mancano: [], versioneIndice: 2,
    componenti: { nutrizione: { valore: 100, peso: 50, stato: "noto" }, additivi: { valore: 100, peso: 25, stato: "noto" }, nova: { valore: 100, peso: 15, stato: "noto" }, bio: { valore: 0, peso: 10, stato: "noto" } },
  },
  8001234567890: {
    trovato: true, fonte: "off", tipo: "food", nome: "Würstel di pollo", marca: "Marca", quantita: "250 g", descrizione: null,
    categoria: "Würstel", categorie: ["Carni", "Salumi", "Würstel"], immagine: null,
    nutriscore: { grado: "d", punteggio: 14 }, nova: 4,
    additivi: [{ codice: "E250", nome: "Nitrito di sodio", classe: "conservante", rischio: "alto" }, { codice: "E301", nome: "Ascorbato di sodio", classe: "antiossidante", rischio: null }, { codice: "E621", nome: "Glutammato di monosodio", classe: "esaltatore di sapidità", rischio: "alto" }],
    etichette: [], bio: false, nutrienti: { kcal: 260, grassi: 22, saturi: 8, zuccheri: 1, sale: 2.1, fibre: null, proteine: null },
    livelli: { fat: "high", "saturated-fat": "high", sugars: "low", salt: "high" }, ambiente: null, completezza: 0.8, ingredientiNoti: true,
    aggiornatoOff: 1760000000000, indice: 24, fascia: "scarso", parziale: false, mancano: [], versioneIndice: 2,
    componenti: { nutrizione: { valore: 30, peso: 50, stato: "noto" }, additivi: { valore: 20, peso: 25, stato: "noto" }, nova: { valore: 25, peso: 15, stato: "noto" }, bio: { valore: 0, peso: 10, stato: "noto" } },
  },
};
async function prodottoFinto(data = {}) {
  // Ritardo come sul telefono (function fredda + Open Food Facts): la prova lo alza per guardare l'attesa.
  const ritardo = Number(sessionStorage.getItem("finto.prodotto.ritardo") || 80);
  await new Promise((ok) => setTimeout(ok, ritardo));
  const ean = String(data.ean || "").replace(/\D/g, "");
  // Un codice che fallisce la prima volta e riesce alla seconda (Open Food Facts che non risponde, poi «Riprova»).
  if (ean === "4000000000002" && !sessionStorage.getItem("finto.prodotto.fallito")) {
    sessionStorage.setItem("finto.prodotto.fallito", "1");
    throw Object.assign(new Error("Open Food Facts non risponde (503)"), { code: "functions/unavailable" });
  }
  const scheda = SCHEDE_FINTE[ean];
  if (scheda) coll("prodotti").set(ean, { ...scheda, ean, letto: new Date() });
  return { data: scheda ? { ...scheda, ean, letto: Date.now() } : { trovato: false, fonte: "off", ean, letto: Date.now() } };
}

export function httpsCallable(_f, name) {
  if (name === "bank") return bankFinto;
  if (name === "avvisa") return async (data) => ({ data: avvisaFinto(data) });
  if (name === "prodotto") return prodottoFinto;
  // Trascrizione finta: segna cosa ha ricevuto (formato, dimensione, progetto) per le asserzioni della prova.
  if (name === "trascrivi") return async (data) => {
    await new Promise((r) => setTimeout(r, 300));
    const viste = JSON.parse(sessionStorage.getItem("finto.trascrizioni") || "[]");
    viste.push({ mimeType: data.mimeType, kb: Math.round((data.audio || "").length * 0.75 / 1024), projectId: data.projectId || null });
    sessionStorage.setItem("finto.trascrizioni", JSON.stringify(viste));
    return { data: { testo: "Lezione di oggi con Marco: rovescio a due mani e split step prima della risposta al servizio." } };
  };
  return async (data) => {
    if (name === "google") return { data: google(data) };
    if (name !== "analyzeEntry") return { data: {} };
    const hid = coll("users").get(UID)?.householdId || null;
    const base = { ownerUid: UID, householdId: hid, source: "agent", status: "pending", sourceEntryId: data.entryId, createdAt: new Date() };
    const P = coll("proposals");
    // Modello come in functions/src/agent.js (modelloPer): scelta della persona o predefinito.
    const scelti = coll("users").get(UID)?.modelli || {};
    // Nota di un progetto con istruzioni: riepilogo nella nota, un'azione e la sintesi del progetto proposta.
    const nota = coll("journal_entries").get(data.entryId);
    const progetto = nota?.projectId ? coll("projects").get(nota.projectId) : null;
    if (progetto?.istruzioni) {
      nota.riepilogo = "## Cosa ho imparato\n- Dritto: **chiudere prima** la spalla\n- Rovescio a due mani: piedi più larghi\n\n## Da ricordare\n- Torna la correzione sulla spalla della settimana scorsa";
      nota.titolo = "Spalla chiusa sul dritto, piedi larghi sul rovescio";
      nota.temi = ["Dritto", "Rovescio a due mani"];
      P.set("p" + (++seq), { ...base, visibility: "private", kind: "task", summary: "Comprare le corde nuove", payload: { text: "Comprare le corde nuove", due: "", project: progetto.name, people: "" } });
      P.set("p" + (++seq), { ...base, visibility: "private", kind: "project_summary", summary: progetto.sintesi ? `Sintesi di ${progetto.name} aggiornata` : `Prima sintesi di ${progetto.name}`,
        payload: { projectId: nota.projectId, projectName: progetto.name, prima: !progetto.sintesi,
          // Le rubriche nei due modi visti dall'AI: voce con le sottovoci rientrate e riga a sé con i due punti.
          sintesi: "## Dritto\nStato: migliora\n- Acquisito:\n  - Racchetta che scende\n  - Mano sinistra per la distanza\nIn lavorazione:\n- Chiudere la spalla **prima** del colpo: correzione che torna\n\n## Rovescio a due mani\nStato: da consolidare\n- Piedi più larghi\n\n## Da provare\n- Servizio con il lancio più avanti" } });
      notify();
      return { data: { proposals: 2, riepilogo: true, sintesi: true, modello: scelti.progetti || "opus" } };
    }
    P.set("p" + (++seq), { ...base, visibility: "private", kind: "task", summary: "Preparare l'assemblea del circolo entro venerdì", payload: { text: "Preparare l'assemblea", due: "2026-10-30", project: "Circolo", people: "Marco" } });
    P.set("p" + (++seq), { ...base, visibility: "shared", kind: "shopping_item", summary: "Comprare lampadine", payload: { text: "Lampadine" } });
    const traTre = new Date(); traTre.setDate(traTre.getDate() + 3);
    const giorno = `${traTre.getFullYear()}-${String(traTre.getMonth() + 1).padStart(2, "0")}-${String(traTre.getDate()).padStart(2, "0")}`;
    P.set("p" + (++seq), { ...base, visibility: "shared", kind: "event", summary: "Cena con i Rossi alle 20", payload: { text: "Cena con i Rossi", due: giorno, time: "20:00", place: "Da noi" } });
    P.set("p" + (++seq), { ...base, visibility: "private", kind: "draft", summary: "Mail a Marco per l'assemblea", payload: { channel: "email", to: "Marco", subject: "Assemblea del circolo", body: "Ciao Marco,\nti propongo di vederci venerdì alle 21 per preparare l'assemblea.\n\nMattia" } });
    notify();
    return { data: { proposals: 4, modello: scelti.note || "sonnet" } };
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
    if (k.includes(".")) {
      const [a, b] = k.split(".");
      d[a] = { ...(d[a] || {}), [b]: v };
      if (v && v.__delete) delete d[a][b];
      continue;
    }
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
export function queryEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
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
        { uid: "carta-1", conto: "Carta", tipo: "CARD", letti: 6, stati: { "DBIT BOOK": 3, "DBIT PDNG": 2, "CRDT BOOK": 1 }, ultimo: ieri.toISOString().slice(0, 10),
          ultimi: [
            { key: "eb_p1", giorno: ieri.toISOString().slice(0, 10), contabilizzato: null, verso: "DBIT", stato: "PDNG", importo: 58, descrizione: "RISTORANTE DA PINO", esito: "In attesa di contabilizzazione" },
            { key: "eb_prova_3", giorno: ieri.toISOString().slice(0, 10), contabilizzato: ieri.toISOString().slice(0, 10), verso: "DBIT", stato: "BOOK", importo: 24.99, descrizione: "AMAZON EU", esito: "Proposta nuova" },
            { key: "eb_pag", giorno: "2026-10-20", contabilizzato: "2026-10-21", verso: "CRDT", stato: "BOOK", importo: 312.4, descrizione: "PAGAMENTO SALDO", esito: "Entrata: non è una spesa" },
          ] },
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
// Come Firestore sul telefono, la prima consegna di una query arriva un po' dopo (lettura della
// cache, ~60 ms), mai nello stesso istante: così le prove vedono le pagine che compaiono a pezzi.
const PRIMA_CONSEGNA = 60;
function primaVolta(run) { setTimeout(() => { if (listeners.has(run)) run(); }, PRIMA_CONSEGNA); }
export function onSnapshot(q, cb) {
  // Su un singolo documento (es. bank_connections/{uid}): snapshot con exists() e data().
  if (!q.parts && q.coll && q.id) {
    const run = () => { const d = coll(q.coll).get(q.id); cb({ id: q.id, exists: () => !!d, data: () => d }); };
    listeners.add(run); primaVolta(run);
    return () => listeners.delete(run);
  }
  const run = () => {
    const cond = q.parts.find((p) => p.or || p.and || p.f);
    const ord = q.parts.find((p) => p.orderBy);
    let docs = [...coll(q.coll).entries()].filter(([, d]) => matches(d, cond));
    if (ord) docs.sort(([, a], [, b]) => { const x = a[ord.orderBy], y = b[ord.orderBy]; const r = x > y ? 1 : x < y ? -1 : 0; return ord.dir === "desc" ? -r : r; });
    cb({ docs: docs.map(([id, d]) => ({ id, data: () => d })) });
  };
  listeners.add(run); primaVolta(run);
  return () => listeners.delete(run);
}
export function getRedirectResult() { return Promise.resolve(null); }
