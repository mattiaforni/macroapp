// Modelli AI: quale modello di Claude legge le note semplici e quale quelle dei progetti con
// istruzioni. La scelta vale per la persona e si salva al tocco, come le categorie delle Notifiche.
// Logica in core/modelli.js; il server la applica in functions/src/agent.js (modelloPer).
// In fondo, quanto è costata l'AI questo mese (14/11): Claude rispetto ai crediti del piano, Gemini a parte.
import { el, icon, toast } from "../../core/ui.js";
import { MODELLI, TIPI, leggiModelli, scegliModello, nomeModello, leggiConsumi, dollari, CREDITI_MESE, VOCI_CONSUMO } from "../../core/modelli.js";

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

  let consumi; // undefined = non ancora letti, null = niente questo mese
  function blocchiConsumi() {
    if (consumi === undefined) return null;
    const c = consumi || {};
    const claude = c.claude?.usd || 0;
    const voci = VOCI_CONSUMO.filter(([k]) => c.voci?.[k]?.chiamate);
    return el("div.blocco", {},
      el("h3", {}, "Questo mese"),
      el("p", {}, claude
        ? `Claude: ${dollari(claude)} dei ${CREDITI_MESE} $ del piano (${Math.max(1, Math.round((claude / CREDITI_MESE) * 100))}%). Stima dai prezzi di listino.`
        : "Claude non ha ancora lavorato questo mese."),
      voci.length ? el("div", {}, ...voci.map(([k, nome]) => el("div.riga", {},
        el("div.testo", {}, el("b", {}, nome), el("span", {}, `${c.voci[k].chiamate} ${c.voci[k].chiamate === 1 ? "chiamata" : "chiamate"}`)),
        el("span.riga__valore", {}, dollari(c.voci[k].usd))))) : null,
      c.gemini?.usd ? el("p.meta", { style: "margin-top:8px" }, "La trascrizione la fa Gemini e si paga a parte, sul conto Google.") : null,
    );
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
      blocchiConsumi(),
    );
  }

  // La pagina compare con le scelte e i consumi insieme (mai a pezzi); se i consumi non si leggono, senza.
  Promise.all([leggiModelli(), leggiConsumi().catch(() => null)]).then(([m, c]) => { scelti = m; consumi = c; if (!smontato) render(); }, (e) => {
    console.warn("modelli", e);
    toast("Non riesco a leggere le scelte: riprova", { ms: 6000 });
  });
  return () => { smontato = true; };
}
