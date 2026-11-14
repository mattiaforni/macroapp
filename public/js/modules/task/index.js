// Task organizzati per progetti (es. Circolo, Casa, Volontariato), con le persone coinvolte
// prese dalla rubrica del manuale. Personali per impostazione predefinita; un progetto
// condiviso rende condivisi i suoi task.
//
// projects { name, archived, istruzioni, sintesi, sintesiAt, colore, documenti }
//          istruzioni = per l'agente del diario: con queste, ogni nota del progetto riceve un riepilogo
//          sintesi = lo stato del progetto, proposto dall'agente e confermato; si legge in modules/progetto
//          documenti = file di Google Drive [{ id, nome, mime, link }] che l'agente legge come contesto
// tasks    { text, done, doneAt, due ("AAAA-MM-GG" o null), projectId, peopleIds[], people, note }
//          people = nomi delle persone in chiaro, copia di peopleIds per chi non vede la voce in rubrica
import { el, icon, toast, fascia, vuoto, attesa, sceltaVisibilita, sceltaColore, fmtDate, meseBreve, isoGiorno, toDate, fab, pillolaProgetto } from "../../core/ui.js";
import { create, update, remove, watchVisible, readVisible, VIS } from "../../core/db.js";
import { allineaProgetto } from "../../core/note.js";
import { session } from "../../core/auth.js";
import { openSheet, campo } from "../../components/sheet.js";
import { sceltaPersone } from "../../components/persone.js";
import { sceltaDocumenti } from "../../components/documenti.js";
import { pulsanteRegistra } from "../../components/registratore.js";
import { nomiTask, suRubrica, personaDaId, modiDiContatto, canaleDa } from "../../core/rubrica.js";
import { vaiA } from "../../core/router.js";
import { apriPaginaProgetto } from "../../core/barra.js";

export const id = "task";
export const title = "Task";
export const nav = true;
const navIcon = "task";
export { navIcon as icon };

const TASKS = "tasks";
const PROJ = "projects";
const CHIAVE_PROGETTO = "macroapp.task.progetto";
const CHIAVE_DIARIO = "macroapp.diario.progetto"; // filtro del Diario (lo legge modules/diario)
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

/**
 * Fascia di tempo di un task aperto e cosa scrivere nella colonna del giorno a sinistra (come nel Diario e nel
 * Calendario, 5/11: numero in serif e sotto «oggi», il giorno della settimana entro una settimana, altrimenti il mese).
 * La data non si ripete più nel testo della riga: la dicono la colonna e la fascia.
 */
const FASCE = ["In ritardo", "Oggi", "Prossimi 7 giorni", "Più avanti", "Senza scadenza"];
const GIORNI_BREVI = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
function quando(t) {
  if (!t.due) return { fascia: "Senza scadenza", giorno: null };
  const oggi = isoGiorno(new Date());
  const d = new Date(`${t.due}T12:00:00`);
  if (t.due < oggi) return { fascia: "In ritardo", giorno: { d, sotto: meseBreve(d) }, tardi: true };
  if (t.due === oggi) return { fascia: "Oggi", giorno: { d, sotto: "oggi" } };
  const tra7 = new Date(); tra7.setDate(tra7.getDate() + 7);
  if (t.due <= isoGiorno(tra7)) return { fascia: "Prossimi 7 giorni", giorno: { d, sotto: GIORNI_BREVI[d.getDay()] } };
  return { fascia: "Più avanti", giorno: { d, sotto: meseBreve(d) } };
}

/** Colonna del giorno di una riga di task; vuota (ma della stessa larghezza) senza data o se il giorno è quello della riga sopra. */
function colonnaGiorno(g, tardi) {
  return el("div.riga__giorno", { class: tardi ? "tardi" : "" }, g ? [el("b.display", {}, String(g.d.getDate())), el("small", {}, g.sotto)] : null);
}

/** Link che apre l'app giusta (telefono, WhatsApp, Telegram, mail) senza aprire il task. */
function linkContatto(m, nome, classe = "a.tondo") {
  const web = m.href.startsWith("http");
  return el(classe, {
    href: m.href, target: web ? "_blank" : null, rel: web ? "noopener" : null,
    "aria-label": `${m.etichetta} ${nome}`, title: `${m.etichetta} ${nome}`,
    onclick: (e) => e.stopPropagation(),
  }, icon(m.icona), classe.startsWith("a.pillola") ? m.etichetta : null);
}

