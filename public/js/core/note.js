// Chi vede le note del diario (7/11, richiesta di Mattia: «rendi le note dei progetti condivisi condivise anch'esse»).
// Una nota di un progetto condiviso è della casa, come il progetto: la leggono, la modificano, la rianalizzano e la
// eliminano tutti e due (seconda richiesta del 7/11: «le note condivise possono modificarle tutte»), nel Diario e nella
// pagina del progetto, con il nome di chi l'ha scritta; in fondo al foglio della nota chi l'ha modificata per ultimo
// (`modificataDa`, `modificataAt`). La visibilità la cambia solo chi l'ha scritta. Le altre note (senza progetto o di
// un progetto solo tuo) restano solo di chi le scrive. Le foto seguono la nota.
//
// La visibilità si decide quando la nota si salva (`visibilitaNota`) e si riallinea:
// - all'avvio (`allineaNote`, al più ogni 6 ore per telefono): le proprie note dei progetti condivisi ancora private
//   diventano condivise (così sono passate quelle scritte prima del 7/11), e le proprie condivise che non sono più di
//   un progetto condiviso (reso privato, eliminato) tornano private. Ciascuno allinea le sue, perché solo chi scrive
//   può cambiarle. I progetti condivisi si leggono dal server, mai dalla copia del telefono: una copia vecchia
//   rimetterebbe in comune note appena rese private;
// - quando il proprietario cambia la visibilità di un progetto (`allineaProgetto`, dal foglio del progetto).
import { watchVisible, watchMine, leggiDove, leggiDalServer, update, where, VIS } from "./db.js";
import { session } from "./auth.js";

const NOTE = "journal_entries";
const FOTO = "journal_photos";
const CHIAVE_ALLINEATE = "macroapp.note.allineate"; // ms dell'ultimo allineamento all'avvio, su questo telefono
const OGNI = 6 * 3600e3;

/** La visibilità di una nota con questo progetto, tra i progetti che vedi. */
export function visibilitaNota(projectId, progetti) {
  const p = projectId ? progetti.find((x) => x.id === projectId) : null;
  return p?.visibility === VIS.SHARED ? VIS.SHARED : VIS.PRIVATE;
}

/** La nota è di chi guarda (le note senza `ownerUid` sono di prima del modello di visibilità: sue). */
export const notaMia = (n) => !n.ownerUid || n.ownerUid === session.user?.uid;

/**
 * Ascolto delle note che vedi: le tue e quelle condivise della casa (indici householdId + visibility [+ projectId] +
 * createdAt). Se la query non passa (indice appena pubblicato, ancora in costruzione), intanto le sole tue, come
 * prima. Ritorna la funzione per smettere.
 */
export function seguiNote({ extra = [], max = 100 } = {}, cb) {
  let stop = watchVisible(NOTE, { extra, max }, cb, () => {
    console.warn("note condivise non lette: per ora solo le tue");
    stop = watchMine(NOTE, { extra, max }, cb);
  });
  return () => stop();
}

/** Quante note al più si seguono per la ricerca e il filtro per persona: in pratica tutte. */
export const TUTTE_LE_NOTE = 5000;

/**
 * Tutte le note che vedi (14/11: la ricerca e il filtro per persona del Diario, il conteggio nella voce della rubrica),
 * non solo le ultime 100 che il Diario mostra. Stesso ascolto per tutti (db.js lo condivide e lo tiene aperto 10 minuti):
 * aprendo la ricerca una seconda volta le note ci sono già.
 */
export const seguiTutteLeNote = (cb) => seguiNote({ max: TUTTE_LE_NOTE }, cb);

/** Una volta sola: tutte le note che vedi. */
export function tutteLeNote() {
  return new Promise((ok) => {
    let stop = null, fatto = false;
    stop = seguiTutteLeNote((docs) => { if (fatto) return; fatto = true; ok(docs); setTimeout(() => stop?.(), 0); });
  });
}

/**
 * Porta alla visibilità `vis` le proprie note del progetto `pid` (e le loro foto) che hanno l'altra. Ritorna quante
 * ne ha cambiate. Query di sole uguaglianze: bastano gli indici dei singoli campi.
 */
export async function allineaProgetto(pid, vis) {
  const uid = session.user?.uid;
  if (!uid || !pid) return 0;
  const altra = vis === VIS.SHARED ? VIS.PRIVATE : VIS.SHARED;
  const note = await leggiDove(NOTE, where("ownerUid", "==", uid), where("projectId", "==", pid), where("visibility", "==", altra));
  cambia(note, vis);
  return note.length;
}

function cambia(note, vis) {
  for (const n of note) {
    update(NOTE, n.id, { visibility: vis });
    for (const f of n.foto || []) update(FOTO, f.id, { visibility: vis });
  }
}

/**
 * All'avvio: le proprie note seguono i progetti condivisi della casa, letti dal server (senza rete non si fa nulla).
 * Ritorna quante ne ha cambiate.
 */
export async function allineaNote({ forza = false } = {}) {
  const uid = session.user?.uid;
  if (!uid || !session.householdId) return 0;
  let ultima = 0;
  try { ultima = Number(localStorage.getItem(CHIAVE_ALLINEATE)) || 0; } catch (e) {}
  if (!forza && Date.now() - ultima < OGNI) return 0;
  const condivisi = new Set((await leggiDalServer("projects", where("householdId", "==", session.householdId), where("visibility", "==", VIS.SHARED)))
    .map((p) => p.id));
  let n = 0;
  for (const pid of condivisi) n += await allineaProgetto(pid, VIS.SHARED);
  // Condivise ma non più di un progetto condiviso: tornano private.
  const fuori = (await leggiDalServer(NOTE, where("ownerUid", "==", uid), where("visibility", "==", VIS.SHARED)))
    .filter((x) => !condivisi.has(x.projectId));
  cambia(fuori, VIS.PRIVATE);
  try { localStorage.setItem(CHIAVE_ALLINEATE, String(Date.now())); } catch (e) {}
  return n + fuori.length;
}
