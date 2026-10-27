// Account Google collegato una volta sola: Contatti (sola lettura), Calendario (lettura e scrittura
// degli eventi) e Drive (sola lettura).
//
// Il permesso si dà una volta: l'app manda alla pagina di Google, che torna su /google-contatti
// (il percorso è rimasto quello del primo collegamento, già autorizzato nel client OAuth) con un
// codice; qui il codice diventa un refresh token, conservato in google_tokens/{uid} (l'app non può
// leggerlo: firestore.rules). All'app si consegnano solo permessi di un'ora, con cui legge contatti,
// calendario e Drive direttamente dalle API di Google; il server usa lo stesso permesso per leggere
// i documenti di Drive quando l'agente analizza una nota (tokenServer).
// Il client OAuth è quello web dell'accesso con Google: ID e secret arrivano dal segreto
// GOOGLE_OAUTH_CLIENT, che il deploy copia dalla configurazione di Firebase Authentication.
//
// Azioni (data.azione):
//   avvio    { ritorno }               → { url }    pagina di Google dove dare il permesso
//   collega  { code, state, ritorno }  → { email, accessToken, scade, permessi }
//   token    { rinnova? }              → { email, accessToken, scade, permessi }
//   scollega {}                        → {}
// permessi = { contatti, calendario, drive }: quali dei tre l'utente ha lasciato spuntati nella pagina
// di Google (sono tutti facoltativi lì). Lo stesso sta in users/{uid}.google, che l'app legge.
// Gli errori portano in details.motivo un codice per l'app: client, ritorno, state, scope,
// refresh, non-collegato, scaduto, rete.
import { HttpsError } from "firebase-functions/v2/https";
import { randomBytes } from "node:crypto";

export const SCOPE = {
  contatti: "https://www.googleapis.com/auth/contacts.readonly",
  calendario: ["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/calendar.events"],
  drive: "https://www.googleapis.com/auth/drive.readonly",
};
const SCOPES = ["openid", "email", SCOPE.contatti, ...SCOPE.calendario, SCOPE.drive];
const PERCORSO = "/google-contatti";
const ORIGINI = ["https://macroapp-b9bd0.web.app", "https://macroapp-b9bd0.firebaseapp.com", "http://localhost:5000"];
const COLL = "google_tokens";
const VALIDITA_STATE = 20 * 60 * 1000;

const errore = (codice, testo, motivo) => new HttpsError(codice, testo, { motivo });

/** Indirizzo di ritorno ammesso (deve essere tra gli URI autorizzati del client OAuth), o null. */
export function ritornoValido(r) {
  try {
    const u = new URL(r);
    return ORIGINI.includes(u.origin) && u.pathname === PERCORSO ? `${u.origin}${PERCORSO}` : null;
  } catch (e) {
    return null;
  }
}

/** Quali dei tre permessi ci sono nella stringa `scope` tornata da Google. */
export function permessiDa(scope) {
  const dati = String(scope || "").split(" ");
  return {
    contatti: dati.includes(SCOPE.contatti),
    calendario: SCOPE.calendario.every((s) => dati.includes(s)),
    drive: dati.includes(SCOPE.drive),
  };
}

/** POST all'endpoint dei token di Google. Gli errori portano `oauth` (es. invalid_grant). */
async function chiediToken(parametri) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(parametri),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.error_description || j.error || `HTTP ${r.status}`);
    e.oauth = j.error || String(r.status);
    throw e;
  }
  return j;
}

/** Email dell'account Google collegato, dall'id_token appena ricevuto da Google (su TLS: niente da verificare). */
function emailDa(idToken) {
  try {
    return JSON.parse(Buffer.from(String(idToken).split(".")[1], "base64url").toString()).email || "";
  } catch (e) {
    return "";
  }
}

const scadenza = (j) => Date.now() + (Number(j.expires_in) || 3600) * 1000;

const serveClient = (client) => {
  if (!client?.id || !client?.secret) {
    throw errore("failed-precondition", "Il server non ha ancora i dati del client Google (GOOGLE_OAUTH_CLIENT)", "client");
  }
};

/**
 * Permesso di un'ora dal refresh token conservato: lo stesso per l'app (azione «token») e per il
 * server (l'agente legge i documenti di Drive). Se il permesso è stato revocato o è scaduto (app in
 * modalità di test: 7 giorni), toglie il collegamento e lo segna nel profilo.
 * Ritorna { email, accessToken, scade, permessi }.
 */
