// Diario: scrivi o detta (microfono della tastiera). Le note sono tue; quelle di un progetto condiviso sono della
// casa, come il progetto (7/11, richieste di Mattia): le leggete e le modificate tutti e due, con il nome di chi l'ha
// scritta e, in fondo al foglio, chi l'ha modificata per ultimo (core/note.js).
// Con l'AI collegata, ogni nota salvata viene letta dall'agente, che propone sotto di essa
// le azioni che contiene: task, voci per la lista, spese, voci del manuale, bozze di mail.
// Niente entra nell'app senza la tua spunta. Nella nota stessa l'agente scrive il titolo e le persone
// nominate (etichette collegate alla rubrica o a Google Contatti): si correggono dal foglio della nota, e
// quelli scritti a mano lì restano (`titoloAMano`, `personeAMano`).
//
// L'elenco è come le lezioni del tennis (29/10, richiesta di Mattia: «mi sembrano due strumenti diversi»): il
// giorno a sinistra in Instrument Serif, titolo, due righe di anteprima, persone; fasce per mese. Una nota si
// apre toccandola, in un foglio di lettura (apriLettura) con Modifica, Rianalizza ed Elimina. La stessa riga e
// lo stesso foglio li usa la pagina del progetto (modules/progetto).
//
// Una nota può appartenere a un progetto (es. Tennis). Se il progetto ha istruzioni per il diario,
// l'agente scrive anche un riepilogo della nota tenendo conto delle precedenti: si legge al posto
// del testo, che resta ripiegato sotto («Trascrizione»). Il riepilogo è testo correggibile, non
// un'azione. La sintesi del progetto (lo stato, ciò che è emerso finora) arriva invece come proposta
// sotto la nota e, confermata, si legge nella pagina del progetto, dove le note si sfogliano anche per tema.
//
// In cima, «Prossimi giorni»: gli eventi di oggi e dei due giorni dopo (non quelli già finiti) da tutti i calendari
// che vedi (quello della casa e gli altri tuoi: 1/11, scelta di Mattia), con le righe della pagina Calendario;
// compare solo se ce ne sono e se Google è collegato con il calendario. Scelta di Mattia del 27/10 (schermata B),
// al posto di aprire il Calendario dal menu. Un evento nuovo si scrive dal Diario in due modi (2/11, scelte B e C di
// Mattia tra tre schermate): il tondo col calendario sopra il +, come «Scansiona» nella Lista, e «Evento» tra le
// trasformazioni del foglio della nota. Entrambi solo se c'è un calendario in cui scrivere (`scriviEventi`).
//
// Una nota può avere foto (4/11, richiesta di Mattia): dal foglio della nota «Scatta» (fotocamera del telefono) o
// «Galleria»; nell'elenco la fotocamera col numero accanto all'ora, nel foglio di lettura la striscia delle
// miniature sotto le persone, e il tocco apre la foto intera. Le immagini stanno in `journal_photos` (components/foto.js).
//
// journal_entries { text, titolo, titoloAMano, persone: [{ nome, voceId?, googleId? }], personeAMano, projectId,
//   riepilogo, temi, riepilogoAt, analyzed, analyzedAt, analysisError, modello, sintesiEsito, foto: [{ id, w, h }],
//   avvisaAFine (l'app è uscita durante l'analisi: notifica alla fine, poi il server lo toglie) }
// `modello`: chi ha letto la nota l'ultima volta (haiku, sonnet, opus: scelta in menu → Modelli AI).
//
// Ricerca e persona (14/11, scelte di Mattia: A tra tre schermate, e il tocco sulla persona che filtra). La lente in
// testata apre il campo in cima (con la tastiera; stato e «Prossimi giorni» spariscono, × torna com'era): la ricerca è
// locale e istantanea, senza AI né accenti, su titolo, testo, riepilogo, persone e temi di tutte le note che vedi
// (`seguiTutteLeNote`, non solo le ultime 100), e si combina con la pillola del progetto. Le righe hanno le parole
// evidenziate e, se la parola è più avanti nel testo, l'estratto intorno (core/cerca.js). Il filtro per persona arriva
// toccando una persona nel foglio di lettura o «Note con …» nella sua voce della rubrica (`mostraNoteDi`): una pillola
// col suo nome (× per toglierla) prima di quelle dei progetti, e sotto quante note e la sua scheda. Finché tutte le note
// non sono arrivate si filtrano le ultime già in memoria e non si dice mai «nessuna» (regola del vuoto).
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-functions.js";
import { functions } from "../../core/firebase.js";
import { el, icon, toast, fascia, vuoto, attesa, toDate, meseLungo, fab, fabDoppio, testoRicco, isoGiorno, stessoGiorno, fmtDate, puntoToccato, pillolaProgetto } from "../../core/ui.js";
import { openSheet, scriviDa } from "../../components/sheet.js";
import { create, update, remove, watchVisible, readVisible, leggiUno, VIS, where, serverTimestamp } from "../../core/db.js";
import { session } from "../../core/auth.js";
import { seguiNote, seguiTutteLeNote, visibilitaNota, notaMia } from "../../core/note.js";
import { parole, notaTrovata, notaConPersona, evidenzia, trovaIn, estratto, mostraNoteDi, registraFiltroPersona, lasciaFiltroPersona } from "../../core/cerca.js";
import { getHousehold, nomeDi } from "../../core/household.js";
import { watchPending, renderAzione } from "../../components/proposals.js";
import { aggiungiVoci } from "../lista/index.js";
import { apriTask, apriProgetto } from "../task/index.js";
import { vaiA, richiestaPer } from "../../core/router.js";
import { apriPaginaProgetto } from "../../core/barra.js";
import { apriSpesa } from "../spese/index.js";
import { apriVoceManuale } from "../manuale/index.js";
import { nomeModello } from "../../core/modelli.js";
import { statoGoogle, suGoogle } from "../../core/google.js";
import { calendariVisti, leggiEventi, eventiNoti, suEventi, suCalendari, scriviEventi } from "../../core/calendario.js";
import { rigaEvento, inOrdine, apriEvento } from "../calendario/index.js";
import { pulsanteRegistra, sospese, elimina as eliminaVocale, durata } from "../../components/registratore.js";
import { sceltaPersone } from "../../components/persone.js";
import { personaDaId, personaDaGoogle } from "../../core/rubrica.js";
import { linkGoogle } from "../../core/contatti-google.js";
import { sceltaFoto, strisciaFoto, salvaFoto, eliminaFoto, eliminaFotoDi, visibilitaFoto } from "../../components/foto.js";

export const id = "diario";
export const title = "Diario";
export const nav = true;
/** In testata, a destra: la lente della ricerca (14/11) e Chiedi (14/11), che apre subito il foglio per scrivere la domanda. */
let apriRicerca = null; // la pagina montata la lega qui
export const azioni = () => [
  el("button.tondo.tondo--piatto", { type: "button", "aria-label": "Cerca nelle note", title: "Cerca", onclick: () => apriRicerca?.() }, icon("cerca")),
  el("button.tondo.tondo--piatto", { type: "button", "aria-label": "Chiedi", title: "Chiedi", onclick: () => vaiA("chiedi", "nuova") }, icon("domanda")),
];
const navIcon = "diario";
export { navIcon as icon };

const COLL = "journal_entries";
const CHIAVE_AUTO = "macroapp.diario.auto";
const CHIAVE_AI = "macroapp.diario.ai"; // "on" | "off": esito dell'ultima analisi
const CHIAVE_FILTRO = "macroapp.diario.progetto"; // "tutte" o id del progetto (lo scrive anche la pagina Task)
const GIORNI_PROSSIMI = 2; // «Prossimi giorni»: oggi e i due giorni dopo
const MAX_PROSSIMI = 4;    // righe al massimo; per le altre c'è il Calendario
const GIORNI = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
const analyzeEntry = httpsCallable(functions, "analyzeEntry", { timeout: 310000 }); // la funzione ha 300 s (Opus può metterci minuti)

