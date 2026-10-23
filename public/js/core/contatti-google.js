// Google Contatti collegati una volta sola, in sola lettura.
//
// Il permesso si dà una volta: si passa dalla pagina di Google, che torna su /google-contatti,
// e il server conserva il refresh token (functions/src/google/contatti.js). L'app riceve solo
// permessi di un'ora, che tiene in localStorage per non chiederli a ogni apertura.
// L'elenco dei contatti si legge con la People API e resta in memoria per la sessione: serve a
// cercare mentre scrivi un nome. In rubrica entrano solo le persone che colleghi; i loro
// recapiti si aggiornano da Google (sincronizzaDaGoogle in rubrica.js).
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-functions.js";
import { functions } from "./firebase.js";
import { session } from "./auth.js";

const PERCORSO = "/google-contatti";
const CHIAVE = "macroapp.contatti.accesso";
const FRESCO = 10 * 60 * 1000; // dopo 10 minuti l'elenco si rilegge alla prima ricerca
const CAMPI = "names,nicknames,phoneNumbers,emailAddresses,addresses,organizations";

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const ritorno = () => `${location.origin}${PERCORSO}`;

/** Errore con `motivo` leggibile dall'interfaccia (vedi messaggioContatti). */
function errore(err) {
  const motivo = err?.motivo || err?.details?.motivo || null;
  return Object.assign(new Error(err?.message || String(err)), { motivo, code: err?.code });
}
const chiama = (dati) => httpsCallable(functions, "contatti")(dati).then((r) => r.data, (e) => { throw errore(e); });

// ───────────── Stato del collegamento ─────────────

/** { collegato, scaduto, email } dal profilo (users/{uid}.contattiGoogle, scritto dal server). */
export function statoContatti() {
  const c = session.profile?.contattiGoogle;
  return { collegato: !!c?.collegato, scaduto: !!c?.scaduto, email: c?.email || "" };
}
export const contattiCollegati = () => statoContatti().collegato;

// Il profilo in memoria si aggiorna a mano: rileggerlo farebbe ridisegnare l'app e chiudere i fogli.
function segnaStato(c) {
  if (!session.profile) return;
  if (c) session.profile.contattiGoogle = c;
  else delete session.profile.contattiGoogle;
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

async function permesso({ rinnova = false } = {}) {
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
      segnaStato({ ...(session.profile?.contattiGoogle || {}), collegato: false, scaduto: e.motivo === "scaduto" });
      dimenticaToken();
      svuota();
    }
    throw e;
  }
}

// ───────────── Collegamento ─────────────

/** Manda alla pagina di Google per dare il permesso; si torna su /google-contatti. */
export async function collegaContatti() {
  const { url } = await chiama({ azione: "avvio", ritorno: ritorno() });
  location.assign(url);
}

let collegamento = null;

/**
 * All'avvio dell'app: se si sta tornando dalla pagina di Google, porta l'indirizzo sul Manuale
 * e completa il collegamento in sottofondo (collegamentoInCorso). Ritorna true se era così.
 */
export function ritornoDaGoogle() {
  if (location.pathname !== PERCORSO) return false;
  const p = new URLSearchParams(location.search);
  history.replaceState(null, "", "/#/manuale");
  collegamento = (async () => {
    const no = p.get("error");
    if (no) throw Object.assign(new Error(no), { motivo: no === "access_denied" ? "negato" : no });
    const r = await chiama({ azione: "collega", code: p.get("code"), state: p.get("state"), ritorno: ritorno() });
    salvaToken(r);
    segnaStato({ collegato: true, scaduto: false, email: r.email });
    svuota();
    return r;
  })();
  collegamento.catch(() => {}); // l'errore lo mostra il foglio dei contatti
  return true;
}

/** La promessa del collegamento appena tornati da Google, o null. La consegna una volta sola. */
export function collegamentoInCorso() {
  const c = collegamento;
  collegamento = null;
  return c;
}

export async function scollegaContatti() {
  await chiama({ azione: "scollega" });
  dimenticaToken();
  svuota();
  segnaStato(null);
}

// ───────────── Elenco dei contatti ─────────────

let elenco = null;   // promessa dell'elenco in lettura o letto
let letti = [];      // ultimo elenco letto, per le ricerche mentre si scrive
let lettoAlle = 0;
const ascoltatori = new Set();

function svuota() { elenco = null; letti = []; lettoAlle = 0; }

/** fn() quando arriva un elenco nuovo; ritorna la funzione per smettere. */
export function suContatti(fn) { ascoltatori.add(fn); return () => ascoltatori.delete(fn); }

function daGoogle(p) {
  const name = p.names?.[0]?.displayName?.trim();
  if (!name) return null;
  const primo = (v) => (v || []).find((x) => x.metadata?.primary) || (v || [])[0];
  return {
    googleId: p.resourceName,
    name,
    nickname: p.nicknames?.[0]?.value?.trim() || "",
    phone: primo(p.phoneNumbers)?.value || "",
    email: primo(p.emailAddresses)?.value || "",
    address: (primo(p.addresses)?.formattedValue || "").replace(/\n+/g, ", "),
    org: primo(p.organizations)?.name || "",
  };
}

