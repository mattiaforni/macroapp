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