const leggi = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } };
const scrivi = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

/** Pillole per scegliere il progetto di una nota. Ritorna { node, valore() }. */
function sceltaProgetto(progetti, iniziale, { senzaNessuno = false } = {}) {
  let scelto = iniziale || null;
  const node = el("div.segmenti", { style: "padding-top:0;flex-wrap:wrap" });
  const disegna = () => node.replaceChildren(...[ // replaceChildren scriverebbe «null»
    senzaNessuno ? null : el("button.pillola", { type: "button", class: scelto ? "" : "on", onclick: () => { scelto = null; disegna(); } }, "Nessuno"),
    ...progetti.map((p) => pillolaProgetto(p, { on: p.id === scelto, onclick: () => { scelto = p.id; disegna(); } })),
  ].filter(Boolean));
  disegna();
  return { node, valore: () => scelto };
}

/** Le persone di una nota, in una forma confrontabile (per sapere se il foglio le ha cambiate). */
const chiavePersone = (lista) => JSON.stringify((lista || []).map((p) => [p.nome, p.voceId || "", p.googleId || ""]));

/**
 * Foglio della nota: titolo (facoltativo) e testo a tutta larghezza, poi persone, progetto e giorno. La spunta
 * salva; le pillole trasformano subito il testo in task, voce di lista, spesa, voce del manuale o evento (se c'è un
 * calendario in cui scrivere), senza passare dall'AI. Invio nel titolo porta al testo; nel testo va a capo: una
 * nota può avere più paragrafi.
 * Titolo e persone cambiati qui restano come li hai scritti: l'analisi non li tocca più (titoloAMano,
 * personeAMano). Svuotando il titolo, lo riscrive l'AI alla prossima analisi.
 * `fuoco` = { campo: "titolo" | "testo" | "riepilogo", pos }: arrivando da un tocco sul testo nel foglio di lettura,
 * cursore lì e tastiera aperta. `onSalva(dati, foto)`: le foto scelte, { nuove, tolte } (components/foto.js), si
 * scrivono dopo la nota.
 */
export function apriNota({ esistente = null, testo = "", progetti = [], projectId = null, fuoco = null, ripresa = null, fotoIniziali = [], registraSubito = false, onSalva }) {
  // Una nota già scritta si apre per leggerla dall'inizio: niente tastiera finché non tocchi il testo.
  const area = el("textarea", { placeholder: "Scrivi o detta…", rows: 6, autofocus: !esistente });
  area.value = esistente?.text || testo;
  const titolo = el("input.nota__titolo-campo", { placeholder: "Titolo", "aria-label": "Titolo della nota", autocomplete: "off", enterkeyhint: "next" });
  titolo.value = esistente?.titolo || "";
  titolo.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); area.focus(); } });
  const persone = sceltaPersone({ perNota: esistente?.persone || [] });
  const foto = sceltaFoto({ esistente, iniziali: fotoIniziali });
  // Una nota dell'altra persona si sposta solo tra i progetti condivisi: resta visibile a lei (e senza «Nessuno»).
  const altrui = esistente && !notaMia(esistente);
  const attivi = progetti.filter((p) => (!p.archived || p.id === esistente?.projectId) && (!altrui || p.visibility === VIS.SHARED))
    .sort((a, b) => a.name.localeCompare(b.name));
  const progetto = sceltaProgetto(attivi, esistente ? esistente.projectId : projectId, { senzaNessuno: altrui });
  // Il riepilogo scritto dall'AI si corregge qui; se lo svuoti, torna a vedersi il testo.
  const riepilogo = esistente?.riepilogo ? el("textarea", { rows: Math.min(16, esistente.riepilogo.split("\n").length + 1) }) : null;
  if (riepilogo) riepilogo.value = esistente.riepilogo;

  // La data della nota si può cambiare (es. lezioni passate inserite dopo): pillola come in Spese.
  // Cambiandola si tiene l'ora che la nota aveva; una nota nuova in un altro giorno sta a mezzogiorno.
  const originale = toDate(esistente?.createdAt) || new Date();
  let quando = originale;
  const dataInput = el("input", { type: "date", value: isoGiorno(quando), "aria-label": "Data della nota", style: "position:absolute;opacity:0;pointer-events:none;width:1px;height:1px" });
  const dataBtn = el("button.pillola", { type: "button" });
  const disegnaData = () => dataBtn.replaceChildren(icon("calendario"), stessoGiorno(quando, new Date()) ? "Oggi" : fmtDate(quando));
  dataBtn.addEventListener("click", () => { try { dataInput.showPicker(); } catch (e) { dataInput.style.pointerEvents = "auto"; dataInput.focus(); } });
  dataInput.addEventListener("change", () => {
    if (!dataInput.value) return;
    const [a, m, g] = dataInput.value.split("-").map(Number);
    quando = esistente ? new Date(a, m - 1, g, originale.getHours(), originale.getMinutes()) : new Date(a, m - 1, g, 12, 0);
    disegnaData();
  });
  disegnaData();

  function trasforma(tipo) {
    const text = area.value.trim();
    if (!text) { toast("Scrivi prima qualcosa"); area.focus(); return; }
    if (tipo === "lista") {
      readVisible("shopping_items", { order: ["createdAt", "asc"] }).then((voci) => aggiungiVoci(text, voci));
      toast("Aggiunto alla lista"); sheet.close(); return;
    }
    if (tipo === "task") apriTask(null, { text });
    if (tipo === "spesa") {
      const m = text.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|euro)?/i);
      apriSpesa(null, { description: text.replace(m?.[0] || "", "").replace(/\s+/g, " ").trim(), amount: m ? m[1] : "" });
    }
    if (tipo === "manuale") apriVoceManuale(null, { name: text });
    if (tipo === "evento") {
      // Il titolo della nota, se c'è, è il titolo dell'evento e il testo va nelle note; se no la prima riga è il
      // titolo e il resto le note. Il giorno è quello della nota (oggi, se non l'hai cambiato).
      const t = titolo.value.trim();
      const [prima, ...resto] = text.split("\n");
      apriEvento(null, { titolo: t || prima.trim(), note: t ? text : resto.join("\n").trim(), giorno: isoGiorno(quando), progetto: progetto.valore() || "" });
    }
  }

  // Nota vocale (14/11): il testo arriva a pezzi mentre parli, uno a ogni pausa, e si aggiunge a quello che c'è già
  // nel campo; la registrazione resta sul telefono finché la nota non è salvata (components/registratore.js).
  const suggerimento = el("p.meta", { style: "margin-top:6px", hidden: !!esistente && !ripresa },
    ripresa ? "Registrazione ripresa: finisco di trascriverla, poi salva." : "Per la voce tocca «Registra» in basso: parla quanto vuoi, il testo arriva qui a ogni pausa. Poi «Ferma».");
  const registra = pulsanteRegistra({
    archivia: true, riprendi: ripresa,
    progetto: () => progetto.valore(),
    inserisci: (testo, { primo = true, aCapo = true } = {}) => {
      const prima = area.value.trimEnd();
      area.value = !prima ? testo : `${prima}${primo || aCapo ? "\n\n" : " "}${testo}`;
      area.dispatchEvent(new Event("input", { bubbles: true }));
      // Si vede l'ultima riga arrivata, se non stai scrivendo altrove.
      if (document.activeElement !== titolo) area.scrollIntoView({ block: "end", behavior: "instant" });
    },
    onStato: ({ stato, inAttesa }) => {
      if (stato === "fermo") { suggerimento.hidden = !!esistente; suggerimento.textContent = "Per la voce tocca «Registra» in basso: parla quanto vuoi, il testo arriva qui a ogni pausa. Poi «Ferma»."; return; }
      suggerimento.hidden = false;
      suggerimento.textContent = stato === "registra"
        ? "Ti ascolto: il testo arriva qui a ogni pausa. Se blocchi il telefono, quello che hai detto resta."
        : inAttesa > 1 ? `Trascrivo gli ultimi ${inAttesa} pezzi…` : "Trascrivo l'ultimo pezzo…";
    },
  });

  const sheet = openSheet({
    title: esistente ? "Nota" : "Nuova nota",
    body: [
      el("div.taccuino", {}, titolo),
      riepilogo ? el("div.campo", { style: "margin-top:14px" }, el("label", {}, "Riepilogo"), riepilogo) : null,
      riepilogo ? el("div.etichetta-campo", {}, "Trascrizione") : null,
      el("div.taccuino", { style: "padding-top:0" }, area),
      suggerimento,
      el("div", { style: "margin-top:16px" }, el("div.etichetta-campo", {}, "Foto"), foto.node),
      el("div.campo", { style: "margin-top:16px" }, el("label", {}, "Persone"), persone.node),
      attivi.length ? el("div", { style: "margin-top:16px" }, el("div.etichetta-campo", {}, "Progetto"), progetto.node) : null,
      el("div", { style: "margin-top:16px" }, el("div.etichetta-campo", {}, "Giorno"), el("div.segmenti", { style: "padding-top:0;position:relative" }, dataBtn, dataInput)),
      esistente ? null : el("div", { style: "margin-top:16px" },
        el("div.etichetta-campo", {}, "Oppure trasformala subito in"),
        el("div.segmenti", { style: "padding-top:4px;flex-wrap:wrap" },
          el("button.pillola", { type: "button", onclick: () => trasforma("task") }, icon("task"), "Task"),
          el("button.pillola", { type: "button", onclick: () => trasforma("lista") }, icon("lista"), "Lista"),
          el("button.pillola", { type: "button", onclick: () => trasforma("spesa") }, icon("spese"), "Spesa"),
          el("button.pillola", { type: "button", onclick: () => trasforma("manuale") }, icon("negozio"), "Manuale"),
          scriviEventi() ? el("button.pillola", { type: "button", onclick: () => trasforma("evento") }, icon("calendario"), "Evento") : null,
        ),
      ),
    ],
    azioni: [registra],
    onConfirm: async () => {
      // Salvando mentre registri o trascrivi: si ferma e si aspetta l'ultimo pezzo (se non arriva, resta sul telefono).
      if (!(await registra.attendi())) toast("L'ultimo pezzo non è ancora trascritto: lo trovi in cima al Diario quando arriva.", { ms: 6000 });
      const text = area.value.trim();
      // Una nota può essere di sole foto (uno scontrino, un biglietto da visita): l'agente legge quelle (14/11).
      const fotoScelte = foto.valore();
      const conFoto = fotoScelte.nuove.length || (esistente?.foto || []).length > fotoScelte.tolte.length;
      if (!text && !conFoto) { area.focus(); return false; }
      const dati = { text, projectId: progetto.valore() };
      const t = titolo.value.trim();
      if (t !== (esistente?.titolo || "")) { dati.titolo = t; dati.titoloAMano = !!t; }
      const scelte = persone.valore();
      if (chiavePersone(scelte) !== chiavePersone(esistente?.persone)) { dati.persone = scelte; dati.personeAMano = true; }
      if (riepilogo) dati.riepilogo = riepilogo.value.trim();
      if (quando.getTime() !== originale.getTime()) dati.createdAt = quando;
      onSalva(dati, fotoScelte);
      registra.conclusa();
    },
  });
  if (fuoco) scriviDa({ titolo, testo: area, riepilogo }[fuoco.campo] || area, fuoco.pos);
  // Scorciatoia «Nota vocale» dell'icona (14/11): si registra subito, senza tastiera.
  if (registraSubito) { area.blur(); registra.click(); }
}

