// Prova delle notifiche senza rete né Firestore: cosa dice src/avvisi.js e a chi, per spese, task,
// lista e banca, con un Firestore finto e l'invio di FCM intercettato.
//   cd functions && node strumenti/prova-avvisi.mjs
import { initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { avvisaDaApp, avvisaBanca } from "../src/avvisi.js";

initializeApp({ projectId: "prova" });
const inviati = [];
getMessaging().sendEachForMulticast = async (m) => {
  inviati.push(m);
  return { successCount: m.tokens.filter((t) => t !== "morto").length, responses: m.tokens.map((t) => (t === "morto" ? { success: false, error: { code: "messaging/registration-token-not-registered" } } : { success: true })) };
};

const ora = Date.now();
const ts = (ms) => ({ toMillis: () => ms });
const dati = {
  users: {
    A: { householdId: "H", dispositivi: { d1: { token: "tA" } } },
    B: { householdId: "H", dispositivi: { d2: { token: "tB" }, d3: { token: "morto" } }, notifiche: {} },
  },
  households: { H: { members: ["A", "B"], memberNames: { A: "Mattia Forni", B: "Giulia Rossi" } } },
  projects: { P: { name: "Casa" } },
  expenses: {
    e1: { householdId: "H", visibility: "shared", description: "Esselunga", amount: 42.1, split: "equal", paidBy: "A" },
    e2: { householdId: "H", visibility: "shared", description: "Pareggio", type: "settlement", amount: 30, split: "full", paidBy: "A" },
    e3: { householdId: "H", visibility: "shared", description: "Affitto", amount: 800, split: "equal", paidBy: "A", source: "recurring" },
    e4: { householdId: "H", visibility: "private", description: "Mia", amount: 5, paidBy: "A" },
    e5: { householdId: "H", visibility: "shared", description: "Regalo", amount: 50, split: "full", paidBy: "B" },
  },
  tasks: {
    t1: { householdId: "H", visibility: "shared", text: "Chiamare l'idraulico", done: false, due: "2026-10-30", projectId: "P" },
    t2: { householdId: "H", visibility: "shared", text: "Bolletta", done: true },
  },
  shopping_items: {
    s1: { householdId: "H", visibility: "shared", text: "Latte", done: false, addedBy: "A", addedAt: ts(ora - 60e3) },
    s2: { householdId: "H", visibility: "shared", text: "Pane", done: false, addedBy: "A", addedAt: ts(ora - 30e3) },
    s3: { householdId: "H", visibility: "shared", text: "Uova", done: false, addedBy: "B", addedAt: ts(ora - 30e3) },
    s4: { householdId: "H", visibility: "shared", text: "Riso", done: false, addedBy: "A", addedAt: ts(ora - 3600e3) },
    s5: { householdId: "H", visibility: "shared", text: "Ceci", done: true, addedBy: "A", addedAt: ts(ora - 10e3) },
  },
};
const aggiornamenti = [];
const ref = (c, id) => ({
  id, path: `${c}/${id}`,
  get: async () => ({ id, exists: !!dati[c]?.[id], data: () => dati[c]?.[id], ref: ref(c, id) }),
  update: async (u) => { aggiornamenti.push([c, id, u]); },
});
const db = {
  collection: (c) => {
    const filtri = [];
    const q = {
      doc: (id) => ref(c, id),
      where: (f, op, v) => { filtri.push([f, v]); return q; },
      get: async () => ({ docs: Object.entries(dati[c] || {}).filter(([, d]) => filtri.every(([f, v]) => d[f] === v)).map(([id, d]) => ({ id, data: () => d })) }),
    };
    return q;
  },
  getAll: (...refs) => Promise.all(refs.map((r) => r.get())),
};

const ultimo = () => inviati.at(-1);
const caso = async (nome, args, atteso) => {
  const prima = inviati.length;
  const r = await avvisaDaApp(db, "A", args);
  const m = inviati.length > prima ? ultimo() : null;
  console.log(`${nome}: inviati=${r.inviati}`, m ? `→ ${m.tokens.join(",")} | ${m.data.titolo} | ${m.data.testo} | ${m.data.url} | tag=${m.data.tag}` : "(niente)");
  if (atteso === null && m) throw new Error(`${nome}: non doveva inviare`);
  if (atteso && (!m || !m.data.testo.includes(atteso))) throw new Error(`${nome}: atteso «${atteso}»`);
};
await caso("spesa a metà", { coll: "expenses", id: "e1", evento: "nuovo" }, "21,05");
await caso("pareggio", { coll: "expenses", id: "e2", evento: "nuovo" }, "Mattia ti ha dato");
await caso("ricorrente", { coll: "expenses", id: "e3", evento: "nuovo" }, null);
await caso("privata", { coll: "expenses", id: "e4", evento: "nuovo" }, null);
await caso("pagata dall'altra", { coll: "expenses", id: "e5", evento: "nuovo" }, "pagata da te");
await caso("task nuovo", { coll: "tasks", id: "t1", evento: "nuovo" }, "Casa · entro il 30 ott");
await caso("task fatto", { coll: "tasks", id: "t2", evento: "fatto" }, "Bolletta");
await caso("task non fatto", { coll: "tasks", id: "t1", evento: "fatto" }, null);
await caso("lista", { coll: "shopping_items", id: "s2", evento: "nuovo" }, "Latte, Pane");
await caso("lista comprata", { coll: "shopping_items", id: "s5", evento: "aggiunto" }, null);
await caso("collezione non prevista", { coll: "journal_entries", id: "x", evento: "nuovo" }, null);
if (ultimo().data.testo.includes("Uova") || ultimo().data.testo.includes("Riso")) throw new Error("lista: solo le aggiunte recenti di chi chiama");
dati.users.B.notifiche = { spese: false };
await caso("spesa con categoria spenta", { coll: "expenses", id: "e1", evento: "nuovo" }, null);
const r = await avvisaDaApp(db, "A", { prova: true });
console.log("prova:", r, ultimo().tokens);
await avvisaBanca(db, [{ uid: "A", created: 3 }, { uid: "B", created: 0, interrotto: true }, { uid: "A", created: 0 }]);
console.log("banca:", inviati.slice(-2).map((m) => `${m.tokens} ${m.data.titolo}: ${m.data.testo}`));
console.log("token morti tolti:", JSON.stringify(aggiornamenti.map(([c, id, u]) => [c, id, Object.keys(u)])));
if (!aggiornamenti.some(([, id, u]) => id === "B" && "dispositivi.d3" in u)) throw new Error("token morto non tolto");
console.log("TUTTO OK");
