// Prove delle regole di Firestore (firestore.rules) sull'emulatore, con @firebase/rules-unit-testing.
// Si lanciano con: npm ci --prefix prove/regole && npm run prova --prefix prove/regole
// (emulators:exec avvia l'emulatore di Firestore con un progetto «demo-», che non tocca quello vero).
//
// Due case: A (Mattia e Giulia, uid mA e gA) e B (uid bB). Ogni caso dice cosa deve passare e cosa no;
// un caso che non va come previsto fa uscire con 1 e il deploy non parte.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp, Timestamp, setLogLevel,
} from "firebase/firestore";

setLogLevel("silent"); // i rifiuti attesi non riempiono il registro

const QUI = dirname(fileURLToPath(import.meta.url));
const REGOLE = readFileSync(join(QUI, "..", "..", "firestore.rules"), "utf8");

const env = await initializeTestEnvironment({
  projectId: "demo-macroapp",
  firestore: { rules: REGOLE },
});

const A = "casaA", B = "casaB", A2 = "casaA2";
const mA = "uidMattia", gA = "uidGiulia", bB = "uidBruno";
const db = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();

let passati = 0;
const falliti = [];
async function caso(nome, fn) {
  try {
    await fn();
    passati++;
    console.log(`  ✓ ${nome}`);
  } catch (e) {
    falliti.push(nome);
    console.log(`  ✗ ${nome}\n      ${String(e?.message || e).split("\n")[0]}`);
  }
}
const si = (p) => assertSucceeds(p);
const no = (p) => assertFails(p);

const base = (owner, casa, visibility, extra = {}) => ({
  ownerUid: owner, householdId: casa, visibility, createdAt: Timestamp.now(), updatedAt: Timestamp.now(), ...extra,
});

// Dati di partenza scritti senza regole (come farebbe il server).
async function semina() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore();
    await setDoc(doc(f, "households", A), { name: "Casa A", members: [mA, gA], memberNames: { [mA]: "Mattia", [gA]: "Giulia" }, createdBy: mA });
    await setDoc(doc(f, "households", B), { name: "Casa B", members: [bB], memberNames: { [bB]: "Bruno" }, createdBy: bB });
    // Una seconda casa di cui Mattia è membro: serve a provare che una nota non cambia casa nemmeno verso una casa sua.
    await setDoc(doc(f, "households", A2), { name: "Casa A2", members: [mA], memberNames: { [mA]: "Mattia" }, createdBy: mA });
    await setDoc(doc(f, "users", mA), { displayName: "Mattia", householdId: A });
    await setDoc(doc(f, "users", gA), { displayName: "Giulia", householdId: A });

    await setDoc(doc(f, "expenses", "spesaA"), base(mA, A, "shared", { amount: 40, description: "Esselunga", paidBy: mA, split: "equal" }));
    await setDoc(doc(f, "tasks", "taskPrivatoM"), base(mA, A, "private", { text: "Chiamare il commercialista", done: false }));
    await setDoc(doc(f, "tasks", "taskCondiviso"), base(mA, A, "shared", { text: "Bolletta", done: false }));
    await setDoc(doc(f, "shopping_items", "latteB"), base(bB, B, "shared", { text: "Latte", done: false }));
    await setDoc(doc(f, "manual_entries", "voceB"), base(bB, B, "shared", { type: "info", name: "Wi-Fi" }));

    for (const coll of ["journal_entries", "journal_photos"]) {
      const extra = coll === "journal_entries" ? { text: "Lezione di tennis", projectId: "tennis" } : { entryId: "notaCondivisa", ordine: 0, mime: "image/jpeg", dati: "AAAA" };
      await setDoc(doc(f, coll, "condivisa"), base(mA, A, "shared", extra));
      await setDoc(doc(f, coll, "privata"), base(mA, A, "private", extra));
      await setDoc(doc(f, coll, "diB"), base(bB, B, "shared", extra));
    }

    await setDoc(doc(f, "off_account", mA), { ownerUid: mA, utente: "mattia", password: "segreta" });
    await setDoc(doc(f, "consumi", `${mA}_202611`), { ownerUid: mA, mese: "2026-11", claude: { usd: 1.2, chiamate: 10 } });
    await setDoc(doc(f, "consumi", `${gA}_202611`), { ownerUid: gA, mese: "2026-11", claude: { usd: 0.4, chiamate: 3 } });
    await setDoc(doc(f, "domande", "domandaM"), base(mA, A, "private", { tipo: "domanda", stato: "fatta", turni: [{ domanda: "Quanto ho speso?", at: Timestamp.now() }], passi: [] }));
  });
}

await semina();

