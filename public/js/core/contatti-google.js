// Google Contatti in sola lettura (People API). Il permesso si chiede solo quando tocchi
// «Prendi da Google Contatti», non all'accesso: chi non lo usa non lo vede mai.
// Il token dura un'ora e resta solo in questa scheda del browser (sessionStorage).
// Niente viene copiato in blocco: in rubrica entrano solo le persone che scegli.
import {
  GoogleAuthProvider, reauthenticateWithPopup, reauthenticateWithRedirect,
} from "https://www.gstatic.com/firebasejs/11.3.0/firebase-auth.js";
import { auth } from "./firebase.js";

const SCOPE = "https://www.googleapis.com/auth/contacts.readonly";
const CHIAVE = "macroapp.contatti.token";
const DOPO = "macroapp.contatti.dopo"; // "1" mentre si passa dalla pagina di Google

const leggi = (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
const scrivi = (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) {} };

function provider() {
  const p = new GoogleAuthProvider();
  p.addScope(SCOPE);
  if (auth.currentUser?.email) p.setCustomParameters({ login_hint: auth.currentUser.email });
  return p;
}

function token() {
  try {
    const t = JSON.parse(leggi(CHIAVE) || "null");
    return t && t.scade > Date.now() ? t.token : null;
  } catch (e) { return null; }
}

function salvaToken(result) {
  const t = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
  if (t) scrivi(CHIAVE, JSON.stringify({ token: t, scade: Date.now() + 50 * 60 * 1000 }));
  return t || null;
}

/**
 * Token per leggere i contatti. Su computer apre la finestra di Google; su telefono passa
 * dalla pagina di Google e torna qui (ritorna null: la pagina sta per cambiare).
 */
export async function permessoContatti() {
  const t = token();
  if (t) return t;
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  const touch = window.matchMedia("(pointer: coarse)").matches;
  const redirect = async () => {
    // Google riporta all'indirizzo da cui si parte: si torna sempre sul Manuale, che riapre la scelta.
    scrivi(DOPO, "1");
    history.replaceState(null, "", "/#/manuale");
    await reauthenticateWithRedirect(auth.currentUser, provider());
    return null;
  };
  if (standalone || touch) return redirect();
  try {
    return salvaToken(await reauthenticateWithPopup(auth.currentUser, provider()));
  } catch (err) {
    if (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment") return redirect();
    throw err;
  }
}

/** Chiamata con l'esito di getRedirectResult: se era il permesso per i contatti, tiene il token. */
export function esitoRedirect(result) {
  if (!result || !leggi(DOPO)) return;
  salvaToken(result);
}

/** Dopo il ritorno da Google: true (una volta sola) se il permesso è arrivato. */
export function ritornoDaGoogle() {
  if (!leggi(DOPO)) return false;
  scrivi(DOPO, null);
  return !!token();
}

/** Tutti i contatti: [{ googleId, name, phone, email, address, org }] in ordine di nome. */
export async function leggiContatti() {
  const t = token();
  if (!t) throw Object.assign(new Error("Permesso scaduto"), { code: "scaduto" });
  const out = [];
  let pagina = "";
  do {
    const url = new URL("https://people.googleapis.com/v1/people/me/connections");
    url.searchParams.set("personFields", "names,phoneNumbers,emailAddresses,addresses,organizations");
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("sortOrder", "FIRST_NAME_ASCENDING");
    if (pagina) url.searchParams.set("pageToken", pagina);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${t}` } });
    if (r.status === 401) { scrivi(CHIAVE, null); throw Object.assign(new Error("Permesso scaduto"), { code: "scaduto" }); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const motivo = j.error?.details?.find?.((d) => d.reason)?.reason || j.error?.status || String(r.status);
      throw Object.assign(new Error(j.error?.message || `Errore ${r.status}`), { code: motivo });
    }
    for (const p of j.connections || []) {
      const name = p.names?.[0]?.displayName?.trim();
      if (!name) continue;
      out.push({
        googleId: p.resourceName,
        name,
        phone: p.phoneNumbers?.[0]?.value || "",
        email: p.emailAddresses?.[0]?.value || "",
        address: (p.addresses?.[0]?.formattedValue || "").replace(/\n+/g, ", "),
        org: p.organizations?.[0]?.name || "",
      });
    }
    pagina = j.nextPageToken || "";
  } while (pagina);
  return out;
}
