// Task organizzati per progetti (es. Circolo, Casa, Volontariato).
// Personali per impostazione predefinita; un progetto condiviso rende condivisi i suoi task.
//
// projects { name, archived }
// tasks    { text, done, doneAt, due ("AAAA-MM-GG" o null), projectId, people, note }
import { el, icon, toast, fascia, vuoto, sceltaVisibilita, fmtDate, isoGiorno, toDate } from "../../core/ui.js";
import { create, update, remove, watchVisible, readVisible, VIS } from "../../core/db.js";
import { openSheet, campo } from "../../components/sheet.js";

export const id = "task";
export const title = "Task";
export const nav = true;
const navIcon = "task";
export { navIcon as icon };

const TASKS = "tasks";
const PROJ = "projects";
const CHIAVE_PROGETTO = "macroapp.task.progetto";
const norm = (s) => String(s || "").trim().toLowerCase();
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Id del progetto con quel nome; se non esiste lo crea. Usato dalle proposte dell'AI. */
export async function risolviProgetto(nome, visibility = VIS.PRIVATE) {
  if (!nome || !nome.trim()) return null;
  const progetti = await readVisible(PROJ);
  const trovato = progetti.find((p) => norm(p.name) === norm(nome));
  if (trovato) return trovato.id;
  return create(PROJ, { name: cap(nome.trim()), archived: false }, visibility).id;
}

function scadenza(t) {
  if (!t.due) return null;
  const d = new Date(`${t.due}T12:00:00`);
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const tardi = d < oggi && !t.done;
  return { testo: `${tardi ? "scaduto" : "entro"} ${fmtDate(d)}`, tardi };
}

/** Foglio del task. prefill: { text, projectId, due, people, note, visibility } */
export async function apriTask(esistente = null, prefill = {}, progettiNoti = null) {
  const progetti = (progettiNoti || await readVisible(PROJ)).filter((p) => !p.archived);
  const t = esistente || prefill;
  let projectId = t.projectId || null;
  let visibility = t.visibility || progetti.find((p) => p.id === projectId)?.visibility || VIS.PRIVATE;
  let due = t.due || "";

  const testo = el("input.linea-input", { value: t.text || "", placeholder: "Cosa c'è da fare", autofocus: true, enterkeyhint: "done", style: "font-size:19px" });
  testo.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sheet.confirm(); } });

  const sceltaProgetto = el("div.segmenti", { style: "padding-top:0;flex-wrap:wrap" });
  const disegnaProgetti = () => {
    sceltaProgetto.replaceChildren(
      el("button.pillola", { type: "button", class: projectId ? "" : "on", onclick: () => { projectId = null; disegnaProgetti(); } }, "Nessuno"),
      ...progetti.map((p) => el("button.pillola", {
        type: "button", class: p.id === projectId ? "on" : "",
        onclick: () => { projectId = p.id; visibility = p.visibility; disegnaProgetti(); disegnaVis(); },
      }, icon("cartella"), p.name)),
    );
  };
  disegnaProgetti();

  const dataInput = el("input", { type: "date", value: due, style: "position:absolute;opacity:0;pointer-events:none;width:1px;height:1px" });
  const dataBtn = el("button.pillola", { type: "button" });
  const disegnaData = () => dataBtn.replaceChildren(icon("calendario"), due ? fmtDate(new Date(`${due}T12:00:00`)) : "Nessuna scadenza");
  dataBtn.addEventListener("click", () => { try { dataInput.showPicker(); } catch (e) { dataInput.style.pointerEvents = "auto"; dataInput.focus(); } });
  dataInput.addEventListener("change", () => { due = dataInput.value; disegnaData(); });
  disegnaData();
  const togliData = el("button.btn.btn--piatto", { type: "button", onclick: () => { due = ""; dataInput.value = ""; disegnaData(); } }, "Togli");

  const persone = el("input", { value: t.people || "", placeholder: "es. Marco, Giulia del circolo", autocomplete: "off" });
  const nota = el("textarea", { value: t.note || "", placeholder: "Dettagli, link, cosa serve…" });
  const visWrap = el("div");
  const disegnaVis = () => visWrap.replaceChildren(sceltaVisibilita(visibility, (v) => { visibility = v; }));
  disegnaVis();

  const sheet = openSheet({
    title: esistente ? "Modifica task" : "Nuovo task",
    body: [
      el("div.campo", { style: "margin-top:14px" }, testo),
      el("div.campo", {}, el("label", {}, "Progetto"), sceltaProgetto),
      el("div.campo", {}, el("label", {}, "Scadenza"), el("div.segmenti", { style: "padding-top:0;position:relative" }, dataBtn, dataInput, togliData)),
      campo("Persone", persone),
      campo("Note", nota),
      el("div.campo", {}, el("label", {}, "Visibilità"), visWrap),
      esistente ? el("div.foglio__piede", {},
        el("button.btn.btn--pericolo", { onclick: () => { remove(TASKS, esistente.id); sheet.close(); toast("Task eliminato"); } }, icon("cestino"), "Elimina"),
      ) : null,
    ],
    onConfirm: () => {
      const text = testo.value.trim();
      if (!text) { testo.focus(); return false; }
      const dati = { text, projectId, due: due || null, people: persone.value.trim(), note: nota.value.trim() };
      if (esistente) update(TASKS, esistente.id, { ...dati, visibility });
      else create(TASKS, { ...dati, done: false }, visibility);
    },
  });
}

