// Prova delle cartelle dei progetti su Drive senza rete (22/11, docs/PIANO-DRIVE-MCP.md): Firestore e Drive finti
// (strumenti/finti.mjs). Controlla che la cartella nasca in «D&D» nel Drive del proprietario del progetto (anche quando
// la chiede l'altra persona), che segua la visibilità (condivisa con l'altra persona o no) e il nome, che due richieste
// non ne creino due, che chi non vede il progetto non la tocchi e che senza la spunta dei file dell'app non si scriva.
// Uso: node functions/strumenti/prova-drive.mjs (servono le dipendenze di functions).
import assert from "node:assert/strict";
import { dbFinto, driveFinto } from "./finti.mjs";
import { gestisci, giroCartelle, RADICE } from "../src/google/cartelle.js";
import { giroCopie, htmlDaTesto, normalizzaTesto } from "../src/google/copia.js";
import { giroNovita, differenze, FERMO_MS } from "../src/google/novita.js";
import { strumentiDi } from "../src/chiedi.js";

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

// 3b. Se Google rifiuta di sostituire il contenuto, il documento si riscrive nuovo e il vecchio va nel cestino.
D.rifiuti.aggiornamenti = 1;
DATI.projects.casa.sintesi += "\n- Ombra";
const vecchiaSintesi = docs["Sintesi e da fare"];
assert.equal((await gestisci(db, "io", { azione: "copia", projectId: "casa" }, opz)).scritti, 1);
assert.equal(vecchiaSintesi.trashed, true, "il vecchio nel cestino");
const nuovaSintesi = figli(copia.id).find((f) => f.name === "Sintesi e da fare");
assert.ok(nuovaSintesi && nuovaSintesi.id !== vecchiaSintesi.id && /Ombra/.test(testo(nuovaSintesi)));
docs["Sintesi e da fare"] = nuovaSintesi;

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

// ───────────── Passo 3: Drive → app ─────────────
const DOCG = "application/vnd.google-apps.document";
const richieste = [];
let risposta = null;
// Un Claude finto: tiene la richiesta e risponde con `risposta` (o con niente da proporre).
const chiedi = async (o) => {
  richieste.push(o);
  o.onUso?.({ input_tokens: 1000, output_tokens: 200 }, "claude-finto");
  return risposta || { riassunto: "", nota: { titolo: "", testo: "" }, sintesi: "", task: [], task_fatti: [] };
};
const giro = (dopo) => giroNovita(db, { ...opz, key: "chiave-finta", chiedi, adesso: dopo });
const proposteDrive = () => Object.values(DATI.proposals || {}).filter((x) => x.source === "drive");
const ultimoCambio = () => Math.max(...[...D.files.values()].map((f) => Date.parse(f.modifiedTime)));

// 0. Le differenze: solo le righe nuove o tolte, con una riga di contesto.
const df = differenze("## Spiaggia\n- Ombrellone\n- Lettini", "## Spiaggia\n- Ombrellone\n- Lettini\n- Cabina\n\n## Pranzo\n- Panini");
assert.equal(df.testo, "  - Lettini\n+ - Cabina\n+ ## Pranzo\n+ - Panini");
assert.equal(differenze("a\nb", "a\nb").testo, "", "nessuna differenza");

// 1. Il documento della copia cambiato a mano nel passo 2 e un file nuovo messo da Mattia nella cartella: niente finché
// non sono fermi da 30 minuti; le copie scritte dall'app non tornano come novità.
const prog = D.aggiungiAMano({ name: "Programma estate", mimeType: DOCG, parents: [cartellaMare] }, "mattia@example.com", "Programma dell'estate\nPrenotare il bagno Marino entro maggio\nIl bagno è prenotato");
assert.equal((await giro(ultimoCambio() + 10 * 60e3)).letti, 0, "dieci minuti dopo: niente");
assert.equal(richieste.length, 0);
risposta = { riassunto: "Nuovo programma", nota: { titolo: "Programma dell'estate", testo: "Scritto il programma: bagno Marino da prenotare entro maggio." },
  sintesi: DATI.projects.casa.sintesi + "\n- Bagno Marino", task: [{ text: "Prenotare il bagno Marino", due: "2027-05-31", people: "" }], task_fatti: ["t1"] };
