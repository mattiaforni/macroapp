// Barra in basso personalizzabile (3/11, richiesta di Mattia: lei vuole il Calendario al posto del
// Diario, lui il Diario e il progetto Tennis). Ogni persona sceglie le sue sezioni e il loro ordine
// dalla pagina «Barra in basso» (menu → Account): `users.barra` = elenco di id, al più MASSIMO.
// Un id è una pagina (`PAGINE`) o un progetto, `progetto-<id del progetto>`: la sua route monta la
// pagina Progetto dopo aver scritto quale (`macroapp.progetto`, come fa il menu). L'app si apre
// sulla prima sezione. Senza scelta vale la barra di sempre (i moduli con `nav: true`).
// I nomi e i colori dei progetti si leggono da Firestore; una copia sta in localStorage perché la
// barra si disegni subito all'apertura, prima che arrivino.
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-firestore.js";
import { db } from "./firebase.js";
import { session } from "./auth.js";
import { readVisible } from "./db.js";
import { vaiA } from "./router.js";
import { modules, navModules } from "../modules/registry.js";
import * as progetto from "../modules/progetto/index.js";

export const MASSIMO = 5;
/** Le pagine che si possono mettere in barra, nell'ordine in cui si propongono. */
export const PAGINE = ["diario", "lista", "spese", "task", "calendario", "chiedi", "manuale", "proposte"];
const predefinita = () => navModules.map((m) => m.id); // letta al bisogno: registry.js importa anche questo file
const CHIAVE_PAGINA = "macroapp.progetto";  // progetto aperto nella pagina Progetto (modules/progetto)
const CHIAVE_NOMI = "macroapp.barra.progetti"; // { id: { name, colore } } dei progetti in barra

const leggi = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } };
const scrivi = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

export const idProgetto = (pid) => `progetto-${pid}`;
/** L'id del progetto se l'id della sezione è un progetto, altrimenti null. */
export const progettoDi = (id) => (typeof id === "string" && id.startsWith("progetto-") ? id.slice("progetto-".length) : null);

let progetti = null; // progetti non archiviati della casa, quando sono arrivati
let nomi = {};
try { nomi = JSON.parse(leggi(CHIAVE_NOMI, "{}")) || {}; } catch (e) { nomi = {}; }
const ascoltatori = new Set();

function valido(id) {
  if (PAGINE.includes(id)) return true;
  const pid = progettoDi(id);
  if (!pid) return false;
  return progetti ? progetti.some((p) => p.id === pid) : true; // prima della lettura ci si fida della scelta
}

/** Gli id scelti, puliti; mai vuoto. */
export function scelte() {
  const b = session.profile?.barra;
  const ids = Array.isArray(b) ? [...new Set(b.filter(valido))].slice(0, MASSIMO) : [];
  return ids.length ? ids : predefinita();
}

/** Una sezione da un id: { id, title, icon, colore, modulo, mount }. */
export function sezione(id) {
  const pid = progettoDi(id);
  if (!pid) {
    const m = modules.find((x) => x.id === id);
    return m && { id, title: m.title, icon: m.icon || m.id, colore: null, modulo: m, mount: m.mount };
  }
  const p = progetti?.find((x) => x.id === pid) || nomi[pid];
  return {
    id, title: p?.name || "Progetto", icon: "cartella", colore: p?.colore || null, modulo: progetto,
    mount: (container) => { scrivi(CHIAVE_PAGINA, pid); return progetto.mount(container); },
  };
}

/** Le sezioni della barra, in ordine. */
export function sezioni() { return scelte().map(sezione).filter(Boolean); }

/** La sezione aperta: la route, o il progetto aperto nella pagina Progetto se è in barra. */
export function sezioneAttiva(route) {
  if (route !== "progetto") return route;
  const id = idProgetto(leggi(CHIAVE_PAGINA, ""));
  return scelte().includes(id) ? id : route;
}

export function suBarra(fn) { ascoltatori.add(fn); return () => ascoltatori.delete(fn); }
function avvisa() { for (const fn of ascoltatori) { try { fn(); } catch (e) { console.error(e); } } }

/** I progetti tra cui scegliere (non archiviati, per nome); li legge una volta per sessione. */
export async function progettiDisponibili({ fresh = false } = {}) {
  if (progetti && !fresh) return progetti;
  const docs = await readVisible("projects");
  progetti = docs.filter((p) => !p.archived).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  // Copia dei nomi dei progetti in barra, per la prossima apertura.
  nomi = Object.fromEntries(scelte().map(progettoDi).filter(Boolean).map((pid) => {
    const p = progetti.find((x) => x.id === pid);
    return [pid, { name: p?.name || nomi[pid]?.name || "Progetto", colore: p?.colore || null }];
  }));
  scrivi(CHIAVE_NOMI, JSON.stringify(nomi));
  avvisa();
  return progetti;
}

/** Salva la scelta per la persona e aggiorna la barra. */
export async function salvaBarra(ids) {
  const puliti = [...new Set(ids.filter(valido))].slice(0, MASSIMO);
  if (!puliti.length) throw new Error("Serve almeno una sezione");
  await updateDoc(doc(db, "users", session.user.uid), { barra: puliti });
  if (session.profile) session.profile.barra = puliti;
  nomi = Object.fromEntries(puliti.map(progettoDi).filter(Boolean).map((pid) => {
    const p = progetti?.find((x) => x.id === pid);
    return [pid, { name: p?.name || nomi[pid]?.name || "Progetto", colore: p?.colore || null }];
  }));
  scrivi(CHIAVE_NOMI, JSON.stringify(nomi));
  avvisa();
}

/** Apre la pagina di un progetto: dalla sua sezione, se è in barra (così la barra lo segna e si scorre
 *  col dito), altrimenti dalla pagina Progetto. Lo usano il menu, il Diario e i Task. */
export function apriPaginaProgetto(pid) {
  scrivi(CHIAVE_PAGINA, pid);
  vaiA(scelte().includes(idProgetto(pid)) ? idProgetto(pid) : "progetto");
}
