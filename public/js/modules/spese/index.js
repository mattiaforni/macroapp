// Spese condivise (sostituto di Splitwise).
// Collezione: expenses { amount, description, paidBy, split: "equal"|"full", date, category, source: "manual"|"bank", bankTxId }
// La sincronizzazione bancaria (Enable Banking) arriva dalle Cloud Functions come proposte nella coda:
// vedi functions/src/banking/. Qui: inserimento manuale e saldo.
import { el, toast, fmtMoney, fmtDate } from "../../core/ui.js";
import { create, remove, watchVisible, VIS } from "../../core/db.js";
import { session } from "../../core/auth.js";
import { getHousehold } from "../../core/household.js";

export const id = "spese";
export const title = "Spese";
export const nav = true;
export const icon = "spese";

const COLL = "expenses";

export function mount(container) {
  let expenses = [];
  let members = [];
  const me = session.user.uid;

  // type=text + inputmode=decimal: accetta la virgola italiana senza dipendere dalla tastiera.
  const amount = el("input", { type: "text", inputmode: "decimal", placeholder: "0,00", "aria-label": "Importo" });
  const desc = el("input", { placeholder: "Descrizione" });
  const balance = el("div.card");
  const list = el("ul.list");

  async function add() {
    const a = parseFloat(String(amount.value).replace(",", "."));
    if (!a || !desc.value.trim()) return toast("Importo e descrizione");
    await create(COLL, {
      amount: a,
      description: desc.value.trim(),
      paidBy: me,
      split: "equal",
      date: new Date(),
      category: "",
      source: "manual",
    }, VIS.SHARED);
    amount.value = ""; desc.value = "";
  }

  function render() {
    // Saldo: con split "equal", ciascuno deve metà di ogni spesa pagata dall'altro.
    let net = 0; // positivo = l'altra persona deve a me
    for (const e of expenses) {
      const share = e.split === "full" ? e.amount : e.amount / 2;
      net += e.paidBy === me ? share : -share;
    }
    balance.replaceChildren(
      el("div.small.muted", {}, "Saldo"),
      el("div", { style: "font-size:24px;font-weight:600" }, fmtMoney(Math.abs(net))),
      el("div.small.muted", {}, net === 0 ? "In pari" : net > 0 ? "a tuo favore" : "a favore dell'altra persona"),
    );
    list.replaceChildren(...expenses.map((e) => el("li.list__item", {},
      el("div.list__text", {},
        el("div", {}, e.description),
        el("div.list__meta", {}, `${fmtDate(e.date)} · ${e.paidBy === me ? "tu" : "altra persona"}${e.source === "bank" ? " · banca" : ""}`),
      ),
      el("strong", {}, fmtMoney(e.amount)),
      el("button.btn.btn--ghost.btn--icon", { onclick: () => remove(COLL, e.id), "aria-label": "Elimina" }, "×"),
    )));
    if (!expenses.length) list.replaceChildren(el("li.empty", {}, "Nessuna spesa."));
  }

  container.append(
    balance,
    el("div.card", {},
      el("div.row", {}, el("div.grow", {}, amount), el("div.grow", { style: "flex:2" }, desc)),
      el("div.row", { style: "margin-top:8px" }, el("button.btn.btn--primary", { onclick: add }, "Aggiungi spesa")),
      el("p.small.muted", { style: "margin:8px 0 0" }, "I movimenti bancari, quando collegati, compaiono nella coda Proposte."),
    ),
    el("div.card", {}, list),
  );

  getHousehold().then((h) => { members = h?.members || []; });
  return watchVisible(COLL, { order: ["date", "desc"], max: 200 }, (docs) => { expenses = docs; render(); });
}
