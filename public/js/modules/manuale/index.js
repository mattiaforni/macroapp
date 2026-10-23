// Manuale di casa e rubrica: negozi e fornitori utili, persone (anche quelle dei task),
// informazioni di casa (codici, tecnici, istruzioni). Un solo posto per i contatti.
//
// manual_entries { type: "shop" | "person" | "info", name, category, address, phone, email, url, notes, googleId }
// Le categorie sono della casa: households/{id}.manualCategories (nomi). Se mancano valgono
// quelle predefinite; la categoria di una voce è facoltativa.
import { el, icon, toast, fascia, vuoto, sceltaVisibilita, iconaDa, fab } from "../../core/ui.js";
import { create, update, remove, watchVisible, readVisible, VIS } from "../../core/db.js";
import { getHousehold, updateHousehold } from "../../core/household.js";
import { checkRedirectResult } from "../../core/auth.js";
import { permessoContatti, leggiContatti, ritornoDaGoogle } from "../../core/contatti-google.js";
import { openSheet, campo } from "../../components/sheet.js";
import { rigaTask } from "../task/index.js";

export const id = "manuale";
export const title = "Manuale";
export const nav = true;
const navIcon = "manuale";
export { navIcon as icon };

const COLL = "manual_entries";
const CHIAVE_SEGMENTO = "macroapp.manuale.segmento";
const PREDEFINITE = ["Idraulica", "Elettricità", "Vernici e ferramenta", "Agraria e giardino", "Edilizia", "Auto", "Casa", "Salute"];
// Icona di una categoria dal nome, così funziona anche per quelle aggiunte a mano.
const ICONE_CAT = [
  [/idraul|acqua|caldai|termo/, "goccia"], [/elettr|luce|lampad/, "lampadina"],
  [/agrar|giardin|vivai|verde|piant|orto/, "foglia"], [/edil|muratur|casa|tetto/, "casa"],
  [/auto|macchin|gomm|meccan|carrozz/, "macchina"], [/salute|medic|farmac|dottor|dentist|veterin/, "salute"],
];
const iconaCategoria = (c) => iconaDa(c, ICONE_CAT, "negozio");
const TIPI = [["shop", "Negozio"], ["person", "Persona"], ["info", "Informazione"]];
const norm = (s) => String(s || "").trim().toLowerCase();
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Categorie della casa, nell'ordine scelto. */
async function categorie({ fresh = false } = {}) {
  const h = await getHousehold({ fresh });
  return Array.isArray(h?.manualCategories) ? h.manualCategories : PREDEFINITE;
}

