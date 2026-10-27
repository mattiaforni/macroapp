// Indice sintetico di un prodotto alimentare (0–100), sul modello di Yuka ma con regole nostre,
// dichiarate qui, e con fonti pubbliche (Open Food Facts; per gli additivi la valutazione EFSA).
//
// Componenti e pesi:
//   nutrizione 50  Nutri-Score (A 100, B 80, C 55, D 30, E 10)
//   additivi   25  nessuno 100; poi 20 punti in meno per additivo (5 o più → 0);
//                  tetto 60 con un additivo a rischio EFSA «moderato», tetto 40 con uno «alto»
//   nova       15  grado di trasformazione NOVA (1–2 → 100, 3 → 75, 4 → 0)
//   bio        10  etichetta biologica (100) o no (0)
// L'indice è la media pesata delle componenti note; se una manca, le altre si ripartiscono i pesi
// e l'indice è «parziale». Senza Nutri-Score né ingredienti non c'è indice.
// Come in Yuka, un additivo a rischio alto porta l'indice al massimo a 49 (mai «buono»).
//
// Fasce: 75+ eccellente, 50–74 buono, 25–49 mediocre, sotto scarso.
// Funzioni pure: si provano con `node functions/strumenti/prova-prodotti.mjs`.
import { ADDITIVI } from "./additivi.js";

export const PESI = { nutrizione: 50, additivi: 25, nova: 15, bio: 10 };
const NUTRISCORE = { a: 100, b: 80, c: 55, d: 30, e: 10 };
const NOVA = { 1: 100, 2: 100, 3: 75, 4: 0 };
const TETTO_RISCHIO = { moderato: 60, alto: 40 };

export function fasciaDi(indice) {
  if (indice == null) return null;
  if (indice >= 75) return "eccellente";
  if (indice >= 50) return "buono";
  if (indice >= 25) return "mediocre";
  return "scarso";
}
export const NOME_FASCIA = { eccellente: "Eccellente", buono: "Buono", mediocre: "Mediocre", scarso: "Scarso" };

/** "en:e250" → { codice: "E250", nome, classe, rischio } (rischio: alto | moderato | nessuno | null = non valutato). */
export function additivo(tag) {
  const id = String(tag || "").replace(/^[a-z]{2}:/, "").toLowerCase();
  const voce = ADDITIVI[id];
  const codice = id.toUpperCase().replace(/\((.*)\)/, "($1)");
  if (!voce) return { codice, nome: codice, classe: "", rischio: null };
  return { codice, nome: voce[0], classe: voce[1] || "", rischio: voce[2] || null };
}

/** Punteggio della componente additivi, da un elenco di additivi già risolti. */
export function punteggioAdditivi(additivi) {
  let p = Math.max(0, 100 - 20 * additivi.length);
  for (const a of additivi) if (a.rischio && TETTO_RISCHIO[a.rischio] != null) p = Math.min(p, TETTO_RISCHIO[a.rischio]);
  return p;
}

const haBio = (labels = []) => labels.some((t) => /^[a-z]{2}:(organic|eu-organic|bio)$/.test(t) || /organic|biologic/.test(t));

/**
 * Dai dati di Open Food Facts (già normalizzati da off.js: nutriscore, nova, additivi, etichette,
 * ingredientiNoti) alle componenti e all'indice. Ogni componente: { valore, peso, stato }
 * con stato `noto` | `ignoto` | `non-applicabile` (es. Nutri-Score dell'acqua).
 */
export function calcolaIndice({ nutriscore, nova, additivi = [], etichette = [], ingredientiNoti = false }) {
  const comp = {};
  const grado = String(nutriscore?.grado || "").toLowerCase();
  if (NUTRISCORE[grado] != null) comp.nutrizione = { valore: NUTRISCORE[grado], peso: PESI.nutrizione, stato: "noto" };
  else if (/not-applicable/.test(grado)) comp.nutrizione = { valore: null, peso: PESI.nutrizione, stato: "non-applicabile" };
  else comp.nutrizione = { valore: null, peso: PESI.nutrizione, stato: "ignoto" };

  comp.additivi = ingredientiNoti
    ? { valore: punteggioAdditivi(additivi), peso: PESI.additivi, stato: "noto" }
    : { valore: null, peso: PESI.additivi, stato: "ignoto" };

  comp.nova = NOVA[nova] != null
    ? { valore: NOVA[nova], peso: PESI.nova, stato: "noto" }
    : { valore: null, peso: PESI.nova, stato: "ignoto" };

  comp.bio = { valore: haBio(etichette) ? 100 : 0, peso: PESI.bio, stato: "noto" };

  const note = Object.values(comp).filter((c) => c.stato === "noto");
  const base = comp.nutrizione.stato === "noto" || comp.additivi.stato === "noto";
  let indice = null;
  if (base) {
    const pesoTot = note.reduce((s, c) => s + c.peso, 0);
    indice = Math.round(note.reduce((s, c) => s + c.valore * c.peso, 0) / pesoTot);
    if (additivi.some((a) => a.rischio === "alto")) indice = Math.min(indice, 49);
  }
  const mancano = Object.entries(comp).filter(([, c]) => c.stato === "ignoto").map(([k]) => k);
  return { indice, fascia: fasciaDi(indice), componenti: comp, parziale: indice != null && mancano.length > 0, mancano };
}
