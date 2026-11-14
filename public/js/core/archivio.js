// Archivio sul telefono (IndexedDB) per ciò che non deve perdersi se l'app si chiude: oggi le note vocali
// (components/registratore.js), audio e testo trascritto, finché la nota non è salvata. Resta su questo telefono:
// niente va su Firestore. Ogni chiamata ritorna una promessa; se IndexedDB non c'è (finestra anonima, telefono
// senza spazio) le letture danno vuoto e le scritture non fanno nulla, e la registrazione va avanti in memoria.

const NOME = "dd-archivio";
const VERSIONE = 1;
const MAGAZZINI = ["sessioni", "audio"];

let aperto = null;
function apri() {
  if (aperto) return aperto;
  aperto = new Promise((ok, ko) => {
    if (!("indexedDB" in self)) { ko(new Error("IndexedDB assente")); return; }
    const r = indexedDB.open(NOME, VERSIONE);
    r.onupgradeneeded = () => { for (const m of MAGAZZINI) if (!r.result.objectStoreNames.contains(m)) r.result.createObjectStore(m); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
    r.onblocked = () => ko(new Error("IndexedDB bloccato"));
  }).catch((e) => { aperto = null; throw e; });
  return aperto;
}

function giro(magazzino, modo, fn) {
  return apri().then((db) => new Promise((ok, ko) => {
    const t = db.transaction(magazzino, modo);
    const m = t.objectStore(magazzino);
    let esito;
    Promise.resolve(fn(m)).then((v) => { esito = v; });
    t.oncomplete = () => ok(esito);
    t.onerror = () => ko(t.error);
    t.onabort = () => ko(t.error);
  }));
}
const richiesta = (r) => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });

/** Scrive un valore. */
export const metti = (magazzino, chiave, valore) => giro(magazzino, "readwrite", (m) => { m.put(valore, chiave); }).catch(() => {});
/** Legge un valore (o undefined). */
export const prendi = (magazzino, chiave) => giro(magazzino, "readonly", (m) => richiesta(m.get(chiave))).catch(() => undefined);
/** Toglie un valore. */
export const togli = (magazzino, chiave) => giro(magazzino, "readwrite", (m) => { m.delete(chiave); }).catch(() => {});
/** Tutti i valori, o quelli con la chiave che comincia per `prefisso`, in ordine di chiave: [[chiave, valore]]. */
export function tutti(magazzino, prefisso = null) {
  return giro(magazzino, "readonly", (m) => {
    const campo = prefisso == null ? null : IDBKeyRange.bound(prefisso, `${prefisso}￿`);
    return Promise.all([richiesta(m.getAllKeys(campo)), richiesta(m.getAll(campo))]).then(([k, v]) => k.map((c, i) => [c, v[i]]));
  }).catch(() => []);
}
/** Toglie tutti i valori con la chiave che comincia per `prefisso`. */
export const togliTutti = (magazzino, prefisso) => giro(magazzino, "readwrite", (m) => { m.delete(IDBKeyRange.bound(prefisso, `${prefisso}￿`)); }).catch(() => {});
