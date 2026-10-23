// Azioni proposte: ciò che l'AI (o la banca, o un contenuto condiviso) suggerisce e tu confermi o scarti.
// Nel diario compaiono sotto la nota da cui nascono.
//
// Documento in `proposals`:
//   kind        "task" | "shopping_item" | "manual_entry" | "note" | "expense" | "draft"
//   source      "agent" | "bank" | "share"
//   status      "pending" | "accepted" | "rejected"
//   payload     i dati dell'azione (diversi per tipo, vedi APPLICA)
//   summary     una riga che descrive l'azione
//   sourceEntryId  la nota del diario da cui nasce (se viene dall'agente)
//   visibility  "shared" se riguarda la casa/coppia, "private" se è solo tua

import { el, icon, toast } from "../core/ui.js";
import { create, update, watchVisible, readVisible, VIS, where } from "../core/db.js";
import { session } from "../core/auth.js";
import { aggiungiVoci } from "../modules/lista/index.js";
import { risolviProgetto } from "../modules/task/index.js";
import { categoria } from "../modules/spese/index.js";
import { separaNomi, risolviPersone, nomiDa, trovaPersona } from "../core/rubrica.js";

const COLL = "proposals";

export const TIPI = {
  task: { nome: "Task", icona: "task" },
  shopping_item: { nome: "Lista", icona: "lista" },
  manual_entry: { nome: "Manuale", icona: "negozio" },
  note: { nome: "Appunto", icona: "appunto" },
  expense: { nome: "Spesa", icona: "spese" },
  draft: { nome: "Bozza", icona: "mail" },
};

/** Cosa succede quando confermi, tipo per tipo. Ritorna il messaggio di conferma. */
const APPLICA = {
  async shopping_item(p) {
    const voci = await readVisible("shopping_items", { order: ["createdAt", "asc"] });
    aggiungiVoci(p.payload.text, voci);
    return "Aggiunto alla lista";
  },
  async task(p) {
    const v = p.visibility || VIS.PRIVATE;
    const projectId = await risolviProgetto(p.payload.project, v);
    // Le persone nominate diventano voci della rubrica (o si collegano a quelle che ci sono già).
    const nomi = separaNomi(p.payload.people);
    const peopleIds = risolviPersone(nomi, v);
    create("tasks", {
      text: p.payload.text, done: false, due: p.payload.due || null, projectId,
      peopleIds, people: nomiDa(peopleIds).join(", ") || nomi.join(", "), note: p.payload.note || "",
    }, v);
    return "Task aggiunto";
  },
  async manual_entry(p) {
    const x = p.payload;
    const tipo = ["shop", "person", "info"].includes(x.type) ? x.type : "shop";
    create("manual_entries", {
      type: tipo, name: x.name || x.text || "", category: x.category && x.category !== "Altro" ? x.category : "",
      notes: x.notes || "", address: x.address || "", phone: x.phone || "", email: x.email || "", url: x.url || "",
    }, tipo === "person" ? VIS.PRIVATE : p.visibility || VIS.SHARED);
    return tipo === "person" ? "Aggiunto alla rubrica" : "Aggiunto al manuale";
  },
  async note(p) {
    create("notes", { text: p.payload.text || "" }, p.visibility || VIS.PRIVATE);
    return "Appunto salvato";
  },
  async expense(p) {
    const x = p.payload;
    // Dall'agente: pagata da te, divisa a metà. Dalla banca: data e pagatore del movimento.
    create("expenses", {
      description: x.description || x.text || "Spesa", amount: Number(x.amount) || 0, split: x.split || "equal",
      paidBy: x.paidBy || session.user.uid, date: x.date || new Date(), category: categoria(x.description),
      source: p.source === "bank" ? "bank" : "agent", ...(x.bankTxId ? { bankTxId: x.bankTxId } : {}),
    }, VIS.SHARED);
    return "Spesa aggiunta";
  },
  async draft(p) {
    const x = p.payload;
    create("notes", { type: "draft", channel: x.channel || "", to: x.to || "", subject: x.subject || "", text: x.body || "" }, VIS.PRIVATE);
    return "Bozza salvata tra gli appunti";
  },
};

