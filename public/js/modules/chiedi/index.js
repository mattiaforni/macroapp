// Chiedi (14/11, dall'analisi dell'app: «l'AI va in una sola direzione»): domande sui propri dati, a cui l'AI risponde
// cercando nelle note, nelle spese, nei task, nel calendario, nei progetti e nel manuale (functions/src/chiedi.js).
// Si apre dal menu (Casa), dal punto di domanda in testata del Diario, o si mette nella barra in basso.
//
// Come le altre pagine: le domande fatte, come righe del Diario (giorno a sinistra, domanda, inizio della risposta), e
// il + in basso a destra per una domanda nuova. Invio chiede. La risposta si legge nel foglio della domanda, con le
// fonti sotto (toccandole si apre la nota, la spesa, il task…) e un campo in fondo per continuare.
// Stato e risposta li scrive il server sul documento (domande/{id}): «Cerco nelle note…» si vede su ogni telefono, e
// se il telefono si blocca la risposta arriva lo stesso. La domenica sera lì compare anche la revisione della
// settimana (tipo «settimana», functions/src/settimana.js), che la notifica apre (#/chiedi/<id>).
//
// domande/{id} = { tipo: "domanda" | "settimana", turni: [{ domanda, risposta?, fonti?: [{ tipo, id, titolo, sotto,
//   calId? }], modello?, at }], stato: "nuova" | "in_corso" | "fatta" | "errore", inizio?, passi: [string], errore? }
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-functions.js";
import { functions } from "../../core/firebase.js";
import { el, icon, toast, fascia, vuoto, attesa, toDate, meseLungo, isoGiorno, stessoGiorno, fab, testoRicco } from "../../core/ui.js";
import { openSheet } from "../../components/sheet.js";
import { create, update, remove, watchMine, leggiUno, seguiUno, VIS } from "../../core/db.js";
import { vaiA, richiestaPer } from "../../core/router.js";
import { apriPaginaProgetto } from "../../core/barra.js";
import { nomeModello } from "../../core/modelli.js";
import { pulsanteRegistra } from "../../components/registratore.js";

export const id = "chiedi";
export const title = "Chiedi";
export const nav = false;
const navIcon = "domanda";
export { navIcon as icon };

const COLL = "domande";
const chiediFn = httpsCallable(functions, "chiedi", { timeout: 310000 }); // la function ha 300 s
const IN_CORSO_MS = 300_000; // come IN_CORSO_MS in functions/src/chiedi.js: oltre, una risposta «in corso» è morta
const GIORNI = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
const ESEMPI = [
  "Cosa mi ha detto il maestro sul rovescio?",
  "Quanto abbiamo speso al supermercato questo mese?",
  "Cosa ho da fare questa settimana?",
  "Quando è venuto l'idraulico l'ultima volta?",
];

/** La risposta dell'ultimo turno è in arrivo (dal server, da qualunque telefono). */
const ultimo = (d) => (d?.turni || [])[(d?.turni || []).length - 1] || null;
const NUOVA_MS = 90_000; // una domanda che il server non ha preso entro questo tempo (telefono senza rete) è da riprovare
export function inCorso(d) {
  if (d?.stato === "nuova") { const t = toDate(ultimo(d)?.at); return !t || Date.now() - t.getTime() < NUOVA_MS; }
  if (d?.stato !== "in_corso") return false;
  const t = toDate(d.inizio);
  return !t || Date.now() - t.getTime() < IN_CORSO_MS; // senza `inizio`: il server l'ha appena segnata
}
const morta = (d) => (d?.stato === "in_corso" || d?.stato === "nuova") && !inCorso(d);

