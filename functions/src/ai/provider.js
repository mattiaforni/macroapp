// Astrazione del provider AI: il resto del codice chiama `reason()` e non sa quale modello risponde.
// Cambiare provider = cambiare DEFAULT_PROVIDER (o passare { provider } alla chiamata).
import * as claude from "./claude.js";
import * as gemini from "./gemini.js";

const providers = { claude, gemini };
export const DEFAULT_PROVIDER = "claude";
export { MODELLI, MODELLO_PREDEFINITO } from "./claude.js";

/**
 * reason({ system, user, schema, keys, provider, maxTokens, model })
 * Ritorna un oggetto JSON conforme a `schema` (JSON Schema). Ogni provider gestisce
 * la propria modalità di output strutturato. maxTokens: tetto della risposta (dove il provider lo usa).
 * model: chiave di MODELLI (haiku, sonnet, opus); vale solo per Claude.
 */
export async function reason({ system, user, schema, keys, provider = DEFAULT_PROVIDER, maxTokens, model }) {
  const p = providers[provider];
  if (!p) throw new Error(`Provider sconosciuto: ${provider}`);
  const key = provider === "claude" ? keys.anthropic : keys.gemini;
  if (!key) throw new Error(`Chiave mancante per ${provider}`);
  return p.reason({ system, user, schema, key, maxTokens, model });
}

/**
 * transcribe({ audioBase64, mimeType, keys, contesto }) → { testo, uso }
 * Note vocali del diario (function `trascrivi`). Claude non accetta audio: trascrive Gemini, che lo accetta
 * nativamente. contesto = { progetto, istruzioni, temi, persone } (src/trascrizione.js) per scrivere giusti
 * nomi e termini.
 */
export async function transcribe({ audioBase64, mimeType, keys, contesto }) {
  if (!keys.gemini) throw new Error("Trascrizione: chiave Gemini mancante");
  return gemini.transcribe({ audioBase64, mimeType, key: keys.gemini, contesto });
}
