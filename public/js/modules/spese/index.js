// Spese condivise, sul modello di Splitwise.
//
// expenses            { description, amount, paidBy, split: "equal"|"full", date, category,
//                       source: "manual"|"recurring"|"bank"|"agent", type?: "settlement", recurringId? }
// recurring_expenses  { description, amount, paidBy, split, every: "week"|"month"|"year", nextDate, active }
//
// split "equal" = metà a testa; "full" = tutta a carico di chi NON ha pagato.
// Il saldo è la somma, spesa per spesa, di quanto l'altro deve a te (positivo) o tu a lui (negativo).
// Le ricorrenti generano la spesa alla data dovuta, con un id fisso (rec_<id>_<giorno>):
// se entrambi i telefoni ci provano, la seconda volta non succede niente.
import {
  el, icon, iconaDa, toast, fascia, vuoto, toDate, fmtMoney, parseImporto, meseBreve, meseLungo,
  isoGiorno, stessoGiorno, fmtDate, fab, attesa,
} from "../../core/ui.js";
import { create, createWithId, update, remove, watchVisible, readVisible, VIS } from "../../core/db.js";
import { session } from "../../core/auth.js";
import { getHousehold, nomeDi } from "../../core/household.js";
import { openSheet } from "../../components/sheet.js";
import { richiesto } from "../../core/router.js";

export const id = "spese";
export const title = "Spese";
export const nav = true;
const navIcon = "spese";
export { navIcon as icon };

const COLL = "expenses";
const REC = "recurring_expenses";

const CATEGORIE = [
  [/luce|enel|elettric|energia/, "lampadina"],
  [/\bgas\b|metano|gpl|riscaldament|pellet|legna/, "fiamma"],
  [/internet|fibra|wi-?fi|adsl|\btim\b|fastweb|vodafone|iliad|windtre|telefon/, "wifi"],
  [/mutuo|affitto|condomin|\bimu\b|\btari\b|rifiuti/, "casa"],
  [/spes|esselunga|coop|conad|carrefour|lidl|eurospin|\bpam\b|supermerc|mercato|alimentari|forno/, "carrello"],
  [/benzin|carburant|diesel|gasolio|autostrad|pedagg|parchegg/, "carburante"],
  [/\bauto\b|macchina|meccanic|gomme|assicuraz|bollo|revision|tagliando/, "macchina"],
  [/now ?tv|netflix|spotify|disney|prime video|dazn|\bsky\b|abbonament|youtube/, "schermo"],
  [/multa|sanzion/, "avviso"],
  [/ristorant|pizz|cena|pranzo|aperitiv|\bbar\b|caff[eè]|sushi|trattoria|osteria|gelat/, "forchetta"],
  [/farmac|medic|dentist|visita|ticket|analisi|ottic/, "salute"],
  [/regal/, "regalo"],
  [/viagg|treno|volo|aereo|hotel|albergo|b&b|airbnb|vacanz|bigliett/, "valigia"],
  [/acqua|acquedott/, "goccia"],
  [/veterin|\bcane\b|gatto|crocchett/, "zampa"],
  [/giardin|piante|vivaio|\borto\b|terriccio/, "foglia"],
];
export const categoria = (desc) => iconaDa(desc, CATEGORIE, "scontrino");

const PERIODI = [["", "Non si ripete"], ["week", "Ogni settimana"], ["month", "Ogni mese"], ["year", "Ogni anno"]];
const nomePeriodo = (v) => (PERIODI.find(([k]) => k === v) || PERIODI[0])[1];

function avanza(d, every) {
  const n = new Date(d);
  if (every === "week") n.setDate(n.getDate() + 7);
  else if (every === "year") n.setFullYear(n.getFullYear() + 1);
  else n.setMonth(n.getMonth() + 1);
  return n;
}

/** Mezzogiorno del giorno scelto: evita che il fuso orario sposti la data al giorno prima. */
function aMezzogiorno(isoOrDate) {
  const d = typeof isoOrDate === "string" ? new Date(`${isoOrDate}T12:00:00`) : new Date(isoOrDate);
  d.setHours(12, 0, 0, 0);
  return d;
}

const quota = (e) => (e.split === "full" ? e.amount : e.amount / 2);

/** Quanto l'altra persona deve a me (positivo) o io a lei (negativo). */
export function saldo(spese, me) {
  return spese.reduce((s, e) => s + (e.paidBy === me ? quota(e) : -quota(e)), 0);
}

