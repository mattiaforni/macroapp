// Notifiche: attivazione su questo telefono (in basso a destra), categorie che valgono per la
// persona su tutti i suoi telefoni, telefoni attivi, prova. Logica in core/notifiche.js.
import { el, icon, toast } from "../../core/ui.js";
import { CATEGORIE, statoQui, leggiProfilo, attiva, disattiva, scegliCategoria, prova, idQuestoTelefono } from "../../core/notifiche.js";

export const id = "notifiche";
export const title = "Notifiche";
export const nav = false;
const navIcon = "campana";
export { navIcon as icon };

const SPIEGA = {
  attive: "Attive su questo telefono.",
  spente: "Spente su questo telefono. Tocca «Attiva» e consenti le notifiche quando il browser lo chiede.",
  bloccate: "Il browser le blocca per questo sito. Vanno riattivate dalle sue impostazioni (permessi del sito → Notifiche), poi torna qui.",
  "da-installare": "Su iPhone le notifiche arrivano solo all'app aggiunta alla schermata Home: in Safari tocca Condividi → «Aggiungi alla schermata Home», poi apri D&D da lì e torna in questa pagina.",
  "non-supportate": "Questo browser non riceve notifiche push.",
};

export function mount(container) {
  let profilo = null;
  let occupato = false;
  let smontato = false;

  const corpo = el("div");
  const attivaFab = el("button.fab", { type: "button", "aria-label": "Attiva le notifiche", hidden: true, onclick: suAttiva }, icon("campana"), "Attiva");
  container.append(corpo, attivaFab);

  async function ricarica() {
    try { profilo = await leggiProfilo(); } catch (e) { console.warn("notifiche: profilo", e); profilo = profilo || {}; }
    if (!smontato) render();
  }

  async function esegui(fn, riuscito) {
    if (occupato) return;
    occupato = true; render();
    try { await fn(); if (riuscito) toast(riuscito); }
    catch (e) { console.warn("notifiche", e); toast(e.message || "Non è riuscito", { ms: 6000 }); }
    finally { occupato = false; await ricarica(); }
  }

  // Il permesso va chiesto dentro il tocco: attiva() lo fa per prima cosa.
  function suAttiva() { esegui(attiva, "Notifiche attive su questo telefono"); }

  function render() {
    if (!profilo) { attivaFab.hidden = true; corpo.replaceChildren(); return; }
    const stato = statoQui(profilo);
    attivaFab.hidden = stato !== "spente";
    attivaFab.disabled = occupato;
    const prefs = profilo.notifiche || {};
    const telefoni = Object.entries(profilo.dispositivi || {}).filter(([, x]) => x?.token);
    const mio = idQuestoTelefono();

    corpo.replaceChildren(...[ // replaceChildren non salta i null come el()
      el("div.blocco", {},
        el("h3", {}, "Questo telefono"),
        el("p", {}, SPIEGA[stato]),
        stato === "attive" ? el("div.segmenti", { style: "padding-top:0" },
          el("button.pillola", { type: "button", disabled: occupato, onclick: () => esegui(async () => {
            const n = await prova();
            toast(n ? "Prova inviata: dovrebbe arrivare tra pochi secondi" : "Nessun telefono l'ha ricevuta", { ms: 5000 });
          }) }, icon("campana"), "Manda una prova"),
          el("button.pillola", { type: "button", disabled: occupato, onclick: () => esegui(disattiva, "Notifiche spente su questo telefono") }, icon("chiudi"), "Spegni qui"),
        ) : null,
      ),
      el("div.blocco", {},
        el("h3", {}, "Cosa ti arriva"),
        el("p", {}, "Quando l'altra persona fa qualcosa di condiviso; mai per quello che fai tu. Le scelte valgono su tutti i tuoi telefoni."),
        el("div", {}, ...CATEGORIE.map(([k, nome, desc, ic]) => {
          const accesa = prefs[k] !== false;
          return el("div.riga", { onclick: () => esegui(() => scegliCategoria(k, !accesa)) },
            el("div.pallino", {}, icon(ic)),
            el("div.testo", {}, el("b", {}, nome), el("span", {}, desc)),
            el("button.spunta", { type: "button", class: accesa ? "on" : "", "aria-pressed": accesa ? "true" : "false", "aria-label": `${nome}: ${accesa ? "attive" : "spente"}` }, icon("spunta")),
          );
        })),
      ),
      telefoni.length ? el("div.blocco", {},
        el("h3", {}, "Telefoni con le notifiche"),
        el("div", {}, ...telefoni.map(([id, x]) => el("div.riga", { style: "cursor:default" },
          el("div.pallino", {}, icon("telefono")),
          el("div.testo", {}, el("b", {}, x.nome || "Telefono"), el("span", {}, id === mio ? "questo telefono" : " ")),
        ))),
      ) : null,
    ].filter(Boolean));
  }

  ricarica();
  return () => { smontato = true; attivaFab.remove(); };
}
