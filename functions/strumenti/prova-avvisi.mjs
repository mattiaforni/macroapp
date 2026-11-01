// Prova delle notifiche senza rete né Firestore: cosa dicono src/avvisi.js e src/avvisi-calendario.js e a chi
// (spese, task, lista, banca, fine analisi, notte; eventi nuovi, promemoria e riepilogo del mattino), con un
// Firestore finto, Google Calendar finto (fetch intercettato) e l'invio di FCM intercettato.
//   cd functions && node strumenti/prova-avvisi.mjs
import { initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { avvisaDaApp, avvisaBanca, fineAnalisi, notturna } from "../src/avvisi.js";
import { giroAvvisi, mezzanotte, traQuanto } from "../src/avvisi-calendario.js";

initializeApp({ projectId: "prova" });
const inviati = [];
getMessaging().sendEach = async (msgs) => {
  inviati.push({ tokens: msgs.map((m) => m.token), data: msgs[0].data, ttl: msgs[0].webpush?.headers?.TTL });
  return { successCount: msgs.filter((m) => m.token !== "morto").length, responses: msgs.map((m) => (m.token === "morto" ? { success: false, error: { code: "messaging/registration-token-not-registered" } } : { success: true })) };
};
const controlla = (ok, msg) => { if (!ok) throw new Error(msg); };

const ora = Date.now();
const ts = (ms) => ({ toMillis: () => ms });
const dati = {
  users: {
    A: { householdId: "H", dispositivi: { d1: { token: "tA" } }, google: { collegato: true, email: "mattia@esempio.it", permessi: { calendario: true } } },
    B: { householdId: "H", dispositivi: { d2: { token: "tB" }, d3: { token: "morto" } }, notifiche: {},
      google: { collegato: true, email: "Giulia@esempio.it", permessi: { calendario: true } }, calendari: [{ id: "band@g", nome: "Band" }] },
  },
  households: { H: { members: ["A", "B"], memberNames: { A: "Mattia Forni", B: "Giulia Rossi" }, calendario: { id: "casa@g", nome: "Casa" } } },
  projects: { P: { name: "Casa" } },
  expenses: {
    e1: { householdId: "H", visibility: "shared", description: "Esselunga", amount: 42.1, split: "equal", paidBy: "A", date: ts(Date.parse("2026-11-01T12:00:00+01:00")) },
    e2: { householdId: "H", visibility: "shared", description: "Pareggio", type: "settlement", amount: 30, split: "full", paidBy: "A" },
    e3: { householdId: "H", visibility: "shared", description: "Affitto", amount: 800, split: "equal", paidBy: "A", source: "recurring" },
    e4: { householdId: "H", visibility: "private", description: "Mia", amount: 5, paidBy: "A" },
    e5: { householdId: "H", visibility: "shared", description: "Regalo", amount: 50, split: "full", paidBy: "B" },
  },
  tasks: {
    t1: { householdId: "H", visibility: "shared", text: "Chiamare l'idraulico", done: false, due: "2026-10-30", projectId: "P" },
    t2: { householdId: "H", visibility: "shared", text: "Bolletta", done: true },
    t3: { householdId: "H", visibility: "shared", text: "Pagare la TARI", done: false, due: "2026-11-03" },
    t4: { householdId: "H", visibility: "private", ownerUid: "B", text: "Regalo per Anna", done: false, due: "2026-11-03" },
  },
  shopping_items: {
    s1: { householdId: "H", visibility: "shared", text: "Latte", done: false, addedBy: "A", addedAt: ts(ora - 60e3) },
    s2: { householdId: "H", visibility: "shared", text: "Pane", done: false, addedBy: "A", addedAt: ts(ora - 30e3) },
    s3: { householdId: "H", visibility: "shared", text: "Uova", done: false, addedBy: "B", addedAt: ts(ora - 30e3) },
    s4: { householdId: "H", visibility: "shared", text: "Riso", done: false, addedBy: "A", addedAt: ts(ora - 3600e3) },
    s5: { householdId: "H", visibility: "shared", text: "Ceci", done: true, addedBy: "A", addedAt: ts(ora - 10e3) },
  },
  journal_entries: {
    n1: { ownerUid: "A", titolo: "Lezione: rovescio", avvisaAFine: true },
    n2: { ownerUid: "A", titolo: "Spesa al mercato" },
    n3: { ownerUid: "B", titolo: "Di Giulia", avvisaAFine: true },
  },
  bank_connections: { A: { active: true, consentExpiresAt: ts(Date.parse("2026-11-13T07:00:00+01:00")) } },
  proposals: {
    p1: { ownerUid: "A", status: "pending", source: "bank" },
    p2: { ownerUid: "A", status: "pending", source: "bank" },
    p3: { ownerUid: "A", status: "pending", source: "agent" },
    p4: { ownerUid: "A", status: "done", source: "bank" },
  },
  avvisi_stato: {},
};
const aggiornamenti = [];
const ref = (c, id) => ({
  id, path: `${c}/${id}`,
  get: async () => ({ id, exists: !!dati[c]?.[id], data: () => dati[c]?.[id], ref: ref(c, id) }),
  update: async (u) => {
    aggiornamenti.push([c, id, u]);
    if (!dati[c]?.[id]) throw new Error(`NOT_FOUND ${c}/${id}`);
    for (const [k, v] of Object.entries(u)) {
      if (k.includes(".")) continue; // percorsi annidati (token morti): basta registrarli
      if (v?.constructor?.name === "DeleteTransform" || String(v?.methodName || "").includes("delete")) delete dati[c][id][k];
      else dati[c][id][k] = v;
    }
  },
  set: async (v, o) => { dati[c] ||= {}; dati[c][id] = o?.merge || o?.mergeFields ? { ...(dati[c][id] || {}), ...v } : v; },
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
  runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, v, o) => r.set(v, o) }),
};