/** Genera le spese ricorrenti arrivate a scadenza. Chiamata all'avvio dell'app. */
export async function materializeRecurring() {
  const fine = new Date(); fine.setHours(23, 59, 59, 999);
  const modelli = await readVisible(REC, { order: ["createdAt", "desc"] });
  for (const t of modelli.filter((m) => m.active !== false)) {
    let next = toDate(t.nextDate);
    if (!next) continue;
    let giri = 0;
    while (next <= fine && giri < 36) {
      await createWithId(COLL, `rec_${t.id}_${isoGiorno(next)}`, {
        description: t.description, amount: t.amount, paidBy: t.paidBy, split: t.split,
        date: next, category: categoria(t.description), source: "recurring", recurringId: t.id,
      }).catch((e) => console.warn("ricorrente", e.code || e));
      next = avanza(next, t.every);
      giri++;
    }
    if (giri) update(REC, t.id, { nextDate: next });
  }
}

// ───────────── Modi di divisione ─────────────

function modi(altro) {
  return [
    { key: "me_equal", paidBy: "me", split: "equal", label: "Pagato da te e diviso in parti uguali" },
    { key: "me_full", paidBy: "me", split: "full", label: `Pagato da te, tutto a carico di ${altro.nome}` },
    { key: "other_equal", paidBy: "other", split: "equal", label: `Pagato da ${altro.nome} e diviso in parti uguali` },
    { key: "other_full", paidBy: "other", split: "full", label: `Pagato da ${altro.nome}, tutto a tuo carico` },
  ];
}

function modoDi(e, me) {
  return `${e.paidBy === me ? "me" : "other"}_${e.split === "full" ? "full" : "equal"}`;
}

// ───────────── Fogli ─────────────

/**
 * Foglio della spesa, nuovo o in modifica. Esportato: lo usa anche il diario.
 * prefill: { description, amount }
 */
export async function apriSpesa(esistente = null, prefill = {}) {
  const me = session.user.uid;
  const h = await getHousehold();
  const altroUid = h?.members?.find((m) => m !== me) || "altro";
  const altro = { uid: altroUid, nome: nomeDi(altroUid, h) };
  const elenco = modi(altro);
  let modo = esistente ? modoDi(esistente, me) : "me_equal";
  let quando = esistente ? toDate(esistente.date) || new Date() : new Date();
  let ripeti = "";

  const riquadro = el("div.riquadro", {}, icon(categoria(esistente?.description || prefill.description)));
  const desc = el("input.linea-input", {
    placeholder: "Descrizione", value: esistente?.description || prefill.description || "",
    autofocus: true, enterkeyhint: "next", autocomplete: "off",
  });
  const imp = el("input.linea-input.enorme", {
    placeholder: "0,00", inputmode: "decimal", enterkeyhint: "done", autocomplete: "off",
    value: esistente ? String(esistente.amount).replace(".", ",") : (prefill.amount ? String(prefill.amount).replace(".", ",") : ""),
  });
  desc.addEventListener("input", () => riquadro.replaceChildren(icon(categoria(desc.value))));
  desc.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); imp.focus(); } });
  imp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sheet.confirm(); } });

  const modoBtn = el("button.pillola", { type: "button", style: "margin:4px auto 0;display:flex" });
  const disegnaModo = () => { modoBtn.textContent = elenco.find((m) => m.key === modo).label; };
  modoBtn.addEventListener("click", () => {
    const i = elenco.findIndex((m) => m.key === modo);
    modo = elenco[(i + 1) % elenco.length].key;
    disegnaModo();
  });
  disegnaModo();

  const dataInput = el("input", { type: "date", value: isoGiorno(quando), style: "position:absolute;opacity:0;pointer-events:none;width:1px;height:1px" });
  const dataBtn = el("button.pillola", { type: "button" });
  const disegnaData = () => {
    dataBtn.replaceChildren(icon("calendario"), stessoGiorno(quando, new Date()) ? "Oggi" : fmtDate(quando));
  };
  dataBtn.addEventListener("click", () => { try { dataInput.showPicker(); } catch (e) { dataInput.style.pointerEvents = "auto"; dataInput.focus(); } });
  dataInput.addEventListener("change", () => { if (dataInput.value) { quando = aMezzogiorno(dataInput.value); disegnaData(); } });
  disegnaData();

  const ripetiSel = el("select.pillola", { "aria-label": "Ripeti" },
    ...PERIODI.map(([v, l]) => el("option", { value: v }, l)));
  ripetiSel.addEventListener("change", () => { ripeti = ripetiSel.value; });

  const sheet = openSheet({
    title: esistente ? "Modifica spesa" : "Aggiungi spesa",
    body: [
      el("p.meta", { style: "margin-top:10px" }, `Con te e ${altro.nome}`),
      el("div.campo-grande", {}, riquadro, desc),
      el("div.campo-grande", {}, el("div.riquadro", {}, "€"), imp),
      modoBtn,
      el("div.segmenti", { style: "justify-content:center;margin-top:18px;position:relative" },
        dataBtn, dataInput, esistente?.recurringId ? el("span.pillola", {}, icon("ripeti"), "Ricorrente") : (esistente ? null : ripetiSel)),
      esistente ? el("div.foglio__piede", {},
        el("button.btn.btn--pericolo", { onclick: () => { remove(COLL, esistente.id); sheet.close(); toast("Spesa eliminata"); } }, icon("cestino"), "Elimina"),
      ) : null,
    ],
    onConfirm: () => {
      const amount = Math.round(parseImporto(imp.value) * 100) / 100;
      const description = desc.value.trim();
      if (!description) { desc.focus(); toast("Manca la descrizione"); return false; }
      if (!(amount > 0)) { imp.focus(); toast("Manca l'importo"); return false; }
      const m = elenco.find((x) => x.key === modo);
      const dati = {
        description, amount, split: m.split, paidBy: m.paidBy === "me" ? me : altro.uid,
        date: aMezzogiorno(quando), category: categoria(description),
      };
      if (esistente) { update(COLL, esistente.id, dati); return; }
      let recurringId = null;
      if (ripeti) {
        recurringId = create(REC, { ...dati, every: ripeti, nextDate: avanza(dati.date, ripeti), active: true }, VIS.SHARED).id;
      }
      create(COLL, { ...dati, source: "manual", ...(recurringId ? { recurringId } : {}) }, VIS.SHARED);
      toast(ripeti ? `Spesa aggiunta · ${nomePeriodo(ripeti).toLowerCase()}` : "Spesa aggiunta");
    },
  });
}

