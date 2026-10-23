// Rubrica: le voci del manuale (negozi, persone, informazioni) tenute in memoria e aggiornate
// in tempo reale, così task, proposte e bozze possono riconoscere le persone per nome
// senza rifare query ogni volta.
//
// Le persone sono voci del manuale con type "person": un solo posto per i contatti.
import { watchVisible, create, VIS } from "./db.js";

const COLL = "manual_entries";
let voci = [];
let stop = null;
const ascoltatori = new Set();

export function avviaRubrica() {
  if (stop) return;
  stop = watchVisible(COLL, { order: ["name", "asc"] }, (docs) => {
    voci = docs;
    ascoltatori.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  });
}

export function fermaRubrica() { stop?.(); stop = null; voci = []; }

/** fn() a ogni cambiamento; ritorna la funzione per smettere. */
export function suRubrica(fn) { ascoltatori.add(fn); return () => ascoltatori.delete(fn); }

export const persone = () => voci.filter((v) => v.type === "person");
export const vociRubrica = () => voci;

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

export function personaDaId(id) { return voci.find((v) => v.id === id) || null; }

/** Nome completo uguale, oppure nome proprio uguale se è l'unica persona con quel nome. */
export function trovaPersona(nome) {
  const n = norm(nome);
  if (!n) return null;
  const p = persone();
  const esatta = p.find((x) => norm(x.name) === n);
  if (esatta) return esatta;
  const perNome = p.filter((x) => norm(x.name).split(" ")[0] === n.split(" ")[0] && n.split(" ").length === 1);
  return perNome.length === 1 ? perNome[0] : null;
}

/** "Marco, Giulia e Luca" → ["Marco", "Giulia", "Luca"] */
export function separaNomi(testo) {
  return String(testo || "").split(/\s*(?:,|;|\be\b|\bed\b)\s*/i).map((s) => s.trim()).filter(Boolean);
}

/** Id delle persone con quei nomi; quelle che non ci sono vengono aggiunte alla rubrica. */
export function risolviPersone(nomi, visibility = VIS.PRIVATE) {
  return nomi.map((nome) => {
    const p = trovaPersona(nome);
    if (p) return p.id;
    const cap = nome.charAt(0).toUpperCase() + nome.slice(1);
    const nuovo = create(COLL, { type: "person", name: cap, category: "", notes: "", phone: "", email: "", address: "", url: "" }, visibility);
    voci = [...voci, { id: nuovo.id, type: "person", name: cap, visibility }]; // subito disponibile
    return nuovo.id;
  });
}

export function nomiDa(ids = []) {
  return ids.map((id) => personaDaId(id)?.name).filter(Boolean);
}

/** Persone di un task da mostrare: i nomi dalla rubrica, o il testo salvato insieme al task
 *  (serve quando una persona è una voce privata dell'altro membro della casa). */
export function nomiTask(t) {
  const ids = t.peopleIds || [];
  const nomi = nomiDa(ids);
  if (ids.length && nomi.length === ids.length) return nomi.join(", ");
  return t.people || nomi.join(", ");
}

/** Numero per WhatsApp e Telegram: solo cifre, con il prefisso italiano se manca. */
export function numeroInternazionale(tel) {
  const n = String(tel || "").replace(/[^\d+]/g, "");
  if (!n) return "";
  if (n.startsWith("+")) return n.slice(1);
  if (n.startsWith("00")) return n.slice(2);
  return n.length === 10 && n.startsWith("3") ? `39${n}` : n;
}

/**
 * Modi di contattare una persona della rubrica: [{ canale, etichetta, icona, href }].
 * Telegram dal numero funziona solo se la persona si lascia trovare col numero.
 */
export function modiDiContatto(p) {
  if (!p) return [];
  const n = numeroInternazionale(p.phone);
  return [
    p.phone && { canale: "telefono", etichetta: "Chiama", icona: "telefono", href: `tel:${String(p.phone).replace(/\s+/g, "")}` },
    n && { canale: "whatsapp", etichetta: "WhatsApp", icona: "messaggio", href: `https://wa.me/${n}` },
    n && { canale: "telegram", etichetta: "Telegram", icona: "telegram", href: `https://t.me/+${n}` },
    p.phone && { canale: "sms", etichetta: "SMS", icona: "messaggio", href: `sms:${String(p.phone).replace(/\s+/g, "")}` },
    p.email && { canale: "mail", etichetta: "Mail", icona: "mail", href: `mailto:${p.email}` },
  ].filter(Boolean);
}

/** Il canale che il testo di un task suggerisce: «chiama» → telefono, «scrivi su Telegram» → telegram… */
export function canaleDa(testo) {
  const t = String(testo || "").toLowerCase();
  if (/telegram/.test(t)) return "telegram";
  if (/whats ?app|wa\b/.test(t)) return "whatsapp";
  if (/\bmail\b|e-?mail|posta/.test(t)) return "mail";
  if (/\bsms\b/.test(t)) return "sms";
  if (/messaggi|scriv|rispond|manda/.test(t)) return "whatsapp";
  if (/chiam|telefon|sentire|senti\b|contatt/.test(t)) return "telefono";
  return null;
}