export async function tokenServer(db, uid, client, { rinnova = false } = {}) {
  const { FieldValue } = await import("firebase-admin/firestore");
  const ref = db.collection(COLL).doc(uid);
  const profilo = db.collection("users").doc(uid);
  const d = (await ref.get()).data();
  if (!d?.refreshToken) throw errore("failed-precondition", "Google non è collegato", "non-collegato");
  const permessi = d.permessi || permessiDa(d.scope);
  // Lo stesso permesso vale per tutti i dispositivi finché non sta per scadere.
  if (!rinnova && d.accessToken && d.scade > Date.now() + 5 * 60 * 1000) {
    return { email: d.email || "", accessToken: d.accessToken, scade: d.scade, permessi };
  }
  serveClient(client);
  let j;
  try {
    j = await chiediToken({
      refresh_token: d.refreshToken, client_id: client.id, client_secret: client.secret, grant_type: "refresh_token",
    });
  } catch (e) {
    if (e.oauth === "invalid_grant") {
      await ref.delete();
      await profilo.set({ google: { collegato: false, scaduto: true, email: d.email || "", permessi }, contattiGoogle: FieldValue.delete() }, { merge: true });
      throw errore("failed-precondition", "Il collegamento con Google è scaduto: ricollegalo", "scaduto");
    }
    if (e.oauth === "invalid_client" || e.oauth === "unauthorized_client") {
      throw errore("failed-precondition", `Client Google non valido (${e.message.slice(0, 120)})`, "client");
    }
    throw errore("unavailable", `Google non risponde (${e.message.slice(0, 120)})`, "rete");
  }
  const scade = scadenza(j);
  await ref.update({ accessToken: j.access_token, scade });
  return { email: d.email || "", accessToken: j.access_token, scade, permessi };
}

/**
 * utente: { uid, email }; data: { azione, ... }; client: { id, secret } da GOOGLE_OAUTH_CLIENT.
 */
export async function gestisci(db, utente, data, client) {
  const { FieldValue } = await import("firebase-admin/firestore");
  const ref = db.collection(COLL).doc(utente.uid);
  const profilo = db.collection("users").doc(utente.uid);
  const serveRitorno = () => {
    const r = ritornoValido(data.ritorno);
    if (!r) throw errore("invalid-argument", "Indirizzo di ritorno non ammesso", "ritorno");
    return r;
  };

  switch (data.azione) {
    case "avvio": {
      serveClient(client);
      const redirect = serveRitorno();
      const state = randomBytes(18).toString("base64url");
      await ref.set({ ownerUid: utente.uid, state, stateAt: Date.now() }, { merge: true });
      const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      u.searchParams.set("client_id", client.id);
      u.searchParams.set("redirect_uri", redirect);
      u.searchParams.set("response_type", "code");
      u.searchParams.set("scope", SCOPES.join(" "));
      u.searchParams.set("access_type", "offline"); // refresh token
      u.searchParams.set("prompt", "consent"); // il refresh token arriva solo con il consenso esplicito
      u.searchParams.set("include_granted_scopes", "true");
      u.searchParams.set("state", state);
      if (utente.email) u.searchParams.set("login_hint", utente.email);
      return { url: u.toString() };
    }

    case "collega": {
      serveClient(client);
      const redirect = serveRitorno();
      const d = (await ref.get()).data() || {};
      if (!data.code || !data.state || data.state !== d.state || Date.now() - (d.stateAt || 0) > VALIDITA_STATE) {
        throw errore("failed-precondition", "Richiesta scaduta o non valida: riprova a collegare", "state");
      }
      let j;
      try {
        j = await chiediToken({
          code: data.code, client_id: client.id, client_secret: client.secret,
          redirect_uri: redirect, grant_type: "authorization_code",
        });
      } catch (e) {
        throw errore("failed-precondition", `Google non ha confermato il permesso (${e.message.slice(0, 140)})`, e.oauth || "oauth");
      }
      const permessi = permessiDa(j.scope);
      if (!permessi.contatti && !permessi.calendario && !permessi.drive) {
        throw errore("permission-denied", "Nella pagina di Google non è stato spuntato nessun accesso", "scope");
      }
      const refreshToken = j.refresh_token || d.refreshToken;
      if (!refreshToken) throw errore("failed-precondition", "Google non ha dato un permesso duraturo: riprova", "refresh");
      const email = emailDa(j.id_token) || d.email || "";
      const scade = scadenza(j);
      // set senza merge: sparisce anche lo state, che vale una volta sola.
      await ref.set({
        ownerUid: utente.uid, refreshToken, email, accessToken: j.access_token, scade, scope: j.scope || "", permessi,
        collegatoIl: FieldValue.serverTimestamp(),
      });
      await profilo.set({
        google: { collegato: true, scaduto: false, email, permessi, dal: FieldValue.serverTimestamp() },
        contattiGoogle: FieldValue.delete(), // campo del vecchio collegamento ai soli contatti
      }, { merge: true });
      return { email, accessToken: j.access_token, scade, permessi };
    }

    case "token":
      return tokenServer(db, utente.uid, client, { rinnova: !!data.rinnova });

    case "scollega": {
      const d = (await ref.get()).data();
      // La revoca toglie all'app anche il consenso dato all'accesso con Google (stesso client):
      // al prossimo accesso Google lo chiederà di nuovo. L'accesso in corso resta valido.
      if (d?.refreshToken) {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(d.refreshToken)}`, { method: "POST" })
          .catch((e) => console.warn("revoca", e.message));
      }
      await ref.delete();
      await profilo.set({ google: FieldValue.delete(), contattiGoogle: FieldValue.delete() }, { merge: true });
      return {};
    }

    default:
      throw errore("invalid-argument", "Azione sconosciuta", "azione");
  }
}
