// Manuale di casa e rubrica: negozi e fornitori utili, persone (anche quelle dei task),
// informazioni di casa (codici, tecnici, istruzioni). Un solo posto per i contatti.
//
// manual_entries { type: "shop" | "person" | "info", name, category, address, phone, email, url, notes, googleId, documenti }
// googleId: la persona è collegata a Google Contatti; telefono, mail e indirizzo arrivano da lì.
// documenti: file di Google Drive collegati alla voce [{ id, nome, mime, link }] (contratti, garanzie, istruzioni).
// Le categorie sono della casa: households/{id}.manualCategories (nomi). Se mancano valgono
// quelle predefinite; la categoria di una voce è facoltativa.
import { el, icon, toast, fascia, vuoto, sceltaVisibilita, iconaDa, fab } from "../../core/ui.js";
import { create, update, remove, watchVisible, readVisible, VIS } from "../../core/db.js";
import { getHousehold, updateHousehold } from "../../core/household.js";
import { session } from "../../core/auth.js";
import { richiesto, vaiA } from "../../core/router.js";
import {
  statoContatti, contattiCollegati, caricaContatti,
  cercaContatti, contattoDaId, linkGoogle, dettaglioContatto, messaggioContatti, suContatti,
} from "../../core/contatti-google.js";
import { personaDaGoogle, trovaPersona, datiDaContatto, differenzeDaGoogle, rubricaPronta } from "../../core/rubrica.js";
import { openSheet, campo } from "../../components/sheet.js";
import { sceltaDocumenti } from "../../components/documenti.js";
import { rigaTask } from "../task/index.js";

