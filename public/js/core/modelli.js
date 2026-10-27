// Modelli dell'AI per l'analisi delle note (menu → Account → Modelli AI).
// users/{uid}.modelli = { note, progetti }: `note` per le note semplici, `progetti` per quelle di un
// progetto con istruzioni (riepilogo e sintesi). Valori = chiavi di MODELLI in functions/src/ai/claude.js;
// assenti → i predefiniti, gli stessi di MODELLI_PREDEFINITI in functions/src/agent.js.
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-firestore.js";
import { db } from "./firebase.js";
import { session } from "./auth.js";

// Costi relativi dai prezzi per token di ottobre 2026 (https://platform.claude.com/docs/en/about-claude/models/overview).
export const MODELLI = [
  { id: "haiku", nome: "Haiku", desc: "Il più rapido · costa 1/20 di Sonnet" },
  { id: "sonnet", nome: "Sonnet", desc: "Rapido e preciso" },
  { id: "opus", nome: "Opus", desc: "Ragiona di più, più lento · costa il doppio" },
];

export const PREDEFINITI = { note: "sonnet", progetti: "opus" };

/** [tipo, titolo, spiegazione] */
export const TIPI = [
  ["note", "Note semplici", "Spese, task, lista della spesa, voci del manuale, bozze di messaggi."],
  ["progetti", "Note dei progetti", "Le note di un progetto con istruzioni, come Tennis: riepilogo della nota e sintesi del progetto. Qui il modello pesa sulla qualità del testo."],
];

export const nomeModello = (id) => MODELLI.find((m) => m.id === id)?.nome || "";

export async function leggiModelli() {
  const snap = await getDoc(doc(db, "users", session.user.uid));
  const scelti = (snap.exists() && snap.data().modelli) || {};
  const valido = (id) => MODELLI.some((m) => m.id === id);
  return Object.fromEntries(Object.keys(PREDEFINITI).map((t) => [t, valido(scelti[t]) ? scelti[t] : PREDEFINITI[t]]));
}

export function scegliModello(tipo, id) {
  return updateDoc(doc(db, "users", session.user.uid), { [`modelli.${tipo}`]: id });
}
