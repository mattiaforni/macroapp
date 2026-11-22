// I documenti di Drive di un progetto, per Chiedi e per il connettore MCP (22/11, docs/PIANO-DRIVE-MCP.md): quelli nella
// cartella del progetto (cartelle.js; non le sottocartelle dell'app «Copia dall'app» e «Foto», che ripetono ciò che c'è
// già nell'app) e quelli collegati a mano (`projects.documenti`). Il progetto lo sceglie chi chiama tra quelli che vede
// (chiedi.js → trovaProgetto); qui si legge con il permesso Google del proprietario del progetto (la cartella sta nel suo
// Drive) e, se non basta, con quello di chi chiede. I PDF non si rileggono con l'AI: si usa il testo già estratto
// (drive_file dal controllo delle novità, drive_testi dall'agente), se c'è.
import { drive } from "./cartelle.js";

const LUNGHEZZA = 20000;
const EXPORT = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};
const TIPI = {
  "application/vnd.google-apps.document": "Documento Google", "application/vnd.google-apps.spreadsheet": "Foglio Google",
  "application/vnd.google-apps.presentation": "Presentazione Google", "application/pdf": "PDF", "text/plain": "Testo", "text/csv": "CSV",
};
const tipo = (m = "") => TIPI[m] || (m.startsWith("image/") ? "Immagine" : m.startsWith("text/") ? "Testo" : "File");
const giorno = (t) => (t ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date(t)) : "");

/** I permessi utili, in ordine: il proprietario del progetto, poi chi chiede. `tokenPer(uid)` → { accessToken, permessi }. */
async function permessi(p, uid, tokenPer) {
  const out = [];
  for (const u of [p.ownerUid, uid]) {
    if (!tokenPer || !u || out.some((x) => x.uid === u)) continue;
    try {
      const t = await tokenPer(u);
      if (t?.accessToken && (t.permessi?.drive || t.permessi?.cartelle)) out.push({ uid: u, token: t.accessToken });
    } catch (e) { /* non collegato o scaduto: si prova l'altro */ }
  }
  return out;
}

/** Prova la chiamata con un permesso dopo l'altro finché uno non è rifiutato per 403/404. */
async function conPermessi(lista, fn) {
  let ultimo = null;
  for (const { token } of lista) {
    try { return await fn(token); } catch (e) { if (e.status !== 403 && e.status !== 404) throw e; ultimo = e; }
  }
  throw ultimo || Object.assign(new Error("Google non collegato"), { status: 401 });
}

/** I documenti del progetto: { documenti: [{ id, nome, mime, tipo, modificato, dove: "cartella" | "collegato", link }] } o { errore }. */
export async function elencoDocumenti(db, p, { uid, tokenPer }) {
  const lista = await permessi(p, uid, tokenPer);
  const collegati = (Array.isArray(p.documenti) ? p.documenti : []).filter((d) => d?.id);
  if (!lista.length) {
    // Senza Google si possono almeno dire i nomi dei documenti collegati.
    if (collegati.length) return { documenti: collegati.map((d) => ({ id: d.id, nome: d.nome || d.id, mime: d.mime || "", tipo: tipo(d.mime), modificato: "", dove: "collegato", link: d.link || "" })), avviso: "Google non è collegato: i testi non si leggono." };
    return { errore: "Google non è collegato con Drive: i documenti non si leggono." };
  }
  const out = new Map();
  if (p.cartella?.id && !p.cartella.persa) {
    try {
      const j = await conPermessi(lista, (t) => drive(t, "GET", "/files", { query: {
        q: `'${p.cartella.id}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
        fields: "files(id,name,mimeType,modifiedTime,webViewLink)", orderBy: "modifiedTime desc", pageSize: "50", supportsAllDrives: "true", includeItemsFromAllDrives: "true",
      } }));
      for (const f of j.files || []) out.set(f.id, { id: f.id, nome: f.name, mime: f.mimeType, tipo: tipo(f.mimeType), modificato: giorno(f.modifiedTime), modifiedTime: f.modifiedTime, dove: "cartella", link: f.webViewLink || "" });
    } catch (e) { console.warn("documenti: cartella", e.status || "", String(e.message).slice(0, 120)); }
  }
  for (const d of collegati) {
    if (out.has(d.id)) continue;
    out.set(d.id, { id: d.id, nome: d.nome || d.id, mime: d.mime || "", tipo: tipo(d.mime), modificato: "", dove: "collegato", link: d.link || "" });
  }
  return { documenti: [...out.values()] };
}

/** Il testo di un documento del progetto (al più LUNGHEZZA caratteri): { testo, tagliato } o { errore }. */
export async function testoDocumento(db, p, f, { uid, tokenPer }) {
  const lista = await permessi(p, uid, tokenPer);
  if (!lista.length) return { errore: "Google non è collegato con Drive: il testo non si legge." };
  const taglia = (t) => ({ testo: String(t || "").replace(/\r/g, "").trim().slice(0, LUNGHEZZA), tagliato: String(t || "").length > LUNGHEZZA });
  try {
    if (f.mime === "application/pdf") {
      // Il testo già estratto: dal controllo delle novità (drive_file) o dall'agente (drive_testi).
      const snap = await db.getAll(db.collection("drive_file").doc(`${p.id}_${f.id}`), db.collection("drive_testi").doc(`${p.ownerUid}_${f.id}`), db.collection("drive_testi").doc(`${uid}_${f.id}`));
      const t = snap.map((d) => d.data()?.testo).find(Boolean);
      return t ? taglia(t) : { errore: "PDF non ancora letto dall'app: si legge quando l'agente analizza una nota del progetto o quando il file cambia." };
    }
    const esporta = EXPORT[f.mime];
    if (!esporta && !/^text\/|^application\/(json|xml)/.test(f.mime || "")) return { errore: `Formato non letto (${tipo(f.mime)}).` };
    const testo = await conPermessi(lista, async (token) => {
      const url = esporta
        ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}/export?mimeType=${encodeURIComponent(esporta)}`
        : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}?alt=media&supportsAllDrives=true`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw Object.assign(new Error(`Drive ${r.status}`), { status: r.status });
      return r.text();
    });
    return taglia(testo.replace(/^﻿/, ""));
  } catch (e) {
    return { errore: e.status === 404 || e.status === 403 ? "Documento non trovato o non più condiviso." : "Drive non ha risposto." };
  }
}