/** Link a Google Maps costruito da nome e indirizzo: niente da incollare a mano. */
export function linkMappa(e) {
  if (!e.address) return null;
  const q = e.type === "shop" ? `${e.name}, ${e.address}` : e.address;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** Foglio di una voce. Esportato: lo usano il diario e le proposte.
 *  Invio sul nome salva: è l'unico campo obbligatorio. */
export async function apriVoceManuale(esistente = null, prefill = {}) {
  const d = esistente || { type: "shop", ...prefill };
  let tipo = d.type || "shop";
  let categoria = d.category && d.category !== "Altro" ? d.category : "";
  let visibility = d.visibility || (tipo === "person" ? VIS.PRIVATE : VIS.SHARED);
  let visToccata = !!esistente;
  let cats = await categorie();
  if (categoria && !cats.includes(categoria)) cats = [...cats, categoria];

  const nome = el("input.linea-input", { value: d.name || "", placeholder: "Nome", autofocus: true, enterkeyhint: "done", style: "font-size:19px" });
  nome.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sheet.confirm(); } });

  const tipi = el("div.segmenti", { style: "padding-top:0" });
  const sceltaCat = el("div.segmenti", { style: "padding-top:0;flex-wrap:wrap" });
  let nuovaCat = false;

  const indirizzo = el("input", { value: d.address || "", placeholder: "Via, paese", autocomplete: "off" });
  const tel = el("input", { value: d.phone || "", placeholder: "Telefono", type: "tel" });
  const mail = el("input", { value: d.email || "", placeholder: "nome@esempio.it", type: "email" });
  const sito = el("input", { value: d.url || "", placeholder: "https://", type: "url" });
  const note = el("textarea", { value: d.notes || "" });

  const campi = {
    categoria: el("div.campo", {}, el("label", {}, "Categoria"), sceltaCat),
    indirizzo: el("div.campo", {}, el("label", {}, "Indirizzo"), indirizzo,
      el("p.meta", { style: "margin-top:4px" }, "Il collegamento a Google Maps si crea da solo.")),
    tel: campo("Telefono", tel),
    mail: campo("Email", mail),
    sito: campo("Sito web", sito),
  };
  const visWrap = el("div");
  const disegnaVis = () => visWrap.replaceChildren(sceltaVisibilita(visibility, (v) => { visibility = v; visToccata = true; }));

  // Da Google Contatti: solo per una persona nuova.
  const daGoogle = el("button.pillola.pillola--accento", { type: "button", onclick: () => apriImporta(nome.value.trim()) }, icon("persone"), "Prendi da Google Contatti");

  function disegnaTipi() {
    tipi.replaceChildren(...TIPI.map(([v, l]) => el("button.pillola", {
      type: "button", class: v === tipo ? "on" : "",
      onclick: () => {
        tipo = v;
        if (!visToccata) { visibility = tipo === "person" ? VIS.PRIVATE : VIS.SHARED; disegnaVis(); }
        disegnaTipi();
      },
    }, l)));
    // Campi secondo il tipo: un negozio ha indirizzo e sito, una persona telefono ed email,
    // un'informazione solo il testo.
    campi.indirizzo.hidden = tipo === "info";
    campi.tel.hidden = tipo === "info";
    campi.mail.hidden = tipo !== "person";
    campi.sito.hidden = tipo === "person";
    daGoogle.hidden = !!esistente || tipo !== "person";
    note.placeholder = tipo === "info" ? "Codici, istruzioni, chi chiamare…"
      : tipo === "person" ? "Chi è, come l'hai conosciuto…" : "Cosa vendono, orari, chi chiedere…";
  }

  function disegnaCat() {
    const campoNuova = el("input.linea-input", { placeholder: "Nuova categoria", enterkeyhint: "done", style: "width:170px;padding:5px 0;font-size:14px" });
    campoNuova.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const n = cap(campoNuova.value.trim());
      nuovaCat = false;
      if (n) {
        const esiste = cats.find((c) => norm(c) === norm(n));
        if (!esiste) { cats = [...cats, n]; updateHousehold({ manualCategories: cats }).catch((err) => toast(`Categoria non salvata: ${err.code || err.message}`)); }
        categoria = esiste || n;
      }
      disegnaCat();
    });
    sceltaCat.replaceChildren(
      ...cats.map((c) => el("button.pillola", { type: "button", class: c === categoria ? "on" : "",
        onclick: () => { categoria = c === categoria ? "" : c; disegnaCat(); } }, c)),
      nuovaCat ? campoNuova
        : el("button.pillola.pillola--accento", { type: "button", onclick: () => { nuovaCat = true; disegnaCat(); campoNuova.focus(); } }, icon("piu"), "Nuova"),
    );
  }

  disegnaTipi();
  disegnaCat();
  disegnaVis();

  // Per una persona: i suoi task ancora aperti, così la rubrica e i task si parlano.
  const suoiTask = el("div");
  if (esistente?.type === "person") {
    readVisible("tasks").then((tasks) => {
      const aperti = tasks.filter((t) => !t.done && (t.peopleIds || []).includes(esistente.id));
      if (!aperti.length) return;
      readVisible("projects").then((progetti) => suoiTask.replaceChildren(
        el("div.etichetta-campo", { style: "margin-top:6px" }, "Task con questa persona"),
        el("div", {}, ...aperti.map((t) => rigaTask(t, { progetti }))),
      ));
    });
  }

  const sheet = openSheet({
    title: esistente ? esistente.name : "Nuova voce",
    body: [
      el("div.campo", { style: "margin-top:14px" }, nome),
      el("div.campo", {}, tipi),
      el("div", { style: "margin:-6px 0 14px" }, daGoogle),
      campi.categoria,
      campi.indirizzo,
      el("div.due", {}, campi.tel, campi.mail, campi.sito),
      campo("Note", note),
      el("div.campo", {}, el("label", {}, "Visibilità"), visWrap),
      suoiTask,
      esistente ? el("div.foglio__piede", {},
        el("button.btn.btn--pericolo", { onclick: () => { remove(COLL, esistente.id); sheet.close(); toast("Voce eliminata"); } }, icon("cestino"), "Elimina"),
      ) : null,
    ],
    onConfirm: () => {
      const dati = {
        type: tipo, name: nome.value.trim(), category: categoria,
        address: tipo === "info" ? "" : indirizzo.value.trim(),
        phone: tipo === "info" ? "" : tel.value.trim(),
        email: tipo === "person" ? mail.value.trim() : "",
        url: tipo === "person" ? "" : sito.value.trim(),
        notes: note.value.trim(),
      };
      if (!dati.name) { nome.focus(); return false; }
      if (esistente) update(COLL, esistente.id, { ...dati, visibility });
      else create(COLL, dati, visibility);
    },
  });
}

