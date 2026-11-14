// Prova di Chiedi senza rete (14/11): Firestore finto in memoria e un Claude finto che chiede gli strumenti e poi
// risponde citando le fonti. Controlla che gli strumenti vedano solo ciò che la persona vede nell'app (mai le note
// private dell'altra persona, mai un'altra casa), che i codici citati diventino le fonti e spariscano dal testo, e il
// riepilogo dei costi. Uso: node strumenti/prova-chiedi.mjs (servono le dipendenze di functions).
import assert from "node:assert/strict";
import { rispondi, strumentiDi, separaFonti, chiedi } from "../src/chiedi.js";
import { sezioneEsistenti } from "../src/agent.js";
import { periodo, anteprima } from "../src/settimana.js";
import { costo } from "../src/consumi.js";

// ── Firestore finto: where (==), orderBy, limit, get; doc().get() ──
const ts = (s) => ({ toMillis: () => new Date(s).getTime(), toDate: () => new Date(s) });
const DATI = {
  journal_entries: {
    n1: { ownerUid: "io", householdId: "casa", visibility: "private", text: "Lezione: rovescio a due mani, piedi più larghi.", titolo: "Rovescio e piedi", createdAt: ts("2026-10-12T18:00:00Z"), projectId: "tennis" },
    n2: { ownerUid: "lei", householdId: "casa", visibility: "shared", text: "Il maestro dice: rovescio più anticipato.", titolo: "Rovescio anticipato", createdAt: ts("2026-10-20T18:00:00Z"), projectId: "tennis" },
    n3: { ownerUid: "lei", householdId: "casa", visibility: "private", text: "Segreto: rovescio regalo di compleanno.", titolo: "Privata di lei", createdAt: ts("2026-10-21T18:00:00Z") },
    n4: { ownerUid: "altro", householdId: "altracasa", visibility: "shared", text: "Rovescio di un'altra casa.", titolo: "Altra casa", createdAt: ts("2026-10-22T18:00:00Z") },
  },
  expenses: {
    s1: { ownerUid: "io", householdId: "casa", visibility: "shared", description: "Esselunga", amount: 82.4, category: "Spesa", paidBy: "io", split: "equal", date: ts("2026-10-03T10:00:00Z") },
    s2: { ownerUid: "lei", householdId: "casa", visibility: "shared", description: "Ristorante Da Gino", amount: 64, category: "Ristoranti", paidBy: "lei", split: "equal", date: ts("2026-10-10T20:00:00Z") },
    s3: { ownerUid: "lei", householdId: "casa", visibility: "shared", description: "Pareggio", amount: 30, type: "settlement", paidBy: "io", date: ts("2026-10-15T20:00:00Z") },
    s4: { ownerUid: "altro", householdId: "altracasa", visibility: "shared", description: "Esselunga altrui", amount: 999, paidBy: "altro", date: ts("2026-10-05T10:00:00Z") },
  },
  projects: { tennis: { ownerUid: "io", householdId: "casa", visibility: "shared", name: "Tennis", istruzioni: "…", sintesi: "## Rovescio\nStato: migliora", createdAt: ts("2026-10-01T00:00:00Z") } },
  tasks: {
    t1: { ownerUid: "io", householdId: "casa", visibility: "private", text: "Chiamare l'idraulico", done: false, due: "2026-11-20", createdAt: ts("2026-11-01T00:00:00Z") },
    t2: { ownerUid: "lei", householdId: "casa", visibility: "shared", text: "Pagare la bolletta", done: false, due: "", createdAt: ts("2026-11-02T00:00:00Z") },
    t3: { ownerUid: "lei", householdId: "casa", visibility: "private", text: "Regalo per Mattia", done: false, due: "2026-11-30", createdAt: ts("2026-11-03T00:00:00Z") },
    t4: { ownerUid: "altro", householdId: "altracasa", visibility: "shared", text: "Task di un'altra casa", done: false, createdAt: ts("2026-11-04T00:00:00Z") },
    t5: { ownerUid: "io", householdId: "casa", visibility: "private", text: "Già fatto", done: true, doneAt: ts("2026-11-05T00:00:00Z"), createdAt: ts("2026-11-04T00:00:00Z") },
  },
  manual_entries: {}, shopping_items: {},
};
function query(nome, filtri = [], ordine = null, quanti = Infinity) {
  return {
    where: (f, op, v) => query(nome, [...filtri, [f, op, v]], ordine, quanti),
    orderBy: (f, dir = "asc") => query(nome, filtri, [f, dir], quanti),
    limit: (n) => query(nome, filtri, ordine, n),
    async get() {
      let docs = Object.entries(DATI[nome] || {}).filter(([, d]) => filtri.every(([f, op, v]) => op === "==" && d[f] === v));
      if (ordine) docs.sort(([, a], [, b]) => { const x = a[ordine[0]]?.toMillis?.() ?? a[ordine[0]], y = b[ordine[0]]?.toMillis?.() ?? b[ordine[0]]; return (x > y ? 1 : x < y ? -1 : 0) * (ordine[1] === "desc" ? -1 : 1); });
      docs = docs.slice(0, quanti);
      return { docs: docs.map(([id, d]) => ({ id, data: () => d })) };
    },
    doc: (id) => ({ get: async () => ({ id, exists: !!DATI[nome]?.[id], data: () => DATI[nome]?.[id] }) }),
  };
}
const db = { collection: (n) => query(n) };

