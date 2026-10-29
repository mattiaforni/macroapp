// Diario: scrivi o detta (microfono della tastiera). Le note sono sempre solo tue.
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
// In cima, «Prossimi giorni»: gli eventi del calendario della casa di oggi e dei due giorni dopo (non quelli
// già finiti), con le righe della pagina Calendario; compare solo se ce ne sono e se Google è collegato con il
// calendario. Scelta di Mattia del 27/10 (schermata B), al posto di aprire il Calendario dal menu.
//
// journal_entries { text, titolo, titoloAMano, persone: [{ nome, voceId?, googleId? }], personeAMano, projectId,
//   riepilogo, temi, riepilogoAt, analyzed, analyzedAt, analysisError, modello, sintesiEsito }
// `modello`: chi ha letto la nota l'ultima volta (haiku, sonnet, opus: scelta in menu → Modelli AI).
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-functions.js";
import { functions } from "../../core/firebase.js";
import { el, icon, toast, fascia, vuoto, attesa, toDate, meseLungo, fab, testoRicco, isoGiorno, stessoGiorno, fmtDate } from "../../core/ui.js";
import { openSheet } from "../../components/sheet.js";
import { create, update, remove, watchMine, watchVisible, readVisible, VIS, where } from "../../core/db.js";
import { watchPending, renderAzione } from "../../components/proposals.js";
import { aggiungiVoci } from "../lista/index.js";
import { apriTask, apriProgetto } from "../task/index.js";
import { vaiA } from "../../core/router.js";
import { apriSpesa } from "../spese/index.js";
import { apriVoceManuale } from "../manuale/index.js";
import { nomeModello } from "../../core/modelli.js";
import { statoGoogle, suGoogle } from "../../core/google.js";
import { calendarioCasa, leggiEventi, eventiNoti, suEventi } from "../../core/calendario.js";
import { rigaEvento, inOrdine } from "../calendario/index.js";
import { pulsanteRegistra } from "../../components/registratore.js";
import { sceltaPersone } from "../../components/persone.js";
import { personaDaId, personaDaGoogle } from "../../core/rubrica.js";
import { linkGoogle } from "../../core/contatti-google.js";

export const id = "diario";
export const title = "Diario";
export const nav = true;
const navIcon = "diario";
export { navIcon as icon };

const COLL = "journal_entries";
const CHIAVE_AUTO = "macroapp.diario.auto";
const CHIAVE_AI = "macroapp.diario.ai"; // "on" | "off": esito dell'ultima analisi
const CHIAVE_FILTRO = "macroapp.diario.progetto"; // "tutte" o id del progetto (lo scrive anche la pagina Task)
const CHIAVE_PAGINA = "macroapp.progetto"; // progetto aperto nella pagina Progetto (modules/progetto)
const GIORNI_PROSSIMI = 2; // «Prossimi giorni»: oggi e i due giorni dopo
const MAX_PROSSIMI = 4;    // righe al massimo; per le altre c'è il Calendario
const GIORNI = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
const analyzeEntry = httpsCallable(functions, "analyzeEntry", { timeout: 310000 }); // la funzione ha 300 s (Opus può metterci minuti)

const leggi = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } };
const scrivi = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

/** Pillole per scegliere il progetto di una nota. Ritorna { node, valore() }. */
function sceltaProgetto(progetti, iniziale) {
  let scelto = iniziale || null;
  const node = el("div.segmenti", { style: "padding-top:0;flex-wrap:wrap" });
  const disegna = () => node.replaceChildren(
    el("button.pillola", { type: "button", class: scelto ? "" : "on", onclick: () => { scelto = null; disegna(); } }, "Nessuno"),
    ...progetti.map((p) => el("button.pillola", { type: "button", class: p.id === scelto ? "on" : "", onclick: () => { scelto = p.id; disegna(); } }, p.name)),
  );
  disegna();
  return { node, valore: () => scelto };
}

/** Le persone di una nota, in una forma confrontabile (per sapere se il foglio le ha cambiate). */
const chiavePersone = (lista) => JSON.stringify((lista || []).map((p) => [p.nome, p.voceId || "", p.googleId || ""]));