async function leggiTutti() {
  let token = await permesso();
  let riprovato = false;
  const out = [];
  let pagina = "";
  for (;;) {
    const url = new URL("https://people.googleapis.com/v1/people/me/connections");
    url.searchParams.set("personFields", CAMPI);
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("sortOrder", "FIRST_NAME_ASCENDING");
    if (pagina) url.searchParams.set("pageToken", pagina);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 401 && !riprovato) { // permesso revocato o scaduto prima del previsto
      riprovato = true;
      dimenticaToken();
      token = await permesso({ rinnova: true });
      continue;
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const motivo = j.error?.details?.find?.((d) => d.reason)?.reason || j.error?.status || String(r.status);
      throw Object.assign(new Error(j.error?.message || `Errore ${r.status}`), { motivo });
    }
    for (const p of j.connections || []) {
      const c = daGoogle(p);
      if (c) out.push(c);
    }
    pagina = j.nextPageToken || "";
    if (!pagina) return out;
  }
}

/** Tutti i contatti: [{ googleId, name, nickname, phone, email, address, org }]. [] se non collegato. */
export function caricaContatti({ forza = false } = {}) {
  if (!contattiCollegati()) return Promise.resolve([]);
  if (elenco && !forza && Date.now() - lettoAlle < FRESCO) return elenco;
  lettoAlle = Date.now();
  const questo = leggiTutti().then(
    (c) => {
      if (elenco === questo) { letti = c; ascoltatori.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }
      return c;
    },
    (err) => { if (elenco === questo) { elenco = null; lettoAlle = 0; } throw err; },
  );
  elenco = questo;
  return questo;
}

/**
 * Contatti in cui una parola del nome (o del soprannome) comincia con q, i più vicini prima.
 * Lavora sull'elenco già letto; se manca lo chiede, e suContatti avvisa quando arriva.
 */
export function cercaContatti(q, quanti = 5) {
  const t = norm(q);
  if (!t) return [];
  if (contattiCollegati() && (!elenco || Date.now() - lettoAlle >= FRESCO)) caricaContatti().catch(() => {});
  const punteggio = (c) => {
    const n = norm(c.name);
    const s = norm(c.nickname);
    if (n === t || s === t) return 0;
    if (n.startsWith(t) || s.startsWith(t)) return 1;
    if (`${n} ${s}`.split(" ").some((w) => w.startsWith(t))) return 2;
    if (t.includes(" ") && n.includes(t)) return 3;
    return 9;
  };
  return letti.map((c) => [punteggio(c), c]).filter(([p]) => p < 9)
    .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).slice(0, quanti).map(([, c]) => c);
}

/**
 * Il contatto che corrisponde a un nome senza dubbi: nome completo o soprannome uguale, oppure
 * nome proprio di una sola persona. Serve a collegare le persone nominate dall'AI.
 */
export function contattoUnico(nome) {
  const t = norm(nome);
  if (!t || !letti.length) return null;
  const esatti = letti.filter((c) => norm(c.name) === t || norm(c.nickname) === t);
  if (esatti.length) return esatti.length === 1 ? esatti[0] : null;
  if (t.includes(" ")) return null;
  const perNome = letti.filter((c) => norm(c.name).split(" ")[0] === t);
  return perNome.length === 1 ? perNome[0] : null;
}

export const contattoDaId = (googleId) => letti.find((c) => c.googleId === googleId) || null;

/** Contatti che si chiamano esattamente così (nome completo o soprannome). */
export function contattiConNome(nome) {
  const t = norm(nome);
  return t ? letti.filter((c) => norm(c.name) === t || norm(c.nickname) === t) : [];
}

/** La scheda del contatto su contacts.google.com, dove si modifica. */
export const linkGoogle = (googleId) => `https://contacts.google.com/person/${String(googleId).replace(/^people\//, "")}`;

/** Una riga sotto il nome per distinguere omonimi: azienda, mail o numero. */
export const dettaglioContatto = (c) => c.org || c.email || c.phone || "";

/** { titolo, testo } per un errore di collegamento o di lettura. */
export function messaggioContatti(err) {
  const m = String(err?.motivo || err?.code || "");
  if (m === "client") return { titolo: "Manca il client Google", testo: "Il server non ha ancora ID e secret del client OAuth: si sistemano con un nuovo deploy." };
  if (m === "scaduto") return { titolo: "Collegamento scaduto", testo: "Google ha ritirato il permesso. Ricollega i contatti." };
  if (m === "negato") return { titolo: "Permesso non dato", testo: "Nella pagina di Google il collegamento è stato annullato." };
  if (m === "scope") return { titolo: "Accesso ai contatti non spuntato", testo: "Nella pagina di Google va lasciata la spunta sull'accesso ai contatti." };
  if (m === "state") return { titolo: "Collegamento non riuscito", testo: "La richiesta era scaduta. Riprova a collegare." };
  if (m === "redirect_uri_mismatch") return { titolo: "Indirizzo di ritorno non autorizzato", testo: `Va aggiunto ${ritorno()} agli URI di reindirizzamento del client OAuth.` };
  if (/SERVICE_DISABLED|ACCESS_TOKEN_SCOPE_INSUFFICIENT|PERMISSION_DENIED|403/.test(m)) {
    return { titolo: "Contatti non raggiungibili", testo: "La People API non risulta attiva nel progetto Google Cloud dell'app." };
  }
  return { titolo: "Contatti non raggiungibili", testo: err?.message || "Errore sconosciuto" };
}
