// Enable Banking (PSD2): collegamento dei conti e lettura dei movimenti, che diventano
// proposte di spesa (mai spese: come tutto ciò che è automatico, passano dalla coda proposals).
//
// Flusso (riferimento: https://enablebanking.com/docs/api/latest/):
//   1. JWT RS256 firmato con la chiave privata dell'app (header kid = application id)
//   2. GET  /aspsps?country=IT              → banche disponibili
//   3. POST /auth                           → url della banca: consenso e SCA, poi ritorno su
//                                             <redirect_url>?code=…&state=… (o ?error=…)
//   4. POST /sessions { code }              → session_id + conti (ciascuno ha un uid)
//   5. GET  /accounts/{uid}/transactions    → movimenti, ogni giorno (syncBank) o a richiesta
//
// L'app è registrata in produzione in modalità ristretta (uso personale, gratuita): vede solo i
// conti collegati prima nel Control Panel di Enable Banking («Link accounts»). Senza quel passo
// /sessions risponde senza conti. Una sola app per la casa: appId e chiave stanno in Secret
// Manager; un collegamento può avere credenziali proprie (campi appId/privateKey) ma oggi non
// le scrive nessuno.
//
// Un documento in bank_connections per utente (id = uid): vedi docs/MODELLO-DATI.md.

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createSign, randomBytes } from "node:crypto";

const API = "https://api.enablebanking.com";
const GIORNI_LETTURA = 7;          // quanti giorni indietro si leggono i movimenti
const GIORNI_CONSENSO_MAX = 180;   // massimo della PSD2 dal 2023; vale il minimo con maximum_consent_validity della banca

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** JWT RS256 come richiesto da Enable Banking (header kid = application id, validità ≤ 24 h). */
export function makeJwt({ appId, privateKey }) {
  if (!appId || !privateKey || !/BEGIN .*PRIVATE KEY/.test(privateKey)) {
    throw new EnableBankingError(0, "jwt", "credenziali di Enable Banking mancanti");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: appId }));
  const payload = b64url(JSON.stringify({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat: now, exp: now + 3600 }));
  const sig = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKey.replace(/\\n/g, "\n"));
  return `${header}.${payload}.${b64url(sig)}`;
}

/** Errore dell'API, con lo stato HTTP: index.js lo traduce in un codice per il telefono. */
export class EnableBankingError extends Error {
  constructor(status, path, body) {
    super(`Enable Banking ${status || ""} ${path}: ${String(body).slice(0, 300)}`);
    this.status = status;
    this.body = String(body);
    try { this.code = JSON.parse(this.body).error || ""; } catch (e) { this.code = ""; }
  }
}

/**
 * La sessione non vale più (EXPIRED_SESSION, sessione revocata o chiusa): serve un consenso nuovo.
 * Succede anche molto prima di access.valid_until: le banche italiane tengono un solo consenso attivo
 * per terza parte e per utente (uno nuovo, anche dal Control Panel di Enable Banking, invalida il
 * precedente), e possono chiuderlo da sé.
 */
export const sessioneChiusa = (err) => err instanceof EnableBankingError && [401, 410].includes(err.status) && /SESSION/i.test(err.code || err.body);

