// Calendari di Google Calendar, letti e scritti direttamente con l'API di Calendar e il permesso dell'account
// Google collegato (core/google.js). L'app non copia gli eventi su Firestore: Google resta il contenitore.
//
// Due livelli (1/11, scelta di Mattia):
// - il calendario della casa («Casa», households.calendario = { id, nome }), scelto da uno dei due e condiviso
//   tra i due su Google Calendar: lo vedono entrambi e l'app ci scrive (il +, gli eventi proposti dall'agente);
// - gli altri calendari di ciascuno (users.calendari = [{ id, nome, colore, modificabile }]: il personale, la
//   band, l'associazione…), che vede solo chi li ha scelti, accanto a quelli della casa. Nell'app si modifica
//   solo il calendario principale dell'account (`modificabile`); gli altri, gestiti anche da altre persone,
//   sono in sola lettura e si aprono in Google. Chi vede cosa lo decide Google: l'altra persona vede il tuo
//   calendario solo se glielo condividi da Google Calendar, e per lei non è il principale, quindi lo legge soltanto.
//
// Una sola lettura dei prossimi 60 giorni (`finestra`) di tutti i calendari serve alla pagina Calendario e a
// «Prossimi giorni» nel Diario. L'ultima lettura resta anche in localStorage, solo su questo telefono, perché
// all'apertura il Diario si disegni subito con gli eventi senza farli comparire dopo le note; la rilettura da
// Google la sostituisce.
//
// Evento (come lo usa l'app): { id, titolo, inizio: Date, fine: Date, tuttoIlGiorno, luogo, note, link,
// giornoInizio ("AAAA-MM-GG"), giornoFine, creatore, calId, calNome, colore, casa, modificabile }.
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-firestore.js";
import { db } from "./firebase.js";
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
  cambiati();
}

const suCambio = new Set();
/** fn() quando cambia la scelta dei calendari (della casa o gli altri); ritorna la funzione per smettere. */
export function suCalendari(fn) { suCambio.add(fn); return () => suCambio.delete(fn); }
function cambiati() { suCambio.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }

/**
 * I calendari dell'account Google: [{ id, nome, primario, scrivibile }]. Il principale si chiama «Personale»
 * (il suo nome su Google è di solito l'indirizzo email), a meno che non sia stato rinominato.
 */
export async function elencoCalendari() {
  const j = await chiamaGoogle(`${API}/users/me/calendarList`, { query: { minAccessRole: "reader", showHidden: "true" } });
  return (j.items || []).map((c) => ({
    id: c.id, nome: c.summaryOverride || (c.primary ? "Personale" : c.summary) || c.id, primario: !!c.primary,
    scrivibile: c.accessRole === "owner" || c.accessRole === "writer",
  })).sort((a, b) => (b.primario - a.primario) || a.nome.localeCompare(b.nome));
}

// ───────────── Gli altri calendari di questa persona ─────────────

/** Gli altri calendari che questa persona vede accanto a quello della casa: [{ id, nome, colore, modificabile }]. */
export function altriCalendari() {
  const l = session.profile?.calendari;
  return Array.isArray(l) ? l.filter((c) => c?.id) : [];
}

/** Scrive gli altri calendari di questa persona (users.calendari). */
export async function scegliAltri(lista) {
  const pulita = lista.map(({ id, nome, colore, modificabile }) => ({ id, nome: nome || id, colore: colore || "", modificabile: !!modificabile }));
  await updateDoc(doc(db, "users", session.user.uid), { calendari: pulita });
  // Il profilo in memoria si aggiorna a mano, come in google.js: rileggerlo ridisegnerebbe l'app.
  if (session.profile) session.profile.calendari = pulita;
  svuota();
  cambiati();
}

let ultimiVisti = [];
/**
 * Tutti i calendari da leggere, in ordine: prima quello della casa (se scelto), poi gli altri di questa persona.
 * [{ id, nome, colore, modificabile, casa }]; quello della casa non ha colore (prende l'accento) ed è modificabile.
 */
export async function calendariVisti({ fresh = false } = {}) {
  const casa = await calendarioCasa({ fresh }).catch(() => null);
  const lista = casa ? [{ id: casa.id, nome: casa.nome, colore: "", modificabile: true, casa: true }] : [];
  for (const c of altriCalendari()) if (!lista.some((x) => x.id === c.id)) lista.push({ ...c, modificabile: !!c.modificabile, casa: false });
  ultimiVisti = lista;
  return lista;
}

