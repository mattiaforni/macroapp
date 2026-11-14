// Foto di una nota del diario (4/11, richiesta di Mattia). Le foto stanno in Firestore, non in Cloud Storage: una
// collezione `journal_photos`, un documento per foto (JPEG in base64, lato lungo al più 1600 px, sotto i 900 KB:
// il limite di un documento è 1 MiB), con una miniatura piccola (`mini`) per la striscia. La nota tiene solo
// `foto: [{ id, w, h }]`: l'elenco del Diario resta leggero (100 note senza un byte di immagine) e la striscia del
// foglio di lettura si disegna subito con riquadri delle proporzioni giuste, che si riempiono quando le foto
// arrivano (mai a pezzi). Scelta per non aggiungere un bucket, regole e un passo di deploy a parte: se le foto
// diventano tante, la strada è Cloud Storage con gli stessi campi.
//
// Le foto hanno la visibilità della loro nota: condivise se la nota è di un progetto condiviso (7/11, core/note.js).
//
// journal_photos { ownerUid, householdId, visibility, entryId, ordine, mime, w, h, dati (base64), mini (base64) }
import { el, icon, toast } from "../core/ui.js";
import { create, update, remove, leggiDove, where, VIS } from "../core/db.js";
import { session } from "../core/auth.js";

const COLL = "journal_photos";
const LATO_MAX = 1600;    // px del lato lungo
const LATO_MINI = 240;    // px della miniatura nella striscia
const BYTE_MAX = 900_000; // base64 di `dati`: sotto il MiB del documento, con margine per `mini` e il resto
const QUALITA = [0.82, 0.7, 0.58, 0.45];
const ALTEZZA = 96;       // px delle miniature nella striscia (lo stesso numero in base.css, .foto-striscia)

/** Un'immagine (file o blob) in JPEG base64 col lato lungo entro `lato`. Ritorna { url, w, h }. */
async function ridotta(sorgente, lato, qualita) {
  const img = sorgente instanceof ImageBitmap ? sorgente : await createImageBitmap(sorgente);
  const k = Math.min(1, lato / Math.max(img.width, img.height));
  const tela = document.createElement("canvas");
  tela.width = Math.max(1, Math.round(img.width * k)); tela.height = Math.max(1, Math.round(img.height * k));
  tela.getContext("2d").drawImage(img, 0, 0, tela.width, tela.height);
  return { url: tela.toDataURL("image/jpeg", qualita), w: tela.width, h: tela.height, img };
}

/**
 * Da un file del telefono a una foto pronta da salvare: { url, mini, w, h }. La qualità scende finché la foto sta
 * sotto BYTE_MAX; se non basta, si dimezza il lato.
 */
export async function preparaFoto(file) {
  let img = await createImageBitmap(file);
  let lato = LATO_MAX;
  for (let giro = 0; giro < 3; giro++) {
    for (const q of QUALITA) {
      const r = await ridotta(img, lato, q);
      if (r.url.length <= BYTE_MAX) {
        const mini = await ridotta(img, LATO_MINI, 0.7);
        return { url: r.url, mini: mini.url, w: r.w, h: r.h };
      }
    }
    lato = Math.round(lato / 2);
  }
  throw new Error("Foto troppo grande");
}

const base64 = (url) => url.split(",")[1] || "";
const daBase64 = (b64) => `data:image/jpeg;base64,${b64}`;

/** Salva le foto nuove di una nota (dopo quelle che ha già), con la visibilità della nota, e aggiorna `foto` sulla nota. */
export async function salvaFoto(entryId, nuove, giaSalvate = [], visibility = VIS.PRIVATE) {
  if (!nuove.length) return giaSalvate;
  const voci = [...giaSalvate];
  for (const f of nuove) {
    const { id, saved } = create(COLL, {
      entryId, ordine: voci.length, mime: "image/jpeg", w: f.w, h: f.h, dati: base64(f.url), mini: base64(f.mini),
    }, visibility);
    saved.catch(() => toast("Una foto non si è salvata"));
    voci.push({ id, w: f.w, h: f.h });
  }
  await update("journal_entries", entryId, { foto: voci });
  return voci;
}

/** Toglie dalla nota le foto con questi id (e i loro documenti). */
export async function eliminaFoto(entryId, ids, attuali = []) {
  if (!ids.length) return attuali;
  const resto = attuali.filter((f) => !ids.includes(f.id));
  for (const id of ids) remove(COLL, id);
  await update("journal_entries", entryId, { foto: resto });
  return resto;
}

/** Le foto di una nota che cambia visibilità (spostata in un progetto condiviso o fuori): la seguono. */
export function visibilitaFoto(foto, visibility) {
  for (const f of foto) update(COLL, f.id, { visibility });
}

/** Tutte le foto di una nota eliminata. */
export function eliminaFotoDi(n) {
  for (const f of n.foto || []) remove(COLL, f.id);
}

/** Le foto di una nota, in ordine: [{ id, url, mini, w, h }]. Quelle che mancano (non ancora arrivate) si saltano. */
export async function leggiFoto(n) {
  const voci = n.foto || [];
  if (!voci.length) return [];
  // Le proprie, e per una nota condivisa anche quelle della casa (le regole chiedono la query così): in una nota
  // condivisa le foto possono averle aggiunte tutti e due.
  const [mie, casa] = await Promise.all([
    leggiDove(COLL, where("ownerUid", "==", session.user.uid), where("entryId", "==", n.id)),
    n.visibility === VIS.SHARED && session.householdId
      ? leggiDove(COLL, where("householdId", "==", session.householdId), where("visibility", "==", VIS.SHARED), where("entryId", "==", n.id))
      : [],
  ]);
  const docs = [...mie, ...casa];
  const per = new Map(docs.map((d) => [d.id, d]));
  return voci.map((v) => per.get(v.id)).filter(Boolean)
    .map((d) => ({ id: d.id, url: daBase64(d.dati), mini: d.mini ? daBase64(d.mini) : daBase64(d.dati), w: d.w, h: d.h }));
}

