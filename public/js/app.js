// Shell dell'app: autenticazione, navigazione, montaggio dei moduli.
import { startAuth, onSession, login, session, checkRedirectResult } from "./core/auth.js";
import { addRoute, startRouter, navigate, currentRoute } from "./core/router.js";
import { el, clear, icon, toast } from "./core/ui.js";
import { modules, navModules, DEFAULT_ROUTE } from "./modules/registry.js";
import { renderOnboarding } from "./components/onboarding.js";
import { watchPendingCount } from "./components/proposals.js";

const view = document.getElementById("view");
const nav = document.getElementById("nav");
const title = document.getElementById("page-title");
const actions = document.getElementById("topbar-actions");

let routerStarted = false;
let unwatchBadge = null;
let loginError = null; // errore dell'ultimo login con redirect, mostrato sotto il pulsante

function renderLogin() {
  clear(nav);
  clear(actions);
  title.textContent = "Macroapp";
  view.replaceChildren(
    el("div.login", {},
      el("h2", {}, "Macroapp"),
      el("p.muted", {}, "Spese, lista, manuale di casa, diario e task. Accesso riservato."),
      el("button.btn.btn--primary", { onclick: () => login().catch((e) => toast(e.code || e.message)) }, "Accedi con Google"),
      loginError ? el("p.small", { style: "color:var(--danger)" }, `Accesso non riuscito: ${loginError}`) : null,
    ),
  );
}

function renderNav() {
  clear(nav);
  const active = currentRoute() || DEFAULT_ROUTE;
  for (const m of navModules) {
    const item = el("a.nav__item", { href: `#/${m.id}`, "aria-current": m.id === active ? "page" : null },
      icon(m.icon || m.id), m.title,
    );
    if (m.id === "proposte") item.append(el("span.nav__badge", { id: "badge-proposte", hidden: true }, "0"));
    nav.append(item);
  }
}

function renderActions(mod) {
  clear(actions);
  actions.append(
    el("a.btn.btn--ghost.btn--icon", { href: "#/impostazioni", "aria-label": "Impostazioni" }, icon("impostazioni")),
  );
}

function startApp() {
  if (!routerStarted) {
    for (const m of modules) addRoute(m.id, m.mount);
    routerStarted = true;
    startRouter({
      container: view,
      fallback: DEFAULT_ROUTE,
      onChange: (id) => {
        const mod = modules.find((m) => m.id === id);
        title.textContent = mod?.title || "Macroapp";
        renderNav();
        renderActions(mod);
      },
    });
  } else {
    // Rimonta la vista corrente dopo un cambio di sessione (es. casa appena creata).
    navigate(currentRoute() || DEFAULT_ROUTE);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
  unwatchBadge?.();
  unwatchBadge = watchPendingCount((n) => {
    const b = document.getElementById("badge-proposte");
    if (!b) return;
    b.textContent = String(n);
    b.hidden = n === 0;
  });
}

onSession((s) => {
  if (!s.user) { renderLogin(); return; }
  if (s.error) {
    clear(nav); clear(actions); title.textContent = "Errore";
    view.replaceChildren(
      el("div.card", {},
        el("h2", {}, "Qualcosa non va"),
        el("p", {}, s.error),
        el("p.small.muted", {}, "Controlla che Firestore sia creato nel progetto e che le regole siano pubblicate."),
        el("button.btn", { onclick: () => location.reload() }, "Riprova"),
      ),
    );
    return;
  }
  if (!s.householdId) {
    // Utente autenticato ma senza casa: onboarding (crea o unisciti).
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

// Service worker per installazione e cache dei file statici.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(console.warn));
}

// Contenuto condiviso da altre app (Web Share Target): per ora lo mettiamo in coda come proposta.
const params = new URLSearchParams(location.search);
if (params.get("share")) {
  sessionStorage.setItem("macroapp.share", JSON.stringify({
    title: params.get("title"), text: params.get("text"), url: params.get("url"),
  }));
  history.replaceState(null, "", "/#/proposte");
}
