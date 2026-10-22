// Diario personale (dettatura da tastiera) + agente: dal testo propone azioni nella coda.
// Collezione: journal_entries { text, analyzed, analyzedAt } — sempre visibility "private".
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-functions.js";
import { functions } from "../../core/firebase.js";
import { el, toast, fmtDate } from "../../core/ui.js";
import { create, update, remove, watchMine, VIS } from "../../core/db.js";

export const id = "diario";
export const title = "Diario";
export const nav = true;
export const icon = "diario";

const COLL = "journal_entries";
const analyzeEntry = httpsCallable(functions, "analyzeEntry");

export function mount(container) {
  let entries = [];
  const text = el("textarea", { placeholder: "Scrivi o detta. Es.: «Ricordarmi di chiamare l'idraulico, comprare le lampadine, idea per il volontariato…»" });
  const list = el("div");

  async function save() {
    const t = text.value.trim();
    if (!t) return;
    text.value = "";
    await create(COLL, { text: t, analyzed: false }, VIS.PRIVATE);
  }

  async function analyze(e, btn) {
    btn.disabled = true;
    try {
      const res = await analyzeEntry({ entryId: e.id });
      const n = res.data?.proposals ?? 0;
      await update(COLL, e.id, { analyzed: true, analyzedAt: new Date() });
      toast(n ? `${n} proposte in coda` : "Nessuna azione trovata");
    } catch (err) {
      toast("Analisi non riuscita: " + (err.message || err.code));
      btn.disabled = false;
    }
  }

  function card(e) {
    const btn = el("button.btn.small", { onclick: () => analyze(e, btn) }, e.analyzed ? "Rianalizza" : "Analizza");
    return el("div.card", {},
      el("div.row", {}, el("span.small.muted.grow", {}, fmtDate(e.createdAt)), e.analyzed ? el("span.tag", {}, "analizzata") : null),
      el("p", { style: "white-space:pre-wrap;margin:8px 0" }, e.text),
      el("div.row", {}, btn, el("button.btn.btn--ghost.small", { onclick: () => remove(COLL, e.id) }, "Elimina")),
    );
  }

  function render() {
    list.replaceChildren(...entries.map(card));
    if (!entries.length) list.replaceChildren(el("div.empty", {}, "Nessuna nota. Il diario è visibile solo a te."));
  }

  container.append(
    el("div.card", {},
      text,
      el("div.row", { style: "margin-top:8px" }, el("button.btn.btn--primary", { onclick: save }, "Salva nota")),
      el("p.small.muted", { style: "margin:8px 0 0" }, "«Analizza» invia il testo all'agente, che propone task, appunti o voci per la lista e il manuale. Tu approvi nella coda Proposte."),
    ),
    list,
  );

  return watchMine(COLL, {}, (docs) => { entries = docs; render(); });
}
