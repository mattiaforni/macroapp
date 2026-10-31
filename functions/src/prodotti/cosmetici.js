// Cosmetici (Open Beauty Facts, 31/10, scelta di Mattia): ingredienti INCI segnalati e voto 0–100.
// Metodo come Yuka (il voto lo decide l'ingrediente peggiore), ma con liste pubbliche europee, dichiarate qui:
//   alto      interferenti endocrini riconosciuti dall'UE (ECHA, sostanze estremamente preoccupanti per le
//             proprietà di interferenza endocrina: butylparaben 2020, 4-MBC 2022, poi vietato nei cosmetici dal
//             2025, reg. 2024/996), ingredienti vietati nei cosmetici (Lilial dal 2022, Lyral dal 2021),
//             benzophenone (classificato CMR);
//   moderato  lista di priorità della Commissione sui possibili interferenti endocrini nei cosmetici (2019),
//             gruppo A (sostanze già sotto valutazione per l'interferenza endocrina);
//   basso     stessa lista, gruppo B (priorità bassa), e allergeni delle fragranze da dichiarare in etichetta
//             (reg. UE 2023/1545: 24 storici più quelli aggiunti nel 2023).
// Le liste segnalano sostanze sospette o allergeniche, non il rischio alle dosi d'uso, che il regolamento (CE)
// 1223/2009 già limita: la scheda lo scrive. Il profumo («parfum»), che Yuka segnala come miscela non dichiarata,
// qui non conta: non è in nessuna delle liste.
// Voto: 100 − 30 per ingrediente alto, −15 per moderato, −4 per basso; al più 24 con un alto, 49 con un moderato.
// Nomi INCI verificati sulla tassonomia CosIng di Open Beauty Facts (taxonomies/beauty/ingredients-cosing-obf.txt).
// Funzioni pure: si provano con `node functions/strumenti/prova-prodotti.mjs`.
import { fasciaDi } from "./indice.js";

const MOTIVO = {
  edUe: "Interferente endocrino riconosciuto dall'UE",
  gruppoA: "Possibile interferente endocrino, priorità alta per la Commissione UE",
  gruppoB: "Possibile interferente endocrino, priorità bassa per la Commissione UE",
  allergene: "Allergene delle fragranze, da dichiarare in etichetta",
};

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const esatto = (...nomi) => new RegExp(`^(${nomi.map(esc).join("|")})$`);

