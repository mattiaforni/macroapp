// Rubrica: le voci del manuale (negozi, persone, informazioni) tenute in memoria e aggiornate
// in tempo reale, così task, proposte e bozze possono riconoscere le persone per nome
// senza rifare query ogni volta.
//
// Le persone sono voci del manuale con type "person": un solo posto per i contatti.
// Una persona presa da Google Contatti ha `googleId`: telefono, mail e indirizzo si aggiornano da
// Google (sincronizzaDaGoogle); il nome resta quello della rubrica.
import { watchVisible, create, update, VIS } from "./db.js";
import { session } from "./auth.js";
import { contattiCollegati, caricaContatti, contattoUnico, contattiConNome } from "./contatti-google.js";

const COLL = "manual_entries";
let voci = [];
let stop = null;
const ascoltatori = new Set();
let segnaPronta;
let pronta = new Promise((r) => { segnaPronta = r; });

export function avviaRubrica() {
  if (stop) return;
  stop = watchVisible(COLL, { order: ["name", "asc"] }, (docs) => {
    voci = docs;
    segnaPronta();
    ascoltatori.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  });
}

export function fermaRubrica() {
  stop?.(); stop = null; voci = [];
  pronta = new Promise((r) => { segnaPronta = r; });
}

/** fn() a ogni cambiamento; ritorna la funzione per smettere. */
export function suRubrica(fn) { ascoltatori.add(fn); return () => ascoltatori.delete(fn); }

export const persone = () => voci.filter((v) => v.type === "person");
export const vociRubrica = () => voci;

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

export function personaDaId(id) { return voci.find((v) => v.id === id) || null; }
export function personaDaGoogle(googleId) { return googleId ? persone().find((v) => v.googleId === googleId) || null : null; }

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

/** Campi di una voce della rubrica presi da un contatto Google. */
export function datiDaContatto(c) {
  return { name: c.name, phone: c.phone || "", email: c.email || "", address: c.address || "", googleId: c.googleId };
}

/** Crea una persona in rubrica (collegata a Google se c'è `google`) e ritorna il suo id. */
function nuovaPersona(nome, visibility, google = null) {
  const cap = nome.charAt(0).toUpperCase() + nome.slice(1);
  const dati = { type: "person", name: cap, category: "", notes: "", phone: "", email: "", address: "", url: "",
    ...(google ? { ...datiDaContatto(google), name: google.name, notes: google.org || "" } : {}) };
  const nuovo = create(COLL, dati, visibility);
  voci = [...voci, { id: nuovo.id, ...dati, visibility, ownerUid: session.user?.uid }]; // subito disponibile
  return nuovo.id;
}

/**
 * Id delle persone indicate; quelle che non ci sono vengono aggiunte alla rubrica.
 * Ogni voce è un nome, oppure { name, google } quando è stato scelto un contatto Google, oppure
 * { name, nuova: true } quando si è scelto esplicitamente un nome nuovo (niente Google).
 * Un nome che non è in rubrica si collega a Google se corrisponde a un solo contatto
 * (serve l'elenco dei contatti già letto: caricaContatti).
 */
export function risolviPersone(nomi, visibility = VIS.PRIVATE) {
  return nomi.map((v) => {
    const nome = typeof v === "string" ? v : v.name;
    const google = typeof v === "string" ? null : v.google;
    if (google) return (personaDaGoogle(google.googleId) || {}).id || nuovaPersona(nome, visibility, google);
    const p = trovaPersona(nome);
    if (p) {
      // Già in rubrica ma non collegata: si collega al contatto Google con lo stesso nome, se è uno solo.
      const gemelli = p.googleId ? [] : contattiConNome(p.name).filter((c) => !personaDaGoogle(c.googleId));
      if (gemelli.length === 1) collegaAGoogle(p.id, gemelli[0]);
      return p.id;
    }
    const unico = v.nuova ? null : contattoUnico(nome);
    const giàCollegata = unico && personaDaGoogle(unico.googleId);
    if (giàCollegata) return giàCollegata.id;
    return nuovaPersona(nome, visibility, unico);
  });
}

/**
 * Recapiti delle persone collegate a Google, aggiornati con quelli di Google.
 * Solo le voci proprie (vengono dal proprio account Google); un campo vuoto in Google non
 * cancella quello della rubrica. Ritorna quante voci ha aggiornato.
 */
export async function sincronizzaDaGoogle() {
  if (!contattiCollegati()) return 0;
  const [contatti] = await Promise.all([caricaContatti(), pronta]);
  const mio = session.user?.uid;
  let n = 0;
  for (const p of persone()) {
    if (!p.googleId || p.ownerUid !== mio) continue;
    const c = contatti.find((x) => x.googleId === p.googleId);
    const diff = c ? differenzeDaGoogle(p, c) : {};
    if (Object.keys(diff).length) { update(COLL, p.id, diff); n++; }
  }
  return n;
}

/** Collega a un contatto Google una voce già in rubrica: prende i suoi recapiti, tiene il nome. */
export function collegaAGoogle(id, c) {
  const p = personaDaId(id);
  if (!p || p.googleId) return;
  const dati = { googleId: c.googleId, ...differenzeDaGoogle(p, c) };
  update(COLL, id, dati);
  Object.assign(p, dati); // subito valido in memoria (scorciatoie del task appena salvato)
}

/** Campi da aggiornare su una voce collegata: { phone?, email?, address? }. */
export function differenzeDaGoogle(p, c) {
  const d = {};
  for (const k of ["phone", "email", "address"]) if (c[k] && c[k] !== (p[k] || "")) d[k] = c[k];
  return d;
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
