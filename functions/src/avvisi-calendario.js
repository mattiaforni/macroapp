// Avvisi a orario (funzione programmata `giroAvvisi`, ogni 5 minuti):
//
// 1. Eventi nuovi nel calendario della casa (households.calendario): a chi non li ha creati. Gli eventi stanno
//    solo su Google Calendar, quindi il server li legge con il permesso Google di uno dei due (account.js →
//    tokenServer) e chiede quelli cambiati dall'ultimo giro (`updatedMin`); è nuovo un evento con `created`
//    dopo l'ultimo giro. Chi l'ha creato si riconosce dall'email (`creator.email` = users.google.email). Le
//    modifiche e le eliminazioni non si annunciano: Google non dice chi le ha fatte. Ritardo massimo: un giro.
// 2. Promemoria degli eventi con orario, `anticipo` minuti prima (users.notifiche.anticipo: 15, 30, 60, 120;
//    predefinito 60), per i calendari che quella persona vede nell'app (la casa + users.calendari), letti con il
//    suo account Google. Si salta un evento per cui Google Calendar avvisa già quella persona (promemoria «popup»
//    dell'evento, o quelli predefiniti del calendario): due avvisi per la stessa cosa sarebbero rumore.
// 3. Riepilogo del mattino alle 7:30 (il primo giro dopo; non oltre le 10:30, se il servizio era fermo): eventi di
//    oggi, task in scadenza oggi o in ritardo (condivisi e propri), e, per chi ha la banca, spese da confermare,
//    collegamento interrotto, consenso in scadenza (14 giorni). Chi ha spento il riepilogo riceve a parte solo il
//    consenso in scadenza, a 14, 7, 3, 1 e 0 giorni (le spese da confermare gliele dice syncBank alle 7:15).
//
// Stato in avvisi_stato/{householdId} (solo server): ultimo giro, fin dove si sono cercati gli eventi nuovi
// (`cercatoFino`), eventi già annunciati e promemoria già mandati
// (con le chiavi ridotte a un hash), giorno dell'ultimo riepilogo. Le persone senza telefoni con le notifiche non
// costano letture a Google. Nei registri niente titoli di eventi né di task (repository pubblico).
import { createHash } from "node:crypto";
import { invia, oraRoma, nomeDi, breve, FUSO } from "./avvisi.js";

const API = "https://www.googleapis.com/calendar/v3";
export const ANTICIPI = [15, 30, 60, 120];
export const ANTICIPO = 60;
const RIEPILOGO = { da: 7 * 60 + 30, a: 10 * 60 + 30 };
const SCADENZE_BANCA = [14, 7, 3, 1, 0];
const SOVRAPPOSIZIONE = 2 * 60e3;      // i giri si sovrappongono un po': un evento al confine non si perde
const MAX_INDIETRO = 24 * 3600e3;      // dopo un fermo lungo non si annuncia tutta la storia
const RICORDO_MS = 2 * 86400e3;        // quanto si ricordano annunci e promemoria già fatti
const GIORNI = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
const GIORNI_LUNGHI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const MESI_LUNGHI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

const hash = (s) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const haTelefoni = (u) => Object.values(u?.dispositivi || {}).some((x) => x?.token);
const emailDi = (u) => String(u?.google?.email || "").trim().toLowerCase();
const millis = (x) => (x?.toMillis ? x.toMillis() : x?.toDate ? x.toDate().getTime() : x ? new Date(x).getTime() || 0 : 0);

// ───────────── Date a Roma ─────────────

