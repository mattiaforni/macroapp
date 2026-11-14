// Chiedi (14/11, dall'analisi dell'app: «l'AI va in una sola direzione, non le puoi chiedere niente»). Una domanda sui
// propri dati («cosa mi ha detto il maestro sul rovescio a ottobre?», «quanto abbiamo speso in ristoranti?», «quando è
// venuto l'idraulico?»): Claude cerca con degli strumenti di sola lettura e risponde citando le fonti.
//
// Stato sul documento, scritto dal server (come l'analisi delle note, 7/11): l'app crea domande/{id} con la domanda e
// chiama la funzione; qui si segna «in corso», si scrivono i passi («Cerco nelle note: rovescio»), poi la risposta e le
// fonti. Se il telefono si blocca e la risposta si perde, il documento la riceve lo stesso.
//
// domande/{id} = { ownerUid, householdId, visibility: "private", tipo: "domanda" | "settimana", turni: [{ domanda,
//   risposta?, fonti?: [{ tipo, id, titolo, sotto, link? }], modello?, at }], stato: "in_corso" | "fatta" | "errore",
//   inizio, passi: [string], errore?, createdAt, updatedAt }
//
// Privacy: le funzioni usano l'Admin SDK, che salta le regole di Firestore. Ogni strumento filtra quindi a mano: le
// cose proprie (ownerUid) e quelle condivise della propria casa (householdId della persona, verificato tra i membri, e
// visibility "shared"). Le note private dell'altra persona non entrano mai. Niente si scrive nei moduli: per fare
// qualcosa si scrive una nota nel Diario.
import { FieldValue } from "firebase-admin/firestore";
import { MODELLI } from "./ai/claude.js";
import { registra as registraConsumo, somma } from "./consumi.js";
import { normalizza } from "./google/contatti.js";

const URL = "https://api.anthropic.com/v1/messages";
const GIRI_MAX = 8;               // chiamate al modello per domanda (ogni giro può usare più strumenti)
const TEMPO_MAX = 230_000;        // ms: oltre, si chiede di rispondere con quello che c'è (funzione a 300 s)
const ATTESA_CHIAMATA = 120_000;  // ms per una singola chiamata
const MAX_RISULTATI = 12;
const ESTRATTO = 1500;            // caratteri di una nota nei risultati della ricerca
const NOTA_INTERA = 8000;
export const IN_CORSO_MS = 300_000;
export const MODELLO_PREDEFINITO = "sonnet";

const s = (x) => (typeof x === "string" ? x.trim() : "");
const ms = (t) => (t?.toMillis ? t.toMillis() : t?.toDate ? t.toDate().getTime() : t ? new Date(t).getTime() || 0 : 0);
const giorno = (t) => (ms(t) ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date(ms(t))) : "");
const euro = (n) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(n) || 0);
const PAROLE_VUOTE = new Set("il lo la i gli le un uno una di a da in con su per tra fra e o ma che chi cosa come quando dove quanto quanti quante mi ti ci si ne del della dei delle degli al alla ai alle nel nella nei nelle sul sulla è ho ha abbiamo hanno sono stato stata".split(" "));
const parole = (q) => [...new Set(normalizza(q).split(/[^a-z0-9àèéìòù]+/).filter((p) => p.length > 2 && !PAROLE_VUOTE.has(p)))];

// ───────────── Strumenti ─────────────

