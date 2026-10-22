// Coda delle proposte: ciò che l'app suggerisce (dal diario, dalla banca, da contenuti condivisi).
import { el } from "../../core/ui.js";
import { watchPending, renderProposal, propose } from "../../components/proposals.js";
import { VIS } from "../../core/db.js";

export const id = "proposte";
export const title = "Proposte";
export const nav = true;
export const icon = "proposte";

export function mount(container) {
  const list = el("div");
  container.append(
    el("p.small.muted", {}, "Niente entra nei moduli senza il tuo sì."),
    list,
  );

  // Contenuto arrivato via Web Share Target (vedi app.js): diventa una proposta di appunto.
  const shared = sessionStorage.getItem("macroapp.share");
  if (shared) {
    sessionStorage.removeItem("macroapp.share");
    const s = JSON.parse(shared);
    const text = [s.title, s.text, s.url].filter(Boolean).join("\n");
    propose({ kind: "note", source: "share", target: "notes", payload: { text }, summary: text.slice(0, 140), visibility: VIS.PRIVATE });
  }

  return watchPending((items) => {
    list.replaceChildren(...items.map((p) => renderProposal(p)));
    if (!items.length) list.replaceChildren(el("div.empty", {}, "Nessuna proposta in attesa."));
  });
}
