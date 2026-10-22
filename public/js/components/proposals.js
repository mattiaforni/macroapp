// Coda di proposte: elementi che l'app (o l'agente) suggerisce e l'utente approva o scarta.
//
// Documento in `proposals`:
//   kind        "shopping_item" | "manual_entry" | "task" | "note" | "expense" | ...
//   source      "agent" | "bank" | "share" | "rule"
//   status      "pending" | "accepted" | "rejected"
//   payload     i campi del documento che verrà creato se accettata
//   target      collezione di destinazione (es. "shopping_items")
//   summary     testo breve mostrato nella coda
//   explain     perché viene proposta (opzionale)
//
// I moduli e le Cloud Functions scrivono qui; questo componente li rende e li applica.

import { el, fmtDate } from "../core/ui.js";
import { create, update, watchVisible, VIS, where } from "../core/db.js";
import { session } from "../core/auth.js";

const COLL = "proposals";

/** Aggiunge una proposta alla coda (usato dal client, es. condivisione da altre app). */
export function propose({ kind, source, target, payload, summary, explain = "", visibility = VIS.SHARED }) {
  return create(COLL, { kind, source, target, payload, summary, explain, status: "pending" }, visibility);
}

export async function accept(p) {
  // Crea il documento di destinazione con la visibilità della proposta, poi segna la proposta.
  await create(p.target, p.payload, p.visibility || VIS.SHARED);
  await update(COLL, p.id, { status: "accepted", decidedBy: session.user.uid });
}

export function reject(p) {
  return update(COLL, p.id, { status: "rejected", decidedBy: session.user.uid });
}

export function watchPending(cb) {
  return watchVisible(COLL, { extra: [where("status", "==", "pending")] }, cb);
}

export function watchPendingCount(cb) {
  return watchPending((items) => cb(items.length));
}

const KIND_LABEL = {
  shopping_item: "Lista della spesa",
  manual_entry: "Manuale di casa",
  task: "Task",
  note: "Appunto",
  expense: "Spesa",
};

export function renderProposal(p, { onDone } = {}) {
  return el("div.card.proposal", {},
    el("div.row", {},
      el("span.tag", {}, KIND_LABEL[p.kind] || p.kind),
      el("span.small.muted.grow", {}, p.source === "agent" ? "dal diario" : p.source === "bank" ? "dalla banca" : p.source === "share" ? "condiviso" : ""),
      el("span.small.muted", {}, fmtDate(p.createdAt)),
    ),
    el("p", { style: "margin-top:8px" }, p.summary),
    p.explain ? el("p.small.muted", {}, p.explain) : null,
    el("div.proposal__actions", {},
      el("button.btn.btn--primary", { onclick: async (e) => { e.target.disabled = true; await accept(p); onDone?.(); } }, "Accetta"),
      el("button.btn", { onclick: async (e) => { e.target.disabled = true; await reject(p); onDone?.(); } }, "Scarta"),
    ),
  );
}