const ultimo = () => inviati.at(-1);
const mostra = (m) => `→ ${m.tokens.join(",")} | ${m.data.titolo} | ${m.data.testo.replace(/\n/g, " / ")} | ${m.data.url} | tag=${m.data.tag}${m.data.silenzioso ? " | silenziosa" : ""}`;
const caso = async (nome, args, atteso, uid = "A") => {
  const prima = inviati.length;
  const r = await avvisaDaApp(db, uid, args);
  const m = inviati.length > prima ? ultimo() : null;
  console.log(`${nome}: inviati=${r.inviati}`, m ? mostra(m) : "(niente)");
  if (atteso === null && m) throw new Error(`${nome}: non doveva inviare`);
  if (atteso && (!m || !m.data.testo.replace(/\u00a0/g, " ").includes(atteso))) throw new Error(`${nome}: atteso «${atteso}»`);
  return m;
};

console.log("── dall'app ──");
await caso("spesa a metà", { coll: "expenses", id: "e1", evento: "nuovo" }, "21,05");
await caso("pareggio", { coll: "expenses", id: "e2", evento: "nuovo" }, "Mattia ti ha dato");
await caso("ricorrente", { coll: "expenses", id: "e3", evento: "nuovo" }, null);
await caso("privata", { coll: "expenses", id: "e4", evento: "nuovo" }, null);
await caso("pagata dall'altra", { coll: "expenses", id: "e5", evento: "nuovo" }, "pagata da te");
await caso("spesa modificata: importo", { coll: "expenses", id: "e1", evento: "modificata", prima: { description: "Esselunga", amount: 40, split: "equal", paidBy: "A", date: "2026-11-01" } }, "42,10 € (era 40,00 €)");
await caso("spesa modificata: nome e data", { coll: "expenses", id: "e1", evento: "modificata", prima: { description: "Coop", amount: 42.1, split: "equal", paidBy: "A", date: "2026-10-30" } }, "Esselunga (era «Coop»)");
controlla(ultimo().data.testo.includes("data 1 nov"), "data cambiata nel testo");
await caso("spesa salvata senza cambi", { coll: "expenses", id: "e1", evento: "modificata", prima: { description: "Esselunga", amount: 42.1, split: "equal", paidBy: "A", date: "2026-11-01" } }, null);
await caso("ricorrente modificata", { coll: "expenses", id: "e3", evento: "modificata", prima: { description: "Affitto", amount: 750, split: "equal", paidBy: "A" } }, "(era 750,00 €)");
await caso("spesa eliminata", { coll: "expenses", id: "e9", evento: "eliminata", copia: { description: "Pizza", amount: 24, visibility: "shared" } }, "Pizza · 24,00 €");
controlla(ultimo().data.titolo === "Mattia ha eliminato una spesa", "titolo dell'eliminazione");
await caso("eliminata ma esiste ancora", { coll: "expenses", id: "e1", evento: "eliminata", copia: { description: "Finta", amount: 1, visibility: "shared" } }, null);
await caso("eliminata privata", { coll: "expenses", id: "e8", evento: "eliminata", copia: { description: "Mia", amount: 3, visibility: "private" } }, null);
await caso("eliminato un task (non previsto)", { coll: "tasks", id: "t9", evento: "eliminata", copia: { amount: 1, visibility: "shared" } }, null);
await caso("task nuovo", { coll: "tasks", id: "t1", evento: "nuovo" }, "Casa · entro il 30 ott");
await caso("task fatto", { coll: "tasks", id: "t2", evento: "fatto" }, "Bolletta");
await caso("task non fatto", { coll: "tasks", id: "t1", evento: "fatto" }, null);
await caso("lista", { coll: "shopping_items", id: "s2", evento: "nuovo" }, "Latte, Pane");
if (ultimo().data.testo.includes("Uova") || ultimo().data.testo.includes("Riso")) throw new Error("lista: solo le aggiunte recenti di chi chiama");
await caso("lista comprata", { coll: "shopping_items", id: "s5", evento: "aggiunto" }, null);
await caso("collezione non prevista", { coll: "journal_entries", id: "x", evento: "nuovo" }, null);
dati.users.B.notifiche = { spese: false };
await caso("spesa con categoria spenta", { coll: "expenses", id: "e1", evento: "nuovo" }, null);
dati.users.B.notifiche = {};
const r = await avvisaDaApp(db, "A", { prova: true });
console.log("prova:", r, ultimo().tokens, ultimo().data.testo);
controlla(ultimo().tokens.join() === "tA", "la prova va solo a chi la chiede");

