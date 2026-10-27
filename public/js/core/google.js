// Account Google collegato una volta sola: Contatti (sola lettura), Calendario (lettura e scrittura
// degli eventi), Drive (sola lettura).
//
// Il permesso si dà una volta: si passa dalla pagina di Google, che torna su /google-contatti
// (percorso del primo collegamento, già autorizzato nel client OAuth), e il server conserva il
// refresh token (functions/src/google/account.js). L'app riceve solo permessi di un'ora, che tiene
// in localStorage per non chiederli a ogni apertura, e con quelli chiama direttamente le API di
// Google (`chiamaGoogle`). I tre permessi sono facoltativi nella pagina di Google: `statoGoogle().permessi`
// dice quali ci sono. I contatti stanno in contatti-google.js, il calendario in calendario.js, Drive in drive.js.
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-functions.js";
import { functions } from "./firebase.js";
import { session } from "./auth.js";

const PERCORSO = "/google-contatti";
const CHIAVE = "macroapp.google.accesso";
const PAGINA_RITORNO = "google"; // dove si va al ritorno dalla pagina di Google (modules/google)

const ritorno = () => `${location.origin}${PERCORSO}`;

/** Errore con `motivo` leggibile dall'interfaccia (vedi messaggioGoogle). */
function errore(err) {
  const motivo = err?.motivo || err?.details?.motivo || null;
  return Object.assign(new Error(err?.message || String(err)), { motivo, code: err?.code });
}
const chiama = (dati) => httpsCallable(functions, "google")(dati).then((r) => r.data, (e) => { throw errore(e); });

// ───────────── Stato del collegamento ─────────────

const NESSUNO = { contatti: false, calendario: false, drive: false };

/**
 * { collegato, scaduto, email, permessi: { contatti, calendario, drive } } dal profilo (users/{uid}.google,
 * scritto dal server). Chi ha collegato solo i contatti, prima del calendario e di Drive, ha ancora il
 * vecchio campo `contattiGoogle`: vale come collegamento con il solo permesso dei contatti.
 */
export function statoGoogle() {
  const p = session.profile || {};
  const g = p.google || (p.contattiGoogle ? { ...p.contattiGoogle, permessi: { ...NESSUNO, contatti: true } } : null);
  return {
    collegato: !!g?.collegato, scaduto: !!g?.scaduto, email: g?.email || "",
    permessi: { ...NESSUNO, ...(g?.collegato ? g.permessi || {} : {}) },
    dal: g?.dal || null,
  };
}
export const googleCollegato = () => statoGoogle().collegato;
/** Se c'è il permesso per quella parte: "contatti" | "calendario" | "drive". */
export const permessoGoogle = (parte) => statoGoogle().permessi[parte];

const ascoltatori = new Set();
/** fn() quando cambia lo stato del collegamento; ritorna la funzione per smettere. */
export function suGoogle(fn) { ascoltatori.add(fn); return () => ascoltatori.delete(fn); }
function avvisa() { ascoltatori.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }

// Il profilo in memoria si aggiorna a mano: rileggerlo farebbe ridisegnare l'app e chiudere i fogli.
function segnaStato(g) {
  if (!session.profile) return;
  if (g) session.profile.google = g;
  else delete session.profile.google;
  delete session.profile.contattiGoogle;
  avvisa();
}

// ───────────── Permesso di un'ora ─────────────

function tokenSalvato() {
  try {
    const t = JSON.parse(localStorage.getItem(CHIAVE) || "null");
    return t && t.uid === session.user?.uid && t.scade > Date.now() + 60 * 1000 ? t.token : null;
  } catch (e) { return null; }
}
function salvaToken(r) {
  try { localStorage.setItem(CHIAVE, JSON.stringify({ uid: session.user.uid, token: r.accessToken, scade: r.scade })); } catch (e) {}
}
function dimenticaToken() { try { localStorage.removeItem(CHIAVE); } catch (e) {} }

const svuotamenti = new Set();
/** fn() quando il collegamento cambia o cade: chi tiene dati in memoria (contatti, eventi) li butta. */
export function suSvuota(fn) { svuotamenti.add(fn); }
function svuota() { svuotamenti.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }

export async function permesso({ rinnova = false } = {}) {
  if (!rinnova) {
    const t = tokenSalvato();
    if (t) return t;
  }
  try {
    const r = await chiama({ azione: "token", rinnova });
    salvaToken(r);
    return r.accessToken;
  } catch (e) {
    if (e.motivo === "scaduto" || e.motivo === "non-collegato") {
      const g = session.profile?.google || session.profile?.contattiGoogle || {};
      segnaStato({ ...g, collegato: false, scaduto: e.motivo === "scaduto" });
      dimenticaToken();
      svuota();
    }
    throw e;
  }
}

