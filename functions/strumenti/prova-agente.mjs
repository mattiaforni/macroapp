// Prova dell'agente con l'API vera, senza Firestore: stesso prompt e stesso schema della funzione.
// Uso: ANTHROPIC_API_KEY=… node strumenti/prova-agente.mjs "testo della nota"
// Con ISTRUZIONI=… la nota è di un progetto «Prova» con quelle istruzioni: stampa anche il riepilogo.
// La lancia il flusso «Diagnosi» con provaai: true (e istruzioni, se compilate).
import { schema, system } from "../src/agent.js";
import { reason } from "../src/ai/provider.js";

const nota = process.argv[2] || "Chiama Domenico domani. Comprare il caffè.";
const ctx = {
  oggi: "venerdì 23 ottobre 2026 (2026-10-23)", altro: "Giulia", progetti: ["Circolo"],
  persone: ["Domenico Rossi"], categorie: ["Idraulica", "Elettricità", "Casa"],
};
const istruzioni = (process.env.ISTRUZIONI || "").trim();
const progetto = istruzioni ? { name: "Prova", istruzioni, precedenti: [] } : null;
const t0 = Date.now();
try {
  const out = await reason({
    system: system({ ...ctx, progetto }), user: nota, schema: schema(!!istruzioni),
    keys: { anthropic: process.env.ANTHROPIC_API_KEY }, maxTokens: istruzioni ? 8000 : 4096,
  });
  console.log(`risposta in ${Date.now() - t0} ms`);
  for (const a of out.actions || []) console.log(`- ${a.kind}: ${a.summary}`);
  if (istruzioni) console.log(`\nRiepilogo:\n${out.riepilogo}`);
} catch (err) {
  console.log(`errore dopo ${Date.now() - t0} ms: ${err.message}`);
  process.exitCode = 1;
}
