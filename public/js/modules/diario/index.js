// Diario: scrivi o detta (microfono della tastiera). Le note sono sempre solo tue.
// Con l'AI collegata, ogni nota salvata viene letta dall'agente, che propone sotto di essa
// le azioni che contiene: task, voci per la lista, spese, voci del manuale, bozze di mail.
// Niente entra nell'app senza la tua spunta.
//
// Una nota può appartenere a un progetto (es. Tennis). Se il progetto ha istruzioni per il diario,
// l'agente scrive anche un riepilogo della nota tenendo conto delle precedenti: compare al posto
// del testo, che resta ripiegato sotto («Trascrizione»). Il riepilogo è testo correggibile, non
// un'azione: è l'unica cosa che l'agente scrive senza la spunta. La sintesi del progetto (lo stato,
// ciò che è emerso finora) arriva invece come proposta sotto la nota e, confermata, si legge nella
// pagina del progetto (modules/progetto), dove le note si sfogliano per titolo e per tema.
//
// journal_entries { text, projectId, riepilogo, titolo, temi, riepilogoAt, analyzed, analyzedAt, analysisError }
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-functions.js";
import { functions } from "../../core/firebase.js";
import { el, icon, toast, fascia, vuoto, toDate, giornoRelativo, fab, testoRicco } from "../../core/ui.js";
import { openSheet } from "../../components/sheet.js";
import { create, update, remove, watchMine, watchVisible, readVisible, VIS, where } from "../../core/db.js";
import { watchPending, renderAzione } from "../../components/proposals.js";
import { aggiungiVoci } from "../lista/index.js";
import { apriTask, apriProgetto } from "../task/index.js";
import { vaiA } from "../../core/router.js";
import { apriSpesa } from "../spese/index.js";
import { apriVoceManuale } from "../manuale/index.js";

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
const analyzeEntry = httpsCallable(functions, "analyzeEntry", { timeout: 130000 }); // la funzione ha 120 s

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

/**
 * Foglio della nota: textarea a tutta larghezza. La spunta salva; le pillole trasformano
 * subito il testo in task, voce di lista, spesa o voce del manuale, senza passare dall'AI.
 * Invio va a capo: una nota può avere più paragrafi.
 */
