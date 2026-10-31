// Prova senza rete dell'indice dei prodotti: schede nel formato dell'API v2 di Open Food Facts
// (costruite a mano, non scaricate) → normalizza() → indice, fascia, componenti.
//   node functions/strumenti/prova-prodotti.mjs
import { normalizza, normalizzaEan, marcatoriNova, VERSIONE_SCHEDA } from "../src/prodotti/off.js";
import { calcolaIndice, additivo, punteggioAdditivi, fasciaDi, ricalcola, VERSIONE_INDICE } from "../src/prodotti/indice.js";

let errori = 0;
function verifica(cond, msg) { if (!cond) { errori++; console.log("  ✗", msg); } else console.log("  ✓", msg); }

const SCHEDE = {
  spaghetti: {
    code: "8076809513753", product_name: "Spaghetti n.5", brands: "Barilla", quantity: "500 g",
    categories_tags: ["en:plant-based-foods-and-beverages", "en:cereals-and-potatoes", "en:pastas", "en:spaghetti"],
    categories_tags_it: ["Alimenti e bevande a base vegetale", "Cereali e patate", "Paste alimentari", "Spaghetti"],
    nutriscore_grade: "a", nutriscore_score: -3, nova_group: 1, additives_tags: [], labels_tags: [],
    ingredients_text_it: "Semola di grano duro, acqua", completeness: 0.9, last_modified_t: 1760000000,
    nutriments: { "energy-kcal_100g": 359, fat_100g: 2, "saturated-fat_100g": 0.5, sugars_100g: 3.5, salt_100g: 0.013, fiber_100g: 3, proteins_100g: 12.5 },
    nutrient_levels: { fat: "low", "saturated-fat": "low", sugars: "low", salt: "low" },
  },
  wurstel: {
    code: "8001234567890", product_name: "Würstel di pollo", brands: "Marca, Gruppo", quantity: "250 g",
    categories_tags_it: ["Carni", "Salumi", "Würstel"],
    nutriscore_grade: "d", nova_group: 4, additives_tags: ["en:e250", "en:e301", "en:e450", "en:e621", "en:e407", "en:e120"],
    labels_tags: [], ingredients_text_it: "carne di pollo, acqua, sale, …", completeness: 0.8,
    nutriments: { "energy-kcal_100g": 260, fat_100g: 22, "saturated-fat_100g": 8, sugars_100g: 1, salt_100g: 2.1 },
  },
  yogurtBio: {
    code: "8002345678901", product_name_it: "Yogurt intero bianco", brands: "Bio Marca", quantity: "125 g",
    categories_tags_it: ["Latticini", "Yogurt", "Yogurt interi"],
    nutriscore_grade: "b", nova_group: 1, additives_tags: [], labels_tags: ["en:organic", "en:eu-organic"], labels_tags_it: ["Biologico", "Bio europeo"],
    ingredients_text_it: "latte intero biologico, fermenti lattici", completeness: 0.95, nutriments: { "energy-kcal_100g": 70 },
  },
  senzaIngredienti: {
    code: "8003456789012", product_name: "Crackers", brands: "Marca", categories_tags_it: ["Snack salati", "Crackers"],
    nutriscore_grade: "c", completeness: 0.3, nutriments: {},
  },
  acqua: {
    code: "8004567890123", product_name: "Acqua naturale", brands: "Fonte", categories_tags_it: ["Bevande", "Acque"],
    nutriscore_grade: "not-applicable", nova_group: 1, additives_tags: [], labels_tags: [], ingredients_text_it: "acqua", completeness: 0.7,
  },
  vuota: { code: "8005678901234", product_name: "Cosa misteriosa", completeness: 0.1 },
  cola: {
    code: "5449000000996", product_name: "Cola", brands: "Marca", categories_tags_it: ["Bevande", "Bevande gassate"],
    nutriscore_grade: "e", nova_group: 4, additives_tags: ["en:e150d", "en:e338"], labels_tags: [], ingredients_text_it: "acqua, zucchero, …",
    nutriments: { sugars_100g: 10.6 },
  },
};

console.log("Codici");
verifica(normalizzaEan(" 8076809513753 ") === "8076809513753", "EAN-13 accettato");
verifica(normalizzaEan("12345678") === "12345678", "EAN-8 accettato");
verifica(normalizzaEan("abc") === null && normalizzaEan("1234") === null, "codici non validi rifiutati");

