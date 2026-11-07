// Calendario: agenda dei prossimi giorni dai calendari di Google Calendar (core/calendario.js). Il calendario
// della casa («Casa», condiviso tra i due) e, accanto, gli altri calendari di chi guarda (il personale, la band,
// l'associazione…: 1/11, richiesta di Mattia), scelti dal foglio «Calendari» (in testata, o dalla pagina Google).
// Il + in basso a destra apre il foglio di un evento nuovo, che si scrive subito su Google: nel calendario della
// casa o nel personale. Toccando un evento si legge e, se è di un calendario modificabile nell'app, si modifica;
// quelli degli altri calendari si leggono soltanto e si aprono in Google. Gli eventi che l'agente ricava dalle
// note passano invece dalla conferma (proposta «event», components/proposals.js) e vanno nel calendario della casa.
// Aspetto (27/10, scelta di Mattia tra due schermate): come le lezioni del tennis, il giorno grande in
// Instrument Serif a sinistra e il giorno della settimana sotto, una fascia per mese; più eventi dello stesso
// giorno condividono il numero. Un evento che non è della casa porta il nome del suo calendario, nel suo colore
// (come l'etichetta del progetto nel Diario). `rigaEvento` la usa anche «Prossimi giorni» in cima al Diario.
import { el, icon, toast, fab, vuoto, fascia, attesa, isoGiorno, fmtDate, meseLungo, COLORI, pillolaProgetto } from "../../core/ui.js";
import { watchVisible, readVisible } from "../../core/db.js";
import { statoGoogle, messaggioGoogle, suGoogle } from "../../core/google.js";
import {
  calendarioCasa, scegliCalendario, elencoCalendari, altriCalendari, scegliAltri, calendariVisti, calendariNoti, suCalendari,
  leggiEventi, eventiNoti, erroriLettura, suEventi, creaEvento, aggiornaEvento, eliminaEvento, oraDi, finestra, giornoMostrato,
} from "../../core/calendario.js";
import { openSheet } from "../../components/sheet.js";
import { vaiA } from "../../core/router.js";

export const id = "calendario";
export const title = "Calendario";
export const nav = false;
const navIcon = "calendario";
export { navIcon as icon };

/** In testata, a destra: quali calendari vedere. */
export const azioni = () => [el("button.tondo.tondo--piatto", { type: "button", "aria-label": "Calendari", title: "Calendari",
  onclick: () => apriSceltaCalendari() }, icon("impostazioni"))];

const GIORNI_BREVI = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const CHIAVE_FILTRO = "macroapp.calendario.filtro"; // "tutti" o id di un calendario
const leggi = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } };
const scrivi = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

/** Il nome del calendario di un evento, nel suo colore; niente per quelli della casa. */
const etichettaCalendario = (e) => (!e.casa && e.calNome ? el("span.progetto", {}, e.calNome) : null);
/** Il progetto di un evento (7/11), col pallino del suo colore, tra i progetti che vedi. */
function etichettaProgetto(e, progetti = []) {
  const p = e.progetto ? progetti.find((x) => x.id === e.progetto) : null;
  return p ? el("span.progetto.progetto--evento", { "data-colore": p.colore || null }, p.name) : null;
}

/**
 * Quando, in una riga: "18:00 – 19:00", "Tutto il giorno, fino al 2 nov", "Dal 25 ott, fino al 2 nov"
 * (evento già iniziato prima del giorno in cui si mostra), più il luogo.
 */
export function quandoEvento(e, giorno = giornoMostrato(e)) {
  const prima = e.giornoInizio < giorno;
  const piuGiorni = e.giornoFine !== e.giornoInizio;
  let t;
  if (e.tuttoIlGiorno) {
    t = prima ? `Dal ${fmtDate(e.inizio)}, fino al ${fmtDate(e.fine)}` : piuGiorni ? `Tutto il giorno, fino al ${fmtDate(e.fine)}` : "Tutto il giorno";
  } else if (prima) {
    t = `Dal ${fmtDate(e.inizio)}, fino al ${fmtDate(e.fine)} alle ${oraDi(e.fine)}`;
  } else if (piuGiorni) {
    t = `${oraDi(e.inizio)} – ${fmtDate(e.fine)} ${oraDi(e.fine)}`;
  } else {
    t = e.fine > e.inizio ? `${oraDi(e.inizio)} – ${oraDi(e.fine)}` : oraDi(e.inizio);
  }
  return [t, e.luogo].filter(Boolean).join(" · ");
}

/**
 * Riga di un evento come una lezione: a sinistra il giorno (numero in serif, sotto «oggi» o il giorno della
 * settimana), a destra titolo e quando, preceduto dal nome del calendario se non è quello della casa (con
 * `conCalendario: false` no, es. con il filtro su quel calendario). Con `conGiorno: false` la colonna resta vuota
 * (stesso giorno della riga sopra). Toccandola si apre il foglio dell'evento.
 */