// [regola, livello, motivo]; la regola si prova sul nome normalizzato (minuscolo, spazi singoli) dell'ingrediente.
export const SOSTANZE = [
  // alto
  [esatto("butylparaben", "butyl paraben", "butyl 4-hydroxybenzoate", "butyl p-hydroxybenzoate"), "alto", `${MOTIVO.edUe} (ECHA, 2020)`],
  [esatto("4-methylbenzylidene camphor", "enzacamene", "4-mbc", "3-4-methylbenzylidene camphor", "3-4'-methylbenzylidene-d-l camphor"), "alto", `${MOTIVO.edUe} (ECHA, 2022); vietato nei cosmetici dal 2025`],
  [esatto("butylphenyl methylpropional", "lilial", "bmhca"), "alto", "Vietato nei cosmetici dal 2022 (tossico per la riproduzione)"],
  [esatto("hydroxyisohexyl 3-cyclohexene carboxaldehyde", "lyral", "hicc"), "alto", "Vietato nei cosmetici dal 2021 (allergene)"],
  [esatto("benzophenone"), "alto", "Classificato CMR nell'UE; nella lista della Commissione sui possibili interferenti endocrini"],
  // moderato: gruppo A
  [esatto("benzophenone-3", "oxybenzone"), "moderato", MOTIVO.gruppoA],
  [esatto("propylparaben", "propyl paraben"), "moderato", MOTIVO.gruppoA],
  [esatto("resorcinol"), "moderato", MOTIVO.gruppoA],
  [esatto("octocrylene"), "moderato", MOTIVO.gruppoA],
  [esatto("homosalate"), "moderato", MOTIVO.gruppoA],
  [esatto("kojic acid"), "moderato", MOTIVO.gruppoA],
  [esatto("triclosan"), "moderato", MOTIVO.gruppoA],
  [esatto("triclocarban"), "moderato", MOTIVO.gruppoA],
  [esatto("bht", "butylated hydroxytoluene"), "moderato", MOTIVO.gruppoA],
  [esatto("benzyl salicylate"), "moderato", MOTIVO.gruppoA],
  [esatto("genistein"), "moderato", MOTIVO.gruppoA],
  [esatto("daidzein"), "moderato", MOTIVO.gruppoA],
  // basso: gruppo B
  [esatto("methylparaben", "methyl paraben"), "basso", MOTIVO.gruppoB],
  [esatto("ethylhexyl methoxycinnamate", "octinoxate", "octyl methoxycinnamate"), "basso", MOTIVO.gruppoB],
  [esatto("benzophenone-1", "benzophenone-2", "benzophenone-4", "sulisobenzone", "benzophenone-5"), "basso", MOTIVO.gruppoB],
  [esatto("bha", "butylated hydroxyanisole"), "basso", MOTIVO.gruppoB],
  [esatto("triphenyl phosphate"), "basso", MOTIVO.gruppoB],
  [esatto("salicylic acid"), "basso", MOTIVO.gruppoB],
  [esatto("cyclopentasiloxane", "d5", "cyclomethicone"), "basso", MOTIVO.gruppoB],
  [esatto("deltamethrin"), "basso", MOTIVO.gruppoB],
  // basso: allergeni delle fragranze (reg. UE 2023/1545), sostanze
  [esatto(
    "benzyl alcohol", "citral", "isoeugenol", "citronellol", "limonene", "d-limonene", "amyl cinnamal", "cinnamyl alcohol",
    "eugenol", "hydroxycitronellal", "amylcinnamyl alcohol", "benzyl salicylate", "cinnamal", "coumarin", "geraniol",
    "anise alcohol", "benzyl cinnamate", "farnesol", "linalool", "benzyl benzoate", "hexyl cinnamal", "methyl 2-octynoate",
    "alpha-isomethyl ionone", "6-methyl coumarin", "turpentine", "alpha-terpinene", "terpinolene", "3-propylidenephthalide",
    "methyl salicylate", "acetyl cedrene", "amyl salicylate", "anethole", "trans-anethole", "benzaldehyde", "camphor",
    "beta-caryophyllene", "caryophyllene", "carvone", "dimethyl phenethyl acetate", "hexadecanolactone",
    "hexamethylindanopyran", "linalyl acetate", "menthol", "trimethylcyclopentenyl methylisopentenol", "salicylaldehyde",
    "santalol", "sclareol", "terpineol", "alpha-terpineol", "tetramethyl acetyloctahydronaphthalenes",
    "trimethylbenzenepropanol", "vanillin", "eugenyl acetate", "geranyl acetate", "isoeugenyl acetate",
    "pinene", "alpha-pinene", "beta-pinene", "l-alpha-pinene", "l-beta-pinene", "beta-pinenes",
  ), "basso", MOTIVO.allergene],
  [/^(cis-)?rose ketone-\d/, "basso", MOTIVO.allergene],
  // basso: allergeni delle fragranze, oli ed estratti vegetali (non le acque floreali)
  [/^evernia (prunastri|furfuracea)\b/, "basso", MOTIVO.allergene],
  [/^(pinus (mugo|pumila)|cedrus atlantica|lippia citriodora|cananga odorata|jasminum|lavandula)\b.*\b(oil|extract|absolute)\b/, "basso", MOTIVO.allergene],
  [/^myroxylon pereirae\b/, "basso", MOTIVO.allergene],
  [/^ylang ylang\b/, "basso", MOTIVO.allergene],
  [/^cinnamomum (cassia leaf|zeylanicum bark) oil\b/, "basso", MOTIVO.allergene],
  [/^citrus aurantium( amara)? (flower|peel) oil\b/, "basso", MOTIVO.allergene],
  [/^citrus (aurantium bergamia|bergamia|limon) peel oil\b/, "basso", MOTIVO.allergene],
  [/^cymbopogon (citratus|flexuosus|schoenanthus)\b.*\boil\b/, "basso", MOTIVO.allergene],
  [/^(eucalyptus globulus|eugenia caryophyllus|juniperus virginiana|mentha piperita|mentha viridis|pelargonium graveolens|pogostemon cablin|santalum album)\b.*\boil\b/, "basso", MOTIVO.allergene],
  [/^laurus nobilis leaf oil\b/, "basso", MOTIVO.allergene],
  [/^narcissus\b.*\b(extract|absolute)\b/, "basso", MOTIVO.allergene],
  [/^rosa\b.*\bflower (oil|extract|absolute)\b/, "basso", MOTIVO.allergene],
];