function apriPareggio(netto, altro) {
  const tuDevi = netto < 0;
  const imp = el("input.linea-input.enorme", { value: Math.abs(netto).toFixed(2).replace(".", ","), inputmode: "decimal", autofocus: true });
  openSheet({
    title: "Pareggia",
    body: [
      el("p", { style: "margin-top:14px" }, tuDevi ? `Registra che hai dato a ${altro.nome}:` : `Registra che ${altro.nome} ti ha dato:`),
      el("div.campo-grande", {}, el("div.riquadro", {}, "€"), imp),
      el("p.meta", {}, "Il saldo torna a zero se l'importo è quello pieno. Puoi anche registrare una parte."),
    ],
    onConfirm: () => {
      const amount = Math.round(parseImporto(imp.value) * 100) / 100;
      if (!(amount > 0)) return false;
      // Chi paga il debito "anticipa" una spesa tutta a carico dell'altro: il saldo si compensa.
      create(COLL, {
        type: "settlement", description: "Pareggio", amount, split: "full",
        paidBy: tuDevi ? session.user.uid : altro.uid, date: new Date(), category: "scambio", source: "manual",
      }, VIS.SHARED);
      toast("Pareggio registrato");
    },
    confirmLabel: "Registra",
  });
}

function apriRicorrenti(modelli, h) {
  const me = session.user.uid;
  const righe = modelli.length
    ? modelli.map((t) => el("div.riga", { onclick: () => apriModello(t, h) },
        el("div.pallino", {}, icon(categoria(t.description))),
        el("div.testo", {},
          el("b", {}, t.description),
          el("span", {}, `${nomePeriodo(t.every)} · ${t.active === false ? "interrotta" : "prossima " + fmtDate(t.nextDate)} · ${t.paidBy === me ? "paghi tu" : "paga " + nomeDi(t.paidBy, h)}`),
        ),
        el("div.importo", {}, el("b", {}, fmtMoney(t.amount))),
      ))
    : [vuoto("Nessuna spesa ricorrente", "Quando aggiungi una spesa, scegli «Ogni mese» per farla ripetere da sola.")];
  openSheet({ title: "Ricorrenti", body: righe });
}

function apriModello(t, h) {
  const imp = el("input.linea-input.enorme", { value: String(t.amount).replace(".", ","), inputmode: "decimal" });
  const desc = el("input.linea-input", { value: t.description });
  const sheet = openSheet({
    title: "Spesa ricorrente",
    body: [
      el("div.campo-grande", {}, el("div.riquadro", {}, icon(categoria(t.description))), desc),
      el("div.campo-grande", {}, el("div.riquadro", {}, "€"), imp),
      el("p.meta", {}, `${nomePeriodo(t.every)} · prossima ${fmtDate(t.nextDate)}. Le modifiche valgono dalle prossime.`),
      el("div.foglio__piede", {},
        el("button.btn.btn--pericolo", { onclick: () => { remove(REC, t.id); sheet.close(); toast("Ricorrente interrotta"); } }, icon("cestino"), "Interrompi"),
      ),
    ],
    onConfirm: () => {
      const amount = Math.round(parseImporto(imp.value) * 100) / 100;
      if (!(amount > 0) || !desc.value.trim()) return false;
      update(REC, t.id, { amount, description: desc.value.trim() });
    },
  });
}

// ───────────── Vista ─────────────