/** L'ultimo elenco di calendariVisti, senza aspettare (per i fogli che si aprono subito). */
export const calendariNoti = () => ultimiVisti;

// ───────────── Eventi ─────────────

const cal = (id) => `${API}/calendars/${encodeURIComponent(id)}/events`;

/** L'evento come lo usa l'app; `c` è il calendario da cui viene (vedi calendariVisti). */
function daGoogle(e, c) {
  const tuttoIlGiorno = !!e.start?.date;
  const originale = !e.organizer || e.organizer.self === true;
  const inizio = new Date(tuttoIlGiorno ? `${e.start.date}T00:00:00` : e.start?.dateTime);
  // Negli eventi di un giorno intero `end.date` è il giorno dopo l'ultimo (escluso): si riporta all'ultimo.
  const fine = tuttoIlGiorno ? new Date(new Date(`${e.end.date}T00:00:00`).getTime() - 1) : new Date(e.end?.dateTime || inizio);
  return {
    id: e.id, titolo: e.summary || "(senza titolo)", inizio, fine, tuttoIlGiorno,
    luogo: e.location || "", note: e.description || "", link: e.htmlLink || "",
    giornoInizio: isoGiorno(inizio), giornoFine: isoGiorno(fine),
    creatore: e.creator?.email || "", mio: !!e.creator?.self, stato: e.status || "confirmed", uid: e.iCalUID || e.id,
    calId: c.id, calNome: c.nome, colore: c.colore || "", casa: !!c.casa,
    // `originale`: l'evento è di questo calendario; altrimenti è un invito (`organizer.self` manca), che non si
    // modifica dall'app, salvo che l'organizzatore lo permetta agli invitati.
    originale,
    modificabile: !!c.modificabile && !e.locked && (originale || !!e.guestsCanModify),
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

let letti = null;    // { chiave, da, a, eventi, errori, alle }
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
  const { errori, ...daSalvare } = letti;
  try { localStorage.setItem(CHIAVE, JSON.stringify({ uid: session.user.uid, ...daSalvare })); } catch (e) {}
}
function ripresa() {
  try {
    const s = JSON.parse(localStorage.getItem(CHIAVE) || "null");
    if (!s || s.uid !== session.user?.uid || !Array.isArray(s.eventi) || Date.now() - s.alle > VECCHIA) return null;
    // Come anteprima vale, ma è da rileggere: «alle» a 0 la fa sembrare scaduta.
    return { chiave: s.chiave, da: s.da, a: s.a, alle: 0, errori: [], eventi: s.eventi.map((e) => ({ ...e, ...Object.fromEntries(DATE.map((k) => [k, new Date(e[k])])) })) };
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

/** I calendari che non si sono lasciati leggere nell'ultima lettura: [{ id, nome, casa, err }]. */
export const erroriLettura = () => letti?.errori || [];

// La chiave di una lettura: quali calendari, con che nome e colore (cambiandoli, la lettura vecchia non vale).
const chiaveDi = (calendari) => calendari.map((c) => `${c.id}|${c.nome}|${c.colore}|${c.modificabile ? 1 : 0}`).join(",");

async function eventiDi(c, da, a) {
  const eventi = [];
  let pagina = "";
  for (;;) {
    const j = await chiamaGoogle(cal(c.id), {
      query: { timeMin: da.toISOString(), timeMax: a.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250", pageToken: pagina, timeZone: FUSO },
    });
    for (const e of j.items || []) if (e.status !== "cancelled") eventi.push(daGoogle(e, c));
    pagina = j.nextPageToken || "";
    if (!pagina) return eventi;
  }
}

/**
 * Gli eventi di tutti i calendari visti tra `da` e `a` (Date), ricorrenze espanse, in ordine di inizio.
 * I calendari si leggono insieme; uno che non risponde non ferma gli altri (erroriLettura), l'errore arriva solo se
 * nessuno risponde. Lo stesso evento in due calendari (un evento della band a cui sei invitato, che compare anche nel
 * personale) si mostra una volta: dal calendario a cui appartiene, se è tra quelli letti, se no dal primo (la casa,
 * poi gli altri nell'ordine in cui li hai scelti).
 * Tiene l'ultima lettura in memoria: con `forza` la ripete; altrimenti la ripete dopo FRESCO.
 * Senza calendari o senza il permesso: errore con `motivo` "nessun-calendario" / "permesso".
 */
export async function leggiEventi({ da, a, forza = false } = {}) {
  if (!da || !a) ({ da, a } = finestra());
  const calendari = await calendariVisti();
  if (!calendari.length) throw Object.assign(new Error("Nessun calendario scelto"), { motivo: "nessun-calendario" });
  if (!permessoGoogle("calendario")) throw Object.assign(new Error("Manca il permesso per il calendario"), { motivo: "permesso" });
  const chiave = chiaveDi(calendari);
  const stesso = letti && letti.chiave === chiave && letti.da === da.getTime() && letti.a === a.getTime();
  if (stesso && !forza && Date.now() - letti.alle < FRESCO) return letti.eventi;
  if (lettura && !forza) return lettura;
  const questa = (async () => {
    const esiti = await Promise.allSettled(calendari.map((c) => eventiDi(c, da, a)));
    const errori = [];
    const visti = new Map(); // uid|inizio → evento
    esiti.forEach((r, i) => {
      const c = calendari[i];
      if (r.status === "rejected") { errori.push({ id: c.id, nome: c.nome, casa: c.casa, err: r.reason }); return; }
      for (const e of r.value) {
        const k = `${e.uid}|${e.inizio.getTime()}`;
        const prima = visti.get(k);
        if (!prima || (!prima.originale && e.originale)) visti.set(k, e);
      }
    });
    const eventi = [...visti.values()];
    if (errori.length === calendari.length) throw Object.assign(errori[0].err, { calendario: errori[0] });
    eventi.sort((x, y) => x.inizio - y.inizio);
    if (lettura === questa) { letti = { chiave, da: da.getTime(), a: a.getTime(), eventi, errori, alle: Date.now() }; lettura = null; salva(); annuncia(); }
    return eventi;
  })().catch((err) => { if (lettura === questa) lettura = null; throw err; });
  lettura = questa;
  return questa;
}

/** Il calendario in cui scrivere: `calId`, o quello della casa. Errore se non c'è o se nell'app è in sola lettura. */
async function doveScrivere(calId) {
  const lista = await calendariVisti();
  const c = calId ? lista.find((x) => x.id === calId) : lista.find((x) => x.casa);
  if (!c) throw Object.assign(new Error(calId ? "Calendario non più tra quelli scelti" : "Scegli prima il calendario della casa nella pagina Google"), { motivo: "nessun-calendario" });
  if (!c.modificabile) throw Object.assign(new Error(`${c.nome}: nell'app è in sola lettura, si modifica da Google Calendar`), { motivo: "sola-lettura" });
  return c;
}

/** Crea un evento in `calId`, o nel calendario della casa. Ritorna l'evento come lo usa l'app. */
export async function creaEvento(d, calId = "") {
  const c = await doveScrivere(calId);
  // Nell'inserimento i campi azzerati non servono (e nulli Google non li vuole).
  const corpo = perGoogle(d);
  for (const k of ["start", "end"]) corpo[k] = Object.fromEntries(Object.entries(corpo[k]).filter(([, v]) => v != null));
  const e = daGoogle(await chiamaGoogle(cal(c.id), { method: "POST", body: corpo }), c);
  aggiungi(e);
  return e;
}

/**
 * Modifica l'evento `ev` (come lo usa l'app) con i dati `d`. Con `calId` diverso dal suo, prima lo sposta in
 * quel calendario (`move` di Google: stesso evento, stesso id).
 */
export async function aggiornaEvento(ev, d, calId = "") {
  const da = await doveScrivere(ev.calId);
  const verso = calId && calId !== da.id ? await doveScrivere(calId) : da;
  if (verso !== da) await chiamaGoogle(`${cal(da.id)}/${encodeURIComponent(ev.id)}/move`, { method: "POST", query: { destination: verso.id } });
  const e = daGoogle(await chiamaGoogle(`${cal(verso.id)}/${encodeURIComponent(ev.id)}`, { method: "PATCH", body: perGoogle(d) }), verso);
  aggiungi(e);
  return e;
}

export async function eliminaEvento(ev) {
  const c = await doveScrivere(ev.calId);
  await chiamaGoogle(`${cal(c.id)}/${encodeURIComponent(ev.id)}`, { method: "DELETE" });
  if (letti) { letti.eventi = letti.eventi.filter((e) => e.id !== ev.id); salva(); annuncia(); }
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