/** Gestione delle categorie: rinomina (le voci seguono), togli (le voci restano senza), aggiungi. */
async function apriCategorie() {
  const righe = (await categorie({ fresh: true })).map((c) => ({ orig: c, nome: c }));
  const elenco = el("div");
  const nuova = el("input.linea-input", { placeholder: "Nuova categoria", enterkeyhint: "done" });
  nuova.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const n = cap(nuova.value.trim());
    if (n && !righe.some((r) => norm(r.nome) === norm(n))) righe.push({ orig: null, nome: n });
    nuova.value = "";
    disegna();
  });

  function disegna() {
    elenco.replaceChildren(...righe.map((r, i) => {
      const input = el("input", { value: r.nome, "aria-label": "Nome della categoria", oninput: (e) => { r.nome = e.target.value; } });
      return el("div.riga", { style: "cursor:default" },
        el("div.pallino", {}, icon(iconaCategoria(r.nome))),
        el("div.testo.campo", { style: "margin:0" }, input),
        el("button.tondo.tondo--piatto", { type: "button", "aria-label": `Togli ${r.nome}`, onclick: () => { righe.splice(i, 1); disegna(); } }, icon("cestino")),
      );
    }));
  }
  disegna();

  openSheet({
    title: "Categorie",
    body: [
      el("p.meta", { style: "margin-top:12px" }, "Valgono per tutta la casa. Se rinomini una categoria le voci la seguono; se la togli, le voci restano senza categoria."),
      elenco,
      el("div.campo", { style: "margin-top:10px" }, nuova),
    ],
    onConfirm: async () => {
      const finali = [];
      for (const r of righe) {
        const n = cap(r.nome.trim());
        if (n && !finali.some((x) => norm(x) === norm(n))) finali.push(n);
      }
      const rinomina = new Map(righe.filter((r) => r.orig && cap(r.nome.trim()) && r.orig !== cap(r.nome.trim())).map((r) => [r.orig, cap(r.nome.trim())]));
      const tolte = new Set((await categorie()).filter((c) => !righe.some((r) => r.orig === c)));
      try {
        await updateHousehold({ manualCategories: finali });
      } catch (err) {
        toast(`Non salvate: ${err.code || err.message}`);
        return false;
      }
      if (rinomina.size || tolte.size) {
        const voci = await readVisible(COLL);
        for (const v of voci) {
          if (rinomina.has(v.category)) update(COLL, v.id, { category: rinomina.get(v.category) });
          else if (tolte.has(v.category)) update(COLL, v.id, { category: "" });
        }
      }
      toast("Categorie aggiornate");
    },
  });
}

