// Prova delle cartelle dei progetti su Drive senza rete (22/11, docs/PIANO-DRIVE-MCP.md): Firestore e Drive finti
// (strumenti/finti.mjs). Controlla che la cartella nasca in «D&D» nel Drive del proprietario del progetto (anche quando
// la chiede l'altra persona), che segua la visibilità (condivisa con l'altra persona o no) e il nome, che due richieste
// non ne creino due, che chi non vede il progetto non la tocchi e che senza la spunta dei file dell'app non si scriva.
// Uso: node functions/strumenti/prova-drive.mjs (servono le dipendenze di functions).
import assert from "node:assert/strict";
import { dbFinto, driveFinto } from "./finti.mjs";
import { gestisci, giroCartelle, RADICE } from "../src/google/cartelle.js";
import { giroCopie, htmlDaTesto, normalizzaTesto } from "../src/google/copia.js";

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

// ───────────── Passo 2: copia leggibile, foto, «Apri come documento» ─────────────
const ts = (x) => ({ toMillis: () => new Date(x).getTime(), toDate: () => new Date(x) });
Object.assign(DATI.projects.casa, { visibility: "shared", sintesi: "## Spiaggia\nStato: da decidere\nDa provare:\n- Ombrellone **nuovo**" });
DATI.journal_entries = {
  n1: { ownerUid: "io", householdId: "casa", visibility: "shared", projectId: "casa", titolo: "Sopralluogo", text: "Visto il bagno Marino.", riepilogo: "## Spiaggia\n- Bagno Marino", createdAt: ts("2026-10-12T10:00:00Z"), foto: [{ id: "f1" }, { id: "f2" }] },
  n2: { ownerUid: "lei", householdId: "casa", visibility: "shared", projectId: "casa", titolo: "Prezzi", text: "Ombrellone 20 euro al giorno.", createdAt: ts("2026-11-03T10:00:00Z") },
  n3: { ownerUid: "io", householdId: "casa", visibility: "private", projectId: "casa", titolo: "Privata", text: "Regalo a sorpresa per Giulia.", createdAt: ts("2026-11-04T10:00:00Z") },
  n4: { ownerUid: "altro", householdId: "altra", visibility: "shared", projectId: "casa", titolo: "Altra casa", text: "Non c'entra.", createdAt: ts("2026-11-05T10:00:00Z") },
};
DATI.tasks = {
  t1: { ownerUid: "io", householdId: "casa", visibility: "shared", projectId: "casa", text: "Prenotare il bagno", done: false, due: "2026-12-01", people: "Marco" },
  t2: { ownerUid: "io", householdId: "casa", visibility: "private", projectId: "casa", text: "Segreto", done: false },
  t3: { ownerUid: "io", householdId: "casa", visibility: "shared", projectId: "casa", text: "Già fatto", done: true },
};
DATI.journal_photos = {
  f1: { ownerUid: "io", householdId: "casa", visibility: "shared", entryId: "n1", mime: "image/jpeg", dati: Buffer.from("foto uno").toString("base64") },
  f2: { ownerUid: "io", householdId: "casa", visibility: "shared", entryId: "n1", mime: "image/jpeg", dati: Buffer.from("foto due").toString("base64") },
};
const cartellaMare = DATI.projects.casa.cartella.id;
const figli = (id) => [...D.files.values()].filter((f) => f.parents.includes(id) && !f.trashed);
const testo = (f) => f.contenuto.toString("utf8");

// 1. Prima copia: «Copia dall'app» con la sintesi e un documento per mese, «Foto» con le due foto. Solo ciò che è condiviso.
const c1 = await gestisci(db, "lei", { azione: "copia", projectId: "casa" }, opz);
assert.equal(c1.scritti, 3, "sintesi, ottobre, novembre");
assert.equal(c1.foto, 2);
const sotto = figli(cartellaMare);
const copia = sotto.find((f) => f.name === "Copia dall'app"), album = sotto.find((f) => f.name === "Foto");
assert.ok(copia && album, "due sottocartelle");
const docs = Object.fromEntries(figli(copia.id).map((f) => [f.name, f]));
assert.deepEqual(Object.keys(docs).sort(), ["Note 2026-10 (ottobre)", "Note 2026-11 (novembre)", "Sintesi e da fare"]);
for (const f of Object.values(docs)) assert.equal(f.mimeType, "application/vnd.google-apps.document", "Documenti Google");
assert.equal(docs["Sintesi e da fare"].formatoCaricato, "text/html; charset=UTF-8", "HTML convertito da Google");
const sintesi = testo(docs["Sintesi e da fare"]);
assert.match(sintesi, /<h3>Spiaggia<\/h3>/);
assert.match(sintesi, /<b>nuovo<\/b>/);
assert.match(sintesi, /Prenotare il bagno <i>\(entro il 1 dicembre · Marco\)<\/i>/);
assert.doesNotMatch(sintesi, /Segreto|Già fatto/, "solo i task aperti e condivisi");
const nov = testo(docs["Note 2026-11 (novembre)"]);
assert.match(nov, /Prezzi/);
assert.match(nov, /di Giulia/, "la nota dell'altra persona dice di chi è");
assert.doesNotMatch(nov, /Regalo|Altra casa/, "niente note private in una cartella condivisa, niente altre case");
assert.match(testo(docs["Note 2026-10 (ottobre)"]), /2 foto nella cartella Foto/);
assert.deepEqual(figli(album.id).map((f) => f.name).sort(), ["2026-10-12 Sopralluogo (1).jpg", "2026-10-12 Sopralluogo (2).jpg"]);
assert.equal(testo(figli(album.id)[0]), "foto uno");
assert.equal(docs["Sintesi e da fare"].proprietario, "mattia@example.com", "nel Drive del proprietario, anche se l'ha chiesta lei");
const ricordo = DATI.drive_file[`casa_${docs["Sintesi e da fare"].id}`];
assert.ok(ricordo?.daApp && ricordo.testo.includes("Prenotare il bagno"), "l'app ricorda cosa ha scritto (testo della versione precedente)");
assert.equal(ricordo.modifiedTime, docs["Sintesi e da fare"].modifiedTime);

