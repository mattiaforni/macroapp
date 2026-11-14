// Prova di Chiedi senza rete (14/11): Firestore finto in memoria e un Claude finto che chiede gli strumenti e poi
// risponde citando le fonti. Controlla che gli strumenti vedano solo ciò che la persona vede nell'app (mai le note
// private dell'altra persona, mai un'altra casa), che i codici citati diventino le fonti e spariscano dal testo, e il
// riepilogo dei costi. Uso: node strumenti/prova-chiedi.mjs (servono le dipendenze di functions).
import assert from "node:assert/strict";
import { rispondi, strumentiDi, separaFonti } from "../src/chiedi.js";
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
  tasks: {}, manual_entries: {}, shopping_items: {},
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

console.log("Chiedi: strumenti, privacy, fonti e giro con gli strumenti a posto; revisione e costi pure.");