async function api(path, { jwt, method = "GET", body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json", accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new EnableBankingError(res.status, `${method} ${path.split("?")[0]}`, text);
  return text ? JSON.parse(text) : {};
}

// ───────────── Collegamento ─────────────

/** Banche di un paese, in ordine alfabetico. */
export async function elencoBanche(jwt, country = "IT") {
  const data = await api(`/aspsps?country=${encodeURIComponent(country)}&psu_type=personal`, { jwt });
  return (data.aspsps || [])
    .map((a) => ({ name: a.name, country: a.country, beta: !!a.beta, maxConsentSeconds: a.maximum_consent_validity || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, "it"));
}

export const nuovoState = () => b64url(randomBytes(18));

/** Scadenza del consenso da chiedere: 90 giorni, o meno se la banca ne concede meno. */
export function scadenzaConsenso(maxConsentSeconds) {
  const giorni = Math.max(1, Math.min(GIORNI_CONSENSO_MAX, Math.floor((maxConsentSeconds || GIORNI_CONSENSO_MAX * 86400) / 86400)));
  return new Date(Date.now() + giorni * 86400e3).toISOString();
}

/** POST /auth → url dove mandare l'utente. */
export async function avviaAutorizzazione(jwt, { aspsp, state, redirectUrl, validUntil }) {
  const data = await api("/auth", {
    jwt, method: "POST",
    body: {
      access: { valid_until: validUntil },
      aspsp: { name: aspsp.name, country: aspsp.country },
      state, redirect_url: redirectUrl, psu_type: "personal", language: "it",
    },
  });
  return { url: data.url, authorizationId: data.authorization_id || null };
}

function contoSintetico(a) {
  const iban = a.account_id?.iban || "";
  const altro = String(a.account_id?.other?.identification || "").replace(/\s/g, "");
  return {
    uid: a.uid,
    name: a.name || "",               // con alcune banche (Intesa) è il nome dell'intestatario
    product: a.product || "",
    details: a.details || "",
    currency: a.currency || "EUR",
    type: a.cash_account_type || "",  // CACC conto, CARD carta, SVGS deposito, LOAN finanziamento…
    ibanMask: iban ? `${iban.slice(0, 2)}…${iban.slice(-4)}` : "",
    idMask: !iban && altro.length >= 4 ? `…${altro.slice(-4)}` : "",
  };
}

/** POST /sessions col code di ritorno → sessione e conti autorizzati. */
export async function creaSessione(jwt, code) {
  const s = await api("/sessions", { jwt, method: "POST", body: { code } });
  return {
    sessionId: s.session_id,
    validUntil: s.access?.valid_until || null,
    aspsp: s.aspsp ? { name: s.aspsp.name, country: s.aspsp.country } : null,
    accounts: (s.accounts || []).map(contoSintetico),
  };
}

/** Stato della sessione secondo Enable Banking (AUTHORIZED, EXPIRED, REVOKED, CLOSED, …), per la diagnosi. */
export async function statoSessione(jwt, sessionId) {
  const s = await api(`/sessions/${encodeURIComponent(sessionId)}`, { jwt });
  return { status: s.status || "", validUntil: s.access?.valid_until || null, created: s.created || null, authorized: s.authorized || null };
}

/** Chiude la sessione (e, se la banca lo permette, il consenso). Una sessione già sparita non è un errore. */
export async function chiudiSessione(jwt, sessionId) {
  if (!sessionId) return;
  try {
    await api(`/sessions/${encodeURIComponent(sessionId)}`, { jwt, method: "DELETE" });
  } catch (err) {
    if (err.status !== 404) throw err;
  }
}

// ───────────── Movimenti ─────────────

/** Chiave stabile per la deduplica: id della banca se c'è, altrimenti data+importo+descrizione. */
export function txKey(tx) {
  const id = tx.entry_reference || tx.transaction_id;
  if (id) return `eb_${String(id).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120)}`;
  const desc = (tx.remittance_information || []).join(" ").toLowerCase().replace(/\s+/g, " ").trim();
  return `eb_${tx.booking_date}_${tx.transaction_amount?.amount}_${desc.slice(0, 40)}`.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** Descrizione breve di un movimento: il nome dell'esercente se c'è, altrimenti la causale. */
export function descrizioneDi(tx) {
  const causale = (tx.remittance_information || []).join(" ").replace(/\s+/g, " ").trim();
  const nome = (tx.creditor?.name || "").replace(/\s+/g, " ").trim();
  return (nome || causale || "Movimento").slice(0, 80);
}

/** Tutte le pagine dei movimenti di un conto da una data in poi. */
async function movimenti(jwt, accountUid, dateFrom) {
  const out = [];
  let key = null;
  for (let pagina = 0; pagina < 10; pagina++) {
    const q = new URLSearchParams({ date_from: dateFrom });
    if (key) q.set("continuation_key", key);
    const data = await api(`/accounts/${encodeURIComponent(accountUid)}/transactions?${q}`, { jwt });
    out.push(...(data.transactions || []));
    key = data.continuation_key;
    if (!key) break;
  }
  return out;
}

/**
 * Legge i movimenti recenti di un collegamento e crea una proposta di spesa per ogni addebito
 * contabilizzato non ancora visto. Le proposte sono personali: i movimenti del conto li vede solo
 * chi lo possiede; la spesa, se confermata, nasce condivisa (APPLICA.expense in proposals.js).
 * Ritorna il numero di proposte create. L'errore, se c'è, lo scrive nel documento e lo rilancia.
 */
export async function syncConnection(db, ref, c, defaults) {
  try {
    const jwt = makeJwt({ appId: c.appId || defaults.appId, privateKey: c.privateKey || defaults.privateKey });
    const since = new Date(Date.now() - GIORNI_LETTURA * 86400e3).toISOString().slice(0, 10);
    let created = 0;
    const conti = c.accounts?.length ? c.accounts : (c.accountIds || []).map((uid) => ({ uid, name: "" }));
    for (const conto of conti) {
      for (const tx of await movimenti(jwt, conto.uid, since)) {
        if (tx.credit_debit_indicator !== "DBIT") continue;        // solo uscite
        if (tx.status && tx.status !== "BOOK") continue;           // non ancora contabilizzato: può cambiare riferimento
        const key = txKey(tx);
        const propRef = db.collection("proposals").doc(key);       // id deterministico = deduplica
        if ((await propRef.get()).exists) continue;
        const amount = Math.abs(parseFloat(tx.transaction_amount?.amount || "0"));
        if (!amount) continue;
        const desc = descrizioneDi(tx);
        const giorno = tx.booking_date || tx.value_date || tx.transaction_date;
        const date = giorno ? Timestamp.fromDate(new Date(giorno)) : FieldValue.serverTimestamp();
        await propRef.set({
          ownerUid: c.ownerUid,
          householdId: c.householdId,
          visibility: "private",
          kind: "expense",
          source: "bank",
          status: "pending",
          target: "expenses",
          payload: {
            amount, description: desc, paidBy: c.ownerUid, split: "equal", date, category: "",
            source: "bank", bankTxId: key, account: conto.name || "", merchantCategory: tx.merchant_category_code || "",
          },
          summary: `${desc} · ${amount.toFixed(2).replace(".", ",")} €`,
          explain: "Movimento bancario",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        created++;
      }
    }
    // lastSyncAt è l'ultima lettura riuscita; i tentativi falliti vanno in lastAttemptAt.
    await ref.update({ lastSyncAt: FieldValue.serverTimestamp(), lastAttemptAt: FieldValue.serverTimestamp(), lastSyncCreated: created, lastError: null });
    return created;
  } catch (err) {
    console.error("syncBank", ref.id, err.message);
    if (sessioneChiusa(err)) {
      // Consenso chiuso prima della scadenza: la lettura si ferma finché non lo rinnovi (concludi
      // toglie needsRenewal). Lo stato della sessione resta nel documento, per capire chi l'ha chiusa.
      let stato = null;
      try { stato = await statoSessione(makeJwt({ appId: c.appId || defaults.appId, privateKey: c.privateKey || defaults.privateKey }), c.sessionId); }
      catch (e) { console.warn("stato della sessione", e.message); }
      console.warn("syncBank sessione chiusa", ref.id, JSON.stringify(stato));
      await ref.update({
        lastAttemptAt: FieldValue.serverTimestamp(), lastError: null, needsRenewal: true,
        sessionStatus: stato?.status || err.code || "EXPIRED_SESSION",
        ...(c.sessionEndedAt ? {} : { sessionEndedAt: FieldValue.serverTimestamp() }),
      });
    } else {
      await ref.update({ lastAttemptAt: FieldValue.serverTimestamp(), lastError: err.message.slice(0, 300) });
    }
    throw err;
  }
}

/** Sincronizzazione di tutti i collegamenti attivi (syncBank, ogni mattina). Salta quelli da rinnovare. */
export async function syncAllConnections(db, defaults) {
  const conns = await db.collection("bank_connections").where("active", "==", true).get();
  for (const doc of conns.docs) {
    if (doc.data().needsRenewal) continue;
    try { await syncConnection(db, doc.ref, doc.data(), defaults); } catch (e) { /* già registrato nel documento */ }
  }
}
