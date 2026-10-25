// Prova della lettura bancaria senza rete né Firestore: quali uscite diventano proposte e quali si
// scartano (classifica), e cosa scrive syncConnection. Movimenti inventati, nella forma di Enable Banking.
//   cd functions && node strumenti/prova-banca.mjs
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { classifica, syncConnection, SALDO_CARTA, intestazioniPsu } from "../src/banking/enable.js";

const oggi = new Date("2026-10-25T08:00:00Z");
const g = (n) => new Date(oggi - n * 86400e3).toISOString().slice(0, 10); // n giorni fa
const tx = (id, verso, importo, giorno, testo, extra = {}) => ({
  entry_reference: id, credit_debit_indicator: verso, status: "BOOK",
  transaction_amount: { amount: String(importo), currency: "EUR" },
  booking_date: giorno, value_date: giorno, remittance_information: [testo], ...extra,
});

const conto = { uid: "c1", type: "CACC", name: "ROSSI MARIO", ibanMask: "IT…1111" };
const conto2 = { uid: "c2", type: "CACC", name: "ROSSI MARIO", ibanMask: "IT…2222" };
const carta = { uid: "k1", type: "CARD", name: "ROSSI MARIO", idMask: "…4321" };

const movimenti = [
  { conto, transazioni: [
    tx("a1", "DBIT", 312.4, g(2), "ADDEBITO SALDO E/C CARTA 4321"),                  // abbinato al pagamento sulla carta
    tx("a2", "DBIT", 18.5, g(1), "PAGAMENTO POS ESSELUNGA FIRENZE CARTA 9999"),      // bancomat: è una spesa
    tx("a3", "DBIT", 95, g(3), "ADDEBITO CARTA DI CREDITO N. 4321"),                 // senza pagamento sulla carta: testo
    tx("a4", "DBIT", 200, g(4), "GIROCONTO", { creditor_account: { iban: "IT60X0542811101000000002222" } }), // tra i tuoi conti
    tx("a5", "DBIT", 50, g(2), "BONIFICO A ROSSI"),                                  // stesso importo di un rimborso lontano: resta
    tx("a6", "DBIT", 40, g(10), "PAGAMENTO POS VECCHIO"),                            // oltre i 7 giorni del conto
    tx("a7", "CRDT", 1500, g(5), "STIPENDIO"),                                       // entrata: ignorata
  ] },
  { conto: carta, transazioni: [
    tx("k1", "DBIT", 42.1, g(3), "AMAZON EU", { transaction_date: g(5) }),           // acquisto con la carta
    tx("k2", "DBIT", 12, g(10), "BAR CENTRALE"),                                     // carta: finestra di 14 giorni
    tx("k3", "DBIT", 30, g(1), "IN ATTESA", { status: "PDNG" }),                     // non contabilizzato
    tx("k4", "CRDT", 312.4, g(1), "PAGAMENTO SALDO"),                                // pagamento del saldo
    tx("k5", "CRDT", 50, g(15), "RIMBORSO"),                                         // lontano dal bonifico a5
  ] },
  { conto: conto2, transazioni: [] },
];

const { proposte, scartati } = classifica(movimenti, { oggi });
const ids = (xs) => xs.map((x) => x.tx.entry_reference).sort();
assert.deepEqual(ids(proposte), ["a2", "a5", "k1", "k2"], "proposte");
assert.deepEqual(ids(scartati), ["a1", "a3", "a4"], "scartati");
const motivo = (id) => scartati.find((x) => x.tx.entry_reference === id).motivo;
assert.match(motivo("a1"), /importo abbinato/);
assert.match(motivo("a3"), /dal testo/);
assert.match(motivo("a4"), /Giroconto/);

// Uscite non contabilizzate: non proposte, ma elencate; riepilogo per conto
const { inAttesa, riepilogo } = classifica(movimenti, { oggi });
assert.deepEqual(inAttesa.map((x) => x.tx.entry_reference), ["k3"], "in attesa");
const rk = riepilogo.find((r) => r.uid === "k1");
assert.equal(rk.conto, "Carta");
assert.equal(rk.letti, 5);
assert.equal(rk.stati["DBIT PDNG"], 1);
assert.equal(rk.ultimo, g(1));
const esito = (uid, id) => riepilogo.find((r) => r.uid === uid).ultimi.find((m) => m.key === `eb_${id}`).esito;
assert.equal(esito("k1", "k3"), "In attesa di contabilizzazione");
assert.equal(esito("k1", "k4"), "Entrata: non è una spesa");
assert.equal(esito("k1", "k1"), "Proposta");
assert.equal(esito("c1", "a6"), "Contabilizzato prima del periodo letto");
assert.equal(esito("c1", "a1"), "Scartato: Saldo della carta, importo abbinato");
assert.equal(classifica([{ conto: carta, transazioni: [tx("z1", "DBIT", 9, g(1), "X", { status: "OTHR" })] }], { oggi }).riepilogo[0].ultimi[0].esito, "Stato OTHR: non considerato");