/** Scelta da Google Contatti: cerchi, tocchi, la persona entra in rubrica (solo per te). */
async function apriImporta(cerca = "") {
  let token;
  try {
    token = await permessoContatti();
  } catch (err) {
    if (err.code !== "auth/popup-closed-by-user" && err.code !== "auth/cancelled-popup-request") toast(`Permesso non dato: ${err.code || err.message}`);
    return;
  }
  if (!token) return; // si passa dalla pagina di Google: il foglio si riapre al ritorno

  const filtro = el("input.linea-input", { placeholder: "Cerca tra i contatti", value: cerca, autofocus: true, style: "margin-top:12px" });
  const elenco = el("div", {}, el("p.meta", { style: "padding:16px 0" }, "Leggo i contatti…"));
  let contatti = [];
  let presenti = [];

  function disegna() {
    const q = norm(filtro.value);
    const visti = contatti.filter((c) => !q || norm([c.name, c.phone, c.email, c.org].join(" ")).includes(q)).slice(0, 60);
    if (!visti.length) { elenco.replaceChildren(vuoto(q ? "Nessun contatto" : "Nessun contatto in Google")); return; }
    elenco.replaceChildren(...visti.map((c) => {
      const già = presenti.find((p) => (p.googleId && p.googleId === c.googleId) || (p.type === "person" && norm(p.name) === norm(c.name)));
      return el("div.riga", {
        onclick: () => {
          if (già) return;
          const dati = { type: "person", name: c.name, category: "", address: c.address, phone: c.phone, email: c.email, url: "", notes: c.org, googleId: c.googleId };
          const { id: nuovoId } = create(COLL, dati, VIS.PRIVATE);
          presenti.push({ id: nuovoId, ...dati });
          toast(`${c.name} è in rubrica`);
          disegna();
        },
      },
      el("div.pallino", { class: già ? "pallino--accento" : "" }, icon(già ? "spunta" : "persona")),
      el("div.testo", {}, el("b", {}, c.name), el("span", {}, già ? "già in rubrica" : [c.phone, c.email, c.org].filter(Boolean).join(" · "))));
    }));
  }
  filtro.addEventListener("input", disegna);

  openSheet({ title: "Google Contatti", body: [filtro, elenco] });

  try {
    [contatti, presenti] = await Promise.all([leggiContatti(), readVisible(COLL)]);
    disegna();
  } catch (err) {
    console.warn("contatti", err);
    const spento = /SERVICE_DISABLED|PERMISSION_DENIED|ACCESS_TOKEN_SCOPE_INSUFFICIENT|403/.test(String(err.code));
    elenco.replaceChildren(vuoto("Contatti non raggiungibili",
      spento ? "Va attivata una volta la People API nel progetto Google Cloud dell'app." : `Errore: ${err.message}`));
  }
}

