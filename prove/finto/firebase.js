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
// Consumi dell'AI come li scrive il server (functions/src/consumi.js): consumi/{uid}_{AAAAMM}.
function consumoFinto(voce, usd) {
  const d = new Date(), id = `${UID}_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const c = coll("consumi").get(id) || { ownerUid: UID, mese: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, voci: {} };
  const servizio = voce === "trascrizione" ? "gemini" : "claude";
  c[servizio] = { usd: (c[servizio]?.usd || 0) + usd, chiamate: (c[servizio]?.chiamate || 0) + 1 };
  c.voci[voce] = { usd: (c.voci[voce]?.usd || 0) + usd, chiamate: (c.voci[voce]?.chiamate || 0) + 1 };
  coll("consumi").set(id, c);
}
window.__finto = { coll, notify: () => notify() }; // per le prove: guardare dentro una collezione (e scriverci, poi notify)
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
    bevanda: false, nutrienti: { kcal: 359, grassi: 2, saturi: 0.5, zuccheri: 3.5, sale: 0, fibre: 3, proteine: 12.5, frutta: null }, novaMarcatori: [], versioneScheda: 2,
    livelli: { fat: "low", "saturated-fat": "low", sugars: "low", salt: "low" }, ambiente: "a", completezza: 0.9, ingredientiNoti: true,
    aggiornatoOff: 1760000000000, indice: 90, fascia: "eccellente", parziale: false, mancano: [], versioneIndice: 2,
    componenti: { nutrizione: { valore: 100, peso: 50, stato: "noto" }, additivi: { valore: 100, peso: 25, stato: "noto" }, nova: { valore: 100, peso: 15, stato: "noto" }, bio: { valore: 0, peso: 10, stato: "noto" } },
  },
  8001234567890: {
    trovato: true, fonte: "off", tipo: "food", nome: "Würstel di pollo", marca: "Marca", quantita: "250 g", descrizione: null,
    categoria: "Würstel", categorie: ["Carni", "Salumi", "Würstel"], immagine: null,
    nutriscore: { grado: "d", punteggio: 14 }, nova: 4,
    additivi: [{ codice: "E250", nome: "Nitrito di sodio", classe: "conservante", rischio: "alto" }, { codice: "E301", nome: "Ascorbato di sodio", classe: "antiossidante", rischio: null }, { codice: "E621", nome: "Glutammato di monosodio", classe: "esaltatore di sapidità", rischio: "alto" }],
    etichette: [], bio: false, bevanda: false, nutrienti: { kcal: 260, grassi: 22, saturi: 8, zuccheri: 1, sale: 2.1, fibre: null, proteine: null, frutta: null },
    novaMarcatori: ["E250 Nitrito di sodio", "E621 Glutammato di monosodio", "aromi"], versioneScheda: 2,
    livelli: { fat: "high", "saturated-fat": "high", sugars: "low", salt: "high" }, ambiente: null, completezza: 0.8, ingredientiNoti: true,
    aggiornatoOff: 1760000000000, indice: 24, fascia: "scarso", parziale: false, mancano: [], versioneIndice: 2,
    componenti: { nutrizione: { valore: 30, peso: 50, stato: "noto" }, additivi: { valore: 20, peso: 25, stato: "noto" }, nova: { valore: 25, peso: 15, stato: "noto" }, bio: { valore: 0, peso: 10, stato: "noto" } },
  },
  // Confettura bio come la Natù del 29/10: frutta 95%, NOVA 4 per la sola pectina.
  8001111111116: {
    trovato: true, fonte: "off", tipo: "food", nome: "Confettura di fragole", marca: "Natù", quantita: "240 g", descrizione: null,
    categoria: "Confetture di fragole", categorie: ["Confetture", "Confetture di fragole"], immagine: null,
    nutriscore: { grado: "a", punteggio: -1 }, nova: 4, additivi: [{ codice: "E440", nome: "Pectina", classe: "gelificante", rischio: null }],
    etichette: ["Biologico"], bio: true, bevanda: false,
    nutrienti: { kcal: 85, grassi: 0.1, saturi: 0, zuccheri: 12.6, sale: 0.08, fibre: 2.6, proteine: 0.5, frutta: 95 }, novaMarcatori: ["E440 Pectina"],
    livelli: {}, ambiente: null, completezza: 0.9, ingredientiNoti: true, aggiornatoOff: 1760000000000, versioneScheda: 2,
    indice: 88, fascia: "eccellente", parziale: false, mancano: [], versioneIndice: 2,
    componenti: { nutrizione: { valore: 100, peso: 50, stato: "noto" }, additivi: { valore: 95, peso: 25, stato: "noto" }, nova: { valore: 25, peso: 15, stato: "noto" }, bio: { valore: 100, peso: 10, stato: "noto" } },
  },
  // Cosmetico (Open Beauty Facts, 31/10 sera): generato da normalizza() del server con una lista INCI di prova.
  3600000000004: {"trovato": true, "nome": "Crema mani alla lavanda", "marca": "Erbe di Casa", "quantita": "75 ml", "descrizione": null, "categoria": "Creme per le mani", "categorie": ["Creme per le mani"], "immagine": null, "etichette": ["Cosmos Organic"], "bio": true, "completezza": 0.7, "versioneScheda": 3, "fonte": "obf", "tipo": "beauty", "ingredienti": [{"nome": "Aqua (Water)", "livello": null, "motivi": []}, {"nome": "Glycerin", "livello": null, "motivi": []}, {"nome": "Cetearyl Alcohol", "livello": null, "motivi": []}, {"nome": "Butyrospermum Parkii (Shea) Butter", "livello": null, "motivi": []}, {"nome": "Parfum (Fragrance)", "livello": null, "motivi": []}, {"nome": "Propylparaben", "livello": "moderato", "motivi": ["Possibile interferente endocrino, priorità alta per la Commissione UE"]}, {"nome": "Methylparaben", "livello": "basso", "motivi": ["Possibile interferente endocrino, priorità bassa per la Commissione UE"]}, {"nome": "Limonene", "livello": "basso", "motivi": ["Allergene delle fragranze, da dichiarare in etichetta"]}, {"nome": "Linalool", "livello": "basso", "motivi": ["Allergene delle fragranze, da dichiarare in etichetta"]}, {"nome": "Lavandula Angustifolia (Lavender) Oil", "livello": "basso", "motivi": ["Allergene delle fragranze, da dichiarare in etichetta"]}, {"nome": "Citrus Limon (Lemon) Peel Oil", "livello": "basso", "motivi": ["Allergene delle fragranze, da dichiarare in etichetta"]}, {"nome": "Benzyl Salicylate", "livello": "moderato", "motivi": ["Possibile interferente endocrino, priorità alta per la Commissione UE", "Allergene delle fragranze, da dichiarare in etichetta"]}], "ingredientiNoti": true, "conteggi": {"alto": 0, "moderato": 2, "basso": 5}, "additivi": [], "nutriscore": {"grado": null, "punteggio": null}, "nova": null, "novaMarcatori": [], "bevanda": false, "nutrienti": {}, "livelli": {}, "indice": 49, "fascia": "mediocre", "componenti": {}, "parziale": false, "mancano": [], "versioneIndice": 2, "aggiornatoOff": 1760000000000},
  // Cracker del 31/10: scheda OFF senza nome né ingredienti, Nutri-Score D (11 punti), indice solo dal Nutri-Score.
  8002222222225: {
    trovato: true, fonte: "off", tipo: "food", nome: null, marca: "Galbusera Belle Buone", quantita: "5 x 40 g", descrizione: null,
    categoria: "Crispbreads", categorie: ["Crispbreads"], immagine: null,
    nutriscore: { grado: "d", punteggio: 11 }, nova: null, additivi: [], etichette: [], bio: false, bevanda: false,
    nutrienti: { kcal: 480, grassi: 21.6, saturi: 2.6, zuccheri: 4, sale: 1.1, fibre: 5.4, proteine: 11.6, frutta: null }, novaMarcatori: [],
    livelli: {}, ambiente: null, completezza: 0.3, ingredientiNoti: false, aggiornatoOff: 1760000000000, versioneScheda: 2,
    indice: 30, fascia: "mediocre", parziale: true, mancano: ["additivi", "nova", "bio"], versioneIndice: 2,
    componenti: { nutrizione: { valore: 30, peso: 50, stato: "noto" }, additivi: { valore: null, peso: 25, stato: "ignoto" }, nova: { valore: null, peso: 15, stato: "ignoto" }, bio: { valore: null, peso: 10, stato: "ignoto" } },
  },
};
// Prodotti aggiunti con «Completa» (funzione `contribuisci` finta): da lì in poi la scheda si trova.
function aggiunte() { try { return JSON.parse(sessionStorage.getItem("finto.off.aggiunte") || "{}"); } catch (e) { return {}; } }

// Funzione `contribuisci` finta: «leggi» restituisce un'etichetta letta (sempre la stessa), «invia» vuole l'account
// (quello sbagliato, «sbagliato», è rifiutato come da OFF), tiene le chiamate per la prova e aggiunge la scheda.
async function contribuisciFinto(data = {}) {
  await new Promise((ok) => setTimeout(ok, 120));
  const chiamate = JSON.parse(sessionStorage.getItem("finto.contributi") || "[]");
  chiamate.push({ azione: data.azione, ean: data.ean, foto: (data.foto || []).map((f) => f.campo), campi: data.campi || null, account: data.account ? data.account.utente : null });
  sessionStorage.setItem("finto.contributi", JSON.stringify(chiamate));
  const conto = sessionStorage.getItem("finto.off.account");
  if (data.azione === "leggi") {
    return { data: {
      letti: { tipo: "food", nome: "Gallette di riso", marca: "Marca Bio", quantita: "130 g", categoria: "Gallette di riso",
        ingredienti: "Riso integrale*, sale. *biologico", linguaIngredienti: "it",
        nutrizione: { per: "100g", kcal: 387, kj: 1638, grassi: 2.8, saturi: 0.6, carboidrati: 81, zuccheri: 0.5, fibre: 3.2, proteine: 8, sale: 0.2 }, nota: null },
      tipo: "food", esiste: false, mancanti: ["nome", "marca", "quantita", "categoria", "ingredienti", "nutrizione"], account: conto ? { utente: conto } : null,
    } };
  }
  if (data.account?.utente === "sbagliato") throw Object.assign(new Error("Open Food Facts non accetta nome utente e password"), { code: "functions/permission-denied" });
  if (!data.account && !conto) throw Object.assign(new Error("Serve l'account di Open Food Facts"), { code: "functions/failed-precondition" });
  if (data.account) sessionStorage.setItem("finto.off.account", data.account.utente);
  const c = data.campi || {};
  const scheda = {
    trovato: true, fonte: "off", tipo: "food", nome: c.nome, marca: c.marca, quantita: c.quantita, categoria: c.categoria, categorie: [c.categoria],
    nutriscore: { grado: "b", punteggio: 1 }, nova: 3, additivi: [], etichette: [], bio: false, bevanda: false,
    nutrienti: { kcal: c.nutrizione?.kcal ?? null, grassi: c.nutrizione?.grassi ?? null, saturi: c.nutrizione?.saturi ?? null, zuccheri: c.nutrizione?.zuccheri ?? null,
      sale: c.nutrizione?.sale ?? null, fibre: c.nutrizione?.fibre ?? null, proteine: c.nutrizione?.proteine ?? null, frutta: null },
    novaMarcatori: ["sale"], livelli: {}, completezza: 0.8, ingredientiNoti: true, aggiornatoOff: Date.now(), versioneScheda: 3,
    indice: 79, fascia: "eccellente", parziale: false, mancano: [], versioneIndice: 2,
    componenti: { nutrizione: { valore: 80, peso: 50, stato: "noto" }, additivi: { valore: 100, peso: 25, stato: "noto" }, nova: { valore: 75, peso: 15, stato: "noto" }, bio: { valore: 0, peso: 10, stato: "noto" } },
  };
  sessionStorage.setItem("finto.off.aggiunte", JSON.stringify({ ...aggiunte(), [data.ean]: scheda }));
  // OFF lento (1/11, come quella volta): la rilettura dopo l'invio dà ancora la scheda di prima; «Rileggi» quella nuova.
  if (sessionStorage.getItem("finto.off.lento")) {
    return { data: { scheda: { trovato: false, fonte: "off", ean: data.ean, letto: Date.now(), inAggiornamento: true }, campi: Object.keys(c), avvisi: [], aggiornata: false } };
  }
  coll("prodotti").set(data.ean, { ...scheda, ean: data.ean, letto: new Date(), lettoDa: UID });
  return { data: { scheda: { ...scheda, ean: data.ean, letto: Date.now() }, campi: Object.keys(c), avvisi: [], aggiornata: true } };
}

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
  // OFF lento dopo un contributo: la rilettura dà ancora la scheda di prima, segnata «in aggiornamento».
  if (sessionStorage.getItem("finto.off.lento") && data.aggiorna) {
    const n = Number(sessionStorage.getItem("finto.off.lento.letture") || 0) + 1;
    sessionStorage.setItem("finto.off.lento.letture", String(n));
    return { data: { trovato: false, fonte: "off", ean, letto: Date.now(), inAggiornamento: true } };
  }
  const scheda = SCHEDE_FINTE[ean] || aggiunte()[ean];
  if (scheda) coll("prodotti").set(ean, { ...scheda, ean, letto: new Date(), lettoDa: UID });
  // Come la function: una scansione entra nella cronologia della casa (scansioni/{casa}_{ean}).
  if (data?.scansione) {
    const hid = coll("users").get(UID)?.householdId || null;
    const S = coll("scansioni"), sid = `${hid || UID}_${ean}`, prima = S.get(sid);
    const r = scheda || { trovato: false };
    S.set(sid, { ...(prima || { ownerUid: UID, householdId: hid, visibility: "shared", createdAt: new Date() }), ean, trovato: !!r.trovato,
      nome: r.nome || null, marca: r.marca || null, quantita: r.quantita || null, categoria: r.categoria || null, indice: r.indice ?? null,
      fascia: r.fascia || null, scansionataAt: new Date(), scansionataDa: UID, volte: (prima?.volte || 0) + 1 });
    notify();
  }
  return { data: scheda ? { ...scheda, ean, letto: Date.now() } : { trovato: false, fonte: "off", ean, letto: Date.now() } };
}

export function httpsCallable(_f, name) {
  if (name === "bank") return bankFinto;
  if (name === "avvisa") return async (data) => ({ data: avvisaFinto(data) });
  if (name === "prodotto") return prodottoFinto;
  if (name === "contribuisci") return contribuisciFinto;
  // Trascrizione finta: segna cosa ha ricevuto (formato, dimensione, progetto) per le asserzioni della prova.
  // Dal 14/11 a pezzi: il primo pezzo dà la frase della lezione, i successivi un seguito numerato. Per le prove:
  // `finto.trascrivi.cade` = quante chiamate perdono la risposta (telefono bloccato, rete), poi riescono;
  // `finto.trascrivi.ritardo` (ms).
  if (name === "trascrivi") return async (data) => {
    await new Promise((r) => setTimeout(r, Number(sessionStorage.getItem("finto.trascrivi.ritardo") || 300)));
    const cade = Number(sessionStorage.getItem("finto.trascrivi.cade") || 0);
    if (cade > 0) {
      sessionStorage.setItem("finto.trascrivi.cade", String(cade - 1));
      const e = new Error("internal"); e.code = "functions/internal"; throw e;
    }
    const viste = JSON.parse(sessionStorage.getItem("finto.trascrizioni") || "[]");
    viste.push({ mimeType: data.mimeType, kb: Math.round((data.audio || "").length * 0.75 / 1024), projectId: data.projectId || null, prima: data.prima || "", pezzo: data.pezzo ?? null });
    sessionStorage.setItem("finto.trascrizioni", JSON.stringify(viste));
    consumoFinto("trascrizione", 0.0004); notify();
    if (data.pezzo) return { data: { testo: `poi il pezzo ${data.pezzo} della dettatura.` } };
    return { data: { testo: "Lezione di oggi con Marco: rovescio a due mani e split step prima della risposta al servizio." } };
  };
  // Chiedi (14/11), come il server (functions/src/chiedi.js): «in corso» con i passi sul documento, poi la risposta con le
  // fonti (la prima nota del diario e la prima spesa che trova). `finto.chiedi.persa` = "1": la risposta si perde (telefono
  // bloccato) ma il documento si completa lo stesso; `finto.chiedi.ritardo` (ms). `finto.chiedi.azioni` = JSON di
  // [{ kind, summary, payload }]: le azioni che il server propone per questo turno (14/11), private e con domandaId e turno.
  if (name === "chiedi") return async (data) => {
    const D = coll("domande");
    const d = D.get(data.id);
    if (!d || d.ownerUid !== UID) { const e = new Error("Domanda non trovata"); e.code = "functions/not-found"; throw e; }
    if (d.stato === "in_corso") return { data: { giaInCorso: true } };
    Object.assign(d, { stato: "in_corso", inizio: new Date(), passi: [] }); notify();
    const ritardo = Number(sessionStorage.getItem("finto.chiedi.ritardo") || 400);
    const persa = sessionStorage.getItem("finto.chiedi.persa") === "1";
    sessionStorage.removeItem("finto.chiedi.persa");
    const lavoro = (async () => {
      await new Promise((r) => setTimeout(r, ritardo / 2));
      d.passi = ["Cerco nelle note: «lezione»"]; notify();
      await new Promise((r) => setTimeout(r, ritardo / 2));
      d.passi = [...d.passi, "Guardo le spese dal 2026-11-01 al 2026-11-30"]; notify();
      await new Promise((r) => setTimeout(r, ritardo / 2));
      const nota = [...coll("journal_entries").entries()].find(([, n]) => /lezione/i.test(n.text || ""));
      const spesa = [...coll("expenses").entries()].find(([, x]) => x.type !== "settlement");
      const fonti = [
        nota && { tipo: "nota", id: nota[0], titolo: nota[1].titolo || "Lezione", sotto: "nota", codice: "n1" },
        spesa && { tipo: "spesa", id: spesa[0], titolo: spesa[1].description, sotto: "spesa", codice: "s1" },
      ].filter(Boolean);
      const n = d.turni.length;
      const risposta = n === 1
        ? "Nell'ultima lezione avete lavorato su **rovescio a due mani** e split step.\n\n- Piedi più larghi sul rovescio\n- Split step prima della risposta al servizio"
        : `Seguito ${n}: sì, la correzione sulla spalla torna anche lì.`;
      const azioni = JSON.parse(sessionStorage.getItem("finto.chiedi.azioni") || "[]");
      sessionStorage.removeItem("finto.chiedi.azioni");
      const hid = coll("users").get(UID)?.householdId || null;
      for (const a of azioni) coll("proposals").set("p" + (++seq), { ownerUid: UID, householdId: hid, visibility: "private", source: "chiedi", status: "pending",
        sourceEntryId: null, domandaId: data.id, turno: n - 1, createdAt: new Date(), ...a });
      d.turni = [...d.turni.slice(0, -1), { ...d.turni[n - 1], risposta: azioni.length ? `${risposta}\n\nTe lo propongo qui sotto.` : risposta, fonti, azioni: azioni.length, modello: "sonnet", at: new Date() }];
      d.stato = "fatta"; notify();
      consumoFinto(d.tipo === "settimana" ? "settimana" : "chiedi", 0.03); notify();
      return { data: { fatta: true } };
    })();
    if (persa) { lavoro.catch(() => {}); const e = new Error("internal"); e.code = "functions/internal"; throw e; }
    return lavoro;
  };
  const esegui = async (data) => {
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
    consumoFinto(progetto?.istruzioni ? "progetti" : "note", progetto?.istruzioni ? 0.042 : 0.006);
    // Titolo e persone, per tutte le note, come il server (agent.js): non se l'utente li ha scritti a mano.
    // Persone: le voci della rubrica il cui nome proprio è nel testo, e i contatti Google finti (non in rubrica).
    if (nota) {
      const testo = String(nota.text || "");
      if (!nota.titoloAMano) nota.titolo = /assemblea/i.test(testo) ? "Assemblea del circolo con Marco" : /smartphone/i.test(testo) ? "Smartphone e adolescenti" : nota.titolo;
      if (!nota.personeAMano) {
        const parola = (n) => new RegExp(`\\b${n.split(" ")[0]}\\b`, "i").test(testo);
        const voci = [...coll("manual_entries").entries()].filter(([, v]) => v.type === "person" && parola(v.name))
          .map(([id, v]) => ({ nome: v.name, voceId: id, ...(v.googleId ? { googleId: v.googleId } : {}) }));
        const google = [{ nome: "Anna Rossetti", googleId: "people/c4", in: /rossetti/i }].filter((c) => c.in.test(testo) && !voci.some((v) => v.googleId === c.googleId))
          .map(({ nome, googleId }) => ({ nome, googleId }));
        nota.persone = [...voci, ...google];
      }
    }
    if (progetto?.istruzioni) {
      // Come il server: una rianalisi sostituisce le proposte ancora in attesa della stessa nota.
      for (const [id, p] of [...P]) if (p.sourceEntryId === data.entryId && p.status === "pending") P.delete(id);
      // Le rubriche nei due modi visti dall'AI: voce con le sottovoci rientrate e riga a sé con i due punti.
      const sintesi = "## Dritto\nStato: migliora\n- Acquisito:\n  - Racchetta che scende\n  - Mano sinistra per la distanza\nIn lavorazione:\n- Chiudere la spalla **prima** del colpo: correzione che torna\n\n## Rovescio a due mani\nStato: da consolidare\n- Piedi più larghi\n\n## Da provare\n- Servizio con il lancio più avanti";
      // Come il server: la sintesi si propone solo se cambia; l'esito resta sulla nota.
      const cambia = (progetto.sintesi || "").trim() !== sintesi;
      nota.sintesiEsito = cambia ? "proposta" : "invariata";
      nota.riepilogo = "## Cosa ho imparato\n- Dritto: **chiudere prima** la spalla\n- Rovescio a due mani: piedi più larghi\n\n## Da ricordare\n- Torna la correzione sulla spalla della settimana scorsa";
      nota.titolo = "Spalla chiusa sul dritto, piedi larghi sul rovescio";
      nota.temi = ["Dritto", "Rovescio a due mani"];
      P.set("p" + (++seq), { ...base, visibility: "private", kind: "task", summary: "Comprare le corde nuove", payload: { text: "Comprare le corde nuove", due: "", project: progetto.name, people: "" } });
      if (cambia) P.set("p" + (++seq), { ...base, visibility: "private", kind: "project_summary", summary: progetto.sintesi ? `Sintesi di ${progetto.name} aggiornata` : `Prima sintesi di ${progetto.name}`,
        payload: { projectId: nota.projectId, projectName: progetto.name, prima: !progetto.sintesi, sintesi } });
      notify();
      return { data: { proposals: cambia ? 2 : 1, riepilogo: true, sintesi: cambia, sintesiEsito: nota.sintesiEsito, modello: scelti.progetti || "opus" } };
    }
    // «Fatto: …» (14/11): come il server con i task aperti, propone di segnare fatto il primo task aperto che la nota nomina.
    if (/^fatto:/i.test(nota?.text || "")) {
      for (const [id, p] of [...P]) if (p.sourceEntryId === data.entryId && p.status === "pending") P.delete(id);
      const parole = String(nota.text).toLowerCase().split(/\W+/).filter((w) => w.length > 4);
      const task = [...coll("tasks").entries()].find(([, t]) => !t.done && parole.some((w) => String(t.text).toLowerCase().includes(w)));
      if (task) P.set("p" + (++seq), { ...base, visibility: task[1].visibility || "private", kind: "task_done", summary: `Segna fatto: ${task[1].text}`,
        payload: { taskId: task[0], text: task[1].text, prima: task[1].due || "" } });
      notify();
      return { data: { proposals: task ? 1 : 0, modello: scelti.note || "sonnet" } };
    }
    // Le quattro azioni solo dalla nota dell'assemblea; le altre note (riflessioni, prove) non ne hanno.
    if (!/assemblea/i.test(nota?.text || "")) {
      for (const [id, p] of [...P]) if (p.sourceEntryId === data.entryId && p.status === "pending") P.delete(id);
      notify();
      return { data: { proposals: 0, titolo: !!nota?.titolo, persone: nota?.persone?.length || 0, modello: scelti.note || "sonnet" } };
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
  if (name !== "analyzeEntry") return esegui;
  // Come il server (functions/index.js, 7/11): «in corso» sulla nota all'inizio, una seconda richiesta intanto non
  // riparte; alla fine la nota letta la scrive il server (fineAnalisi). Per le prove: `finto.analisi.ritardo` (ms) e
  // `finto.analisi.persa` = "1" (la risposta si perde, come col telefono bloccato, ma il server finisce lo stesso).
  return async (data) => {
    const nota = coll("journal_entries").get(data.entryId);
    const inizio = nota?.analisi?.stato === "in_corso" ? new Date(nota.analisi.inizio).getTime() : 0;
    if (inizio && Date.now() - inizio < 330e3) return { data: { giaInCorso: true } };
    if (nota) { nota.analisi = { stato: "in_corso", inizio: new Date(), da: UID }; notify(); }
    const ritardo = Number(sessionStorage.getItem("finto.analisi.ritardo") || 0);
    const persa = sessionStorage.getItem("finto.analisi.persa") === "1";
    sessionStorage.removeItem("finto.analisi.persa");
    const lavoro = (async () => {
      if (ritardo) await new Promise((r) => setTimeout(r, ritardo));
      const r = await esegui(data);
      const n = coll("journal_entries").get(data.entryId);
      if (n) {
        Object.assign(n, { analyzed: true, analyzedAt: new Date(), analysisError: null, modello: r.data?.modello || null, analisi: { stato: "fatta", fine: new Date() } });
        notify();
      }
      return r;
    })();
    if (persa) { const e = new Error("internal"); e.code = "functions/internal"; throw e; }
    return lavoro;
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
  if (cond.f) return cond.op === "in" ? cond.v.includes(d[cond.f]) : d[cond.f] === cond.v;
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
    // Come Firestore (14/11): al più `limit` documenti (il Diario segue le ultime 100 note, la ricerca tutte).
    const lim = q.parts.find((p) => p.limit)?.limit;
    if (lim) docs = docs.slice(0, lim);
    cb({ docs: docs.map(([id, d]) => ({ id, data: () => d })) });
  };
  listeners.add(run); primaVolta(run);
  return () => listeners.delete(run);
}
export function getRedirectResult() { return Promise.resolve(null); }
// Lettura una tantum (db.js → leggiDove): dalla rete, quindi un po' più lenta della cache.
export async function getDocsFromServer(q) { return getDocs(q); }
export async function getDocs(q) {
  await new Promise((r) => setTimeout(r, 120));
  const cond = q.parts.find((p) => p.or || p.and || p.f);
  const docs = [...coll(q.coll).entries()].filter(([, d]) => (q.parts.filter((p) => p.f).length > 1 ? q.parts.filter((p) => p.f).every((c) => matches(d, c)) : matches(d, cond)));
  return { docs: docs.map(([id, d]) => ({ id, data: () => d })) };
}