console.log("── banca (syncBank) ──");
let n0 = inviati.length;
await avvisaBanca(db, [{ uid: "A", created: 3 }, { uid: "B", created: 0, interrotto: true }]);
controlla(inviati.length === n0, "con il riepilogo acceso la banca aspetta le 7:30");
dati.users.A.notifiche = { riepilogo: false };
await avvisaBanca(db, [{ uid: "A", created: 3 }, { uid: "A", created: 0 }]);
controlla(inviati.length === n0 + 1 && ultimo().data.testo === "3 spese da confermare", "senza riepilogo la banca avvisa subito");
console.log("banca:", mostra(ultimo()));
dati.users.A.notifiche = {};

console.log("── fine analisi ──");
n0 = inviati.length;
await fineAnalisi(db, "A", "n1", { azioni: 2, riepilogo: true, sintesiEsito: "invariata", modello: "opus" });
console.log("app in secondo piano:", mostra(ultimo()));
controlla(inviati.length === n0 + 1 && ultimo().data.titolo === "Lezione: rovescio" && ultimo().data.testo === "Analisi pronta: 2 proposte da confermare · sintesi del progetto invariata" && ultimo().tokens.join() === "tA", "avviso a fine analisi");
controlla(dati.journal_entries.n1.analyzed === true && dati.journal_entries.n1.modello === "opus" && !("avvisaAFine" in dati.journal_entries.n1), "nota segnata come letta, segno tolto");
await fineAnalisi(db, "A", "n2", { azioni: 0 });
controlla(inviati.length === n0 + 1 && dati.journal_entries.n2.analyzed === true, "app aperta: niente notifica, nota segnata");
await fineAnalisi(db, "A", "n3", { azioni: 1 });
controlla(inviati.length === n0 + 1 && !dati.journal_entries.n3.analyzed, "nota di un'altra persona: niente");
dati.journal_entries.n2.avvisaAFine = true;
await fineAnalisi(db, "A", "n2", { errore: "AI occupata in questo momento: riprova tra poco" });
console.log("errore:", mostra(ultimo()));
controlla(ultimo().data.titolo === "Spesa al mercato" && /non riuscita/.test(ultimo().data.testo), "errore a fine analisi");
await fineAnalisi(db, "A", "nx", { azioni: 1 }); // nota eliminata nel frattempo: niente, nessun errore