const STRUMENTI = [
  { name: "cerca_note", description: "Cerca nelle note del diario (le proprie e quelle dei progetti condivisi). Ritorna per ogni nota codice, data, titolo, progetto, autore e un estratto (il riepilogo se c'è). Senza testo: le più recenti nel periodo. Per leggere una nota intera usa leggi_nota.",
    input_schema: { type: "object", properties: {
      testo: { type: "string", description: "Parole da cercare (nomi, argomenti). Vuoto per le più recenti." },
      progetto: { type: "string", description: "Nome del progetto, se la domanda ne riguarda uno." },
      da: { type: "string", description: "Dal giorno AAAA-MM-GG (facoltativo)." },
      a: { type: "string", description: "Al giorno AAAA-MM-GG compreso (facoltativo)." },
    }, required: ["testo"] } },
  { name: "leggi_nota", description: "Il testo intero di una nota (testo, riepilogo, persone, temi), dal suo codice (es. n3).",
    input_schema: { type: "object", properties: { codice: { type: "string" } }, required: ["codice"] } },
  { name: "spese", description: "Spese della casa in un periodo, con totale, totali per categoria e per chi ha pagato. Filtrabili per parole nella descrizione o per categoria. Le spese sono in euro; i pareggi (rimborsi tra i due) sono a parte.",
    input_schema: { type: "object", properties: {
      da: { type: "string", description: "Dal giorno AAAA-MM-GG." }, a: { type: "string", description: "Al giorno AAAA-MM-GG compreso." },
      testo: { type: "string", description: "Parole nella descrizione (facoltativo)." }, categoria: { type: "string", description: "Categoria (facoltativo)." },
    }, required: ["da", "a"] } },
  { name: "task", description: "Task (cose da fare), propri e condivisi, con scadenza, progetto, persone e se sono fatti.",
    input_schema: { type: "object", properties: {
      stato: { type: "string", enum: ["aperti", "fatti", "tutti"] },
      testo: { type: "string", description: "Parole nel testo (facoltativo)." }, progetto: { type: "string", description: "Nome del progetto (facoltativo)." },
    }, required: ["stato"] } },
  { name: "eventi", description: "Eventi dei calendari di Google che la persona vede nell'app (quello della casa e i suoi), in un periodo di al più un anno.",
    input_schema: { type: "object", properties: {
      da: { type: "string", description: "Dal giorno AAAA-MM-GG." }, a: { type: "string", description: "Al giorno AAAA-MM-GG compreso." },
      testo: { type: "string", description: "Parole nel titolo o nel luogo (facoltativo)." },
    }, required: ["da", "a"] } },
  { name: "progetti", description: "I progetti (nome, condiviso o no, se hanno istruzioni e una sintesi). Con `progetto`, la sintesi di quel progetto: lo stato per temi.",
    input_schema: { type: "object", properties: { progetto: { type: "string", description: "Nome del progetto di cui leggere la sintesi (facoltativo)." } }, required: [] } },
  { name: "manuale", description: "Manuale di casa e rubrica: negozi, artigiani, persone (con recapiti) e informazioni di casa.",
    input_schema: { type: "object", properties: { testo: { type: "string", description: "Parole da cercare (nome, categoria, note)." } }, required: ["testo"] } },
  { name: "lista", description: "La lista della spesa: cosa c'è da comprare e cosa si è comprato di recente.",
    input_schema: { type: "object", properties: {}, required: [] } },
];

/** Etichetta del passo, mostrata nell'app mentre si cerca. */
function passoDi(nome, x = {}) {
  const tra = x.da && x.a ? ` dal ${x.da} al ${x.a}` : "";
  switch (nome) {
    case "cerca_note": return `Cerco nelle note${s(x.testo) ? `: «${s(x.testo).slice(0, 40)}»` : ""}${x.progetto ? ` (${x.progetto})` : ""}`;
    case "leggi_nota": return "Leggo una nota";
    case "spese": return `Guardo le spese${tra}`;
    case "task": return "Guardo i task";
    case "eventi": return `Guardo il calendario${tra}`;
    case "progetti": return x.progetto ? `Leggo la sintesi di ${x.progetto}` : "Guardo i progetti";
    case "manuale": return "Cerco nel manuale";
    case "lista": return "Guardo la lista della spesa";
    default: return "Cerco";
  }
}

/**
 * Gli strumenti di una persona: ciascuno legge solo ciò che lei vede nell'app. `fonti` raccoglie i codici dati al
 * modello (n1, s2, t3…) → { tipo, id, titolo, sotto, link? }, per le fonti della risposta.
 */