// Senza la carta tra i conti letti l'addebito mensile resta: è l'unica traccia di quelle spese.
const senzaCarta = classifica([movimenti[0]], { oggi });
assert.ok(ids(senzaCarta.proposte).includes("a1") && ids(senzaCarta.proposte).includes("a3"), "senza carta l'addebito resta");

// Parole: il bancomat non è il saldo della carta.
for (const t of ["PAGAMENTO POS ESSELUNGA CARTA 1234", "PRELIEVO BANCOMAT CARTA 1234", "PAGAMENTO TRAMITE POS"]) assert.ok(!SALDO_CARTA.test(t), t);
for (const t of ["Addebito carta di credito", "ADDEBITO SALDO CARTA", "ADDEBITO E/C CARTA 4321", "Estratto conto carta Visa", "CREDIT CARD PAYMENT"]) assert.ok(SALDO_CARTA.test(t), t);

// ── syncConnection con Firestore e Enable Banking finti ──
const docs = new Map();
const rif = (path) => ({
  id: path.split("/").pop(),
  get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
  set: async (d) => { docs.set(path, d); },
  update: async (d) => { docs.set(path, { ...(docs.get(path) || {}), ...d }); },
});
const db = { collection: (c) => ({ doc: (id) => rif(`${c}/${id}`) }) };
// Una proposta già in attesa per l'addebito della carta (creata prima che arrivasse il pagamento sulla carta).
docs.set("proposals/eb_a1", { status: "pending", source: "bank" });
const perConto = Object.fromEntries(movimenti.map((m) => [m.conto.uid, m.transazioni]));
const intestazioniViste = [];
globalThis.fetch = async (url, opz = {}) => {
  intestazioniViste.push(opz.headers || {});
  const uid = decodeURIComponent(String(url).match(/accounts\/([^/]+)\/transactions/)[1]);
  return { ok: true, text: async () => JSON.stringify({ transactions: perConto[uid] }) };
};
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const c = { ownerUid: "u1", householdId: "h1", accounts: [conto, carta, conto2], scartati: [{ key: "eb_vecchio", giorno: g(30), motivo: "x" }] };
docs.set("bank_connections/u1", c);
const veraData = Date;
// syncConnection usa new Date() per «oggi»: lo si fissa alla data della prova.
globalThis.Date = class extends veraData { constructor(...a) { super(...(a.length ? a : [oggi])); } static now() { return oggi.getTime(); } };
const psu = intestazioniPsu({ ip: "10.0.0.1", headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "Mozilla/5.0 (Android)", "accept-language": "it-IT" } });
assert.deepEqual(psu, { "Psu-Ip-Address": "203.0.113.7", "Psu-User-Agent": "Mozilla/5.0 (Android)", "Psu-Accept-Language": "it-IT" });
const creati = await syncConnection(db, rif("bank_connections/u1"), c, { appId: "app", privateKey }, { psu });
globalThis.Date = veraData;
assert.ok(intestazioniViste.length >= 3 && intestazioniViste.every((h) => h["Psu-Ip-Address"] === "203.0.113.7"), "le letture chieste dall'utente portano le intestazioni PSU");

assert.equal(creati, 4, "quattro proposte nuove");
assert.equal(docs.get("proposals/eb_a1").status, "discarded", "la proposta in attesa dell'addebito è scartata");
assert.equal(docs.get("proposals/eb_k1").payload.account, "Carta", "conto nominato dal tipo");
assert.equal(docs.get("proposals/eb_k1").payload.date.toDate().toISOString().slice(0, 10), g(5), "data dell'acquisto, non della contabilizzazione");
const doc = docs.get("bank_connections/u1");
assert.deepEqual(doc.scartati.map((x) => x.key), ["eb_a1", "eb_a3", "eb_a4", "eb_vecchio"], "scarti nuovi prima, i vecchi restano");
assert.equal(doc.lastSyncCreated, 4);
assert.deepEqual(doc.lettura.inAttesa.map((x) => [x.descrizione, x.importo, x.conto, x.stato]), [["IN ATTESA", 30, "Carta", "PDNG"]], "in attesa nel documento");
assert.equal(doc.lettura.conti.length, 3);
const ultimiCarta = doc.lettura.conti.find((r) => r.uid === "k1").ultimi;
assert.equal(ultimiCarta.find((m) => m.key === "eb_k1").esito, "Proposta nuova");
assert.ok(ultimiCarta.every((m) => m.esito), "ogni movimento ha un esito");

console.log("prova-banca: tutto a posto");
console.log(scartati.map((x) => `  scartato ${x.tx.remittance_information[0]} · ${x.motivo}`).join("\n"));
