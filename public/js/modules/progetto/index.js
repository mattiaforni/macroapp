// Pagina di un progetto con le istruzioni per il diario (es. Tennis): dal menu (gruppo Progetti),
// dal Diario e dai Task filtrati sul progetto. Quale progetto: `macroapp.progetto` (localStorage).
// Tre viste, come pillole:
// - Sintesi: le sezioni della sintesi (components/sintesi.js) come righe per tema, con lo stato e
//   le lezioni in cui il tema è emerso (le note che lo portano in `temi`); una riga si apre sul posto.
// - Lezioni: le note del progetto con il giorno grande, il titolo scritto dall'AI, un'anteprima e i
//   temi; toccandole si legge il riepilogo intero, con la trascrizione ripiegata; da lì Modifica
//   e Rianalizza.
// - Da fare: i task del progetto.
// Il + scrive una nota nel progetto, come nel Diario. Le note restano note del diario: cambia solo
// dove le guardi.
import { el, icon, toast, fascia, vuoto, attesa, toDate, meseLungo, fab, testoRicco } from "../../core/ui.js";
import { create, update, remove, watchMine, watchVisible, VIS, where } from "../../core/db.js";
import { openSheet } from "../../components/sheet.js";
import { watchPending, renderAzione } from "../../components/proposals.js";
import { sezioniSintesi, tonoStato, apriSintesi } from "../../components/sintesi.js";
import { apriNota, analizzaNota, analisiAutomatica, titoloDi } from "../diario/index.js";
import { apriProgetto, rigaTask } from "../task/index.js";
import { vaiA } from "../../core/router.js";

export const id = "progetto";
export const title = "Progetto";
let nomeCorrente = ""; // il titolo in testata è il nome del progetto (lo legge app.js all'arrivo, poi render)
export const titoloCorrente = () => nomeCorrente;
export const nav = false;
const navIcon = "cartella";
export { navIcon as icon };

const NOTE = "journal_entries";
const CHIAVE_PAGINA = "macroapp.progetto";
const CHIAVE_VISTA = "macroapp.progetto.vista"; // "sintesi" | "lezioni" | "dafare"
const CHIAVE_DIARIO = "macroapp.diario.progetto";
const GIORNI = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];

const leggi = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } };
const scrivi = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const norm = (s) => String(s || "").trim().toLowerCase();

