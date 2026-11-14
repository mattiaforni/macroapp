// Prova del backup settimanale senza rete: Firestore e API di export finti.
// node functions/strumenti/prova-backup.mjs
import assert from "node:assert/strict";
import { backup, cartellaDi, bucketDi } from "../src/backup.js";

const zitto = { log: () => {} };
const db = { listCollections: async () => ["users", "journal_entries", "households", "consumi"].map((id) => ({ id })) };

// Cartella: ora di Roma (ora solare e legale), si ordina come testo.
assert.equal(cartellaDi(new Date("2026-11-16T02:17:00Z")), "2026-11-16-0317", "ora solare: UTC+1");
assert.equal(cartellaDi(new Date("2026-07-06T01:17:00Z")), "2026-07-06-0317", "ora legale: UTC+2");
assert.equal(cartellaDi(new Date("2026-12-31T23:30:00Z")), "2027-01-01-0030", "a cavallo dell'anno");
assert.equal(bucketDi("macroapp-b9bd0"), "macroapp-b9bd0-backup");

// Export riuscito al terzo controllo.
{
  let t = Date.parse("2026-11-16T02:17:00Z");
  const chiamate = [];
  let controlli = 0;
  const fetch = async (url, o = {}) => {
    chiamate.push({ url, metodo: o.method || "GET", corpo: o.body && JSON.parse(o.body), auth: o.headers?.Authorization });
    if (url.endsWith(":exportDocuments")) return { ok: true, status: 200, json: async () => ({ name: "projects/p/databases/(default)/operations/op1" }) };
    controlli++;
    if (controlli < 3) return { ok: true, json: async () => ({ name: "op1", done: false }) };
    return { ok: true, json: async () => ({ done: true, metadata: { progressDocuments: { completedWork: "1234" }, progressBytes: { completedWork: "5678901" } }, response: {} }) };
  };
  const r = await backup(db, { progetto: "p", token: async () => "tok", fetch, dorme: async (ms) => { t += ms; }, adesso: () => t, registro: zitto });
  assert.equal(r.stato, "riuscito");
  assert.equal(r.cartella, "2026-11-16-0317");
  assert.equal(r.documenti, 1234);
  assert.equal(r.byte, 5678901);
  const avvio = chiamate[0];
  assert.equal(avvio.url, "https://firestore.googleapis.com/v1/projects/p/databases/(default):exportDocuments");
  assert.equal(avvio.metodo, "POST");
  assert.equal(avvio.auth, "Bearer tok");
  assert.equal(avvio.corpo.outputUriPrefix, "gs://p-backup/2026-11-16-0317", "nel bucket del progetto, una cartella per volta");
  assert.deepEqual(avvio.corpo.collectionIds, ["consumi", "households", "journal_entries", "users"], "tutte le collezioni, nominate: si potrà ripristinarne una sola");
  assert.equal(avvio.corpo.snapshotTime, "2026-11-16T02:16:00.000Z", "fotografia coerente di un minuto fa, al minuto");
  assert.equal(chiamate[1].url, "https://firestore.googleapis.com/v1/projects/p/databases/(default)/operations/op1");
  console.log("  ✓ export avviato con le collezioni nominate, nel bucket del progetto, e atteso fino alla fine");
}

// Export rifiutato (permessi): errore con il messaggio di Google, così finisce tra gli errori della Diagnosi.
{
  const fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: "The caller does not have permission" } }) });
  await assert.rejects(backup(db, { progetto: "p", token: async () => "tok", fetch, dorme: async () => {}, registro: zitto }), /HTTP 403.*permission/);
  console.log("  ✓ export rifiutato: errore con il motivo");
}

// Istante rifiutato dall'API: si riprova senza.
{
  const corpi = [];
  const fetch = async (url, o = {}) => {
    if (url.endsWith(":exportDocuments")) {
      corpi.push(JSON.parse(o.body));
      return corpi.length === 1
        ? { ok: false, status: 400, json: async () => ({ error: { message: "snapshot_time is not supported" } }) }
        : { ok: true, status: 200, json: async () => ({ name: "op4" }) };
    }
    return { ok: true, json: async () => ({ done: true, metadata: {} }) };
  };
  const r = await backup(db, { progetto: "p", token: async () => "tok", fetch, dorme: async () => {}, registro: zitto });
  assert.equal(r.stato, "riuscito");
  assert.ok(corpi[0].snapshotTime && !("snapshotTime" in corpi[1]), "seconda richiesta senza istante");
  console.log("  ✓ istante rifiutato: export senza, riuscito");
}

// Export finito male.
{
  const fetch = async (url) => url.endsWith(":exportDocuments")
    ? { ok: true, status: 200, json: async () => ({ name: "op2" }) }
    : { ok: true, json: async () => ({ done: true, error: { code: 7, message: "Bucket non scrivibile" } }) };
  await assert.rejects(backup(db, { progetto: "p", token: async () => "tok", fetch, dorme: async () => {}, registro: zitto }), /non riuscito.*Bucket non scrivibile/);
  console.log("  ✓ export finito con errore: errore");
}

// Export lento: dopo il tempo d'attesa la funzione esce senza errore (l'export continua da solo).
{
  let t = 0;
  const fetch = async (url) => url.endsWith(":exportDocuments")
    ? { ok: true, status: 200, json: async () => ({ name: "op3" }) }
    : { ok: true, json: async () => ({ done: false }) };
  const r = await backup(db, { progetto: "p", token: async () => "tok", fetch, dorme: async (ms) => { t += ms; }, adesso: () => t, attendiMs: 60e3, registro: zitto });
  assert.equal(r.stato, "in_corso");
  console.log("  ✓ export lento: nessun errore, continua da solo");
}

// Database vuoto: niente export.
await assert.rejects(backup({ listCollections: async () => [] }, { progetto: "p", token: async () => "tok", fetch: async () => assert.fail("niente chiamate"), registro: zitto }), /nessuna collezione/);
console.log("  ✓ nessuna collezione: errore, nessuna chiamata");

console.log("prova-backup: tutto a posto");
