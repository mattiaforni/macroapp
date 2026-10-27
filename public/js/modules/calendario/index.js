// Calendario della casa: agenda dei prossimi giorni dal calendario «Casa» di Google Calendar
// (core/calendario.js), condiviso tra i due. Il + in basso a destra apre il foglio di un evento nuovo,
// che si scrive subito su Google; toccando un evento si legge e si modifica. Gli eventi che l'agente
// ricava dalle note passano invece dalla conferma (proposta «event», components/proposals.js).
// Aspetto (27/10, scelta di Mattia tra due schermate): come le lezioni del tennis, il giorno grande in
// Instrument Serif a sinistra e il giorno della settimana sotto, una fascia per mese; più eventi dello stesso
// giorno condividono il numero. `rigaEvento` la usa anche «Prossimi giorni» in cima al Diario.
import { el, icon, toast, fab, vuoto, fascia, attesa, isoGiorno, fmtDate, meseLungo } from "../../core/ui.js";
import { statoGoogle, messaggioGoogle, suGoogle } from "../../core/google.js";
import {
  calendarioCasa, leggiEventi, eventiNoti, suEventi, creaEvento, aggiornaEvento, eliminaEvento, oraDi, finestra, giornoMostrato,
} from "../../core/calendario.js";
import { openSheet, campo } from "../../components/sheet.js";
import { vaiA } from "../../core/router.js";

export const id = "calendario";
export const title = "Calendario";
export const nav = false;
const navIcon = "calendario";
export { navIcon as icon };

const GIORNI_BREVI = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

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
 * settimana), a destra titolo e quando. Con `conGiorno: false` la colonna resta vuota (stesso giorno della riga
 * sopra). Toccandola si apre il foglio dell'evento.
 */
export function rigaEvento(e, { giorno = giornoMostrato(e), conGiorno = true } = {}) {
  const d = new Date(`${giorno}T12:00:00`);
  const oggi = giorno === isoGiorno(new Date());
  return el("button.evento", { type: "button", onclick: () => apriEvento(e) },
    el("div.evento__giorno", {}, conGiorno ? [el("b.display", {}, String(d.getDate())), el("small", {}, oggi ? "oggi" : GIORNI_BREVI[d.getDay()])] : null),
    el("div.evento__testo", {},
      el("div.evento__titolo", {}, e.titolo),
      el("div.evento__quando", {}, quandoEvento(e, giorno))),
  );
}

/** Eventi in ordine di elenco: per giorno in cui si mostrano, prima quelli di tutto il giorno, poi per ora. */
export function inOrdine(eventi, oggi = isoGiorno(new Date())) {
  return eventi.map((e) => ({ e, g: giornoMostrato(e, oggi) }))
    .sort((x, y) => (x.g < y.g ? -1 : x.g > y.g ? 1 : x.e.tuttoIlGiorno !== y.e.tuttoIlGiorno ? (x.e.tuttoIlGiorno ? -1 : 1) : x.e.inizio - y.e.inizio));
}

/** Pillola che apre il selettore nativo di data o ora (l'input resta invisibile). */
function pillolaScelta(tipo, valore, testoDi, onChange) {
  const input = el("input", { type: tipo, value: valore, style: "position:absolute;opacity:0;pointer-events:none;width:1px;height:1px" });
  const btn = el("button.pillola", { type: "button", onclick: () => { try { input.showPicker(); } catch (e) { input.style.pointerEvents = "auto"; input.focus(); } } });
  const disegna = () => btn.replaceChildren(icon(tipo === "date" ? "calendario" : "orologio"), testoDi(input.value));
  input.addEventListener("change", () => { onChange(input.value); disegna(); });
  disegna();
  return { nodo: el("span", { style: "position:relative;display:inline-flex" }, btn, input), set(v) { input.value = v; disegna(); } };
}

const giornoDa = (iso) => fmtDate(new Date(`${iso}T12:00:00`));

/**
 * Foglio dell'evento: titolo (Invio salva), giorno, tutto il giorno o con orario, luogo, note.
 * prefill: { titolo, giorno, ora, luogo, note }. Esportato: lo usa la conferma delle proposte.
 */