export async function accept(p) {
  const fn = APPLICA[p.kind];
  if (!fn) { toast("Tipo di azione non gestito"); return; }
  update(COLL, p.id, { status: "accepted", decidedBy: session.user.uid });
  try { toast(await fn(p)); }
  catch (e) { console.error(e); toast("Non sono riuscito ad applicarla"); update(COLL, p.id, { status: "pending" }); }
}

export function reject(p) {
  update(COLL, p.id, { status: "rejected", decidedBy: session.user.uid });
}

/** Proposta creata dal telefono (es. testo condiviso da un'altra app). */
export function propose({ kind, source, payload, summary, visibility = VIS.PRIVATE, sourceEntryId = null }) {
  return create(COLL, { kind, source, payload, summary, status: "pending", sourceEntryId }, visibility);
}

export function watchPending(cb) {
  return watchVisible(COLL, { extra: [where("status", "==", "pending")] }, cb);
}

// ───────────── Disegno ─────────────

async function copia(testo) {
  try { await navigator.clipboard.writeText(testo); toast("Copiato"); }
  catch (e) { toast("Non riesco a copiare da qui"); }
}

/** Numero per WhatsApp: solo cifre, con il prefisso italiano se manca. */
function numeroWhatsApp(tel) {
  let n = String(tel || "").replace(/[^\d+]/g, "");
  if (n.startsWith("+")) return n.slice(1);
  if (n.startsWith("00")) return n.slice(2);
  return n.length === 10 && n.startsWith("3") ? `39${n}` : n;
}

function bozza(x) {
  const corpo = x.body || "";
  const mail = x.channel === "email";
  // Il destinatario può essere un nome: se è in rubrica, si usano la sua mail o il suo telefono.
  const persona = x.to && !x.to.includes("@") ? trovaPersona(x.to) : null;
  const a = x.to?.includes("@") ? x.to : persona?.email || "";
  const wa = numeroWhatsApp(persona?.phone);
  const href = mail
    ? `mailto:${encodeURIComponent(a)}?subject=${encodeURIComponent(x.subject || "")}&body=${encodeURIComponent(corpo)}`
    : `https://wa.me/${wa}?text=${encodeURIComponent(corpo)}`;
  return el("div.bozza", {},
    x.subject ? el("div.bozza__oggetto", {}, x.subject) : null,
    el("div", {}, corpo),
    el("div.bozza__azioni", {},
      el("button.pillola", { type: "button", onclick: () => copia(x.subject ? `${x.subject}\n\n${corpo}` : corpo) }, icon("copia"), "Copia"),
      x.channel === "documento" ? null : el("a.pillola", { href, target: "_blank", rel: "noopener", style: "text-decoration:none" },
        icon(mail ? "mail" : "messaggio"), mail ? "Apri nella mail" : "Apri in WhatsApp"),
    ),
  );
}

/** Una riga d'azione: icona, tipo, descrizione, conferma/scarta. */
export function renderAzione(p) {
  const tipo = TIPI[p.kind] || { nome: p.kind, icona: "scintilla" };
  const dettagli = [];
  if (p.kind === "task") {
    const x = p.payload || {};
    const extra = [x.project && `progetto ${x.project}`, x.due && `entro ${x.due.split("-").reverse().join("/")}`, x.people].filter(Boolean).join(" · ");
    if (extra) dettagli.push(el("span.meta", { style: "display:block" }, extra));
  }
  return el("div.azione", {},
    icon(tipo.icona),
    el("div.testo", {},
      el("small", {}, tipo.nome, p.visibility === VIS.SHARED ? " · condiviso" : ""),
      p.summary,
      ...dettagli,
      p.kind === "draft" ? bozza(p.payload || {}) : null,
    ),
    el("button.sì", { type: "button", "aria-label": "Conferma", onclick: (e) => { e.currentTarget.disabled = true; accept(p); } }, icon("spunta")),
    el("button.no", { type: "button", "aria-label": "Scarta", onclick: () => reject(p) }, icon("chiudi")),
  );
}
