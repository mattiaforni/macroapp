// Lista della spesa condivisa, in tempo reale, con cache offline.
// Collezione: shopping_items { text, done, doneAt, doneBy, section }
import { el, toast } from "../../core/ui.js";
import { create, update, remove, watchVisible, VIS } from "../../core/db.js";
import { session } from "../../core/auth.js";

export const id = "lista";
export const title = "Lista";
export const nav = true;
export const icon = "lista";

const COLL = "shopping_items";

/** "latte, 6 uova; pane" → ["latte", "6 uova", "pane"] (in futuro: normalizzazione via agente). */
function splitItems(text) {
  return text.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
}

export function mount(container) {
  let items = [];
  const input = el("input", { placeholder: "Aggiungi (più voci con la virgola)", enterkeyhint: "done", "aria-label": "Nuova voce" });
  const list = el("ul.list");
  const doneList = el("ul.list");
  const doneHeader = el("h3", {}, "Presi");
  const clearBtn = el("button.btn.btn--ghost.small", { onclick: clearDone }, "Svuota presi");

  async function add() {
    const parts = splitItems(input.value);
    if (!parts.length) return;
    input.value = "";
    await Promise.all(parts.map((text) => create(COLL, { text, done: false }, VIS.SHARED)));
  }

  async function toggle(it) {
    await update(COLL, it.id, {
      done: !it.done,
      doneBy: !it.done ? session.user.uid : null,
    });
  }

  async function clearDone() {
    const done = items.filter((i) => i.done);
    await Promise.all(done.map((i) => remove(COLL, i.id)));
    toast(`${done.length} voci rimosse`);
  }

  function row(it) {
    return el("li.list__item", { className: `list__item${it.done ? " list__item--done" : ""}` },
      el("button.check", { role: "checkbox", "aria-checked": String(!!it.done), onclick: () => toggle(it), "aria-label": it.text }),
      el("span.list__text", {}, it.text),
      el("button.btn.btn--ghost.btn--icon", { onclick: () => remove(COLL, it.id), "aria-label": "Elimina" }, "×"),
    );
  }

  function render() {
    const open = items.filter((i) => !i.done);
    const done = items.filter((i) => i.done);
    list.replaceChildren(...open.map(row));
    doneList.replaceChildren(...done.map(row));
    doneHeader.hidden = clearBtn.hidden = done.length === 0;
    if (!items.length) list.replaceChildren(el("li.empty", {}, "La lista è vuota."));
  }

  container.append(
    el("div.row", { style: "margin-bottom:12px" },
      input,
      el("button.btn.btn--primary", { onclick: add }, "Aggiungi"),
    ),
    el("div.card", {}, list),
    doneHeader,
    el("div.card", {}, doneList, el("div", { style: "margin-top:8px" }, clearBtn)),
  );
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });

  const unwatch = watchVisible(COLL, { order: ["createdAt", "asc"] }, (docs) => { items = docs; render(); });
  return unwatch;
}