console.log("── notte ──");
controlla(notturna(new Date("2026-11-02T23:10:00+01:00")) && notturna(new Date("2026-11-02T07:29:00+01:00")) && !notturna(new Date("2026-11-02T07:30:00+01:00")) && !notturna(new Date("2026-07-02T22:29:00+02:00")), "fascia 22:30–7:30, anche con l'ora legale");
const { invia } = await import("../src/avvisi.js");
await invia(db, ["B"], "spese", { titolo: "x", testo: "y" }, new Date("2026-11-02T23:10:00+01:00"));
controlla(ultimo().data.silenzioso === "1", "di notte senza suono");
dati.users.B.notifiche = { silenzio: false };
await invia(db, ["B"], "spese", { titolo: "x", testo: "y" }, new Date("2026-11-02T23:10:00+01:00"));
controlla(!ultimo().data.silenzioso, "silenzio spento: suona");
dati.users.B.notifiche = {};
console.log("ok: notte silenziosa, salvo chi l'ha spenta");

// ───────────── Calendario: Google finto ─────────────
const rm = (min) => `2026-11-02T${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00+01:00`; // lunedì 2 novembre, ora di Roma
const EVENTI = {
  "casa@g": [
    { id: "ev1", summary: "Cena da Luca", location: "Via Roma 3", created: rm(18 * 60 + 57), updated: rm(18 * 60 + 57), creator: { email: "giulia@esempio.it" },
      start: { dateTime: "2026-11-07T20:00:00+01:00" }, end: { dateTime: "2026-11-07T22:00:00+01:00" }, reminders: { useDefault: true } },
    { id: "ev2", summary: "Dentista", created: rm(18 * 60 + 58), updated: rm(18 * 60 + 58), creator: { email: "mattia@esempio.it" },
      start: { dateTime: rm(19 * 60 + 45) }, end: { dateTime: rm(20 * 60 + 30) }, reminders: { useDefault: true } },
    { id: "ev3", summary: "Palestra", created: "2026-10-20T10:00:00+02:00", updated: rm(18 * 60 + 59), creator: { email: "giulia@esempio.it" },
      start: { dateTime: rm(19 * 60 + 30) }, end: { dateTime: rm(20 * 60 + 30) }, reminders: { useDefault: true } },
    { id: "ev5", summary: "Idraulico", created: "2026-10-25T10:00:00+01:00", updated: "2026-10-25T10:00:00+01:00", creator: { email: "mattia@esempio.it" },
      start: { dateTime: rm(19 * 60 + 50) }, end: { dateTime: rm(20 * 60 + 30) }, reminders: { useDefault: false } },
    { id: "ev6", summary: "Compleanno Anna", created: "2026-10-01T10:00:00+02:00", updated: "2026-10-01T10:00:00+02:00", creator: { email: "giulia@esempio.it" },
      start: { date: "2026-11-03" }, end: { date: "2026-11-04" }, reminders: { useDefault: true } },
    { id: "ev7", summary: "Riunione condominio", created: "2026-10-01T10:00:00+02:00", updated: "2026-10-01T10:00:00+02:00", creator: { email: "mattia@esempio.it" },
      start: { dateTime: "2026-11-03T10:00:00+01:00" }, end: { dateTime: "2026-11-03T11:00:00+01:00" }, reminders: { useDefault: true } },
    { id: "ev8", summary: "Rifiutato", created: "2026-10-01T10:00:00+02:00", updated: "2026-10-01T10:00:00+02:00", creator: { email: "x@esempio.it" },
      start: { dateTime: "2026-11-03T12:00:00+01:00" }, end: { dateTime: "2026-11-03T13:00:00+01:00" }, attendees: [{ email: "mattia@esempio.it", self: true, responseStatus: "declined" }], reminders: { useDefault: false } },
  ],
  "band@g": [
    { id: "ev4", summary: "Prove", created: "2026-10-01T10:00:00+02:00", updated: "2026-10-01T10:00:00+02:00", creator: { email: "batterista@esempio.it" },
      start: { dateTime: rm(20 * 60 + 30) }, end: { dateTime: rm(22 * 60 + 30) }, reminders: { useDefault: false, overrides: [{ method: "email", minutes: 60 }] } },
    { id: "ev10", summary: "Concerto", created: "2026-10-01T10:00:00+02:00", updated: "2026-10-01T10:00:00+02:00", creator: { email: "batterista@esempio.it" },
      start: { dateTime: rm(20 * 60) }, end: { dateTime: rm(23 * 60) }, reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] } },
  ],
};
// Promemoria predefiniti di Google: Mattia ha un avviso a comparsa sul calendario della casa, Giulia nessuno.
const LISTE = { tokA: [{ id: "casa@g", defaultReminders: [{ method: "popup", minutes: 30 }] }], tokB: [{ id: "casa@g", defaultReminders: [] }, { id: "band@g", defaultReminders: [] }] };
const chiamateGoogle = [];
const msDi = (x) => (x.dateTime ? Date.parse(x.dateTime) : Date.parse(`${x.date}T00:00:00+01:00`));
globalThis.fetch = async (u, opz = {}) => {
  const url = new URL(u);
  const token = String(opz.headers?.Authorization || "").replace(/^Bearer /, "");
  chiamateGoogle.push(url.pathname + url.search);
  const lista = /\/calendarList$/.test(url.pathname);
  const m = /\/calendars\/([^/]+)\/events$/.exec(url.pathname);
  const json = (j) => ({ ok: true, status: 200, json: async () => j });
  if (lista) return json({ items: LISTE[token] || [] });
  if (!m) return { ok: false, status: 404, json: async () => ({}) };
  const cal = decodeURIComponent(m[1]);
  let items = (EVENTI[cal] || []).filter((e) => Date.parse(e.created) <= adesso); // quelli che a quell'ora esistevano
  const p = url.searchParams;
  if (p.get("updatedMin")) items = items.filter((e) => Date.parse(e.updated) >= Date.parse(p.get("updatedMin")));
  if (p.get("timeMin")) items = items.filter((e) => msDi(e.end) > Date.parse(p.get("timeMin")) && msDi(e.start) < Date.parse(p.get("timeMax")));
  return json({ items });
};
const tokenFinto = async (db_, uid) => ({ accessToken: `tok${uid}`, permessi: { calendario: true } });
let adesso = 0;
const giro = async (quando, opz = {}) => {
  const prima = inviati.length;
  adesso = Date.parse(quando);
  await giroAvvisi(db, { id: "c", secret: "s" }, { ora: new Date(quando), tokenServer: opz.tokenServer || tokenFinto });
  const nuovi = inviati.slice(prima);
  console.log(`giro ${quando}: ${nuovi.length} notifiche`);
  for (const m of nuovi) console.log("  ", mostra(m));
  return nuovi;
};