function apriProgetto(esistente = null, onCreato) {
  let visibility = esistente?.visibility || VIS.PRIVATE;
  const nome = el("input.linea-input", { value: esistente?.name || "", placeholder: "Nome del progetto", autofocus: true, enterkeyhint: "done", style: "font-size:19px" });
  nome.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sheet.confirm(); } });
  const sheet = openSheet({
    title: esistente ? "Progetto" : "Nuovo progetto",
    body: [
      el("div.campo", { style: "margin-top:14px" }, nome),
      el("div.campo", {}, el("label", {}, "Visibilità"), sceltaVisibilita(visibility, (v) => { visibility = v; })),
      el("p.meta", {}, "Un progetto condiviso è visibile ai due membri della casa, insieme ai suoi task."),
      esistente ? el("div.foglio__piede", {},
        el("button.btn", { onclick: () => { update(PROJ, esistente.id, { archived: true }); sheet.close(); toast("Progetto archiviato"); } }, "Archivia"),
        el("button.btn.btn--pericolo", { onclick: async () => {
          const legati = await readVisible(TASKS);
          legati.filter((x) => x.projectId === esistente.id).forEach((x) => update(TASKS, x.id, { projectId: null }));
          remove(PROJ, esistente.id); sheet.close(); toast("Progetto eliminato, i task restano");
        } }, icon("cestino"), "Elimina"),
      ) : null,
    ],
    onConfirm: () => {
      const name = nome.value.trim();
      if (!name) return false;
      if (esistente) update(PROJ, esistente.id, { name, visibility });
      else onCreato?.(create(PROJ, { name: cap(name), archived: false }, visibility).id);
    },
  });
}

