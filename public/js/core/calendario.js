// Calendario della casa: un calendario di Google Calendar condiviso tra i due membri («Casa»), letto e
// scritto direttamente con l'API di Calendar e il permesso dell'account Google collegato (core/google.js).
// L'app non copia gli eventi su Firestore: Google resta il contenitore, qui si tiene solo quale calendario
// è quello della casa (households.calendario = { id, nome }, scelto da uno dei due nella pagina Google) e,
// in memoria, gli eventi letti per la pagina Calendario e per «Prossimi giorni» nel Diario: una sola lettura
// dei prossimi 60 giorni (`finestra`) serve a entrambe. L'ultima lettura resta anche in localStorage, solo
// su questo telefono, perché all'apertura il Diario si disegni subito con gli eventi senza farli comparire
// dopo le note; la rilettura da Google la sostituisce. L'altra persona vede il calendario con il suo account,
// se chi l'ha creato glielo ha condiviso su Google Calendar.
//
// Evento (come lo usa l'app): { id, titolo, inizio: Date, fine: Date, tuttoIlGiorno, luogo, note, link,
// giornoInizio ("AAAA-MM-GG"), giornoFine, creatore }.
import { chiamaGoogle, permessoGoogle, suSvuota } from "./google.js";
import { getHousehold, updateHousehold } from "./household.js";
import { session } from "./auth.js";
import { isoGiorno } from "./ui.js";

const API = "https://www.googleapis.com/calendar/v3";
const FUSO = "Europe/Rome";
const FRESCO = 2 * 60 * 1000; // dopo due minuti gli eventi si rileggono quando la pagina li chiede
const GIORNI_AVANTI = 60;
const CHIAVE = "macroapp.calendario.eventi"; // ultima lettura, per disegnare subito il Diario
const VECCHIA = 3 * 86400e3; // una lettura più vecchia di così non si usa nemmeno come anteprima

/** I giorni che l'app legge: da oggi a mezzanotte per GIORNI_AVANTI giorni. */
export function finestra() {
  const da = new Date(); da.setHours(0, 0, 0, 0);
  const a = new Date(da); a.setDate(a.getDate() + GIORNI_AVANTI);
  return { da, a, giorni: GIORNI_AVANTI };
}

// ───────────── Il calendario della casa ─────────────

/** { id, nome } dal documento della casa, o null se nessuno lo ha ancora scelto. */
export async function calendarioCasa({ fresh = false } = {}) {
  const h = await getHousehold({ fresh });
  return h?.calendario?.id ? h.calendario : null;
}

/** Scrive quale calendario è quello della casa (null = nessuno). */
export async function scegliCalendario(cal) {
  await updateHousehold({ calendario: cal ? { id: cal.id, nome: cal.nome } : null });
  svuota();
}

/** I calendari dell'account Google: [{ id, nome, primario, scrivibile, colore }]. */
export async function elencoCalendari() {
  const j = await chiamaGoogle(`${API}/users/me/calendarList`, { query: { minAccessRole: "reader", showHidden: "true" } });
  return (j.items || []).map((c) => ({
    id: c.id, nome: c.summaryOverride || c.summary || c.id, primario: !!c.primary,
    scrivibile: c.accessRole === "owner" || c.accessRole === "writer", colore: c.backgroundColor || "",
  })).sort((a, b) => (b.primario - a.primario) || a.nome.localeCompare(b.nome));
}

// ───────────── Eventi ─────────────

const cal = (id) => `${API}/calendars/${encodeURIComponent(id)}/events`;

function daGoogle(e) {
  const tuttoIlGiorno = !!e.start?.date;
  const inizio = new Date(tuttoIlGiorno ? `${e.start.date}T00:00:00` : e.start?.dateTime);
  // Negli eventi di un giorno intero `end.date` è il giorno dopo l'ultimo (escluso): si riporta all'ultimo.
  const fine = tuttoIlGiorno ? new Date(new Date(`${e.end.date}T00:00:00`).getTime() - 1) : new Date(e.end?.dateTime || inizio);
  return {
    id: e.id, titolo: e.summary || "(senza titolo)", inizio, fine, tuttoIlGiorno,
    luogo: e.location || "", note: e.description || "", link: e.htmlLink || "",
    giornoInizio: isoGiorno(inizio), giornoFine: isoGiorno(fine),
    creatore: e.creator?.email || "", mio: !!e.creator?.self, stato: e.status || "confirmed",
  };
}