export function rigaEvento(e, { giorno = giornoMostrato(e), conGiorno = true, conCalendario = true, progetti = [] } = {}) {
  const d = new Date(`${giorno}T12:00:00`);
  const oggi = giorno === isoGiorno(new Date());
  return el("button.evento", { type: "button", "data-colore": !e.casa && e.colore ? e.colore : null, onclick: () => apriEvento(e) },
    el("div.evento__giorno", {}, conGiorno ? [el("b.display", {}, String(d.getDate())), el("small", {}, oggi ? "oggi" : GIORNI_BREVI[d.getDay()])] : null),
    el("div.evento__testo", {},
      el("div.evento__titolo", {}, e.titolo),
      el("div.evento__quando", {}, conCalendario ? etichettaCalendario(e) : null, etichettaProgetto(e, progetti), quandoEvento(e, giorno))),
  );
}

/** Eventi in ordine di elenco: per giorno in cui si mostrano, prima quelli di tutto il giorno, poi per ora. */
export function inOrdine(eventi, oggi = isoGiorno(new Date())) {
  return eventi.map((e) => ({ e, g: giornoMostrato(e, oggi) }))
    .sort((x, y) => (x.g < y.g ? -1 : x.g > y.g ? 1 : x.e.tuttoIlGiorno !== y.e.tuttoIlGiorno ? (x.e.tuttoIlGiorno ? -1 : 1) : x.e.inizio - y.e.inizio));
}

/**
 * Testo che apre il selettore nativo di data o ora (l'input resta invisibile): nel foglio dell'evento le date e le
 * ore si leggono come in Google Calendar, data a sinistra e ora a destra, senza pillole.
 */
function sceltaNativa(tipo, valore, testoDi, onChange, classe = "") {
  const input = el("input", { type: tipo, value: valore, tabindex: "-1", "aria-hidden": "true", style: "position:absolute;left:0;bottom:0;opacity:0;pointer-events:none;width:1px;height:1px" });
  const btn = el("button.ev-valore", { type: "button", class: classe, onclick: () => { try { input.showPicker(); } catch (e) { input.style.pointerEvents = "auto"; input.focus(); } } });
  const disegna = () => { btn.textContent = testoDi(input.value); };
  input.addEventListener("change", () => { if (input.value) onChange(input.value); disegna(); });
  disegna();
  return { nodo: el("span.ev-scelta", {}, btn, input), set(v) { input.value = v; disegna(); }, btn };
}

/** «Dom 29 nov 2026», come nel foglio di Google Calendar. */
const dataLunga = (iso) => cap(new Date(`${iso}T12:00:00`).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).replace(/\./g, ""));
/** Giorno ("AAAA-MM-GG") e ora ("HH:MM") → Date; e ritorno. */
const istante = (giorno, ora = "00:00") => new Date(`${giorno}T${ora}:00`);
const spostaGiorno = (giorno, n) => { const d = istante(giorno, "12:00"); d.setDate(d.getDate() + n); return isoGiorno(d); };
const UN_GIORNO = 864e5;
/**
 * L'ora piena dopo quella di adesso (come Google per un evento nuovo): { giorno, ora }. Per oggi, dopo le 23 si passa
 * a domani a mezzanotte (non un evento già passato); per un altro giorno resta quel giorno.
 */
function prossimaOra(giorno) {
  const d = new Date();
  const oggi = isoGiorno(d);
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return !giorno || giorno === oggi ? { giorno: isoGiorno(d), ora: oraDi(d) } : { giorno, ora: oraDi(d) };
}

/** Le ripetizioni tra cui scegliere, con i nomi detti a partire dal giorno dell'evento (chiavi di RIPETIZIONI). */
function ripetizioni(giorno) {
  const d = istante(giorno, "12:00");
  const settimana = d.toLocaleDateString("it-IT", { weekday: "long" });
  return [
    ["", "Non si ripete"],
    ["giorno", "Ogni giorno"],
    ["settimana", `Ogni settimana, ${d.getDay() === 0 ? "la" : "il"} ${settimana}`],
    ["mese", `Ogni mese, il giorno ${d.getDate()}`],
    ["anno", `Ogni anno, il ${d.getDate()} ${d.toLocaleDateString("it-IT", { month: "long" })}`],
    ["feriali", "Ogni giorno feriale (lun–ven)"],
  ];
}

