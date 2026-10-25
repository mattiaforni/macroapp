// Notifiche push (Firebase Cloud Messaging).
//
// Ogni telefono che le attiva ha un id casuale (localStorage) e il suo token in
// users/{uid}.dispositivi.<id> = { token, nome, aggiornato }. Le preferenze valgono per la persona,
// su tutti i suoi telefoni: users/{uid}.notifiche.<categoria> (false = spenta, assente = accesa).
// Chi riceve cosa lo decide la funzione `avvisa` (functions/src/avvisi.js): l'app la chiama dopo
// ogni scrittura condivisa che può interessare l'altra persona (`segnala`, chiamata da core/db.js).
// La notifica la mostra il service worker (sw.js); toccandola si apre la pagina giusta.
import { doc, getDoc, updateDoc, deleteField, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-functions.js";
import { app, db, functions } from "./firebase.js";
import { session } from "./auth.js";

const SDK = "https://www.gstatic.com/firebasejs/11.3.0/firebase-messaging.js";
const CHIAVE_ID = "macroapp.notifiche.dispositivo";
const CHIAVE_TOKEN = "macroapp.notifiche.token"; // ultimo token salvato da questo telefono

/** [chiave, titolo, descrizione, icona] */
export const CATEGORIE = [
  ["spese", "Spese condivise", "Spese e pareggi aggiunti dall'altra persona", "spese"],
  ["task", "Task condivisi", "Task nuovi e task fatti", "task"],
  ["lista", "Lista della spesa", "Cose aggiunte, riunite in una notifica sola", "lista"],
  ["banca", "Banca, solo per te", "Spese da confermare, consenso interrotto", "banca"],
];

const avvisa = httpsCallable(functions, "avvisa");

function leggi(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function scrivi(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }

function idDispositivo() {
  let id = leggi(CHIAVE_ID);
  if (!id) {
    const r = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random()}`;
    id = `d${r.replace(/[^a-z0-9]/gi, "").slice(0, 24)}`;
    scrivi(CHIAVE_ID, id);
  }
  return id;
}

/** Id di questo telefono nell'elenco (null se non ha mai attivato le notifiche). */
export const idQuestoTelefono = () => leggi(CHIAVE_ID);

/** Nome leggibile del telefono, per riconoscerlo nell'elenco. */
function nomeDispositivo() {
  const ua = navigator.userAgent;
  const so = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Browser";
  const br = /EdgA?\//.test(ua) ? "Edge" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /CriOS|Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "";
  return [so, br].filter(Boolean).join(" · ");
}

const iPhone = () => /iPhone|iPad/.test(navigator.userAgent);
const installata = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
const supportoBase = () => "serviceWorker" in navigator && "Notification" in window && "PushManager" in window;

/**
 * Stato su questo telefono: "attive" | "spente" | "bloccate" (permesso negato nel browser)
 * | "da-installare" (iPhone: solo dall'app aggiunta alla schermata Home) | "non-supportate".
 * `profilo` = users/{uid} appena letto.
 */
export function statoQui(profilo) {
  if (!supportoBase()) return iPhone() && !installata() ? "da-installare" : "non-supportate";
  if (Notification.permission === "denied") return "bloccate";
  const mio = profilo?.dispositivi?.[leggi(CHIAVE_ID)];
  return mio?.token && Notification.permission === "granted" ? "attive" : "spente";
}

export async function leggiProfilo() {
  const snap = await getDoc(doc(db, "users", session.user.uid));
  return snap.exists() ? snap.data() : {};
}

async function token() {
  const { getMessaging, getToken, isSupported } = await import(SDK);
  if (!(await isSupported())) throw new Error("Questo browser non riceve notifiche push");
  // Lo stesso service worker dell'app (sw.js), che gestisce l'arrivo e il tocco della notifica.
  const reg = (await navigator.serviceWorker.getRegistration("/")) || (await navigator.serviceWorker.register("/sw.js"));
  return getToken(getMessaging(app), { serviceWorkerRegistration: reg });
}

async function salvaToken(t) {
  await updateDoc(doc(db, "users", session.user.uid), {
    [`dispositivi.${idDispositivo()}`]: { token: t, nome: nomeDispositivo(), aggiornato: serverTimestamp() },
  });
  scrivi(CHIAVE_TOKEN, t);
}

/**
 * Attiva le notifiche su questo telefono. Va chiamata dal tocco di un pulsante: il permesso si
 * chiede subito, prima di ogni attesa (Safari lo nega se non nasce da un gesto).
 */
export async function attiva() {
  const permesso = await Notification.requestPermission();
  if (permesso !== "granted") {
    throw new Error(permesso === "denied" ? "Permesso negato: va riattivato dalle impostazioni del browser per questo sito" : "Permesso non dato");
  }
  const t = await token();
  if (!t) throw new Error("Il browser non ha dato un indirizzo per le notifiche");
  await salvaToken(t);
}

/** Toglie questo telefono dall'elenco: le notifiche non arrivano più qui. */
export async function disattiva() {
  try {
    const { getMessaging, deleteToken } = await import(SDK);
    await deleteToken(getMessaging(app));
  } catch (e) { console.warn("notifiche: token non cancellato", e); }
  await updateDoc(doc(db, "users", session.user.uid), { [`dispositivi.${idDispositivo()}`]: deleteField() });
  scrivi(CHIAVE_TOKEN, null);
}

/** Accende o spegne una categoria per la persona (tutti i suoi telefoni). */
export function scegliCategoria(chiave, accesa) {
  return updateDoc(doc(db, "users", session.user.uid), { [`notifiche.${chiave}`]: accesa });
}

/** Notifica di prova ai propri telefoni. Ritorna quanti l'hanno ricevuta. */
export async function prova() {
  const res = await avvisa({ prova: true });
  return res.data?.inviati || 0;
}

/**
 * All'avvio: il token di un telefono può cambiare (aggiornamenti del browser, FCM che lo rinnova).
 * Se le notifiche sono attive qui, lo si rilegge e si aggiorna l'elenco solo se è cambiato;
 * se il permesso è stato tolto dal browser, il telefono esce dall'elenco.
 */
export async function aggiornaAllAvvio() {
  const salvato = leggi(CHIAVE_TOKEN);
  if (!salvato || !supportoBase()) return;
  if (Notification.permission !== "granted") { await disattiva(); return; }
  const t = await token();
  if (t && t !== salvato) await salvaToken(t);
}

/**
 * Dopo una scrittura che l'altra persona potrebbe voler sapere: la funzione `avvisa` rilegge il
 * documento e decide. Si chiama a scrittura arrivata sul server (senza rete parte quando torna).
 */
let attesaLista = null;
export function segnala(coll, id, evento) {
  const manda = () => avvisa({ coll, id, evento }).catch((e) => console.warn("notifiche: avviso non inviato", e.code || e.message));
  // Lista: «latte, uova, pane» sono tre scritture, ma basta l'ultima chiamata (il server riassume
  // le aggiunte recenti della stessa persona). Si aspetta un attimo che finiscano.
  if (coll !== "shopping_items") { manda(); return; }
  clearTimeout(attesaLista);
  attesaLista = setTimeout(manda, 1500);
}