/** Giorno + ora ("HH:MM") → ISO con il fuso dell'app. */
const quando = (giorno, ora) => `${giorno}T${ora}:00`;

/**
 * Il corpo di un evento per Google da { titolo, giorno, giornoFine?, ora?, oraFine?, luogo?, note? }.
 * Senza `ora` è di un giorno intero (fino a `giornoFine` compreso, o lo stesso giorno); con `ora` dura fino a
 * `oraFine`, o un'ora.
 */
function perGoogle(d) {
  const corpo = { summary: d.titolo, location: d.luogo || "", description: d.note || "" };
  if (!d.ora) {
    const ultimo = new Date(`${d.giornoFine || d.giorno}T12:00:00`);
    ultimo.setDate(ultimo.getDate() + 1);
    // Nelle modifiche (PATCH) il campo che non serve va azzerato: Google tiene quello vecchio altrimenti.
    corpo.start = { date: d.giorno, dateTime: null, timeZone: null };
    corpo.end = { date: isoGiorno(ultimo), dateTime: null, timeZone: null };
  } else {
    let fine = d.oraFine;
    if (!fine) {
      const [h, m] = d.ora.split(":").map(Number);
      const f = new Date(`${d.giorno}T${d.ora}:00`); f.setHours(h + 1, m);
      fine = `${String(f.getHours()).padStart(2, "0")}:${String(f.getMinutes()).padStart(2, "0")}`;
      if (fine < d.ora) fine = "23:59"; // non oltre mezzanotte
    }
    corpo.start = { dateTime: quando(d.giorno, d.ora), timeZone: FUSO, date: null };
    corpo.end = { dateTime: quando(d.giornoFine || d.giorno, fine), timeZone: FUSO, date: null };
  }
  return corpo;
}

let letti = null;    // { calId, da, a, eventi, alle }
let lettura = null;  // promessa della lettura in corso
const ascoltatori = new Set();
function svuota() {
  letti = null; lettura = null;
  try { localStorage.removeItem(CHIAVE); } catch (e) {}
}
suSvuota(svuota);

// ── Ultima lettura su questo telefono (localStorage): date in ISO, ripristinate alla lettura ──
const DATE = ["inizio", "fine"];
function salva() {
  if (!letti || !session.user) return;
  try { localStorage.setItem(CHIAVE, JSON.stringify({ uid: session.user.uid, ...letti })); } catch (e) {}
}
function ripresa() {
  try {
    const s = JSON.parse(localStorage.getItem(CHIAVE) || "null");
    if (!s || s.uid !== session.user?.uid || !Array.isArray(s.eventi) || Date.now() - s.alle > VECCHIA) return null;
    // Come anteprima vale, ma è da rileggere: «alle» a 0 la fa sembrare scaduta.
    return { calId: s.calId, da: s.da, a: s.a, alle: 0, eventi: s.eventi.map((e) => ({ ...e, ...Object.fromEntries(DATE.map((k) => [k, new Date(e[k])])) })) };
  } catch (e) { return null; }
}

/** fn(eventi) quando arriva una lettura nuova; ritorna la funzione per smettere. */
export function suEventi(fn) { ascoltatori.add(fn); return () => ascoltatori.delete(fn); }
function annuncia() { ascoltatori.forEach((fn) => { try { fn(letti?.eventi || []); } catch (e) { console.error(e); } }); }

/** Gli eventi già letti, se ci sono (per disegnare subito la pagina), o null. Anche dall'ultima lettura salvata. */
export function eventiNoti() {
  if (!letti) letti = ripresa();
  return letti?.eventi || null;
}