export function apriEvento(esistente = null, prefill = {}) {
  const e = esistente || {};
  let giorno = e.giornoInizio || prefill.giorno || isoGiorno(new Date());
  let giornoFine = esistente ? e.giornoFine : giorno;
  let conOrario = esistente ? !e.tuttoIlGiorno : !!prefill.ora;
  let ora = esistente && !e.tuttoIlGiorno ? oraDi(e.inizio) : prefill.ora || "09:00";
  let oraFine = esistente && !e.tuttoIlGiorno ? oraDi(e.fine) : "";

  const titolo = el("input.linea-input", { value: e.titolo && e.titolo !== "(senza titolo)" ? e.titolo : prefill.titolo || "", placeholder: "Cosa", autofocus: !esistente, enterkeyhint: "done", style: "font-size:19px" });
  titolo.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); sheet.confirm(); } });

  const dal = pillolaScelta("date", giorno, giornoDa, (v) => { giorno = v; if (giornoFine < giorno) { giornoFine = giorno; al.set(giorno); } });
  const al = pillolaScelta("date", giornoFine, (v) => (v === giorno ? "Stesso giorno" : `fino al ${giornoDa(v)}`), (v) => { giornoFine = v < giorno ? giorno : v; al.set(giornoFine); });
  const inizio = pillolaScelta("time", ora, (v) => v || "Ora", (v) => { ora = v; });
  const fine = pillolaScelta("time", oraFine, (v) => (v ? `fino alle ${v}` : "Un'ora"), (v) => { oraFine = v; });
  const orari = el("div.segmenti", { style: "padding-top:0" }, inizio.nodo, fine.nodo);
  const sceltaOrario = el("div.segmenti", { style: "padding-top:0" });
  const disegnaOrario = () => {
    sceltaOrario.replaceChildren(
      el("button.pillola", { type: "button", class: conOrario ? "" : "on", onclick: () => { conOrario = false; disegnaOrario(); } }, "Tutto il giorno"),
      el("button.pillola", { type: "button", class: conOrario ? "on" : "", onclick: () => { conOrario = true; disegnaOrario(); } }, "Con orario"),
    );
    orari.hidden = !conOrario;
  };
  disegnaOrario();

  const luogo = el("input.linea-input", { value: e.luogo || prefill.luogo || "", placeholder: "Dove (facoltativo)", enterkeyhint: "done" });
  luogo.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); sheet.confirm(); } });
  const note = el("textarea", { value: e.note || prefill.note || "", placeholder: "Note (facoltative)", rows: 3 });

  const sheet = openSheet({
    title: esistente ? "Evento" : "Nuovo evento",
    body: [
      el("div.campo", { style: "margin-top:14px" }, titolo),
      el("div.campo", {}, el("label", {}, "Giorno"), el("div.segmenti", { style: "padding-top:0;flex-wrap:wrap" }, dal.nodo, al.nodo)),
      el("div.campo", {}, el("label", {}, "Orario"), sceltaOrario, orari),
      el("div.campo", {}, el("label", {}, "Luogo"), luogo),
      campo("Note", note),
      esistente ? el("div.foglio__piede", {},
        e.link ? el("a.btn", { href: e.link, target: "_blank", rel: "noopener", style: "text-decoration:none" }, icon("calendario"), "In Google") : null,
        el("button.btn.btn--pericolo", { type: "button", onclick: async () => {
          try { await eliminaEvento(e.id); sheet.close(); toast("Evento eliminato"); }
          catch (err) { toast(`Non eliminato: ${messaggioGoogle(err, "il calendario").testo}`, { ms: 6000 }); }
        } }, icon("cestino"), "Elimina"),
      ) : null,
    ],
    onConfirm: async () => {
      const t = titolo.value.trim();
      if (!t) { titolo.focus(); return false; }
      const dati = { titolo: t, giorno, giornoFine: giornoFine > giorno ? giornoFine : "", ora: conOrario ? ora : "", oraFine: conOrario ? oraFine : "", luogo: luogo.value.trim(), note: note.value.trim() };
      try {
        if (esistente) await aggiornaEvento(e.id, dati);
        else await creaEvento(dati);
        toast(esistente ? "Evento aggiornato" : "Evento nel calendario della casa");
      } catch (err) {
        const m = messaggioGoogle(err, "il calendario");
        toast(err.motivo === "nessun-calendario" ? err.message : `${m.titolo}: ${m.testo}`, { ms: 6000 });
        return false;
      }
    },
  });
}