function riga(e, me, h) {
  const d = toDate(e.date) || toDate(e.createdAt) || new Date();
  const mio = e.paidBy === me;
  const altro = nomeDi(mio ? null : e.paidBy, h);
  if (e.type === "settlement") {
    return el("div.riga", { onclick: () => apriSpesa(e) },
      el("div.data-col", {}, el("small", {}, meseBreve(d)), el("b", {}, d.getDate())),
      el("div.pallino.pallino--accento", {}, icon("scambio")),
      el("div.testo", {}, el("b", {}, "Pareggio"),
        el("span", {}, mio ? `Hai dato ${fmtMoney(e.amount)}` : `${cap(altro)} ti ha dato ${fmtMoney(e.amount)}`)),
      el("div.importo.neutro", {}, el("small", {}, "pareggio"), el("b", {}, fmtMoney(e.amount))),
    );
  }
  return el("div.riga", { onclick: () => apriSpesa(e) },
    el("div.data-col", {}, el("small", {}, meseBreve(d)), el("b", {}, d.getDate())),
    el("div.pallino", {}, icon(e.category || categoria(e.description))),
    el("div.testo", {},
      el("b", {}, e.description, e.recurringId ? " " : null, e.recurringId ? icon("ripeti", "mini") : null),
      el("span", {}, mio ? `Hai pagato ${fmtMoney(e.amount)}` : `${cap(altro)} ha pagato ${fmtMoney(e.amount)}`),
    ),
    el(`div.importo.${mio ? "credito" : "debito"}`, {},
      el("small", {}, mio ? "hai prestato" : "devi restituire"),
      el("b", {}, fmtMoney(quota(e))),
    ),
  );
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function mount(container) {
  const me = session.user.uid;
  let spese = [];
  let modelli = [];
  let h = null;
  // Saldo, ricorrenti e nomi compaiono insieme; senza le spese non si dice nulla (né «in pari» né «Nessuna spesa»).
  const dati = attesa(["spese", "modelli", "casa"], () => render());

  const testa = el("div");
  const elenco = el("div");
  const piu = fab("Aggiungi spesa", () => apriSpesa());

  function render() {
    if (!dati.pronta() || !dati.ha("spese")) return;
    const netto = Math.round(saldo(spese, me) * 100) / 100;
    const altroUid = h?.members?.find((m) => m !== me);
    const altro = { uid: altroUid || "altro", nome: nomeDi(altroUid, h) };
    const Nome = cap(altro.nome);

    testa.replaceChildren(
      el("div.saldo", {},
        netto === 0
          ? el("p", {}, `Tu e ${altro.nome} siete in pari`)
          : el("p", {}, netto > 0 ? `${Nome} ti deve` : `Devi a ${altro.nome}`),
        netto === 0 ? null : el(`div.cifra.${netto > 0 ? "credito" : "debito"}`, {}, fmtMoney(Math.abs(netto))),
      ),
      el("div.segmenti", {},
        netto !== 0 ? el("button.pillola.on", { onclick: () => apriPareggio(netto, altro) }, icon("scambio"), "Pareggia") : null,
        el("button.pillola", { onclick: () => apriRicorrenti(modelli, h) }, icon("ripeti"), `Ricorrenti${modelli.length ? " · " + modelli.length : ""}`),
      ),
    );

    if (!spese.length) { elenco.replaceChildren(vuoto("Nessuna spesa", "Tocca + per aggiungerne una.")); return; }
    const gruppi = new Map();
    for (const e of spese) {
      const d = toDate(e.date) || toDate(e.createdAt) || new Date();
      const k = meseLungo(d);
      if (!gruppi.has(k)) gruppi.set(k, []);
      gruppi.get(k).push(e);
    }
    const nodi = [];
    for (const [mese, lista] of gruppi) {
      nodi.push(fascia(mese));
      nodi.push(el("div", {}, ...lista.map((e) => riga(e, me, h))));
    }
    elenco.replaceChildren(...nodi);
  }

  container.append(testa, elenco, piu);
  getHousehold().then((x) => { h = x; dati.arriva("casa"); render(); });
  // Dal menu: «Spese ricorrenti» apre subito il foglio.
  if (richiesto("spese", "ricorrenti")) {
    Promise.all([readVisible(REC, { order: ["createdAt", "desc"] }), getHousehold()]).then(([m, x]) => apriRicorrenti(m, x));
  }
  const stop1 = watchVisible(COLL, { order: ["date", "desc"], max: 400 }, (docs) => { spese = docs; dati.arriva("spese"); render(); });
  const stop2 = watchVisible(REC, { order: ["createdAt", "desc"] }, (docs) => { modelli = docs; dati.arriva("modelli"); render(); });
  return () => { stop1(); stop2(); dati.ferma(); piu.remove(); };
}
