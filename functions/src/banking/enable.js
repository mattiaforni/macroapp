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
const GIORNI_LETTURA = 7;          // quanti giorni indietro si leggono i movimenti (data di contabilizzazione)
const GIORNI_LETTURA_CARTE = 14;   // le carte di credito contabilizzano più tardi
const GIORNI_ABBINAMENTO = 5;      // distanza massima tra l'addebito sul conto e il pagamento sulla carta
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

async function api(path, { jwt, method = "GET", body, psu = {} } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json", accept: "application/json", ...psu },
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
async function movimenti(jwt, accountUid, dateFrom, psu) {
  const out = [];
  let key = null;
  for (let pagina = 0; pagina < 10; pagina++) {
    const q = new URLSearchParams({ date_from: dateFrom });
    if (key) q.set("continuation_key", key);
    const data = await api(`/accounts/${encodeURIComponent(accountUid)}/transactions?${q}`, { jwt, psu });
    out.push(...(data.transactions || []));
    key = data.continuation_key;
    if (!key) break;
  }
  return out;
}

// ───────────── Quali uscite sono spese ─────────────

const TIPI_CONTO = { CACC: "Conto corrente", CARD: "Carta", SVGS: "Conto deposito", LOAN: "Finanziamento", TRAN: "Conto", CASH: "Conto", OTHR: "Altro conto" };
/** Nome leggibile di un conto: con alcune banche (Intesa) name è l'intestatario, uguale per tutti. */
export const etichettaConto = (k) => k.product || k.details || TIPI_CONTO[k.type] || k.name || "Conto";
export const eCarta = (k) => k.type === "CARD";

const importoDi = (tx) => Math.abs(parseFloat(tx.transaction_amount?.amount || "0")) || 0;
/** Giorno della spesa (acquisto) e giorno di contabilizzazione, "AAAA-MM-GG". */
const giornoSpesa = (tx) => tx.transaction_date || tx.booking_date || tx.value_date || null;
const giornoConto = (tx) => tx.booking_date || tx.value_date || tx.transaction_date || null;
const testoDi = (tx) => [...(tx.remittance_information || []), tx.creditor?.name, tx.note, tx.bank_transaction_code?.description]
  .filter(Boolean).join(" ").replace(/\s+/g, " ");
const giorniTra = (a, b) => (a && b ? Math.abs(new Date(a) - new Date(b)) / 86400e3 : Infinity);
const isoGiorno = (d) => d.toISOString().slice(0, 10);

// Addebito del saldo della carta sul conto. Parole tipiche: il testo esatto di Intesa non è pubblicato,
// quindi è solo il secondo criterio dopo l'abbinamento degli importi; gli scarti restano visibili nella
// pagina Banca per controllarli coi movimenti veri. «Pagamento POS … carta 1234» (bancomat) non corrisponde.
export const SALDO_CARTA = /carta\s+(di\s+)?credito|credit\s*card|\b(saldo|estratto\s+conto|e\/c)\b.{0,30}\bcart[ae]\b|\bcart[ae]\b.{0,30}\b(saldo|estratto\s+conto|e\/c)\b/i;

/** L'IBAN del beneficiario è quello di un conto letto (confronto con la maschera: prime due e ultime quattro). */
function stessoIban(iban, k) {
  const m = k.ibanMask || "";
  const x = String(iban || "").replace(/\s/g, "").toUpperCase();
  return !!m && !!x && x.startsWith(m.slice(0, 2)) && x.endsWith(m.slice(-4));
}

/**
 * Decide quali uscite diventano proposte di spesa e quali si scartano, con il motivo.
 * movimentiPerConto: [{ conto, transazioni }]. Ritorna { proposte: [{ conto, tx }], scartati: [{ conto, tx, motivo }] }.
 *
 * Si considerano le uscite contabilizzate degli ultimi GIORNI_LETTURA giorni (GIORNI_LETTURA_CARTE per le
 * carte). Con una carta di credito tra i conti letti, le spese sono i suoi acquisti, uno per uno, e
 * l'addebito mensile della carta sul conto si scarta:
 *   1. se sulla carta c'è un'entrata dello stesso importo entro GIORNI_ABBINAMENTO giorni (il pagamento del saldo);
 *   2. altrimenti se il testo dell'uscita nomina la carta di credito o il saldo (SALDO_CARTA).
 * Senza carte lette l'addebito resta: è l'unica traccia di quelle spese.
 * Si scarta anche un trasferimento verso un altro dei conti letti (IBAN del beneficiario).
 */
export function classifica(movimentiPerConto, { oggi = new Date() } = {}) {
  const conti = movimentiPerConto.map((m) => m.conto);
  const conCarte = conti.some(eCarta);
  const pagamentiCarta = movimentiPerConto.filter((m) => eCarta(m.conto))
    .flatMap((m) => m.transazioni.filter((t) => t.credit_debit_indicator === "CRDT"))
    .map((t) => ({ importo: importoDi(t), giorno: giornoConto(t), usato: false }));
  const out = { proposte: [], scartati: [], inAttesa: [], riepilogo: [] };
  for (const { conto, transazioni } of movimentiPerConto) {
    const da = isoGiorno(new Date(oggi - (eCarta(conto) ? GIORNI_LETTURA_CARTE : GIORNI_LETTURA) * 86400e3));
    const esiti = new Map(); // movimento → cosa ne ha fatto l'app, da mostrare nella pagina Banca
    for (const tx of transazioni) {
      if (tx.credit_debit_indicator !== "DBIT") {                 // solo uscite
        esiti.set(tx, tx.credit_debit_indicator === "CRDT" ? "Entrata: non è una spesa" : `Verso sconosciuto (${tx.credit_debit_indicator || "assente"})`);
        continue;
      }
      if (!importoDi(tx)) { esiti.set(tx, "Importo zero"); continue; }
      if (tx.status && tx.status !== "BOOK") {
        // Non ancora contabilizzata: può cambiare importo (preautorizzazioni) o riferimento, quindi non
        // diventa una proposta; si mostra nella pagina Banca finché la banca non la contabilizza.
        if (["PDNG", "HOLD", "SCHD"].includes(tx.status)) {
          if ((giornoSpesa(tx) || da) >= da) out.inAttesa.push({ conto, tx });
          esiti.set(tx, "In attesa di contabilizzazione");
        } else esiti.set(tx, `Stato ${tx.status}: non considerato`);
        continue;
      }
      const g = giornoConto(tx);
      if (g && g < da) { esiti.set(tx, "Contabilizzato prima del periodo letto"); continue; } // letto solo per gli abbinamenti
      let motivo = null;
      if (!eCarta(conto)) {
        const verso = tx.creditor_account?.iban;
        if (verso && conti.some((k) => k !== conto && stessoIban(verso, k))) {
          motivo = "Giroconto tra i tuoi conti";
        } else if (conCarte) {
          const pag = pagamentiCarta.find((p) => !p.usato && Math.abs(p.importo - importoDi(tx)) < 0.005 && giorniTra(p.giorno, g) <= GIORNI_ABBINAMENTO);
          if (pag) { pag.usato = true; motivo = "Saldo della carta, importo abbinato"; }
          else if (SALDO_CARTA.test(testoDi(tx))) motivo = "Saldo della carta, dal testo";
        }
      }
      if (motivo) { out.scartati.push({ conto, tx, motivo }); esiti.set(tx, `Scartato: ${motivo}`); }
      else { out.proposte.push({ conto, tx }); esiti.set(tx, "Proposta"); }
    }
    // Cosa ha dato la banca per questo conto: quanti movimenti, per verso e stato, e gli ultimi con
    // l'esito, per capire che cosa manca e perché.
    const stati = {};
    for (const t of transazioni) { const k = `${t.credit_debit_indicator || "?"} ${t.status || "?"}`; stati[k] = (stati[k] || 0) + 1; }
    const recenti = [...transazioni].sort((a, b) => String(giornoSpesa(b)).localeCompare(String(giornoSpesa(a))));
    out.riepilogo.push({
      uid: conto.uid, conto: etichettaConto(conto), tipo: conto.type || "", letti: transazioni.length, stati,
      ultimo: giornoSpesa(recenti[0] || {}) || null,
      ultimi: recenti.slice(0, 12).map((tx) => ({
        key: txKey(tx), giorno: giornoSpesa(tx), contabilizzato: tx.booking_date || null, verso: tx.credit_debit_indicator || "",
        stato: tx.status || "", importo: importoDi(tx), descrizione: descrizioneDi(tx), esito: esiti.get(tx) || "",
      })),
    });
  }
  return out;
}

/**
 * Legge i movimenti recenti di un collegamento e crea una proposta di spesa per ogni uscita
 * contabilizzata non ancora vista che sia una spesa (vedi classifica). Le proposte sono personali: i
 * movimenti del conto li vede solo chi lo possiede; la spesa, se confermata, nasce condivisa
 * (APPLICA.expense in proposals.js). Gli scarti finiscono in `scartati` (gli ultimi 12), e una proposta
 * ancora in attesa per un movimento scartato passa a `discarded`.
 * Ritorna il numero di proposte create. L'errore, se c'è, lo scrive nel documento e lo rilancia.
 */
/**
 * Intestazioni PSU: dicono alla banca che l'utente è presente (ha toccato «Leggi ora»). Senza, la
 * lettura conta nel limite PSD2 delle letture in sua assenza, che molte banche (Intesa compresa)
 * fissano a 4 al giorno per conto; oltre rispondono 429 ASPSP_RATE_LIMIT_EXCEEDED. La lettura
 * automatica di syncBank non le manda: per lei il limite vale, ed è una al giorno.
 * Riferimento: https://enablebanking.com/docs/faq/
 */
export function intestazioniPsu(req) {
  const h = req?.headers || {};
  const out = {};
  const ip = String(h["x-forwarded-for"] || req?.ip || "").split(",")[0].trim();
  if (/^[0-9a-f.:]{3,45}$/i.test(ip)) out["Psu-Ip-Address"] = ip;
  if (h["user-agent"]) out["Psu-User-Agent"] = String(h["user-agent"]).slice(0, 300);
  if (h["accept-language"]) out["Psu-Accept-Language"] = String(h["accept-language"]).slice(0, 100);
  if (h["referer"] || h["origin"]) out["Psu-Referer"] = String(h["referer"] || h["origin"]).slice(0, 300);
  return out;
}

/** Errori noti di Enable Banking → frase da mostrare nella pagina Banca. */
function erroreLeggibile(err) {
  if (err.code === "ASPSP_RATE_LIMIT_EXCEEDED") return "La banca ha raggiunto il limite di letture di oggi (4 al giorno quando non sei tu a chiederle). La lettura automatica riprende domattina.";
  return err.message.slice(0, 300);
}

export async function syncConnection(db, ref, c, defaults, { psu = {} } = {}) {
  try {
    const jwt = makeJwt({ appId: c.appId || defaults.appId, privateKey: c.privateKey || defaults.privateKey });
    const oggi = new Date();
    const conti = c.accounts?.length ? c.accounts : (c.accountIds || []).map((uid) => ({ uid, name: "" }));
    const letti = [];
    for (const conto of conti) {
      const giorni = (eCarta(conto) ? GIORNI_LETTURA_CARTE : GIORNI_LETTURA) + GIORNI_ABBINAMENTO;
      letti.push({ conto, transazioni: await movimenti(jwt, conto.uid, isoGiorno(new Date(oggi - giorni * 86400e3)), psu) });
    }
    const { proposte, scartati, inAttesa, riepilogo } = classifica(letti, { oggi });

    let created = 0;
    const giaViste = new Map(); // key → stato della proposta che c'era già
    for (const { conto, tx } of proposte) {
      const key = txKey(tx);
      const propRef = db.collection("proposals").doc(key);       // id deterministico = deduplica
      const esistente = await propRef.get();
      if (esistente.exists) { giaViste.set(key, esistente.data().status); continue; }
      const amount = importoDi(tx);
      const desc = descrizioneDi(tx);
      const giorno = giornoSpesa(tx);
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
          source: "bank", bankTxId: key, account: etichettaConto(conto), merchantCategory: tx.merchant_category_code || "",
        },
        summary: `${desc} · ${amount.toFixed(2).replace(".", ",")} €`,
        explain: "Movimento bancario",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      created++;
    }

    const nuoviScarti = [];
    for (const { conto, tx, motivo } of scartati) {
      const key = txKey(tx);
      nuoviScarti.push({ key, giorno: giornoSpesa(tx), descrizione: descrizioneDi(tx), importo: importoDi(tx), conto: etichettaConto(conto), motivo });
      // Proposta nata prima che lo scarto fosse riconoscibile (es. pagamento sulla carta arrivato dopo).
      const propRef = db.collection("proposals").doc(key);
      const p = await propRef.get();
      if (p.exists && p.data().status === "pending" && p.data().source === "bank") {
        await propRef.update({ status: "discarded", explain: motivo, updatedAt: FieldValue.serverTimestamp() });
      }
    }
    const GIA = { pending: "Già tra le azioni da confermare", accepted: "Già confermata", rejected: "Già scartata da te", discarded: "Già scartata" };
    for (const r of riepilogo) {
      for (const m of r.ultimi) {
        if (m.esito !== "Proposta") continue;
        m.esito = giaViste.has(m.key) ? (GIA[giaViste.get(m.key)] || "Già proposta") : "Proposta nuova";
      }
    }
    const aggiornamento = {
      // Ultima lettura riuscita: per conto quanti movimenti, in che stato, gli ultimi con l'esito, e le
      // uscite non ancora contabilizzate. Testi e importi restano in questo documento privato, mai nei
      // registri (il flusso Diagnosi li pubblica, e il repository è pubblico).
      lettura: {
        conti: riepilogo,
        inAttesa: inAttesa
          .map(({ conto, tx }) => ({ giorno: giornoSpesa(tx), descrizione: descrizioneDi(tx), importo: importoDi(tx), conto: etichettaConto(conto), stato: tx.status }))
          .sort((a, b) => String(b.giorno).localeCompare(String(a.giorno))).slice(0, 15),
      },
    };
    if (nuoviScarti.length) {
      const visti = new Set(nuoviScarti.map((x) => x.key));
      aggiornamento.scartati = [...nuoviScarti, ...(c.scartati || []).filter((x) => !visti.has(x.key))]
        .sort((a, b) => String(b.giorno).localeCompare(String(a.giorno))).slice(0, 12);
    }

    // lastSyncAt è l'ultima lettura riuscita; i tentativi falliti vanno in lastAttemptAt.
    await ref.update({ ...aggiornamento, lastSyncAt: FieldValue.serverTimestamp(), lastAttemptAt: FieldValue.serverTimestamp(), lastSyncCreated: created, lastError: null });
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
      await ref.update({ lastAttemptAt: FieldValue.serverTimestamp(), lastError: erroreLeggibile(err) });
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