/** Foglio di un evento che nell'app si legge soltanto: quando, luogo, note, il calendario e il link a Google. */
function apriLettura(e) {
  const d = new Date(`${e.giornoInizio}T12:00:00`);
  // Il progetto dell'evento, quando arrivano i progetti (di solito subito: l'ascolto è già aperto).
  const progettoLettura = e.progetto ? el("p.meta", { style: "margin-top:6px" }) : null;
  if (progettoLettura) readVisible("projects").then((ps) => { const l = etichettaProgetto(e, ps); if (l) progettoLettura.replaceChildren(l); });
  const giorno = cap(d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" }));
  openSheet({
    title: e.titolo,
    body: [
      el("p.meta", { style: "margin-top:12px", "data-colore": e.colore || null }, el("span.progetto", {}, e.calNome || "Calendario"), " · sola lettura"),
      progettoLettura,
      el("p.lettura__testo", { style: "margin-top:10px" }, `${giorno} · ${quandoEvento(e, e.giornoInizio)}`),
      e.note ? el("div.nota__testo.lettura__testo", {}, e.note) : null,
      el("p.muted.small", { style: "margin-top:16px" }, calendariNoti().find((c) => c.id === e.calId)?.modificabile
        ? "È un invito: lo modifica chi l'ha creato."
        : "Nell'app questo calendario si legge soltanto: lo modifichi da Google Calendar."),
      e.link ? el("div.foglio__piede", {}, el("a.btn", { href: e.link, target: "_blank", rel: "noopener", style: "text-decoration:none" }, icon("calendario"), "Apri in Google")) : null,
    ],
  });
}

/**
 * Foglio dell'evento, con la struttura di quello di Google Calendar (7/11, richiesta di Mattia con la sua schermata):
 * - in cima il titolo grande (Invio salva) e, se si può scrivere in più d'un calendario, le pillole dei calendari col
 *   loro colore;
 * - poi il quando: «Tutto il giorno» con la spunta a destra, la riga dell'inizio e quella della fine (data a sinistra,
 *   ora a destra; si toccano e si apre il selettore del telefono), la ripetizione («Non si ripete», le altre si
 *   aprono sotto);
 * - poi il progetto (7/11: pillole dei progetti col loro colore, «Nessuno»; si salva nell'evento su Google), il luogo
 *   e la descrizione (le note), ciascuno con la sua icona.
 * Come in Google: un evento nuovo è con orario, dall'ora piena dopo adesso, e dura un'ora; spostando l'inizio la fine
 * lo segue (la durata resta), una fine prima dell'inizio nello stesso giorno passa al giorno dopo. Il fuso è sempre
 * quello dell'app (Europe/Rome), quindi la riga del fuso non c'è. Una ricorrenza di un evento che si ripete si cambia
 * solo per quella volta: la riga della ripetizione lo dice e non si apre.
 * Un evento di un calendario che nell'app si legge soltanto apre apriLettura.
 * prefill: { titolo, giorno, ora, tuttoIlGiorno, luogo, note, calId, progetto }. Esportato: lo usano il Diario e le note.
 */
export function apriEvento(esistente = null, prefill = {}) {
  if (esistente && esistente.modificabile === false) { apriLettura(esistente); return; }
  const e = esistente || {};
  // Dove scrivere: i calendari modificabili (la casa e il personale); per un evento nuovo quello del filtro, se è
  // modificabile, altrimenti la casa.
  const scrivibili = calendariNoti().filter((c) => c.modificabile);
  let calId = (esistente ? e.calId : prefill.calId) || scrivibili.find((c) => c.casa)?.id || scrivibili[0]?.id || "";
  if (!scrivibili.some((c) => c.id === calId)) calId = scrivibili[0]?.id || calId;
  const sceltaCal = el("div.segmenti.ev-calendari");
  const disegnaCal = () => sceltaCal.replaceChildren(...scrivibili.map((c) => el("button.pillola", {
    type: "button", class: c.id === calId ? "on" : "", onclick: () => { calId = c.id; disegnaCal(); },
  }, c.casa ? icon("casa") : el("span.colore.colore--pallino", { "data-colore": c.colore || null }), c.nome)));
  disegnaCal();

  // ── Quando ──
  let tutto = esistente ? !!e.tuttoIlGiorno : !!prefill.tuttoIlGiorno;
  let giorno, ora, giornoFine, oraFine;
  if (esistente && !e.tuttoIlGiorno) {
    giorno = e.giornoInizio; ora = oraDi(e.inizio); giornoFine = e.giornoFine; oraFine = oraDi(e.fine);
  } else {
    const p = prossimaOra(esistente ? e.giornoInizio : prefill.giorno);
    giorno = esistente ? e.giornoInizio : p.giorno;
    ora = prefill.ora || p.ora;
    const f = new Date(istante(giorno, ora).getTime() + 3600e3);
    oraFine = oraDi(f);
    giornoFine = esistente ? e.giornoFine : tutto ? giorno : isoGiorno(f);
  }
  // La durata si tiene quando si sposta l'inizio: in ms con l'orario, in giorni per quelli di tutto il giorno.
  const durata = () => istante(giornoFine, oraFine) - istante(giorno, ora);
  const giorniDurata = () => Math.round((istante(giornoFine, "12:00") - istante(giorno, "12:00")) / UN_GIORNO);

  const dataInizio = sceltaNativa("date", giorno, dataLunga, (v) => {
    const g = giorniDurata(), d = durata();
    giorno = v;
    if (tutto) giornoFine = spostaGiorno(giorno, Math.max(0, g));
    else { const f = new Date(istante(giorno, ora).getTime() + d); giornoFine = isoGiorno(f); oraFine = oraDi(f); }
    disegnaQuando();
  });
  const oraInizio = sceltaNativa("time", ora, (v) => v, (v) => {
    const d = durata();
    ora = v;
    const f = new Date(istante(giorno, ora).getTime() + d);
    giornoFine = isoGiorno(f); oraFine = oraDi(f);
    disegnaQuando();
  }, "ev-valore--ora");
  const dataFine = sceltaNativa("date", giornoFine, dataLunga, (v) => {
    const prima = durata();
    giornoFine = v < giorno ? giorno : v;
    if (!tutto && durata() <= 0) { const f = new Date(istante(giorno, ora).getTime() + Math.max(prima, 3600e3)); giornoFine = isoGiorno(f); oraFine = oraDi(f); }
    disegnaQuando();
  });
  const oraFineScelta = sceltaNativa("time", oraFine, (v) => v, (v) => {
    // Come Google: in un evento di meno di un giorno l'ora di fine è la prima dopo l'inizio (22:00 → 01:00 è la notte
    // dopo, 23:00 → 23:45 lo stesso giorno anche se prima finiva a mezzanotte); in uno di più giorni cambia solo l'ora.
    const corto = durata() < UN_GIORNO;
    oraFine = v;
    if (corto) giornoFine = v > ora ? giorno : spostaGiorno(giorno, 1);
    else if (durata() <= 0) unOra();
    disegnaQuando();
  }, "ev-valore--ora");
  /** Fine un'ora dopo l'inizio (quando la fine non è più dopo l'inizio). */
  const unOra = () => { const f = new Date(istante(giorno, ora).getTime() + 3600e3); giornoFine = isoGiorno(f); oraFine = oraDi(f); };

  const spunta = el("span.spunta", { "aria-hidden": "true" }, icon("spunta"));
  const tuttoBtn = el("button.ev-riga", { type: "button", role: "switch", onclick: () => {
    tutto = !tutto;
    // Con l'orario fino a mezzanotte (23:00 – 00:00 del giorno dopo) l'ultimo giorno è quello prima: per tutto il giorno
    // conta il giorno dell'ultimo minuto.
    if (tutto) giornoFine = [giorno, isoGiorno(new Date(istante(giornoFine, oraFine).getTime() - 60e3))].sort()[1];
    if (!tutto && durata() <= 0) unOra();
    disegnaQuando();
  } }, icon("orologio"), el("span.ev-riga__testo", {}, "Tutto il giorno"), spunta);

  // Ripetizione: per un evento nuovo o singolo; una ricorrenza si cambia solo per quella volta.
  let ripeti = "";
  let ripetiAperta = false;
  const ripetiTesto = el("span.ev-riga__testo");
  const ripetiRiga = el("button.ev-riga", { type: "button", "aria-expanded": "false", disabled: !!e.serie,
    onclick: () => { ripetiAperta = !ripetiAperta; disegnaRipeti(); } }, icon("ripeti"), ripetiTesto);
  const ripetiScelte = el("div.ev-opzioni", { hidden: true });
  function disegnaRipeti() {
    const opzioni = ripetizioni(giorno);
    ripetiTesto.textContent = e.serie ? "Si ripete: cambi solo questa volta" : opzioni.find(([k]) => k === ripeti)[1];
    ripetiRiga.setAttribute("aria-expanded", ripetiAperta ? "true" : "false");
    ripetiScelte.hidden = !ripetiAperta;
    ripetiScelte.replaceChildren(...opzioni.map(([k, testo]) => el("button.ev-opzione", { type: "button", "aria-pressed": k === ripeti ? "true" : "false",
      onclick: () => { ripeti = k; ripetiAperta = false; disegnaRipeti(); } }, el("span", {}, testo), k === ripeti ? icon("spunta") : null)));
  }

  const rigaInizio = el("div.ev-riga.ev-riga--rientro", {}, dataInizio.nodo, oraInizio.nodo);
  const rigaFine = el("div.ev-riga.ev-riga--rientro", {}, dataFine.nodo, oraFineScelta.nodo);
  function disegnaQuando() {
    spunta.classList.toggle("on", tutto);
    tuttoBtn.setAttribute("aria-checked", tutto ? "true" : "false");
    dataInizio.set(giorno); dataFine.set(giornoFine); oraInizio.set(ora); oraFineScelta.set(oraFine);
    oraInizio.nodo.hidden = tutto; oraFineScelta.nodo.hidden = tutto;
    disegnaRipeti();
  }
  disegnaQuando();

  // ── Progetto (7/11): i progetti attivi che vedi, quando arrivano (di solito subito: l'ascolto è già aperto) ──
  let progetto = esistente ? e.progetto || "" : prefill.progetto || "";
  let progetti = [];
  const sceltaProg = el("div.segmenti.ev-progetti");
  const rigaProg = el("div.ev-riga.ev-riga--campo", { hidden: true }, icon("cartella"), sceltaProg);
  const disegnaProg = () => sceltaProg.replaceChildren(
    el("button.pillola", { type: "button", class: progetto ? "" : "on", onclick: () => { progetto = ""; disegnaProg(); } }, "Nessun progetto"),
    ...progetti.map((p) => pillolaProgetto(p, { on: p.id === progetto, onclick: () => { progetto = p.id; disegnaProg(); } })),
  );
  readVisible("projects").then((ps) => {
    progetti = ps.filter((p) => !p.archived || p.id === progetto).sort((a, b) => a.name.localeCompare(b.name));
    rigaProg.hidden = !progetti.length;
    disegnaProg();
  });

  // ── Titolo, luogo, descrizione ──
  const titolo = el("input.nota__titolo-campo.ev-titolo", { value: e.titolo && e.titolo !== "(senza titolo)" ? e.titolo : prefill.titolo || "", placeholder: "Aggiungi titolo",
    "aria-label": "Titolo dell'evento", autocomplete: "off", autofocus: !esistente, enterkeyhint: "done" });
  titolo.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); sheet.confirm(); } });
  const luogo = el("input.linea-input", { value: e.luogo || prefill.luogo || "", placeholder: "Aggiungi luogo", "aria-label": "Luogo", enterkeyhint: "done" });
  luogo.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); sheet.confirm(); } });
  const note = el("textarea.linea-input", { value: e.note || prefill.note || "", placeholder: "Aggiungi descrizione", "aria-label": "Descrizione", rows: 1 });

  const sheet = openSheet({
    title: esistente ? "Evento" : "Nuovo evento",
    body: [
      el("div.ev-gruppo.ev-gruppo--testa", {}, titolo, scrivibili.length > 1 ? sceltaCal : null),
      el("div.ev-gruppo", {}, tuttoBtn, rigaInizio, rigaFine, ripetiRiga, ripetiScelte),
      el("div.ev-gruppo", {},
        rigaProg,
        el("label.ev-riga.ev-riga--campo", {}, icon("luogo"), luogo),
        el("label.ev-riga.ev-riga--campo", {}, icon("appunto"), note)),
      esistente ? el("div.foglio__piede", {},
        e.link ? el("a.btn", { href: e.link, target: "_blank", rel: "noopener", style: "text-decoration:none" }, icon("calendario"), "In Google") : null,
        el("button.btn.btn--pericolo", { type: "button", onclick: async () => {
          try { await eliminaEvento(e); sheet.close(); toast(e.serie ? "Eliminato per questa volta" : "Evento eliminato"); }
          catch (err) { toast(`Non eliminato: ${messaggioGoogle(err, "il calendario").testo}`, { ms: 6000 }); }
        } }, icon("cestino"), "Elimina"),
      ) : null,
    ],
    onConfirm: async () => {
      const t = titolo.value.trim();
      if (!t) { titolo.focus(); return false; }
      const dati = {
        titolo: t, giorno, giornoFine: tutto ? (giornoFine > giorno ? giornoFine : "") : giornoFine,
        ora: tutto ? "" : ora, oraFine: tutto ? "" : oraFine, luogo: luogo.value.trim(), note: note.value.trim(),
        ripeti: e.serie ? "" : ripeti, progetto,
      };
      try {
        const fatto = esistente ? await aggiornaEvento(e, dati, calId) : await creaEvento(dati, calId);
        toast(esistente ? (fatto.calId !== e.calId ? `Evento spostato in ${fatto.calNome}` : "Evento aggiornato")
          : fatto.casa ? "Evento nel calendario della casa" : `Evento in ${fatto.calNome}`);
      } catch (err) {
        const m = messaggioGoogle(err, "il calendario");
        toast(/nessun-calendario|sola-lettura/.test(err.motivo || "") ? err.message : `${m.titolo}: ${m.testo}`, { ms: 6000 });
        return false;
      }
    },
  });
}