/** Scorciatoia nella riga: se il task dice di chiamare/scrivere e la persona ha i recapiti. */
function scorciatoia(t) {
  if (t.done) return null;
  const canale = canaleDa(t.text);
  if (!canale) return null;
  for (const id of t.peopleIds || []) {
    const p = personaDaId(id);
    const modi = modiDiContatto(p);
    const m = modi.find((x) => x.canale === canale) || modi[0];
    if (m) return linkContatto(m, p.name);
  }
  return null;
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
      ...progetti.map((p) => pillolaProgetto(p, {
        on: p.id === projectId,
        onclick: () => { projectId = p.id; visibility = p.visibility; disegnaProgetti(); disegnaVis(); },
      })),
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
      // Subito sotto il progetto, che la imposta: così si vede con la tastiera aperta, senza scorrere.
      el("div.campo", {}, el("label", {}, "Visibilità"), visWrap),
      el("div.campo", {}, el("label", {}, "Scadenza"), el("div.segmenti", { style: "padding-top:0;position:relative" }, dataBtn, dataInput, togliData)),
      el("div.campo", {}, el("label", {}, "Persone"), persone.node),
      // Recapiti delle persone già collegate: un tocco per chiamare o scrivere.
      ...(t.peopleIds || []).map(personaDaId).filter((p) => modiDiContatto(p).length).map((p) =>
        el("div.segmenti", { style: "padding-top:0;margin:-8px 0 14px;flex-wrap:wrap;align-items:center" },
          el("span.meta", { style: "margin-right:4px" }, p.name),
          ...modiDiContatto(p).filter((m) => m.canale !== "sms").map((m) => linkContatto(m, p.name, "a.pillola")))),
      campo("Note", nota),
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

/** Foglio del progetto: nome, visibilità, istruzioni per l'agente del diario, documenti di Drive. Invio sul nome salva. */
export function apriProgetto(esistente = null, onCreato) {
  let visibility = esistente?.visibility || VIS.PRIVATE;
  let colore = esistente?.colore || "";
  const nome = el("input.linea-input", { value: esistente?.name || "", placeholder: "Nome del progetto", autofocus: true, enterkeyhint: "done", style: "font-size:19px" });
  nome.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sheet.confirm(); } });
  const istruzioni = el("textarea", {
    value: esistente?.istruzioni || "", rows: 5,
    placeholder: "Es. Riassumi cosa mi ha insegnato il maestro, cosa ha funzionato, cosa no, cosa ricordare la prossima volta.",
  });
  const documenti = sceltaDocumenti({ documenti: esistente?.documenti || [], perAgente: true });
  const sheet = openSheet({
    title: esistente ? "Progetto" : "Nuovo progetto",
    body: [
      el("div.campo", { style: "margin-top:14px" }, nome),
      el("div.campo", {}, el("label", {}, "Visibilità"), sceltaVisibilita(visibility, (v) => { visibility = v; })),
      el("p.meta", { style: "margin:-8px 0 18px" }, "Un progetto condiviso è visibile ai due membri della casa, insieme ai suoi task e alle note del diario che ci scrivete."),
      campo("Istruzioni per il diario", istruzioni),
      // Le istruzioni si possono dettare come una nota (29/10, richiesta di Mattia): la trascrizione si aggiunge al campo.
      el("div.segmenti", { style: "margin-top:-10px;padding-top:0" }, pulsanteRegistra({
        cosa: "le istruzioni",
        progetto: () => esistente?.id || null,
        // Il testo di una registrazione, a «Ferma»: staccato da ciò che c'era.
        inserisci: (testo, { primo = true, aCapo = true } = {}) => {
          const prima = istruzioni.value.trimEnd();
          istruzioni.value = !prima ? testo : `${prima}${primo || aCapo ? "\n\n" : " "}${testo}`;
          istruzioni.dispatchEvent(new Event("input", { bubbles: true }));
        },
      })),
      el("p.meta", {}, "Facoltative, scritte o dettate. Con le istruzioni, l'AI scrive un riepilogo di ogni nota del diario di questo progetto e ti propone la sintesi aggiornata del progetto."),
      documenti.node,
      el("p.meta", { style: "margin-top:-6px" }, "Facoltativi. L'agente legge Documenti, Fogli, Presentazioni e file di testo di Google come contesto quando analizza una nota del progetto (con le istruzioni); degli altri formati tiene solo il nome."),
      el("div.campo", { style: "margin-top:18px" }, el("label", {}, "Colore della pagina"), sceltaColore(colore, (c) => { colore = c; })),
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
      if (!name) { nome.focus(); return false; }
      const dati = { name, istruzioni: istruzioni.value.trim(), colore, documenti: documenti.valore() };
      if (esistente) {
        update(PROJ, esistente.id, { ...dati, visibility });
        // Le tue note del progetto seguono la sua visibilità (7/11: le note dei progetti condivisi sono della casa). Solo
        // chi ha creato il progetto può cambiarla (regole): per l'altra persona la modifica non passa, e le note restano.
        const cambiata = visibility !== (esistente.visibility || VIS.PRIVATE);
        if (cambiata && esistente.ownerUid === session.user.uid) allineaProgetto(esistente.id, visibility).catch((e) => console.warn("note del progetto", e));
      }
      else onCreato?.(create(PROJ, { ...dati, name: cap(name), archived: false }, visibility).id);
    },
  });
}

