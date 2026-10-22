// "Casa": il contenitore delle aree condivise. Due membri, codice di invito = id del documento.
import {
  doc, getDoc, setDoc, updateDoc, arrayUnion, serverTimestamp, collection,
} from "https://www.gstatic.com/firebasejs/11.3.0/firebase-firestore.js";
import { db } from "./firebase.js";
import { session, refreshProfile } from "./auth.js";

export async function createHousehold(name = "Casa") {
  const uid = session.user.uid;
  const ref = doc(collection(db, "households"));
  await setDoc(ref, {
    name,
    members: [uid],
    createdBy: uid,
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, "users", uid), { householdId: ref.id });
  await refreshProfile();
  return ref.id;
}

export async function joinHousehold(code) {
  const uid = session.user.uid;
  const ref = doc(db, "households", code.trim());
  const snap = await getDoc(ref).catch(() => null);
  // Le regole impediscono la lettura ai non membri: la join va fatta "alla cieca".
  await updateDoc(ref, { members: arrayUnion(uid) });
  await updateDoc(doc(db, "users", uid), { householdId: ref.id });
  await refreshProfile();
  return snap?.data() || null;
}

export async function getHousehold() {
  if (!session.householdId) return null;
  const snap = await getDoc(doc(db, "households", session.householdId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