export function strumentiDi(db, { uid, hid, nomi = {}, tokenGoogle = null, casa = {}, utente = {} }) {
  const fonti = new Map();
  const conta = {};
  const codice = (lettera, fonte) => {
    const gia = [...fonti.entries()].find(([, f]) => f.tipo === fonte.tipo && f.id === fonte.id);
    if (gia) return gia[0];
    conta[lettera] = (conta[lettera] || 0) + 1;
    const c = `${lettera}${conta[lettera]}`;
    fonti.set(c, fonte);
    return c;
  };
  const chi = (u) => (u === uid ? "tu" : s(nomi[u]).split(" ")[0] || "l'altra persona");
  /** Documenti propri e condivisi della casa, uniti per id. */
  async function visibili(coll, ordine, quanti = 500) {
    const [mie, casaQ] = await Promise.all([
      db.collection(coll).where("ownerUid", "==", uid).orderBy(ordine, "desc").limit(quanti).get(),
      hid ? db.collection(coll).where("householdId", "==", hid).where("visibility", "==", "shared").orderBy(ordine, "desc").limit(quanti).get() : { docs: [] },
    ]);
    const m = new Map();
    for (const d of [...mie.docs, ...casaQ.docs]) if (!m.has(d.id)) m.set(d.id, { id: d.id, ...d.data() });
    return [...m.values()];
  }
  let progettiCache = null;
  const progetti = async () => (progettiCache ||= visibili("projects", "createdAt", 200));
  const nomeProgetto = async (pid) => (pid ? (await progetti()).find((p) => p.id === pid)?.name || "" : "");
  const trovaProgetto = async (nome) => {
    const n = normalizza(nome);
    if (!n) return null;
    const lista = await progetti();
    return lista.find((p) => normalizza(p.name) === n) || lista.find((p) => normalizza(p.name).includes(n) || n.includes(normalizza(p.name))) || null;
  };
  let noteCache = null;
  const note = async () => (noteCache ||= visibili("journal_entries", "createdAt", 600));
  const nelPeriodo = (t, da, a) => { const g = giorno(t); return (!da || g >= da) && (!a || g <= a); };
  const punteggio = (testo, ps) => { const t = normalizza(testo); return ps.reduce((n, p) => n + (t.includes(p) ? 1 : 0), 0); };

  const esegui = {
    async cerca_note({ testo = "", progetto = "", da = "", a = "" }) {
      const ps = parole(testo);
      const prog = progetto ? await trovaProgetto(progetto) : null;
      if (progetto && !prog) return { avviso: `Nessun progetto si chiama «${progetto}».`, note: [] };
      const candidate = (await note()).filter((n) => (!prog || n.projectId === prog.id) && nelPeriodo(n.createdAt, da, a));
      const conPunti = candidate.map((n) => ({ n, p: ps.length ? punteggio([n.titolo, n.riepilogo, n.text, (n.temi || []).join(" "), (n.persone || []).map((x) => x.nome).join(" ")].join(" "), ps) : 1 }))
        .filter((x) => x.p > 0)
        .sort((x, y) => y.p - x.p || ms(y.n.createdAt) - ms(x.n.createdAt))
        .slice(0, MAX_RISULTATI);
      const out = [];
      for (const { n } of conPunti) {
        const titolo = s(n.titolo) || s(n.text).split("\n")[0].slice(0, 70);
        const c = codice("n", { tipo: "nota", id: n.id, titolo, sotto: giorno(n.createdAt) });
        out.push({ codice: c, data: giorno(n.createdAt), titolo, progetto: await nomeProgetto(n.projectId), autore: chi(n.ownerUid),
          persone: (n.persone || []).map((x) => x.nome).join(", "), temi: (n.temi || []).join(", "), estratto: (s(n.riepilogo) || s(n.text)).slice(0, ESTRATTO) });
      }
      return { trovate: out.length, su: candidate.length, note: out };
    },
    async leggi_nota({ codice: c }) {
      const f = fonti.get(s(c));
      if (!f || f.tipo !== "nota") return { errore: "Codice sconosciuto: cerca prima la nota con cerca_note." };
      const n = (await note()).find((x) => x.id === f.id);
      if (!n) return { errore: "Nota non trovata." };
      return { codice: c, data: giorno(n.createdAt), titolo: s(n.titolo), progetto: await nomeProgetto(n.projectId), autore: chi(n.ownerUid),
        persone: (n.persone || []).map((x) => x.nome), temi: n.temi || [], riepilogo: s(n.riepilogo).slice(0, NOTA_INTERA), testo: s(n.text).slice(0, NOTA_INTERA) };
    },
    async spese({ da, a, testo = "", categoria = "" }) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(da || "") || !/^\d{4}-\d{2}-\d{2}$/.test(a || "")) return { errore: "Servono da e a, AAAA-MM-GG." };
      const tutte = await visibili("expenses", "date", 2000);
      const ps = parole(testo);
      const cat = normalizza(categoria);
      const scelte = tutte.filter((x) => nelPeriodo(x.date, da, a) && (!ps.length || punteggio(x.description, ps) > 0) && (!cat || normalizza(x.category).includes(cat)));
      const spese = scelte.filter((x) => x.type !== "settlement");
      const pareggi = scelte.filter((x) => x.type === "settlement");
      const tot = (l) => Math.round(l.reduce((n, x) => n + (Number(x.amount) || 0), 0) * 100) / 100;
      const per = (l, k) => Object.entries(l.reduce((m, x) => { const c = k(x) || "senza categoria"; m[c] = (m[c] || 0) + (Number(x.amount) || 0); return m; }, {}))
        .sort((x, y) => y[1] - x[1]).map(([c, v]) => `${c}: ${euro(v)}`);
      const elenco = spese.sort((x, y) => ms(y.date) - ms(x.date)).slice(0, 40).map((x) => ({
        codice: codice("s", { tipo: "spesa", id: x.id, titolo: s(x.description) || "Spesa", sotto: `${giorno(x.date)} · ${euro(x.amount)}` }),
        data: giorno(x.date), descrizione: s(x.description), importo: euro(x.amount), categoria: s(x.category), pagata_da: chi(x.paidBy),
        divisa: x.split === "full" ? "tutta a carico dell'altro" : "a metà",
      }));
      return { numero: spese.length, totale: euro(tot(spese)), per_categoria: per(spese, (x) => s(x.category)), per_chi_ha_pagato: per(spese, (x) => chi(x.paidBy)),
        pareggi: pareggi.length ? `${pareggi.length} per ${euro(tot(pareggi))}` : "nessuno", spese: elenco, ...(spese.length > 40 ? { nota: "Elenco limitato alle 40 più recenti; totali su tutte." } : {}) };
    },
    async task({ stato = "aperti", testo = "", progetto = "" }) {
      const prog = progetto ? await trovaProgetto(progetto) : null;
      const ps = parole(testo);
      const tutti = (await visibili("tasks", "createdAt", 800))
        .filter((t) => (stato === "tutti" || (stato === "fatti" ? t.done : !t.done)) && (!prog || t.projectId === prog.id) && (!ps.length || punteggio(`${t.text} ${t.people || ""} ${t.note || ""}`, ps) > 0));
      tutti.sort((x, y) => (stato === "fatti" ? ms(y.doneAt) - ms(x.doneAt) : (x.due || "9999").localeCompare(y.due || "9999")));
      const out = [];
      for (const t of tutti.slice(0, 40)) {
        out.push({ codice: codice("t", { tipo: "task", id: t.id, titolo: s(t.text), sotto: t.due ? `scadenza ${t.due}` : t.done ? `fatto ${giorno(t.doneAt)}` : "" }),
          testo: s(t.text), fatto: !!t.done, ...(t.done ? { fatto_il: giorno(t.doneAt) } : {}), scadenza: t.due || "", progetto: await nomeProgetto(t.projectId),
          persone: s(t.people), note: s(t.note).slice(0, 300), di: chi(t.ownerUid) });
      }
      return { numero: tutti.length, task: out };
    },
    async eventi({ da, a, testo = "" }) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(da || "") || !/^\d{4}-\d{2}-\d{2}$/.test(a || "")) return { errore: "Servono da e a, AAAA-MM-GG." };
      if (!tokenGoogle) return { errore: "Google non è collegato: il calendario non si legge." };
      let t;
      try { t = await tokenGoogle(); } catch (e) { return { errore: "Il permesso di Google non è valido (va ricollegato dalla pagina Google)." }; }
      if (!t.permessi?.calendario) return { errore: "Google è collegato senza il permesso del calendario." };
      const { eventiTra, calendariDi, mezzanotte } = await import("./avvisi-calendario.js");
      const { oraRoma } = await import("./avvisi.js");
      const inizio = mezzanotte(da), fine = new Date(Math.min(mezzanotte(a).getTime() + 86400e3, mezzanotte(da).getTime() + 366 * 86400e3));
      const ps = parole(testo);
      const lista = (await eventiTra(t.accessToken, calendariDi(casa, utente), inizio, fine)).filter((e) => !ps.length || punteggio(`${e.titolo} ${e.luogo}`, ps) > 0);
      return { numero: lista.length, eventi: lista.slice(0, 60).map((e) => ({
        codice: codice("e", { tipo: "evento", id: e.id, titolo: e.titolo, sotto: `${e.giornoInizio}${e.tuttoIlGiorno ? "" : ` ${oraRoma(e.inizio).ora}`}`, calId: e.calId }),
        giorno: e.giornoInizio, ora: e.tuttoIlGiorno ? "tutto il giorno" : oraRoma(e.inizio).ora, titolo: e.titolo, luogo: e.luogo || "", calendario: e.casa ? "casa" : e.calNome })) };
    },
    async progetti({ progetto = "" } = {}) {
      if (progetto) {
        const p = await trovaProgetto(progetto);
        if (!p) return { errore: `Nessun progetto si chiama «${progetto}».` };
        return { codice: codice("p", { tipo: "progetto", id: p.id, titolo: p.name, sotto: "sintesi del progetto" }), nome: p.name, sintesi: s(p.sintesi).slice(0, 12000) || "(ancora senza sintesi)" };
      }
      return { progetti: (await progetti()).filter((p) => !p.archived).map((p) => ({ nome: p.name, condiviso: p.visibility === "shared", istruzioni: !!s(p.istruzioni), sintesi: !!s(p.sintesi) })) };
    },
    async manuale({ testo = "" }) {
      const ps = parole(testo);
      const voci = (await visibili("manual_entries", "name", 800)).filter((v) => !ps.length || punteggio(`${v.name} ${v.category} ${v.notes} ${v.address}`, ps) > 0).slice(0, 20);
      return { voci: voci.map((v) => ({ codice: codice("v", { tipo: "voce", id: v.id, titolo: s(v.name), sotto: s(v.category) || (v.type === "person" ? "persona" : v.type === "info" ? "informazione" : "negozio") }),
        nome: s(v.name), tipo: v.type === "person" ? "persona" : v.type === "info" ? "informazione" : "negozio o artigiano", categoria: s(v.category),
        telefono: s(v.phone), email: s(v.email), indirizzo: s(v.address), note: s(v.notes).slice(0, 800) })) };
    },
    async lista() {
      if (!hid) return { da_comprare: [], comprate_di_recente: [] };
      const voci = (await db.collection("shopping_items").where("householdId", "==", hid).where("visibility", "==", "shared").orderBy("createdAt", "desc").limit(500).get()).docs.map((d) => d.data());
      return { da_comprare: voci.filter((v) => !v.done).map((v) => `${s(v.text)}${s(v.detail) ? ` (${s(v.detail)})` : ""}`),
        comprate_di_recente: voci.filter((v) => v.done && v.boughtAt).sort((x, y) => ms(y.boughtAt) - ms(x.boughtAt)).slice(0, 25).map((v) => `${s(v.text)} (${giorno(v.boughtAt)})`) };
    },
  };
  return { fonti, esegui, nomi: STRUMENTI.map((t) => t.name) };
}

