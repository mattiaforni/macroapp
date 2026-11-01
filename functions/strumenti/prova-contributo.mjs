// Prova senza rete del contributo a Open Food Facts (src/prodotti/contributo.js): lettura ripulita, campi mancanti,
// parametri delle scritture verso OFF/OBF con una rete finta.
//   node functions/strumenti/prova-contributo.mjs
import { fotoValide, pulisciLettura, mancanti, campiOff, inviaAOff, leggiEtichette, appUuid, APP, ContributoError } from "../src/prodotti/contributo.js";

let errori = 0;
function verifica(cond, msg) { if (!cond) { errori++; console.log("  ✗", msg); } else console.log("  ✓", msg); }
const FOTO = "A".repeat(400);

console.log("Foto");
const f = fotoValide([{ campo: "front", dati: FOTO, mime: "image/jpeg" }, { campo: "front", dati: FOTO, mime: "image/jpeg" },
  { campo: "nutrition", dati: FOTO, mime: "image/gif" }, { campo: "altro", dati: FOTO, mime: "image/jpeg" }, { campo: "ingredients", dati: FOTO, mime: "image/jpeg" }]);
verifica(f.map((x) => x.campo).join(",") === "front,ingredients", "una foto per campo, solo jpeg/png/webp, solo i tre campi");

console.log("Lettura");
const letti = pulisciLettura({ tipo: "food", nome: " Belle Buone sesamo e mais ", marca: "Galbusera", quantita: "200 g (5 x 40 g)", categoria: "Cracker",
  ingredienti: "Farina di frumento, semi di sesamo (12%), ...", linguaIngredienti: "IT",
  nutrizione: { per: "100g", kcal: "480", kj: "2012", grassi: "21,6", saturi: "2.6", carboidrati: "", zuccheri: "4 g", fibre: "5.4", proteine: "11.6", sale: "1.1" }, nota: "" });
verifica(letti.nome === "Belle Buone sesamo e mais" && letti.linguaIngredienti === "it" && letti.nota === null, "testi ripuliti, lingua in minuscolo, nota vuota → null");
verifica(letti.nutrizione.grassi === 21.6 && letti.nutrizione.zuccheri === 4 && letti.nutrizione.carboidrati === null, "numeri con virgola o unità, vuoti → null");
verifica(pulisciLettura({ nutrizione: { per: "nessuno", kcal: "480" } }).nutrizione === null, "valori per porzione → niente nutrizione");

console.log("Cosa manca");
verifica(mancanti(null).length === 6 && mancanti(null, "beauty").length === 5, "prodotto nuovo: manca tutto (senza nutrizione per i cosmetici)");
const parziale = { product_name: "", brands: "Galbusera Belle Buone", quantity: "5 x 40 g", categories_tags: ["en:crispbreads"], nutriments: { "energy-kcal_100g": 480 } };
verifica(mancanti(parziale).join(",") === "nome,ingredienti", "scheda del cracker: mancano nome e ingredienti");

console.log("Campi da scrivere");
const c1 = campiOff(letti, mancanti(parziale), "food", false);
verifica(c1.product_name_it === "Belle Buone sesamo e mais" && c1.ingredients_text_it && !c1.brands && !c1.nutrition_data_per && !c1.lang, "solo i campi mancanti, niente sovrascritture");
const c2 = campiOff(letti, mancanti(null), "food", true);
verifica(c2.lang === "it" && c2.brands === "Galbusera" && c2.add_categories === "it:Cracker" && c2.nutrition_data_per === "100g", "prodotto nuovo: lingua, marca, categoria, valori");
verifica(c2["nutriment_energy-kcal"] === "480" && c2["nutriment_energy-kcal_unit"] === "kcal" && c2.nutriment_salt === "1.1" && c2.nutriment_salt_unit === "g" && !("nutriment_carbohydrates" in c2), "nutrienti con unità, quelli vuoti saltati");
verifica(!campiOff(letti, mancanti(null, "beauty"), "beauty", true).nutrition_data_per, "cosmetico: niente valori nutrizionali");
verifica("ingredients_text_fr" in campiOff({ ingredienti: "Eau, glycérine", linguaIngredienti: "fr" }, ["ingredienti"]), "ingredienti nella lingua letta");