const ORDINE = { alto: 3, moderato: 2, basso: 1 };

// Chiavi con cui provare le regole: senza ciò che sta tra parentesi («citrus limon (lemon) peel oil»), con le sole
// parentesi tolte («3-(4-methylbenzylidene) camphor»), e ogni parte di un nome con le barre («aqua/water»).
function chiavi(nome) {
  const base = String(nome || "").toLowerCase().replace(/[*°¹²³†‡§#]/g, "").replace(/\s+/g, " ").trim().replace(/\.$/, "");
  const senza = base.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  const piatte = base.replace(/[()[\]]/g, "").replace(/\s+/g, " ").trim();
  const parti = senza.split("/").map((p) => p.trim()).filter(Boolean);
  return [...new Set([senza, piatte, ...parti])];
}

/** Livello e motivi di un ingrediente: { livello: "alto" | "moderato" | "basso" | null, motivi: [] }. */
export function valutaIngrediente(nome) {
  const ch = chiavi(nome);
  let livello = null;
  const motivi = [];
  for (const [regola, liv, motivo] of SOSTANZE) {
    if (!ch.some((k) => regola.test(k))) continue;
    if (!motivi.includes(motivo)) motivi.push(motivo);
    if (!livello || ORDINE[liv] > ORDINE[livello]) livello = liv;
  }
  return { livello, motivi };
}

/** Testo della lista INCI → ingredienti [{ nome, livello, motivi }], nell'ordine dell'etichetta, senza doppioni. */
export function analizzaIngredienti(testo) {
  const pulito = String(testo || "")
    .replace(/^\s*(ingredients?|ingredienti|ingrédients|inci)\s*:/i, "")
    .replace(/\[\s*\+\/-|\+\/-|may contain\s*:?|peut contenir\s*:?|può contenere\s*:?/gi, ",")
    .replace(/\]/g, ",");
  // Virgole, punti e virgola, puntini; non la virgola tra due cifre («1,2-hexanediol»); un punto seguito da una nota
  // («. *ingredienti da agricoltura biologica»). Le note (che cominciano con *, °, ¹…) non sono ingredienti.
  const pezzi = pulito.split(/;|•|·|,(?!\d)|\.\s+(?=[*°¹²³†‡])/)
    .map((x) => x.replace(/\s+/g, " ").trim().replace(/^[-–.:\s]+|[.\s]+$/g, ""))
    .filter((x) => x && x.length <= 160 && !/^[*°¹²³†‡]/.test(x))
    .map((x) => x.replace(/\s*[*°¹²³†‡]+$/, ""));
  const visti = new Set();
  const out = [];
  for (const nome of pezzi) {
    const k = nome.toLowerCase();
    if (visti.has(k)) continue;
    visti.add(k);
    out.push({ nome, ...valutaIngrediente(nome) });
  }
  return out;
}

/** Voto di un cosmetico dagli ingredienti valutati. Senza ingredienti non c'è voto. */
export function votoCosmetico(ingredienti = [], ingredientiNoti = ingredienti.length > 0) {
  const conteggi = { alto: 0, moderato: 0, basso: 0 };
  for (const i of ingredienti) if (i.livello) conteggi[i.livello]++;
  if (!ingredientiNoti) return { indice: null, fascia: null, conteggi, parziale: false, mancano: ["ingredienti"] };
  let v = 100 - 30 * conteggi.alto - 15 * conteggi.moderato - 4 * conteggi.basso;
  if (conteggi.moderato) v = Math.min(v, 49);
  if (conteggi.alto) v = Math.min(v, 24);
  v = Math.max(0, Math.round(v));
  return { indice: v, fascia: fasciaDi(v), conteggi, parziale: false, mancano: [] };
}