// ───────────── Il modello ─────────────

export function sistema({ oggi, io = "", altro = "", settimana = false }) {
  return `Sei l'assistente di «Debiti e Doveri», l'app personale e di coppia di ${io || "chi ti scrive"}${altro ? ` e ${altro}` : ""}: diario
con note (anche per progetti, come le lezioni di tennis), spese condivise, task, lista della spesa, manuale di casa con
la rubrica, calendari di Google. Oggi è ${oggi}.

${settimana ? `Scrivi la revisione della settimana appena passata (da lunedì a oggi) per ${io || "la persona"}: cosa è successo
nelle note e nei progetti, i task fatti, quelli fermi o in ritardo, quanto si è speso e se qualcosa spicca rispetto alle
settimane prima, cosa c'è in calendario nei prossimi sette giorni. Breve e utile: al più una dozzina di righe, sezioni
"## " solo per ciò che c'è, niente frasi di circostanza. Se una parte non ha niente, non nominarla.`
    : `Rispondi alla domanda usando gli strumenti per cercare nei dati dell'app: cerca prima di rispondere, e se la prima
ricerca non basta prova con altre parole, un altro periodo o un altro strumento. Non inventare: se non trovi, dillo e
di' dove hai guardato.`}

Come scrivere:
- In italiano, diretto, prima la risposta e poi il resto. Testo semplice: "- " per gli elenchi, "## " per i titoli solo
  se servono, **grassetto** di rado. Niente tabelle.