console.log("── calendario ──");
controlla(mezzanotte("2026-11-03").toISOString() === "2026-11-02T23:00:00.000Z" && mezzanotte("2026-07-03").toISOString() === "2026-07-02T22:00:00.000Z" && mezzanotte("2026-10-25").toISOString() === "2026-10-24T22:00:00.000Z", "mezzanotte di Roma, anche al cambio d'ora");
controlla(traQuanto(60 * 60e3) === "tra 1 ora" && traQuanto(25 * 60e3) === "tra 25 minuti" && traQuanto(90 * 60e3) === "tra 1 ora e 30", "tra quanto");
dati.users.B.notifiche = { anticipo: 120 };
let g = await giro(rm(17 * 60));
controlla(g.length === 0 && dati.avvisi_stato.H?.ultimoGiro, "primo giro: si segna da quando guardare, niente annunci né promemoria lontani");
g = await giro(rm(19 * 60));
const perA = g.filter((m) => m.tokens.includes("tA")), perB = g.filter((m) => m.tokens.includes("tB"));
controlla(perA.some((m) => m.data.titolo === "Giulia ha aggiunto un evento" && m.data.testo === "Cena da Luca · sab 7 nov, 20:00 · Via Roma 3"), "evento di Giulia annunciato a Mattia");
controlla(perB.some((m) => m.data.titolo === "Mattia ha aggiunto un evento" && m.data.testo === "Dentista · oggi alle 19:45"), "evento di Mattia annunciato a Giulia");
controlla(!g.some((m) => /Palestra/.test(m.data.testo) && /aggiunto/.test(m.data.titolo)), "un evento solo modificato non si annuncia");
controlla(!perA.some((m) => /aggiunto/.test(m.data.titolo) && /Dentista/.test(m.data.testo)), "mai a chi l'ha creato");
controlla(perA.filter((m) => m.data.tag.startsWith("promemoria")).map((m) => m.data.titolo).join() === "Idraulico", "Mattia: solo l'evento per cui Google non lo avvisa già");
controlla(perA.find((m) => m.data.titolo === "Idraulico").data.testo === "tra 50 minuti, alle 19:50", "testo del promemoria");
controlla(perB.filter((m) => m.data.tag.startsWith("promemoria")).map((m) => m.data.titolo).sort().join() === "Idraulico,Palestra,Prove",
  "Giulia (2 ore prima): Palestra, Idraulico e Prove (Google le manda solo una mail); no il Dentista appena annunciato né il Concerto, per cui Google la avvisa");
