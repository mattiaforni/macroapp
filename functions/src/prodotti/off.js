// Lettura di un prodotto da Open Food Facts (dati ODbL, https://it.openfoodfacts.org) per codice a barre.
// Una chiamata per codice; il risultato normalizzato finisce in `prodotti/{ean}` (vedi index.js),
// così il secondo telefono e le scansioni successive non richiamano OFF (limite 15 letture/min per IP).
// OFF chiede uno User-Agent che identifichi l'app: dal browser non si può impostare, da qui sì.
import { additivo, calcolaIndice, haBio, VERSIONE_INDICE } from "./indice.js";
import { analizzaIngredienti, votoCosmetico } from "./cosmetici.js";

export const USER_AGENT = "DebitiEDoveri/1.0 (https://macroapp-b9bd0.web.app)";

// Campi chiesti a OFF. I `_tags_it` arrivano già tradotti (categorie, additivi, etichette).
const CAMPI = [
  "code", "product_type", "product_name", "product_name_it", "abbreviated_product_name", "product_name_en", "product_name_fr",
  "generic_name_it", "brands", "quantity", "nova_groups_markers",
  "categories_tags", "categories_tags_it", "nutriscore_grade", "nutriscore_score", "nova_group",
  "additives_tags", "labels_tags", "labels_tags_it", "ingredients_text_it", "ingredients_text", "ingredients_text_en", "ingredients_text_fr",
  "nutriments", "nutrient_levels", "image_front_small_url", "image_front_url", "completeness", "last_modified_t",
  "environmental_score_grade", "ecoscore_grade",
].join(",");

/**
 * Versione di normalizza(): sale quando la scheda guadagna campi (31/10: nome di ripiego, bevanda, frutta e verdura,
 * marcatori NOVA; 31/10 sera, v3: i cosmetici di Open Beauty Facts con la loro scheda). Una scheda in cache più
 * vecchia si rilegge da OFF alla prossima apertura (vedi index.js).
 */
export const VERSIONE_SCHEDA = 3;

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

// Ingredienti che per OFF fanno scattare un gruppo NOVA (`nova_groups_markers`), in italiano. Quelli non elencati
// restano col nome della tassonomia OFF (in inglese, senza trattini): la lista copre i più frequenti.
const MARCATORI_IT = {
  "en:flavouring": "aromi", "en:natural-flavouring": "aromi naturali", "en:artificial-flavouring": "aromi artificiali",
  "en:colour": "coloranti", "en:emulsifier": "emulsionanti", "en:sweetener": "edulcoranti", "en:thickener": "addensanti",
  "en:gelling-agent": "gelificanti", "en:stabiliser": "stabilizzanti", "en:glazing-agent": "agenti di rivestimento",
  "en:flavour-enhancer": "esaltatori di sapidità", "en:humectant": "umidificanti", "en:anti-caking-agent": "antiagglomeranti",
  "en:bulking-agent": "agenti di carica", "en:firming-agent": "agenti di resistenza", "en:sequestrant": "sequestranti",
  "en:carbonating-agent": "agenti carbonanti", "en:foaming-agent": "schiumogeni", "en:anti-foaming-agent": "antischiumogeni",
  "en:glucose": "glucosio", "en:glucose-syrup": "sciroppo di glucosio", "en:glucose-fructose-syrup": "sciroppo di glucosio e fruttosio",
  "en:fructose": "fruttosio", "en:fructose-syrup": "sciroppo di fruttosio", "en:invert-sugar": "zucchero invertito",
  "en:invert-sugar-syrup": "sciroppo di zucchero invertito", "en:dextrose": "destrosio", "en:maltodextrin": "maltodestrine",
  "en:lactose": "lattosio", "en:whey": "siero di latte", "en:whey-powder": "siero di latte in polvere", "en:whey-protein": "proteine del siero",
  "en:casein": "caseina", "en:caseinate": "caseinati", "en:milk-proteins": "proteine del latte", "en:soy-protein": "proteine di soia",
  "en:pea-protein": "proteine di pisello", "en:hydrolysed-protein": "proteine idrolizzate", "en:gluten": "glutine",
  "en:modified-starch": "amido modificato", "en:hydrogenated-oil": "olio idrogenato", "en:hydrogenated-fat": "grassi idrogenati",
  "en:interesterified-oil": "olio interesterificato", "en:yeast-extract": "estratto di lievito",
  "en:mechanically-separated-meat": "carne separata meccanicamente",
  "en:salt": "sale", "en:sugar": "zucchero", "en:vegetable-oil": "olio vegetale", "en:butter": "burro", "en:honey": "miele",
};

/** `nova_groups_markers` di OFF ({ "4": [["additives", "en:e440"], …] }) → nomi leggibili per il gruppo del prodotto. */
export function marcatoriNova(markers, gruppo) {
  const voci = Array.isArray(markers?.[String(gruppo)]) ? markers[String(gruppo)] : [];
  const nomi = voci.map((v) => {
    const [tipo, tag] = Array.isArray(v) ? v : [null, v];
    if (!tag) return null;
    if (tipo === "additives") { const a = additivo(tag); return a.nome && a.nome !== a.codice ? `${a.codice} ${a.nome}` : a.codice; }
    return MARCATORI_IT[tag] || pulisci(String(tag).replace(/^[a-z]{2}:/, "").replace(/-/g, " "));
  }).filter(Boolean);
  return [...new Set(nomi)].slice(0, 8);
}
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const pulisci = (s) => String(s || "").replace(/\s+/g, " ").trim();