- Date come «12 ottobre», importi in euro come «42,10 €».
- Accanto a ogni affermazione che viene da una nota, una spesa, un task, un evento o una voce, il suo codice tra
  parentesi quadre, come appare nei risultati: [n3], [s12]. L'app li toglie dal testo e mostra le fonti sotto.
- ${altro ? `Le note, le spese e i task condivisi possono essere di ${altro}: quando conta, dillo.` : "Le cose condivise possono essere dell'altra persona della casa."}
- Non puoi cambiare niente nell'app: se ti chiedono di fare qualcosa (aggiungere un task, segnare una spesa), di' di
  scriverlo in una nota del Diario, che l'assistente del Diario lo propone.`;
}

async function chiamaClaude({ key, model, system, messages, conFallback = true }) {
  // Sforzo «medium»: in un giro con gli strumenti basta e risponde prima (Sonnet di suo andrebbe a «high»).
  const corpo = { model, max_tokens: 16000, system, tools: STRUMENTI, messages, output_config: { effort: "medium" }, ...(conFallback ? { fallbacks: "default" } : {}) };
  const res = await fetch(URL, {
    method: "POST",
    signal: AbortSignal.timeout(ATTESA_CHIAMATA),
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01",
      ...(conFallback ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {}) },
    body: JSON.stringify(corpo),
  }).catch((err) => { throw err.name === "TimeoutError" ? new Error(`Claude: nessuna risposta in ${ATTESA_CHIAMATA / 1000} s`) : err; });
  if (!res.ok) {
    const testo = await res.text();
    // Il ripiego sul modello di riserva (rifiuti) è in beta: se l'API non lo accetta, si chiede senza.
    if (conFallback && res.status === 400 && /fallback/i.test(testo)) return chiamaClaude({ key, model, system, messages, conFallback: false });
    throw new Error(`Claude ${res.status}: ${testo.slice(0, 300)}`);
  }
  return res.json();
}

