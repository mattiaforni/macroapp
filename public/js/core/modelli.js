// Modelli dell'AI per l'analisi delle note (menu → Account → Modelli AI).
// users/{uid}.modelli = { note, progetti, domande }: `note` per le note semplici, `progetti` per quelle di un
// progetto con istruzioni (riepilogo e sintesi), `domande` per Chiedi e la revisione della settimana (14/11). Valori = chiavi di MODELLI in functions/src/ai/claude.js;
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

export const PREDEFINITI = { note: "sonnet", progetti: "opus", domande: "sonnet" };

/** [tipo, titolo, spiegazione] */
export const TIPI = [
  ["note", "Note semplici", "Spese, task, lista della spesa, voci del manuale, bozze di messaggi."],
  ["progetti", "Note dei progetti", "Le note di un progetto con istruzioni, come Tennis: riepilogo della nota e sintesi del progetto. Qui il modello pesa sulla qualità del testo."],
  ["domande", "Domande", "Le risposte di «Chiedi» e la revisione della settimana: cercano nelle note, nelle spese, nei task e nel calendario prima di rispondere."],
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

// ───────────── Consumi del mese (14/11) ─────────────
// consumi/{uid}_{AAAAMM}, scritto dal server a ogni chiamata (functions/src/consumi.js): stima dai prezzi di listino.
export const CREDITI_MESE = 100; // $: crediti API inclusi nel piano Max (CLAUDE.md)
export const VOCI_CONSUMO = [
  ["note", "Note semplici"], ["progetti", "Note dei progetti"], ["chiedi", "Chiedi"], ["settimana", "Revisione della settimana"],
  ["pdf", "PDF dei progetti"], ["trascrizione", "Trascrizione (Gemini)"],
];
export async function leggiConsumi(d = new Date()) {
  const mese = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const snap = await getDoc(doc(db, "consumi", `${session.user.uid}_${mese}`));
  return snap.exists() ? snap.data() : null;
}
/** «3,20 $», «0,4 cent», «—» */
export function dollari(n) {
  const x = Number(n) || 0;
  if (!x) return "0 $";
  if (x < 0.01) return "meno di 1 cent";
  if (x < 1) return `${Math.round(x * 100)} cent`;
  return `${x.toFixed(2).replace(".", ",")} $`;
}
