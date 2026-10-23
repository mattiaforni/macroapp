// Task organizzati per progetti (es. Circolo, Casa, Volontariato), con le persone coinvolte
// prese dalla rubrica del manuale. Personali per impostazione predefinita; un progetto
// condiviso rende condivisi i suoi task.
//
// projects { name, archived }
// tasks    { text, done, doneAt, due ("AAAA-MM-GG" o null), projectId, peopleIds[], people, note }
//          people = nomi delle persone in chiaro, copia di peopleIds per chi non vede la voce in rubrica
import { el, icon, toast, fascia, vuoto, sceltaVisibilita, fmtDate, isoGiorno, toDate, fab } from "../../core/ui.js";
import { create, update, remove, watchVisible, readVisible, VIS } from "../../core/db.js";
import { openSheet, campo } from "../../components/sheet.js";
import { sceltaPersone } from "../../components/persone.js";
import { nomiTask, suRubrica } from "../../core/rubrica.js";

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
const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];

/** Id del progetto con quel nome; se non esiste lo crea. Usato dalle proposte dell'AI. */
export async function risolviProgetto(nome, visibility = VIS.PRIVATE) {
  if (!nome || !nome.trim()) return null;
  const progetti = await readVisible(PROJ);
  const trovato = progetti.find((p) => norm(p.name) === norm(nome));
  if (trovato) return trovato.id;
  return create(PROJ, { name: cap(nome.trim()), archived: false }, visibility).id;
}

/** Fascia di tempo di un task aperto, e la data da scrivere nella riga (null se la dice già la fascia). */
const FASCE = ["In ritardo", "Oggi", "Prossimi 7 giorni", "Più avanti", "Senza scadenza"];
function quando(t) {
  if (!t.due) return { fascia: "Senza scadenza", testo: null };
  const oggi = isoGiorno(new Date());
  const d = new Date(`${t.due}T12:00:00`);
  if (t.due < oggi) return { fascia: "In ritardo", testo: `era per il ${fmtDate(d)}`, tardi: true };
  if (t.due === oggi) return { fascia: "Oggi", testo: null };
  const tra7 = new Date(); tra7.setDate(tra7.getDate() + 7);
  if (t.due <= isoGiorno(tra7)) {
    const domani = new Date(); domani.setDate(domani.getDate() + 1);
    return { fascia: "Prossimi 7 giorni", testo: t.due === isoGiorno(domani) ? "domani" : GIORNI[d.getDay()] };
  }
  return { fascia: "Più avanti", testo: fmtDate(d) };
}