// Colori proposti a un calendario appena scelto, in quest'ordine (il primo non già usato da un altro).
const PREFERITI = ["blu", "viola", "rosso", "verde", "arancio", "azzurro", "rosa", "ocra", "terra", "grigio", "giallo"];

/**
 * Foglio «Calendari»: quale calendario è quello della casa (uno, lo stesso per entrambi) e quali altri vedere
 * accanto (solo chi li sceglie: users.calendari), ciascuno con il suo colore. Nell'app si scrive solo nel
 * calendario principale dell'account, oltre a quello della casa: gli altri si leggono. Si salva con Salva.
 * `dopo()` dopo il salvataggio. Esportato: lo apre anche la pagina Google.
 */
export async function apriSceltaCalendari(dopo) {
  const elenco = el("div", {}, el("p.meta", { style: "padding:16px 0" }, "Leggo i calendari…"));
  const casaPrima = await calendarioCasa({ fresh: true }).catch(() => null);
  const altriPrima = altriCalendari();
  let casaId = casaPrima?.id || "";
  let cambiaCasa = !casaId; // l'elenco per scegliere la casa è aperto (senza casa, sì)
  const scelti = new Map(altriPrima.map((c) => [c.id, { ...c }]));
  let calendari = null;

  const sheet = openSheet({
    title: "Calendari",
    body: [elenco],
    onConfirm: async () => {
      if (!calendari) return;
      const daGoogle = (id) => calendari.find((c) => c.id === id);
      // Un calendario che Google non elenca più (non più condiviso) esce dalla scelta.
      const altri = [...scelti.values()].filter((c) => c.id !== casaId && daGoogle(c.id)).map((c) => {
        const g = daGoogle(c.id);
        return { id: c.id, nome: g.nome, colore: c.colore, modificabile: g.primario && g.scrivibile };
      });
      const nuovaCasa = casaId !== (casaPrima?.id || "");
      const nuoviAltri = JSON.stringify(altri) !== JSON.stringify(altriPrima.map(({ id, nome, colore, modificabile }) => ({ id, nome, colore, modificabile: !!modificabile })));
      try {
        if (nuovaCasa) await scegliCalendario(casaId ? { id: casaId, nome: daGoogle(casaId)?.nome || casaId } : null);
        if (nuoviAltri) await scegliAltri(altri);
      } catch (err) { toast(`Non salvato: ${err.code || err.message}`); return false; }
      if (nuovaCasa) toast(casaId ? `Calendario della casa: ${daGoogle(casaId)?.nome || casaId}` : "Nessun calendario della casa");
      else if (nuoviAltri) toast("Calendari aggiornati");
      if (nuovaCasa || nuoviAltri) dopo?.();
    },
  });

  const sotto = (c) => [c.primario ? "Il tuo calendario principale" : "", c.scrivibile ? "" : "Condiviso con te in sola lettura"].filter(Boolean).join(" · ");
  function rigaCasa(c, { aperta }) {
    const scelto = c ? c.id === casaId : !casaId;
    return el("div.riga", { onclick: () => {
      if (!aperta) { cambiaCasa = true; disegna(); return; }
      casaId = c ? c.id : ""; scelti.delete(casaId); cambiaCasa = false; disegna();
    } },
      el("div.pallino", { class: scelto ? "pallino--accento" : "" }, icon(scelto ? "spunta" : "casa")),
      el("div.testo", {}, el("b", {}, c ? c.nome : "Nessuno"), el("span", {}, !aperta ? "Tocca per cambiarlo" : c ? sotto(c) : "Nessun calendario della casa")),
      aperta ? null : icon("freccia", "freccia-riga"));
  }
  function rigaAltro(c) {
    const s = scelti.get(c.id);
    const colori = s ? el("div.colori.colori--piccoli", {}, ...COLORI.map(([v, l]) => el("button.colore", {
      type: "button", "data-colore": v, "aria-label": l, "aria-pressed": v === s.colore ? "true" : "false",
      onclick: (ev) => { ev.stopPropagation(); s.colore = v; disegna(); },
    }, v === s.colore ? icon("spunta") : null))) : null;
    return el("div.riga", { style: "align-items:flex-start", onclick: () => {
      if (s) scelti.delete(c.id);
      else {
        const usati = new Set([...scelti.values()].map((x) => x.colore));
        scelti.set(c.id, { id: c.id, nome: c.nome, colore: PREFERITI.find((v) => !usati.has(v)) || PREFERITI[0], modificabile: c.primario && c.scrivibile });
      }
      disegna();
    } },
      s ? el("div.pallino.pallino--colore", { "data-colore": s.colore }, icon("spunta")) : el("div.pallino", {}, icon("calendario")),
      el("div.testo", { style: "padding-top:2px" }, el("b", {}, c.nome),
        el("span", {}, s ? (c.primario && c.scrivibile ? "Lo modifichi anche dall'app" : "Nell'app si legge soltanto") : sotto(c)),
        colori),
    );
  }
  function disegna() {
    if (!sheet.aperto()) return;
    const casa = calendari.find((c) => c.id === casaId);
    const nodi = [fascia("Della casa"),
      el("p.muted.small", {}, "Lo vedete entrambi: va condiviso con l'altra persona da Google Calendar, con il permesso di modificare. Qui finiscono gli eventi che aggiungi e quelli proposti dall'agente.")];
    if (!cambiaCasa) {
      nodi.push(casa ? rigaCasa(casa, { aperta: false })
        : el("div.riga", { onclick: () => { cambiaCasa = true; disegna(); } },
          el("div.pallino.pallino--accento", {}, icon("casa")),
          el("div.testo", {}, el("b", {}, casaPrima?.nome || "Casa"), el("span.tardi", {}, "Non è tra i calendari del tuo account: va condiviso con te da Google Calendar")),
          icon("freccia", "freccia-riga")));
    } else {
      nodi.push(...calendari.map((c) => rigaCasa(c, { aperta: true })));
      if (casaId) nodi.push(rigaCasa(null, { aperta: true }));
    }
    nodi.push(fascia("Da vedere anche"),
      el("p.muted.small", {}, "Li vedi solo tu, accanto a quelli della casa, ciascuno con il suo colore. Nell'app scrivi solo nel tuo calendario principale; gli altri, gestiti anche da altre persone, si leggono e si aprono in Google."),
      ...calendari.filter((c) => c.id !== casaId).map(rigaAltro));
    elenco.replaceChildren(...nodi);
  }
  try {
    calendari = await elencoCalendari();
    if (!calendari.length) { elenco.replaceChildren(vuoto("Nessun calendario", "Google non ha restituito calendari per questo account.")); return; }
    disegna();
  } catch (err) {
    const m = messaggioGoogle(err, "il calendario");
    elenco.replaceChildren(vuoto(m.titolo, m.testo));
  }
}