export function mount(container) {
  let eventi = eventiNoti(); // già letti in una visita precedente: la pagina si disegna piena subito
  let errore = null;
  let casa = null;
  const dati = attesa(["eventi"], render);
  if (eventi) dati.arriva("eventi");

  const corpo = el("div");
  const piu = fab("Nuovo evento", () => apriEvento(null));
  const mostra = (...nodi) => corpo.replaceChildren(...nodi.filter(Boolean));

  function render() {
    if (!dati.pronta()) { mostra(); return; }
    const g = statoGoogle();
    const pronto = g.collegato && g.permessi.calendario && casa;
    piu.hidden = !pronto;

    if (!g.collegato || !g.permessi.calendario) {
      mostra(
        vuoto(g.collegato ? "Manca il permesso per il calendario" : "Google non collegato", g.collegato ? "Ricollega Google e lascia la spunta sul calendario." : "Il calendario della casa vive in Google Calendar: collega il tuo account per vederlo qui."),
        el("div.segmenti", { style: "justify-content:center" }, el("button.btn", { type: "button", onclick: () => vaiA("google") }, icon("collegamento"), g.collegato ? "Ricollega Google" : "Collega Google")),
      );
      return;
    }
    if (!casa) {
      mostra(
        vuoto("Nessun calendario della casa", "Scegli quale dei tuoi calendari di Google è quello della casa: lo vedrete entrambi, se lo condividi con l'altra persona."),
        el("div.segmenti", { style: "justify-content:center" }, el("button.btn", { type: "button", onclick: () => vaiA("google", "calendario") }, icon("calendario"), "Scegli il calendario")),
      );
      return;
    }
    if (errore) {
      const m = messaggioGoogle(errore, "il calendario");
      const nonCondiviso = errore.status === 404 || errore.motivo === "notFound";
      mostra(
        el("p.meta", { style: "margin-top:12px" }, `Calendario della casa: ${casa.nome}`),
        vuoto(nonCondiviso ? "Calendario non raggiungibile con il tuo account" : m.titolo,
          nonCondiviso ? "Chi l'ha scelto deve condividerlo con te da Google Calendar (con il permesso di modificare); poi ricarica." : m.testo),
      );
      return;
    }
    if (!eventi) { mostra(el("p.meta", { style: "padding:22px 0" }, "Leggo il calendario…")); return; }

    // Agenda: una fascia per mese, una riga per evento; il numero del giorno solo sulla prima riga del giorno.
    // Un evento di più giorni compare una volta, nel suo primo giorno (o oggi, se è già iniziato).
    const oggi = isoGiorno(new Date());
    const anno = new Date().getFullYear();
    const nodi = [el("p.meta", { style: "margin-top:12px" }, `${casa.nome} · prossimi ${finestra().giorni} giorni`)];
    let mese = null;
    let giorno = null;
    for (const { e, g } of inOrdine(eventi, oggi)) {
      const d = new Date(`${g}T12:00:00`);
      const m = g.slice(0, 7);
      if (m !== mese) {
        mese = m;
        const nome = meseLungo(d);
        nodi.push(fascia(cap(d.getFullYear() === anno ? nome.split(" ")[0] : nome)));
        giorno = null;
      }
      nodi.push(rigaEvento(e, { giorno: g, conGiorno: g !== giorno }));
      giorno = g;
    }
    if (!eventi.length) nodi.push(el("p.meta", { style: "margin-top:18px" }, `Nessun evento nei prossimi ${finestra().giorni} giorni. Tocca + per aggiungerne uno.`));
    mostra(...nodi);
  }

  async function carica({ forza = false } = {}) {
    casa = await calendarioCasa({ fresh: forza }).catch(() => null);
    if (!casa || !statoGoogle().permessi.calendario) { dati.arriva("eventi"); render(); return; }
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
  render();
  carica();

  return () => { stopEventi(); stopGoogle(); dati.ferma(); piu.remove(); };
}