/** I codici [n3] citati nel testo → le fonti, nell'ordine in cui compaiono; il testo senza codici. */
export function separaFonti(testo, fonti) {
  const usate = [];
  for (const m of String(testo).matchAll(/\[([a-z]\d+)(?:\s*,\s*([a-z]\d+))*\]/g)) {
    for (const c of m[0].slice(1, -1).split(/\s*,\s*/)) if (fonti.has(c) && !usate.includes(c)) usate.push(c);
  }
  const pulito = String(testo).replace(/\s*\[[a-z]\d+(?:\s*,\s*[a-z]\d+)*\]/g, "").replace(/[ \t]+\n/g, "\n").trim();
  return { testo: pulito, fonti: usate.map((c) => ({ ...fonti.get(c), codice: c })) };
}

/**
 * Risponde a una domanda (o scrive la revisione della settimana) con gli strumenti. `domanda` è il testo dell'ultima
 * domanda, `prima` i turni precedenti della stessa conversazione [{ domanda, risposta }]. `passo(etichetta)` a ogni
 * strumento usato. Ritorna { risposta, fonti, modello, uso, giri }.
 */
export async function rispondi({ db, uid, hid, key, modello = MODELLO_PREDEFINITO, domanda, prima = [], settimana = false, tokenGoogle = null, passo = () => {}, contesto }) {
  const model = MODELLI[modello] || MODELLI[MODELLO_PREDEFINITO];
  const { fonti, esegui } = strumentiDi(db, { uid, hid, nomi: contesto.nomi, tokenGoogle, casa: contesto.casa, utente: contesto.utente });
  const storia = prima.filter((t) => t.domanda && t.risposta).slice(-4)
    .map((t) => `<domanda>${t.domanda}</domanda>\n<risposta>${t.risposta}</risposta>`).join("\n");
  const messages = [{ role: "user", content: storia ? `Domande e risposte di prima, in questa conversazione:\n${storia}\n\nNuova domanda: ${domanda}` : domanda }];
  const system = sistema({ oggi: contesto.oggi, io: contesto.io, altro: contesto.altro, settimana });
  const usi = [];
  const t0 = Date.now();
  let ultimo = null;
  for (let giro = 0; giro < GIRI_MAX; giro++) {
    const fuoriTempo = Date.now() - t0 > TEMPO_MAX || giro === GIRI_MAX - 1;
    if (fuoriTempo) messages.push({ role: "user", content: "Basta cercare: rispondi ora con quello che hai trovato, dicendo cosa non hai potuto controllare." });
    const r = await chiamaClaude({ key, model, system, messages });
    usi.push(r.usage || {});
    ultimo = r;
    if (r.stop_reason === "refusal") throw new Error("Claude: richiesta rifiutata");
    // La risposta va rimandata così com'è (anche i blocchi di ragionamento): la conversazione non si riscrive.
    messages.push({ role: "assistant", content: r.content });
    const chiamate = (r.content || []).filter((b) => b.type === "tool_use");
    if (r.stop_reason !== "tool_use" || !chiamate.length || fuoriTempo) break;
    const risultati = await Promise.all(chiamate.map(async (b) => {
      passo(passoDi(b.name, b.input));
      try {
        const fn = esegui[b.name];
        const out = fn ? await fn(b.input || {}) : { errore: `Strumento sconosciuto: ${b.name}` };
        return { type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out) };
      } catch (err) {
        console.warn("chiedi: strumento", b.name, String(err.message).slice(0, 160));
        return { type: "tool_result", tool_use_id: b.id, content: `Non riuscito: ${String(err.message).slice(0, 200)}`, is_error: true };
      }
    }));
    messages.push({ role: "user", content: risultati });
  }
  const testo = (ultimo?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  if (!testo) throw new Error("Claude: risposta vuota");
  const { testo: risposta, fonti: usate } = separaFonti(testo, fonti);
  return { risposta, fonti: usate.slice(0, 12), modello: ultimo?.model || model, uso: somma(usi), giri: usi.length };
}