console.log("Case separate");
await caso("chi non ha fatto l'accesso non legge niente", async () => {
  await no(getDoc(doc(db(null), "expenses", "spesaA")));
  await no(getDoc(doc(db(null), "households", A)));
});
await caso("un membro di B non legge la casa A né le sue cose condivise", async () => {
  await no(getDoc(doc(db(bB), "households", A)));
  await no(getDoc(doc(db(bB), "expenses", "spesaA")));
  await no(getDoc(doc(db(bB), "tasks", "taskCondiviso")));
  await no(getDoc(doc(db(bB), "journal_entries", "condivisa")));
});
await caso("la query delle cose condivise di A fatta da B è rifiutata", async () => {
  await no(getDocs(query(collection(db(bB), "expenses"), where("householdId", "==", A), where("visibility", "==", "shared"))));
});
await caso("la query delle cose condivise della propria casa passa", async () => {
  await si(getDocs(query(collection(db(gA), "expenses"), where("householdId", "==", A), where("visibility", "==", "shared"))));
});
await caso("A non legge le cose condivise di B", async () => {
  await no(getDoc(doc(db(mA), "shopping_items", "latteB")));
  await no(getDoc(doc(db(gA), "manual_entries", "voceB")));
});
await caso("B non scrive nella casa A (né crea, né modifica, né elimina)", async () => {
  await no(setDoc(doc(db(bB), "expenses", "nuovaB"), base(bB, A, "shared", { amount: 1 })));
  await no(updateDoc(doc(db(bB), "expenses", "spesaA"), { amount: 1 }));
  await no(deleteDoc(doc(db(bB), "expenses", "spesaA")));
});
await caso("nessuno crea un documento a nome di un altro", async () => {
  await no(setDoc(doc(db(gA), "tasks", "falso"), base(mA, A, "shared", { text: "x" })));
});
await caso("B non entra in A, che ha già due membri", async () => {
  await no(updateDoc(doc(db(bB), "households", A), { members: [mA, gA, bB] }));
});
await caso("B non spia i profili di A", async () => {
  await no(getDoc(doc(db(bB), "users", mA)));
  await no(getDoc(doc(db(gA), "users", mA)));
  await si(getDoc(doc(db(mA), "users", mA)));
});

console.log("Documenti privati");
await caso("un task privato lo legge solo chi l'ha scritto", async () => {
  await si(getDoc(doc(db(mA), "tasks", "taskPrivatoM")));
  await no(getDoc(doc(db(gA), "tasks", "taskPrivatoM")));
});
await caso("l'altro membro non modifica né elimina un documento privato", async () => {
  await no(updateDoc(doc(db(gA), "tasks", "taskPrivatoM"), { done: true }));
  await no(deleteDoc(doc(db(gA), "tasks", "taskPrivatoM")));
});
await caso("la query delle cose private dell'altro è rifiutata", async () => {
  await no(getDocs(query(collection(db(gA), "tasks"), where("ownerUid", "==", mA))));
  await si(getDocs(query(collection(db(mA), "tasks"), where("ownerUid", "==", mA))));
});
await caso("una cosa condivisa la modifica anche l'altro membro, ma non ne cambia la visibilità", async () => {
  await si(updateDoc(doc(db(gA), "tasks", "taskCondiviso"), { done: true }));
  await no(updateDoc(doc(db(gA), "tasks", "taskCondiviso"), { visibility: "private" }));
});

for (const coll of ["journal_entries", "journal_photos"]) {
  console.log(coll === "journal_entries" ? "Note del diario" : "Foto delle note (stessa regola delle note)");
  await semina();
  await caso(`${coll}: la nota condivisa la leggono tutti e due, quella privata solo chi l'ha scritta`, async () => {
    await si(getDoc(doc(db(gA), coll, "condivisa")));
    await no(getDoc(doc(db(gA), coll, "privata")));
    await si(getDoc(doc(db(mA), coll, "privata")));
    await no(getDoc(doc(db(bB), coll, "condivisa")));
  });
  await caso(`${coll}: la nota condivisa la modificano tutti e due`, async () => {
    const campo = coll === "journal_entries" ? { text: "Corretta da Giulia", modificataDa: gA, modificataAt: serverTimestamp() } : { ordine: 1 };
    await si(updateDoc(doc(db(gA), coll, "condivisa"), campo));
    await si(updateDoc(doc(db(mA), coll, "condivisa"), coll === "journal_entries" ? { text: "Corretta da Mattia" } : { ordine: 2 }));
  });
  await caso(`${coll}: nessuno cambia ownerUid`, async () => {
    await no(updateDoc(doc(db(gA), coll, "condivisa"), { ownerUid: gA }));
    await no(updateDoc(doc(db(mA), coll, "condivisa"), { ownerUid: gA }));
    await no(updateDoc(doc(db(mA), coll, "privata"), { ownerUid: gA }));
  });
  await caso(`${coll}: nessuno cambia householdId, nemmeno verso un'altra casa propria`, async () => {
    await no(updateDoc(doc(db(gA), coll, "condivisa"), { householdId: B }));
    await no(updateDoc(doc(db(mA), coll, "condivisa"), { householdId: A2 }));
    await no(updateDoc(doc(db(mA), coll, "privata"), { householdId: A2 }));
  });
  await caso(`${coll}: la visibilità la cambia solo chi ha scritto la nota`, async () => {
    await no(updateDoc(doc(db(gA), coll, "condivisa"), { visibility: "private" }));
    await si(updateDoc(doc(db(mA), coll, "condivisa"), { visibility: "private" }));
    await no(getDoc(doc(db(gA), coll, "condivisa")));
    await si(updateDoc(doc(db(mA), coll, "condivisa"), { visibility: "shared" }));
    await si(getDoc(doc(db(gA), coll, "condivisa")));
  });
  await caso(`${coll}: una nota nuova nasce a nome proprio, nella propria casa`, async () => {
    await si(setDoc(doc(db(gA), coll, "nuovaG"), base(gA, A, "shared", { text: "x" })));
    await no(setDoc(doc(db(gA), coll, "nuovaFalsa"), base(mA, A, "shared", { text: "x" })));
    await no(setDoc(doc(db(gA), coll, "nuovaAltrove"), base(gA, B, "shared", { text: "x" })));
    await no(setDoc(doc(db(gA), coll, "nuovaStrana"), base(gA, A, "pubblica", { text: "x" })));
  });
  await caso(`${coll}: la nota condivisa la elimina anche l'altro membro, quella privata no`, async () => {
    await no(deleteDoc(doc(db(gA), coll, "privata")));
    await no(deleteDoc(doc(db(bB), coll, "condivisa")));
    await si(deleteDoc(doc(db(gA), coll, "condivisa")));
  });
}