/** Manda la domanda al server; lo stato e la risposta arrivano sul documento. */
async function avvia(idDomanda) {
  try {
    await chiediFn({ id: idDomanda });
  } catch (err) {
    console.warn("chiedi", err);
    // Risposta persa per strada (telefono bloccato, rete): il server finisce lo stesso e scrive sul documento.
    const persa = /^(functions\/)?(internal|deadline-exceeded|unavailable|cancelled|unknown)$/.test(err.code || "")
      && /^(internal|deadline-exceeded|unavailable|cancelled|unknown)?$/i.test(String(err.message || "").trim());
    if (persa) return;
    update(COLL, idDomanda, { stato: "errore", errore: err.message || "Risposta non riuscita" });
    toast(err.message || "Risposta non riuscita", { ms: 6000 });
  }
}

/** Una domanda nuova: si salva e si apre il suo foglio, che mostra la ricerca e poi la risposta. */
function chiedi(testo) {
  const { id: nuovo, saved } = create(COLL, { tipo: "domanda", turni: [{ domanda: testo, at: new Date() }], stato: "nuova", passi: [] }, VIS.PRIVATE);
  apriDomanda(nuovo, { stessoFoglio: true });
  saved.then(() => avvia(nuovo), () => toast("La domanda non si è salvata: riprova"));
}

/** Foglio per scrivere una domanda: Invio chiede, «Registra» per dettarla, esempi da toccare. */
export function nuovaDomanda(testo = "") {
  const campo = el("textarea", { placeholder: "Cosa vuoi sapere?", rows: 2, autofocus: true, enterkeyhint: "send", "aria-label": "Domanda" });
  campo.value = testo;
  campo.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sheet.confirm(); } });
  const esempi = el("div.segmenti", { style: "padding-top:4px;flex-wrap:wrap" }, ...ESEMPI.map((t) =>
    el("button.pillola", { type: "button", onclick: () => { campo.value = t; campo.dispatchEvent(new Event("input", { bubbles: true })); campo.focus(); } }, t)));
  const sheet = openSheet({
    title: "Chiedi",
    body: [
      el("div.taccuino", {}, campo),
      el("p.meta", { style: "margin-top:6px" }, "Cerco nelle note del diario, nelle spese, nei task, nel calendario, nei progetti e nel manuale. Non cambio niente: per fare qualcosa scrivi una nota."),
      el("div", { style: "margin-top:16px" }, el("div.etichetta-campo", {}, "Per esempio"), esempi),
    ],
    azioni: [pulsanteRegistra({ cosa: "la domanda", inserisci: (t, { primo = true } = {}) => {
      const prima = campo.value.trimEnd();
      campo.value = prima ? `${prima}${primo ? "\n" : " "}${t}` : t;
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    } })],
    confirmLabel: "Chiedi",
    onConfirm: () => {
      const t = campo.value.trim();
      if (!t) { campo.focus(); return false; }
      chiedi(t);
    },
  });
}

const ICONE = { nota: "diario", spesa: "spese", task: "task", evento: "calendario", voce: "negozio", progetto: "cartella" };

/** Apre la cosa da cui viene un pezzo della risposta. */
async function apriFonte(f) {
  if (f.tipo === "nota") { vaiA("diario", `nota:${f.id}`); return; }
  if (f.tipo === "progetto") { apriPaginaProgetto(f.id); return; }
  if (f.tipo === "evento") { vaiA("calendario"); return; }
  const coll = { spesa: "expenses", task: "tasks", voce: "manual_entries" }[f.tipo];
  const x = coll ? await leggiUno(coll, f.id) : null;
  if (!x) { toast("Non c'è più"); return; }
  if (f.tipo === "spesa") (await import("../spese/index.js")).apriSpesa(x);
  if (f.tipo === "task") (await import("../task/index.js")).apriTask(x);
  if (f.tipo === "voce") (await import("../manuale/index.js")).apriVoceManuale(x);
}

function rigaFonte(f) {
  return el("button.fonte", { type: "button", onclick: () => apriFonte(f) },
    icon(ICONE[f.tipo] || "punti"),
    el("span.fonte__testo", {}, el("b", {}, f.titolo || "—"), f.sotto ? el("small", {}, f.sotto) : null),
    icon("freccia"));
}

