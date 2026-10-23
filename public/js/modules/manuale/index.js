// Manuale di casa: negozi e fornitori utili, informazioni di casa (codici, tecnici, istruzioni).
// manual_entries { type: "shop" | "info", name, category, notes, address, phone, url }
import { el, icon, toast, fascia, vuoto, sceltaVisibilita } from "../../core/ui.js";
import { create, update, remove, watchVisible, VIS } from "../../core/db.js";
import { openSheet, campo } from "../../components/sheet.js";

export const id = "manuale";
export const title = "Manuale";
export const nav = true;
const navIcon = "manuale";
export { navIcon as icon };

const COLL = "manual_entries";
const CATEGORIE = ["Idraulica", "Elettricità", "Vernici e ferramenta", "Agraria e giardino", "Edilizia", "Auto", "Casa", "Salute", "Altro"];
const ICONA_CAT = {
  "Idraulica": "goccia", "Elettricità": "lampadina", "Vernici e ferramenta": "negozio", "Agraria e giardino": "foglia",
  "Edilizia": "casa", "Auto": "macchina", "Casa": "casa", "Salute": "salute", "Altro": "negozio",
};

/** Foglio di una voce del manuale. Esportato: lo usa anche il diario. */
export function apriVoceManuale(esistente = null, prefill = {}) {
  const d = esistente || { type: "shop", category: "Altro", visibility: VIS.SHARED, ...prefill };
  let tipo = d.type || "shop";
  let categoria = d.category || "Altro";
  let visibility = d.visibility || VIS.SHARED;

  const nome = el("input.linea-input", { value: d.name || "", placeholder: "Nome", autofocus: true, style: "font-size:19px" });
  const tipi = el("div.segmenti", { style: "padding-top:0" });
  const disegnaTipi = () => tipi.replaceChildren(
    ...[["shop", "Negozio o fornitore"], ["info", "Informazione di casa"]].map(([v, l]) =>
      el("button.pillola", { type: "button", class: v === tipo ? "on" : "", onclick: () => { tipo = v; disegnaTipi(); } }, l)),
  );
  disegnaTipi();
  const cats = el("div.segmenti", { style: "padding-top:0;flex-wrap:wrap" });
  const disegnaCat = () => cats.replaceChildren(
    ...CATEGORIE.map((c) => el("button.pillola", { type: "button", class: c === categoria ? "on" : "", onclick: () => { categoria = c; disegnaCat(); } }, c)),
  );
  disegnaCat();
  const indirizzo = el("input", { value: d.address || "", placeholder: "Via, paese" });
  const tel = el("input", { value: d.phone || "", placeholder: "Telefono", type: "tel" });
  const link = el("input", { value: d.url || "", placeholder: "Sito o link di Maps", type: "url" });
  const note = el("textarea", { value: d.notes || "", placeholder: "Cosa vendono, orari, chi chiedere, codici…" });

  const sheet = openSheet({
    title: esistente ? esistente.name : "Nuova voce",
    body: [
      el("div.campo", { style: "margin-top:14px" }, nome),
      el("div.campo", {}, el("label", {}, "Tipo"), tipi),
      el("div.campo", {}, el("label", {}, "Categoria"), cats),
      campo("Indirizzo", indirizzo),
      el("div.due", {}, campo("Telefono", tel), campo("Link", link)),
      campo("Note", note),
      el("div.campo", {}, el("label", {}, "Visibilità"), sceltaVisibilita(visibility, (v) => { visibility = v; })),
      esistente ? el("div.foglio__piede", {},
        el("button.btn.btn--pericolo", { onclick: () => { remove(COLL, esistente.id); sheet.close(); toast("Voce eliminata"); } }, icon("cestino"), "Elimina"),
      ) : null,
    ],
    onConfirm: () => {
      const dati = {
        type: tipo, name: nome.value.trim(), category: categoria, address: indirizzo.value.trim(),
        phone: tel.value.trim(), url: link.value.trim(), notes: note.value.trim(),
      };
      if (!dati.name) { nome.focus(); return false; }
      if (esistente) update(COLL, esistente.id, { ...dati, visibility });
      else create(COLL, dati, visibility);
    },
  });
}

export function mount(container) {
  let entries = [];
  let filtro = "";

  const cerca = el("input.linea-input", { placeholder: "Cerca: nome, categoria, note", style: "margin-top:14px",
    oninput: (e) => { filtro = e.target.value.toLowerCase(); render(); } });
  const elenco = el("div");
  const fab = el("button.fab.fab--tondo", { type: "button", "aria-label": "Nuova voce", onclick: () => apriVoceManuale() }, icon("piu"));

  function riga(e) {
    const sotto = [e.type === "info" ? null : e.category, e.address, e.visibility === VIS.PRIVATE ? "solo tu" : null].filter(Boolean).join(" · ");
    return el("div.riga", { onclick: () => apriVoceManuale(e) },
      el("div.pallino", {}, icon(e.type === "info" ? "info" : ICONA_CAT[e.category] || "negozio")),
      el("div.testo", {}, el("b", {}, e.name), sotto ? el("span", {}, sotto) : null,
        e.notes ? el("span", {}, e.notes) : null),
      e.phone ? el("a.tondo", { href: `tel:${e.phone}`, "aria-label": "Chiama", onclick: (ev) => ev.stopPropagation() }, icon("telefono")) : null,
      e.url ? el("a.tondo", { href: e.url, target: "_blank", rel: "noopener", "aria-label": "Apri link", onclick: (ev) => ev.stopPropagation() }, icon("collegamento")) : null,
    );
  }

  function render() {
    const q = filtro;
    const visti = entries
      .filter((e) => !q || [e.name, e.category, e.notes, e.address].join(" ").toLowerCase().includes(q))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const negozi = visti.filter((e) => e.type !== "info");
    const info = visti.filter((e) => e.type === "info");
    elenco.replaceChildren(...[
      negozi.length ? fascia("Negozi e fornitori") : null,
      negozi.length ? el("div", {}, ...negozi.map(riga)) : null,
      info.length ? fascia("Informazioni di casa") : null,
      info.length ? el("div", {}, ...info.map(riga)) : null,
      !visti.length ? vuoto(q ? "Nessun risultato" : "Il manuale è vuoto", q ? null : "Segna qui i negozi utili (idraulica, vernici, agraria…) e le informazioni di casa.") : null,
    ].filter(Boolean));
  }

  container.append(cerca, elenco, fab);
  const stop = watchVisible(COLL, { order: ["name", "asc"] }, (docs) => { entries = docs; render(); });
  return () => { stop(); fab.remove(); };
}
