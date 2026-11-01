// Notifiche: attivazione su questo telefono (in basso a destra), categorie in due gruppi (dall'altra persona,
// per te) che valgono per la persona su tutti i suoi telefoni, anticipo dei promemoria, silenzio di notte,
// telefoni attivi, prova. Logica in core/notifiche.js; chi riceve cosa lo decide il server (functions/src/avvisi.js).
import { el, icon, toast } from "../../core/ui.js";
import {
  GRUPPI, ANTICIPI, ANTICIPO, SILENZIO, statoQui, leggiProfilo, attiva, disattiva, scegliCategoria, prova, idQuestoTelefono,
} from "../../core/notifiche.js";

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

  /** Riga con la spunta come interruttore; `sotto` = altro dentro la riga, sotto la descrizione. */
  function interruttore(k, nome, desc, ic, accesa, sotto = null) {
    return el("div.riga.riga--a-capo", { onclick: () => esegui(() => scegliCategoria(k, !accesa)) },
      el("div.pallino", {}, icon(ic)),
      el("div.testo", {}, el("b", {}, nome), el("span", {}, desc), sotto),
      el("button.spunta", { type: "button", class: accesa ? "on" : "", "aria-pressed": accesa ? "true" : "false", "aria-label": `${nome}: ${accesa ? "attive" : "spente"}` }, icon("spunta")),
    );
  }

  /** Quanto prima arrivano i promemoria: pillole dentro la riga (il tocco non spegne la categoria). */
  function anticipo(prefs) {
    const scelto = ANTICIPI.some(([m]) => m === prefs.anticipo) ? prefs.anticipo : ANTICIPO;
    return el("div.segmenti.anticipo", { role: "group", "aria-label": "Quanto prima", onclick: (e) => e.stopPropagation() },
      ...ANTICIPI.map(([m, etichetta]) => el("button.pillola", {
        type: "button", class: m === scelto ? "on" : "", "aria-pressed": m === scelto ? "true" : "false", disabled: occupato,
        onclick: () => { if (m !== scelto) esegui(() => scegliCategoria("anticipo", m), `Promemoria ${etichetta === "1 ora" ? "un'ora" : etichetta.replace(" min", " minuti")} prima`); },
      }, etichetta)));
  }

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
      ...GRUPPI.map((g) => el("div.blocco", {},
        el("h3", {}, g.titolo),
        el("p", {}, g.spiega),
        el("div", {}, ...g.categorie.map(([k, nome, desc, ic]) => {
          const accesa = prefs[k] !== false;
          return interruttore(k, nome, desc, ic, accesa, k === "promemoria" && accesa ? anticipo(prefs) : null);
        })),
      )),
      el("div.blocco", {},
        el("h3", {}, "Di notte"),
        el("div", {}, interruttore("silenzio", "Senza suono di notte", `Dalle ${SILENZIO.replace("–", " alle ")} arrivano senza suono né vibrazione`, "luna", prefs.silenzio !== false)),
        el("p.meta", { style: "margin-top:10px" }, "Le scelte di questa pagina valgono su tutti i tuoi telefoni."),
      ),
      telefoni.length ? el("div.blocco", {},
        el("h3", {}, "Telefoni con le notifiche"),
        el("div", {}, ...telefoni.map(([id, x]) => el("div.riga", { style: "cursor:default" },
          el("div.pallino", {}, icon("telefono")),
          el("div.testo", {}, el("b", {}, x.nome || "Telefono"), el("span", {}, id === mio ? "questo telefono" : " ")),
        ))),
      ) : null,
    ].filter(Boolean));
  }

  ricarica();
  return () => { smontato = true; attivaFab.remove(); };
}