/** Le foto condivise da un'altra app, messe da parte da sw.js nella cache «dd-condivisi»: si leggono e si tolgono. */
async function fotoCondivise() {
  try {
    const cache = await caches.open("dd-condivisi");
    const chiavi = await cache.keys();
    const foto = [];
    for (const r of chiavi) {
      const res = await cache.match(r);
      const blob = await res.blob();
      foto.push(new File([blob], decodeURIComponent(new URL(r.url).pathname.split("/").pop() || "foto"), { type: blob.type || "image/jpeg" }));
      await cache.delete(r);
    }
    return foto;
  } catch (e) { console.warn("foto condivise", e); return []; }
}

/** Oltre questo tempo un'analisi «in corso» è morta (functions/index.js, ANALISI_MAX_MS: 300 s della funzione più margine). */
const ANALISI_MAX_MS = 330e3;

/**
 * L'analisi della nota è in corso sul server (7/11): lo stato `analisi` lo scrive analyzeEntry all'inizio e lo chiude
 * alla fine, quindi vale per tutti i telefoni e anche se la risposta si è persa (telefono bloccato, app chiusa).
 */
export function analisiInCorso(n) {
  const a = n?.analisi;
  const t = a?.stato === "in_corso" ? toDate(a.inizio) : null;
  return !!t && Date.now() - t.getTime() < ANALISI_MAX_MS;
}
/** Rimasta «in corso» oltre il tempo massimo: morta senza esito (la funzione è stata interrotta). */
const analisiMorta = (n) => n?.analisi?.stato === "in_corso" && !analisiInCorso(n);

/** Fra quanti ms la prima analisi in corso tra queste note smette di esserlo, per ridisegnare la pagina; o null. */
export function scadenzaAnalisi(note) {
  const resti = note.filter(analisiInCorso).map((n) => toDate(n.analisi.inizio).getTime() + ANALISI_MAX_MS - Date.now());
  return resti.length ? Math.max(0, Math.min(...resti)) + 500 : null;
}

/**
 * Manda una nota all'agente e segna l'esito sulla nota. Ritorna la risposta della funzione
 * ({ proposals, riepilogo, sintesi }) o null se non è riuscita (l'errore è già stato mostrato).
 * `attesa`: la scrittura da aspettare prima (la nota appena creata o modificata).
 */
export async function analizzaNota(entryId, attesa) {
  // Se l'app passa in secondo piano mentre aspetta (Opus può metterci minuti), la nota lo segna
  // (`avvisaAFine`) e a fine analisi il server manda una notifica; tornando nell'app il segno si toglie.
  let fuori = false;
  const suVisibilita = () => {
    const nascosta = document.visibilityState === "hidden";
    if (nascosta === fuori) return;
    fuori = nascosta;
    update(COLL, entryId, { avvisaAFine: nascosta });
  };
  document.addEventListener("visibilitychange", suVisibilita);
  try {
    if (attesa) await attesa;
    suVisibilita(); // già uscita mentre la nota si salvava
    const res = await analyzeEntry({ entryId });
    // Un'analisi della stessa nota era già in corso (dall'altro telefono, o lanciata prima di bloccare questo): non ne
    // parte una seconda, il risultato arriva nella nota.
    if (res.data?.giaInCorso) { toast("È già in analisi: il risultato compare nella nota"); return null; }
    const n = res.data?.proposals ?? 0;
    scrivi(CHIAVE_AI, "on");
    // Lo scrive già il server (fineAnalisi); qui resta come ripiego.
    update(COLL, entryId, { analyzed: true, analyzedAt: new Date(), analysisError: null, modello: res.data?.modello || null });
    if (!n && !res.data?.riepilogo) toast("Nessuna azione da proporre");
    else if (res.data?.sintesiEsito === "invariata") toast("Sintesi del progetto invariata");
    return res.data || {};
  } catch (err) {
    console.warn("analisi", err);
    const chiave = err.code === "functions/failed-precondition" && /non configurata/.test(err.message || "");
    if (chiave) scrivi(CHIAVE_AI, "off");
    // Risposta persa per strada (7/11: telefono bloccato durante l'attesa, rete): l'errore è solo del collegamento,
    // l'analisi prosegue sul server, che scrive l'esito sulla nota. Non è «non analizzata».
    const persa = /^(functions\/)?(internal|deadline-exceeded|unavailable|cancelled|unknown)$/.test(err.code || "")
      && /^(internal|deadline-exceeded|unavailable|cancelled|unknown)?$/i.test(String(err.message || "").trim());
    if (persa) {
      if (document.visibilityState === "visible") toast("La risposta non è arrivata: l'analisi continua e il risultato compare nella nota.", { ms: 6000 });
      return null;
    }
    update(COLL, entryId, { analysisError: err.message || err.code || "errore" });
    toast(chiave ? "AI non ancora collegata: la nota è salvata" : `${err.message || "Analisi non riuscita"}. La nota è salvata.`, { ms: 7000 });
    return null;
  } finally {
    document.removeEventListener("visibilitychange", suVisibilita);
  }
}