const OFFSET = new Intl.DateTimeFormat("en-US", { timeZone: FUSO, timeZoneName: "longOffset" });
/** Scarto di Roma da UTC in ms in quell'istante (+1 h d'inverno, +2 h d'estate). */
function scarto(ms) {
  const n = OFFSET.formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")?.value || "GMT";
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(n);
  return m ? (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +(m[3] || 0)) * 60e3 : 0;
}
/** La mezzanotte di Roma di un giorno "AAAA-MM-GG", come istante. */
export function mezzanotte(g) {
  const [y, mo, d] = g.split("-").map(Number);
  const utc = Date.UTC(y, mo - 1, d);
  let t = utc - scarto(utc);
  t = utc - scarto(t); // seconda passata: giusto anche nei giorni del cambio d'ora
  return new Date(t);
}
const dopo = (g, n = 1) => { const d = new Date(`${g}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const giornoCorto = (g) => { const d = new Date(`${g}T12:00:00Z`); return `${GIORNI[d.getUTCDay()]} ${d.getUTCDate()} ${MESI[d.getUTCMonth()]}`; };
const giornoLungo = (g) => { const d = new Date(`${g}T12:00:00Z`); return `${GIORNI_LUNGHI[d.getUTCDay()]} ${d.getUTCDate()} ${MESI_LUNGHI[d.getUTCMonth()]}`; };

// ───────────── Google Calendar ─────────────

export class CalendarError extends Error {
  constructor(status, percorso) { super(`Calendar ${status} ${percorso}`); this.status = status; }
}

async function chiama(token, percorso, query = {}) {
  const u = new URL(API + percorso);
  for (const [k, v] of Object.entries(query)) if (v !== "" && v != null) u.searchParams.set(k, String(v));
  const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new CalendarError(res.status, percorso.replace(/\/calendars\/[^/]+/, "/calendars/…"));
  return res.json();
}

async function eventiDi(token, calId, query) {
  const out = [];
  let pageToken = "";
  for (let i = 0; i < 5; i++) {
    const j = await chiama(token, `/calendars/${encodeURIComponent(calId)}/events`, { maxResults: 250, ...query, pageToken });
    out.push(...(j.items || []));
    pageToken = j.nextPageToken || "";
    if (!pageToken) break;
  }
  return out;
}

/** Evento ridotto a ciò che serve qui. `c` = { id, nome, casa }. */
function evento(e, c) {
  const tuttoIlGiorno = !!e.start?.date;
  const inizio = tuttoIlGiorno ? mezzanotte(e.start.date) : new Date(e.start?.dateTime || 0);
  const fine = tuttoIlGiorno ? mezzanotte(e.end?.date || dopo(e.start.date)) : new Date(e.end?.dateTime || inizio);
  const io = (e.attendees || []).find((a) => a.self);
  return {
    id: e.id, uid: e.iCalUID || e.id, titolo: breve(e.summary, 80) || "(senza titolo)", luogo: breve(e.location, 60),
    inizio, fine, tuttoIlGiorno, giornoInizio: tuttoIlGiorno ? e.start.date : oraRoma(inizio).giorno,
    giornoFine: tuttoIlGiorno ? dopo(e.end?.date || dopo(e.start.date), -1) : oraRoma(fine).giorno,
    rifiutato: io?.responseStatus === "declined", ricorrente: !!(e.recurrence?.length || e.recurringEventId),
    promemoria: e.reminders || null, calId: c.id, calNome: c.nome, casa: !!c.casa,
  };
}

/** Eventi (ricorrenze espanse) dei calendari tra `da` e `a`; lo stesso evento in due calendari una volta sola.
 *  Anche per l'agente del diario e per Chiedi (14/11). */
export async function eventiTra(token, calendari, da, a) {
  const esiti = await Promise.allSettled(calendari.map((c) => eventiDi(token, c.id, {
    timeMin: da.toISOString(), timeMax: a.toISOString(), singleEvents: "true", orderBy: "startTime", timeZone: FUSO,
  }).then((items) => items.filter((e) => e.status !== "cancelled").map((e) => evento(e, c)))));
  const visti = new Map();
  esiti.forEach((r, i) => {
    if (r.status === "rejected") { console.warn("giroAvvisi: calendario non letto", calendari[i].casa ? "casa" : "altro", r.reason?.status || r.reason?.message); return; }
    for (const e of r.value) {
      const k = `${e.uid}|${e.inizio.getTime()}`;
      if (!visti.has(k)) visti.set(k, e);
    }
  });
  return [...visti.values()].sort((x, y) => x.inizio - y.inizio);
}

/** I calendari che questa persona vede nell'app: quello della casa, poi i suoi (come calendariVisti nell'app). */
export function calendariDi(h, u) {
  const lista = h.calendario?.id ? [{ id: h.calendario.id, nome: h.calendario.nome || "Casa", casa: true }] : [];
  for (const c of Array.isArray(u?.calendari) ? u.calendari : []) {
    if (c?.id && !lista.some((x) => x.id === c.id)) lista.push({ id: c.id, nome: c.nome || "", casa: false });
  }
  return lista;
}

/** Calendari dell'account per cui Google ha promemoria predefiniti a comparsa (Set di id). */
async function conPromemoriaGoogle(token) {
  const j = await chiama(token, "/users/me/calendarList", { minAccessRole: "reader", showHidden: "true", maxResults: 250 });
  return new Set((j.items || []).filter((c) => (c.defaultReminders || []).some((r) => r.method === "popup")).map((c) => c.id));
}
/** Google Calendar avvisa già questa persona per questo evento? */
function avvisaGoogle(e, predefiniti) {
  const r = e.promemoria;
  if (!r) return false;
  if (r.useDefault) return predefiniti.has(e.calId);
  return (r.overrides || []).some((x) => x.method === "popup");
}

/** «oggi alle 20:00», «domani», «sab 7 nov, 20:00», «dal 7 al 9 nov» (rispetto a `oggi`). */
export function quandoEvento(e, oggi) {
  const g = e.giornoInizio === oggi ? "oggi" : e.giornoInizio === dopo(oggi) ? "domani" : giornoCorto(e.giornoInizio);
  if (e.tuttoIlGiorno) return e.giornoFine > e.giornoInizio ? `dal ${giornoCorto(e.giornoInizio)} al ${giornoCorto(e.giornoFine)}` : g;
  const ora = oraRoma(e.inizio).ora.replace(/^0/, "");
  return /^(oggi|domani)$/.test(g) ? `${g} alle ${ora}` : `${g}, ${ora}`;
}
/** «tra 1 ora», «tra 25 minuti», «tra 1 ora e 30» */
export function traQuanto(ms) {
  const min = Math.max(1, Math.round(ms / 60e3));
  if (min < 60) return `tra ${min} minut${min === 1 ? "o" : "i"}`;
  const h = Math.floor(min / 60), r = min % 60;
  return `tra ${h} or${h === 1 ? "a" : "e"}${r ? ` e ${r}` : ""}`;
}

// ───────────── Il giro ─────────────

/**
 * Un giro per ogni casa. client = { id, secret } del client OAuth (per i permessi di Google);
 * ora = l'istante del giro e tokenServer = da dove vengono i permessi (le prove li fissano).
 */
export async function giroAvvisi(db, client, { ora = new Date(), tokenServer = null } = {}) {
  if (!tokenServer) ({ tokenServer } = await import("./google/account.js"));
  const case_ = await db.collection("households").get();
  for (const doc of case_.docs) {
    try { await giroCasa(db, client, { id: doc.id, ...doc.data() }, ora, tokenServer); }
    catch (err) { console.warn("giroAvvisi: casa", doc.id, err.status || err.code || "", String(err.message).slice(0, 160)); }
  }
}

async function giroCasa(db, client, h, ora, tokenServer) {
  const membri = Array.isArray(h.members) ? h.members : [];
  if (!membri.length) return;
  const snaps = await db.getAll(...membri.map((uid) => db.collection("users").doc(uid)));
  const utenti = Object.fromEntries(snaps.map((s) => [s.id, s.data() || {}]));
  const statoRef = db.collection("avvisi_stato").doc(h.id);
  const stato = (await statoRef.get()).data() || {};
  const adesso = ora.getTime();
  const annunciati = Object.fromEntries(Object.entries(stato.annunciati || {}).filter(([, t]) => adesso - t < RICORDO_MS));
  const ricordati = Object.fromEntries(Object.entries(stato.ricordati || {}).filter(([, t]) => adesso - t < RICORDO_MS));

  // Permesso di Google di ciascuno, chiesto solo quando serve. Scaduto: l'account va ricollegato, e lo si dice
  // una volta (tokenServer toglie il collegamento, quindi al giro dopo non c'è più niente da rinnovare).
  const permessi = new Map();
  const tokenDi = (uid) => {
    if (!permessi.has(uid)) {
      const g = utenti[uid]?.google;
      permessi.set(uid, !g?.collegato || g.permessi?.calendario === false ? Promise.resolve(null)
        : tokenServer(db, uid, client).then((t) => (t.permessi?.calendario ? t.accessToken : null)).catch(async (err) => {
          if (err.details?.motivo === "scaduto") {
            await invia(db, [uid], null, { titolo: "Google scollegato", testo: "Google ha ritirato il permesso. Ricollegalo dalla pagina Google: senza, niente calendario, promemoria e contatti nell'app.", url: "/#/google", tag: "google" }, ora).catch(() => 0);
          } else console.warn("giroAvvisi: permesso Google", err.details?.motivo || err.code || String(err.message).slice(0, 80));
          return null;
        }));
    }
    return permessi.get(uid);
  };

  // 1. Eventi nuovi nel calendario della casa. `cercatoFino` avanza solo quando la lettura riesce: un evento creato
  // mentre Google non rispondeva si annuncia al giro dopo, invece di perdersi.
  const ultimo = stato.cercatoFino ?? stato.ultimoGiro;
  const da = ultimo ? Math.max(ultimo - SOVRAPPOSIZIONE, adesso - MAX_INDIETRO) : null;
  let cercatoFino = adesso;
  const interessati = membri.filter((uid) => haTelefoni(utenti[uid]) && utenti[uid].notifiche?.calendario !== false);
  if (h.calendario?.id && da && interessati.length) try {
    let token = null;
    for (const uid of membri) if ((token = await tokenDi(uid))) break;
    if (!token) cercatoFino = ultimo;
    if (token) {
      const casa = { id: h.calendario.id, nome: h.calendario.nome || "Casa", casa: true };
      const items = await eventiDi(token, casa.id, { updatedMin: new Date(da).toISOString(), showDeleted: "false" });
      const nuovi = new Map(); // autore (uid o "") → eventi
      for (const e of items) {
        if (e.status === "cancelled" || annunciati[hash(e.id)]) continue;
        if (!(Date.parse(e.created || "") >= da)) continue; // cambiato, non nuovo
        annunciati[hash(e.id)] = adesso;
        const ev = evento(e, casa);
        if (ev.fine.getTime() < adesso) continue; // un evento già passato, scritto per memoria
        const autore = membri.find((uid) => emailDi(utenti[uid]) && emailDi(utenti[uid]) === String(e.creator?.email || "").toLowerCase()) || "";
        if (!nuovi.has(autore)) nuovi.set(autore, []);
        nuovi.get(autore).push(ev);
      }
      const oggi = oraRoma(ora).giorno;
      for (const [autore, eventi] of nuovi) {
        const chi = autore ? nomeDi(h, autore) : null;
        const msg = eventi.length === 1
          ? { titolo: chi ? `${chi} ha aggiunto un evento` : "Nuovo evento nel calendario della casa",
            testo: [eventi[0].titolo, quandoEvento(eventi[0], oggi), eventi[0].luogo, eventi[0].ricorrente ? "si ripete" : null].filter(Boolean).join(" · "),
            url: "/#/calendario", tag: `evento-${hash(eventi[0].id)}` }
          : { titolo: chi ? `${chi} ha aggiunto ${eventi.length} eventi` : `${eventi.length} eventi nuovi nel calendario della casa`,
            testo: eventi.slice(0, 4).map((e) => `${e.titolo} (${quandoEvento(e, oggi)})`).join(", ") + (eventi.length > 4 ? ` e altri ${eventi.length - 4}` : ""),
            url: "/#/calendario", tag: `eventi-${hash(eventi.map((e) => e.id).join())}` };
        for (const dest of interessati.filter((uid) => uid !== autore)) {
          await invia(db, [dest], "calendario", msg, ora);
          // Un evento che comincia entro l'anticipo di chi lo riceve vale già come promemoria.
          const anticipo = anticipoDi(utenti[dest]);
          for (const e of eventi) if (!e.tuttoIlGiorno && e.inizio - adesso <= anticipo * 60e3) ricordati[hash(`${dest}|${e.uid}|${e.inizio.getTime()}`)] = adesso;
        }
      }
    }
  } catch (err) {
    // Un errore qui (calendario non più condiviso, Google che non risponde) non ferma promemoria e riepilogo.
    cercatoFino = ultimo;
    console.warn("giroAvvisi: eventi nuovi", err.status || err.code || "", String(err.message).slice(0, 120));
  }

  // 2. Promemoria degli eventi con orario.
  for (const uid of membri) try {
    const u = utenti[uid];
    if (!haTelefoni(u) || u.notifiche?.promemoria === false) continue;
    const calendari = calendariDi(h, u);
    if (!calendari.length) continue;
    const token = await tokenDi(uid);
    if (!token) continue;
    const anticipo = anticipoDi(u);
    const vicini = (await eventiTra(token, calendari, ora, new Date(adesso + anticipo * 60e3 + 60e3)))
      .filter((e) => !e.tuttoIlGiorno && !e.rifiutato && e.inizio.getTime() > adesso && e.inizio - adesso <= anticipo * 60e3
        && !ricordati[hash(`${uid}|${e.uid}|${e.inizio.getTime()}`)]);
    if (!vicini.length) continue;
    const predefiniti = await conPromemoriaGoogle(token).catch(() => new Set());
    for (const e of vicini) {
      const k = hash(`${uid}|${e.uid}|${e.inizio.getTime()}`);
      ricordati[k] = adesso;
      if (avvisaGoogle(e, predefiniti)) continue;
      const parti = [`${traQuanto(e.inizio - adesso)}, alle ${oraRoma(e.inizio).ora.replace(/^0/, "")}`, e.luogo, e.casa ? null : e.calNome];
      await invia(db, [uid], "promemoria", { titolo: e.titolo, testo: parti.filter(Boolean).join(" · "), url: "/#/calendario", tag: `promemoria-${k}`, ttl: (e.inizio - adesso) / 1000 }, ora);
    }
  } catch (err) {
    console.warn("giroAvvisi: promemoria", err.status || err.code || "", String(err.message).slice(0, 120));
  }

  // 3. Riepilogo del mattino: chi lo manda per primo segna il giorno (transazione: due giri insieme non lo mandano due volte).
  const { giorno: oggi, minuti } = oraRoma(ora);
  let riepilogo = false;
  if (minuti >= RIEPILOGO.da && minuti < RIEPILOGO.a && stato.riepilogo !== oggi) {
    riepilogo = await db.runTransaction(async (t) => {
      const s = await t.get(statoRef);
      if (s.data()?.riepilogo === oggi) return false;
      t.set(statoRef, { riepilogo: oggi }, { merge: true });
      return true;
    });
  }
  if (riepilogo) {
    for (const uid of membri) {
      try { await riepilogoDi(db, h, uid, utenti[uid], oggi, ora, tokenDi); }
      catch (err) { console.warn("giroAvvisi: riepilogo", err.status || err.code || "", String(err.message).slice(0, 120)); }
    }
  }

  // mergeFields: le due mappe si sostituiscono intere (con merge le chiavi vecchie resterebbero per sempre),
  // `riepilogo` resta com'è.
  await statoRef.set({ ultimoGiro: adesso, cercatoFino, annunciati, ricordati }, { mergeFields: ["ultimoGiro", "cercatoFino", "annunciati", "ricordati"] });
}

const anticipoDi = (u) => (ANTICIPI.includes(u?.notifiche?.anticipo) ? u.notifiche.anticipo : ANTICIPO);

/** Le righe della banca per il riepilogo di chi ha un collegamento; `giorni` al consenso, se si sa. */
async function bancaDi(db, uid, ora) {
  const c = (await db.collection("bank_connections").doc(uid).get()).data();
  if (!c?.active) return { righe: [], giorni: null };
  const righe = [];
  if (c.needsRenewal) righe.push("Banca: collegamento interrotto, rinnovalo");
  const scade = millis(c.consentExpiresAt);
  // Come la pagina Banca: giorni che mancano, arrotondati per eccesso.
  const giorni = scade ? Math.ceil((scade - ora.getTime()) / 86400e3) : null;
  if (!c.needsRenewal && giorni != null && giorni <= 14) {
    righe.push(giorni < 0 ? "Banca: consenso scaduto, rinnovalo" : giorni === 0 ? "Banca: il consenso scade oggi"
      : `Banca: il consenso scade tra ${giorni} giorn${giorni === 1 ? "o" : "i"}`);
  }
  const proposte = await db.collection("proposals").where("ownerUid", "==", uid).where("status", "==", "pending").get();
  const n = proposte.docs.filter((d) => d.data().source === "bank").length;
  if (n) righe.push(`Banca: ${n} ${n === 1 ? "spesa" : "spese"} da confermare`);
  return { righe, giorni };
}

async function riepilogoDi(db, h, uid, u, oggi, ora, tokenDi) {
  if (!haTelefoni(u)) return;
  const pref = u.notifiche || {};
  const banca = pref.banca !== false ? await bancaDi(db, uid, ora) : { righe: [], giorni: null };
  if (pref.riepilogo === false) {
    // Senza riepilogo resta solo l'avviso del consenso in scadenza, in qualche giorno scelto.
    if (pref.banca !== false && SCADENZE_BANCA.includes(banca.giorni)) {
      await invia(db, [uid], "banca", { titolo: "Consenso della banca in scadenza", testo: banca.giorni === 0 ? "Scade oggi: rinnovalo dalla pagina Banca." : `Scade tra ${banca.giorni} giorn${banca.giorni === 1 ? "o" : "i"}: rinnovalo dalla pagina Banca.`, url: "/#/banca", tag: "banca" }, ora);
    }
    return;
  }
  const righe = [];
  // Eventi di oggi, dai calendari che questa persona vede (con il suo account Google).
  const calendari = calendariDi(h, u);
  const token = calendari.length ? await tokenDi(uid) : null;
  if (token) {
    const eventi = (await eventiTra(token, calendari, mezzanotte(oggi), mezzanotte(dopo(oggi))))
      .filter((e) => !e.rifiutato && e.fine.getTime() > ora.getTime());
    eventi.sort((a, b) => (b.tuttoIlGiorno - a.tuttoIlGiorno) || (a.inizio - b.inizio));
    if (eventi.length) {
      const nomi = eventi.slice(0, 4).map((e) => (e.tuttoIlGiorno ? e.titolo : `${oraRoma(e.inizio).ora.replace(/^0/, "")} ${e.titolo}`));
      righe.push(`${eventi.length === 1 ? "Evento" : "Eventi"}: ${nomi.join(", ")}${eventi.length > 4 ? ` e altri ${eventi.length - 4}` : ""}`);
    }
  }
  // Task con scadenza oggi o passata: quelli condivisi della casa e i propri.
  const snap = await db.collection("tasks").where("householdId", "==", h.id).where("done", "==", false).get();
  const task = snap.docs.map((d) => d.data()).filter((t) => t.due && t.due <= oggi && (t.visibility === "shared" || t.ownerUid === uid));
  const diOggi = task.filter((t) => t.due === oggi);
  const tardi = task.length - diOggi.length;
  if (diOggi.length) righe.push(`Da fare oggi: ${diOggi.slice(0, 3).map((t) => breve(t.text, 40)).join(", ")}${diOggi.length > 3 ? ` e altri ${diOggi.length - 3}` : ""}${tardi ? ` · ${tardi} in ritardo` : ""}`);
  else if (tardi) righe.push(`In ritardo: ${task.slice(0, 3).map((t) => breve(t.text, 40)).join(", ")}${tardi > 3 ? ` e altri ${tardi - 3}` : ""}`);
  righe.push(...banca.righe);
  if (!righe.length) return;
  const g = giornoLungo(oggi);
  await invia(db, [uid], "riepilogo", { titolo: `Oggi, ${g}`, testo: righe.join("\n"), url: "/#/diario", tag: "riepilogo", ttl: 12 * 3600 }, ora);
}
