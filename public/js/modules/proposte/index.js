// Tutte le azioni in attesa, da qualunque origine. Non è nella barra in basso:
// quelle dell'AI compaiono sotto le note del diario, quelle della banca andranno nelle spese.
import { el, vuoto } from "../../core/ui.js";
import { watchPending, renderAzione } from "../../components/proposals.js";

export const id = "proposte";
export const title = "In attesa";
export const nav = false;
const navIcon = "scintilla";
export { navIcon as icon };

export function mount(container) {
  const list = el("div.azioni-ai", { style: "margin-top:16px" });
  container.append(list);
  return watchPending((items) => {
    list.replaceChildren(...(items.length ? items.map(renderAzione) : [vuoto("Niente in attesa")]));
  });
}