/**
 * Sotto una nota di progetto: la sintesi non è cambiata con l'ultima analisi (`sintesiEsito`, scritto dal server).
 * Senza, una sintesi invariata non dava nessun segnale (29/10). Esportata per il foglio della lezione.
 */
export function sintesiInvariata(n, inAnalisi = false) {
  return n.sintesiEsito === "invariata" && !inAnalisi ? el("p.meta.nota__esito", {}, "Sintesi del progetto invariata") : null;
}

/**
 * Scrive sulla nota le foto scelte nel suo foglio: prima toglie, poi aggiunge in coda (anche per la pagina Progetto).
 * `visibility`: quella della nota (le foto la seguono).
 */
export async function applicaFoto(entryId, attuali, { nuove, tolte }, attesa, visibility = VIS.PRIVATE) {
  if (!nuove.length && !tolte.length) return;
  if (attesa) await attesa;
  const resto = await eliminaFoto(entryId, tolte, attuali);
  await salvaFoto(entryId, nuove, resto, visibility);
}

/**
 * Salva una nota nuova (Diario e pagina del progetto): con la visibilità del suo progetto, poi le foto. Ritorna
 * { id, saved } come create(), più `pronta`: nota e foto scritte (da lì parte l'analisi).
 */
export function salvaNotaNuova(dati, foto, progetti) {
  const visibility = visibilitaNota(dati.projectId, progetti);
  const r = create(COLL, { ...dati, analyzed: false }, visibility);
  // L'agente legge anche le foto (14/11): l'analisi parte quando sono scritte (`pronta`), non appena c'è la nota.
  const fotoScritte = applicaFoto(r.id, [], foto, r.saved, visibility).catch(() => {});
  return { ...r, pronta: Promise.all([r.saved, fotoScritte]) };
}

/**
 * Salva le modifiche a una nota: se cambia progetto cambia anche chi la vede (e con lei le foto). Ritorna la promessa
 * della scrittura.
 */
export function salvaModificaNota(n, dati, foto, progetti) {
  // Una nota dell'altra persona resta condivisa (il foglio le offre solo i progetti condivisi): la visibilità la cambia
  // solo chi l'ha scritta.
  const visibility = notaMia(n) ? visibilitaNota(dati.projectId, progetti) : n.visibility || VIS.PRIVATE;
  const cambia = visibility !== (n.visibility || VIS.PRIVATE);
  // Chi l'ha modificata per ultimo e quando (si legge in fondo al foglio della nota condivisa).
  const firma = { modificataDa: session.user.uid, modificataAt: serverTimestamp() };
  const salvata = update(COLL, n.id, cambia ? { ...dati, ...firma, visibility } : { ...dati, ...firma });
  if (cambia) visibilitaFoto(n.foto || [], visibility);
  applicaFoto(n.id, n.foto || [], foto, salvata, visibility);
  return salvata;
}

/** Ultima modifica a mano di una nota condivisa: { chi, quando } per apriLettura, o null. `casa` per i nomi. */
export const ultimaModifica = (n, casa) => (n.visibility === VIS.SHARED && n.modificataDa
  ? { chi: n.modificataDa === session.user.uid ? "tu" : nomeDi(n.modificataDa, casa), quando: n.modificataAt } : null);

/** Analisi automatica attiva (scelta sul telefono, pillola in alto nel Diario). */
export const analisiAutomatica = () => leggi(CHIAVE_AUTO, "1") === "1";