/**
 * Foglio della nota: titolo (facoltativo) e testo a tutta larghezza, poi persone, progetto e giorno. La spunta
 * salva; le pillole trasformano subito il testo in task, voce di lista, spesa o voce del manuale, senza passare
 * dall'AI. Invio nel titolo porta al testo; nel testo va a capo: una nota può avere più paragrafi.
 * Titolo e persone cambiati qui restano come li hai scritti: l'analisi non li tocca più (titoloAMano,
 * personeAMano). Svuotando il titolo, lo riscrive l'AI alla prossima analisi.
 */
export function apriNota({ esistente = null, testo = "", progetti = [], projectId = null, onSalva }) {
  // Una nota già scritta si apre per leggerla dall'inizio: niente tastiera finché non tocchi il testo.
  const area = el("textarea", { placeholder: "Scrivi o detta…", rows: 6, autofocus: !esistente });
  area.value = esistente?.text || testo;
  const titolo = el("input.nota__titolo-campo", { placeholder: "Titolo", "aria-label": "Titolo della nota", autocomplete: "off", enterkeyhint: "next" });
  titolo.value = esistente?.titolo || "";
  titolo.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); area.focus(); } });
  const persone = sceltaPersone({ perNota: esistente?.persone || [] });
  const attivi = progetti.filter((p) => !p.archived || p.id === esistente?.projectId).sort((a, b) => a.name.localeCompare(b.name));
  const progetto = sceltaProgetto(attivi, esistente ? esistente.projectId : projectId);
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
  }

  const sheet = openSheet({
    title: esistente ? "Nota" : "Nuova nota",
    body: [
      el("div.taccuino", {}, titolo),
      riepilogo ? el("div.campo", { style: "margin-top:14px" }, el("label", {}, "Riepilogo"), riepilogo) : null,
      riepilogo ? el("div.etichetta-campo", {}, "Trascrizione") : null,
      el("div.taccuino", { style: "padding-top:0" }, area),
      esistente ? null : el("p.meta", { style: "margin-top:6px" }, "Per la voce tocca «Registra» in basso: parla quanto vuoi, poi «Ferma»."),
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
        ),
      ),
    ],
    // Nota vocale: la trascrizione si aggiunge a quello che c'è già nel campo.
    azioni: [pulsanteRegistra({
      progetto: () => progetto.valore(),
      inserisci: (testo) => {
        const prima = area.value.trimEnd();
        area.value = prima ? `${prima}\n\n${testo}` : testo;
        area.dispatchEvent(new Event("input", { bubbles: true }));
      },
    })],
    onConfirm: () => {
      const text = area.value.trim();
      if (!text) { area.focus(); return false; }
      const dati = { text, projectId: progetto.valore() };
      const t = titolo.value.trim();
      if (t !== (esistente?.titolo || "")) { dati.titolo = t; dati.titoloAMano = !!t; }
      const scelte = persone.valore();
      if (chiavePersone(scelte) !== chiavePersone(esistente?.persone)) { dati.persone = scelte; dati.personeAMano = true; }
      if (riepilogo) dati.riepilogo = riepilogo.value.trim();
      if (quando.getTime() !== originale.getTime()) dati.createdAt = quando;
      onSalva(dati);
    },
  });
}

/**
 * Manda una nota all'agente e segna l'esito sulla nota. Ritorna la risposta della funzione
 * ({ proposals, riepilogo, sintesi }) o null se non è riuscita (l'errore è già stato mostrato).
 * `attesa`: la scrittura da aspettare prima (la nota appena creata o modificata).
 */
export async function analizzaNota(entryId, attesa) {
  try {
    if (attesa) await attesa;
    const res = await analyzeEntry({ entryId });
    const n = res.data?.proposals ?? 0;
    scrivi(CHIAVE_AI, "on");
    update(COLL, entryId, { analyzed: true, analyzedAt: new Date(), analysisError: null, modello: res.data?.modello || null });
    if (!n && !res.data?.riepilogo) toast("Nessuna azione da proporre");
    else if (res.data?.sintesiEsito === "invariata") toast("Sintesi del progetto invariata");
    return res.data || {};
  } catch (err) {
    console.warn("analisi", err);
    const chiave = err.code === "functions/failed-precondition" && /non configurata/.test(err.message || "");
    if (chiave) scrivi(CHIAVE_AI, "off");
    update(COLL, entryId, { analysisError: err.message || err.code || "errore" });
    toast(chiave ? "AI non ancora collegata: la nota è salvata" : `${err.message || "Analisi non riuscita"}. La nota è salvata.`, { ms: 7000 });
    return null;
  }
}