/** Contesto della persona: casa verificata, nomi, oggi. */
export async function contestoDi(db, uid) {
  const utente = (await db.collection("users").doc(uid).get()).data() || {};
  let hid = utente.householdId || null;
  let casa = {};
  if (hid) {
    const h = await db.collection("households").doc(hid).get();
    casa = h.exists ? h.data() : {};
    if (!(casa.members || []).includes(uid)) { hid = null; casa = {}; } // la casa vale solo se ne è membro
  }
  const nomi = casa.memberNames || {};
  const oggi = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const iso = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());
  const altro = Object.entries(nomi).find(([k]) => k !== uid)?.[1] || "";
  return { utente, hid, casa, nomi, oggi: `${oggi} (${iso})`, io: s(nomi[uid]).split(" ")[0] || s(utente.displayName).split(" ")[0], altro: s(altro).split(" ")[0] };
}

export const modelloDomande = (utente) => (Object.hasOwn(MODELLI, utente?.modelli?.domande || "") ? utente.modelli.domande : MODELLO_PREDEFINITO);

/**
 * La funzione `chiedi`: { id } di una domanda propria, con l'ultima domanda senza risposta. Segna «in corso» (una
 * seconda richiesta intanto non riparte), risponde, scrive risposta e fonti nel turno. Ritorna { fatta } o { giaInCorso }.
 */
