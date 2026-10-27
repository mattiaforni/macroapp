// Menu a sinistra, come in Leghe Fantacalcio: in alto chi sei e la casa, poi le voci che non
// si usano tutti i giorni divise in gruppi. Le sezioni di tutti i giorni restano nella barra in basso.
// Si apre dal pulsante in testata; il tasto indietro del telefono lo chiude.
import { el, icon } from "../core/ui.js";
import { session, logout } from "../core/auth.js";
import { getHousehold } from "../core/household.js";
import { vaiA } from "../core/router.js";
import { readVisible } from "../core/db.js";
import { VERSION } from "../version.js";

const CHIAVE_PAGINA = "macroapp.progetto"; // progetto aperto nella pagina Progetto (modules/progetto)

const GRUPPI = [
  ["Casa", [
    { icona: "calendario", testo: "Calendario", vai: ["calendario"] },
    { icona: "manuale", testo: "Manuale e rubrica", vai: ["manuale"] },
    { icona: "ripeti", testo: "Spese ricorrenti", vai: ["spese", "ricorrenti"] },
    { icona: "cartella", testo: "Categorie del manuale", vai: ["manuale", "categorie"] },
    { icona: "scintilla", testo: "Azioni da confermare", vai: ["proposte"] },
  ]],
  ["Collegamenti", [
    { icona: "collegamento", testo: "Google", vai: ["google"], nota: "contatti, calendario, Drive" },
    { icona: "banca", testo: "Banca", vai: ["banca"] },
  ]],
  ["Account", [
    { icona: "campana", testo: "Notifiche", vai: ["notifiche"] },
    { icona: "scintilla", testo: "Modelli AI", vai: ["modelli"] },
    { icona: "impostazioni", testo: "Casa, tema e account", vai: ["impostazioni"] },
  ]],
];

let aperto = null;

// Durata dello scorrimento del pannello e della dissolvenza del velo (base.css, .menu).
const DURATA = 180;
const riduci = window.matchMedia?.("(prefers-reduced-motion: reduce)");

export function apriMenu() {
  if (aperto) return;
  let chiuso = false;

  function chiudi({ fromHistory = false, poi } = {}) {
    if (chiuso) return;
    chiuso = true;
    window.removeEventListener("popstate", onPop);
    radice.classList.remove("aperto");
    setTimeout(() => radice.remove(), DURATA);
    aperto = null;
    // Come in Leghe: la voce scelta parte quando il pannello è rientrato, poi la pagina cambia con
    // il suo passaggio. Prima si toglie anche la voce del menu dalla cronologia.
    const rientrato = new Promise((r) => setTimeout(r, riduci?.matches ? 0 : DURATA));
    if (!fromHistory && history.state && history.state.menu) {
      if (poi) {
        const tolto = new Promise((r) => window.addEventListener("popstate", r, { once: true }));
        Promise.all([tolto, rientrato]).then(() => poi());
      }
      history.back();
    } else if (poi) rientrato.then(() => poi());
  }
  function onPop() { chiudi({ fromHistory: true }); }

  const nomeCasa = el("span");
  getHousehold().then((h) => { nomeCasa.textContent = h?.name || ""; }).catch(() => {});

  const voce = (v) => el("button.menu__voce", {
    type: "button", disabled: !v.vai,
    onclick: () => v.vai && chiudi({ poi: () => { v.prima?.(); vaiA(...v.vai); } }),
  }, icon(v.icona), el("span", {}, v.testo), v.nota ? el("small", {}, v.nota) : null);

  // I progetti con le istruzioni per il diario hanno una pagina loro: compaiono qui, quando arrivano.
  const progetti = el("div.menu__gruppo", { hidden: true });
  readVisible("projects").then((docs) => {
    const conPagina = docs.filter((p) => !p.archived && p.istruzioni).sort((a, b) => a.name.localeCompare(b.name));
    if (!conPagina.length) return;
    progetti.replaceChildren(
      el("div.menu__titolo", {}, "Progetti"),
      ...conPagina.map((p) => {
        const v = voce({ icona: "cartella", testo: p.name, vai: ["progetto"], prima: () => { try { localStorage.setItem(CHIAVE_PAGINA, p.id); } catch (e) {} } });
        if (p.colore) v.firstChild.replaceWith(el("span.colore.colore--pallino", { "data-colore": p.colore }));
        return v;
      }),
    );
    progetti.hidden = false;
  }).catch(() => {});

  const pannello = el("nav.menu__pannello", { "aria-label": "Menu" },
    el("div.menu__testa", {},
      el("b.display", {}, session.user?.displayName || "Tu"),
      el("span", {}, session.user?.email || ""),
      el("span", {}, nomeCasa),
      el("button.btn.btn--piatto", { type: "button", onclick: () => chiudi({ poi: () => logout() }) }, icon("esci"), "Esci"),
    ),
    progetti,
    ...GRUPPI.map(([titolo, voci]) => el("div.menu__gruppo", {},
      el("div.menu__titolo", {}, titolo),
      ...voci.map(voce),
    )),
    el("p.meta.menu__piede", {}, `versione ${VERSION}`),
  );
  const radice = el("div.menu", { onclick: (e) => { if (e.target === radice) chiudi(); } }, pannello);
  document.body.append(radice);
  void radice.offsetWidth; // parte dallo stato chiuso: il pannello scorre e il velo sfuma
  radice.classList.add("aperto");

  history.pushState({ ...(history.state || {}), menu: true }, "");
  window.addEventListener("popstate", onPop);
  aperto = { chiudi };
}

/** Chiude il menu senza toccare la cronologia (cambio di pagina). */
export function chiudiMenu() { aperto?.chiudi({ fromHistory: true }); }