controlla(perB.find((m) => m.data.titolo === "Prove").data.testo === "tra 1 ora e 30, alle 20:30 · Band", "promemoria da un altro calendario, col nome del calendario");
controlla(+perA.find((m) => m.data.titolo === "Idraulico").ttl <= 50 * 60, "un promemoria non vale oltre l'inizio");
g = await giro(rm(19 * 60 + 5));
controlla(g.length === 0, "il giro dopo non ripete nulla");
dati.users.B.notifiche = { anticipo: 120, promemoria: false };
EVENTI["casa@g"].push({ id: "ev9", summary: "Aperitivo", created: rm(19 * 60 + 12), updated: rm(19 * 60 + 12), creator: { email: "mattia@esempio.it" },
  start: { dateTime: rm(20 * 60) }, end: { dateTime: rm(21 * 60) }, reminders: { useDefault: false } });
g = await giro(rm(19 * 60 + 15));
controlla(g.length === 2 && g.some((m) => m.tokens.includes("tB") && m.data.titolo === "Mattia ha aggiunto un evento"), "Giulia: evento annunciato anche con i promemoria spenti");
controlla(g.some((m) => m.tokens.join() === "tA" && m.data.titolo === "Aperitivo"), "Mattia: promemoria del suo evento senza avviso di Google");
dati.users.B.notifiche = {};

// Un calendario della casa che non risponde agli eventi nuovi non ferma i promemoria.
const fetchVero = globalThis.fetch;
globalThis.fetch = async (u, o) => (String(u).includes("updatedMin") ? { ok: false, status: 503, json: async () => ({}) } : fetchVero(u, o));
EVENTI["casa@g"].push({ id: "ev11", summary: "Cena", created: rm(19 * 60 + 16), updated: rm(19 * 60 + 16), creator: { email: "mattia@esempio.it" },
  start: { dateTime: rm(20 * 60 + 15) }, end: { dateTime: rm(21 * 60) }, reminders: { useDefault: false } });