export const id = "manuale";
export const title = "Manuale";
export const nav = false; // dal menu a sinistra
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
  let google = d.googleId ? { googleId: d.googleId } : null; // collegata a Google Contatti
  let cercaGoogle = !esistente; // una persona nuova cerca tra i contatti mentre scrivi il nome
  let cats = await categorie();
  if (categoria && !cats.includes(categoria)) cats = [...cats, categoria];

  const nome = el("input.linea-input", { value: d.name || "", placeholder: "Nome", autofocus: true, enterkeyhint: "done", style: "font-size:19px", autocomplete: "off" });
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

  // ── Google Contatti, solo per le persone ──
  // Collegata: una riga lo dice, e telefono, mail e indirizzo si leggono soltanto (arrivano da Google).
  // Non collegata: mentre scrivi il nome compaiono i contatti; per una persona già in rubrica la
  // ricerca si accende con «Collega a Google Contatti».
  const suggeriti = el("div.segmenti", { style: "padding-top:0;margin:-8px 0 14px;flex-wrap:wrap" });
  const legame = el("div");
  const tieni = (e) => e.preventDefault(); // tocchi un suggerimento senza chiudere la tastiera

  function collega(c) {
    google = c;
    cercaGoogle = false;
    if (!esistente) nome.value = c.name; // una persona già in rubrica tiene il suo nome
    for (const [campoInput, k] of [[tel, "phone"], [mail, "email"], [indirizzo, "address"]]) if (c[k] || !esistente) campoInput.value = c[k] || "";
    if (!note.value.trim() && c.org) note.value = c.org;
    disegnaGoogle();
  }

  function disegnaGoogle() {
    const persona = tipo === "person";
    for (const x of [tel, mail, indirizzo]) x.readOnly = persona && !!google;
    if (!persona) { suggeriti.hidden = true; legame.replaceChildren(); return; }
    if (google) {
      suggeriti.hidden = true;
      legame.replaceChildren(el("div.nota-campo", { title: "Telefono, mail e indirizzo si aggiornano da Google Contatti" }, icon("contatto"),
        el("span", { style: "flex:1" }, "Da Google Contatti"),
        el("a", { href: linkGoogle(google.googleId), target: "_blank", rel: "noopener" }, "Modifica in Google"),
        el("button", { type: "button", onclick: () => { google = null; disegnaGoogle(); } }, "Scollega")));
      return;
    }
    if (!contattiCollegati()) {
      suggeriti.hidden = true;
      legame.replaceChildren(esistente ? null : el("div.nota-campo", {}, icon("contatto"),
        el("button", { type: "button", onclick: () => vaiA("google") }, "Collega Google"),
        el("span", {}, "per cercare tra i tuoi contatti")));
      return;
    }
    if (!cercaGoogle) {
      suggeriti.hidden = true;
      legame.replaceChildren(el("div.nota-campo", {}, icon("contatto"),
        el("button", { type: "button", onclick: () => { cercaGoogle = true; disegnaGoogle(); } }, "Collega a Google Contatti")));
      return;
    }
    legame.replaceChildren();
    const q = nome.value.trim();
    const trovati = q ? cercaContatti(q, 6).filter((c) => !personaDaGoogle(c.googleId)) : [];
    suggeriti.replaceChildren(...trovati.map((c) => el("button.pillola", {
      type: "button", onpointerdown: tieni, onclick: () => collega(c), title: dettaglioContatto(c) || null,
    }, icon("contatto"), c.name, dettaglioContatto(c) ? el("small", {}, dettaglioContatto(c)) : null)));
    if (esistente && !trovati.length) suggeriti.replaceChildren(el("span.meta", {}, q ? "Nessun contatto con questo nome: correggi il nome per cercare." : "Scrivi il nome per cercare."));
    suggeriti.hidden = !suggeriti.childNodes.length;
  }
  nome.addEventListener("input", () => { if (tipo === "person" && cercaGoogle && !google) disegnaGoogle(); });
  nome.addEventListener("focus", () => { if (tipo === "person") caricaContatti().catch(() => {}); }, { once: true });

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
    disegnaGoogle();
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

  // Persona collegata: i recapiti più recenti da Google, quando l'elenco è letto.
  // Solo le proprie voci si aggiornano anche in rubrica (vengono dal proprio account Google).
  const ritoccaDaGoogle = () => {
    const c = google && contattoDaId(google.googleId);
    if (!c || tipo !== "person") return;
    const diff = differenzeDaGoogle({ phone: tel.value, email: mail.value, address: indirizzo.value }, c);
    if (diff.phone) tel.value = diff.phone;
    if (diff.email) mail.value = diff.email;
    if (diff.address) indirizzo.value = diff.address;
    if (esistente && esistente.ownerUid === session.user?.uid && Object.keys(differenzeDaGoogle(esistente, c)).length) {
      update(COLL, esistente.id, differenzeDaGoogle(esistente, c));
    }
  };
  if (google && contattiCollegati()) caricaContatti().then(ritoccaDaGoogle, () => {});
  // L'elenco dei contatti può arrivare mentre il foglio è aperto: suggerimenti o recapiti aggiornati.
  const smetti = suContatti(() => {
    if (!nome.isConnected) { smetti(); return; }
    if (google) ritoccaDaGoogle();
    else if (tipo === "person" && cercaGoogle) disegnaGoogle();
  });

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

  const documenti = sceltaDocumenti({ documenti: d.documenti || [] });
  const sheet = openSheet({
    title: esistente ? esistente.name : "Nuova voce",
    body: [
      el("div.campo", { style: "margin-top:14px" }, nome),
      suggeriti,
      legame,
      el("div.campo", {}, tipi),
      campi.categoria,
      campi.indirizzo,
      el("div.due", {}, campi.tel, campi.mail, campi.sito),
      campo("Note", note),
      documenti.node,
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
        googleId: tipo === "person" && google ? google.googleId : null,
        documenti: documenti.valore(),
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

/**
 * Google Contatti: l'elenco dei contatti, da cui una persona entra in rubrica con un tocco. Dal menu
 * e dalla sezione Persone. Il collegamento dell'account si fa dalla pagina Google (modules/google):
 * senza il permesso dei contatti si va lì.
 */
function apriContatti() {
  if (!contattiCollegati()) { vaiA("google"); return; }
  foglioContatti();
}

function foglioContatti() {
  const { email } = statoContatti();
  const filtro = el("input.linea-input", { placeholder: "Cerca tra i contatti", autofocus: true, autocomplete: "off", style: "margin-top:6px" });
  const elenco = el("div", {}, el("p.meta", { style: "padding:16px 0" }, "Leggo i contatti…"));
  let contatti = null;

  function disegna() {
    if (!contatti) return;
    const q = filtro.value.trim();
    const visti = q ? cercaContatti(q, 60) : contatti.slice(0, 60);
    if (!visti.length) { elenco.replaceChildren(vuoto(q ? "Nessun contatto" : "Nessun contatto in Google")); return; }
    elenco.replaceChildren(...visti.map((c) => {
      const collegata = personaDaGoogle(c.googleId);
      const omonima = !collegata && trovaPersona(c.name);
      const omonimaLibera = omonima && !omonima.googleId ? omonima : null;
      const sotto = collegata ? "in rubrica" : omonimaLibera ? "in rubrica, non collegata · tocca per collegarla" : dettaglioContatto(c);
      return el("div.riga", {
        onclick: () => {
          if (collegata) { apriVoceManuale(collegata); return; }
          if (omonimaLibera) {
            update(COLL, omonimaLibera.id, { googleId: c.googleId, ...differenzeDaGoogle(omonimaLibera, c) });
            toast(`${omonimaLibera.name} è collegata a Google`);
          } else {
            create(COLL, { type: "person", category: "", url: "", notes: c.org || "", ...datiDaContatto(c) }, VIS.PRIVATE);
            toast(`${c.name} è in rubrica`);
          }
          setTimeout(disegna, 50); // la rubrica in memoria si aggiorna subito dopo la scrittura
        },
      },
      el("div.pallino", { class: collegata ? "pallino--accento" : "" }, icon(collegata ? "spunta" : "contatto")),
      el("div.testo", {}, el("b", {}, c.name), sotto ? el("span", {}, sotto) : null));
    }));
  }
  filtro.addEventListener("input", disegna);

  const sheet = openSheet({
    title: "Google Contatti",
    body: [
      el("p.meta", { style: "margin-top:12px" }, `Collegato${email ? ` come ${email}` : ""}. Tocca un contatto per metterlo in rubrica.`),
      filtro,
      elenco,
    ],
  });

  // Anche la rubrica: senza, chi è già in rubrica sembrerebbe nuovo (e toccandolo si duplicherebbe).
  Promise.all([caricaContatti(), rubricaPronta()]).then(([c]) => { contatti = c; disegna(); }, (err) => {
    const m = messaggioContatti(err);
    if (err.motivo === "scaduto") { sheet.close(); toast(`${m.titolo}: ${m.testo}`, { ms: 6000 }); vaiA("google"); return; }
    elenco.replaceChildren(vuoto(m.titolo, m.testo));
  });
}

export function mount(container) {
  let entries = [];
  let caricate = false; // prima delle voci la pagina mostra solo ricerca e sezioni, senza dire «vuoto»
  let filtro = "";
  let segmento = "tutto";
  try { segmento = localStorage.getItem(CHIAVE_SEGMENTO) || "tutto"; } catch (e) {}
  // Dal menu: categorie o Google Contatti si aprono subito, sulla sezione giusta.
  if (richiesto("manuale", "categorie")) { segmento = "negozi"; apriCategorie(); }
  // Dopo il montaggio il router chiude i fogli aperti: questo si apre al giro successivo.
  if (richiesto("manuale", "contatti")) { segmento = "persone"; setTimeout(apriContatti, 0); }

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
      el("div.pallino", {}, icon(e.type === "info" ? "info" : e.type === "person" ? (e.googleId ? "contatto" : "persona") : cat ? iconaCategoria(cat) : "negozio")),
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
    if (!caricate) { elenco.replaceChildren(); return; }

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
        el("button.btn.btn--piatto", { onclick: () => apriContatti() }, icon("contatto"),
          contattiCollegati() ? "Cerca in Google Contatti" : "Collega Google")));
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
  render();
  const stop = watchVisible(COLL, { order: ["name", "asc"] }, (docs) => { entries = docs; caricate = true; render(); });
  return () => { stop(); piu.remove(); };
}
