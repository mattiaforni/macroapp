// Lettura dei documenti di Drive collegati a un progetto, per l'agente del diario.
// L'app sceglie i file (cercandoli per nome nel Drive dell'utente) e salva in `projects.documenti`
// [{ id, nome, mime, link }]; qui si legge il testo di ciascuno con il permesso dell'utente.
// Documenti, Fogli e Presentazioni di Google si esportano come testo; i file di testo si leggono
// così come sono; immagini e altri formati non si leggono (si dice all'agente che ci sono).
// PDF (14/11): Claude li legge direttamente (Haiku, una volta per versione del file) e il testo resta in
// drive_testi/{uid}_{fileId} (solo server) finché il file su Drive non cambia (`modifiedTime`).

const EXPORT = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};
const TESTO = /^text\/|^application\/(json|xml|x-yaml)$/;

export const LUNGHEZZA_DOCUMENTO = 6000;   // caratteri per documento
export const LUNGHEZZA_PDF = 30000;        // caratteri del testo di un PDF tenuti in cache
const PDF = "application/pdf";
const PDF_MAX_BYTE = 10_000_000;           // oltre, il PDF si elenca soltanto
export const LUNGHEZZA_TOTALE = 20000;     // caratteri in tutto nel prompt
export const MAX_DOCUMENTI = 6;

/** Il testo di un file, o null se il formato non si legge. Errori HTTP → eccezione con `status`. */
export async function testoDocumento(token, doc) {
  const esporta = EXPORT[doc.mime];
  if (!esporta && !TESTO.test(doc.mime || "")) return null;
  const url = esporta
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.id)}/export?mimeType=${encodeURIComponent(esporta)}`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.id)}?alt=media&supportsAllDrives=true`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const e = new Error(`Drive ${r.status} su ${doc.nome || doc.id}`);
    e.status = r.status;
    throw e;
  }
  return (await r.text()).replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Il testo di un PDF: dalla cache se il file su Drive non è cambiato, se no letto da `leggi(base64, nome)` (Claude) e
 * messo in cache. Il permesso si controlla sempre con il token dell'utente (i metadati del file), anche con la cache.
 */
export async function testoPdf(token, doc, { db, uid, leggi }) {
  const id = encodeURIComponent(doc.id);
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const m = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=modifiedTime,size&supportsAllDrives=true`, auth);
  if (!m.ok) { const e = new Error(`Drive ${m.status} su ${doc.nome || doc.id}`); e.status = m.status; throw e; }
  const meta = await m.json();
  const ref = db.collection("drive_testi").doc(`${uid}_${doc.id}`);
  const c = await ref.get();
  if (c.exists && c.data().modifiedTime === meta.modifiedTime) return c.data().testo || null;
  if (Number(meta.size || 0) > PDF_MAX_BYTE) { const e = new Error("PDF troppo grande"); e.status = 413; throw e; }
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, auth);
  if (!r.ok) { const e = new Error(`Drive ${r.status} su ${doc.nome || doc.id}`); e.status = r.status; throw e; }
  const dati = Buffer.from(await r.arrayBuffer()).toString("base64");
  const testo = String(await leggi(dati, doc.nome || "documento") || "").trim().slice(0, LUNGHEZZA_PDF);
  const { FieldValue } = await import("firebase-admin/firestore");
  await ref.set({ ownerUid: uid, fileId: doc.id, nome: doc.nome || "", modifiedTime: meta.modifiedTime || "", testo, letto: FieldValue.serverTimestamp() });
  return testo || null;
}

/**
 * I documenti di un progetto come li vede l'agente: [{ nome, testo | null, errore? }], nei limiti di
 * lunghezza. `token` è il permesso di un'ora dell'utente (account.js → tokenServer); senza, i
 * documenti si elencano soltanto. `pdf` = { db, uid, leggi } per leggere anche i PDF (testoPdf).
 */
export async function leggiDocumenti(token, documenti = [], passo = () => {}, { pdf = null } = {}) {
  const scelti = (Array.isArray(documenti) ? documenti : []).filter((d) => d?.id).slice(0, MAX_DOCUMENTI);
  if (!scelti.length) return [];
  let spazio = LUNGHEZZA_TOTALE;
  const letti = await Promise.all(scelti.map(async (d) => {
    const voce = { nome: d.nome || d.id, mime: d.mime || "", testo: null };
    if (!token) return voce;
    try {
      const t = d.mime === PDF && pdf ? await testoPdf(token, d, pdf) : await testoDocumento(token, d);
      if (t == null) return voce;
      voce.testo = t.slice(0, LUNGHEZZA_DOCUMENTO);
    } catch (err) {
      voce.errore = err.status === 404 ? "non trovato o non più condiviso" : err.status === 403 ? "senza permesso" : err.status === 413 ? "PDF troppo grande" : "non letto";
      passo(`documento «${voce.nome}» ${voce.errore} (${err.message})`);
    }
    return voce;
  }));
  for (const v of letti) {
    if (!v.testo) continue;
    v.testo = v.testo.slice(0, Math.max(0, spazio));
    spazio -= v.testo.length;
    if (!v.testo) { v.testo = null; v.errore = "tralasciato: i documenti sono troppo lunghi"; }
  }
  return letti;
}

/** Sezione del prompt con i documenti del progetto. */
export function sezioneDocumenti(letti) {
  if (!letti?.length) return "";
  const righe = letti.map((d) => d.testo
    ? `<documento nome="${d.nome.replace(/"/g, "'")}">\n${d.testo}\n</documento>`
    : `<documento nome="${d.nome.replace(/"/g, "'")}" testo="non disponibile${d.errore ? `: ${d.errore}` : " (formato non letto)"}"/>`);
  return `
Documenti che l'utente ha collegato al progetto, da Google Drive. Sono contesto di riferimento (programmi,
appunti, materiali): usali per capire di cosa parla la nota e per il riepilogo e la sintesi, senza riassumerli
né proporre azioni che vengono solo da loro.
<documenti>
${righe.join("\n")}
</documenti>`;
}