export async function chiedi(db, uid, id, { key, clientGoogle = null, passo: registro = () => {} }) {
  const ref = db.collection("domande").doc(String(id || ""));
  const gia = await db.runTransaction(async (t) => {
    const d = await t.get(ref);
    if (!d.exists || d.data().ownerUid !== uid) { const e = new Error("Domanda non trovata"); e.codice = "not-found"; throw e; }
    const x = d.data();
    if (x.stato === "in_corso" && Date.now() - ms(x.inizio) < IN_CORSO_MS) return true;
    t.update(ref, { stato: "in_corso", inizio: FieldValue.serverTimestamp(), passi: [], errore: FieldValue.delete() });
    return false;
  });
  if (gia) return { giaInCorso: true };
  try {
    const x = (await ref.get()).data();
    const turni = Array.isArray(x.turni) ? x.turni : [];
    const ultimo = turni[turni.length - 1];
    if (!s(ultimo?.domanda)) throw new Error("Domanda vuota");
    const contesto = await contestoDi(db, uid);
    let permesso = null;
    const tokenGoogle = () => (permesso ||= import("./google/account.js").then(({ tokenServer }) => tokenServer(db, uid, clientGoogle)));
    const modello = modelloDomande(contesto.utente);
    const passo = (p) => { registro(p); ref.update({ passi: FieldValue.arrayUnion(p) }).catch(() => {}); };
    const r = await rispondi({ db, uid, hid: contesto.hid, key, modello, domanda: s(ultimo.domanda), prima: turni.slice(0, -1),
      settimana: x.tipo === "settimana", tokenGoogle, passo, contesto });
    const { usd } = await registraConsumo(db, uid, x.tipo === "settimana" ? "settimana" : "chiedi", { modello: r.modello, uso: r.uso, chiamate: r.giri });
    registro(`risposta in ${r.giri} giri, ${r.fonti.length} fonti, ${usd.toFixed(4)} $`);
    // Si riscrive l'ultimo turno: l'app intanto non tocca il documento (aspetta lo stato).
    const aggiornati = [...turni.slice(0, -1), { ...ultimo, risposta: r.risposta, fonti: r.fonti, modello, at: new Date() }];
    await ref.update({ turni: aggiornati, stato: "fatta", fine: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return { fatta: true };
  } catch (err) {
    await ref.update({ stato: "errore", errore: String(err.message || err).slice(0, 300), fine: FieldValue.serverTimestamp() }).catch(() => {});
    throw err;
  }
}
