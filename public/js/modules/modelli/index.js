// Modelli AI: quale modello di Claude legge le note semplici e quale quelle dei progetti con
// istruzioni. La scelta vale per la persona e si salva al tocco, come le categorie delle Notifiche.
// Logica in core/modelli.js; il server la applica in functions/src/agent.js (modelloPer).
import { el, icon, toast } from "../../core/ui.js";
import { MODELLI, TIPI, leggiModelli, scegliModello, nomeModello } from "../../core/modelli.js";

export const id = "modelli";
export const title = "Modelli AI";
export const nav = false;
const navIcon = "scintilla";
export { navIcon as icon };

export function mount(container) {
  let scelti = null;
  let smontato = false;
  const corpo = el("div");
  container.append(corpo);

  async function scegli(tipo, modello) {
    if (scelti[tipo] === modello) return;
    const prima = scelti[tipo];
    scelti = { ...scelti, [tipo]: modello };
    render();
    try {
      await scegliModello(tipo, modello);
      toast(`${TIPI.find(([t]) => t === tipo)[1]}: ${nomeModello(modello)}`);
    } catch (e) {
      console.warn("modelli", e);
      scelti = { ...scelti, [tipo]: prima };
      if (!smontato) render();
      toast(e.message || "Non è riuscito", { ms: 6000 });
    }
  }

  function render() {
    corpo.replaceChildren(
      ...TIPI.map(([tipo, titolo, spiega]) => el("div.blocco", {},
        el("h3", {}, titolo),
        el("p", {}, spiega),
        el("div", {}, ...MODELLI.map((m) => {
          const on = scelti[tipo] === m.id;
          return el("div.riga", { onclick: () => scegli(tipo, m.id) },
            el("div.testo", {}, el("b", {}, m.nome), el("span", {}, m.desc)),
            el("button.spunta", { type: "button", class: on ? "on" : "", "aria-pressed": on ? "true" : "false",
              "aria-label": `${titolo}: ${m.nome}${on ? ", scelto" : ""}` }, icon("spunta")),
          );
        })),
      )),
      el("p.meta", { style: "margin-top:14px" },
        "Vale dalla prossima analisi; «Rianalizza» rifà una nota col modello scelto. Accanto all'ora di ogni nota analizzata compare il modello che l'ha letta. "
        + "I crediti API del piano Max coprono tutti e tre."),
    );
  }

  leggiModelli().then((m) => { scelti = m; if (!smontato) render(); }, (e) => {
    console.warn("modelli", e);
    toast("Non riesco a leggere le scelte: riprova", { ms: 6000 });
  });
  return () => { smontato = true; };
}