export function mount(container) {
  let entries = [];
  let filtro = "";
  let segmento = "tutto";
  try { segmento = localStorage.getItem(CHIAVE_SEGMENTO) || "tutto"; } catch (e) {}

  const cerca = el("input.linea-input", { placeholder: "Cerca: nome, categoria, note", style: "margin-top:14px",
    oninput: (e) => { filtro = e.target.value.toLowerCase(); render(); } });
  const segmenti = el("div.segmenti");
  const elenco = el("div");
  const piu = fab("Nuova voce", () => apriVoceManuale(null, { type: segmento === "persone" ? "person" : segmento === "casa" ? "info" : "shop" }));

  const scegli = (v) => { segmento = v; try { localStorage.setItem(CHIAVE_SEGMENTO, v); } catch (e) {} render(); };
  const ferma = (ev) => ev.stopPropagation();

  function riga(e) {
    const cat = e.category && e.category !== "Altro" ? e.category : "";
    const dove = e.type === "person" ? (e.phone || e.email) : e.address;
    const sotto = [cat, dove, e.visibility === VIS.PRIVATE ? "solo tu" : null].filter(Boolean).join(" · ");
    const mappa = linkMappa(e);
    return el("div.riga", { onclick: () => apriVoceManuale(e) },
      el("div.pallino", {}, icon(e.type === "info" ? "info" : e.type === "person" ? "persona" : cat ? iconaCategoria(cat) : "negozio")),
      el("div.testo", {}, el("b", {}, e.name), sotto ? el("span", {}, sotto) : null,
        e.notes ? el("span", {}, e.notes) : null),
      e.phone ? el("a.tondo", { href: `tel:${e.phone.replace(/\s+/g, "")}`, "aria-label": "Chiama", onclick: ferma }, icon("telefono")) : null,
      e.type === "person" && e.email ? el("a.tondo", { href: `mailto:${e.email}`, "aria-label": "Scrivi una mail", onclick: ferma }, icon("mail")) : null,
      mappa ? el("a.tondo", { href: mappa, target: "_blank", rel: "noopener", "aria-label": "Apri in Google Maps", onclick: ferma }, icon("luogo")) : null,
      e.url ? el("a.tondo", { href: e.url, target: "_blank", rel: "noopener", "aria-label": "Apri il sito", onclick: ferma }, icon("collegamento")) : null,
    );
  }

  const gruppo = (titolo, voci) => voci.length ? [fascia(titolo), el("div", {}, ...voci.map(riga))] : [];

  function render() {
    segmenti.replaceChildren(...[["tutto", "Tutto"], ["negozi", "Negozi"], ["persone", "Persone"], ["casa", "Casa"]].map(([v, l]) =>
      el("button.pillola", { class: v === segmento ? "on" : "", onclick: () => scegli(v) }, l)));

    const q = filtro;
    const visti = entries
      .filter((e) => !q || [e.name, e.category, e.notes, e.address, e.phone, e.email].join(" ").toLowerCase().includes(q))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const negozi = visti.filter((e) => e.type !== "info" && e.type !== "person");
    const persone = visti.filter((e) => e.type === "person");
    const info = visti.filter((e) => e.type === "info");
    const nodi = [];

    if (segmento === "negozi") {
      // Negozi divisi per categoria, nell'ordine delle categorie della casa.
      const perCat = new Map();
      for (const e of negozi) {
        const c = e.category && e.category !== "Altro" ? e.category : "";
        if (!perCat.has(c)) perCat.set(c, []);
        perCat.get(c).push(e);
      }
      const ordine = [...perCat.keys()].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b));
      for (const c of ordine) nodi.push(...gruppo(c || "Senza categoria", perCat.get(c)));
      nodi.push(el("div.segmenti", { style: "padding-top:14px" },
        el("button.btn.btn--piatto", { onclick: apriCategorie }, icon("matita"), "Gestisci le categorie")));
      if (!negozi.length) nodi.unshift(vuoto(q ? "Nessun risultato" : "Nessun negozio", q ? null : "Segna qui i negozi utili: idraulica, vernici, agraria…"));
    } else if (segmento === "persone") {
      nodi.push(el("div.segmenti", { style: "padding-top:6px" },
        el("button.btn.btn--piatto", { onclick: () => apriImporta() }, icon("persone"), "Prendi da Google Contatti")));
      nodi.push(...gruppo("Persone", persone));
      if (!persone.length) nodi.push(vuoto(q ? "Nessun risultato" : "Nessuna persona", q ? null : "Le persone dei task finiscono qui da sole. Puoi anche prenderle da Google Contatti."));
    } else if (segmento === "casa") {
      nodi.push(...gruppo("Informazioni di casa", info));
      if (!info.length) nodi.push(vuoto(q ? "Nessun risultato" : "Nessuna informazione", q ? null : "Codici, tecnici, istruzioni degli elettrodomestici…"));
    } else {
      nodi.push(...gruppo("Negozi e fornitori", negozi), ...gruppo("Persone", persone), ...gruppo("Informazioni di casa", info));
      if (!visti.length) nodi.push(vuoto(q ? "Nessun risultato" : "Il manuale è vuoto", q ? null : "Tocca + per segnare un negozio utile, una persona o un'informazione di casa."));
    }
    elenco.replaceChildren(...nodi);
  }

  container.append(cerca, segmenti, elenco, piu);
  const stop = watchVisible(COLL, { order: ["name", "asc"] }, (docs) => { entries = docs; render(); });

  // Ritorno dalla pagina di Google dopo aver dato il permesso per i contatti (telefono).
  checkRedirectResult().then(() => { if (ritornoDaGoogle()) apriImporta(); });

  return () => { stop(); piu.remove(); };
}