/** Un turno: la domanda in serif, poi la risposta con le fonti, o la ricerca in corso, o l'errore. */
function turno(t, d, ultimoTurno, { onRiprova }) {
  const attende = ultimoTurno && !t.risposta && inCorso(d);
  const sbagliata = ultimoTurno && !t.risposta && !attende && (d.stato === "errore" || morta(d));
  return el("div.domanda__turno", {},
    el("h3.domanda__testo", {}, t.domanda),
    t.risposta ? el("div.sintesi-testo.domanda__risposta", {}, ...testoRicco(t.risposta)) : null,
    t.risposta && t.fonti?.length ? el("div.domanda__fonti", {}, el("div.etichetta-campo", {}, "Fonti"), ...t.fonti.map(rigaFonte)) : null,
    t.risposta && t.modello ? el("p.meta.domanda__modello", {}, `Risposta di ${nomeModello(t.modello) || "Claude"}`) : null,
    attende ? el("div.domanda__attesa", { role: "status" },
      el("span.domanda__anello"),
      el("div", {}, el("b", {}, "Cerco…"), ...(d.passi || []).slice(-3).map((p) => el("small", {}, p)))) : null,
    sbagliata ? el("div.domanda__attesa.domanda__attesa--errore", {},
      el("div", {}, el("b", {}, "Risposta non riuscita"), d.errore ? el("small", {}, d.errore) : null),
      el("button.btn", { type: "button", onclick: onRiprova }, icon("aggiorna"), "Riprova")) : null,
  );
}

/**
 * Il foglio di una domanda, che segue il documento: i turni con risposte e fonti, la ricerca mentre è in corso e, in
 * fondo, un campo per continuare (Invio o «Chiedi» in basso a destra). A sinistra Elimina.
 */
export function apriDomanda(idDomanda, { stessoFoglio = false } = {}) {
  let d = null;
  const turni = el("div.domanda__turni");
  const segui = el("textarea", { placeholder: "Chiedi ancora…", rows: 1, enterkeyhint: "send", "aria-label": "Altra domanda" });
  segui.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sheet.confirm(); } });
  const campoSegui = el("div.taccuino.domanda__segui", {}, segui);
  const riprova = () => { update(COLL, idDomanda, { stato: "nuova", errore: null }); avvia(idDomanda); };
  function disegna() {
    if (!d) return;
    const lista = d.turni || [];
    turni.replaceChildren(...lista.map((t, i) => turno(t, d, i === lista.length - 1, { onRiprova: riprova })));
    campoSegui.hidden = inCorso(d);
  }
  const sheet = openSheet({
    title: "Chiedi",
    stessoFoglio,
    body: [turni, campoSegui,
      el("div.foglio__piede", {},
        el("button.btn.btn--pericolo", { "aria-label": "Elimina la domanda", onclick: () => { stop(); sheet.close(); remove(COLL, idDomanda); toast("Domanda eliminata"); } }, icon("cestino")))],
    confirmLabel: "Chiedi",
    onConfirm: () => {
      const t = segui.value.trim();
      if (!t || !d) { segui.focus(); return false; }
      if (inCorso(d)) return false;
      segui.value = "";
      update(COLL, idDomanda, { turni: [...(d.turni || []), { domanda: t, at: new Date() }], stato: "nuova", errore: null, passi: [] })
        .then(() => avvia(idDomanda));
      d = { ...d, turni: [...(d.turni || []), { domanda: t, at: new Date() }], stato: "nuova", passi: [] };
      disegna();
      return false; // il foglio resta: la risposta arriva qui
    },
  });
  let primo = true;
  const stop = seguiUno(COLL, idDomanda, (x) => {
    if (!sheet.aperto()) { stop(); return; }
    if (!x) { if (!primo) { sheet.close(); } return; }
    d = x; primo = false;
    disegna();
  });
  return sheet;
}

