// Sintesi di un progetto: un testo vivo con lo stato del progetto e ciò che è emerso dalle note del
// diario, organizzato per temi secondo le istruzioni del progetto. La scrive l'agente come proposta
// dopo ogni nota analizzata; confermata, finisce in `projects.sintesi`. Si legge nella pagina del
// progetto (modules/progetto), per temi, e da qui si corregge a mano.
//
// Convenzione del testo (la conosce anche l'agente): una sezione «## Tema» per tema; dentro, come
// prima riga facoltativa, «Stato: …» (due-quattro parole). Le note portano in `temi` i nomi delle
// sezioni che toccano: così ogni tema sa in quali note è emerso.
import { el, toast } from "../core/ui.js";
import { update } from "../core/db.js";
import { openSheet } from "./sheet.js";

/**
 * Le sezioni della sintesi: [{ nome, stato, corpo }]. Il testo prima del primo titolo è una
 * sezione senza nome. `stato` è la riga «Stato: …», tolta dal corpo.
 */
export function sezioniSintesi(testo) {
  const out = [];
  let corrente = null;
  for (const grezza of String(testo || "").split("\n")) {
    const riga = grezza.trim();
    const titolo = riga.match(/^#{1,4}\s+(.*)$/);
    if (titolo) {
      corrente = { nome: titolo[1].replace(/\*\*/g, "").trim(), stato: "", corpo: [] };
      out.push(corrente);
      continue;
    }
    if (!corrente) {
      if (!riga) continue;
      corrente = { nome: "", stato: "", corpo: [] };
      out.push(corrente);
    }
    const stato = riga.match(/^\**\s*stato\s*:\**\s*(.+)$/i);
    if (stato && !corrente.stato) { corrente.stato = stato[1].replace(/\*\*/g, "").trim(); continue; }
    corrente.corpo.push(grezza);
  }
  return out.map((sez) => ({ ...sez, corpo: sez.corpo.join("\n").trim() })).filter((sez) => sez.nome || sez.corpo);
}

/** Tono di uno stato, per il colore: "bene", "male" o "". */
export function tonoStato(stato) {
  const t = String(stato || "").toLowerCase();
  if (/indietro|peggior|male|problem|bloccat|regred|perso/.test(t)) return "male";
  if (/miglior|meglio|sicur|bene|acquisit|funzion|stabil|ok\b/.test(t)) return "bene";
  return "";
}

/** Foglio per correggere la sintesi a mano. Svuotarla la toglie. */
export function apriSintesi(progetto) {
  const area = el("textarea", { rows: Math.min(18, (progetto.sintesi || "").split("\n").length + 2), autofocus: true });
  area.value = progetto.sintesi || "";
  openSheet({
    title: `Sintesi di ${progetto.name}`,
    body: [
      el("div.taccuino", {}, area),
      el("p.meta", { style: "margin-top:6px" }, "Testo semplice: «## » per ogni tema, sotto «Stato: …» se vuoi, poi «- » per gli elenchi. L'AI ne propone una versione aggiornata dopo ogni nota del diario."),
    ],
    onConfirm: () => {
      update("projects", progetto.id, { sintesi: area.value.trim(), sintesiAt: new Date() });
      toast("Sintesi salvata");
    },
  });
}
