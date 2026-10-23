// "Casa": il contenitore delle aree condivise. Due membri, codice di invito = id del documento.
// memberNames: { uid: "Nome Cognome" } — serve a scrivere "Lucia ti deve…" invece di "l'altra persona".
import {
  doc, getDoc, setDoc, updateDoc, arrayUnion, serverTimestamp, collection,
} from "https://www.gstatic.com/firebasejs/11.3.0/firebase-firestore.js";
import { db } from "./firebase.js";
import { session, refreshProfile } from "./auth.js";
import { nomeProprio } from "./ui.js";

let cache = null; // { id, name, members, memberNames }

function mioNome() {
  return session.profile?.displayName || session.user?.displayName || session.user?.email || "";
}

export async function createHousehold(name = "Casa") {
  const uid = session.user.uid;
  const ref = doc(collection(db, "households"));
  await setDoc(ref, {
    name,
    members: [uid],
    memberNames: { [uid]: mioNome() },
    createdBy: uid,
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, "users", uid), { householdId: ref.id });
  cache = null;
  await refreshProfile();
  return ref.id;
}

export async function joinHousehold(code) {
  const uid = session.user.uid;
  const ref = doc(db, "households", code.trim());
  // Le regole impediscono la lettura ai non membri: ci si aggiunge "alla cieca".
  await updateDoc(ref, { members: arrayUnion(uid), [`memberNames.${uid}`]: mioNome() });
  await updateDoc(doc(db, "users", uid), { householdId: ref.id });
  cache = null;
  await refreshProfile();
}

export async function getHousehold({ fresh = false } = {}) {
  if (!session.householdId) return null;
  if (cache && !fresh && cache.id === session.householdId) return cache;
  const snap = await getDoc(doc(db, "households", session.householdId));
  cache = snap.exists() ? { id: snap.id, ...snap.data() } : null;
  return cache;
}

/** Al primo avvio dopo l'aggiornamento: scrive il proprio nome nella casa, se manca. */
export async function ensureMyName() {
  const h = await getHousehold();
  const uid = session.user.uid;
  if (!h || h.memberNames?.[uid]) return;
  await updateDoc(doc(db, "households", h.id), { [`memberNames.${uid}`]: mioNome() });
  cache = null;
}

/** L'altra persona della casa: { uid, nome } (nome proprio), o un segnaposto se non c'è ancora. */
export async function altraPersona() {
  const h = await getHousehold();
  const me = session.user.uid;
  const uid = h?.members?.find((m) => m !== me) || null;
  const nome = uid ? nomeProprio(h.memberNames?.[uid]) : "";
  return { uid, nome: nome || "l'altra persona" };
}

export function nomeDi(uid, h) {
  if (uid === session.user.uid) return "tu";
  return nomeProprio(h?.memberNames?.[uid]) || "l'altra persona";
}

/** Aggiorna campi della casa (i membri possono modificarla). */
export async function updateHousehold(data) {
  if (!session.householdId) return;
  await updateDoc(doc(db, "households", session.householdId), data);
  cache = null;
}
