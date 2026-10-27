// Provider Anthropic (Messages API) con output strutturato (output_config.format = json_schema).
// Riferimento: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
// Il modello lo sceglie l'utente dall'app (users/{uid}.modelli, pagina «Modelli AI»), separato per le
// note semplici e per quelle dei progetti con istruzioni: qui la chiave breve diventa l'ID dell'API.
// Prezzi per milione di token, ingresso/uscita (ottobre 2026): Haiku da 0,10/0,50 $, Sonnet 2/10 $,
// Opus 4/20 $. https://platform.claude.com/docs/en/about-claude/models/overview
// Tutti e tre ragionano prima di rispondere (thinking adattivo, attivo senza configurarlo): quel
// ragionamento conta nel tetto max_tokens, che quindi va tenuto largo. Si paga solo ciò che si usa.
export const MODELLI = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" };
export const MODELLO_PREDEFINITO = "sonnet";
const URL = "https://api.anthropic.com/v1/messages";

// ms: sotto il tempo massimo della funzione (300 s) e sotto l'attesa delle intestazioni di fetch
// in Node (300 s): senza streaming la risposta arriva tutta alla fine. Opus su una nota di progetto
// lunga può metterci un paio di minuti.
const ATTESA_MASSIMA = 280_000;

export async function reason({ system, user, schema, key, maxTokens = 8000, model = MODELLO_PREDEFINITO }) {
  const MODEL = MODELLI[model] || MODELLI[MODELLO_PREDEFINITO];
  const res = await fetch(URL, {
    method: "POST",
    signal: AbortSignal.timeout(ATTESA_MASSIMA),
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { format: { type: "json_schema", schema } },
    }),
  }).catch((err) => {
    if (err.name === "TimeoutError") throw new Error(`Claude: nessuna risposta in ${ATTESA_MASSIMA / 1000} s`);
    throw err;
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data.stop_reason === "refusal") throw new Error("Claude: richiesta rifiutata");
  if (data.stop_reason === "max_tokens") throw new Error("Claude: output troncato");
  const text = data.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("Claude: risposta vuota");
  return JSON.parse(text);
}