console.log("Additivi");
verifica(additivo("en:e250").nome === "Nitrito di sodio" && additivo("en:e250").rischio === "alto", "E250 nitrito di sodio, rischio alto");
verifica(additivo("en:e330").rischio === null && additivo("en:e330").classe === "antiossidante", "E330 acido citrico, non valutato");
verifica(additivo("en:e9999").nome === "E9999", "additivo sconosciuto → solo il codice");
verifica(punteggioAdditivi([]) === 100 && punteggioAdditivi([additivo("en:e330")]) === 95, "0 → 100, 1 senza giudizio EFSA → 95");
verifica(punteggioAdditivi([additivo("en:e150c")]) === 50, "uno a rischio moderato → tetto 50");
verifica(punteggioAdditivi([additivo("en:e250")]) === 20, "uno a rischio alto → tetto 20");
verifica(punteggioAdditivi(["e330", "e322", "e471", "e500", "e440"].map((c) => additivo("en:" + c))) >= 80, "cinque senza rischio → al più −20");
verifica(punteggioAdditivi([{ codice: "EX", rischio: "nessuno" }]) === 100, "rivalutato dall'EFSA senza rischio → nessuna penalità");

console.log("Indice");
const s = Object.fromEntries(Object.entries(SCHEDE).map(([k, v]) => [k, normalizza(v)]));
for (const [k, v] of Object.entries(s)) console.log(`  ${k.padEnd(16)} ${String(v.indice).padStart(4)}  ${v.fascia || "—"}  ${v.parziale ? "parziale (" + v.mancano.join(", ") + ")" : ""}  ${v.categoria || ""}`);
verifica(s.spaghetti.indice === 90 && s.spaghetti.fascia === "eccellente", "spaghetti: A, NOVA 1, niente additivi, non bio → 90 eccellente");
verifica(s.spaghetti.categoria === "Spaghetti" && s.spaghetti.marca === "Barilla", "categoria più specifica e prima marca");
verifica(s.spaghetti.nutrienti.kcal === 359 && s.spaghetti.nutrienti.sale === 0, "nutrienti per 100 g (sale arrotondato a 0)");
verifica(s.wurstel.indice === 24 && s.wurstel.fascia === "scarso", "würstel: D (30), NOVA 4 (25), additivi a rischio alto (20) → 24 scarso");
verifica(s.wurstel.additivi.length === 6 && s.wurstel.additivi.filter((a) => a.rischio === "alto").length === 4, "quattro additivi a rischio alto riconosciuti");
verifica(s.yogurtBio.bio && s.yogurtBio.indice === 90, "yogurt bio: B, NOVA 1, bio → 90");
verifica(s.senzaIngredienti.parziale && ["additivi", "nova", "bio"].every((k) => s.senzaIngredienti.mancano.includes(k)), "senza ingredienti: indice parziale (mancano additivi, NOVA e bio)");
verifica(s.senzaIngredienti.indice === 55, "parziale = media pesata delle sole componenti note (qui il solo Nutri-Score)");
verifica(s.acqua.indice === Math.round((100 * 25 + 100 * 15 + 0 * 10) / 50) && s.acqua.componenti.nutrizione.stato === "non-applicabile", "acqua: Nutri-Score non applicabile, indice sulle altre");
verifica(s.vuota.indice === null && s.vuota.fascia === null, "scheda vuota: nessun indice");
verifica(s.cola.indice < 25 && s.cola.fascia === "scarso", "cola: E, NOVA 4, fosfati a rischio alto → scarso");
verifica(fasciaDi(75) === "eccellente" && fasciaDi(74) === "buono" && fasciaDi(50) === "buono" && fasciaDi(49) === "mediocre" && fasciaDi(24) === "scarso", "fasce ai confini");
verifica(calcolaIndice({ nutriscore: { grado: "a" }, nova: 1, additivi: [additivo("en:e250")], etichette: [], ingredientiNoti: true }).indice === 49, "anche un prodotto A con nitriti non supera 49");
verifica(calcolaIndice({ nutriscore: { grado: "c" }, etichette: ["en:organic"] }).componenti.bio.valore === 100, "etichetta bio conta anche senza ingredienti");