/**
 * Gli eventi del calendario della casa tra `da` e `a` (Date), ricorrenze espanse, in ordine di inizio.
 * Tiene l'ultima lettura in memoria: con `forza` la ripete; altrimenti la ripete dopo FRESCO.
 * Senza calendario scelto o senza il permesso: errore con `motivo` "nessun-calendario" / "permesso".
 */
export async function leggiEventi({ da, a, forza = false } = {}) {
  if (!da || !a) ({ da, a } = finestra());
  const casa = await calendarioCasa();
  if (!casa) throw Object.assign(new Error("Il calendario della casa non è ancora scelto"), { motivo: "nessun-calendario" });
  if (!permessoGoogle("calendario")) throw Object.assign(new Error("Manca il permesso per il calendario"), { motivo: "permesso" });
  const stesso = letti && letti.calId === casa.id && letti.da === da.getTime() && letti.a === a.getTime();
  if (stesso && !forza && Date.now() - letti.alle < FRESCO) return letti.eventi;
  if (lettura && !forza) return lettura;
  const questa = (async () => {
    const eventi = [];
    let pagina = "";
    for (;;) {
      const j = await chiamaGoogle(cal(casa.id), {
        query: { timeMin: da.toISOString(), timeMax: a.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250", pageToken: pagina, timeZone: FUSO },
      });
      for (const e of j.items || []) if (e.status !== "cancelled") eventi.push(daGoogle(e));
      pagina = j.nextPageToken || "";
      if (!pagina) break;
    }
    if (lettura === questa) { letti = { calId: casa.id, da: da.getTime(), a: a.getTime(), eventi, alle: Date.now() }; lettura = null; salva(); annuncia(); }
    return eventi;
  })().catch((err) => { if (lettura === questa) lettura = null; throw err; });
  lettura = questa;
  return questa;
}

/** Crea un evento nel calendario della casa. Ritorna l'evento come lo usa l'app. */
export async function creaEvento(d) {
  const casa = await calendarioCasa();
  if (!casa) throw Object.assign(new Error("Scegli prima il calendario della casa nella pagina Google"), { motivo: "nessun-calendario" });
  // Nell'inserimento i campi azzerati non servono (e nulli Google non li vuole).
  const corpo = perGoogle(d);
  for (const k of ["start", "end"]) corpo[k] = Object.fromEntries(Object.entries(corpo[k]).filter(([, v]) => v != null));
  const e = daGoogle(await chiamaGoogle(cal(casa.id), { method: "POST", body: corpo }));
  aggiungi(e);
  return e;
}

export async function aggiornaEvento(id, d) {
  const casa = await calendarioCasa();
  if (!casa) throw Object.assign(new Error("Calendario della casa non scelto"), { motivo: "nessun-calendario" });
  const e = daGoogle(await chiamaGoogle(`${cal(casa.id)}/${encodeURIComponent(id)}`, { method: "PATCH", body: perGoogle(d) }));
  aggiungi(e);
  return e;
}

export async function eliminaEvento(id) {
  const casa = await calendarioCasa();
  if (!casa) return;
  await chiamaGoogle(`${cal(casa.id)}/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (letti) { letti.eventi = letti.eventi.filter((e) => e.id !== id); salva(); annuncia(); }
}

// L'elenco in memoria si aggiorna subito con ciò che si è scritto, senza aspettare una rilettura.
function aggiungi(e) {
  if (!letti) return;
  letti.eventi = [...letti.eventi.filter((x) => x.id !== e.id), e].sort((a, b) => a.inizio - b.inizio);
  salva();
  annuncia();
}

/** "18:00" da una Date. */
export const oraDi = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** Il giorno ("AAAA-MM-GG") in cui un evento si mostra in un elenco che parte da `oggi`: il suo primo giorno, o oggi se è già iniziato. */
export const giornoMostrato = (e, oggi = isoGiorno(new Date())) => (e.giornoInizio < oggi ? oggi : e.giornoInizio);