// Campi comuni ad alimenti e cosmetici: nome (con i ripieghi), marca, categorie, etichette.
function comuni(p) {
  const categorie = (p.categories_tags_it || p.categories_tags || []).map((c) => cap(pulisci(String(c).replace(/^[a-z]{2}:/, "").replace(/-/g, " "))));
  const etichette = (p.labels_tags_it || p.labels_tags || []).map((c) => cap(pulisci(String(c).replace(/^[a-z]{2}:/, "").replace(/-/g, " "))));
  // Senza nome italiano né principale, prima il nome breve e la denominazione, poi inglese e francese.
  const nome = [p.product_name_it, p.product_name, p.abbreviated_product_name, p.generic_name_it, p.product_name_en, p.product_name_fr]
    .map(pulisci).find(Boolean) || null;
  return {
    trovato: true,
    nome,
    marca: pulisci(p.brands).split(",")[0] || null,
    quantita: pulisci(p.quantity) || null,
    descrizione: pulisci(p.generic_name_it) || null,
    // L'ultima categoria è la più specifica («Spaghetti»): è il tipo che va sulla tessera della lista.
    categoria: categorie.length ? categorie[categorie.length - 1] : null,
    categorie: categorie.slice(-3),
    immagine: p.image_front_small_url || p.image_front_url || null,
    etichette,
    bio: haBio(p.labels_tags || []),
    completezza: typeof p.completeness === "number" ? Math.round(p.completeness * 100) / 100 : null,
    aggiornatoOff: p.last_modified_t ? new Date(p.last_modified_t * 1000) : null,
    versioneScheda: VERSIONE_SCHEDA,
  };
}

/**
 * Cosmetico (Open Beauty Facts, `product_type` «beauty»): ingredienti INCI con livello e motivo, voto deciso
 * dall'ingrediente peggiore (cosmetici.js). Gli stessi campi vuoti degli alimenti, così le altre pagine non cambiano.
 */
export function normalizzaCosmetico(p) {
  const testo = pulisci(p.ingredients_text_it || p.ingredients_text || p.ingredients_text_en || p.ingredients_text_fr);
  const ingredienti = testo ? analizzaIngredienti(testo) : [];
  const ingredientiNoti = ingredienti.length > 0;
  const voto = votoCosmetico(ingredienti, ingredientiNoti);
  return {
    ...comuni(p),
    fonte: "obf",
    tipo: "beauty",
    ingredienti,
    ingredientiNoti,
    conteggi: voto.conteggi,
    additivi: [],
    nutriscore: { grado: null, punteggio: null },
    nova: null,
    novaMarcatori: [],
    bevanda: false,
    nutrienti: {},
    livelli: {},
    indice: voto.indice,
    fascia: voto.fascia,
    componenti: {},
    parziale: voto.parziale,
    mancano: voto.mancano,
    versioneIndice: VERSIONE_INDICE,
  };
}

/** Dal prodotto OFF ai dati che l'app mostra e salva. */
export function normalizza(p) {
  if (p.product_type === "beauty") return normalizzaCosmetico(p);
  const n = p.nutriments || {};
  const additivi = (p.additives_tags || []).map(additivo);
  const ingredientiNoti = Array.isArray(p.additives_tags) || !!pulisci(p.ingredients_text_it || p.ingredients_text);
  const categorie = (p.categories_tags_it || p.categories_tags || []).map((c) => cap(pulisci(String(c).replace(/^[a-z]{2}:/, "").replace(/-/g, " "))));
  const etichette = (p.labels_tags_it || p.labels_tags || []).map((c) => cap(pulisci(String(c).replace(/^[a-z]{2}:/, "").replace(/-/g, " "))));
  const nutriscore = { grado: p.nutriscore_grade || null, punteggio: typeof p.nutriscore_score === "number" ? p.nutriscore_score : null };
  const nova = [1, 2, 3, 4].includes(Number(p.nova_group)) ? Number(p.nova_group) : null;
  const valutazione = calcolaIndice({ nutriscore, nova, additivi, etichette: p.labels_tags || [], ingredientiNoti });
  // Senza nome italiano né principale, prima il nome breve e la denominazione, poi inglese e francese.
  const nome = [p.product_name_it, p.product_name, p.abbreviated_product_name, p.generic_name_it, p.product_name_en, p.product_name_fr]
    .map(pulisci).find(Boolean) || null;
  const frutta = [n["fruits-vegetables-legumes-estimate-from-ingredients_100g"], n["fruits-vegetables-nuts-estimate-from-ingredients_100g"], n["fruits-vegetables-nuts_100g"]]
    .find((x) => typeof x === "number" && isFinite(x));
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
    // Bevande: soglie dei valori per 100 ml (components/prodotto.js).
    bevanda: (p.categories_tags || []).includes("en:beverages"),
    nutrienti: {
      kcal: num(n["energy-kcal_100g"]), grassi: num(n.fat_100g), saturi: num(n["saturated-fat_100g"]),
      zuccheri: num(n.sugars_100g), sale: num(n.salt_100g), fibre: num(n.fiber_100g), proteine: num(n.proteins_100g),
      frutta: frutta == null ? null : Math.round(Math.min(100, Math.max(0, frutta))),
    },
    // Ingredienti che hanno deciso il gruppo NOVA (per spiegarlo nella scheda).
    novaMarcatori: nova ? marcatoriNova(p.nova_groups_markers, nova) : [],
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
    versioneScheda: VERSIONE_SCHEDA,
  };
}
