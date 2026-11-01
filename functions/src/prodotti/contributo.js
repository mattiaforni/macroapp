// Contributo a Open Food Facts / Open Beauty Facts (1/11, richiesta di Mattia: «zero fatica o quasi»).
// Dalla scheda di un prodotto mancante o incompleto: tre foto (fronte, ingredienti, valori nutrizionali), Claude le
// legge (`leggiEtichette`), l'utente guarda il riepilogo e tocca «Invia», e il server scrive su OFF/OBF solo i campi
// che lì mancano (`mancanti`, `campiOff`) e carica le foto (`inviaAOff`), con l'account OFF dell'utente.
// Regole di OFF per le app che scrivono (openfoodfacts.github.io/openfoodfacts-server/api): User-Agent dell'app,
// `app_name`, `app_version`, `app_uuid` (un identificativo dell'utente con sale, così i moderatori possono bloccare un
// solo utente), autenticazione con `user_id` (il nome utente, non l'email) e `password` nel corpo dei POST.
// Scritture: POST /cgi/product_jqm2.pl (campi) e /cgi/product_image_upload.pl (foto, `imagefield` front_it…).
// Funzioni pure tranne quelle che chiamano la rete (`fetchFn` si passa nelle prove).
import { createHash } from "node:crypto";
import { USER_AGENT, OffError } from "./off.js";

export const APP = { app_name: "DebitiEDoveri", app_version: "1.0" };
const COMMENTO = "Debiti e Doveri: dati letti dalle foto dell'etichetta e confermati dall'utente";
const HOST = { food: "https://world.openfoodfacts.org", beauty: "https://world.openbeautyfacts.org" };

/** Identificativo stabile e non personale dell'utente per OFF (sha256 dell'uid con un sale fisso). */
export function appUuid(uid) {
  return createHash("sha256").update(`debiti-e-doveri:${uid}`).digest("hex").slice(0, 32);
}

// ───────────── Foto ─────────────
const CAMPI_FOTO = ["front", "ingredients", "nutrition"];
const MAX_FOTO_BASE64 = 6_000_000; // ~4,5 MB per foto: l'app le manda a 2000 px, di solito sotto 1 MB

/** Foto dall'app: [{ campo: front|ingredients|nutrition, dati: base64, mime }] → solo quelle valide, una per campo. */
export function fotoValide(foto) {
  const visti = new Set();
  return (Array.isArray(foto) ? foto : []).filter((f) => {
    if (!f || !CAMPI_FOTO.includes(f.campo) || visti.has(f.campo)) return false;
    if (typeof f.dati !== "string" || f.dati.length < 100 || f.dati.length > MAX_FOTO_BASE64) return false;
    if (!/^image\/(jpeg|png|webp)$/.test(f.mime || "")) return false;
    visti.add(f.campo);
    return true;
  });
}

// ───────────── Lettura con Claude ─────────────
const NOMI_FOTO = { front: "fronte della confezione", ingredients: "lista degli ingredienti", nutrition: "tabella dei valori nutrizionali" };
// Solo tipi semplici, come lo schema dell'agente: stringa vuota per un dato che manca; i numeri li converte `pulisciLettura`.
const testo = { type: "string" };
export const SCHEMA_LETTURA = {
  type: "object",
  additionalProperties: false,
  required: ["tipo", "nome", "marca", "quantita", "categoria", "ingredienti", "linguaIngredienti", "nutrizione", "nota"],
  properties: {
    tipo: { type: "string", enum: ["food", "beauty", "altro"] },
    nome: testo, marca: testo, quantita: testo, categoria: testo, ingredienti: testo, linguaIngredienti: testo,
    nutrizione: {
      type: "object",
      additionalProperties: false,
      required: ["per", "kcal", "kj", "grassi", "saturi", "carboidrati", "zuccheri", "fibre", "proteine", "sale"],
      properties: {
        per: { type: "string", enum: ["100g", "100ml", "nessuno"] },
        kcal: testo, kj: testo, grassi: testo, saturi: testo, carboidrati: testo, zuccheri: testo, fibre: testo, proteine: testo, sale: testo,
      },
    },
    nota: testo,
  },
};

const aNumero = (x) => {
  const n = parseFloat(String(x ?? "").replace(",", ".").replace(/[^\d.]/g, ""));
  return isFinite(n) ? n : null;
};
const oNull = (x) => String(x ?? "").replace(/\s+/g, " ").trim() || null;

