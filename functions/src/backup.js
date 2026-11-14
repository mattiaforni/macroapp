// Backup settimanale di Firestore (14/11): export gestito (exportDocuments) di tutte le collezioni verso il bucket
// `<progetto>-backup` dello stesso progetto, una cartella per volta (`AAAA-MM-GG-HHMM`, ora di Roma). I dati non escono
// dal progetto: il bucket è suo, senza accesso pubblico. Bucket, permessi e conservazione (8 settimane: poi Cloud
// Storage cancella da solo) li prepara il deploy (deploy.yml, passo «Backup»). Ripristino: docs/ARCHITETTURA.md, Backup.
//
// Le collezioni si nominano una per una (`collectionIds`) invece di esportare «tutto»: solo un export per collezioni
// permette poi di ripristinarne una sola (es. le note) senza riscrivere il resto. Sono tutte al primo livello
// (nessuna sottocollezione), quindi `listCollections()` le dà tutte, anche quelle che nasceranno.
//
// La funzione avvia l'export e ne aspetta la fine (per un database come questo, pochi minuti): nel registro resta
// «backup riuscito» con documenti e byte, o l'errore, che la Diagnosi mostra tra gli ultimi errori.

export const bucketDi = (progetto) => `${progetto}-backup`;

const API = "https://firestore.googleapis.com/v1";

/** Nome della cartella del backup: data e ora di Roma, `AAAA-MM-GG-HHMM` (si ordina come testo). */
export function cartellaDi(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}`;
}

/**
 * Avvia l'export e ne aspetta la fine (al più `attendiMs`). Ritorna { stato: "riuscito" | "in_corso", cartella,
 * destinazione, collezioni, operazione, documenti?, byte? }; un export rifiutato o finito male è un errore.
 * `token()` dà un token d'accesso del service account della funzione; `fetch` e `dorme` si sostituiscono nella prova.
 */
export async function backup(db, {
  progetto, token, fetch = globalThis.fetch, dorme = (ms) => new Promise((ok) => setTimeout(ok, ms)),
  adesso = () => Date.now(), attendiMs = 420e3, ogniMs = 15e3, registro = console,
} = {}) {
  if (!progetto) throw new Error("backup: progetto sconosciuto");
  const collezioni = (await db.listCollections()).map((c) => c.id).sort();
  if (!collezioni.length) throw new Error("backup: nessuna collezione da esportare");
  const cartella = cartellaDi(new Date(adesso()));
  const destinazione = `gs://${bucketDi(progetto)}/${cartella}`;
  const intestazioni = async () => ({ Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" });

  // Un export senza `snapshotTime` legge le collezioni man mano, senza garanzia di coerenza tra l'una e l'altra; con
  // l'istante di un minuto fa (Firestore tiene un'ora di versioni anche senza il ripristino a un momento passato) è una
  // fotografia coerente. Se l'API lo rifiutasse, si riprova senza.
  const fotografia = new Date(Math.floor(adesso() / 60e3) * 60e3 - 60e3).toISOString();
  const avvia = async (corpo) => {
    const r = await fetch(`${API}/projects/${progetto}/databases/(default):exportDocuments`, {
      method: "POST", headers: await intestazioni(), body: JSON.stringify(corpo),
    });
    return { r, j: await r.json().catch(() => ({})) };
  };
  let { r, j: avvio } = await avvia({ outputUriPrefix: destinazione, collectionIds: collezioni, snapshotTime: fotografia });
  if (r.status === 400 && /snapshot/i.test(avvio.error?.message || "")) {
    registro.log(`backup: istante rifiutato (${avvio.error.message.slice(0, 120)}), export senza`);
    ({ r, j: avvio } = await avvia({ outputUriPrefix: destinazione, collectionIds: collezioni }));
  }
  if (!r.ok) throw new Error(`backup non avviato (HTTP ${r.status}): ${avvio.error?.message || "risposta senza messaggio"}`);
  const operazione = avvio.name;
  registro.log(`backup avviato: ${cartella}, ${collezioni.length} collezioni (${collezioni.join(", ")})`);

  const fine = adesso() + attendiMs;
  while (adesso() < fine) {
    await dorme(ogniMs);
    const o = await fetch(`${API}/${operazione}`, { headers: await intestazioni() }).then((x) => x.json()).catch(() => null);
    if (!o?.done) continue;
    if (o.error) throw new Error(`backup non riuscito: ${cartella}: ${o.error.message || JSON.stringify(o.error).slice(0, 200)}`);
    const meta = o.metadata || {}; // ExportDocumentsMetadata: avanzamento in documenti e byte
    const documenti = Number(meta.progressDocuments?.completedWork || 0);
    const byte = Number(meta.progressBytes?.completedWork || 0);
    registro.log(`backup riuscito: ${cartella}, ${documenti} documenti, ${byte} byte`);
    return { stato: "riuscito", cartella, destinazione, collezioni, operazione, documenti, byte };
  }
  // Non è un errore: l'export continua da solo e la Diagnosi lo vedrà finito nel bucket.
  registro.log(`backup ancora in corso dopo ${Math.round(attendiMs / 1000)} s: ${cartella} (${operazione})`);
  return { stato: "in_corso", cartella, destinazione, collezioni, operazione };
}
