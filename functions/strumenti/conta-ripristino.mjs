// Conteggi per il flusso Ripristino (.github/workflows/ripristino.yml): quanti documenti ha ogni collezione nel database
// vero e in quello ripristinato. Solo nomi di collezione e numeri: le annotazioni del job sono pubbliche.
//
//   node strumenti/conta-ripristino.mjs --collezioni           → le collezioni del database vero, separate da virgole
//   DB=ripristino-123 COLLEZIONI=a,b node strumenti/conta-ripristino.mjs
//       → tabella collezione | database vero | ripristinato; esce con 1 se il ripristinato è vuoto o se una
//         collezione del backup non c'è (il ripristino non è servito a niente)
//   DB=(default) node strumenti/conta-ripristino.mjs   → solo il database vero (dopo un ripristino in produzione)
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const app = initializeApp({ projectId: process.env.PROGETTO || "macroapp-b9bd0" });
const vero = getFirestore(app);

if (process.argv.includes("--collezioni")) {
  console.log((await vero.listCollections()).map((c) => c.id).sort().join(","));
  process.exit(0);
}

const dbId = process.env.DB || "(default)";
const ripristinato = dbId === "(default)" ? null : getFirestore(app, dbId);
const attese = (process.env.COLLEZIONI || "").split(",").map((x) => x.trim()).filter(Boolean);
const nomi = attese.length ? attese : (await (ripristinato || vero).listCollections()).map((c) => c.id).sort();
const conta = async (db, c) => (await db.collection(c).count().get()).data().count;

const righe = [];
for (const c of nomi) {
  righe.push({ c, vero: await conta(vero, c), rip: ripristinato ? await conta(ripristinato, c) : null });
}
const larga = Math.max(...righe.map((r) => r.c.length), 10);
console.log(`${"collezione".padEnd(larga)}  database vero${ripristinato ? "  ripristinato" : ""}`);
for (const r of righe) console.log(`${r.c.padEnd(larga)}  ${String(r.vero).padStart(13)}${ripristinato ? String(r.rip).padStart(14) : ""}`);
if (ripristinato) {
  const totale = righe.reduce((s, r) => s + r.rip, 0);
  const mancano = righe.filter((r) => r.rip === 0).map((r) => r.c);
  console.log(`\nTotale ripristinato: ${totale} documenti in ${righe.length - mancano.length} collezioni.`);
  console.log("Le differenze col database vero sono le modifiche fatte dopo il backup.");
  if (!totale || mancano.length) {
    console.log(`Collezioni del backup vuote nel ripristino: ${mancano.join(", ") || "tutte"}`);
    process.exit(1);
  }
}
