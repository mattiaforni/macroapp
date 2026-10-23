// Diario: scrivi o detta (microfono della tastiera). Le note sono sempre solo tue.
// Con l'AI collegata, ogni nota salvata viene letta dall'agente, che propone sotto di essa
// le azioni che contiene: task, voci per la lista, spese, voci del manuale, bozze di mail.
// Niente entra nell'app senza la tua spunta.
//
// journal_entries { text, analyzed, analyzedAt, analysisError }
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-functions.js";
import { functions } from "../../core/firebase.js";
import { el, icon, toast, fascia, vuoto, toDate, giornoRelativo } from "../../core/ui.js";
import { create, update, remove, watchMine, readVisible, VIS } from "../../core/db.js";
import { watchPending, renderAzione } from "../../components/proposals.js";
import { aggiungiVoci } from "../lista/index.js";
import { apriTask } from "../task/index.js";
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
const analyzeEntry = httpsCallable(functions, "analyzeEntry");

const leggi = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } };
const scrivi = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

export function mount(container) {
  let note = [];
  let proposte = [];
  const inCorso = new Set(); // note in analisi
  let auto = leggi(CHIAVE_AUTO, "1") === "1";

  const area = el("textarea", { placeholder: "Scrivi o detta…", rows: 4 });
  const condiviso = sessionStorage.getItem("macroapp.share");
  if (condiviso) { area.value = condiviso; sessionStorage.removeItem("macroapp.share"); }

  const stato = el("div.stato-ai");
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

  async function analizza(entryId, attesa) {
    inCorso.add(entryId);
    render();
    try {
      if (attesa) await attesa;
      const res = await analyzeEntry({ entryId });
      const n = res.data?.proposals ?? 0;
      scrivi(CHIAVE_AI, "on");
      update(COLL, entryId, { analyzed: true, analyzedAt: new Date(), analysisError: null });
      if (!n) toast("Nessuna azione da proporre");
    } catch (err) {
      console.warn("analisi", err);
      scrivi(CHIAVE_AI, "off");
      update(COLL, entryId, { analysisError: err.code || err.message || "errore" });
      toast("Analisi non riuscita: la nota è salvata");
    } finally {
      inCorso.delete(entryId);
      disegnaStato();
      render();
    }
  }

  function salva() {
    const text = area.value.trim();
    if (!text) { area.focus(); return; }
    area.value = "";
    const { id: entryId, saved } = create(COLL, { text, analyzed: false }, VIS.PRIVATE);
    if (auto) analizza(entryId, saved);
  }

  // Trasforma a mano il testo scritto in un elemento, senza passare dall'AI.
  function trasforma(tipo) {
    const text = area.value.trim();
    if (!text) { toast("Scrivi prima qualcosa"); area.focus(); return; }
    if (tipo === "lista") {
      readVisible("shopping_items", { order: ["createdAt", "asc"] }).then((voci) => aggiungiVoci(text, voci));
      toast("Aggiunto alla lista"); area.value = ""; return;
    }
    if (tipo === "task") apriTask(null, { text });
    if (tipo === "spesa") {
      const m = text.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|euro)?/i);
      apriSpesa(null, { description: text.replace(m?.[0] || "", "").replace(/\s+/g, " ").trim(), amount: m ? m[1] : "" });
    }
    if (tipo === "manuale") apriVoceManuale(null, { name: text });
  }

  const azioniVeloci = el("div.segmenti", { style: "padding-top:8px" },
    el("button.pillola", { type: "button", onclick: () => trasforma("task") }, icon("task"), "Task"),
    el("button.pillola", { type: "button", onclick: () => trasforma("lista") }, icon("lista"), "Lista"),
    el("button.pillola", { type: "button", onclick: () => trasforma("spesa") }, icon("spese"), "Spesa"),
    el("button.pillola", { type: "button", onclick: () => trasforma("manuale") }, icon("negozio"), "Manuale"),
  );

  const elenco = el("div");

  function nota(n) {
    const d = toDate(n.createdAt) || new Date();
    const mie = proposte.filter((p) => p.sourceEntryId === n.id);
    const analisi = inCorso.has(n.id);
    return el("div.nota", {},
      el("div.nota__testa", {},
        el("span", {}, d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })),
        n.analyzed && !mie.length ? el("span", {}, "· analizzata") : null,
        n.analysisError && !n.analyzed ? el("span", { style: "color:var(--frutto)" }, "· analisi non riuscita") : null,
        el("span.spazio"),
        el("button.btn.btn--piatto", { disabled: analisi, onclick: () => analizza(n.id) },
          icon("scintilla"), analisi ? "Analizzo…" : n.analyzed ? "Rianalizza" : "Analizza"),
        el("button.tondo.tondo--piatto", { "aria-label": "Elimina nota",
          onclick: () => { remove(COLL, n.id); toast("Nota eliminata"); } }, icon("cestino")),
      ),
      el("div.nota__testo", {}, n.text),
      mie.length ? el("div.azioni-ai", {}, ...mie.map(renderAzione)) : null,
    );
  }

  function render() {
    if (!note.length) {
      elenco.replaceChildren(vuoto("Il diario è vuoto", "Scrivi o detta qualcosa: un'idea, cosa devi fare, cosa hai speso. Le note sono visibili solo a te."));
      return;
    }
    const nodi = [];
    let giorno = null;
    for (const n of note) {
      const g = giornoRelativo(toDate(n.createdAt) || new Date());
      if (g !== giorno) { nodi.push(fascia(g)); giorno = g; }
      nodi.push(nota(n));
    }
    elenco.replaceChildren(...nodi);
  }

  container.append(
    el("div.taccuino", {},
      area,
      el("p.meta", { style: "margin-top:6px" }, "Per la voce usa il microfono della tastiera."),
      el("div.taccuino__azioni", {},
        autoBtn,
        el("button.btn.btn--primario", { type: "button", onclick: salva }, "Salva nota"),
      ),
      azioniVeloci,
      stato,
    ),
    elenco,
  );

  const stop1 = watchMine(COLL, { max: 100 }, (docs) => { note = docs; render(); });
  const stop2 = watchPending((docs) => { proposte = docs; render(); });
  return () => { stop1(); stop2(); };
}
