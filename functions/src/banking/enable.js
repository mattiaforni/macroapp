// Enable Banking: lettura dei movimenti dai conti collegati e creazione di proposte di spesa.
//
// STATO: struttura pronta, chiamate reali da completare dopo il test con l'API
// (vedi docs/ARCHITETTURA.md, sezione Banca). Flusso previsto:
//   1. JWT firmato con la chiave privata dell'app Enable Banking (RS256, kid = appId)
//   2. POST /auth → url di autorizzazione della banca (consenso, SCA)
//   3. POST /sessions con il code di ritorno → session_id + elenco conti
//   4. GET /accounts/{id}/transactions?date_from=... → movimenti
// Ogni utente ha la propria app Enable Banking (modalità ristretta, uso personale): l'app ha
// quindi una coppia appId/chiave per ciascuno, salvata in bank_connections/{uid}.
//
// Riferimento: https://enablebanking.com/docs/api/reference/

import { FieldValue } from "firebase-admin/firestore";
import { createSign } from "node:crypto";

const API = "https://api.enablebanking.com";

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** JWT RS256 come richiesto da Enable Banking (header kid = application id). */
export function makeJwt({ appId, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: appId }));
  const payload = b64url(JSON.stringify({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat: now, exp: now + 3600 }));
  const sig = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKey);
  return `${header}.${payload}.${b64url(sig)}`;
}

async function api(path, { jwt, method = "GET", body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Enable Banking ${res.status} ${path}: ${await res.text()}`);
  return res.json();
}

/** Chiave stabile per la deduplica: id della banca se c'è, altrimenti data+importo+descrizione. */
export function txKey(tx) {
  const id = tx.entry_reference || tx.transaction_id;
  if (id) return `eb_${id}`;
  const desc = (tx.remittance_information || []).join(" ").toLowerCase().replace(/\s+/g, " ").trim();
  return `eb_${tx.booking_date}_${tx.transaction_amount?.amount}_${desc.slice(0, 40)}`;
}

/**
 * Per ogni documento in bank_connections (uno per utente) scarica i movimenti recenti
 * e crea una proposta di spesa per ogni addebito non ancora visto.
 */
export async function syncAllConnections(db, defaults) {
  const conns = await db.collection("bank_connections").where("active", "==", true).get();
  for (const doc of conns.docs) {
    const c = doc.data();
    try {
      const jwt = makeJwt({ appId: c.appId || defaults.appId, privateKey: c.privateKey || defaults.privateKey });
      const since = new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10);
      let created = 0;
      for (const accountId of c.accountIds || []) {
        const data = await api(`/accounts/${accountId}/transactions?date_from=${since}`, { jwt });
        for (const tx of data.transactions || []) {
          if (tx.credit_debit_indicator !== "DBIT") continue; // solo uscite
          const key = txKey(tx);
          const ref = db.collection("proposals").doc(key); // id deterministico = deduplica
          const exists = await ref.get();
          if (exists.exists) continue;
          const amount = Math.abs(parseFloat(tx.transaction_amount?.amount || "0"));
          const desc = (tx.remittance_information || [tx.creditor?.name]).filter(Boolean).join(" ");
          await ref.set({
            ownerUid: c.ownerUid,
            householdId: c.householdId,
            visibility: "shared",
            kind: "expense",
            source: "bank",
            status: "pending",
            target: "expenses",
            payload: { amount, description: desc, paidBy: c.ownerUid, split: "equal", date: new Date(tx.booking_date || tx.value_date), category: "", source: "bank", bankTxId: key },
            summary: `${desc} · ${amount.toFixed(2)} €`,
            explain: "Movimento bancario",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          created++;
        }
      }
      await doc.ref.update({ lastSyncAt: FieldValue.serverTimestamp(), lastSyncCreated: created, lastError: null });
    } catch (err) {
      console.error("syncBank", doc.id, err.message);
      await doc.ref.update({ lastSyncAt: FieldValue.serverTimestamp(), lastError: err.message });
    }
  }
}
