// Prova dell'agente con l'API vera, senza Firestore: stesso prompt e stesso schema della funzione.
// Uso: ANTHROPIC_API_KEY=… node strumenti/prova-agente.mjs "testo della nota"
// La lancia il flusso «Diagnosi» con provaai: true.
import { SCHEMA, system } from "../src/agent.js";
import { reason } from "../src/ai/provider.js";

const nota = process.argv[2] || "Chiama Domenico domani. Comprare il caffè.";
const ctx = {
  oggi: "venerdì 23 ottobre 2026 (2026-10-23)", altro: "Giulia", progetti: ["Circolo"],
  persone: ["Domenico Rossi"], categorie: ["Idraulica", "Elettricità", "Casa"],
};
const t0 = Date.now();
try {
  const out = await reason({ system: system(ctx), user: nota, schema: SCHEMA, keys: { anthropic: process.env.ANTHROPIC_API_KEY } });
  console.log(`risposta in ${Date.now() - t0} ms`);
  for (const a of out.actions || []) console.log(`- ${a.kind}: ${a.summary}`);
} catch (err) {
  console.log(`errore dopo ${Date.now() - t0} ms: ${err.message}`);
  process.exitCode = 1;
}
