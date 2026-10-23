// Menu a sinistra, come in Leghe Fantacalcio: in alto chi sei e la casa, poi le voci che non
// si usano tutti i giorni divise in gruppi. Le sezioni di tutti i giorni restano nella barra in basso.
// Si apre dal pulsante in testata; il tasto indietro del telefono lo chiude.
import { el, icon } from "../core/ui.js";
import { session, logout } from "../core/auth.js";
import { getHousehold } from "../core/household.js";
import { vaiA } from "../core/router.js";
import { VERSION } from "../version.js";

const GRUPPI = [
  ["Casa", [
    { icona: "manuale", testo: "Manuale e rubrica", vai: ["manuale"] },
    { icona: "ripeti", testo: "Spese ricorrenti", vai: ["spese", "ricorrenti"] },
    { icona: "cartella", testo: "Categorie del manuale", vai: ["manuale", "categorie"] },
    { icona: "scintilla", testo: "Azioni da confermare", vai: ["proposte"] },
  ]],
  ["Collegamenti", [
    { icona: "persone", testo: "Google Contatti", vai: ["manuale", "contatti"] },
    { icona: "banca", testo: "Banca", nota: "in arrivo" },
  ]],
  ["Account", [
    { icona: "impostazioni", testo: "Casa, tema e account", vai: ["impostazioni"] },
  ]],
];

let aperto = null;

export function apriMenu() {
  if (aperto) return;
  let chiuso = false;

  function chiudi({ fromHistory = false, poi } = {}) {
    if (chiuso) return;
    chiuso = true;
    window.removeEventListener("popstate", onPop);
    pannello.classList.remove("aperto");
    setTimeout(() => radice.remove(), 180);
    aperto = null;
    // Prima si toglie la voce del menu dalla cronologia, poi si cambia pagina.
    if (!fromHistory && history.state && history.state.menu) {
      if (poi) window.addEventListener("popstate", () => poi(), { once: true });
      history.back();
    } else poi?.();
  }
  function onPop() { chiudi({ fromHistory: true }); }

  const nomeCasa = el("span");
  getHousehold().then((h) => { nomeCasa.textContent = h?.name || ""; }).catch(() => {});

  const voce = (v) => el("button.menu__voce", {
    type: "button", disabled: !v.vai,
    onclick: () => v.vai && chiudi({ poi: () => vaiA(...v.vai) }),
  }, icon(v.icona), el("span", {}, v.testo), v.nota ? el("small", {}, v.nota) : null);

  const pannello = el("nav.menu__pannello", { "aria-label": "Menu" },
    el("div.menu__testa", {},
      el("b.display", {}, session.user?.displayName || "Tu"),
      el("span", {}, session.user?.email || ""),
      el("span", {}, nomeCasa),
      el("button.btn.btn--piatto", { type: "button", onclick: () => chiudi({ poi: () => logout() }) }, icon("esci"), "Esci"),
    ),
    ...GRUPPI.map(([titolo, voci]) => el("div.menu__gruppo", {},
      el("div.menu__titolo", {}, titolo),
      ...voci.map(voce),
    )),
    el("p.meta.menu__piede", {}, `versione ${VERSION}`),
  );
  const radice = el("div.menu", { onclick: (e) => { if (e.target === radice) chiudi(); } }, pannello);
  document.body.append(radice);
  requestAnimationFrame(() => pannello.classList.add("aperto"));

  history.pushState({ ...(history.state || {}), menu: true }, "");
  window.addEventListener("popstate", onPop);
  aperto = { chiudi };
}

/** Chiude il menu senza toccare la cronologia (cambio di pagina). */
export function chiudiMenu() { aperto?.chiudi({ fromHistory: true }); }