/** Risposta di Claude → { tipo, nome, marca, quantita, categoria, ingredienti, linguaIngredienti, nutrizione|null, nota }. */
export function pulisciLettura(out = {}) {
  const n = out.nutrizione || {};
  const valori = Object.fromEntries(["kcal", "kj", "grassi", "saturi", "carboidrati", "zuccheri", "fibre", "proteine", "sale"].map((k) => [k, aNumero(n[k])]));
  const conValori = ["100g", "100ml"].includes(n.per) && Object.values(valori).some((v) => v != null);
  return {
    tipo: ["food", "beauty", "altro"].includes(out.tipo) ? out.tipo : "food",
    nome: oNull(out.nome), marca: oNull(out.marca), quantita: oNull(out.quantita), categoria: oNull(out.categoria),
    ingredienti: String(out.ingredienti ?? "").trim() || null,
    linguaIngredienti: /^[a-z]{2}$/.test(String(out.linguaIngredienti || "").trim().toLowerCase()) ? String(out.linguaIngredienti).trim().toLowerCase() : null,
    nutrizione: conValori ? { per: n.per, ...valori } : null,
    nota: oNull(out.nota),
  };
}

export const ISTRUZIONI_LETTURA = `Leggi le foto dell'etichetta di un prodotto (alimento o cosmetico) e trascrivi i dati per Open Food Facts, una banca dati pubblica: quello che scrivi verrà pubblicato, quindi niente supposizioni.
- Trascrivi solo ciò che si legge nelle foto. Se un dato manca o non si legge con sicurezza, stringa vuota.
- nome: la denominazione di vendita come sulla confezione, senza la marca.
- marca: la marca commerciale. quantita: come stampata (es. «200 g (5 × 40 g)»).
- categoria: il tipo di prodotto in italiano, generico, come in una lista della spesa (es. «Cracker», «Confettura di fragole», «Crema per le mani»).
- tipo: food per alimenti e bevande, beauty per cosmetici e igiene personale, altro per il resto.
- ingredienti: il testo esatto della lista, senza il titolo «Ingredienti:», con percentuali e maiuscole come stampate; se ci sono più lingue, quella italiana. Per i cosmetici la lista INCI. linguaIngredienti: codice a due lettere della lingua trascritta (it, en, fr…).
- nutrizione: solo valori per 100 g o 100 ml (per indica quale). Se l'etichetta li dà solo per porzione o la tabella non c'è, per = «nessuno», valori vuoti, e dillo nella nota. Numeri con il punto decimale, in grammi, senza unità; energia in kcal e in kJ come stampate. Se c'è solo il sodio, sale = sodio × 2,5 e dillo nella nota.
- nota: una frase breve solo se c'è un dubbio (foto sfocata, valori per porzione, parte della lista coperta), altrimenti vuota.`;

/** Foto → dati letti (SCHEMA_LETTURA). `chiedi` è il provider (reason di ai/claude.js), passato per le prove. */
export async function leggiEtichette({ foto, key, chiedi }) {
  const contenuto = [];
  for (const f of foto) {
    contenuto.push({ type: "text", text: `Foto: ${NOMI_FOTO[f.campo]}` });
    contenuto.push({ type: "image", source: { type: "base64", media_type: f.mime, data: f.dati } });
  }
  contenuto.push({ type: "text", text: "Trascrivi i dati secondo le istruzioni." });
  return pulisciLettura(await chiedi({ system: ISTRUZIONI_LETTURA, user: contenuto, schema: SCHEMA_LETTURA, key, maxTokens: 6000, model: "sonnet" }));
}

// ───────────── Cosa manca su OFF ─────────────
const vuoto = (x) => !String(x ?? "").trim();

/** Campi che mancano sul prodotto OFF grezzo (null = prodotto che non c'è: manca tutto). */
export function mancanti(p, tipo = p?.product_type || "food") {
  const tutti = tipo === "beauty" ? ["nome", "marca", "quantita", "categoria", "ingredienti"] : ["nome", "marca", "quantita", "categoria", "ingredienti", "nutrizione"];
  if (!p) return tutti;
  const n = p.nutriments || {};
  const manca = {
    nome: vuoto(p.product_name_it) && vuoto(p.product_name),
    marca: vuoto(p.brands),
    quantita: vuoto(p.quantity),
    categoria: !(p.categories_tags || []).length,
    ingredienti: vuoto(p.ingredients_text_it) && vuoto(p.ingredients_text),
    nutrizione: n["energy-kcal_100g"] == null && n.energy_100g == null,
  };
  return tutti.filter((k) => manca[k]);
}