/** Riga di una domanda, come le note del Diario: giorno a sinistra, la domanda, l'inizio della risposta. */
function riga(d, conGiorno) {
  const giorno = toDate(d.createdAt) || new Date();
  const primoTurno = (d.turni || [])[0] || {};
  const u = ultimo(d);
  const risposta = String(u?.risposta || primoTurno.risposta || "").replace(/^#+\s*/gm, "").replace(/\*\*/g, "").replace(/^-\s+/gm, "").replace(/\s+/g, " ").trim();
  const piede = [
    d.tipo === "settimana" ? el("span.etichetta", {}, "revisione della settimana") : null,
    (d.turni || []).length > 1 ? el("span.lezione__ora", {}, `${d.turni.length} domande`) : null,
    inCorso(d) ? el("span.lezione__stato", {}, "Cerco…") : null,
    !inCorso(d) && !u?.risposta && (d.stato === "errore" || morta(d)) ? el("span.lezione__stato.lezione__stato--errore", {}, "non riuscita") : null,
  ].filter(Boolean);
  return el("div.voce-nota", { "data-id": d.id },
    el("button.lezione", { type: "button", onclick: () => apriDomanda(d.id) },
      el("div.lezione__giorno", {}, conGiorno ? [el("b.display", {}, String(giorno.getDate())), el("small", {}, stessoGiorno(giorno, new Date()) ? "oggi" : GIORNI[giorno.getDay()])] : null),
      el("div.lezione__testo", {},
        el("div.lezione__titolo", {}, primoTurno.domanda || "Domanda"),
        risposta ? el("div.lezione__anteprima", {}, risposta.slice(0, 280)) : null,
        piede.length ? el("div.lezione__temi", {}, ...piede) : null,
      ),
    ),
  );
}

export function mount(container) {
  let domande = [];
  const dati = attesa(["domande"], () => render());
  const elenco = el("div");
  const piu = fab("Nuova domanda", () => nuovaDomanda());

  let timer = null;
  function render() {
    if (!dati.pronta()) return;
    clearTimeout(timer);
    // Una risposta «in corso» che supera il tempo massimo diventa «non riuscita» senza che il documento cambi.
    if (domande.some(inCorso)) timer = setTimeout(render, 15000);
    if (!domande.length) {
      elenco.replaceChildren(vuoto("Chiedi quello che vuoi sapere",
        "Cerco nelle note, nelle spese, nei task, nel calendario e nel manuale, e ti rispondo con le fonti. Tocca + e scrivi o detta la domanda."));
      return;
    }
    const nodi = [];
    let mese = null, giorno = null;
    for (const d of domande) {
      const quando = toDate(d.createdAt) || new Date();
      const m = meseLungo(quando);
      if (m !== mese) { nodi.push(fascia(m.charAt(0).toUpperCase() + m.slice(1))); mese = m; giorno = null; }
      const g = isoGiorno(quando);
      nodi.push(riga(d, g !== giorno));
      giorno = g;
    }
    elenco.replaceChildren(...nodi);
  }

  container.append(elenco, piu);
  const stop = watchMine(COLL, { order: ["createdAt", "desc"], max: 100 }, (docs) => { domande = docs; dati.arriva("domande"); render(); });

  // Dalla notifica della revisione (#/chiedi/<id>) o dal punto di domanda del Diario (vaiA("chiedi", "nuova")).
  const daLink = location.hash.match(/^#\/chiedi\/([A-Za-z0-9]+)/)?.[1];
  if (daLink) history.replaceState(history.state, "", "#/chiedi");
  const chiesta = richiestaPer("chiedi");
  if (daLink === "nuova" || chiesta === "nuova") setTimeout(() => nuovaDomanda(), 0); // anche la scorciatoia dell'icona
  else if (daLink) setTimeout(() => apriDomanda(daLink), 0);

  return () => { clearTimeout(timer); stop(); dati.ferma(); piu.remove(); };
}
