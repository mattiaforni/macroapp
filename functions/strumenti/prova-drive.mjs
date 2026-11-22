// Prova delle cartelle dei progetti su Drive senza rete (22/11, docs/PIANO-DRIVE-MCP.md): Firestore e Drive finti
// (strumenti/finti.mjs). Controlla che la cartella nasca in «D&D» nel Drive del proprietario del progetto (anche quando
// la chiede l'altra persona), che segua la visibilità (condivisa con l'altra persona o no) e il nome, che due richieste
// non ne creino due, che chi non vede il progetto non la tocchi e che senza la spunta dei file dell'app non si scriva.
// Uso: node functions/strumenti/prova-drive.mjs (servono le dipendenze di functions).
import assert from "node:assert/strict";
import { dbFinto, driveFinto } from "./finti.mjs";
import { gestisci, giroCartelle, RADICE } from "../src/google/cartelle.js";

const D = driveFinto();
globalThis.fetch = D.fetch;
const DATI = {
  households: { casa: { members: ["io", "lei"], memberNames: { io: "Mattia Rossi", lei: "Giulia Bianchi" } }, altra: { members: ["altro"] } },
  users: {
    io: { email: "mattia@example.com", google: { collegato: true, email: "mattia@example.com", permessi: { drive: true, cartelle: true } } },
    lei: { email: "giulia@example.com", google: { collegato: true, email: "giulia.b@example.com", permessi: { drive: true, cartelle: false } } },
    altro: { email: "bruno@example.com" },
  },
  projects: {
    tennis: { ownerUid: "io", householdId: "casa", visibility: "private", name: "Tennis" },
    casa: { ownerUid: "io", householdId: "casa", visibility: "shared", name: "Casa al mare" },
    suo: { ownerUid: "lei", householdId: "casa", visibility: "private", name: "Il suo progetto" },
  },
};
const db = dbFinto(DATI);
const TOKEN = { io: D.token("io", "mattia@example.com"), lei: D.token("lei", "giulia.b@example.com", ["drive"]), altro: D.token("altro", "bruno@example.com") };
const usati = [];
// Come account.js → tokenServer: il permesso di un'ora della persona, con le spunte del suo profilo.
const tokenServer = async (_db, uid) => {
  usati.push(uid);
  const g = DATI.users[uid]?.google;
  if (!g?.collegato) throw Object.assign(new Error("Google non è collegato"), { details: { motivo: "non-collegato" } });
  return { email: g.email, accessToken: TOKEN[uid], permessi: g.permessi };
};
const opz = { client: {}, tokenServer };
const rifiuta = async (p, motivo) => {
  try { await p; } catch (e) { assert.equal(e.details?.motivo, motivo, `motivo atteso ${motivo}: ${e.message}`); return e; }
  assert.fail(`doveva essere rifiutato (${motivo})`);
};

// 1. Cartella di un progetto privato: in «D&D», nel Drive del proprietario, non condivisa.
const r1 = await gestisci(db, "io", { azione: "crea", projectId: "tennis" }, opz);
assert.ok(r1.creata, "creata");
const radice = [...D.files.values()].find((f) => f.name === RADICE);
assert.ok(radice && radice.appProperties.dd === "radice", "la cartella D&D c'è");
const tennis = D.files.get(r1.cartella.id);
assert.equal(tennis.name, "Tennis");
assert.deepEqual(tennis.parents, [radice.id], "dentro D&D");
assert.equal(tennis.proprietario, "mattia@example.com");
assert.equal(tennis.permessi.length, 0, "privato: non condivisa");
assert.equal(DATI.projects.tennis.cartella.id, tennis.id);
assert.equal(DATI.projects.tennis.cartella.condivisaCon, null);
assert.equal(DATI.users.io.cartelleDrive.radice.id, radice.id, "la radice si ricorda");

// 2. Di nuovo: la stessa cartella, nessun doppione; la radice non si ricrea.
const r2 = await gestisci(db, "io", { azione: "crea", projectId: "tennis" }, opz);
assert.equal(r2.cartella.id, tennis.id);
assert.equal([...D.files.values()].filter((f) => f.name === RADICE).length, 1);
assert.equal([...D.files.values()].filter((f) => f.appProperties.progetto === "tennis").length, 1, "una cartella per progetto");