console.log("Collezioni del server");
await semina();
await caso("off_account: l'app non lo legge né lo scrive, nemmeno il proprio", async () => {
  await no(getDoc(doc(db(mA), "off_account", mA)));
  await no(setDoc(doc(db(mA), "off_account", mA), { ownerUid: mA, utente: "x", password: "y" }));
  await no(updateDoc(doc(db(mA), "off_account", mA), { password: "z" }));
  await no(deleteDoc(doc(db(mA), "off_account", mA)));
  await no(getDoc(doc(db(gA), "off_account", mA)));
});
await caso("consumi: ciascuno legge i propri mesi, anche uno ancora vuoto", async () => {
  await si(getDoc(doc(db(mA), "consumi", `${mA}_202611`)));
  await si(getDoc(doc(db(mA), "consumi", `${mA}_202612`)));
  await no(getDoc(doc(db(gA), "consumi", `${mA}_202611`)));
  await no(getDoc(doc(db(mA), "consumi", `${mA}_tutto`)));
});
await caso("consumi: l'app non li scrive", async () => {
  await no(setDoc(doc(db(mA), "consumi", `${mA}_202612`), { ownerUid: mA, claude: { usd: 0 } }));
  await no(updateDoc(doc(db(mA), "consumi", `${mA}_202611`), { "claude.usd": 0 }));
  await no(deleteDoc(doc(db(mA), "consumi", `${mA}_202611`)));
});
await caso("domande: le legge, le continua e le elimina solo chi le ha fatte", async () => {
  await si(getDoc(doc(db(mA), "domande", "domandaM")));
  await no(getDoc(doc(db(gA), "domande", "domandaM")));
  await no(updateDoc(doc(db(gA), "domande", "domandaM"), { stato: "nuova" }));
  await no(deleteDoc(doc(db(gA), "domande", "domandaM")));
  await si(updateDoc(doc(db(mA), "domande", "domandaM"), { stato: "nuova", turni: [{ domanda: "Quanto ho speso?" }, { domanda: "E a ottobre?" }] }));
});
await caso("domande: sempre private, e nessuno ne cambia proprietario, casa o visibilità", async () => {
  await si(setDoc(doc(db(gA), "domande", "domandaG"), base(gA, A, "private", { tipo: "domanda", stato: "nuova", turni: [{ domanda: "?" }] })));
  await no(setDoc(doc(db(gA), "domande", "domandaCondivisa"), base(gA, A, "shared", { tipo: "domanda", stato: "nuova", turni: [] })));
  await no(updateDoc(doc(db(mA), "domande", "domandaM"), { visibility: "shared" }));
  await no(updateDoc(doc(db(mA), "domande", "domandaM"), { ownerUid: gA }));
  await no(updateDoc(doc(db(mA), "domande", "domandaM"), { householdId: A2 }));
  await no(getDocs(query(collection(db(gA), "domande"), where("ownerUid", "==", mA))));
  await si(getDocs(query(collection(db(mA), "domande"), where("ownerUid", "==", mA))));
  await si(deleteDoc(doc(db(mA), "domande", "domandaM")));
});
await caso("google_tokens, avvisi_stato, drive_testi: solo il server", async () => {
  await no(getDoc(doc(db(mA), "google_tokens", mA)));
  await no(setDoc(doc(db(mA), "google_tokens", mA), { refreshToken: "x" }));
  await no(getDoc(doc(db(mA), "avvisi_stato", A)));
  await no(getDoc(doc(db(mA), "drive_testi", `${mA}_file`)));
});
await caso("una collezione non prevista è chiusa", async () => {
  await no(getDoc(doc(db(mA), "qualcosa", "x")));
  await no(setDoc(doc(db(mA), "qualcosa", "x"), base(mA, A, "shared")));
});

await env.cleanup();
console.log(`\n${passati} casi a posto, ${falliti.length} no`);
if (falliti.length) {
  console.log("Non vanno: " + falliti.join(" · "));
  process.exit(1);
}