// 2. Di nuovo, senza modifiche: niente da scrivere. Cambia la sintesi: solo quel documento.
assert.equal((await gestisci(db, "io", { azione: "copia", projectId: "casa" }, opz)).scritti, 0, "contenuto uguale: niente scritture");
DATI.projects.casa.sintesi += "\n- Lettini";
const v = docs["Sintesi e da fare"].version;
assert.equal((await gestisci(db, "io", { azione: "copia", projectId: "casa" }, opz)).scritti, 1);
assert.equal(docs["Sintesi e da fare"].version, v + 1, "stesso documento, riscritto");
assert.equal(figli(copia.id).length, 3, "nessun doppione");

// 3. Un documento della copia cambiato a mano su Drive non si sovrascrive (lo legge prima il passo 3); uno con lo stesso
// testo sì.
D.modificaAMano(docs["Note 2026-11 (novembre)"].id, "mattia@example.com", "Appunti miei aggiunti a mano");
DATI.journal_entries.n2.text = "Ombrellone 25 euro al giorno.";
const c3 = await gestisci(db, "io", { azione: "copia", projectId: "casa" }, opz);
assert.equal(c3.tenuti, 1);
assert.equal(testo(docs["Note 2026-11 (novembre)"]), "Appunti miei aggiunti a mano", "la modifica a mano resta");
D.modificaAMano(docs["Sintesi e da fare"].id, "mattia@example.com", testo(docs["Sintesi e da fare"]));
DATI.projects.casa.sintesi += "\n- Sdraio";
assert.equal((await gestisci(db, "io", { azione: "copia", projectId: "casa" }, opz)).scritti, 1, "toccato senza cambiare il testo: si riscrive");

// 4. Una foto tolta dalla nota va nel cestino.
DATI.journal_entries.n1.foto = [{ id: "f1" }];
await gestisci(db, "io", { azione: "copia", projectId: "casa" }, opz);
assert.equal(figli(album.id).length, 1);

// 5. Una copia alla volta: con un'altra in corso si segna «ancora» e si risponde subito.
DATI.drive_cartelle.casa.copiaInCorso = Date.now();
assert.equal((await gestisci(db, "io", { azione: "copia", projectId: "casa" }, opz)).inCorso, true);
assert.equal(DATI.drive_cartelle.casa.copiaAncora, true);
delete DATI.drive_cartelle.casa.copiaInCorso;

// 6. Il giro dei 5 minuti rifà le copie rimaste indietro (copiaRichiesta dopo l'ultima copia).
DATI.projects.casa.sintesi += "\n- Cabina";
await new Promise((ok) => setTimeout(ok, 5));
DATI.projects.casa.copiaRichiesta = ts(Date.now()); // dopo l'ultima copia
await new Promise((ok) => setTimeout(ok, 5));
assert.equal(await giroCopie(db, opz), 1);
assert.match(testo(docs["Sintesi e da fare"]), /Cabina/);
assert.equal(await giroCopie(db, opz), 0, "poi niente");

// 7. «Apri come documento»: una nota (nella cartella del progetto), la seconda volta lo stesso; una nota privata in un
// progetto condiviso no; la sintesi.
const d1 = await gestisci(db, "lei", { azione: "documento", projectId: "casa", entryId: "n2" }, opz);
assert.ok(d1.nuovo && /docs\.google\.com\/document/.test(d1.link));
const fileNota = [...D.files.values()].find((f) => f.appProperties.chiave === "nota:n2");
assert.deepEqual(fileNota.parents, [cartellaMare], "nella cartella del progetto, non nella copia");
assert.match(testo(fileNota), /Ombrellone 25 euro/);
assert.ok(DATI.drive_file[`casa_${fileNota.id}`]?.testo, "testo di partenza ricordato");
const d2 = await gestisci(db, "io", { azione: "documento", projectId: "casa", entryId: "n2" }, opz);
assert.equal(d2.nuovo, false);
assert.equal(d2.link, d1.link);
await rifiuta(gestisci(db, "io", { azione: "documento", projectId: "casa", entryId: "n3" }, opz), "privata");
await rifiuta(gestisci(db, "lei", { azione: "documento", projectId: "casa", entryId: "n4" }, opz), "nota");
const d3 = await gestisci(db, "io", { azione: "documento", projectId: "casa" }, opz);
assert.equal(d3.nome, "Sintesi di Casa in montagna");

// 8. Testo dell'app → HTML, e il confronto dei testi che non bada ai segni degli elenchi.
assert.equal(htmlDaTesto("## Dritto\nStato: migliora\nAcquisito:\n- Racchetta **giù**\nAltro"),
  "<h2>Dritto</h2>\n<p><i>Stato: migliora</i></p>\n<p><b>Acquisito:</b></p>\n<ul>\n<li>Racchetta <b>giù</b></li>\n</ul>\n<p>Altro</p>");
assert.equal(normalizzaTesto("* uno\n\n  - due  \r\n"), normalizzaTesto("uno\ndue"));

console.log("prova-drive: copia leggibile, foto e «Apri come documento» a posto");