/** Anteprima di una nota: le prime voci del riepilogo, in una riga. */
function anteprima(n) {
  const voci = String(n.riepilogo || "").split("\n").map((r) => r.trim())
    .filter((r) => r && !/^#/.test(r)).map((r) => r.replace(/^[-*•]\s+/, "").replace(/\*\*/g, ""));
  const testo = voci.length ? voci.slice(0, 3).join(" · ") : String(n.text || "").replace(/\s+/g, " ");
  return testo.length > 110 ? `${testo.slice(0, 108).trimEnd()}…` : testo;
}

export function mount(container) {
  const progettoId = leggi(CHIAVE_PAGINA, "");
  let progetto = null;
  let note = [];
  let tasks = [];
  let proposte = [];
  let progetti = [];
  let vista = leggi(CHIAVE_VISTA, "sintesi");
  const inCorso = new Set();    // note in analisi
  const temiAperti = new Set(); // righe della sintesi aperte
  const titolo = document.getElementById("page-title");
  const dati = attesa(["progetto", "note", "task"], () => render());

  const testa = el("div");
  const pillole = el("div.segmenti", { style: "padding-top:4px" });
  const corpo = el("div");
  const piu = fab("Nuova nota", () => nuova());

  async function analizza(entryId, attesa) {
    inCorso.add(entryId);
    render();
    await analizzaNota(entryId, attesa);
    inCorso.delete(entryId);
    render();
  }

  function nuova() {
    apriNota({
      progetti, projectId: progetto.id,
      onSalva: ({ text, projectId, createdAt }) => {
        const { id: entryId, saved } = create(NOTE, { text, projectId, analyzed: false, ...(createdAt ? { createdAt } : {}) }, VIS.PRIVATE);
        if (analisiAutomatica()) analizza(entryId, saved);
        if (vista !== "lezioni") scegli("lezioni");
      },
    });
  }

  function modifica(n) {
    apriNota({ esistente: n, progetti, onSalva: (dati) => update(NOTE, n.id, dati) });
  }

  /** Foglio di lettura di una lezione: riepilogo intero, trascrizione ripiegata, Modifica e Rianalizza. */
  function apriLezione(n) {
    const d = toDate(n.createdAt) || new Date();
    const mie = proposte.filter((p) => p.sourceEntryId === n.id);
    let aperta = false;
    const trascrizione = el("div.nota__testo.nota__testo--trascrizione", { hidden: true }, n.text);
    const apri = el("button.nota__apri", { type: "button", "aria-expanded": "false", onclick: () => {
      aperta = !aperta; trascrizione.hidden = !aperta;
      apri.setAttribute("aria-expanded", aperta ? "true" : "false");
      apri.lastChild.textContent = aperta ? "Nascondi la trascrizione" : "Trascrizione";
    } }, icon("giu"), "Trascrizione");
    const sheet = openSheet({
      title: titoloDi(n) || "Lezione",
      body: [
        el("p.meta", { style: "margin-top:12px" }, `${d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}, ${d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`),
        n.temi?.length ? el("div.lezione__temi", {}, ...n.temi.map((t) => el("span.etichetta", {}, t))) : null,
        n.riepilogo
          ? el("div.sintesi-testo.lezione__riepilogo", {}, ...testoRicco(n.riepilogo))
          : el("div.nota__testo", {}, n.text),
        n.riepilogo ? apri : null,
        n.riepilogo ? trascrizione : null,
        mie.length ? el("div.azioni-ai", { style: "margin-top:14px" }, ...mie.map(renderAzione)) : null,
        el("div.foglio__piede", {},
          el("button.btn", { onclick: () => { sheet.close(); analizza(n.id); } }, icon("scintilla"), "Rianalizza"),
          el("button.btn.btn--pericolo", { onclick: () => { remove(NOTE, n.id); sheet.close(); toast("Nota eliminata"); } }, icon("cestino")),
        ),
      ],
      confirmLabel: "Modifica",
      onConfirm: () => { modifica(n); },
    });
  }

  // ───────────── Viste ─────────────

  function notePerTema(nome) {
    const n = norm(nome);
    return note.filter((x) => Array.isArray(x.temi) && x.temi.some((t) => norm(t) === n));
  }

  function vistaSintesi() {
    if (!progetto.sintesi) {
      return [vuoto("Nessuna sintesi ancora", "L'AI la propone dopo la prossima nota analizzata: la trovi sotto la nota, da confermare."),
        el("div", { style: "text-align:center" }, el("button.btn", { onclick: () => apriSintesi(progetto) }, icon("matita"), "Scrivila tu"))];
    }
    const sezioni = sezioniSintesi(progetto.sintesi);
    const nodi = [];
    for (const [i, sez] of sezioni.entries()) {
      const chiave = sez.nome || `#${i}`;
      const lezioni = sez.nome ? notePerTema(sez.nome) : [];
      const aperta = temiAperti.has(chiave) || !sez.nome;
      const tono = tonoStato(sez.stato);
      nodi.push(el("div.tema", { class: aperta ? "tema--aperto" : "" },
        sez.nome ? el("button.tema__testa", { type: "button", "aria-expanded": aperta ? "true" : "false",
          onclick: () => { aperta ? temiAperti.delete(chiave) : temiAperti.add(chiave); render(); } },
          el("span.tema__nome", {}, sez.nome),
          lezioni.length ? el("span.meta", {}, `${lezioni.length} ${lezioni.length === 1 ? "lezione" : "lezioni"}`) : null,
          el("span.spazio"),
          sez.stato ? el("span.tema__stato", { class: tono ? `tema__stato--${tono}` : "" }, sez.stato) : null,
          icon("giu"),
        ) : null,
        aperta ? el("div.sintesi-testo.tema__corpo", { onclick: () => apriSintesi(progetto) }, ...testoRicco(sez.corpo)) : null,
        aperta && lezioni.length ? el("div.tema__lezioni", {},
          ...lezioni.slice(0, 8).map((n) => {
            const d = toDate(n.createdAt) || new Date();
            return el("button.pillola", { type: "button", onclick: () => apriLezione(n) }, `${d.getDate()} ${meseLungo(d).split(" ")[0].slice(0, 3)}`);
          }),
          lezioni.length > 8 ? el("span.meta", { style: "align-self:center" }, `+${lezioni.length - 8}`) : null,
        ) : null,
      ));
    }
    const quando = toDate(progetto.sintesiAt);
    nodi.push(el("div.segmenti", { style: "padding-top:12px;align-items:center" },
      el("button.btn.btn--piatto", { onclick: () => apriSintesi(progetto) }, icon("matita"), "Modifica la sintesi"),
      quando ? el("span.meta", {}, `aggiornata il ${quando.toLocaleDateString("it-IT", { day: "numeric", month: "long" })}`) : null));
    return nodi;
  }

  function rigaLezione(n) {
    const d = toDate(n.createdAt) || new Date();
    const analisi = inCorso.has(n.id);
    return el("button.lezione", { type: "button", onclick: () => apriLezione(n) },
      el("div.lezione__giorno", {}, el("b.display", {}, String(d.getDate())), el("small", {}, GIORNI[d.getDay()])),
      el("div.lezione__testo", {},
        el("div.lezione__titolo", {}, titoloDi(n) || "Senza titolo"),
        el("div.lezione__anteprima", {}, analisi ? "Analizzo…" : anteprima(n)),
        n.temi?.length || (n.analysisError && !n.analyzed)
          ? el("div.lezione__temi", {},
            ...(n.temi || []).map((t) => el("span.etichetta", {}, t)),
            n.analysisError && !n.analyzed ? el("span.etichetta", { style: "color:var(--frutto)" }, "non analizzata") : null)
          : null,
      ),
    );
  }

  function vistaLezioni() {
    if (!note.length) return [!dati.ha("note") ? null : vuoto("Nessuna lezione ancora", "Tocca + e scrivi o detta: la nota finisce in questo progetto.")];
    const nodi = [];
    let mese = null;
    for (const n of note) {
      const m = meseLungo(toDate(n.createdAt) || new Date());
      if (m !== mese) { nodi.push(fascia(m.charAt(0).toUpperCase() + m.slice(1))); mese = m; }
      nodi.push(rigaLezione(n));
    }
    return nodi;
  }

  function vistaDaFare() {
    const aperti = tasks.filter((t) => !t.done).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
    const fatti = tasks.filter((t) => t.done).sort((a, b) => (toDate(b.doneAt)?.getTime() || 0) - (toDate(a.doneAt)?.getTime() || 0));
    const nodi = [];
    if (!aperti.length) { if (dati.ha("task")) nodi.push(vuoto("Niente da fare qui", "I task proposti dalle note finiscono in questo progetto.")); }
    else nodi.push(el("div", {}, ...aperti.map((t) => rigaTask(t, { progetti, conProgetto: false }))));
    if (fatti.length) nodi.push(fascia("Fatti"), el("div", {}, ...fatti.slice(0, 20).map((t) => rigaTask(t, { progetti, conProgetto: false }))));
    return nodi;
  }

  function scegli(v) {
    vista = v; scrivi(CHIAVE_VISTA, v);
    render();
  }

  function render() {
    if (!progetto || !dati.pronta()) return;
    nomeCorrente = progetto.name;
    if (titolo) titolo.textContent = progetto.name;
    // Il colore del progetto: sulla pagina e, per il titolo e il +, su <html>.
    if (progetto.colore) document.documentElement.dataset.colore = progetto.colore; else delete document.documentElement.dataset.colore;
    container.classList.add("pagina-progetto");
    const aperti = tasks.filter((t) => !t.done).length;
    const riga = [
      `${note.length} ${note.length === 1 ? "lezione" : "lezioni"}`,
      aperti ? `${aperti} da fare` : null,
      progetto.visibility === VIS.SHARED ? "condiviso" : null,
    ].filter(Boolean).join(" · ");
    testa.replaceChildren(el("div.progetto__riga", {},
      el("span.meta", {}, riga),
      el("span.spazio"),
      el("button.btn.btn--piatto", { onclick: () => { scrivi(CHIAVE_DIARIO, progetto.id); vaiA("diario"); } }, icon("diario"), "Diario"),
      el("button.tondo.tondo--piatto", { "aria-label": "Modifica progetto", onclick: () => apriProgetto(progetto) }, icon("matita")),
    ));
    const pillola = (v, testo) => el("button.pillola", { type: "button", class: vista === v ? "on" : "", onclick: () => scegli(v) }, testo);
    pillole.replaceChildren(pillola("sintesi", "Sintesi"), pillola("lezioni", "Lezioni"), pillola("dafare", "Da fare"));
    corpo.replaceChildren(...(vista === "sintesi" ? vistaSintesi() : vista === "lezioni" ? vistaLezioni() : vistaDaFare()).filter(Boolean));
  }

  container.append(testa, pillole, corpo, piu);

  if (!progettoId) {
    container.replaceChildren(vuoto("Nessun progetto scelto", "Apri un progetto dal menu, dal Diario o dai Task."));
    return () => {};
  }
  const stop1 = watchVisible("projects", {}, (docs) => {
    progetti = docs;
    const p = docs.find((x) => x.id === progettoId);
    if (!p) {
      if (progetto) { vaiA("task"); return; }
      container.replaceChildren(vuoto("Progetto non trovato", "Forse è stato eliminato."));
      piu.remove();
      return;
    }
    progetto = p;
    dati.arriva("progetto");
    render();
  });
  const stop2 = watchMine(NOTE, { extra: [where("projectId", "==", progettoId)], max: 300 }, (docs) => { note = docs; dati.arriva("note"); render(); });
  const stop3 = watchVisible("tasks", {}, (docs) => { tasks = docs.filter((t) => t.projectId === progettoId); dati.arriva("task"); render(); });
  const stop4 = watchPending((docs) => { proposte = docs; render(); });
  return () => { dati.ferma(); stop1(); stop2(); stop3(); stop4(); piu.remove(); delete document.documentElement.dataset.colore; container.classList.remove("pagina-progetto"); };
}
