// Lettura di un prodotto da Open Food Facts (dati ODbL, https://it.openfoodfacts.org) per codice a barre.
// Una chiamata per codice; il risultato normalizzato finisce in `prodotti/{ean}` (vedi index.js),
// così il secondo telefono e le scansioni successive non richiamano OFF (limite 15 letture/min per IP).
// OFF chiede uno User-Agent che identifichi l'app: dal browser non si può impostare, da qui sì.
import { additivo, calcolaIndice, haBio } from "./indice.js";

export const USER_AGENT = "DebitiEDoveri/1.0 (https://macroapp-b9bd0.web.app)";

// Campi chiesti a OFF. I `_tags_it` arrivano già tradotti (categorie, additivi, etichette).
const CAMPI = [
  "code", "product_type", "product_name", "product_name_it", "generic_name_it", "brands", "quantity",
  "categories_tags", "categories_tags_it", "nutriscore_grade", "nutriscore_score", "nova_group",
  "additives_tags", "labels_tags", "labels_tags_it", "ingredients_text_it", "ingredients_text",
  "nutriments", "nutrient_levels", "image_front_small_url", "image_front_url", "completeness", "last_modified_t",
  "environmental_score_grade", "ecoscore_grade",
].join(",");

export class OffError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

/** Codice a barre valido: 8–14 cifre (EAN-8, UPC-A, EAN-13, ITF-14). */
export function normalizzaEan(s) {
  const c = String(s || "").replace(/\D/g, "");
  return /^\d{8,14}$/.test(c) ? c : null;
}

/** Chiama OFF e ritorna il JSON grezzo, o null se il prodotto non c'è. */
export async function leggiOff(ean, { fetchFn = fetch } = {}) {
  // product_type=all: un cosmetico (Open Beauty Facts) o un mangime arrivano con un rinvio al server giusto.
  const url = `https://world.openfoodfacts.org/api/v2/product/${ean}?product_type=all&lc=it&fields=${CAMPI}`;
  const r = await fetchFn(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, redirect: "follow" });
  if (r.status === 404) return null;
  if (r.status === 429) throw new OffError("Open Food Facts ha ricevuto troppe richieste: riprova tra un minuto", 429);
  if (!r.ok) throw new OffError(`Open Food Facts non risponde (${r.status})`, r.status);
  const json = await r.json();
  if (!json || json.status === 0 || !json.product) return null;
  return json.product;
}

const num = (x) => (typeof x === "number" && isFinite(x) ? Math.round(x * 10) / 10 : null);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const pulisci = (s) => String(s || "").replace(/\s+/g, " ").trim();

/** Dal prodotto OFF ai dati che l'app mostra e salva. */
export function normalizza(p) {
  const n = p.nutriments || {};
  const additivi = (p.additives_tags || []).map(additivo);
  const ingredientiNoti = Array.isArray(p.additives_tags) || !!pulisci(p.ingredients_text_it || p.ingredients_text);
  const categorie = (p.categories_tags_it || p.categories_tags || []).map((c) => cap(pulisci(String(c).replace(/^[a-z]{2}:/, "").replace(/-/g, " "))));
  const etichette = (p.labels_tags_it || p.labels_tags || []).map((c) => cap(pulisci(String(c).replace(/^[a-z]{2}:/, "").replace(/-/g, " "))));
  const nutriscore = { grado: p.nutriscore_grade || null, punteggio: typeof p.nutriscore_score === "number" ? p.nutriscore_score : null };
  const nova = [1, 2, 3, 4].includes(Number(p.nova_group)) ? Number(p.nova_group) : null;
  const valutazione = calcolaIndice({ nutriscore, nova, additivi, etichette: p.labels_tags || [], ingredientiNoti });
  const nome = pulisci(p.product_name_it || p.product_name) || pulisci(p.generic_name_it) || null;
  return {
    trovato: true,
    fonte: "off",
    tipo: p.product_type || "food",
    nome,
    marca: pulisci(p.brands).split(",")[0] || null,
    quantita: pulisci(p.quantity) || null,
    descrizione: pulisci(p.generic_name_it) || null,
    // L'ultima categoria è la più specifica («Spaghetti»): è il tipo che va sulla tessera della lista.
    categoria: categorie.length ? categorie[categorie.length - 1] : null,
    categorie: categorie.slice(-3),
    immagine: p.image_front_small_url || p.image_front_url || null,
    nutriscore,
    nova,
    additivi,
    etichette,
    bio: haBio(p.labels_tags || []),
    nutrienti: {
      kcal: num(n["energy-kcal_100g"]), grassi: num(n.fat_100g), saturi: num(n["saturated-fat_100g"]),
      zuccheri: num(n.sugars_100g), sale: num(n.salt_100g), fibre: num(n.fiber_100g), proteine: num(n.proteins_100g),
    },
    livelli: p.nutrient_levels || {},
    ambiente: p.environmental_score_grade || p.ecoscore_grade || null,
    completezza: typeof p.completeness === "number" ? Math.round(p.completeness * 100) / 100 : null,
    ingredientiNoti,
    aggiornatoOff: p.last_modified_t ? new Date(p.last_modified_t * 1000) : null,
    indice: valutazione.indice,
    fascia: valutazione.fascia,
    componenti: valutazione.componenti,
    parziale: valutazione.parziale,
    mancano: valutazione.mancano,
    versioneIndice: valutazione.versioneIndice,
  };
}