const e1 = await giro(ultimoCambio() + FERMO_MS + 1000);
assert.equal(e1.letti, 2, "il file nuovo e la copia cambiata a mano");
assert.equal(richieste.length, 2);
const rNuovo = richieste.find((r) => /Programma estate/.test(r.user));
assert.match(rNuovo.user, /\+ Prenotare il bagno Marino entro maggio/, "un file nuovo si legge tutto");
assert.match(rNuovo.system, /è nuovo/);
assert.match(rNuovo.system, /\[t1\] Prenotare il bagno/, "i task aperti del progetto, con il codice");
assert.doesNotMatch(rNuovo.system, /Segreto/, "niente task privati in un progetto condiviso");
assert.equal(rNuovo.model, "haiku", "differenza piccola: Haiku");
const rCopia = richieste.find((r) => /Note 2026-11/.test(r.user));
assert.match(rCopia.system, /copia leggibile del progetto/);
assert.match(rCopia.user, /\+ Appunti miei aggiunti a mano/);
assert.doesNotMatch(rCopia.user, /^\+ .*Prezzi/m, "della copia solo ciò che è cambiato");
const pd = proposteDrive();
assert.deepEqual([...new Set(pd.map((x) => x.kind))].sort(), ["journal_entry", "project_summary", "task", "task_done"]);
for (const x of pd) {
  assert.equal(x.status, "pending");
  assert.equal(x.projectId, "casa");
  assert.equal(x.visibility, "shared", "con la visibilità del progetto");
  assert.equal(x.ownerUid, "io", "del proprietario del progetto");
  assert.ok(x.driveFile?.id);
}
const notaProposta = pd.find((x) => x.kind === "journal_entry");
assert.equal(notaProposta.payload.titolo, "Programma dell'estate");
assert.equal(notaProposta.payload.analizza, false);
assert.equal(notaProposta.payload.fonte.tipo, "drive");
assert.equal(pd.filter((x) => x.kind === "project_summary").length, 1, "una sola sintesi in attesa per progetto");
assert.equal(pd.find((x) => x.kind === "task_done").payload.taskId, "t1", "il codice diventa l'id del task");
assert.equal(pd.filter((x) => x.kind === "task_done").length, 1, "due file dicono lo stesso task fatto: una proposta sola");
assert.equal(pd.filter((x) => x.kind === "task").length, 1, "niente task doppi");
assert.ok(DATI.consumi && Object.keys(DATI.consumi).some((k) => k.startsWith("io_")), "costi al proprietario");

// 2. Di nuovo: niente (stessa versione). Una riga aggiunta al programma: solo quella va all'agente.
risposta = null;
assert.equal((await giro(ultimoCambio() + FERMO_MS + 2000)).letti, 0);
D.modificaAMano(prog.id, "mattia@example.com", testo(prog) + "\nComprare la crema solare");
await giro(ultimoCambio() + FERMO_MS + 1000);
const rRiga = richieste[richieste.length - 1];
assert.match(rRiga.user, /\+ Comprare la crema solare/);
assert.doesNotMatch(rRiga.user, /\+ Prenotare il bagno/, "la parte vecchia non si rilegge");
assert.match(rRiga.system, /SOLO le differenze/);