/** Foglio del task. prefill: { text, projectId, due, people, peopleIds, note, visibility }
 *  Invio sul testo salva: è l'unico campo obbligatorio. */
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
      }, p.name)),
    );
  };
  disegnaProgetti();

  const dataInput = el("input", { type: "date", value: due, style: "position:absolute;opacity:0;pointer-events:none;width:1px;height:1px" });
  const dataBtn = el("button.pillola", { type: "button" });
  const togliData = el("button.btn.btn--piatto", { type: "button", onclick: () => { due = ""; dataInput.value = ""; disegnaData(); } }, "Togli");
  const disegnaData = () => {
    dataBtn.replaceChildren(icon("calendario"), due ? fmtDate(new Date(`${due}T12:00:00`)) : "Nessuna scadenza");
    togliData.hidden = !due;
  };
  dataBtn.addEventListener("click", () => { try { dataInput.showPicker(); } catch (e) { dataInput.style.pointerEvents = "auto"; dataInput.focus(); } });
  dataInput.addEventListener("change", () => { due = dataInput.value; disegnaData(); });
  disegnaData();

  const persone = sceltaPersone({ ids: t.peopleIds || [], testo: t.people || "", onInvioVuoto: () => sheet.confirm() });
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
      el("div.campo", {}, el("label", {}, "Persone"), persone.node),
      campo("Note", nota),
      el("div.campo", {}, el("label", {}, "Visibilità"), visWrap),
      esistente ? el("div.foglio__piede", {},
        el("button.btn.btn--pericolo", { onclick: () => { remove(TASKS, esistente.id); sheet.close(); toast("Task eliminato"); } }, icon("cestino"), "Elimina"),
      ) : null,
    ],
    onConfirm: () => {
      const text = testo.value.trim();
      if (!text) { testo.focus(); return false; }
      const dati = { text, projectId, due: due || null, ...persone.valore(visibility), note: nota.value.trim() };
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

/**
 * Riga di un task: testo, e sotto in piccolo il progetto (se si guardano tutti i progetti),
 * la data quando la fascia non basta, le persone. Esportata: la usa anche la scheda di una persona.
 */
export function rigaTask(t, { progetti = [], conProgetto = true, apri } = {}) {
  const q = t.done ? { testo: t.doneAt ? `fatto il ${fmtDate(t.doneAt)}` : null } : quando(t);
  const p = conProgetto ? progetti.find((x) => x.id === t.projectId && !x.archived) : null;
  const resto = [q.testo, nomiTask(t), t.visibility === VIS.SHARED && p?.visibility !== VIS.SHARED ? "condiviso" : null].filter(Boolean);
  const sotto = [];
  if (p) sotto.push(el("small.progetto", {}, p.name));
  if (p && resto.length) sotto.push(" · ");
  if (resto.length) sotto.push(resto.join(" · "));
  return el("div.riga", { class: t.done ? "fatta" : "", onclick: () => (apri ? apri(t) : apriTask(t, {}, progetti)) },
    el("div.testo", {},
      el("b", {}, t.text),
      sotto.length ? el("span", { class: q.tardi ? "tardi" : "" }, ...sotto) : null,
    ),
    el("button.spunta", {
      type: "button", "aria-label": t.done ? "Riapri" : "Fatto",
      onclick: (e) => { e.stopPropagation(); update(TASKS, t.id, { done: !t.done, doneAt: t.done ? null : new Date() }); },
    }, icon("spunta")),
  );
}

export function mount(container) {
  let tasks = [];
  let progetti = [];
  let scelto = "tutti";
  let mostraFatti = false;
  try { scelto = localStorage.getItem(CHIAVE_PROGETTO) || "tutti"; } catch (e) {}

  const chips = el("div.segmenti");
  const elenco = el("div");
  const piu = fab("Nuovo task", () => apriTask(null, { projectId: scelto !== "tutti" ? scelto : null }, progetti));

  const scegli = (v) => { scelto = v; try { localStorage.setItem(CHIAVE_PROGETTO, v); } catch (e) {} render(); };

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
    const opzioni = { progetti, conProgetto: scelto === "tutti" };
    const nodi = [];

    if (scelto !== "tutti") {
      const p = attivi.find((x) => x.id === scelto);
      nodi.push(el("div.segmenti", { style: "padding-top:4px" },
        el("button.btn.btn--piatto", { onclick: () => apriProgetto(p) }, icon("matita"), "Modifica progetto"),
        p.visibility === VIS.SHARED ? el("span.etichetta.etichetta--accento", { style: "align-self:center" }, "condiviso") : null));
    }

    if (!aperti.length) {
      nodi.push(scelto === "tutti"
        ? vuoto("Niente da fare", "Tocca + per aggiungere un task.")
        : vuoto("Niente da fare qui", "Tocca + per aggiungere un task a questo progetto."));
    } else {
      // Un solo elenco per tutti i progetti, diviso per quando vanno fatte le cose.
      for (const f of FASCE) {
        const qui = aperti.filter((t) => quando(t).fascia === f);
        if (qui.length) nodi.push(fascia(f), el("div", {}, ...qui.map((t) => rigaTask(t, opzioni))));
      }
    }

    if (fatti.length) {
      nodi.push(fascia(`Completati · ${fatti.length}`, el("button", { onclick: () => { mostraFatti = !mostraFatti; render(); } }, mostraFatti ? "Nascondi" : "Mostra")));
      if (mostraFatti) nodi.push(el("div", {}, ...fatti.slice(0, 30).map((t) => rigaTask(t, opzioni))));
    }
    elenco.replaceChildren(...nodi);
  }

  container.append(chips, elenco, piu);
  const stop1 = watchVisible(PROJ, {}, (docs) => { progetti = docs; render(); });
  const stop2 = watchVisible(TASKS, {}, (docs) => { tasks = docs; render(); });
  const stop3 = suRubrica(render); // nomi delle persone aggiornati se cambiano in rubrica
  return () => { stop1(); stop2(); stop3(); piu.remove(); };
}