export function apriNota({ esistente = null, testo = "", progetti = [], projectId = null, onSalva }) {
  const area = el("textarea", { placeholder: "Scrivi o detta…", rows: 6, autofocus: !esistente?.riepilogo });
  area.value = esistente?.text || testo;
  const attivi = progetti.filter((p) => !p.archived || p.id === esistente?.projectId).sort((a, b) => a.name.localeCompare(b.name));
  const progetto = sceltaProgetto(attivi, esistente ? esistente.projectId : projectId);
  // Il riepilogo scritto dall'AI si corregge qui; se lo svuoti, torna a vedersi il testo.
  const riepilogo = esistente?.riepilogo ? el("textarea", { rows: Math.min(16, esistente.riepilogo.split("\n").length + 1) }) : null;
  if (riepilogo) riepilogo.value = esistente.riepilogo;

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
      riepilogo ? el("div.campo", { style: "margin-top:14px" }, el("label", {}, "Riepilogo"), riepilogo) : null,
      riepilogo ? el("div.etichetta-campo", {}, "Trascrizione") : null,
      el("div.taccuino", { style: riepilogo ? "padding-top:0" : null }, area),
      esistente ? null : el("p.meta", { style: "margin-top:6px" }, "Per la voce usa il microfono della tastiera."),
      attivi.length ? el("div", { style: "margin-top:16px" }, el("div.etichetta-campo", {}, "Progetto"), progetto.node) : null,
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
    onConfirm: () => {
      const text = area.value.trim();
      if (!text) { area.focus(); return false; }
      const dati = { text, projectId: progetto.valore() };
      if (riepilogo) dati.riepilogo = riepilogo.value.trim();
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
    update(COLL, entryId, { analyzed: true, analyzedAt: new Date(), analysisError: null });
    if (!n && !res.data?.riepilogo) toast("Nessuna azione da proporre");
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

/** Analisi automatica attiva (scelta sul telefono, pillola in alto nel Diario). */
export const analisiAutomatica = () => leggi(CHIAVE_AUTO, "1") === "1";

/** Titolo di una nota: quello scritto dall'AI, se no la prima riga utile del riepilogo o del testo. */
export function titoloDi(n) {
  if (n.titolo) return n.titolo;
  const righe = String(n.riepilogo || n.text || "").split("\n").map((r) => r.trim()).filter(Boolean);
  const prima = righe.find((r) => !/^#/.test(r)) || righe[0] || "";
  const pulita = prima.replace(/^[-*•]\s+/, "").replace(/\*\*/g, "");
  return pulita.length > 70 ? `${pulita.slice(0, 68).trimEnd()}…` : pulita;
}

export function mount(container) {
  let note = [];
  let proposte = [];
  let progetti = [];
  const inCorso = new Set(); // note in analisi
  const aperte = new Set();  // note con il riepilogo di cui si legge anche la trascrizione
  const conNote = new Set(); // progetti che hanno note tra quelle viste
  let auto = leggi(CHIAVE_AUTO, "1") === "1";
  let filtro = leggi(CHIAVE_FILTRO, "tutte");

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
      onSalva: ({ text, projectId }) => {
        const { id: entryId, saved } = create(COLL, { text, projectId, analyzed: false }, VIS.PRIVATE);
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

  function nota(n) {
    const d = toDate(n.createdAt) || new Date();
    const mie = proposte.filter((p) => p.sourceEntryId === n.id);
    const analisi = inCorso.has(n.id);
    const prog = progettoDi(n.projectId);
    const scrive = analisi && !n.riepilogo && prog?.istruzioni;
    const aperta = aperte.has(n.id);
    const corpo = n.riepilogo
      ? [
          el("div.nota__riepilogo", { onclick: () => modifica(n) }, ...testoRicco(n.riepilogo)),
          el("button.nota__apri", { type: "button", "aria-expanded": aperta ? "true" : "false",
            onclick: () => { aperta ? aperte.delete(n.id) : aperte.add(n.id); render(); } },
            icon("giu"), aperta ? "Nascondi la trascrizione" : "Trascrizione"),
          aperta ? el("div.nota__testo.nota__testo--trascrizione", { onclick: () => modifica(n) }, n.text) : null,
        ]
      : [
          el("div.nota__testo", { onclick: () => modifica(n) }, n.text),
          scrive ? el("p.meta", { style: "margin-top:6px" }, "Scrivo il riepilogo…") : null,
        ];
    return el("div.nota", {},
      el("div.nota__testa", {},
        el("span", {}, d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })),
        prog && filtro === "tutte" ? el("small.progetto", {}, prog.name) : null,
        n.analyzed && !mie.length && !n.riepilogo ? el("span", {}, "· analizzata") : null,
        n.analysisError && !n.analyzed ? el("span", { style: "color:var(--frutto)" }, "· non analizzata") : null,
        el("span.spazio"),
        el("button.btn.btn--piatto", { disabled: analisi, onclick: () => analizza(n.id) },
          icon("scintilla"), analisi ? "Analizzo…" : n.analyzed ? "Rianalizza" : "Analizza"),
        el("button.tondo.tondo--piatto", { "aria-label": "Elimina nota",
          onclick: () => { remove(COLL, n.id); toast("Nota eliminata"); } }, icon("cestino")),
      ),
      ...corpo,
      mie.length ? el("div.azioni-ai", {}, ...mie.map(renderAzione)) : null,
    );
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
    if (!note.length) {
      nodi.push(prog
        ? vuoto("Nessuna nota in questo progetto", "Tocca + e scrivi o incolla: la nota finisce qui.")
        : vuoto("Il diario è vuoto", "Tocca + e scrivi o detta: un'idea, cosa devi fare, cosa hai speso. Le note sono visibili solo a te."));
    }
    let giorno = null;
    for (const n of note) {
      const g = giornoRelativo(toDate(n.createdAt) || new Date());
      if (g !== giorno) { nodi.push(fascia(g)); giorno = g; }
      nodi.push(nota(n));
    }
    elenco.replaceChildren(...nodi);
  }

  // Note: tutte (le ultime 100) o quelle di un progetto (indice ownerUid + projectId + createdAt).
  let stopNote = () => {};
  function segui() {
    stopNote();
    const extra = filtro !== "tutte" ? [where("projectId", "==", filtro)] : [];
    stopNote = watchMine(COLL, { extra, max: filtro !== "tutte" ? 300 : 100 }, (docs) => {
      note = docs;
      for (const n of docs) if (n.projectId) conNote.add(n.projectId);
      render();
    });
  }
  function scegli(v) {
    if (v === filtro) return;
    filtro = v; scrivi(CHIAVE_FILTRO, v);
    note = []; render(); segui();
  }

  container.append(
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
    // Un progetto archiviato o eliminato non resta come filtro.
    if (filtro !== "tutte" && !docs.some((p) => p.id === filtro && !p.archived)) { scegli("tutte"); return; }
    render();
  });
  const stop2 = watchPending((docs) => { proposte = docs; render(); });
  return () => { stopNote(); stop1(); stop2(); piu.remove(); };
}