// 3. Letta la modifica a mano della copia, la copia si può riscrivere: torna com'è nell'app.
const notaCopia = [...D.files.values()].find((f) => f.name === "Note 2026-11 (novembre)");
DATI.journal_entries.n2.text = "Ombrellone 30 euro al giorno.";
await gestisci(db, "io", { azione: "copia", projectId: "casa" }, opz);
assert.match(testo(notaCopia), /Ombrellone 30 euro/, "riscritta dopo che la modifica è stata letta");
const dopoCopia = richieste.length;
await giro(ultimoCambio() + FERMO_MS + 1000);
assert.equal(richieste.length, dopoCopia, "la riscrittura dell'app non torna come novità");

// 4. Un documento collegato a mano: la prima volta è solo il punto di partenza; poi le modifiche si leggono.
const coll = D.aggiungiAMano({ name: "Preventivo bagno", mimeType: DOCG, parents: ["root"] }, "mattia@example.com", "Preventivo: 600 euro la stagione");
DATI.projects.casa.documenti = [{ id: coll.id, nome: "Preventivo bagno", mime: DOCG, link: coll.webViewLink }];
const prima4 = richieste.length;
await giro(ultimoCambio() + FERMO_MS + 1000);
assert.equal(richieste.length, prima4, "collegato: niente analisi la prima volta");
assert.equal(DATI.drive_file[`casa_${coll.id}`].ruolo, "collegato");
D.modificaAMano(coll.id, "mattia@example.com", "Preventivo: 600 euro la stagione\nSconto del 10% se si paga a marzo");
await giro(ultimoCambio() + FERMO_MS + 1000);
assert.match(richieste[richieste.length - 1].user, /\+ Sconto del 10%/);

// 5. Senza il permesso del proprietario sui file dell'app la cartella non si guarda; un errore dell'AI si riprova al
// massimo tre volte per versione.
DATI.users.io.google.permessi.cartelle = false;
D.modificaAMano(prog.id, "mattia@example.com", testo(prog) + "\nAltro");
const prima5 = richieste.length;
await giro(ultimoCambio() + FERMO_MS + 1000);
assert.equal(richieste.length, prima5);
DATI.users.io.google.permessi.cartelle = true;
const rotto = async () => { throw new Error("Claude 529 overloaded"); };
let t5 = ultimoCambio() + FERMO_MS + 1000;
for (let i = 0; i < 5; i++) { await giroNovita(db, { ...opz, key: "k", chiedi: rotto, adesso: t5 }); t5 += 7 * 60e3; }
assert.equal(DATI.drive_file[`casa_${prog.id}`].analisi.errori, 3, "tre tentativi, poi basta");

console.log("prova-drive: novità da Drive a posto");

// ───────────── Chiedi legge i documenti del progetto ─────────────
const tokenPer = (u) => tokenServer(db, u);
const { esegui: strumenti } = strumentiDi(db, { uid: "lei", hid: "casa", nomi: DATI.households.casa.memberNames, tokenPer });
const elenco = await strumenti.documenti({ progetto: "casa in montagna" });
const nomi = elenco.documenti.map((x) => x.nome).sort();
assert.ok(nomi.includes("Programma estate") && nomi.includes("Preventivo bagno"), `cartella e collegati: ${nomi}`);
assert.ok(!nomi.some((x) => /^Note 2026|Sintesi e da fare|\.jpg$/.test(x)), "non la copia dell'app né le foto");
assert.ok(nomi.includes("2026-11-03 Prezzi"), "i documenti aperti dall'app sono documenti della cartella");
const cod = elenco.documenti.find((x) => x.nome === "Preventivo bagno").codice;
assert.match(cod, /^d\d+$/);
assert.match((await strumenti.leggi_documento({ codice: cod })).testo, /Sconto del 10%/, "letto con il permesso del proprietario");
assert.match((await strumenti.leggi_documento({ codice: "d99" })).errore, /Codice sconosciuto/);
assert.match((await strumenti.documenti({ progetto: "Tennis" })).errore, /Nessun progetto/, "un progetto privato dell'altra persona non c'è");

console.log("prova-drive: Chiedi e i documenti di Drive a posto");