/**
 * Una chiamata alle API di Google con il permesso dell'utente: fetch con il token, rinnovato una volta
 * se Google risponde 401. `url` intero o con `query` (oggetto → parametri). Ritorna il JSON della risposta
 * ({} se vuota). Gli errori portano `motivo` (reason di Google, status) e `status`.
 */
export async function chiamaGoogle(url, { method = "GET", query = null, body = null } = {}) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(query || {})) if (v != null && v !== "") u.searchParams.set(k, v);
  let token = await permesso();
  let riprovato = false;
  for (;;) {
    const r = await fetch(u, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401 && !riprovato) { // permesso revocato o scaduto prima del previsto
      riprovato = true;
      dimenticaToken();
      token = await permesso({ rinnova: true });
      continue;
    }
    if (r.status === 204) return {};
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const motivo = j.error?.errors?.[0]?.reason || j.error?.details?.find?.((d) => d.reason)?.reason || j.error?.status || String(r.status);
      throw Object.assign(new Error(j.error?.message || `Errore ${r.status}`), { motivo, status: r.status });
    }
    return j;
  }
}

// ───────────── Collegamento ─────────────

/** Manda alla pagina di Google per dare il permesso; si torna su /google-contatti. */
export async function collegaGoogle() {
  const { url } = await chiama({ azione: "avvio", ritorno: ritorno() });
  location.assign(url);
}

let collegamento = null;

/**
 * All'avvio dell'app: se si sta tornando dalla pagina di Google, porta l'indirizzo sulla pagina Google
 * e completa il collegamento in sottofondo (collegamentoInCorso). Ritorna true se era così.
 */
export function ritornoDaGoogle() {
  if (location.pathname !== PERCORSO) return false;
  const p = new URLSearchParams(location.search);
  history.replaceState(null, "", `/#/${PAGINA_RITORNO}`);
  collegamento = (async () => {
    const no = p.get("error");
    if (no) throw Object.assign(new Error(no), { motivo: no === "access_denied" ? "negato" : no });
    const r = await chiama({ azione: "collega", code: p.get("code"), state: p.get("state"), ritorno: ritorno() });
    salvaToken(r);
    svuota();
    segnaStato({ collegato: true, scaduto: false, email: r.email, permessi: r.permessi || NESSUNO, dal: new Date() });
    return r;
  })();
  collegamento.catch(() => {}); // l'errore lo mostra la pagina Google
  return true;
}

/** La promessa del collegamento appena tornati da Google, o null. La consegna una volta sola. */
export function collegamentoInCorso() {
  const c = collegamento;
  collegamento = null;
  return c;
}

export async function scollegaGoogle() {
  await chiama({ azione: "scollega" });
  dimenticaToken();
  svuota();
  segnaStato(null);
}

/** { titolo, testo } per un errore di collegamento o di lettura. `cosa` = "i contatti", "il calendario", "Drive". */
export function messaggioGoogle(err, cosa = "Google") {
  const m = String(err?.motivo || err?.code || "");
  if (m === "client") return { titolo: "Manca il client Google", testo: "Il server non ha ancora ID e secret del client OAuth: si sistemano con un nuovo deploy." };
  if (m === "scaduto") return { titolo: "Collegamento scaduto", testo: "Google ha ritirato il permesso. Ricollega l'account dalla pagina Google." };
  if (m === "non-collegato") return { titolo: "Google non collegato", testo: "Collega l'account dalla pagina Google, nel menu." };
  if (m === "negato") return { titolo: "Permesso non dato", testo: "Nella pagina di Google il collegamento è stato annullato." };
  if (m === "scope") return { titolo: "Nessun accesso spuntato", testo: "Nella pagina di Google va lasciata almeno una spunta (contatti, calendario o Drive)." };
  if (m === "state") return { titolo: "Collegamento non riuscito", testo: "La richiesta era scaduta. Riprova a collegare." };
  if (m === "redirect_uri_mismatch") return { titolo: "Indirizzo di ritorno non autorizzato", testo: `Va aggiunto ${ritorno()} agli URI di reindirizzamento del client OAuth.` };
  if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions/.test(m)) {
    return { titolo: `Permesso mancante per ${cosa}`, testo: "Ricollega Google dalla pagina Google e lascia la spunta anche su questa parte." };
  }
  if (/SERVICE_DISABLED|accessNotConfigured/.test(m)) {
    return { titolo: `${cosa} non raggiungibile`, testo: "L'API di Google non risulta attiva nel progetto Google Cloud dell'app: un nuovo deploy la attiva." };
  }
  if (/PERMISSION_DENIED|403/.test(m)) return { titolo: `${cosa} non raggiungibile`, testo: err?.message || "Google non permette questa operazione." };
  if (m === "404" || m === "notFound") return { titolo: "Non trovato", testo: err?.message || "Google non trova quello che l'app ha chiesto." };
  return { titolo: `${cosa} non raggiungibile`, testo: err?.message || "Errore sconosciuto" };
}
