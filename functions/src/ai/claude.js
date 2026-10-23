// Provider Anthropic (Messages API) con output strutturato (output_config.format = json_schema).
// Riferimento: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
// Sonnet: estrazione più accurata e bozze scritte meglio. Circa 1 centesimo per nota.
// Per risparmiare si può passare a "claude-haiku-5-5" (circa un ventesimo del costo).
const MODEL = "claude-sonnet-5-5";
const URL = "https://api.anthropic.com/v1/messages";

const ATTESA_MASSIMA = 100_000; // ms: sotto il tempo massimo della funzione (120 s)

export async function reason({ system, user, schema, key }) {
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
      max_tokens: 4096,
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