export function mount(container) {
  let tasks = [];
  let progetti = [];
  let scelto = "tutti";
  let mostraFatti = false;
  try { scelto = localStorage.getItem(CHIAVE_PROGETTO) || "tutti"; } catch (e) {}

  const chips = el("div.segmenti");
  const elenco = el("div");
  const fab = el("button.fab.fab--tondo", { type: "button", "aria-label": "Nuovo task",
    onclick: () => apriTask(null, { projectId: scelto !== "tutti" ? scelto : null }, progetti) }, icon("piu"));

  const scegli = (v) => { scelto = v; try { localStorage.setItem(CHIAVE_PROGETTO, v); } catch (e) {} render(); };

  function rigaTask(t) {
    const s = scadenza(t);
    const sotto = [s?.testo, t.people, t.visibility === VIS.SHARED ? "condiviso" : null].filter(Boolean).join(" · ");
    return el("div.riga", { class: t.done ? "fatta" : "", onclick: () => apriTask(t, {}, progetti) },
      el("div.testo", {},
        el("b", {}, t.text),
        sotto ? el("span", { style: s?.tardi ? "color:var(--frutto)" : null }, sotto) : null,
      ),
      el("button.spunta", {
        type: "button", "aria-label": t.done ? "Riapri" : "Fatto",
        onclick: (e) => { e.stopPropagation(); update(TASKS, t.id, { done: !t.done, doneAt: t.done ? null : new Date() }); },
      }, icon("spunta")),
    );
  }

  const ordina = (a, b) => (a.due || "9999").localeCompare(b.due || "9999")
    || (toDate(a.createdAt)?.getTime() || 0) - (toDate(b.createdAt)?.getTime() || 0);

  function render() {
    const attivi = progetti.filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name));
    if (scelto !== "tutti" && !attivi.some((p) => p.id === scelto)) scelto = "tutti";

    chips.replaceChildren(
      el("button.pillola", { class: scelto === "tutti" ? "on" : "", onclick: () => scegli("tutti") }, "Tutti"),
      ...attivi.map((p) => el("button.pillola", { class: scelto === p.id ? "on" : "", onclick: () => scegli(p.id) }, p.name)),
      el("button.pillola.pillola--accento", { onclick: () => apriProgetto(null, (nuovo) => scegli(nuovo)) }, icon("piu"), "Progetto"),
    );

    const visibili = scelto === "tutti" ? tasks : tasks.filter((t) => t.projectId === scelto);
    const aperti = visibili.filter((t) => !t.done).sort(ordina);
    const fatti = visibili.filter((t) => t.done).sort((a, b) => (toDate(b.doneAt)?.getTime() || 0) - (toDate(a.doneAt)?.getTime() || 0));
    const nodi = [];

    if (scelto !== "tutti") {
      const p = attivi.find((x) => x.id === scelto);
      nodi.push(el("div.segmenti", { style: "padding-top:4px" },
        el("button.btn.btn--piatto", { onclick: () => apriProgetto(p) }, icon("matita"), "Modifica progetto"),
        p.visibility === VIS.SHARED ? el("span.etichetta.etichetta--accento", { style: "align-self:center" }, "condiviso") : null));
      nodi.push(aperti.length ? el("div", {}, ...aperti.map(rigaTask)) : vuoto("Niente da fare qui", "Tocca + per aggiungere un task."));
    } else if (!aperti.length) {
      nodi.push(vuoto("Niente da fare", "Tocca + per aggiungere un task, oppure crea un progetto."));
    } else {
      const perProgetto = new Map();
      for (const t of aperti) {
        const k = attivi.some((p) => p.id === t.projectId) ? t.projectId : "";
        if (!perProgetto.has(k)) perProgetto.set(k, []);
        perProgetto.get(k).push(t);
      }
      for (const p of attivi) {
        if (!perProgetto.has(p.id)) continue;
        nodi.push(fascia(p.name), el("div", {}, ...perProgetto.get(p.id).map(rigaTask)));
      }
      if (perProgetto.has("")) nodi.push(fascia("Senza progetto"), el("div", {}, ...perProgetto.get("").map(rigaTask)));
    }

    if (fatti.length) {
      nodi.push(fascia(`Completati · ${fatti.length}`, el("button", { onclick: () => { mostraFatti = !mostraFatti; render(); } }, mostraFatti ? "Nascondi" : "Mostra")));
      if (mostraFatti) nodi.push(el("div", {}, ...fatti.slice(0, 30).map(rigaTask)));
    }
    elenco.replaceChildren(...nodi);
  }

  container.append(chips, elenco, fab);
  const stop1 = watchVisible(PROJ, {}, (docs) => { progetti = docs; render(); });
  const stop2 = watchVisible(TASKS, {}, (docs) => { tasks = docs; render(); });
  return () => { stop1(); stop2(); fab.remove(); };
}
