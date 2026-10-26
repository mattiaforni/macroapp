// Sintesi di un progetto: un testo vivo con lo stato del progetto e ciò che è emerso dalle note del
// diario (cosa ho imparato, su cosa lavorare…), organizzato secondo le istruzioni del progetto.
// La scrive l'agente come proposta dopo ogni nota analizzata; confermata, finisce in
// `projects.sintesi`. Da qui si legge, ripiegata, e si corregge a mano.
// Compare in alto nel Diario e nei Task quando si guarda un solo progetto.
import { el, icon, toast, testoRicco } from "../core/ui.js";
import { update } from "../core/db.js";
import { openSheet } from "./sheet.js";

const aperte = new Set(); // progetti di cui si legge la sintesi per intero

/** Foglio per correggere la sintesi a mano. Svuotarla la toglie. */
export function apriSintesi(progetto) {
  const area = el("textarea", { rows: Math.min(18, (progetto.sintesi || "").split("\n").length + 2), autofocus: true });
  area.value = progetto.sintesi || "";
  openSheet({
    title: `Sintesi di ${progetto.name}`,
    body: [
      el("div.taccuino", {}, area),
      el("p.meta", { style: "margin-top:6px" }, "Testo semplice: «## » per i titoli, «- » per gli elenchi. L'AI ne propone una versione aggiornata dopo ogni nota del diario."),
    ],
    onConfirm: () => {
      update("projects", progetto.id, { sintesi: area.value.trim(), sintesiAt: new Date() });
      toast("Sintesi salvata");
    },
  });
}

/**
 * Il blocco della sintesi: etichetta, testo (le prime righe, poi «Leggi tutto») e, toccandolo, il foglio.
 * Senza sintesi e con le istruzioni, dice che arriverà come proposta. `ridisegna` è il render della pagina.
 */
export function bloccoSintesi(progetto, ridisegna) {
  if (!progetto.sintesi) {
    return progetto.istruzioni
      ? el("p.meta.sintesi-vuota", {}, "Nessuna sintesi ancora: l'AI la propone dopo la prossima nota analizzata. ",
          el("button.btn.btn--piatto", { onclick: () => apriSintesi(progetto) }, "Scrivila tu"))
      : null;
  }
  const aperta = aperte.has(progetto.id);
  return el("div.sintesi", { class: aperta ? "sintesi--aperta" : "" },
    el("div.sintesi__testa", {},
      el("small", {}, icon("diario"), "Sintesi"),
      el("button.tondo.tondo--piatto", { "aria-label": "Modifica la sintesi", onclick: () => apriSintesi(progetto) }, icon("matita")),
    ),
    el("div.sintesi__testo.sintesi-testo", { onclick: () => apriSintesi(progetto) }, ...testoRicco(progetto.sintesi)),
    el("button.nota__apri", { type: "button", "aria-expanded": aperta ? "true" : "false",
      onclick: () => { aperta ? aperte.delete(progetto.id) : aperte.add(progetto.id); ridisegna(); } },
      icon("giu"), aperta ? "Riduci" : "Leggi tutto"),
  );
}
