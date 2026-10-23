// Shell dell'app: autenticazione, navigazione, montaggio dei moduli.
import { startAuth, onSession, login, session, checkRedirectResult } from "./core/auth.js";
import { addRoute, startRouter, navigate, currentRoute } from "./core/router.js";
import { el, clear, icon, toast } from "./core/ui.js";
import { applicaTema } from "./core/theme.js";
import { ensureMyName } from "./core/household.js";
import { avviaRubrica, fermaRubrica } from "./core/rubrica.js";
import { modules, navModules, DEFAULT_ROUTE } from "./modules/registry.js";
import { renderOnboarding } from "./components/onboarding.js";
import { closeSheet } from "./components/sheet.js";
import { materializeRecurring } from "./modules/spese/index.js";
import { VERSION } from "./version.js";

applicaTema();

const view = document.getElementById("view");
const nav = document.getElementById("nav");
const title = document.getElementById("page-title");
const actions = document.getElementById("topbar-actions");

let routerStarted = false;
let loginError = null; // errore dell'ultimo login con redirect, mostrato sotto il pulsante

function renderLogin() {
  clear(nav);
  clear(actions);
  title.textContent = "";
  view.replaceChildren(
    el("div.accesso", {},
      el("h2", {}, "Macroapp"),
      el("p.muted", {}, "Lista, spese, diario, task e manuale di casa."),
      el("button.btn.btn--primario", { onclick: () => login().catch((e) => toast(e.code || e.message)) }, "Accedi con Google"),
      loginError ? el("p.errore", {}, `Accesso non riuscito: ${loginError}`) : null,
      el("p.meta", {}, `versione ${VERSION}`),
    ),
  );
}

function renderNav(active) {
  nav.replaceChildren(...navModules.map((m) =>
    el("a", { href: `#/${m.id}`, "aria-current": m.id === active ? "page" : null }, icon(m.icon || m.id), m.title),
  ));
}

function renderActions(id) {
  clear(actions);
  if (id !== "impostazioni") {
    actions.append(el("a.tondo", { href: "#/impostazioni", "aria-label": "Impostazioni" }, icon("impostazioni")));
  }
}

function startApp() {
  if (!routerStarted) {
    for (const m of modules) addRoute(m.id, m.mount);
    routerStarted = true;
    startRouter({
      container: view,
      fallback: DEFAULT_ROUTE,
      onChange: (id) => {
        closeSheet({ fromHistory: true });
        const mod = modules.find((m) => m.id === id);
        title.textContent = mod?.title || "Macroapp";
        renderNav(id);
        renderActions(id);
        window.scrollTo(0, 0);
      },
    });
  } else {
    // Rimonta la vista corrente dopo un cambio di sessione (es. casa appena creata).
    navigate(currentRoute() || DEFAULT_ROUTE);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
  // Lavori di fondo, non bloccanti.
  avviaRubrica(); // persone del manuale, per riconoscerle nei task
  ensureMyName().catch((e) => console.warn("ensureMyName", e));
  materializeRecurring().catch((e) => console.warn("materializeRecurring", e));
}

onSession((s) => {
  if (!s.user) { fermaRubrica(); renderLogin(); return; }
  if (s.error) {
    clear(nav); clear(actions); title.textContent = "Errore";
    view.replaceChildren(
      el("div.vuoto", {},
        el("b", {}, "Qualcosa non va"),
        el("p", {}, s.error),
        el("p.small", {}, "Controlla che Firestore sia creato e che le regole siano pubblicate."),
        el("button.btn", { onclick: () => location.reload(), style: "margin-top:14px" }, "Riprova"),
      ),
    );
    return;
  }
  if (!s.householdId) {
    clear(nav); clear(actions); title.textContent = "Benvenuto";
    renderOnboarding(view);
    return;
  }
  startApp();
});

startAuth();
checkRedirectResult().then((err) => {
  if (!err) return;
  loginError = err;
  if (!session.user) renderLogin();
});

// Service worker. Quando è pubblicata una versione nuova, il nuovo service worker prende
// il controllo e la pagina si ricarica una volta; se un foglio è aperto, chiede prima.
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    if (document.getElementById("foglio").hidden) location.reload();
    else toast("C'è una versione nuova", { azione: { label: "Ricarica", fn: () => location.reload() } });
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((r) => r.update()).catch(console.warn);
  });
}

// Testo condiviso da altre app (Web Share Target): finisce nel diario, pronto da salvare.
const params = new URLSearchParams(location.search);
if (params.get("share")) {
  const text = [params.get("title"), params.get("text"), params.get("url")].filter(Boolean).join("\n");
  sessionStorage.setItem("macroapp.share", text);
  history.replaceState(null, "", "/#/diario");
}
