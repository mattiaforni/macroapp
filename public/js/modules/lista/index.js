// Lista della spesa condivisa, sul modello di Bring.
// Tessere rossine = da comprare; toccandole diventano verdoline e scendono in "Usati di recente".
// Niente si cancella quando lo compri: lo storico serve a rimettere in lista con un tocco
// e a suggerire mentre scrivi.
//
// Collezione: shopping_items { text, detail, done, addedAt, boughtAt, count }
//   done = true  → comprato (sta tra i recenti)
//   done = false → da comprare
import { el, icon, iconaDa, toast, fascia, vuoto, toDate } from "../../core/ui.js";
import { create, update, remove, watchVisible, VIS } from "../../core/db.js";
import { session } from "../../core/auth.js";
import { openSheet, campo } from "../../components/sheet.js";

export const id = "lista";
export const title = "Lista";
export const nav = true;
export const icon_ = "lista";
export { icon_ as icon };

const COLL = "shopping_items";
const RECENTI_VISIBILI = 18;
const CHIAVE_APERTI = "macroapp.lista.recentiAperti";

// L'ordine conta: la prima regola che corrisponde vince.
const ICONE = [
  [/pesce|tonno|salmone|merluzz|acciugh|alici|gamber|calamar|cozz|vongol|baccal/, "pesce"],
  [/carne|pollo|manzo|maiale|salsicc|prosciutt|salame|bresaola|tacchino|hamburger|w[uü]rstel|speck|pancetta|macinat|cotolett/, "carne"],
  [/formagg|parmigian|grana|mozzarell|ricott|pecorin|stracchin|gorgonzol|burrata|scamorz/, "formaggio"],
  [/\buov[ao]/, "uovo"],
  [/gelat|biscott|cioccolat|dolc|torta|merend|nutella|marmellat|miele|zucchero/, "gelato"],
  [/caff[eè]|\bt[eè]\b|tisan|camomill/, "tazza"],
  [/\bvino|prosecco|spumante/, "vino"],
  [/latte|acqua|succo|bibit|coca|aranciata|birra|olio|aceto|panna|yogurt/, "bottiglia"],
  [/\bpane|panin|focacc|pizza|cracker|grissin|fette biscott|brioche|cornett|piadin/, "pane"],
  [/pasta|riso|farina|spaghett|penne|fusill|cous|orzo|farro|cereal|lievito|pangrattato/, "spiga"],
  [/verdur|insalat|zucchin|carot|pomodor|patat|cipoll|aglio|melanzan|peperon|spinac|broccol|cavol|finocch|sedano|lattuga|rucola|funghi|legum|ceci|fagiol|lenticch|piselli|zucca/, "carota"],
  [/frutt|\bmel[ae]\b|\bper[ae]\b|banan|aranc|limon|kiwi|\buva\b|fragol|\bpesc[ah]e?\b|albicocc|mandarin|ananas|noci|nocciol|mandorl|castagn/, "mela"],
  [/surgelat|ghiaccio/, "fiocco"],
  [/detersiv|sgrassat|candeggin|spugn|sacchett|carta igienica|carta cucina|scottex|ammorbident|piatti|anticalcare/, "spray"],
  [/sapone|shampoo|bagnoschiuma|dentifric|deodorant|crema|assorbent|igien|rasoi/, "goccia"],
  [/basilico|prezzemol|rosmarin|salvia|origano|piant|terriccio|concime|\bsemi\b/, "foglia"],
  [/lampadin|\bpil[ae]\b|batteri/, "lampadina"],
];

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const quando = (it, campo) => toDate(it[campo])?.getTime() || toDate(it.createdAt)?.getTime() || Date.now();

/** "pesce: spada" o "pesce (spada)" → { text: "Pesce", detail: "spada" } */
function parseVoce(raw) {
  let text = raw.trim(), detail = "";
  const m = text.match(/^(.*?)\s*(?::\s*|\((.*)\)\s*$)(.*)$/);
  if (m && (m[2] || m[3])) { text = m[1]; detail = (m[2] || m[3]).trim(); }
  return { text: cap(text.trim()), detail };
}

/** Aggiunge una o più voci ("latte, uova; pane"). Usata anche dal diario. */
export function aggiungiVoci(raw, items = []) {
  const parti = String(raw).split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  let nuove = 0;
  for (const p of parti) {
    const { text, detail } = parseVoce(p);
    const esistente = items.find((i) => norm(i.text) === norm(text));
    if (esistente) {
      update(COLL, esistente.id, { done: false, addedAt: new Date(), ...(detail ? { detail } : {}) });
    } else {
      create(COLL, { text, detail, done: false, addedAt: new Date(), count: 0 }, VIS.SHARED);
    }
    nuove++;
  }
  return nuove;
}

function tessera(it, { verde, onTap, onAltro }) {
  const nomeIcona = iconaDa(`${it.text} ${it.detail || ""}`, ICONE, null);
  return el("div.tessera", { class: verde ? "tessera--verde" : "", role: "button", tabindex: "0", onclick: onTap,
      onkeydown: (e) => { if (e.key === "Enter") onTap(); } },
    nomeIcona ? icon(nomeIcona) : el("span.iniziale", {}, (it.text || "?").charAt(0).toUpperCase()),
    el("b", {}, it.text),
    it.detail ? el("small", {}, it.detail) : null,
    el("button.altro", { type: "button", "aria-label": "Modifica", onclick: (e) => { e.stopPropagation(); onAltro(); } }, icon("punti")),
  );
}

