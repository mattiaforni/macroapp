// Google Drive, in sola lettura, con il permesso dell'account Google collegato (core/google.js).
// Serve a cercare un file per nome in tutto il Drive dell'utente (anche nei Drive condivisi) per
// collegarlo a un progetto o a una voce del manuale: si salva { id, nome, mime, link }. Il testo dei
// documenti di un progetto lo legge il server quando l'agente analizza una nota (functions/src/google/drive.js).
import { chiamaGoogle } from "./google.js";

const API = "https://www.googleapis.com/drive/v3/files";
const CAMPI = "files(id,name,mimeType,webViewLink,modifiedTime,owners(displayName),parents)";

const TIPI = {
  "application/vnd.google-apps.document": "Documento Google",
  "application/vnd.google-apps.spreadsheet": "Foglio Google",
  "application/vnd.google-apps.presentation": "Presentazione Google",
  "application/vnd.google-apps.form": "Modulo Google",
  "application/vnd.google-apps.folder": "Cartella",
  "application/pdf": "PDF",
  "text/plain": "Testo",
  "text/markdown": "Testo",
  "text/csv": "CSV",
};
/** I formati di cui l'agente legge il testo (gli altri si elencano soltanto). */
const LEGGIBILI = /^application\/vnd\.google-apps\.(document|spreadsheet|presentation)$|^text\//;

/** "Documento Google", "PDF", "Immagine"… dal tipo MIME. */
export function tipoDocumento(mime = "") {
  if (TIPI[mime]) return TIPI[mime];
  if (mime.startsWith("image/")) return "Immagine";
  if (mime.startsWith("audio/")) return "Audio";
  if (mime.startsWith("video/")) return "Video";
  if (/word/.test(mime)) return "Word";
  if (/sheet|excel/.test(mime)) return "Excel";
  if (/presentation|powerpoint/.test(mime)) return "PowerPoint";
  return "File";
}
export const leggibileDallAgente = (mime = "") => LEGGIBILI.test(mime);

function daGoogle(f) {
  return { id: f.id, nome: f.name, mime: f.mimeType || "", link: f.webViewLink || "", modificato: f.modifiedTime || "", di: f.owners?.[0]?.displayName || "" };
}

/** File il cui nome contiene `q`, i più recenti prima: [{ id, nome, mime, link, modificato, di }]. */
export async function cercaDrive(q, quanti = 20) {
  const t = String(q || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  if (!t) return [];
  const j = await chiamaGoogle(API, {
    query: {
      q: `name contains '${t}' and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
      fields: CAMPI, pageSize: String(quanti), orderBy: "modifiedTime desc",
      corpora: "allDrives", includeItemsFromAllDrives: "true", supportsAllDrives: "true",
    },
  });
  return (j.files || []).map(daGoogle);
}

/** Gli ultimi file modificati, per scegliere senza cercare. */
export async function recentiDrive(quanti = 12) {
  const j = await chiamaGoogle(API, {
    query: {
      q: "trashed = false and mimeType != 'application/vnd.google-apps.folder'",
      fields: CAMPI, pageSize: String(quanti), orderBy: "modifiedTime desc", corpora: "user",
    },
  });
  return (j.files || []).map(daGoogle);
}

/** Quello che si salva di un file in un documento Firestore. */
export const documentoDa = (f) => ({ id: f.id, nome: f.nome, mime: f.mime, link: f.link });