/**
 * Sotto una nota di progetto: la sintesi non è cambiata con l'ultima analisi (`sintesiEsito`, scritto dal server).
 * Senza, una sintesi invariata non dava nessun segnale (29/10). Esportata per il foglio della lezione.
 */
export function sintesiInvariata(n, inAnalisi = false) {
  return n.sintesiEsito === "invariata" && !inAnalisi ? el("p.meta.nota__esito", {}, "Sintesi del progetto invariata") : null;
}

/** Analisi automatica attiva (scelta sul telefono, pillola in alto nel Diario). */
export const analisiAutomatica = () => leggi(CHIAVE_AUTO, "1") === "1";

const pulisci = (r) => r.replace(/^[-*•]\s+/, "").replace(/\*\*/g, "").trim();
const unaRiga = (t) => String(t || "").replace(/\s+/g, " ").trim();

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

/** Una persona della nota come pillola: si apre in rubrica se c'è, se no su Google Contatti, se no è solo un nome. */
function pillolaPersona(p) {
  const voce = (p.voceId && personaDaId(p.voceId)) || personaDaGoogle(p.googleId);
  if (voce) return el("button.pillola", { type: "button", onclick: () => apriVoceManuale(voce) }, icon("persona"), voce.name);
  if (p.googleId) return el("a.pillola", { href: linkGoogle(p.googleId), target: "_blank", rel: "noopener", title: "Su Google Contatti" }, icon("contatto"), p.nome);
  return el("span.pillola", {}, icon("persona"), p.nome);
}

/**
 * Riga di una nota, come le lezioni del tennis: giorno a sinistra (solo sulla prima nota del giorno, `conGiorno`),
 * titolo, anteprima su due righe, poi ora e modello (`conOra`, nel Diario), progetto (`progetto`, nel Diario su
 * «Tutte»), persone e temi. Sotto, fuori dal pulsante, le azioni proposte ancora in attesa.
 */
export function rigaNota(n, { conGiorno = true, conOra = false, progetto = null, proposte = [], inAnalisi = false, onApri } = {}) {
  const d = toDate(n.createdAt) || new Date();
  const { titolo, anteprima } = testaNota(n);
  const persone = Array.isArray(n.persone) ? n.persone.filter((p) => p?.nome) : [];
  const nonAnalizzata = n.analysisError && !n.analyzed && !inAnalisi;
  const piede = [
    conOra ? el("span.lezione__ora", {}, d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }), n.analyzed && n.modello ? ` · ${nomeModello(n.modello)}` : "") : null,
    progetto ? el("span.progetto", {}, progetto.name) : null,
    ...persone.map((p) => el("span.persona", {}, icon("persona"), p.nome)),
    ...(n.temi || []).map((t) => el("span.etichetta", {}, t)),
    inAnalisi ? el("span.lezione__stato", {}, "Analizzo…") : null,
    nonAnalizzata ? el("span.lezione__stato.lezione__stato--errore", {}, "non analizzata") : null,
    n.sintesiEsito === "invariata" && !inAnalisi ? el("span.lezione__stato.lezione__stato--muto", {}, "sintesi invariata") : null,
  ].filter(Boolean);
  const oggi = stessoGiorno(d, new Date());
  return el("div.voce-nota", { "data-id": n.id },
    el("button.lezione", { type: "button", onclick: onApri },
      el("div.lezione__giorno", {}, conGiorno ? [el("b.display", {}, String(d.getDate())), el("small", {}, oggi ? "oggi" : GIORNI[d.getDay()])] : null),
      el("div.lezione__testo", {},
        el("div.lezione__titolo", {}, titolo || "Senza titolo"),
        anteprima ? el("div.lezione__anteprima", {}, anteprima) : null,
        piede.length ? el("div.lezione__temi", {}, ...piede) : null,
      ),
    ),
    proposte.length ? el("div.azioni-ai.voce-nota__azioni", {}, ...proposte.map(renderAzione)) : null,
  );
}

/**
 * Foglio di lettura di una nota (Diario e pagina del progetto): data, persone e temi, il riepilogo intero con la
 * trascrizione ripiegata o il testo, le azioni proposte. In basso Rianalizza ed Elimina a sinistra, Modifica a destra.
 */