console.log("Scrittura (rete finta)");
const chiamate = [];
const rete = (risposte) => async (url, opz) => {
  chiamate.push({ url, opz });
  const r = risposte(url);
  return { ok: (r.http || 200) < 400, status: r.http || 200, text: async () => JSON.stringify(r.json) };
};
const account = { utente: "mattia", password: "segreta" };
const esito = await inviaAOff({ ean: "8002222222225", tipo: "food", foto: f, campi: c2, account, uuid: appUuid("uid1"),
  fetchFn: rete((url) => (url.endsWith("product_jqm2.pl") ? { json: { status: 1, status_verbose: "fields saved" } } : { json: { status: "status ok", imgid: 1 } })) });
const [prima, ...foto] = chiamate;
const corpo = new URLSearchParams(prima.opz.body);
verifica(prima.url === "https://world.openfoodfacts.org/cgi/product_jqm2.pl" && corpo.get("code") === "8002222222225", "prima i campi, su Open Food Facts");
verifica(corpo.get("user_id") === "mattia" && corpo.get("app_name") === APP.app_name && corpo.get("app_uuid") === appUuid("uid1") && corpo.get("comment"), "account, app_name, app_uuid, commento");
verifica(prima.opz.headers["User-Agent"].startsWith("DebitiEDoveri/"), "User-Agent dell'app");
verifica(foto.length === 2 && foto[0].url.endsWith("product_image_upload.pl") && foto[0].opz.body.get("imagefield") === "front_it" && foto[0].opz.body.get("imgupload_front_it"), "poi le foto, front_it con il file");
verifica(esito.avvisi.length === 0, "nessun avviso");
verifica(appUuid("uid1") === appUuid("uid1") && appUuid("uid1") !== appUuid("uid2") && !appUuid("uid1").includes("uid1"), "app_uuid stabile e non leggibile");

chiamate.length = 0;
await inviaAOff({ ean: "3600000000004", tipo: "beauty", foto: [], campi: {}, account, uuid: "x", fetchFn: rete(() => ({ json: { status: 1 } })) });
verifica(chiamate[0].url.startsWith("https://world.openbeautyfacts.org/"), "cosmetico: su Open Beauty Facts");

let errore = null;
try { await inviaAOff({ ean: "1", foto: [], campi: {}, account, uuid: "x", fetchFn: rete(() => ({ json: { status: 0, status_verbose: "user not signed-in" } })) }); } catch (e) { errore = e; }
verifica(errore instanceof ContributoError && errore.status === 401, "account sbagliato: errore di accesso");
errore = null;
try { await inviaAOff({ ean: "1", foto: [], campi: {}, account, uuid: "x", fetchFn: rete(() => ({ http: 500, json: {} })) }); } catch (e) { errore = e; }
verifica(errore instanceof ContributoError && errore.status === 500, "OFF in errore: si ferma prima delle foto");
const conAvviso = await inviaAOff({ ean: "1", foto: f, campi: {}, account, uuid: "x",
  fetchFn: rete((url) => (url.endsWith("product_jqm2.pl") ? { json: { status: 1 } } : { json: { status: "status not ok", error: "This picture has already been sent." } })) });
verifica(conAvviso.avvisi.length === 2 && /already/.test(conAvviso.avvisi[0]), "una foto rifiutata diventa un avviso");

console.log("Lettura con Claude (finto)");
let chiesto = null;
const out = await leggiEtichette({ foto: f, key: "k", chiedi: async (arg) => { chiesto = arg; return { tipo: "beauty", nome: "Crema", nutrizione: { per: "nessuno" } }; } });
verifica(chiesto.user.filter((b) => b.type === "image").length === 2 && chiesto.user[1].source.media_type === "image/jpeg" && chiesto.model === "sonnet", "due immagini col loro tipo, Sonnet");
verifica(out.tipo === "beauty" && out.nutrizione === null && out.marca === null, "risposta ripulita");

console.log(errori ? `\n${errori} controlli falliti` : "\nTutto a posto");
process.exit(errori ? 1 : 0);
