// Prova della trascrizione con l'API vera, senza Firestore: stesso prompt e stesso modello della funzione.
// Uso: GEMINI_API_KEY=… node strumenti/prova-trascrizione.mjs file.webm [audio/webm]
// PROGETTO, TEMI (separati da virgola) e PERSONE (separate da virgola) simulano il contesto di un progetto.
// La lancia il flusso «Diagnosi» con provatrascrizione: true, su campioni/lezione-sintetica.webm (voce espeak-ng).
import { readFile } from "node:fs/promises";
import { transcribe, MODELLO_TRASCRIZIONE } from "../src/ai/gemini.js";

const [file, mime = "audio/webm"] = process.argv.slice(2);
if (!file) { console.log("Uso: node strumenti/prova-trascrizione.mjs file.webm [audio/webm]"); process.exit(1); }
const lista = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
const contesto = { persone: lista(process.env.PERSONE) };
if (process.env.PROGETTO) Object.assign(contesto, { progetto: process.env.PROGETTO, temi: lista(process.env.TEMI) });

const audio = await readFile(file);
const t0 = Date.now();
try {
  const { testo, uso } = await transcribe({ audioBase64: audio.toString("base64"), mimeType: mime, key: process.env.GEMINI_API_KEY, contesto });
  console.log(`${MODELLO_TRASCRIZIONE}: ${Math.round(audio.length / 1024)} KB in ${Date.now() - t0} ms`);
  if (uso) console.log(`token: ${uso.promptTokenCount} in, ${uso.candidatesTokenCount} out, ${uso.thoughtsTokenCount || 0} pensiero`);
  console.log(`\n${testo}`);
} catch (err) {
  console.log(`errore dopo ${Date.now() - t0} ms: ${err.message}`);
  process.exitCode = 1;
}