// ── Strumenti: privacy ──
const { esegui, fonti } = strumentiDi(db, { uid: "io", hid: "casa", nomi: { io: "Mattia", lei: "Giulia" } });
const note = await esegui.cerca_note({ testo: "rovescio" });
const titoli = note.note.map((n) => n.titolo);
assert.deepEqual(titoli.sort(), ["Rovescio anticipato", "Rovescio e piedi"], `solo le note che vedi: ${titoli}`);
assert.equal(note.note.find((n) => n.titolo === "Rovescio anticipato").autore, "Giulia");
assert.equal(note.note[0].progetto, "Tennis");
const spese = await esegui.spese({ da: "2026-10-01", a: "2026-10-31" });
assert.equal(spese.numero, 2, "due spese della casa, il pareggio a parte, niente dell'altra casa");
assert.equal(spese.totale.replace(/\s/g, " "), "146,40 €");
assert.match(spese.pareggi, /^1 per 30,00/);
const ristoranti = await esegui.spese({ da: "2026-10-01", a: "2026-10-31", testo: "ristorante" });
assert.equal(ristoranti.numero, 1);
const sintesi = await esegui.progetti({ progetto: "tennis" });
assert.match(sintesi.sintesi, /## Rovescio/);
assert.equal((await esegui.leggi_nota({ codice: "zz9" })).errore?.startsWith("Codice sconosciuto"), true, "codice inventato");
assert.ok(fonti.size >= 4);

// ── Fonti nel testo ──
const f = new Map([["n1", { tipo: "nota", id: "x" }], ["s2", { tipo: "spesa", id: "y" }]]);
const sep = separaFonti("Piedi più larghi [n1]. Al ristorante 64 € [s2, n1]. Inventata [n9].", f);
assert.equal(sep.testo, "Piedi più larghi. Al ristorante 64 €. Inventata.");
assert.deepEqual(sep.fonti.map((x) => x.codice), ["n1", "s2"]);

// ── Il giro con un Claude finto: prima gli strumenti, poi la risposta ──
const richieste = [];
globalThis.fetch = async (url, opts) => {
  const corpo = JSON.parse(opts.body);
  richieste.push(corpo);
  const risposta = richieste.length === 1
    ? { stop_reason: "tool_use", model: corpo.model, usage: { input_tokens: 1000, output_tokens: 200 }, content: [
      { type: "thinking", thinking: "", signature: "firma" },
      { type: "tool_use", id: "tu1", name: "cerca_note", input: { testo: "rovescio" } },
      { type: "tool_use", id: "tu2", name: "spese", input: { da: "2026-10-01", a: "2026-10-31" } }] }
    : { stop_reason: "end_turn", model: corpo.model, usage: { input_tokens: 3000, output_tokens: 300 }, content: [
      { type: "text", text: "Il maestro ti ha chiesto i piedi più larghi [n2] e, secondo Giulia, un rovescio più anticipato [n1]." }] };
  return { ok: true, status: 200, json: async () => risposta, text: async () => JSON.stringify(risposta) };
};
const passi = [];
const r = await rispondi({ db, uid: "io", hid: "casa", key: "finta", domanda: "Cosa mi ha detto il maestro sul rovescio?",
  passo: (p) => passi.push(p), contesto: { oggi: "sabato 14 novembre 2026 (2026-11-14)", io: "Mattia", altro: "Giulia", nomi: { io: "Mattia", lei: "Giulia" }, casa: {}, utente: {} } });
assert.equal(richieste.length, 2);
assert.equal(richieste[1].messages[1].content[0].type, "thinking", "la risposta del modello torna com'è, ragionamento compreso");
assert.equal(richieste[1].messages[2].content.length, 2, "i due risultati in un messaggio solo");
assert.ok(richieste[0].fallbacks === "default", "ripiego sui rifiuti chiesto");
assert.equal(r.risposta, "Il maestro ti ha chiesto i piedi più larghi e, secondo Giulia, un rovescio più anticipato.");
assert.deepEqual(r.fonti.map((x) => x.titolo), ["Rovescio e piedi", "Rovescio anticipato"]);
assert.deepEqual(passi, ["Cerco nelle note: «rovescio»", "Guardo le spese dal 2026-10-01 al 2026-10-31"]);
assert.equal(r.uso.input_tokens, 4000);
assert.equal(r.giri, 2);

// ── Agente del diario: ciò che c'è già ──
const sez = sezioneEsistenti({ task: [{ ref: "t1", text: "Chiamare l'idraulico", due: "2026-11-20", progetto: "Casa" }], lista: ["Latte", "Pane"], eventi: ["2026-11-22 20:00 Cena dai Rossi"] });
assert.match(sez, /\[t1\] Chiamare l'idraulico · scadenza 2026-11-20 · progetto Casa/);
assert.match(sez, /<lista_della_spesa>Latte, Pane<\/lista_della_spesa>/);
assert.equal(sezioneEsistenti({ task: [], lista: [], eventi: [] }), "");

// ── Revisione della settimana e costi ──
assert.equal(periodo(new Date("2026-11-15T17:47:00Z")), "dal 9 al 15 novembre");
assert.equal(periodo(new Date("2026-11-01T17:47:00Z")), "dal 26 ottobre al 1 novembre");
assert.equal(anteprima("## Note e progetti\n- Tre lezioni di **tennis**: il rovescio migliora."), "Tre lezioni di tennis: il rovescio migliora.");
assert.equal(Math.round(costo("claude-sonnet-5-5", { input_tokens: 1e6, output_tokens: 1e5 }) * 100) / 100, 3);
assert.equal(Math.round(costo("gemini-3.8-flash", { promptTokenCount: 1920, candidatesTokenCount: 200 }, Date.UTC(2026, 10, 14)) * 1e6), 2190);

// ── Azioni proposte (14/11, «Chiedi che agisce»): solo su ciò che la persona vede e può modificare ──
{
  // Google Calendar finto: la casa (un evento e un invito), il personale (modificabile), la band (sola lettura).
  const EVENTI = {
    "casa@g": [
      { id: "cena", summary: "Cena dai Rossi", start: { dateTime: "2026-11-20T19:00:00Z" }, end: { dateTime: "2026-11-20T21:00:00Z" }, organizer: { email: "casa@g", self: true }, status: "confirmed" },
      { id: "invito", summary: "Festa di Anna", start: { dateTime: "2026-11-21T19:00:00Z" }, end: { dateTime: "2026-11-21T23:00:00Z" }, organizer: { email: "anna@example.com" }, status: "confirmed" },
    ],
    "mio@g": [{ id: "dentista", summary: "Dentista", start: { dateTime: "2026-11-18T08:30:00Z" }, end: { dateTime: "2026-11-18T09:30:00Z" }, organizer: { email: "mio@g", self: true }, status: "confirmed" }],
    "band@g": [{ id: "prove", summary: "Prove con la band", start: { dateTime: "2026-11-19T18:00:00Z" }, end: { dateTime: "2026-11-19T20:00:00Z" }, organizer: { email: "band@g", self: true }, status: "confirmed" }],
  };
  const fetchVero = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const m = String(url).match(/calendars\/([^/]+)\/events/);
    return { ok: true, status: 200, json: async () => ({ items: EVENTI[decodeURIComponent(m[1])] || [] }) };
  };
  const casa = { calendario: { id: "casa@g", nome: "Casa" } };
  const utente = { calendari: [{ id: "mio@g", nome: "Personale", modificabile: true }, { id: "band@g", nome: "Band", modificabile: false }] };
  const tokenGoogle = async () => ({ accessToken: "tok", permessi: { calendario: true } });
  const { esegui: es, proposte } = strumentiDi(db, { uid: "io", hid: "casa", nomi: { io: "Mattia", lei: "Giulia" }, tokenGoogle, casa, utente });
  const ok = (r) => { assert.ok(r.ok, JSON.stringify(r)); };
  const no = (r, re) => { assert.ok(r.errore && re.test(r.errore), JSON.stringify(r)); };

  // Task: solo quelli che la persona vede (i suoi e quelli condivisi della casa), con i codici dati dallo strumento.
  const aperti = await es.task({ stato: "aperti" });
  const perTesto = Object.fromEntries(aperti.task.map((t) => [t.testo, t.codice]));
  assert.deepEqual(Object.keys(perTesto).sort(), ["Chiamare l'idraulico", "Pagare la bolletta"], "né il task privato di lei né quello di un'altra casa");
  ok(await es.proponi({ tipo: "task_fatto", riassunto: "Bolletta pagata", codice: perTesto["Pagare la bolletta"] }));
  ok(await es.proponi({ tipo: "task_scadenza", riassunto: "Idraulico a venerdì", codice: `[${perTesto["Chiamare l'idraulico"]}]`, giorno: "2026-11-27" }));
  no(await es.proponi({ tipo: "task_fatto", riassunto: "x", codice: "t3" }), /sconosciuto/);      // il codice t3 non è stato dato
  no(await es.proponi({ tipo: "task_fatto", riassunto: "x", codice: "n1" }), /sconosciuto/);      // il codice di una nota non è un task
  no(await es.proponi({ tipo: "task_scadenza", riassunto: "x", codice: perTesto["Chiamare l'idraulico"], giorno: "2026-11-20" }), /già quella/);
  no(await es.proponi({ tipo: "task_scadenza", riassunto: "x", codice: perTesto["Chiamare l'idraulico"], giorno: "2026-02-30" }), /giorno/);
  const fatti = await es.task({ stato: "fatti" });
  no(await es.proponi({ tipo: "task_fatto", riassunto: "x", codice: fatti.task[0].codice }), /già fatto/);

  // Task nuovo: con la visibilità del progetto (Tennis è condiviso); un progetto che non c'è no.
  ok(await es.proponi({ tipo: "task", riassunto: "Prenotare il campo", testo: "Prenotare il campo", progetto: "tennis", giorno: "2026-11-22" }));
  assert.equal(proposte.at(-1).payload.visibilita, "shared");
  assert.equal(proposte.at(-1).payload.project, "Tennis");
  no(await es.proponi({ tipo: "task", riassunto: "x", testo: "x", progetto: "Giardinaggio" }), /Nessun progetto/);
  ok(await es.proponi({ tipo: "task", riassunto: "Chiamare Marco", testo: "Chiamare Marco" }));
  assert.equal(proposte.at(-1).payload.visibilita, "private", "senza progetto e senza «condivisa»: privato");

  // Eventi: si modificano solo quelli dei calendari in cui l'app scrive, e non gli inviti.
  const ev = await es.eventi({ da: "2026-11-15", a: "2026-11-30" });
  const cod = Object.fromEntries(ev.eventi.map((e) => [e.titolo, e.codice]));
  assert.equal(ev.eventi.find((e) => e.titolo === "Prove con la band").si_modifica, "solo da Google Calendar");
  ok(await es.proponi({ tipo: "evento_modifica", riassunto: "Cena a sabato", codice: cod["Cena dai Rossi"], giorno: "2026-11-21", ora: "20:30" }));
  const sposta = proposte.at(-1);
  assert.equal(sposta.kind, "event_update");
  assert.deepEqual(sposta.payload.prima, { titolo: "Cena dai Rossi", giorno: "2026-11-20", ora: "20:00", luogo: "", tuttoIlGiorno: false });
  assert.deepEqual(sposta.payload.nuovo, { giorno: "2026-11-21", ora: "20:30" });
  assert.equal(sposta.payload.calId, "casa@g");
  ok(await es.proponi({ tipo: "evento_modifica", riassunto: "Dentista alle 10", codice: cod["Dentista"], ora: "10:00" }));
  no(await es.proponi({ tipo: "evento_modifica", riassunto: "x", codice: cod["Prove con la band"], ora: "19:00" }), /non si modifica/);
  no(await es.proponi({ tipo: "evento_modifica", riassunto: "x", codice: cod["Festa di Anna"], ora: "21:00" }), /non si modifica/);
  no(await es.proponi({ tipo: "evento_modifica", riassunto: "x", codice: cod["Dentista"], ora: "09:30" }), /Niente da cambiare/);
  no(await es.proponi({ tipo: "evento_modifica", riassunto: "x", codice: "e99", ora: "10:00" }), /sconosciuto/);
  ok(await es.proponi({ tipo: "evento", riassunto: "Pizza venerdì", testo: "Pizza", giorno: "2026-11-27", ora: "20:00" }));
  assert.equal(proposte.length, 7);
  no(await es.proponi({ tipo: "spesa", riassunto: "x", testo: "Pizza", importo: 0 }), /importo/);
  ok(await es.proponi({ tipo: "spesa", riassunto: "Pizza 30 €", testo: "Pizza", importo: 30.004 }));
  assert.equal(proposte.at(-1).payload.amount, 30);
  no(await es.proponi({ tipo: "lista", riassunto: "Latte", testo: "Latte" }), /Al più 8/);
  assert.equal(proposte.length, 8, "al più 8 azioni per risposta");

  // Senza casa né calendario della casa: niente spese, lista né eventi nuovi. Una persona del manuale è privata.
  const solo = strumentiDi(db, { uid: "io", hid: null, nomi: {}, casa: {}, utente: {} });
  no(await solo.esegui.proponi({ tipo: "lista", riassunto: "x", testo: "Latte" }), /casa/);
  no(await solo.esegui.proponi({ tipo: "spesa", riassunto: "x", testo: "Pizza", importo: 10 }), /casa/);
  no(await solo.esegui.proponi({ tipo: "evento", riassunto: "x", testo: "Pizza", giorno: "2026-11-27" }), /calendario della casa/);
  ok(await solo.esegui.proponi({ tipo: "manuale", riassunto: "Anna in rubrica", testo: "Anna Bianchi", voce: "persona", telefono: "333", condivisa: true }));
  ok(await solo.esegui.proponi({ tipo: "manuale", riassunto: "Anna in rubrica", testo: "Anna Bianchi", voce: "persona", telefono: "333", condivisa: true }));
  assert.equal(solo.proposte.length, 1, "un doppione non si aggiunge");
  assert.equal(solo.proposte[0].payload.visibilita, "private");
  assert.equal(solo.proposte[0].kind, "manual_entry");

  // Il giro con un Claude finto che cerca, propone (anche una cosa sbagliata, che gli torna come errore) e risponde.
  const giri = [];
  globalThis.fetch = async (url, opts) => {
    if (!String(url).includes("anthropic")) return { ok: true, status: 200, json: async () => ({ items: EVENTI[decodeURIComponent(String(url).match(/calendars\/([^/]+)\//)[1])] || [] }) };
    const corpo = JSON.parse(opts.body);
    giri.push(corpo);
    const n = giri.length;
    const r = n === 1
      ? { stop_reason: "tool_use", content: [{ type: "tool_use", id: "a", name: "task", input: { stato: "aperti", testo: "bolletta" } }, { type: "tool_use", id: "b", name: "eventi", input: { da: "2026-11-15", a: "2026-11-30", testo: "cena" } }] }
      : n === 2
        ? { stop_reason: "tool_use", content: [
          { type: "tool_use", id: "c", name: "proponi", input: { tipo: "task_fatto", riassunto: "Segnare pagata la bolletta", codice: "t1" } },
          { type: "tool_use", id: "d", name: "proponi", input: { tipo: "evento_modifica", riassunto: "Spostare la cena a sabato", codice: "e1", giorno: "2026-11-21" } },
          { type: "tool_use", id: "e", name: "proponi", input: { tipo: "task_fatto", riassunto: "Inventato", codice: "t7" } }] }
        : { stop_reason: "end_turn", content: [{ type: "text", text: "Te lo propongo qui sotto: la bolletta [t1] fatta e la cena [e1] a sabato." }] };
    return { ok: true, status: 200, json: async () => ({ model: corpo.model, usage: { input_tokens: 10, output_tokens: 5 }, ...r }) };
  };
  const contesto = { oggi: "sabato 14 novembre 2026 (2026-11-14)", io: "Mattia", altro: "Giulia", nomi: { io: "Mattia", lei: "Giulia" }, casa, utente };
  const rr = await rispondi({ db, uid: "io", hid: "casa", key: "finta", domanda: "Ho pagato la bolletta, e sposta la cena a sabato", tokenGoogle, contesto });
  assert.ok(giri[0].tools.some((t) => t.name === "proponi"), "Chiedi ha lo strumento proponi");
  assert.match(giri[0].system, /strumento proponi/);
  const errore = giri[2].messages.at(-1).content.find((x) => x.tool_use_id === "e");
  assert.match(errore.content, /sconosciuto/, "il codice inventato torna al modello come errore");
  assert.deepEqual(rr.proposte.map((x) => x.kind), ["task_done", "event_update"]);
  assert.equal(rr.proposte[0].payload.taskId, "t2", "il codice diventa l'id vero, scritto dal server");
  assert.equal(rr.risposta, "Te lo propongo qui sotto: la bolletta fatta e la cena a sabato.");

  // La revisione della settimana non propone: niente strumento, e una chiamata a proponi non fa niente.
  giri.length = 0;
  globalThis.fetch = async (url, opts) => {
    const corpo = JSON.parse(opts.body);
    giri.push(corpo);
    const r = giri.length === 1
      ? { stop_reason: "tool_use", content: [{ type: "tool_use", id: "x", name: "proponi", input: { tipo: "lista", riassunto: "Latte", testo: "Latte" } }] }
      : { stop_reason: "end_turn", content: [{ type: "text", text: "Settimana tranquilla." }] };
    return { ok: true, status: 200, json: async () => ({ model: corpo.model, usage: {}, ...r }) };
  };
  const sett = await rispondi({ db, uid: "io", hid: "casa", key: "finta", domanda: "revisione", settimana: true, contesto });
  assert.ok(!giri[0].tools.some((t) => t.name === "proponi"));
  assert.match(giri[1].messages.at(-1).content[0].content, /sconosciuto/);
  assert.deepEqual(sett.proposte, []);

  // `chiedi` scrive le proposte in `proposals`: private, con domandaId e turno; un turno rifatto sostituisce le sue in attesa.
  const SCRITTI = new Map();
  const D = { "domande/q1": { ownerUid: "io", householdId: "casa", visibility: "private", tipo: "domanda", stato: "nuova", passi: [],
    turni: [{ domanda: "Ho pagato la bolletta?", risposta: "Sì", at: new Date() }, { domanda: "Segnala fatta", at: new Date() }] },
  "users/io": { householdId: "casa", displayName: "Mattia Rossi" }, "households/casa": { members: ["io", "lei"], memberNames: { io: "Mattia", lei: "Giulia" } },
  "proposals/vecchia": { ownerUid: "io", domandaId: "q1", turno: 1, status: "pending", kind: "shopping_item" },
  "proposals/confermata": { ownerUid: "io", domandaId: "q1", turno: 1, status: "accepted", kind: "shopping_item" },
  "proposals/altroTurno": { ownerUid: "io", domandaId: "q1", turno: 0, status: "pending", kind: "shopping_item" } };
  let auto = 0;
  const rif = (path) => ({ id: path.split("/")[1], path,
    get: async () => ({ id: path.split("/")[1], exists: path in D, data: () => D[path] }),
    update: async (x) => { D[path] = { ...D[path], ...x }; }, set: async (x) => { D[path] = x; } });
  const colle = (nome, filtri = []) => ({
    doc: (id) => rif(`${nome}/${id || `auto${++auto}`}`),
    where: (f, op, v) => colle(nome, [...filtri, [f, v]]),
    orderBy: () => colle(nome, filtri), limit: () => colle(nome, filtri),
    get: async () => {
      const docs = Object.entries(D).filter(([k, d]) => k.startsWith(`${nome}/`) && filtri.every(([f, v]) => d[f] === v));
      if (DATI[nome]) docs.push(...Object.entries(DATI[nome]).filter(([, d]) => filtri.every(([f, v]) => d[f] === v)).map(([id, d]) => [`${nome}/${id}`, d]));
      return { docs: docs.map(([k, d]) => ({ id: k.split("/")[1], ref: rif(k), data: () => d })) };
    },
  });
  const fdb = {
    collection: (n) => colle(n),
    runTransaction: async (fn) => fn({ get: (r) => r.get(), update: (r, x) => { D[r.path] = { ...D[r.path], ...x }; } }),
    batch: () => { const op = []; return { set: (r, x) => op.push(() => { D[r.path] = x; SCRITTI.set(r.path, x); }), update: (r, x) => op.push(() => { D[r.path] = { ...D[r.path], ...x }; }),
      delete: (r) => op.push(() => { delete D[r.path]; }), commit: async () => op.forEach((f) => f()) }; },
  };
  giri.length = 0;
  globalThis.fetch = async (url, opts) => {
    const corpo = JSON.parse(opts.body);
    giri.push(corpo);
    const r = giri.length === 1
      ? { stop_reason: "tool_use", content: [{ type: "tool_use", id: "a", name: "task", input: { stato: "aperti" } }] }
      : giri.length === 2
        ? { stop_reason: "tool_use", content: [{ type: "tool_use", id: "b", name: "proponi", input: { tipo: "task_fatto", riassunto: "Bolletta pagata", codice: "t2" } }] }
        : { stop_reason: "end_turn", content: [{ type: "text", text: "Te la propongo qui sotto [t2]." }] };
    return { ok: true, status: 200, json: async () => ({ model: corpo.model, usage: {}, ...r }) };
  };
  const esito = await chiedi(fdb, "io", "q1", { key: "finta" });
  assert.deepEqual(esito, { fatta: true, azioni: 1 });
  const nuove = [...SCRITTI.entries()].filter(([k]) => k.startsWith("proposals/")).map(([, x]) => x);
  assert.equal(nuove.length, 1);
  assert.equal(nuove[0].visibility, "private", "privata come la domanda");
  assert.equal(nuove[0].source, "chiedi");
  assert.equal(nuove[0].domandaId, "q1");
  assert.equal(nuove[0].turno, 1);
  assert.equal(nuove[0].ownerUid, "io");
  assert.equal(nuove[0].payload.taskId, "t2");
  assert.ok(!("proposals/vecchia" in D), "la proposta in attesa del turno rifatto se ne va");
  assert.ok("proposals/confermata" in D && "proposals/altroTurno" in D, "quelle confermate e degli altri turni restano");
  assert.equal(D["domande/q1"].stato, "fatta");
  assert.equal(D["domande/q1"].turni[1].azioni, 1);
  assert.equal(D["domande/q1"].turni[1].risposta, "Te la propongo qui sotto.");
  globalThis.fetch = fetchVero;
  console.log("  ✓ azioni proposte: task e eventi solo visibili e modificabili, codici tradotti dal server, private e legate al turno");
}

console.log("Chiedi: strumenti, privacy, fonti e giro con gli strumenti a posto; revisione e costi pure.");
