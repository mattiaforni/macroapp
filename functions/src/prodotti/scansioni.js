// Cronologia dei prodotti scansionati (29/10, richiesta di Mattia: «un orologino in alto a destra» nella Lista).
// Un documento per prodotto e per casa, `scansioni/{casa}_{ean}`, scritto solo da qui (function `prodotto`, quando
// l'app chiama con `scansione: true`): una nuova scansione dello stesso prodotto aggiorna data e riassunto.
// Condiviso nella casa come la Lista. Le scansioni precedenti a questa cronologia l'app le ricava dalla cache
// `prodotti` (campo `lettoDa`).
import { FieldValue } from "firebase-admin/firestore";

/** Il riassunto della scheda che serve alla cronologia (niente nutrienti né additivi: si rilegge la scheda). */
export function riassuntoScansione(scheda = {}) {
  return {
    trovato: !!scheda.trovato,
    nome: scheda.nome || null,
    marca: scheda.marca || null,
    quantita: scheda.quantita || null,
    categoria: scheda.categoria || null,
    indice: scheda.indice ?? null,
    fascia: scheda.fascia || null,
    v: scheda.versioneIndice || 1,
  };
}

export async function registraScansione(db, uid, ean, scheda) {
  const utente = await db.collection("users").doc(uid).get();
  const householdId = utente.exists ? utente.data().householdId || null : null;
  const ref = db.collection("scansioni").doc(`${householdId || uid}_${ean}`);
  const prima = await ref.get();
  await ref.set({
    ...(prima.exists ? {} : { ownerUid: uid, householdId, visibility: householdId ? "shared" : "private", createdAt: FieldValue.serverTimestamp() }),
    ean,
    ...riassuntoScansione(scheda),
    scansionataAt: FieldValue.serverTimestamp(),
    scansionataDa: uid,
    volte: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}
