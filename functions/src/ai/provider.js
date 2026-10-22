// Astrazione del provider AI: il resto del codice chiama `reason()` e non sa quale modello risponde.
// Cambiare provider = cambiare DEFAULT_PROVIDER (o passare { provider } alla chiamata).
import * as claude from "./claude.js";
import * as gemini from "./gemini.js";

const providers = { claude, gemini };
export const DEFAULT_PROVIDER = "claude";

/**
 * reason({ system, user, schema, keys, provider })
 * Ritorna un oggetto JSON conforme a `schema` (JSON Schema). Ogni provider gestisce
 * la propria modalità di output strutturato.
 */
export async function reason({ system, user, schema, keys, provider = DEFAULT_PROVIDER }) {
  const p = providers[provider];
  if (!p) throw new Error(`Provider sconosciuto: ${provider}`);
  const key = provider === "claude" ? keys.anthropic : keys.gemini;
  if (!key) throw new Error(`Chiave mancante per ${provider}`);
  return p.reason({ system, user, schema, key });
}

/**
 * transcribe({ audioBase64, mimeType, keys })
 * Oggi non usata (dettatura da tastiera). Pronta per quando si registrerà l'audio: Gemini lo accetta nativamente.
 */
export async function transcribe({ audioBase64, mimeType, keys }) {
  if (!keys.gemini) throw new Error("Trascrizione: chiave Gemini mancante");
  return gemini.transcribe({ audioBase64, mimeType, key: keys.gemini });
}