// I cinque prodotti del 29/10 (dati delle schede OFF viste da Mattia; Yuka 57, 54, 78, 73, 84).
console.log("Confronto del 29/10");
const veri = [
  ["Belle Buone cracker", { nutriscore: { grado: "c" }, nova: 3, additivi: [additivo("en:e392")], bio: false, ingredientiNoti: true }, 63],
  ["Pizza margherita", { nutriscore: { grado: "d" }, nova: 4, additivi: [additivo("en:e330")], bio: false, ingredientiNoti: true }, 43],
  ["Wasa sesamo", { nutriscore: { grado: "b" }, nova: 3, additivi: [], bio: true, ingredientiNoti: true }, 86],
  ["Natù fragole", { nutriscore: { grado: "a" }, nova: 4, additivi: [additivo("en:e440")], bio: true, ingredientiNoti: true }, 88],
  ["Crema 100% nocciole", { nutriscore: { grado: "d" }, nova: null, additivi: [], bio: false, ingredientiNoti: false }, 30],
];
for (const [nome, dati, atteso] of veri) verifica(calcolaIndice(dati).indice === atteso, `${nome} → ${atteso}`);

console.log("Ricalcolo della cache");
const vecchia = { trovato: true, nutriscore: { grado: "d" }, nova: 4, additivi: [{ codice: "E330", nome: "Acido citrico", classe: "antiossidante", rischio: null }], bio: false, ingredientiNoti: true, indice: 35, fascia: "mediocre" };
const nuova = ricalcola(vecchia);
verifica(nuova?.indice === 43 && nuova.fascia === "mediocre" && nuova.versioneIndice === VERSIONE_INDICE, "scheda del modello 1 (pizza, 35) → 43");
verifica(ricalcola({ ...vecchia, ...nuova }) === null, "una scheda già ricalcolata non si ricalcola");
verifica(ricalcola({ trovato: false }) === null, "prodotto non trovato: niente da ricalcolare");
verifica(s.spaghetti.versioneIndice === VERSIONE_INDICE, "le schede nuove portano la versione del modello");

console.log("Scheda, versione 2 (31/10)");
const senzaNome = normalizza({ code: "8002222222225", brands: "Galbusera Belle Buone", quantity: "5 x 40 g", categories_tags_it: ["Crispbreads"], nutriscore_grade: "d", nutriscore_score: 11, nutriments: { "energy-kcal_100g": 480, salt_100g: 1.1 } });
verifica(senzaNome.nome === null && senzaNome.marca === "Galbusera Belle Buone", "senza nome: nome nullo, la marca resta (l'app la usa come titolo)");
verifica(normalizza({ product_name_en: "Sesame crackers" }).nome === "Sesame crackers", "nome inglese come ripiego");
verifica(normalizza({ product_name: "", abbreviated_product_name: "Cracker sesamo" }).nome === "Cracker sesamo", "nome breve come ripiego");
verifica(normalizza(SCHEDE.cola).bevanda === false && normalizza({ ...SCHEDE.cola, categories_tags: ["en:beverages", "en:sodas"] }).bevanda === true, "bevanda dalle categorie OFF");
verifica(normalizza({ nutriments: { "fruits-vegetables-legumes-estimate-from-ingredients_100g": 95.4 } }).nutrienti.frutta === 95, "frutta e verdura stimata dagli ingredienti");
verifica(normalizza({}).nutrienti.frutta === null, "frutta e verdura assente → null");
const markers = { "3": [["ingredients", "en:salt"]], "4": [["additives", "en:e440"], ["ingredients", "en:flavouring"], ["ingredients", "en:some-new-marker"]] };
verifica(JSON.stringify(marcatoriNova(markers, 4)) === JSON.stringify(["E440 Pectina", "aromi", "some new marker"]), "marcatori NOVA 4: additivo col nome, ingrediente tradotto, sconosciuto ripulito");
verifica(marcatoriNova(markers, 3)[0] === "sale" && marcatoriNova(undefined, 4).length === 0, "marcatori del gruppo 3, e nessuno senza dati");
verifica(normalizza({ nova_group: 4, nova_groups_markers: markers }).novaMarcatori.includes("aromi"), "la scheda porta i marcatori del suo gruppo");
verifica(s.spaghetti.versioneScheda === VERSIONE_SCHEDA && VERSIONE_SCHEDA >= 2, "le schede nuove portano la versione della scheda");

console.log(errori ? `\n${errori} controlli falliti` : "\nTutto a posto");
process.exit(errori ? 1 : 0);