g = await giro(rm(19 * 60 + 20));
controlla(g.length === 2 && g.every((m) => m.data.titolo === "Cena" && m.data.tag.startsWith("promemoria")), "errore sugli eventi nuovi: i promemoria partono lo stesso");
globalThis.fetch = fetchVero;
controlla(dati.avvisi_stato.H.ultimoGiro === Date.parse(rm(19 * 60 + 20)), "stato salvato anche dopo l'errore");
g = await giro(rm(19 * 60 + 25));
controlla(g.length === 1 && g[0].tokens.includes("tB") && g[0].data.titolo === "Mattia ha aggiunto un evento" && g[0].data.testo.startsWith("Cena"), "l'evento non annunciato per l'errore arriva al giro dopo");

console.log("── riepilogo del mattino ──");
const m3 = (h, mi) => `2026-11-03T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00+01:00`;
g = await giro(m3(7, 25));
controlla(!g.some((m) => m.data.tag === "riepilogo"), "prima delle 7:30 niente riepilogo");
dati.users.B.notifiche = { riepilogo: false };
g = await giro(m3(7, 31));
const rA = g.find((m) => m.data.tag === "riepilogo");
controlla(rA && rA.tokens.join() === "tA" && rA.data.titolo === "Oggi, martedì 3 novembre", "riepilogo a Mattia");
controlla(rA.data.testo === "Eventi: Compleanno Anna, 10:00 Riunione condominio\nDa fare oggi: Pagare la TARI · 1 in ritardo\nBanca: il consenso scade tra 10 giorni\nBanca: 2 spese da confermare", `righe del riepilogo: ${rA.data.testo}`);
controlla(!rA.data.silenzioso, "alle 7:31 suona");
controlla(!g.some((m) => m.data.tag === "riepilogo" && m.tokens.includes("tB")), "riepilogo spento per Giulia");
g = await giro(m3(7, 36));
controlla(!g.some((m) => m.data.tag === "riepilogo"), "un riepilogo al giorno");
// Senza riepilogo: il consenso della banca in scadenza arriva da solo, a 14, 7, 3, 1 e 0 giorni.
dati.users.A.notifiche = { riepilogo: false };
dati.bank_connections.A.consentExpiresAt = ts(Date.parse("2026-11-10T07:00:00+01:00"));
g = await giro("2026-11-04T07:31:00+01:00");
controlla(!g.some((m) => m.data.tag === "banca"), "a 6 giorni niente");
dati.bank_connections.A.consentExpiresAt = ts(Date.parse("2026-11-12T07:00:00+01:00"));
g = await giro("2026-11-05T07:31:00+01:00");
controlla(g.some((m) => m.data.tag === "banca" && m.data.testo.startsWith("Scade tra 7 giorni")), "a 7 giorni l'avviso del consenso");
dati.users.A.notifiche = {};

console.log("── Google scollegato ──");
const scaduto = async (db_, uid) => { if (uid === "B") throw Object.assign(new Error("scaduto"), { details: { motivo: "scaduto" } }); return tokenFinto(db_, uid); };
g = await giro("2026-11-05T12:00:00+01:00", { tokenServer: scaduto });
controlla(g.some((m) => m.tokens.includes("tB") && m.data.titolo === "Google scollegato"), "avviso a chi ha perso il permesso");
console.log("chiamate a Google:", chiamateGoogle.length);

console.log("token morti tolti:", aggiornamenti.filter(([, , u]) => Object.keys(u).some((k) => k.startsWith("dispositivi."))).length);
if (!aggiornamenti.some(([, id, u]) => id === "B" && "dispositivi.d3" in u)) throw new Error("token morto non tolto");
console.log("TUTTO OK");
