// Manuale di casa: negozi e fornitori utili, informazioni di casa (codici, tecnici, istruzioni).
// Collezione: manual_entries { type: "shop" | "info", name, category, notes, address, phone, url }
import { el, toast, visibilityToggle } from "../../core/ui.js";
import { create, update, remove, watchVisible, VIS } from "../../core/db.js";

export const id = "manuale";
export const title = "Manuale";
export const nav = true;
export const icon = "manuale";

const COLL = "manual_entries";
const CATEGORIES = ["Idraulica", "Elettricità", "Vernici e ferramenta", "Agraria e giardino", "Edilizia", "Auto", "Casa", "Altro"];

export function mount(container) {
  let entries = [];
  let filter = "";
  let editing = null; // entry in modifica o null

  const form = el("div.card", { hidden: true });
  const list = el("div");
  const search = el("input", { placeholder: "Cerca (nome, categoria, note)", oninput: (e) => { filter = e.target.value.toLowerCase(); render(); } });

  function openForm(entry = null) {
    editing = entry;
    const d = entry || { type: "shop", name: "", category: CATEGORIES[0], notes: "", address: "", phone: "", url: "", visibility: VIS.SHARED };
    let vis = d.visibility;
    const f = {
      type: el("select", {}, el("option", { value: "shop", selected: d.type === "shop" }, "Negozio / fornitore"), el("option", { value: "info", selected: d.type === "info" }, "Informazione di casa")),
      name: el("input", { value: d.name, placeholder: "Nome" }),
      category: el("select", {}, ...CATEGORIES.map((c) => el("option", { value: c, selected: c === d.category }, c))),
      address: el("input", { value: d.address, placeholder: "Indirizzo o luogo" }),
      phone: el("input", { value: d.phone, placeholder: "Telefono", type: "tel" }),
      url: el("input", { value: d.url, placeholder: "Sito o link Maps", type: "url" }),
      notes: el("textarea", { value: d.notes, placeholder: "Note: cosa vendono, orari, chi chiedere…" }),
    };
    form.replaceChildren(
      el("h2", {}, entry ? "Modifica voce" : "Nuova voce"),
      el("div.field", {}, el("label", {}, "Tipo"), f.type),
      el("div.field", {}, el("label", {}, "Nome"), f.name),
      el("div.field", {}, el("label", {}, "Categoria"), f.category),
      el("div.field", {}, el("label", {}, "Indirizzo"), f.address),
      el("div.row", {}, el("div.field.grow", {}, el("label", {}, "Telefono"), f.phone), el("div.field.grow", {}, el("label", {}, "Link"), f.url)),
      el("div.field", {}, el("label", {}, "Note"), f.notes),
      el("div.field", {}, el("label", {}, "Visibilità"), visibilityToggle(vis, (v) => { vis = v; })),
      el("div.row", {},
        el("button.btn.btn--primary", { onclick: async () => {
          const data = Object.fromEntries(Object.entries(f).map(([k, n]) => [k, n.value.trim()]));
          if (!data.name) return toast("Serve un nome");
          if (entry) await update(COLL, entry.id, { ...data, visibility: vis });
          else await create(COLL, data, vis);
          closeForm();
        } }, "Salva"),
        el("button.btn", { onclick: closeForm }, "Annulla"),
        entry ? el("button.btn.btn--danger", { onclick: async () => { await remove(COLL, entry.id); closeForm(); } }, "Elimina") : null,
      ),
    );
    form.hidden = false;
    form.scrollIntoView({ behavior: "smooth" });
  }

  function closeForm() { editing = null; form.hidden = true; form.replaceChildren(); }

  function card(e) {
    return el("div.card", { onclick: () => openForm(e), style: "cursor:pointer" },
      el("div.row", {},
        el("strong.grow", {}, e.name),
        e.visibility === VIS.PRIVATE ? el("span.tag.tag--private", {}, "personale") : null,
        el("span.tag", {}, e.type === "info" ? "info" : e.category),
      ),
      e.address ? el("div.small.muted", {}, e.address) : null,
      e.notes ? el("p.small", { style: "margin:6px 0 0" }, e.notes) : null,
      (e.phone || e.url) ? el("div.row.small", { style: "margin-top:6px" },
        e.phone ? el("a", { href: `tel:${e.phone}`, onclick: (ev) => ev.stopPropagation() }, e.phone) : null,
        e.url ? el("a", { href: e.url, target: "_blank", rel: "noopener", onclick: (ev) => ev.stopPropagation() }, "Apri link") : null,
      ) : null,
    );
  }

  function render() {
    const q = filter;
    const shown = entries.filter((e) => !q || [e.name, e.category, e.notes, e.address].join(" ").toLowerCase().includes(q));
    const shops = shown.filter((e) => e.type !== "info");
    const infos = shown.filter((e) => e.type === "info");
    list.replaceChildren(...[
      shops.length ? el("h3", {}, "Negozi e fornitori") : null,
      ...shops.map(card),
      infos.length ? el("h3", {}, "Informazioni di casa") : null,
      ...infos.map(card),
      !shown.length ? el("div.empty", {}, "Nessuna voce.") : null,
    ].filter(Boolean));
  }

  container.append(
    el("div.row", { style: "margin-bottom:12px" }, search, el("button.btn.btn--primary", { onclick: () => openForm() }, "Nuova")),
    form,
    list,
  );

  return watchVisible(COLL, { order: ["name", "asc"] }, (docs) => { entries = docs; render(); });
}
