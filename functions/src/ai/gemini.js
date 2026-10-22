// Provider Google Gemini (API Developer, piano a pagamento: i dati non sono usati per migliorare i prodotti).
const MODEL = "gemini-2.5-flash";
const base = (key, action) => `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:${action}?key=${key}`;

export async function reason({ system, user, schema, key }) {
  const res = await fetch(base(key, "generateContent"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schema },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini: risposta vuota");
  return JSON.parse(text);
}

export async function transcribe({ audioBase64, mimeType, key }) {
  const res = await fetch(base(key, "generateContent"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [
        { text: "Trascrivi fedelmente in italiano, con punteggiatura. Solo il testo." },
        { inlineData: { mimeType, data: audioBase64 } },
      ] }],
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}
