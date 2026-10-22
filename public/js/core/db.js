// Strato dati unico per tutti i moduli.
//
// Modello di visibilità: ogni documento delle collezioni "di contenuto" ha
//   ownerUid      chi l'ha creato
//   householdId   la casa a cui appartiene (anche per i documenti personali, per comodità di query)
//   visibility    "shared" | "private"
//
// "Separato" significa nascosto nell'interfaccia, non inaccessibile al gestore del progetto Firebase.
// Le regole in firestore.rules fanno rispettare lo stesso modello lato server.

import {
  collection, doc, addDoc, updateDoc, deleteDoc, query, where, or, and, orderBy,
  onSnapshot, serverTimestamp, limit as qLimit,
} from "https://www.gstatic.com/firebasejs/11.3.0/firebase-firestore.js";
import { db } from "./firebase.js";
import { session } from "./auth.js";

export const VIS = { SHARED: "shared", PRIVATE: "private" };

function base(visibility) {
  return {
    ownerUid: session.user.uid,
    householdId: session.householdId,
    visibility,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

/** Crea un documento con i campi di base già compilati. */
export function create(coll, data, visibility = VIS.SHARED) {
  return addDoc(collection(db, coll), { ...base(visibility), ...data });
}

export function update(coll, id, data) {
  return updateDoc(doc(db, coll, id), { ...data, updatedAt: serverTimestamp() });
}

export function remove(coll, id) {
  return deleteDoc(doc(db, coll, id));
}

/**
 * Sottoscrizione in tempo reale a ciò che l'utente può vedere in una collezione:
 * i documenti condivisi della casa + i propri documenti personali.
 * `extra` sono vincoli aggiuntivi (where), `order` è [campo, direzione].
 */
export function watchVisible(coll, { extra = [], order = ["createdAt", "desc"], max = 500 } = {}, cb) {
  const uid = session.user.uid;
  const hid = session.householdId;
  const visible = hid
    ? or(
        and(where("householdId", "==", hid), where("visibility", "==", VIS.SHARED)),
        where("ownerUid", "==", uid),
      )
    : where("ownerUid", "==", uid);

  const q = query(
    collection(db, coll),
    and(visible, ...extra),
    orderBy(order[0], order[1]),
    qLimit(max),
  );
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

export { where, serverTimestamp };
