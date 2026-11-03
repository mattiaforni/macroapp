// Pagina «Barra in basso» (menu → Account): quali sezioni stanno nella barra e in che ordine, per la
// persona che guarda (l'altra ha la sua). In cima le sezioni scelte, con le frecce per spostarle e la
// spunta accesa per toglierle; sotto le pagine e i progetti da aggiungere (spunta spenta, tocco =
// in fondo alla barra). La prima sezione è la pagina su cui si apre l'app. Al più MASSIMO.
// Si salva al tocco, come i Modelli AI; la barra si ridisegna subito (core/barra.js).
import { el, icon, toast } from "../../core/ui.js";
import { MASSIMO, PAGINE, scelte, sezione, idProgetto, progettoDi, progettiDisponibili, salvaBarra } from "../../core/barra.js";

export const id = "barra";
export const title = "Barra in basso";
export const nav = false;
const navIcon = "impostazioni";
export { navIcon as icon };

export function mount(container) {
  let ids = scelte();
  let progetti = null;
  let smontato = false;
  const corpo = el("div");
  container.append(corpo);

  async function salva(nuovi) {
    const prima = ids;
    ids = nuovi;
    render();
    try {
      await salvaBarra(ids);
    } catch (e) {
      console.warn("barra", e);
      ids = prima;
      if (!smontato) render();
      toast(e.message || "Non è riuscito", { ms: 6000 });
    }
  }

  const togli = (sid) => {
    if (ids.length === 1) { toast("Serve almeno una sezione"); return; }
    salva(ids.filter((x) => x !== sid));
  };
  const aggiungi = (sid) => {
    if (ids.length >= MASSIMO) { toast(`Al massimo ${MASSIMO} sezioni: togline una`); return; }
    salva([...ids, sid]);
  };
  const sposta = (sid, verso) => {
    const i = ids.indexOf(sid), j = i + verso;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const nuovi = [...ids];
    [nuovi[i], nuovi[j]] = [nuovi[j], nuovi[i]];
    salva(nuovi);
  };

  /** Icona di una sezione nel tondo, come nelle Notifiche; un progetto col suo colore. */
  const simbolo = (s) => el("div.pallino", { "data-colore": s.colore, class: s.colore ? "pallino--colore" : "" }, icon(s.icon));

  function rigaScelta(sid, i) {
    const s = sezione(sid);
    if (!s) return null;
    return el("div.riga", {},
      simbolo(s),
      el("div.testo", {}, el("b", {}, s.title), i === 0 ? el("span", {}, "L'app si apre qui") : null),
      el("button.tondo.tondo--piatto", { type: "button", "aria-label": `${s.title}: sposta su`, disabled: i === 0, onclick: () => sposta(sid, -1) }, icon("su")),
      el("button.tondo.tondo--piatto", { type: "button", "aria-label": `${s.title}: sposta giù`, disabled: i === ids.length - 1, onclick: () => sposta(sid, 1) }, icon("giu")),
      el("button.spunta.on", { type: "button", "aria-pressed": "true", "aria-label": `${s.title}: togli dalla barra`, onclick: () => togli(sid) }, icon("spunta")),
    );
  }

  function rigaDisponibile(sid) {
    const s = sezione(sid);
    if (!s) return null;
    return el("div.riga", { onclick: () => aggiungi(sid) },
      simbolo(s),
      el("div.testo", {}, el("b", {}, s.title)),
      el("button.spunta", { type: "button", "aria-pressed": "false", "aria-label": `${s.title}: metti in barra` }, icon("spunta")),
    );
  }

  function render() {
    const pagine = PAGINE.filter((p) => !ids.includes(p));
    const altri = (progetti || []).filter((p) => !ids.includes(idProgetto(p.id)));
    corpo.replaceChildren(
      el("div.blocco", {},
        el("h3", {}, "Nella barra"),
        el("p", {}, `In basso, in quest'ordine. Al massimo ${MASSIMO}; la prima è la pagina su cui si apre l'app.`),
        el("div", {}, ...ids.map(rigaScelta)),
      ),
      pagine.length ? el("div.blocco", {},
        el("h3", {}, "Pagine"),
        el("div", {}, ...pagine.map(rigaDisponibile)),
      ) : null,
      progetti && altri.length ? el("div.blocco", {},
        el("h3", {}, "Progetti"),
        el("p", {}, "Un progetto in barra apre la sua pagina: sintesi, note e cose da fare."),
        el("div", {}, ...altri.map((p) => rigaDisponibile(idProgetto(p.id)))),
      ) : null,
      el("p.meta", { style: "margin-top:14px" }, "La scelta vale per te: l'altra persona ha la sua. Tutto il resto resta nel menu."),
    );
  }

  render();
  progettiDisponibili().then((p) => { progetti = p; ids = scelte(); if (!smontato) render(); }, (e) => {
    console.warn("barra", e);
    toast("Non riesco a leggere i progetti: riprova", { ms: 6000 });
  });
  return () => { smontato = true; };
}