export function apriLettura(n, { progetto = null, proposte = [], onModifica, onAnalizza, onElimina }) {
  const d = toDate(n.createdAt) || new Date();
  const persone = Array.isArray(n.persone) ? n.persone.filter((p) => p?.nome) : [];
  let aperta = false;
  const trascrizione = el("div.nota__testo.nota__testo--trascrizione", { hidden: true }, n.text);
  const apri = el("button.nota__apri", { type: "button", "aria-expanded": "false", onclick: () => {
    aperta = !aperta; trascrizione.hidden = !aperta;
    apri.setAttribute("aria-expanded", aperta ? "true" : "false");
    apri.lastChild.textContent = aperta ? "Nascondi la trascrizione" : "Trascrizione";
  } }, icon("giu"), "Trascrizione");
  const quando = `${d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}, ${d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`;
  const sheet = openSheet({
    title: titoloDi(n) || "Nota",
    body: [
      el("p.meta", { style: "margin-top:12px" }, quando, n.analyzed && n.modello ? ` · letta da ${nomeModello(n.modello)}` : "",
        progetto ? [" · ", el("span.progetto", {}, progetto.name)] : null),
      persone.length ? el("div.lettura__persone", {}, ...persone.map(pillolaPersona)) : null,
      n.temi?.length ? el("div.lezione__temi", {}, ...n.temi.map((t) => el("span.etichetta", {}, t))) : null,
      n.riepilogo
        ? el("div.sintesi-testo.lezione__riepilogo", {}, ...testoRicco(n.riepilogo))
        : el("div.nota__testo.lettura__testo", {}, n.text),
      n.riepilogo ? apri : null,
      n.riepilogo ? trascrizione : null,
      sintesiInvariata(n),
      proposte.length ? el("div.azioni-ai", { style: "margin-top:14px" }, ...proposte.map(renderAzione)) : null,
      el("div.foglio__piede", {},
        el("button.btn", { onclick: () => { sheet.close(); onAnalizza?.(); } }, icon("scintilla"), n.analyzed ? "Rianalizza" : "Analizza"),
        el("button.btn.btn--pericolo", { "aria-label": "Elimina nota", onclick: () => { sheet.close(); onElimina?.(); } }, icon("cestino")),
      ),
    ],
    confirmLabel: "Modifica",
    onConfirm: () => { onModifica?.(); },
  });
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
  // La pagina compare quando ci sono note e progetti (pillole, nomi): intera, non a pezzi.
  const dati = attesa(["note", "progetti"], () => render());

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

  function nuova(testo = "") {
    apriNota({
      testo, progetti, projectId: filtro !== "tutte" ? filtro : null,
      onSalva: (dati) => {
        const { id: entryId, saved } = create(COLL, { ...dati, analyzed: false }, VIS.PRIVATE);
        if (auto) analizza(entryId, saved);
      },
    });
  }

  function modifica(n) {
    apriNota({
      esistente: n, progetti,
      onSalva: (dati) => {
        const salvata = update(COLL, n.id, dati);
        // Spostata in un progetto con istruzioni e ancora senza riepilogo: lo scrive subito.
        const nuovo = dati.projectId !== (n.projectId || null) ? progettoDi(dati.projectId) : null;
        if (auto && nuovo?.istruzioni && !n.riepilogo) analizza(n.id, salvata);
      },
    });
  }

  const filtri = el("div.segmenti", { style: "padding-top:8px" });
  const elenco = el("div");
  const piu = fab("Nuova nota", () => nuova());

  // ── Prossimi giorni, dal calendario della casa ──
  // Si disegna con l'ultima lettura nota (anche salvata sul telefono), poi con quella fresca da Google; non
  // prima delle note, perché la pagina non compaia a pezzi.
  const prossimi = el("div.prossimi", { hidden: true });
  let eventi = statoGoogle().permessi.calendario ? eventiNoti() : null;
  function disegnaProssimi() {
    const g = statoGoogle();
    if (!dati.pronta() || !g.collegato || !g.permessi.calendario || !eventi) { prossimi.hidden = true; return; }
    const ora = new Date();
    const limite = new Date(); limite.setDate(limite.getDate() + GIORNI_PROSSIMI);
    const fino = isoGiorno(limite);
    const vicini = inOrdine(eventi.filter((e) => e.fine >= ora && e.giornoInizio <= fino), isoGiorno(ora));
    prossimi.hidden = !vicini.length;
    if (!vicini.length) { prossimi.replaceChildren(); return; }
    let giorno = null;
    const righe = vicini.slice(0, MAX_PROSSIMI).map(({ e, g: gg }) => {
      const r = rigaEvento(e, { giorno: gg, conGiorno: gg !== giorno });
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
    if (!statoGoogle().permessi.calendario || !(await calendarioCasa().catch(() => null))) { eventi = null; disegnaProssimi(); return; }
    // Se Google non risponde resta l'ultima lettura; perché, lo dice la pagina Calendario.
    try { eventi = await leggiEventi(); } catch (e) { /* niente */ }
    disegnaProssimi();
  }

  function leggiNota(n) {
    apriLettura(n, {
      progetto: progettoDi(n.projectId),
      proposte: proposte.filter((p) => p.sourceEntryId === n.id),
      onModifica: () => modifica(n),
      onAnalizza: () => analizza(n.id),
      onElimina: () => { remove(COLL, n.id); toast("Nota eliminata"); },
    });
  }

  function nota(n, conGiorno) {
    return rigaNota(n, {
      conGiorno, conOra: true,
      progetto: filtro === "tutte" ? progettoDi(n.projectId) : null,
      proposte: proposte.filter((p) => p.sourceEntryId === n.id),
      inAnalisi: inCorso.has(n.id),
      onApri: () => leggiNota(n),
    });
  }

  /** Pillole dei progetti: quelli con istruzioni per il diario e quelli che hanno già note. */
  function disegnaFiltri() {
    const attivi = progetti.filter((p) => !p.archived && (p.istruzioni || conNote.has(p.id) || p.id === filtro))
      .sort((a, b) => a.name.localeCompare(b.name));
    filtri.hidden = !attivi.length;
    filtri.replaceChildren(
      el("button.pillola", { type: "button", class: filtro === "tutte" ? "on" : "", onclick: () => scegli("tutte") }, "Tutte"),
      ...attivi.map((p) => el("button.pillola", { type: "button", class: filtro === p.id ? "on" : "", onclick: () => scegli(p.id) }, p.name)),
    );
  }

  function render() {
    if (!dati.pronta()) return;
    disegnaProssimi();
    disegnaFiltri();
    const prog = filtro !== "tutte" ? progettoDi(filtro) : null;
    const nodi = [];
    if (prog) {
      nodi.push(el("div.segmenti", { style: "padding-top:4px;align-items:center" },
        prog.istruzioni
          ? el("button.btn.btn--piatto", { onclick: () => { scrivi(CHIAVE_PAGINA, prog.id); vaiA("progetto"); } }, icon("cartella"), "Pagina del progetto")
          : el("button.btn.btn--piatto", { onclick: () => apriProgetto(prog) }, icon("matita"), "Modifica progetto"),
        el("span.meta", {}, prog.istruzioni ? "Con riepilogo e sintesi" : "Senza istruzioni, senza riepilogo")));
    }
    if (!note.length && caricate) {
      nodi.push(prog
        ? vuoto("Nessuna nota in questo progetto", "Tocca + e scrivi o incolla: la nota finisce qui.")
        : vuoto("Il diario è vuoto", "Tocca + e scrivi o detta: un'idea, cosa devi fare, cosa hai speso. Le note sono visibili solo a te."));
    }
    nodi.push(...elencoNote(note, nota));
    elenco.replaceChildren(...nodi);
  }

  // Note: tutte (le ultime 100) o quelle di un progetto (indice ownerUid + projectId + createdAt).
  let stopNote = () => {};
  function segui() {
    stopNote();
    const f = filtro;
    const extra = f !== "tutte" ? [where("projectId", "==", f)] : [];
    stopNote = watchMine(COLL, { extra, max: f !== "tutte" ? 300 : 100 }, (docs) => {
      note = docs;
      caricate = true;
      if (f === "tutte") tutte = docs;
      for (const n of docs) if (n.projectId) conNote.add(n.projectId);
      dati.arriva("note");
      render();
    });
  }
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
    prossimi,
    el("div.segmenti", { style: "align-items:center;justify-content:space-between" }, stato, autoBtn),
    filtri,
    elenco,
    piu,
  );

  // Testo condiviso da un'altra app: apre subito il foglio con il testo dentro.
  const condiviso = sessionStorage.getItem("macroapp.share");
  if (condiviso) { sessionStorage.removeItem("macroapp.share"); setTimeout(() => nuova(condiviso), 0); }

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
  caricaProssimi();
  return () => { stopNote(); stop1(); stop2(); stop3(); stop4(); dati.ferma(); piu.remove(); };
}
