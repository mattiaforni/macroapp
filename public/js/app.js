// Shell dell'app: autenticazione, navigazione, montaggio dei moduli.
import { startAuth, onSession, login, session, checkRedirectResult } from "./core/auth.js";
import { addRoute, startRouter, navigate, currentRoute, vaiA } from "./core/router.js";
import { attivaScorrimento } from "./core/scorrimento.js";
import { el, clear, icon, toast } from "./core/ui.js";
import { applicaTema } from "./core/theme.js";
import { ensureMyName } from "./core/household.js";
import { avviaRubrica, fermaRubrica, sincronizzaDaGoogle } from "./core/rubrica.js";
import { allineaNote } from "./core/note.js";
import { chiudiAscolti } from "./core/db.js";
import { ritornoDaGoogle } from "./core/google.js";
import { aggiornaAllAvvio as aggiornaNotifiche } from "./core/notifiche.js";
import { modules } from "./modules/registry.js";
import { sezioni, sezione, sezioneAttiva, scelte, suBarra, progettiDisponibili } from "./core/barra.js";
import { renderOnboarding } from "./components/onboarding.js";
import { closeSheet } from "./components/sheet.js";
import { apriMenu, chiudiMenu } from "./components/menu.js";
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
  menuBtn.hidden = true;
  clear(nav);
  clear(actions);
  title.textContent = "";
  view.replaceChildren(
    el("div.accesso", {},
      el("h2", {}, "Debiti e Doveri"),
      el("p.muted", {}, "Lista, spese, diario, task e manuale di casa."),
      el("button.btn.btn--primario", { onclick: () => login().catch((e) => toast(e.code || e.message)) }, "Accedi con Google"),
      loginError ? el("p.errore", {}, `Accesso non riuscito: ${loginError}`) : null,
      el("p.meta", {}, `versione ${VERSION}`),
    ),
  );
}

// Barra in basso: le sezioni scelte dalla persona (core/barra.js), nell'ordine scelto; la prima è la
// pagina d'apertura. Un progetto in barra porta il suo colore.
const idsBarra = []; // id delle sezioni, aggiornato sul posto: lo legge anche lo scorrimento col dito
const primaSezione = () => idsBarra[0] || "diario";
const routeNote = new Set(modules.map((m) => m.id));
function aggiornaBarra() {
  idsBarra.splice(0, idsBarra.length, ...scelte());
  // Le route dei progetti in barra: `progetto-<id>` monta la pagina Progetto su quel progetto.
  for (const id of idsBarra) if (!routeNote.has(id)) { const s = sezione(id); if (s) { addRoute(id, s.mount); routeNote.add(id); } }
}

function renderNav(active) {
  const attiva = sezioneAttiva(active);
  nav.replaceChildren(...sezioni().map((s) =>
    el("a", { href: `#/${s.id}`, "aria-current": s.id === attiva ? "page" : null, "data-colore": s.colore }, icon(s.icon), s.title),
  ));
}

// Azioni in testata per pagina, a destra: le dà il modulo (`azioni()`), es. la cronologia dei prodotti nella Lista.
// Solo orientamento: l'azione principale resta in basso a destra.
function renderActions(id) {
  clear(actions);
  const mod = modules.find((m) => m.id === id);
  if (mod?.azioni) actions.append(...mod.azioni());
}

// Pulsante del menu a sinistra, prima del titolo: c'è solo quando si è dentro l'app.
const menuBtn = el("button.tondo.tondo--piatto.testata__menu", { type: "button", "aria-label": "Menu", hidden: true, onclick: () => apriMenu() }, icon("menu"));
title.before(menuBtn);