const pulisci = (r) => r.replace(/^[-*•]\s+/, "").replace(/\*\*/g, "").trim();
const unaRiga = (t) => String(t || "").replace(/\s+/g, " ").trim();
/** «oggi alle 18:40», «ieri alle 9:05», «5 nov alle 21:10». */
function quandoBreve(t) {
  const d = toDate(t);
  if (!d) return "adesso";
  const ieri = new Date(); ieri.setDate(ieri.getDate() - 1);
  const giorno = stessoGiorno(d, new Date()) ? "oggi" : stessoGiorno(d, ieri) ? "ieri" : fmtDate(d);
  return `${giorno} alle ${d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * Titolo e anteprima di una nota per l'elenco. Il titolo è quello della nota (dell'AI o scritto a mano); senza,
 * la prima frase o riga (del riepilogo, se c'è, se no del testo), e l'anteprima riprende da lì senza ripeterla.
 * Con il riepilogo l'anteprima sono le sue prime voci; se no il testo.
 */
export function testaNota(n) {
  const titolo = String(n.titolo || "").trim();
  if (n.riepilogo) {
    const voci = String(n.riepilogo).split("\n").map((r) => r.trim()).filter((r) => r && !/^#/.test(r)).map(pulisci).filter(Boolean);
    if (titolo) return { titolo, anteprima: voci.slice(0, 3).join(" · ") };
    const [prima = "", ...resto] = voci;
    return { titolo: prima.length > 70 ? `${prima.slice(0, 68).replace(/\s+\S*$/, "")}…` : prima, anteprima: resto.slice(0, 3).join(" · ") };
  }
  const testo = String(n.text || "").trim();
  if (titolo) return { titolo, anteprima: unaRiga(testo).slice(0, 280) };
  const riga = testo.split("\n")[0].trim();
  const frase = riga.match(/^.{8,70}?[.!?](?=\s|$)/)?.[0] || riga;
  if (frase.length <= 70) return { titolo: frase.replace(/\.$/, ""), anteprima: unaRiga(testo.slice(frase.length)).slice(0, 280) };
  const taglio = frase.slice(0, 68).replace(/\s+\S*$/, "");
  return { titolo: `${taglio}…`, anteprima: `…${unaRiga(testo.slice(taglio.length)).slice(0, 280)}` };
}

/** Titolo di una nota (per i fogli e la pagina del progetto). */
export const titoloDi = (n) => testaNota(n).titolo;

/**
 * Una persona della nota come pillola: toccandola (14/11, scelta di Mattia) si vedono le sue note nel Diario, da cui
 * «scheda in rubrica» apre la voce (o il contatto Google). `chiudi` chiude il foglio di lettura.
 */
function pillolaPersona(p, chiudi) {
  const voce = (p.voceId && personaDaId(p.voceId)) || personaDaGoogle(p.googleId);
  const chi = { nome: voce?.name || p.nome, voceId: voce?.id || p.voceId || null, googleId: voce?.googleId || p.googleId || null };
  return el("button.pillola", { type: "button", title: `Note con ${chi.nome}`, onclick: () => mostraNoteDi(chi, chiudi) },
    icon(voce || !p.googleId ? "persona" : "contatto"), chi.nome);
}

/** La scheda di una persona: la voce della rubrica, o il contatto su Google Contatti; null se è solo un nome. */
function schedaDi(chi) {
  const voce = (chi.voceId && personaDaId(chi.voceId)) || personaDaGoogle(chi.googleId);
  if (voce) return el("button.link", { type: "button", onclick: () => apriVoceManuale(voce) }, "scheda in rubrica");
  if (chi.googleId) return el("a.link", { href: linkGoogle(chi.googleId), target: "_blank", rel: "noopener" }, "su Google Contatti");
  return null;
}

/** Il testo di un campo per l'estratto della ricerca: senza i segni del riepilogo (titoli, elenchi, grassetto). */
const pianoDi = (t) => String(t || "").replace(/^#+\s*/gm, "").replace(/^\s*[-*•]\s+/gm, "").replace(/\*\*/g, "");

/**
 * Riga di una nota, come le lezioni del tennis: giorno a sinistra (solo sulla prima nota del giorno, `conGiorno`),
 * titolo, anteprima su due righe, poi ora e modello (`conOra`, nel Diario), progetto (`progetto`, nel Diario su
 * «Tutte»), persone e temi, questi due nel colore del progetto (`colore`). Sotto, fuori dal pulsante, le azioni
 * proposte ancora in attesa.
 */
export function rigaNota(n, { conGiorno = true, conOra = false, progetto = null, colore = null, autore = null, proposte = [], inAnalisi = false, onApri, cerca = [] } = {}) {
  const d = toDate(n.createdAt) || new Date();
  const { titolo, anteprima: inizio } = testaNota(n);
  // Cercando (14/11): se le parole non sono all'inizio dell'anteprima, l'estratto intorno alla prima che si trova.
  const anteprima = !cerca.length || trovaIn(inizio, cerca).some(([a]) => a < 120) ? inizio
    : estratto(pianoDi(n.riepilogo), cerca) || estratto(n.text, cerca) || inizio;
  const segna = (t) => (cerca.length ? evidenzia(t, cerca) : [t]);
  const persone = Array.isArray(n.persone) ? n.persone.filter((p) => p?.nome) : [];
  // In analisi: lanciata da qui (prima che il server scriva lo stato) o in corso sul server, da qualunque telefono.
  inAnalisi = inAnalisi || analisiInCorso(n);
  const nonAnalizzata = !inAnalisi && !n.analyzed && (n.analysisError || analisiMorta(n));
  const piede = [
    conOra ? el("span.lezione__ora", {}, d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }), n.analyzed && n.modello ? ` · ${nomeModello(n.modello)}` : "") : null,
    // Nota condivisa scritta dall'altra persona (7/11): il suo nome.
    autore ? el("span.lezione__autore", {}, icon("persona"), autore) : null,
    n.foto?.length ? el("span.lezione__foto", { title: n.foto.length === 1 ? "Una foto" : `${n.foto.length} foto` }, icon("fotocamera"), n.foto.length > 1 ? String(n.foto.length) : "") : null,
    progetto ? el("span.progetto", {}, progetto.name) : null,
    ...persone.map((p) => el("span.persona", {}, icon("persona"), ...segna(p.nome))),
    ...(n.temi || []).map((t) => el("span.etichetta", {}, ...segna(t))),
    inAnalisi ? el("span.lezione__stato", {}, "Analizzo…") : null,
    nonAnalizzata ? el("span.lezione__stato.lezione__stato--errore", {}, "non analizzata") : null,
    n.sintesiEsito === "invariata" && !inAnalisi ? el("span.lezione__stato.lezione__stato--muto", {}, "sintesi invariata") : null,
  ].filter(Boolean);
  const oggi = stessoGiorno(d, new Date());
  // Il colore del progetto della nota (29/10, richiesta di Mattia): etichetta del progetto e temi.
  return el("div.voce-nota", { "data-id": n.id, "data-colore": colore || null },
    el("button.lezione", { type: "button", onclick: onApri },
      el("div.lezione__giorno", {}, conGiorno ? [el("b.display", {}, String(d.getDate())), el("small", {}, oggi ? "oggi" : GIORNI[d.getDay()])] : null),
      el("div.lezione__testo", {},
        el("div.lezione__titolo", {}, ...(titolo ? segna(titolo) : ["Senza titolo"])),
        anteprima ? el("div.lezione__anteprima", {}, ...segna(anteprima)) : null,
        piede.length ? el("div.lezione__temi", {}, ...piede) : null,
      ),
    ),
    proposte.length ? el("div.azioni-ai.voce-nota__azioni", {}, ...proposte.map(renderAzione)) : null,
  );
}

/**
 * Foglio di lettura di una nota (Diario e pagina del progetto): data, persone e temi, il riepilogo intero con la
 * trascrizione ripiegata o il testo, le azioni proposte. In basso Rianalizza ed Elimina a sinistra, Modifica a destra.
 * Toccando il titolo o un testo (31/10, richiesta di Mattia) si scrive lì, senza passare da Modifica: il foglio della
 * nota prende il posto di questo con il cursore dove hai toccato (`onModifica({ campo, pos })`). Modifica resta per
 * persone, progetto e giorno.
 * Una nota condivisa (7/11) la modificano tutti e due: `autore` è il nome di chi l'ha scritta, se non sei tu;
 * `modificata` = { chi, quando } dell'ultima modifica a mano (`modificataDa`, `modificataAt`), detta in piccolo in fondo.
 */
export function apriLettura(n, { progetto = null, proposte = [], autore = null, modificata = null, inAnalisi = false, onModifica, onAnalizza, onElimina }) {
  // In analisi (da qui o sul server): niente seconda analisi, il pulsante lo dice.
  const occupata = inAnalisi || analisiInCorso(n);
  const d = toDate(n.createdAt) || new Date();
  const persone = Array.isArray(n.persone) ? n.persone.filter((p) => p?.nome) : [];
  const tocca = (campo, sorgente) => (e) => {
    if (e.target.closest("a, button")) return;
    onModifica?.({ campo, pos: puntoToccato(e, sorgente) });
  };
  const scrivibile = ".scrivibile";
  let aperta = false;
  const trascrizione = el(`div.nota__testo.nota__testo--trascrizione${scrivibile}`, { hidden: true, onclick: tocca("testo", n.text) }, n.text);
  const apri = el("button.nota__apri", { type: "button", "aria-expanded": "false", onclick: () => {
    aperta = !aperta; trascrizione.hidden = !aperta;
    apri.setAttribute("aria-expanded", aperta ? "true" : "false");
    apri.lastChild.textContent = aperta ? "Nascondi la trascrizione" : "Trascrizione";
  } }, icon("giu"), "Trascrizione");
  const quando = `${d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}, ${d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`;
  const sheet = openSheet({
    title: titoloDi(n) || "Nota",
    body: [
      el("p.meta", { style: "margin-top:12px", "data-colore": progetto?.colore || null }, autore ? `di ${autore} · ` : "", quando, n.analyzed && n.modello ? ` · letta da ${nomeModello(n.modello)}` : "",
        progetto ? [" · ", el("span.progetto", {}, progetto.name)] : null),
      persone.length ? el("div.lettura__persone", {}, ...persone.map((p) => pillolaPersona(p, () => sheet.close()))) : null,
      strisciaFoto(n),
      n.temi?.length ? el("div.lezione__temi", { "data-colore": progetto?.colore || null }, ...n.temi.map((t) => el("span.etichetta", {}, t))) : null,
      n.riepilogo
        ? el(`div.sintesi-testo.lezione__riepilogo${scrivibile}`, { onclick: tocca("riepilogo", n.riepilogo) }, ...testoRicco(n.riepilogo))
        : el(`div.nota__testo.lettura__testo${scrivibile}`, { onclick: tocca("testo", n.text) }, n.text),
      n.riepilogo ? apri : null,
      n.riepilogo ? trascrizione : null,
      sintesiInvariata(n, occupata),
      proposte.length ? el("div.azioni-ai", { style: "margin-top:14px" }, ...proposte.map(renderAzione)) : null,
      // Chi l'ha modificata per ultimo (note condivise, richiesta di Mattia del 7/11): appena visibile, in fondo.
      modificata ? el("p.nota__modifica", {}, `Ultima modifica: ${modificata.chi}, ${quandoBreve(modificata.quando)}`) : null,
      el("div.foglio__piede", {},
        el("button.btn", { disabled: occupata, onclick: () => { sheet.close(); onAnalizza?.(); } }, icon("scintilla"), occupata ? "Analizzo…" : n.analyzed ? "Rianalizza" : "Analizza"),
        el("button.btn.btn--pericolo", { "aria-label": "Elimina nota", onclick: () => { sheet.close(); onElimina?.(); } }, icon("cestino")),
      ),
    ],
    confirmLabel: "Modifica",
    onConfirm: () => { onModifica?.(); },
  });
  // Il titolo sta nella testata del foglio: anche lui si tocca per scriverlo.
  const testa = document.querySelector("#foglio .foglio__testa h2");
  testa?.classList.add("scrivibile");
  testa?.addEventListener("click", tocca("titolo", n.titolo || ""));
}

/** Note in elenco: fascia per mese, giorno solo sulla prima nota del giorno. riga(n, conGiorno) → nodo. */
export function elencoNote(note, riga) {
  const nodi = [];
  let mese = null;
  let giorno = null;
  for (const n of note) {
    const d = toDate(n.createdAt) || new Date();
    const m = meseLungo(d);
    if (m !== mese) { nodi.push(fascia(m.charAt(0).toUpperCase() + m.slice(1))); mese = m; giorno = null; }
    const g = isoGiorno(d);
    nodi.push(riga(n, g !== giorno));
    giorno = g;
  }
  return nodi;
}

export function mount(container) {
  let note = [];
  let proposte = [];
  let progetti = [];
  const inCorso = new Set(); // note in analisi
  const conNote = new Set(); // progetti che hanno note tra quelle viste
  let auto = leggi(CHIAVE_AUTO, "1") === "1";
  let filtro = leggi(CHIAVE_FILTRO, "tutte");
  let caricate = false; // le note del filtro scelto sono arrivate: solo allora si può dire «vuoto»
  let tutte = null;     // le ultime note senza filtro: anteprima immediata quando si cambia filtro
  let cerca = null;     // null: niente ricerca; "" o il testo: ricerca aperta (la lente in testata)
  let persona = null;   // { nome, voceId, googleId }: le note di una persona
  let tutteNote = null; // tutte le note che vedi, per ricerca e persona; null finché non arrivano
  let stopTutteNote = null;
  // La pagina compare quando ci sono note, ultime note senza filtro (pillole dei progetti con note) e progetti
  // (pillole, nomi): intera, non a pezzi.
  const dati = attesa(["note", "tutte", "progetti"], () => render());

  const stato = el("div.stato-ai", { style: "margin-top:0" });
  const disegnaStato = () => {
    const ai = leggi(CHIAVE_AI, "");
    stato.className = `stato-ai${ai === "on" ? " on" : ""}`;
    stato.replaceChildren(el("i"), ai === "off" ? "AI non ancora collegata" : ai === "on" ? "AI collegata" : "AI");
  };
  disegnaStato();

  const autoBtn = el("button.pillola", { type: "button" });
  const disegnaAuto = () => {
    autoBtn.className = `pillola${auto ? " on" : ""}`;
    autoBtn.replaceChildren(icon("scintilla"), auto ? "Analisi automatica" : "Analisi manuale");
  };
  autoBtn.addEventListener("click", () => { auto = !auto; scrivi(CHIAVE_AUTO, auto ? "1" : "0"); disegnaAuto(); });
  disegnaAuto();

  const progettoDi = (id) => (id ? progetti.find((p) => p.id === id) : null);

  async function analizza(entryId, attesa) {
    inCorso.add(entryId);
    render();
    await analizzaNota(entryId, attesa);
    inCorso.delete(entryId);
    disegnaStato();
    render();
  }

  function nuova(testo = "", { ripresa = null, projectId = undefined, foto = [], registraSubito = false } = {}) {
    apriNota({
      testo, progetti, ripresa, fotoIniziali: foto, registraSubito, projectId: projectId !== undefined ? projectId : filtro !== "tutte" ? filtro : null,
      onSalva: (dati, foto) => {
        const { id: entryId, pronta } = salvaNotaNuova(dati, foto, progetti);
        if (auto) analizza(entryId, pronta);
      },
    });
  }

  function modifica(n, fuoco = null) {
    apriNota({
      esistente: n, progetti, fuoco,
      onSalva: (dati, foto) => {
        const salvata = salvaModificaNota(n, dati, foto, progetti);
        // Spostata in un progetto con istruzioni e ancora senza riepilogo: lo scrive subito.
        const nuovo = dati.projectId !== (n.projectId || null) ? progettoDi(dati.projectId) : null;
        if (auto && nuovo?.istruzioni && !n.riepilogo) analizza(n.id, salvata);
      },
    });
  }

  const filtri = el("div.segmenti", { style: "padding-top:8px" });
  const elenco = el("div");

  // ── Ricerca e persona (14/11) ──
  const campoCerca = el("input", { type: "search", placeholder: "Cerca nelle note", "aria-label": "Cerca nelle note", enterkeyhint: "search", autocomplete: "off", spellcheck: false });
  campoCerca.addEventListener("input", () => { cerca = campoCerca.value; render(); });
  campoCerca.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); campoCerca.blur(); } // Invio chiude la tastiera: i risultati ci sono già
    if (e.key === "Escape") chiudiRicerca();
  });
  const barraCerca = el("div.cerca-campo", { hidden: true }, icon("cerca"), campoCerca,
    el("button.cerca-campo__chiudi", { type: "button", "aria-label": "Chiudi la ricerca", onclick: () => chiudiRicerca() }, icon("chiudi")));
  const esito = el("p.cerca-esito", { hidden: true, role: "status" });
  const rigaStato = el("div.segmenti", { style: "align-items:center;justify-content:space-between" }, stato, autoBtn);
  /** Tutte le note servono solo cercando o con una persona: l'ascolto parte allora e si ferma quando non serve più. */
  function servonoTutte() {
    const serve = cerca != null || !!persona;
    if (serve && !stopTutteNote) {
      stopTutteNote = seguiTutteLeNote((docs) => {
        tutteNote = docs;
        for (const n of docs) if (n.projectId) conNote.add(n.projectId);
        render();
      });
    }
    if (!serve && stopTutteNote) { stopTutteNote(); stopTutteNote = null; tutteNote = null; }
  }
  const questaRicerca = apriRicerca = () => {
    if (cerca == null) { cerca = ""; campoCerca.value = ""; servonoTutte(); render(); }
    campoCerca.focus(); // nel tocco sulla lente: la tastiera si apre
  };
  function chiudiRicerca() {
    cerca = null; campoCerca.value = ""; campoCerca.blur();
    servonoTutte(); render();
  }
  /** Le note di una persona (dal foglio di lettura o dalla rubrica): su tutti i progetti, combinabile poi con uno. */
  function filtraPersona(chi) {
    persona = chi;
    if (filtro !== "tutte") scegli("tutte");
    servonoTutte(); render();
  }
  registraFiltroPersona(filtraPersona);
  const piu = fab("Nuova nota", () => nuova());
  // Evento nuovo senza passare dal Calendario (2/11, scelta B di Mattia): tondo col calendario sopra il +, come
  // «Scansiona» nella Lista. Solo se c'è un calendario in cui scrivere, come il + della pagina Calendario.
  const eventoFab = el("button.fab.fab--sopra", { type: "button", "aria-label": "Nuovo evento", title: "Nuovo evento", hidden: true,
    onclick: () => apriEvento(null, { progetto: filtro !== "tutte" ? filtro : "" }) }, icon("calendario"));
  let lasciaDoppio = null;
  let smontato = false; // caricaProssimi può finire dopo lo smontaggio: niente data-fab-doppio rimasto acceso
  function disegnaEventoFab() {
    const si = !smontato && scriviEventi();
    eventoFab.hidden = !si;
    if (si && !lasciaDoppio) lasciaDoppio = fabDoppio();
    if (!si && lasciaDoppio) { lasciaDoppio(); lasciaDoppio = null; }
  }

  // ── Prossimi giorni, da tutti i calendari che vedi ──
  // Si disegna con l'ultima lettura nota (anche salvata sul telefono), poi con quella fresca da Google; non
  // prima delle note, perché la pagina non compaia a pezzi.
  const prossimi = el("div.prossimi", { hidden: true });
  let eventi = statoGoogle().permessi.calendario ? eventiNoti() : null;
  function disegnaProssimi() {
    const g = statoGoogle();
    if (!dati.pronta() || !g.collegato || !g.permessi.calendario || !eventi || cerca != null) { prossimi.hidden = true; return; }
    const ora = new Date();
    const limite = new Date(); limite.setDate(limite.getDate() + GIORNI_PROSSIMI);
    const fino = isoGiorno(limite);
    const vicini = inOrdine(eventi.filter((e) => e.fine >= ora && e.giornoInizio <= fino), isoGiorno(ora));
    prossimi.hidden = !vicini.length;
    if (!vicini.length) { prossimi.replaceChildren(); return; }
    let giorno = null;
    const righe = vicini.slice(0, MAX_PROSSIMI).map(({ e, g: gg }) => {
      const r = rigaEvento(e, { giorno: gg, conGiorno: gg !== giorno, progetti });
      giorno = gg;
      return r;
    });
    const altri = vicini.length - MAX_PROSSIMI;
    prossimi.replaceChildren(
      fascia("Prossimi giorni", el("button", { type: "button", onclick: () => vaiA("calendario") }, "Calendario")),
      ...righe,
      ...(altri > 0 ? [el("button.prossimi__altri", { type: "button", onclick: () => vaiA("calendario") }, `E ${altri === 1 ? "un altro" : `altri ${altri}`} nel calendario`)] : []),
    ); // replaceChildren, a differenza di el(), scriverebbe «null»
  }
  async function caricaProssimi() {
    disegnaEventoFab(); // con i calendari già noti, subito
    const visti = statoGoogle().permessi.calendario ? await calendariVisti() : [];
    disegnaEventoFab();
    if (!visti.length) { eventi = null; disegnaProssimi(); return; }
    // Se Google non risponde resta l'ultima lettura; perché, lo dice la pagina Calendario.
    try { eventi = await leggiEventi(); } catch (e) { /* niente */ }
    disegnaProssimi();
  }

  // ── Note vocali da salvare (14/11) ──
  // Registrazioni rimaste sul telefono: l'app si è chiusa mentre registravi, o il foglio si è chiuso senza salvare.
  // Toccandola si riapre la nota con il testo già trascritto e si finisce il resto; la × la butta (con Annulla).
  const vocali = el("div.vocali", { hidden: true });
  const buttate = new Set();
  async function disegnaVocali() {
    const lista = (await sospese()).filter((v) => !buttate.has(v.id));
    if (smontato) return;
    vocali.hidden = !lista.length;
    if (!lista.length) { vocali.replaceChildren(); return; }
    vocali.replaceChildren(fascia(lista.length === 1 ? "Nota vocale da salvare" : "Note vocali da salvare"), ...lista.map((v) => {
      const d = new Date(v.inizio);
      const quando = `${stessoGiorno(d, new Date()) ? "oggi" : fmtDate(d)} alle ${d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`;
      const dettagli = [quando, v.durataMs ? durata(v.durataMs / 1000) : null, v.daTrascrivere ? "da trascrivere" : null].filter(Boolean).join(" · ");
      return el("div.vocali__riga", { "data-id": v.id },
        el("button.vocali__apri", { type: "button", onclick: () => nuova(v.testo, { ripresa: v.id, projectId: v.projectId }) },
          icon("microfono"),
          el("div", { style: "min-width:0" },
            el("div.vocali__titolo", {}, `Registrazione di ${dettagli}`),
            v.testo ? el("div.vocali__anteprima", {}, v.testo) : el("div.vocali__anteprima", {}, "Tocca per trascriverla e salvarla"))),
        el("button.tondo.tondo--piatto", { type: "button", "aria-label": "Butta la registrazione", onclick: () => {
          buttate.add(v.id); disegnaVocali();
          const via = setTimeout(() => eliminaVocale(v.id), 5200);
          toast("Registrazione buttata", { azione: { label: "Annulla", fn: () => { clearTimeout(via); buttate.delete(v.id); disegnaVocali(); } } });
        } }, icon("chiudi")));
    }));
  }
  window.addEventListener("registrazioni", disegnaVocali);

  // Il nome di chi ha scritto una nota condivisa, se non sei tu (la casa arriva subito: è già in memoria).
  let casa = null;
  getHousehold().then((h) => { casa = h; if (note.some((n) => !notaMia(n))) render(); }).catch(() => {});
  const autoreDi = (n) => (notaMia(n) ? null : nomeDi(n.ownerUid, casa));
  const proposteDi = (n) => proposte.filter((p) => p.sourceEntryId === n.id);

  function leggiNota(n) {
    apriLettura(n, {
      progetto: progettoDi(n.projectId),
      autore: autoreDi(n),
      modificata: ultimaModifica(n, casa),
      proposte: proposteDi(n),
      inAnalisi: inCorso.has(n.id),
      onModifica: (fuoco) => modifica(n, fuoco),
      onAnalizza: () => analizza(n.id),
      onElimina: () => { remove(COLL, n.id); eliminaFotoDi(n); toast("Nota eliminata"); },
    });
  }

  function nota(n, conGiorno) {
    return rigaNota(n, {
      conGiorno, conOra: true,
      progetto: filtro === "tutte" ? progettoDi(n.projectId) : null,
      colore: progettoDi(n.projectId)?.colore,
      autore: autoreDi(n),
      proposte: proposteDi(n),
      inAnalisi: inCorso.has(n.id),
      onApri: () => leggiNota(n),
      cerca: cerca != null ? parole(cerca) : [],
    });
  }

  /** Pillole dei progetti: quelli con istruzioni per il diario e quelli che hanno già note. */
  function disegnaFiltri() {
    const attivi = progetti.filter((p) => !p.archived && (p.istruzioni || conNote.has(p.id) || p.id === filtro))
      .sort((a, b) => a.name.localeCompare(b.name));
    filtri.hidden = !attivi.length && !persona;
    filtri.replaceChildren(
      // (replaceChildren scrive «null» per un null: la pillola della persona entra solo se c'è)
      ...(persona ? [el("button.pillola.pillola--persona", { type: "button", "aria-label": `Togli il filtro: ${persona.nome}`,
        onclick: () => { persona = null; servonoTutte(); render(); } }, icon("persona"), persona.nome, icon("chiudi"))] : []),
      el("button.pillola", { type: "button", class: filtro === "tutte" ? "on" : "", onclick: () => scegli("tutte") }, "Tutte"),
      ...attivi.map((p) => pillolaProgetto(p, { on: filtro === p.id, onclick: () => scegli(p.id) })),
    );
  }

  // Un'analisi «in corso» che supera il tempo massimo diventa «non analizzata» senza che la nota cambi: si ridisegna allora.
  let timerAnalisi = null;
  function render() {
    if (!dati.pronta()) return;
    clearTimeout(timerAnalisi);
    const tra = scadenzaAnalisi(note);
    if (tra != null) timerAnalisi = setTimeout(render, tra);
    disegnaProssimi();
    disegnaFiltri();
    const prog = filtro !== "tutte" ? progettoDi(filtro) : null;
    const ricerca = cerca != null;
    barraCerca.hidden = !ricerca;
    rigaStato.hidden = ricerca;
    const ps = ricerca ? parole(cerca) : [];
    const filtrando = ps.length > 0 || !!persona;
    // Cercando o con una persona: tutte le note che vedi; finché non arrivano, le ultime già in memoria (mai «nessuna»).
    const mostrate = !filtrando ? note
      : (tutteNote || tutte || note).filter((n) => (!prog || n.projectId === prog.id) && (!persona || notaConPersona(n, persona)) && notaTrovata(n, ps));
    esito.hidden = !filtrando || !tutteNote;
    if (filtrando && tutteNote) {
      const k = mostrate.length;
      const dove = [persona ? ` con ${persona.nome}` : "", prog ? ` in ${prog.name}` : ""].join("");
      const cosa = ps.length ? ` per «${cerca.trim()}»` : "";
      const scheda = persona ? schedaDi(persona) : null;
      esito.replaceChildren(k ? `${k} ${k === 1 ? "nota" : "note"}${dove}` : `Nessuna nota${dove}${cosa}`, ...(scheda ? [" · ", scheda] : []));
    }
    // Filtrato su un progetto, il Diario prende il suo colore come la pagina del progetto (7/11): la pillola scelta,
    // il +, i giorni delle note. Sulla pagina, non su <html>: la pagina accanto nello scorrimento resta com'è.
    piu.toggleAttribute("data-colore", !!prog?.colore);
    if (prog?.colore) piu.dataset.colore = prog.colore;
    elenco.classList.toggle("elenco--progetto", !!prog);
    const nodi = [];
    if (prog) {
      nodi.push(el("div.segmenti", { style: "padding-top:4px;align-items:center", "data-colore": prog.colore || null },
        prog.istruzioni
          ? el("button.btn.btn--piatto", { onclick: () => apriPaginaProgetto(prog.id) }, icon("cartella"), "Pagina del progetto")
          : el("button.btn.btn--piatto", { onclick: () => apriProgetto(prog) }, icon("matita"), "Modifica progetto"),
        el("span.meta", {}, prog.istruzioni ? "Con riepilogo e sintesi" : "Senza istruzioni, senza riepilogo")));
    }
    if (!filtrando && !note.length && caricate) {
      nodi.push(prog
        ? vuoto("Nessuna nota in questo progetto", "Tocca + e scrivi o incolla: la nota finisce qui.")
        : vuoto("Il diario è vuoto", "Tocca + e scrivi o detta: un'idea, cosa devi fare, cosa hai speso. Le note sono visibili solo a te, tranne quelle dei progetti condivisi."));
    }
    nodi.push(...elencoNote(mostrate, nota));
    elenco.replaceChildren(...nodi);
  }

  // Note che vedi (le tue e quelle dei progetti condivisi, core/note.js): tutte (le ultime 100) o quelle di un progetto.
  let stopNote = () => {};
  function segui() {
    stopNote();
    const f = filtro;
    const extra = f !== "tutte" ? [where("projectId", "==", f)] : [];
    stopNote = seguiNote({ extra, max: f !== "tutte" ? 300 : 100 }, (docs) => {
      note = docs;
      caricate = true;
      for (const n of docs) if (n.projectId) conNote.add(n.projectId);
      dati.arriva("note");
      render();
    });
  }
  // Le ultime note senza filtro si seguono sempre, anche con un progetto scelto (è lo stesso ascolto di «Tutte»,
  // condiviso in db.js): danno le pillole dei progetti che hanno note e l'anteprima quando si cambia filtro.
  // Prima arrivavano solo dalle note viste: riaprendo il Diario già filtrato su Tennis, un progetto senza
  // istruzioni ma con note (LAMA) spariva dalle pillole (2/11, dal video di Mattia).
  const stopTutte = seguiNote({ max: 100 }, (docs) => {
    tutte = docs;
    for (const n of docs) if (n.projectId) conNote.add(n.projectId);
    dati.arriva("tutte");
    render();
  });
  // Cambiando filtro non si svuota l'elenco: finché arrivano le note del filtro nuovo (di solito
  // subito, se è già stato usato) si vedono quelle già note, filtrate. Mai «Nessuna nota» per un attimo.
  function scegli(v) {
    if (v === filtro) return;
    filtro = v; scrivi(CHIAVE_FILTRO, v);
    note = !tutte ? [] : v === "tutte" ? tutte : tutte.filter((n) => n.projectId === v);
    caricate = false;
    render(); segui();
  }

  container.append(
    vocali,
    barraCerca,
    prossimi,
    rigaStato,
    filtri,
    esito,
    elenco,
    piu,
    eventoFab,
  );

  // Una nota chiesta da un'altra pagina (le fonti di Chiedi, 14/11): si apre il suo foglio di lettura.
  const chiesta = richiestaPer("diario");
  if (chiesta?.startsWith("persona:")) {
    // Le note di una persona, chieste dalla rubrica o dal foglio di una nota in un'altra pagina (core/cerca.js).
    try { filtraPersona(JSON.parse(chiesta.slice(8))); } catch (e) {}
  }
  if (chiesta?.startsWith("nota:")) {
    // Dopo il montaggio: il router chiude i fogli aperti quando ha finito di cambiare pagina.
    setTimeout(() => leggiUno(COLL, chiesta.slice(5)).then((n) => { if (n && !smontato) leggiNota(n); else if (!n) toast("Questa nota non c'è più"); }), 0);
  }

  // Testo o foto condivisi da un'altra app (14/11 anche le foto: uno scontrino, un biglietto da visita, uno screenshot):
  // apre subito il foglio con il testo e le foto dentro (sw.js le mette da parte, app.js le passa qui).
  const condiviso = sessionStorage.getItem("macroapp.share");
  const conFoto = sessionStorage.getItem("macroapp.share.foto") === "1";
  if (condiviso != null || conFoto) {
    sessionStorage.removeItem("macroapp.share"); sessionStorage.removeItem("macroapp.share.foto");
    (conFoto ? fotoCondivise() : Promise.resolve([])).then((foto) => setTimeout(() => nuova(condiviso || "", { foto }), 0));
  }
  // Scorciatoia dell'icona «Nota vocale»: #/diario/vocale.
  if (/^#\/diario\/vocale/.test(location.hash)) {
    history.replaceState(history.state, "", "#/diario");
    setTimeout(() => nuova("", { registraSubito: true }), 0);
  }

  segui();
  const stop1 = watchVisible("projects", {}, (docs) => {
    progetti = docs;
    dati.arriva("progetti");
    // Un progetto archiviato o eliminato non resta come filtro.
    if (filtro !== "tutte" && !docs.some((p) => p.id === filtro && !p.archived)) { scegli("tutte"); return; }
    render();
  });
  const stop2 = watchPending((docs) => { proposte = docs; render(); });
  const stop3 = suEventi((lista) => { eventi = lista; disegnaProssimi(); });
  const stop4 = suGoogle(() => caricaProssimi());
  const stop5 = suCalendari(() => caricaProssimi());
  caricaProssimi();
  disegnaVocali();
  return () => { if (apriRicerca === questaRicerca) apriRicerca = null; lasciaFiltroPersona(filtraPersona); stopTutteNote?.(); window.removeEventListener("registrazioni", disegnaVocali); clearTimeout(timerAnalisi); stopNote(); stopTutte(); stop1(); stop2(); stop3(); stop4(); stop5(); dati.ferma(); smontato = true; piu.remove(); eventoFab.remove(); lasciaDoppio?.(); lasciaDoppio = null; };
}