// 3. Progetto condiviso chiesto dall'altra persona: nel Drive del proprietario (il suo permesso), condivisa con lei
// (l'email del suo account Google), senza mandarle la mail.
usati.length = 0;
const r3 = await gestisci(db, "lei", { azione: "crea", projectId: "casa" }, opz);
assert.deepEqual([...new Set(usati)], ["io"], "si usa il permesso del proprietario");
const mare = D.files.get(r3.cartella.id);
assert.equal(mare.proprietario, "mattia@example.com");
assert.deepEqual(mare.parents, [radice.id]);
assert.equal(mare.permessi.length, 1);
assert.equal(mare.permessi[0].emailAddress, "giulia.b@example.com");
assert.equal(mare.permessi[0].role, "writer");
assert.equal(mare.permessi[0].notificato, false, "senza mail di invito");
assert.equal(DATI.projects.casa.cartella.condivisaCon, "giulia.b@example.com");

// 4. Cambio di visibilità e di nome: allinea toglie la condivisione e rinomina; poi la rimette.
DATI.projects.casa.visibility = "private";
DATI.projects.casa.name = "Casa in montagna";
await gestisci(db, "io", { azione: "allinea", projectId: "casa" }, opz);
assert.equal(mare.permessi.length, 0, "privato: condivisione tolta");
assert.equal(mare.name, "Casa in montagna", "rinominata");
assert.equal(DATI.projects.casa.cartella.condivisaCon, null);
DATI.projects.casa.visibility = "shared";
// Il giro ogni 5 minuti se ne accorge da solo (la chiamata dall'app si era persa).
assert.equal(await giroCartelle(db, opz), 1, "una cartella da allineare");
assert.equal(mare.permessi.length, 1, "di nuovo condivisa");
assert.equal(await giroCartelle(db, opz), 0, "poi niente da fare");

// 5. Chi non vede il progetto non tocca la cartella (privato di un altro, o di un'altra casa).
await rifiuta(gestisci(db, "lei", { azione: "crea", projectId: "tennis" }, opz), "progetto");
await rifiuta(gestisci(db, "altro", { azione: "allinea", projectId: "casa" }, opz), "progetto");
await rifiuta(gestisci(db, "io", { azione: "crea", projectId: "non-ce" }, opz), "progetto");
await rifiuta(gestisci(db, "io", { azione: "crea", projectId: "../users/io" }, opz), "progetto");

// 6. Senza la spunta dei file dell'app (lei ha collegato Google prima del 22/11): niente cartella, e il messaggio dice di
// ricollegare; nessun file creato.
const prima = D.files.size;
const e6 = await rifiuta(gestisci(db, "lei", { azione: "crea", projectId: "suo" }, opz), "cartelle");
assert.match(e6.message, /Ricollega Google/);
assert.equal(D.files.size, prima);
// Un progetto condiviso dell'altra persona chiesto da me: il messaggio dice che deve ricollegare lei.
DATI.projects.suo.visibility = "shared";
const e7 = await rifiuta(gestisci(db, "io", { azione: "crea", projectId: "suo" }, opz), "cartelle");
assert.match(e7.message, /Drive di Giulia/);
assert.equal(e7.details.proprietario, "Giulia");

// 7. Cartella nel cestino: un nuovo tocco la ricrea (la vecchia resta dov'è).
tennis.trashed = true;
const r8 = await gestisci(db, "io", { azione: "crea", projectId: "tennis" }, opz);
assert.notEqual(r8.cartella.id, tennis.id, "ricreata");
assert.equal(D.files.get(r8.cartella.id).name, "Tennis");

// 8. Un'altra creazione in corso (l'altro telefono): non se ne crea una seconda.
DATI.projects.nuovo = { ownerUid: "io", householdId: "casa", visibility: "private", name: "Nuovo", cartella: { creando: Date.now() } };
const r9 = await gestisci(db, "io", { azione: "crea", projectId: "nuovo" }, opz);
assert.equal(r9.inCorso, true);
assert.equal([...D.files.values()].filter((f) => f.appProperties.progetto === "nuovo").length, 0);

console.log("prova-drive: cartelle dei progetti a posto");