function startApp() {
  menuBtn.hidden = false;
  // Ritorno dalla pagina di Google dopo il permesso: si va sulla pagina Google, che mostra com'è andata.
  if (ritornoDaGoogle()) vaiA("google");
  if (!routerStarted) {
    for (const m of modules) addRoute(m.id, m.mount);
    routerStarted = true;
    aggiornaBarra();
    // Quando la scelta cambia (pagina «Barra in basso») o arrivano i nomi dei progetti, la barra si ridisegna.
    suBarra(() => { aggiornaBarra(); if (session.user && session.householdId) renderNav(currentRoute() || primaSezione()); });
    progettiDisponibili().catch((e) => console.warn("barra", e));
    const inBarra = (id) => idsBarra.includes(sezioneAttiva(id));
    // Tra le sezioni della barra si passa anche scorrendo la pagina a sinistra o a destra (segue il dito).
    attivaScorrimento(view, idsBarra, () => sezioneAttiva(currentRoute() || primaSezione()), (id) => sezione(id));
    startRouter({
      container: view,
      fallback: primaSezione,
      // Come in Leghe: tra le sezioni della barra cambio secco; da una pagina del menu a una sezione
      // della barra si torna con una dissolvenza breve; verso una pagina del menu si entra sfumando
      // (menu e pulsanti nelle pagine passano da vaiA, che entra sempre).
      transizione: (da, a) => (inBarra(a) ? (inBarra(da) ? null : "torna") : "entra"),
      onChange: (id) => {
        closeSheet({ fromHistory: true, subito: true });
        chiudiMenu();
        const mod = sezione(id)?.modulo || modules.find((m) => m.id === id);
        // Un modulo può dare un titolo che dipende da cosa mostra (la pagina Progetto: il nome del progetto).
        title.textContent = mod?.titoloCorrente?.() || mod?.title || "Debiti e Doveri";
        renderNav(id);
        renderActions(id);
        window.scrollTo(0, 0);
      },
    });
  } else {
    // Rimonta la vista corrente dopo un cambio di sessione (es. casa appena creata).
    navigate(currentRoute() || primaSezione());
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
  // Lavori di fondo, non bloccanti.
  avviaRubrica(); // persone del manuale, per riconoscerle nei task
  // Contatti Google (se collegati): elenco pronto per le ricerche e recapiti aggiornati in rubrica.
  sincronizzaDaGoogle().catch((e) => {
    if (e.motivo === "scaduto") toast("Google: il collegamento è scaduto, ricollegalo dal menu", { ms: 5000 });
    else console.warn("contatti", e);
  });
  ensureMyName().catch((e) => console.warn("ensureMyName", e));
  aggiornaNotifiche().catch((e) => console.warn("notifiche", e)); // token di questo telefono, se le notifiche sono attive
  materializeRecurring().catch((e) => console.warn("materializeRecurring", e));
  // Le tue note dei progetti condivisi diventano della casa (7/11), anche quelle scritte prima.
  allineaNote().catch((e) => console.warn("allineaNote", e));
}

onSession((s) => {
  if (!s.user) { fermaRubrica(); chiudiAscolti(); renderLogin(); return; }
  if (s.error) {
    menuBtn.hidden = true; clear(nav); clear(actions); title.textContent = "Errore";
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
    menuBtn.hidden = true; clear(nav); clear(actions); title.textContent = "Benvenuto";
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
  // Versione nuova pubblicata mentre l'app restava aperta in background (14/11, Mattia: «una modalità più agile di
  // aggiornamento»): il service worker cambia di rado, quindi non basta il suo controllerchange. Tornando nell'app si
  // rilegge version.js (lo riscrive ogni deploy col commit pubblicato): se è cambiata la pagina si ricarica da sola; con
  // un foglio o il menu aperti (una nota a metà, una registrazione) lo chiede soltanto, e lo rifà al prossimo ritorno.
  let ultimoControllo = Date.now();
  let avvisata = false;
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible" || Date.now() - ultimoControllo < 10_000) return;
    ultimoControllo = Date.now();
    try {
      const r = await fetch(`/js/version.js?v=${Date.now()}`, { cache: "no-store" });
      const nuova = r.ok ? (await r.text()).match(/VERSION\s*=\s*"([^"]+)"/)?.[1] : null;
      if (!nuova || nuova === VERSION || reloaded) return;
      if (document.getElementById("foglio").hidden && !document.querySelector(".menu.aperto")) { reloaded = true; location.reload(); return; }
      if (!avvisata) { avvisata = true; toast("C'è una versione nuova", { azione: { label: "Ricarica", fn: () => location.reload() } }); }
    } catch (e) { /* senza rete: al prossimo ritorno */ }
  });
  // Tocco su una notifica con l'app già aperta: il service worker dice quale pagina mostrare.
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.tipo !== "apri") return;
    const hash = new URL(e.data.url, location.origin).hash;
    if (hash && location.hash !== hash) location.hash = hash;
  });
}

// Testo condiviso da altre app (Web Share Target): finisce nel diario, pronto da salvare.
const params = new URLSearchParams(location.search);
if (params.get("share")) {
  const text = [params.get("title"), params.get("text"), params.get("url")].filter(Boolean).join("\n");
  sessionStorage.setItem("macroapp.share", text);
  // Con delle immagini (14/11): sw.js le ha messe nella cache «dd-condivisi», il Diario le prende da lì.
  if (params.get("foto")) sessionStorage.setItem("macroapp.share.foto", "1");
  history.replaceState(null, "", "/#/diario");
}

// Ritorno dalla banca (Enable Banking rimanda su /banca?code=…&state=…, o ?error=…): l'esito si mette
// da parte e si va alla pagina Banca, che conclude il collegamento appena c'è la sessione.
if (location.pathname === "/banca") {
  try {
    sessionStorage.setItem("macroapp.banca.ritorno", JSON.stringify({
      code: params.get("code"), state: params.get("state"), error: params.get("error"), description: params.get("error_description"),
    }));
  } catch (e) {}
  history.replaceState(null, "", "/#/banca");
}