/** Larghezza di una miniatura alta ALTEZZA con le proporzioni della foto (tra 56 e 200 px). */
const larghezza = (f) => `${Math.round(Math.max(56, Math.min(200, ALTEZZA * ((f.w || 4) / (f.h || 3)))))}px`;

/**
 * La foto a tutto schermo: si chiude toccandola o con Esc. Senza una voce nella cronologia: il tasto indietro
 * chiuderebbe anche il foglio sotto (i fogli non si impilano).
 */
export function apriVisore(url, alt = "Foto") {
  const img = el("img", { src: url, alt });
  const v = el("div.visore", { role: "dialog", "aria-label": alt }, img,
    el("button.tondo.tondo--piatto.visore__chiudi", { type: "button", "aria-label": "Chiudi" }, icon("chiudi")));
  const chiudi = () => { v.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); chiudi(); } };
  v.addEventListener("click", chiudi);
  document.addEventListener("keydown", onKey, true);
  document.body.append(v);
  return chiudi;
}

/**
 * Striscia delle foto di una nota per il foglio di lettura: riquadri subito (dalle proporzioni in `foto`), le
 * immagini appena arrivano; il tocco apre la foto intera. Niente, se la nota non ha foto.
 */
export function strisciaFoto(n) {
  const voci = n.foto || [];
  if (!voci.length) return null;
  const riquadri = voci.map((f) => el("button.foto-striscia__foto", { type: "button", "aria-label": "Foto", style: `width:${larghezza(f)}`, disabled: true }));
  const nodo = el("div.foto-striscia", {}, ...riquadri);
  leggiFoto(n).then((foto) => {
    const per = new Map(foto.map((f) => [f.id, f]));
    voci.forEach((v, i) => {
      const f = per.get(v.id);
      if (!f) return;
      riquadri[i].disabled = false;
      riquadri[i].replaceChildren(el("img", { src: f.mini, alt: "" }));
      riquadri[i].addEventListener("click", () => apriVisore(f.url));
    });
  });
  return nodo;
}

/**
 * Scelta delle foto nel foglio della nota: quelle già salvate e quelle appena aggiunte, con la × per toglierle,
 * «Scatta» (la fotocamera del telefono, direttamente: `capture`) e «Galleria» (più foto insieme). Due campi
 * distinti perché su Android un campo con `multiple` apre il selettore delle foto, senza la fotocamera (4/11,
 * Mattia: «fammi anche scattare la foto, non solo caricare»). Ritorna { node, valore() } con
 * valore() = { nuove: [{ url, mini, w, h }], tolte: [id] }. `iniziali`: file da aggiungere subito (immagini condivise
 * da un'altra app, 14/11).
 */
export function sceltaFoto({ esistente = null, iniziali = [] } = {}) {
  const salvate = (esistente?.foto || []).map((f) => ({ ...f, url: null, mini: null }));
  const nuove = [];
  const tolte = new Set();
  const file = el("input", { type: "file", accept: "image/*", multiple: true, hidden: true, "aria-label": "Scegli le foto" });
  const fotocamera = el("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, "aria-label": "Scatta una foto" });
  const striscia = el("div.foto-striscia.foto-striscia--scelta");
  const scatta = el("button.pillola", { type: "button", onclick: () => fotocamera.click() }, icon("fotocamera"), "Scatta");
  const galleria = el("button.pillola", { type: "button", onclick: () => file.click() }, icon("immagine"), "Galleria");
  const stato = el("span.meta", { hidden: true });

  function riquadro(f, togli) {
    const r = el("div.foto-striscia__foto", { style: `width:${larghezza(f)}` },
      f.mini ? el("img", { src: f.mini, alt: "" }) : null,
      el("button.foto-striscia__togli", { type: "button", "aria-label": "Togli la foto", onclick: togli }, icon("chiudi")));
    return r;
  }
  function disegna() {
    striscia.replaceChildren(
      ...salvate.filter((f) => !tolte.has(f.id)).map((f) => riquadro(f, () => { tolte.add(f.id); disegna(); })),
      ...nuove.map((f, i) => riquadro(f, () => { nuove.splice(i, 1); disegna(); })),
    );
    striscia.hidden = !striscia.children.length;
  }
  if (esistente?.foto?.length) {
    leggiFoto(esistente).then((foto) => {
      for (const f of foto) { const s = salvate.find((x) => x.id === f.id); if (s) s.mini = f.mini; }
      disegna();
    });
  }
  const aggiungi = async (campo) => {
    const scelti = [...(campo.files || [])];
    campo.value = "";
    await prepara(scelti);
  };
  const prepara = async (scelti) => {
    if (!scelti.length) return;
    stato.hidden = false; stato.textContent = scelti.length === 1 ? "Preparo la foto…" : "Preparo le foto…";
    for (const f of scelti) {
      try { nuove.push(await preparaFoto(f)); } catch (e) { console.warn("foto", e); toast("Una foto non si è potuta leggere"); }
    }
    stato.hidden = true;
    disegna();
  };
  file.addEventListener("change", () => aggiungi(file));
  fotocamera.addEventListener("change", () => aggiungi(fotocamera));
  disegna();
  if (iniziali.length) prepara(iniziali);
  const node = el("div", {}, striscia, el("div.segmenti", { style: "padding-top:4px;align-items:center" }, scatta, galleria, stato), file, fotocamera);
  return { node, valore: () => ({ nuove: [...nuove], tolte: [...tolte] }) };
}