export function mount(container) {
  let eventi = eventiNoti(); // già letti in una visita precedente: la pagina si disegna piena subito
  let errore = null;         // nessun calendario ha risposto
  let calendari = calendariNoti();
  let filtro = leggi(CHIAVE_FILTRO, "tutti");
  let progetti = []; // per il nome e il colore del progetto di un evento
  const dati = attesa(["eventi"], render);
  // Con l'elenco dei calendari già noto (lo legge anche il Diario all'apertura) la pagina si disegna subito;
  // senza, aspetta: con le pillole che arrivano dopo, l'agenda scenderebbe.
  if (eventi && calendari.length) dati.arriva("eventi");

  const corpo = el("div");
  const piu = fab("Nuovo evento", () => apriEvento(null, { calId: filtro !== "tutti" ? filtro : "" }));
  const mostra = (...nodi) => corpo.replaceChildren(...nodi.filter(Boolean));
  const scegli = (v) => { filtro = v; scrivi(CHIAVE_FILTRO, v); render(); };

  function render() {
    if (!dati.pronta()) { mostra(); return; }
    const g = statoGoogle();
    piu.hidden = !(g.collegato && g.permessi.calendario && calendari.some((c) => c.modificabile));

    if (!g.collegato || !g.permessi.calendario) {
      mostra(
        vuoto(g.collegato ? "Manca il permesso per il calendario" : "Google non collegato", g.collegato ? "Ricollega Google e lascia la spunta sul calendario." : "I calendari vivono in Google Calendar: collega il tuo account per vederli qui."),
        el("div.segmenti", { style: "justify-content:center" }, el("button.btn", { type: "button", onclick: () => vaiA("google") }, icon("collegamento"), g.collegato ? "Ricollega Google" : "Collega Google")),
      );
      return;
    }
    if (!calendari.length) {
      mostra(
        vuoto("Nessun calendario", "Scegli il calendario della casa, che vedrete entrambi se lo condividi con l'altra persona, e gli altri tuoi calendari da vedere qui."),
        el("div.segmenti", { style: "justify-content:center" }, el("button.btn", { type: "button", onclick: () => apriSceltaCalendari() }, icon("calendario"), "Scegli i calendari")),
      );
      return;
    }
    if (errore) {
      const m = messaggioGoogle(errore, "il calendario");
      const nonCondiviso = (errore.status === 404 || errore.motivo === "notFound") && calendari.length === 1;
      mostra(
        el("p.meta", { style: "margin-top:12px" }, calendari.length === 1 && calendari[0].casa ? `Calendario della casa: ${calendari[0].nome}` : "Calendari"),
        vuoto(nonCondiviso ? "Calendario non raggiungibile con il tuo account" : m.titolo,
          nonCondiviso ? "Chi l'ha scelto deve condividerlo con te da Google Calendar (con il permesso di modificare); poi ricarica." : m.testo),
      );
      return;
    }
    if (!eventi) { mostra(el("p.meta", { style: "padding:22px 0" }, "Leggo il calendario…")); return; }

    if (filtro !== "tutti" && !calendari.some((c) => c.id === filtro)) filtro = "tutti";
    const scelto = calendari.find((c) => c.id === filtro) || null;
    // Gli eventi di un calendario appena tolto non restano a vista mentre si rilegge (senza calId: letture di prima).
    const visibili = eventi.filter((e) => (scelto ? e.calId === scelto.id : !e.calId || calendari.some((c) => c.id === e.calId)));
    const giorni = finestra().giorni;
    const nodi = [];
    // Pillole per vedere un calendario solo, quando sono più d'uno.
    if (calendari.length > 1) {
      nodi.push(el("div.segmenti.filtri-calendari", { style: "padding-top:8px" },
        el("button.pillola", { type: "button", class: scelto ? "" : "on", onclick: () => scegli("tutti") }, "Tutti"),
        ...calendari.map((c) => el("button.pillola", { type: "button", class: scelto?.id === c.id ? "on" : "", onclick: () => scegli(c.id) },
          c.casa ? icon("casa") : el("span.colore.colore--pallino", { "data-colore": c.colore || null }), c.nome))));
    }
    nodi.push(el("p.meta", { style: "margin-top:12px" }, calendari.length === 1 ? `${calendari[0].nome} · prossimi ${giorni} giorni` : `Prossimi ${giorni} giorni`,
      calendari.some((c) => c.casa) ? "" : " · manca il calendario della casa"));
    // Un calendario che non risponde non ferma gli altri: si dice quale.
    for (const x of erroriLettura()) {
      const m = messaggioGoogle(x.err, "il calendario");
      const nonCondiviso = x.err?.status === 404 || x.err?.motivo === "notFound";
      nodi.push(el("div.nota-campo", { style: "margin:10px 0 0;color:var(--frutto)" }, icon("avviso"),
        el("span", {}, el("b", {}, x.nome), ": ", nonCondiviso ? "non raggiungibile con il tuo account, va condiviso con te da Google Calendar." : m.testo)));
    }

    // Agenda: una fascia per mese, una riga per evento; il numero del giorno solo sulla prima riga del giorno.
    // Un evento di più giorni compare una volta, nel suo primo giorno (o oggi, se è già iniziato).
    const oggi = isoGiorno(new Date());
    const anno = new Date().getFullYear();
    let mese = null;
    let giorno = null;
    for (const { e, g: gg } of inOrdine(visibili, oggi)) {
      const d = new Date(`${gg}T12:00:00`);
      const m = gg.slice(0, 7);
      if (m !== mese) {
        mese = m;
        const nome = meseLungo(d);
        nodi.push(fascia(cap(d.getFullYear() === anno ? nome.split(" ")[0] : nome)));
        giorno = null;
      }
      nodi.push(rigaEvento(e, { giorno: gg, conGiorno: gg !== giorno, conCalendario: !scelto, progetti }));
      giorno = gg;
    }
    if (!visibili.length) {
      nodi.push(el("p.meta", { style: "margin-top:18px" }, `Nessun evento nei prossimi ${giorni} giorni${scelto ? ` in ${scelto.nome}` : ""}.`,
        !piu.hidden && (!scelto || scelto.modificabile) ? " Tocca + per aggiungerne uno." : ""));
    }
    mostra(...nodi);
  }

  async function carica({ forza = false } = {}) {
    calendari = await calendariVisti({ fresh: forza });
    if (!calendari.length || !statoGoogle().permessi.calendario) { dati.arriva("eventi"); render(); return; }
    if (eventi) { dati.arriva("eventi"); render(); }
    try {
      eventi = await leggiEventi({ forza });
      errore = null;
    } catch (err) {
      console.warn("calendario", err);
      errore = err;
    }
    dati.arriva("eventi");
    render();
  }

  container.append(corpo, piu);
  const stopEventi = suEventi((lista) => { eventi = lista; errore = null; render(); });
  const stopGoogle = suGoogle(() => carica({ forza: true }));
  const stopCalendari = suCalendari(() => carica({ forza: true }));
  render();
  carica();

  const stopProgetti = watchVisible("projects", {}, (docs) => { progetti = docs; if (dati.pronta()) render(); });
  return () => { stopEventi(); stopGoogle(); stopCalendari(); stopProgetti(); dati.ferma(); piu.remove(); };
}