function apriModifica(it) {
  const nome = el("input", { value: it.text, autofocus: true, enterkeyhint: "next" });
  const dett = el("input", { value: it.detail || "", placeholder: "es. surgelate, 1 kg, della marca…", enterkeyhint: "done" });
  nome.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); dett.focus(); } });
  dett.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sheet.confirm(); } });
  const sheet = openSheet({
    title: "Modifica",
    body: [
      campo("Nome", nome),
      campo("Dettaglio", dett),
      el("div.foglio__piede", {},
        el("button.btn.btn--pericolo", { onclick: () => { remove(COLL, it.id); sheet.close(); toast(`${it.text} eliminato`); } },
          icon("cestino"), "Elimina"),
      ),
    ],
    onConfirm: () => {
      if (!nome.value.trim()) return false;
      update(COLL, it.id, { text: cap(nome.value.trim()), detail: dett.value.trim() });
    },
  });
}

export function mount(container) {
  let items = [];
  let recentiAperti = true;
  let mostraTutti = false;
  try { recentiAperti = localStorage.getItem(CHIAVE_APERTI) !== "0"; } catch (e) {}

  const daComprare = el("div");
  const recenti = el("div");
  const input = el("input", { placeholder: "Mi serve…", enterkeyhint: "done", autocomplete: "off", "aria-label": "Aggiungi alla lista" });
  const sugg = el("div.suggerimenti");
  const barra = el("div.mi-serve", {},
    sugg,
    el("div.mi-serve__riga", {},
      input,
      el("button.tondo", { type: "button", "aria-label": "Aggiungi", onclick: aggiungi }, icon("piu")),
    ),
  );

  function aggiungi() {
    if (!input.value.trim()) return;
    aggiungiVoci(input.value, items);
    input.value = "";
    disegnaSuggerimenti();
  }

  function compra(it) {
    update(COLL, it.id, { done: true, boughtAt: new Date(), doneBy: session.user.uid, count: (it.count || 0) + 1 });
    toast(`${it.text} preso`, { azione: { label: "Annulla", fn: () => update(COLL, it.id, { done: false }) } });
  }

  function rimetti(it) {
    update(COLL, it.id, { done: false, addedAt: new Date() });
  }

  function disegnaSuggerimenti() {
    const q = norm(input.value);
    if (!q) { sugg.replaceChildren(); return; }
    const presenti = new Set(items.filter((i) => !i.done).map((i) => norm(i.text)));
    const match = items
      .filter((i) => i.done && !presenti.has(norm(i.text)) && norm(i.text).includes(q))
      .sort((a, b) => (norm(b.text).startsWith(q) - norm(a.text).startsWith(q)) || ((b.count || 0) - (a.count || 0)))
      .slice(0, 8);
    sugg.replaceChildren(...match.map((i) => el("button.pillola", {
      type: "button",
      onclick: () => { rimetti(i); input.value = ""; disegnaSuggerimenti(); input.focus(); },
    }, icon("piu"), i.text)));
  }

  function render() {
    const da = items.filter((i) => !i.done).sort((a, b) => quando(a, "addedAt") - quando(b, "addedAt"));
    const fatti = items.filter((i) => i.done).sort((a, b) => quando(b, "boughtAt") - quando(a, "boughtAt"));

    daComprare.replaceChildren(
      da.length
        ? el("div.tessere", { style: "margin-top:14px" }, ...da.map((it) => tessera(it, { onTap: () => compra(it), onAltro: () => apriModifica(it) })))
        : vuoto("Niente da comprare", "Scrivi in basso cosa ti serve, oppure tocca una voce tra quelle usate di recente."),
    );

    if (!fatti.length) { recenti.replaceChildren(); return; }
    const visibili = mostraTutti ? fatti : fatti.slice(0, RECENTI_VISIBILI);
    recenti.replaceChildren(...[
      fascia("Usati di recente", el("button", {
        onclick: () => {
          recentiAperti = !recentiAperti;
          try { localStorage.setItem(CHIAVE_APERTI, recentiAperti ? "1" : "0"); } catch (e) {}
          render();
        },
      }, recentiAperti ? "Nascondi" : `Mostra (${fatti.length})`)),
      recentiAperti ? el("div.tessere", {}, ...visibili.map((it) => tessera(it, { verde: true, onTap: () => rimetti(it), onAltro: () => apriModifica(it) }))) : null,
      recentiAperti && fatti.length > RECENTI_VISIBILI
        ? el("p", { style: "text-align:center;margin-top:10px" },
            el("button.btn.btn--piatto", { onclick: () => { mostraTutti = !mostraTutti; render(); } }, mostraTutti ? "Mostra meno" : `Tutti i ${fatti.length}`))
        : null,
    ].filter(Boolean));
    disegnaSuggerimenti();
  }

  input.addEventListener("input", disegnaSuggerimenti);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); aggiungi(); } });

  container.append(daComprare, recenti, barra);
  const stop = watchVisible(COLL, { order: ["createdAt", "asc"] }, (docs) => { items = docs; render(); });
  return () => { stop(); barra.remove(); };
}
