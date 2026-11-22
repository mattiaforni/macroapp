// Pagina di consenso del connettore MCP (22/11, docs/PIANO-DRIVE-MCP.md, passo 4). Claude (claude.ai, anche dall'app del
// telefono) apre /collega-claude con la richiesta OAuth (client_id, redirect_uri, state, code_challenge…). Qui:
// 1. il server controlla la richiesta (/oauth/verifica: client registrato, ritorno ammesso, PKCE) e dice chi chiede;
// 2. si entra con Google come nell'app (Firebase Auth; di solito si è già dentro);
// 3. «Consenti» manda l'ID token di Firebase a /oauth/consenti, che lo verifica e risponde con l'indirizzo di ritorno a
//    Claude con il codice; «Annulla» torna a Claude con access_denied.
// Il server sta in functions/src/mcp.js. Niente si scrive nell'app da qui.
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, signOut } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-auth.js";
import { auth, googleProvider } from "./core/firebase.js";
import { el, icon } from "./core/ui.js";

const vista = document.getElementById("view");
const q = Object.fromEntries(new URLSearchParams(location.search));
let verifica = null; // { cliente, ritorno } se la richiesta è valida
let utente = null;
let inviando = false;

async function posta(percorso, corpo) {
  const r = await fetch(percorso, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw Object.assign(new Error(j.error_description || j.error || `Errore ${r.status}`), { codice: j.error });
  return j;
}

/** Torna a Claude con un errore (solo dopo che il server ha detto che l'indirizzo di ritorno è registrato). */
function tornaConErrore(errore) {
  const u = new URL(q.redirect_uri);
  u.searchParams.set("error", errore);
  if (q.state) u.searchParams.set("state", q.state);
  location.assign(u.toString());
}

function mostra(...nodi) { vista.replaceChildren(...nodi.filter(Boolean)); }

function render() {
  if (!verifica) return;
  const cosa = el("div.blocco", {},
    el("h3", {}, `${verifica.cliente} chiede di usare Debiti e Doveri`),
    el("p", {}, "La chat potrà leggere quello che vedi nell'app: note e sintesi dei progetti, task, spese, lista della spesa, manuale e rubrica, calendari, documenti di Drive dei progetti."),
    el("p", {}, "Potrà solo proporre: una nota, un task, una voce della lista… Le proposte le trovi nell'app, in Proposte e nella pagina del progetto, e niente cambia finché non le confermi."),
    el("p.meta", {}, `Si torna su ${verifica.ritorno}. Per togliere il collegamento lo rimuovi dai connettori di Claude.`),
  );
  if (!utente) {
    mostra(cosa, el("div.blocco", {}, el("h3", {}, "Entra con Google"), el("p", {}, "Con lo stesso account che usi nell'app.")),
      el("button.fab", { type: "button", "aria-label": "Entra con Google", onclick: entra }, icon("collegamento"), "Entra"));
    return;
  }
  mostra(cosa,
    el("div.blocco", {}, el("h3", {}, utente.email || utente.displayName || "Account"),
      el("p", {}, "È l'account con cui la chat leggerà i dati. ", el("button.btn.btn--piatto", { type: "button", onclick: () => signOut(auth) }, "Cambia account"))),
    el("div.segmenti", { style: "padding-top:18px" }, el("button.btn", { type: "button", onclick: () => tornaConErrore("access_denied") }, "Annulla")),
    el("button.fab", { type: "button", disabled: inviando, "aria-label": "Consenti", onclick: consenti }, icon("spunta"), inviando ? "Collego…" : "Consenti"));
}

async function entra() {
  const telefono = window.matchMedia("(pointer: coarse)").matches;
  try { await (telefono ? signInWithRedirect(auth, googleProvider) : signInWithPopup(auth, googleProvider)); }
  catch (e) { if (/popup/.test(e.code || "")) await signInWithRedirect(auth, googleProvider); else errore("Accesso non riuscito", e.message); }
}

async function consenti() {
  inviando = true; render();
  try {
    const idToken = await utente.getIdToken();
    const r = await posta("/oauth/consenti", { ...q, idToken });
    mostra(el("div.vuoto", {}, el("b", {}, "Collegato"), el("p", {}, "Torno a Claude…")));
    location.assign(r.redirect);
  } catch (e) {
    inviando = false;
    errore("Collegamento non riuscito", e.message);
  }
}

function errore(titolo, testo) {
  mostra(el("div.vuoto", {}, el("b", {}, titolo), el("p", {}, testo)),
    verifica ? el("div.segmenti", { style: "justify-content:center" }, el("button.btn", { type: "button", onclick: () => { render(); } }, "Riprova")) : null);
}

mostra(el("div.vuoto", {}, el("b", {}, "Un momento"), el("p", {}, "Controllo la richiesta di Claude…")));
getRedirectResult(auth).catch((e) => console.warn("accesso", e.code || e.message));
posta("/oauth/verifica", q).then((v) => {
  verifica = v;
  onAuthStateChanged(auth, (u) => { utente = u; render(); });
}, (e) => errore("Richiesta non valida", `${e.message}. Ricomincia l'aggiunta del connettore da Claude.`));
