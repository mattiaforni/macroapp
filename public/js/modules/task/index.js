// Task: personali per impostazione predefinita, condivisibili. Base minima, da estendere (progetti, scadenze, ambiti).
// Collezione: tasks { text, done, due, area }
import { el, toast, visibilityToggle } from "../../core/ui.js";
import { create, update, remove, watchVisible, VIS } from "../../core/db.js";

export const id = "task";
export const title = "Task";
export const nav = false; // non in barra per ora: raggiungibile da Impostazioni o #/task
export const icon = "task";

const COLL = "tasks";

export function mount(container) {
  let tasks = [];
  let vis = VIS.PRIVATE;
  const input = el("input", { placeholder: "Nuovo task" });
  const list = el("ul.list");

  async function add() {
    const t = input.value.trim();
    if (!t) return;
    input.value = "";
    await create(COLL, { text: t, done: false, due: null, area: "" }, vis);
  }

  function render() {
    list.replaceChildren(...tasks.map((t) => el("li.list__item", { className: `list__item${t.done ? " list__item--done" : ""}` },
      el("button.check", { role: "checkbox", "aria-checked": String(!!t.done), onclick: () => update(COLL, t.id, { done: !t.done }) }),
      el("span.list__text", {}, t.text, " ", t.visibility === VIS.SHARED ? el("span.tag", {}, "condiviso") : null),
      el("button.btn.btn--ghost.btn--icon", { onclick: () => remove(COLL, t.id), "aria-label": "Elimina" }, "×"),
    )));
    if (!tasks.length) list.replaceChildren(el("li.empty", {}, "Nessun task."));
  }

  container.append(
    el("div.row", { style: "margin-bottom:12px" }, input, visibilityToggle(vis, (v) => { vis = v; }), el("button.btn.btn--primary", { onclick: add }, "+")),
    el("div.card", {}, list),
  );
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });

  return watchVisible(COLL, {}, (docs) => { tasks = docs; render(); });
}
