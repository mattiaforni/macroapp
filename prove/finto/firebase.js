// Stub in-memory di Firebase per il test del guscio senza rete.
const store = new Map(); // coll -> Map(id -> data)
const listeners = new Set();
let seq = 0;
const UID = "uid-test";

function coll(name) { if (!store.has(name)) store.set(name, new Map()); return store.get(name); }
function notify() { for (const l of listeners) l(); }
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
export function httpsCallable(_f, name) {
  return async (data) => {
    if (name !== "analyzeEntry") return { data: {} };
    const hid = coll("users").get(UID)?.householdId || null;
    const base = { ownerUid: UID, householdId: hid, source: "agent", status: "pending", sourceEntryId: data.entryId, createdAt: new Date() };
    const P = coll("proposals");
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
function matches(d, cond) {
  if (!cond) return true;
  if (cond.or) return cond.or.some((c) => matches(d, c));
  if (cond.and) return cond.and.every((c) => matches(d, c));
  if (cond.f) return d[cond.f] === cond.v;
  return true;
}
export function onSnapshot(q, cb) {
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