/**
 * Riga di un task: testo, e sotto in piccolo il progetto (se si guardano tutti i progetti),
 * la data quando la fascia non basta, le persone. Esportata: la usa anche la scheda di una persona.
 */
export function rigaTask(t, { progetti = [], conProgetto = true, conGiorno = true, apri } = {}) {
  const fatto = t.done ? toDate(t.doneAt) : null;
  const q = t.done ? { giorno: fatto ? { d: fatto, sotto: meseBreve(fatto) } : null } : quando(t);
  const p = conProgetto ? progetti.find((x) => x.id === t.projectId && !x.archived) : null;
  const resto = [nomiTask(t), t.visibility === VIS.SHARED && p?.visibility !== VIS.SHARED ? "condiviso" : null].filter(Boolean);
  const sotto = [];
  if (p) sotto.push(el("small.progetto", {}, p.name));
  if (p && resto.length) sotto.push(" · ");
  if (resto.length) sotto.push(resto.join(" · "));
  return el("div.riga.riga--task", { class: t.done ? "fatta" : "", onclick: () => (apri ? apri(t) : apriTask(t, {}, progetti)) },
    colonnaGiorno(conGiorno ? q.giorno : null, q.tardi),
    el("div.testo", {},
      el("b", {}, t.text),
      sotto.length ? el("span", {}, ...sotto) : null,
    ),
    scorciatoia(t),
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
  // La pagina compare con task e progetti insieme: senza i progetti il filtro scelto sembrerebbe
  // sparito e si vedrebbe «Niente da fare» prima dei task.
  const dati = attesa(["task", "progetti"], () => render());

  const chips = el("div.segmenti");
  const elenco = el("div");
  const piu = fab("Nuovo task", () => apriTask(null, { projectId: scelto !== "tutti" ? scelto : null }, progetti));

  const scegli = (v) => { scelto = v; try { localStorage.setItem(CHIAVE_PROGETTO, v); } catch (e) {} render(); };

  const ordina = (a, b) => (a.due || "9999").localeCompare(b.due || "9999")
    || (toDate(a.createdAt)?.getTime() || 0) - (toDate(b.createdAt)?.getTime() || 0);

  function render() {
    if (!dati.pronta()) return;
    const attivi = progetti.filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name));
    if (scelto !== "tutti" && dati.ha("progetti") && !attivi.some((p) => p.id === scelto)) scelto = "tutti";

    chips.replaceChildren(
      el("button.pillola", { class: scelto === "tutti" ? "on" : "", onclick: () => scegli("tutti") }, "Tutti"),
      ...attivi.map((p) => pillolaProgetto(p, { on: scelto === p.id, onclick: () => scegli(p.id) })),
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
        // Le note del diario di questo progetto: si aprono nel Diario, già filtrato.
        el("button.btn.btn--piatto", { onclick: () => { try { localStorage.setItem(CHIAVE_DIARIO, p.id); } catch (e) {} vaiA("diario"); } }, icon("diario"), "Diario"),
        p.istruzioni ? el("button.btn.btn--piatto", { onclick: () => apriPaginaProgetto(p.id) }, icon("cartella"), "Progetto") : null,
        p.visibility === VIS.SHARED ? el("span.etichetta.etichetta--accento", { style: "align-self:center" }, "condiviso") : null));
    }

    if (!aperti.length && dati.ha("task")) {
      nodi.push(scelto === "tutti"
        ? vuoto("Niente da fare", "Tocca + per aggiungere un task.")
        : vuoto("Niente da fare qui", "Tocca + per aggiungere un task a questo progetto."));
    } else {
      // Un solo elenco per tutti i progetti, diviso per quando vanno fatte le cose.
      // Il numero del giorno solo sulla prima riga del giorno, come nel Diario (i task sono in ordine di data).
      for (const f of FASCE) {
        const qui = aperti.filter((t) => quando(t).fascia === f);
        if (qui.length) nodi.push(fascia(f), el("div", {}, ...qui.map((t, i) => rigaTask(t, { ...opzioni, conGiorno: !i || t.due !== qui[i - 1].due }))));
      }
    }

    if (fatti.length) {
      nodi.push(fascia(`Completati · ${fatti.length}`, el("button", { onclick: () => { mostraFatti = !mostraFatti; render(); } }, mostraFatti ? "Nascondi" : "Mostra")));
      if (mostraFatti) nodi.push(el("div", {}, ...fatti.slice(0, 30).map((t) => rigaTask(t, opzioni))));
    }
    elenco.replaceChildren(...nodi);
  }

  container.append(chips, elenco, piu);
  const stop1 = watchVisible(PROJ, {}, (docs) => { progetti = docs; dati.arriva("progetti"); render(); });
  const stop2 = watchVisible(TASKS, {}, (docs) => { tasks = docs; dati.arriva("task"); render(); });
  const stop3 = suRubrica(render); // nomi delle persone aggiornati se cambiano in rubrica
  return () => { stop1(); stop2(); stop3(); dati.ferma(); piu.remove(); };
}
