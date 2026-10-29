// Prova dell'agente con l'API vera, senza Firestore: stesso prompt e stesso schema della funzione.
// Uso: ANTHROPIC_API_KEY=… node strumenti/prova-agente.mjs "testo della nota"
// Con ISTRUZIONI=… la nota è di un progetto «Prova» con quelle istruzioni: stampa anche il riepilogo.
// MODELLO=haiku|sonnet|opus sceglie il modello (se no quello predefinito per il tipo di nota, src/agent.js).
// CONTATTI="Nome Cognome, …" finge i contatti Google dell'utente (se no un piccolo elenco di prova): stampa titolo
// e persone della nota, collegate come farebbe la funzione.
// La lancia il flusso «Diagnosi» con provaai: true (e istruzioni, se compilate).
import { schema, system, collegaPersone, MODELLI_PREDEFINITI } from "../src/agent.js";
import { candidati } from "../src/google/contatti.js";
import { reason } from "../src/ai/provider.js";

const nota = process.argv[2] || "Chiama Domenico domani. Comprare il caffè.";
const ctx = {
  oggi: "venerdì 23 ottobre 2026 (2026-10-23)", io: "Mattia Forni", altro: "Giulia", progetti: ["Circolo"],
  persone: ["Domenico Rossi"], categorie: ["Idraulica", "Elettricità", "Casa"],
};
const voci = [{ id: "v1", name: "Domenico Rossi", googleId: "" }];
const rubricaGoogle = (process.env.CONTATTI || "Massimo Ferri, Massimo Bianchi, Anna Rossetti, Domenico Neri")
  .split(",").map((x) => x.trim()).filter(Boolean).map((nome, i) => ({ nome, soprannome: "", googleId: `people/prova${i}` }));
const contatti = candidati(rubricaGoogle, nota);
const istruzioni = (process.env.ISTRUZIONI || "").trim();
const progetto = istruzioni ? { name: "Prova", istruzioni, precedenti: [] } : null;
const modello = (process.env.MODELLO || "").trim() || MODELLI_PREDEFINITI[istruzioni ? "progetti" : "note"];
const t0 = Date.now();
try {
  const out = await reason({
    system: system({ ...ctx, contattiGoogle: contatti.map((c) => c.nome), progetto }), user: nota, schema: schema(!!istruzioni),
    keys: { anthropic: process.env.ANTHROPIC_API_KEY }, maxTokens: istruzioni ? 32000 : 8000, model: modello,
  });
  console.log(`risposta di ${modello} in ${Date.now() - t0} ms`);
  console.log(`titolo: ${out.titolo}`);
  const persone = collegaPersone(out.persone, { voci, contatti, io: ctx.io });
  console.log(`persone: ${persone.map((p) => `${p.nome}${p.voceId ? " (rubrica)" : p.googleId ? " (Google)" : ""}`).join(", ") || "nessuna"}`);
  for (const a of out.actions || []) console.log(`- ${a.kind}: ${a.summary}`);
  if (istruzioni) console.log(`\nRiepilogo:\n${out.riepilogo}`);
} catch (err) {
  console.log(`errore dopo ${Date.now() - t0} ms: ${err.message}`);
  process.exitCode = 1;
}
