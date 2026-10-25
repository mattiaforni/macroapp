// Strato dati unico per tutti i moduli.
//
// Modello di visibilità: ogni documento delle collezioni "di contenuto" ha
//   ownerUid      chi l'ha creato
//   householdId   la casa a cui appartiene (anche per i documenti personali, per comodità di query)
//   visibility    "shared" | "private"
//
// "Separato" significa nascosto nell'interfaccia, non inaccessibile al gestore del progetto Firebase.
// Le regole in firestore.rules fanno rispettare lo stesso modello lato server.
//
// Le scritture non aspettano il server: con la cache offline l'app risponde subito anche senza rete.

import {
  collection, doc, addDoc, setDoc, getDoc, updateDoc, deleteDoc, query, where, or, and, orderBy,
  onSnapshot, serverTimestamp, limit as qLimit,
} from "https://www.gstatic.com/firebasejs/11.3.0/firebase-firestore.js";
import { db } from "./firebase.js";
import { session } from "./auth.js";
import { segnala } from "./notifiche.js";

export const VIS = { SHARED: "shared", PRIVATE: "private" };

// Notifiche: scritture condivise che l'altra persona può voler sapere. Qui si fa solo una prima
// scelta; cosa dire, a chi e se dirlo lo decide la funzione `avvisa` rileggendo il documento.
const AVVISI_NUOVI = new Set(["expenses", "tasks", "shopping_items"]);
function eventoModifica(coll, data) {
  if (coll === "tasks" && data.done === true) return "fatto";
  if (coll === "shopping_items" && data.done === false && data.addedAt) return "aggiunto"; // rimessa in lista, non «Annulla»
  return null;
}

function base(visibility) {
  return {
    ownerUid: session.user.uid,
    householdId: session.householdId,
    visibility,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

/**
 * Crea un documento con i campi di base già compilati.
 * Ritorna subito { id, saved }: `saved` è la promessa della scrittura sul server,
 * da aspettare solo quando serve davvero (es. prima di chiamare una funzione che lo legge).
 */
export function create(coll, data, visibility = VIS.SHARED) {
  const ref = doc(collection(db, coll));
  const saved = setDoc(ref, { ...base(visibility), ...data });
  saved.catch((e) => console.error(`create(${coll})`, e));
  if (visibility === VIS.SHARED && AVVISI_NUOVI.has(coll)) saved.then(() => segnala(coll, ref.id, "nuovo"), () => {});
  return { id: ref.id, saved };
}

/** Come create, ma con un id scelto (serve a non duplicare: spese ricorrenti, movimenti bancari). */
export async function createWithId(coll, id, data, visibility = VIS.SHARED) {
  const ref = doc(db, coll, id);
  const snap = await getDoc(ref).catch(() => null);
  if (snap?.exists()) return false;
  await setDoc(ref, { ...base(visibility), ...data });
  return true;
}

export function update(coll, id, data) {
  const evento = eventoModifica(coll, data);
  return updateDoc(doc(db, coll, id), { ...data, updatedAt: serverTimestamp() })
    .then(() => { if (evento) segnala(coll, id, evento); })
    .catch((e) => console.error(`update(${coll})`, e));
}

export function remove(coll, id) {
  return deleteDoc(doc(db, coll, id)).catch((e) => console.error(`remove(${coll})`, e));
}

function visibleCondition() {
  const uid = session.user.uid;
  const hid = session.householdId;
  return hid
    ? or(
        and(where("householdId", "==", hid), where("visibility", "==", VIS.SHARED)),
        where("ownerUid", "==", uid),
      )
    : where("ownerUid", "==", uid);
}

/**
 * Sottoscrizione in tempo reale a ciò che l'utente può vedere in una collezione:
 * i documenti condivisi della casa + i propri documenti personali.
 * `extra` sono vincoli aggiuntivi (where), `order` è [campo, direzione].
 * Gli ordinamenti fini si fanno nel modulo: ogni ordinamento qui richiede un indice.
 */
export function watchVisible(coll, { extra = [], order = ["createdAt", "desc"], max = 500 } = {}, cb) {
  const q = query(collection(db, coll), and(visibleCondition(), ...extra), orderBy(order[0], order[1]), qLimit(max));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (err) => console.error(`watchVisible(${coll})`, err));
}

/** Sottoscrizione ai soli documenti personali dell'utente (es. diario). */
export function watchMine(coll, { extra = [], order = ["createdAt", "desc"], max = 500 } = {}, cb) {
  const q = query(
    collection(db, coll),
    and(where("ownerUid", "==", session.user.uid), ...extra),
    orderBy(order[0], order[1]),
    qLimit(max),
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (err) => console.error(`watchMine(${coll})`, err));
}

/** Lettura una tantum di ciò che è visibile (stessa condizione di watchVisible). */
export function readVisible(coll, opts = {}) {
  return new Promise((resolve) => {
    let done = false;
    const stop = watchVisible(coll, opts, (docs) => {
      if (done) return;
      done = true;
      resolve(docs);
      setTimeout(() => stop && stop(), 0);
    });
  });
}

export { where, serverTimestamp };