// Nutrienti: chiave nostra → [chiave OFF, unità].
const NUTRIENTI = [["kcal", "energy-kcal", "kcal"], ["kj", "energy-kj", "kJ"], ["grassi", "fat", "g"], ["saturi", "saturated-fat", "g"],
  ["carboidrati", "carbohydrates", "g"], ["zuccheri", "sugars", "g"], ["fibre", "fiber", "g"], ["proteine", "proteins", "g"], ["sale", "salt", "g"]];
const numeroValido = (x) => typeof x === "number" && isFinite(x) && x >= 0 && x < 10000;

/**
 * Dai dati confermati dall'utente ai parametri di product_jqm2.pl, solo per i campi che su OFF mancano: niente
 * sovrascritture di dati già presenti. `nuovo` = il prodotto non c'è ancora (si dichiara la lingua principale).
 */
export function campiOff(letti = {}, manca = [], tipo = "food", nuovo = false) {
  const f = {};
  const pulito = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  if (nuovo) f.lang = "it";
  if (manca.includes("nome") && pulito(letti.nome)) f.product_name_it = pulito(letti.nome);
  if (manca.includes("marca") && pulito(letti.marca)) f.brands = pulito(letti.marca);
  if (manca.includes("quantita") && pulito(letti.quantita)) f.quantity = pulito(letti.quantita);
  if (manca.includes("categoria") && pulito(letti.categoria)) f.add_categories = `it:${pulito(letti.categoria)}`;
  if (manca.includes("ingredienti") && pulito(letti.ingredienti)) {
    const lingua = /^[a-z]{2}$/.test(letti.linguaIngredienti || "") ? letti.linguaIngredienti : "it";
    f[`ingredients_text_${lingua}`] = String(letti.ingredienti).trim();
  }
  const nutr = letti.nutrizione;
  if (tipo !== "beauty" && manca.includes("nutrizione") && nutr && NUTRIENTI.some(([k]) => numeroValido(nutr[k]))) {
    // OFF tiene i valori per 100 ml delle bevande come «100g».
    f.nutrition_data_per = "100g";
    for (const [k, chiave, unita] of NUTRIENTI) {
      if (!numeroValido(nutr[k])) continue;
      f[`nutriment_${chiave}`] = String(nutr[k]);
      f[`nutriment_${chiave}_unit`] = unita;
    }
  }
  return f;
}

// ───────────── Scrittura ─────────────
export class ContributoError extends OffError {}

async function leggiJson(r) {
  const testo = await r.text();
  try { return JSON.parse(testo); } catch { return { testo: testo.slice(0, 200) }; }
}

/**
 * Scrive su OFF/OBF: prima i campi (anche solo il codice, che crea il prodotto), poi le foto. Un errore sui campi
 * ferma tutto (es. account sbagliato); un errore su una foto diventa un avviso, perché i campi ormai sono salvati.
 * Ritorna { avvisi: [] }.
 */
export async function inviaAOff({ ean, tipo = "food", foto = [], campi = {}, account, uuid, fetchFn = fetch }) {
  const host = HOST[tipo === "beauty" ? "beauty" : "food"];
  const base = { user_id: account.utente, password: account.password, ...APP, app_uuid: uuid, comment: COMMENTO };
  const r = await fetchFn(`${host}/cgi/product_jqm2.pl`, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ code: ean, ...base, ...campi }),
  });
  const esito = await leggiJson(r);
  const accessoNegato = r.status === 401 || r.status === 403 || (esito.status !== 1 && /sign|login|password|connect|auth/i.test(String(esito.status_verbose || "")));
  if (accessoNegato) {
    throw new ContributoError("Open Food Facts non accetta nome utente e password", 401);
  }
  if (!r.ok || esito.status !== 1) throw new ContributoError(`Open Food Facts non ha salvato la scheda (${esito.status_verbose || esito.testo || r.status})`, r.status || 502);

  const avvisi = [];
  for (const f of foto) {
    const campo = `${f.campo}_it`;
    const fd = new FormData();
    fd.set("code", ean);
    for (const [k, v] of Object.entries(base)) fd.set(k, v);
    fd.set("imagefield", campo);
    fd.set(`imgupload_${campo}`, new Blob([Buffer.from(f.dati, "base64")], { type: f.mime }), `${campo}.jpg`);
    try {
      const rf = await fetchFn(`${host}/cgi/product_image_upload.pl`, { method: "POST", headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, body: fd });
      const ef = await leggiJson(rf);
      if (!rf.ok || ef.status !== "status ok") avvisi.push(`foto ${f.campo}: ${ef.error || ef.status_verbose || ef.testo || rf.status}`);
    } catch (err) {
      avvisi.push(`foto ${f.campo}: ${String(err.message).slice(0, 80)}`);
    }
  }
  return { avvisi };
}
