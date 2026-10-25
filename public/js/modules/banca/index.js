// Banca: collegamento del conto tramite Enable Banking (PSD2) e stato della lettura dei movimenti.
// Il consenso si dà sul sito della banca: da qui si sceglie la banca e si parte; al ritorno
// (/banca?code=…, messo da parte in app.js) si conclude il collegamento. Ogni uscita letta dal
// conto diventa una proposta di spesa personale in «Azioni da confermare»: la spesa, se confermata,
// nasce condivisa. Tutto il lavoro con Enable Banking lo fa la function `bank` (functions/index.js).
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-functions.js";
import { db, functions } from "../../core/firebase.js";
import { session } from "../../core/auth.js";
import { el, icon, toast, fab, vuoto, toDate, giornoRelativo, fascia, fmtMoney, fmtDate } from "../../core/ui.js";
import { openSheet } from "../../components/sheet.js";
import { vaiA } from "../../core/router.js";

export const id = "banca";
export const title = "Banca";
export const nav = false;
const navIcon = "banca";
export { navIcon as icon };

const COLL = "bank_connections";
const bank = httpsCallable(functions, "bank", { timeout: 130000 }); // la function ha 120 s
const CHIAVE_RITORNO = "macroapp.banca.ritorno";

/** Esito del ritorno dalla banca messo da parte in app.js; si legge una volta sola. */
function ritornoDallaBanca() {
  try {
    const s = sessionStorage.getItem(CHIAVE_RITORNO);
    if (!s) return null;
    sessionStorage.removeItem(CHIAVE_RITORNO);
    return JSON.parse(s);
  } catch (e) { return null; }
}

const messaggio = (err) => err?.message || err?.code || "Operazione non riuscita";
const minuscola = (s) => s.charAt(0).toLowerCase() + s.slice(1);
/** «oggi», «ieri», «il 25 ottobre». */
const quando = (d) => { const r = giornoRelativo(d); return /^\d/.test(r) ? `il ${r}` : minuscola(r); };
const ora = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Con alcune banche (Intesa) name è l'intestatario, uguale per tutti i conti: il nome si prende
// dal prodotto o dal tipo (cash_account_type).
const TIPI_CONTO = { CACC: "Conto corrente", CARD: "Carta", SVGS: "Conto deposito", LOAN: "Finanziamento", TRAN: "Conto", CASH: "Conto", OTHR: "Altro conto" };
function nomeConto(a) {
  return a.product || a.details || TIPI_CONTO[a.type] || (a.ibanMask ? "Conto" : "Conto senza IBAN");
}
function dettaglioConto(a, nome, stat) {
  const tipo = TIPI_CONTO[a.type];
  // Dall'ultima lettura: quanti movimenti ha dato la banca e quante uscite sono in attesa.
  const letti = stat ? `${stat.letti} ${stat.letti === 1 ? "movimento letto" : "movimenti letti"}` : "";
  const attesa = stat ? Object.entries(stat.stati || {}).filter(([k]) => k.startsWith("DBIT") && !k.endsWith("BOOK")).reduce((n, [, v]) => n + v, 0) : 0;
  return [a.ibanMask || a.idMask, tipo && tipo !== nome ? tipo : "", a.currency && a.currency !== "EUR" ? a.currency : "",
    letti, attesa ? `${attesa} in attesa` : ""].filter(Boolean).join(" · ");
}

// Verso e stato dei movimenti come li dà Enable Banking → parole.
// [singolare, plurale]
const VERSI = { DBIT: ["uscita", "uscite"], CRDT: ["entrata", "entrate"] };
const STATI = { BOOK: ["contabilizzata", "contabilizzate"], PDNG: ["in attesa", "in attesa"], HOLD: ["bloccata", "bloccate"],
  SCHD: ["programmata", "programmate"], INFO: ["informativa", "informative"], OTHR: ["con altro stato", "con altro stato"], "?": ["senza stato", "senza stato"] };
function riassuntoStati(stati = {}) {
  return Object.entries(stati).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => {
      const [v, st] = k.split(" ");
      const i = n === 1 ? 0 : 1;
      return `${n} ${VERSI[v]?.[i] || `movimenti ${v}`} ${STATI[st]?.[i] || `in stato ${st}`}`;
    })
    .join(", ");
}

/** Foglio con gli ultimi movimenti letti di un conto e cosa ne ha fatto l'app: per capire cosa manca. */
function apriDettaglioConto(nome, stat) {
  const ultimi = stat?.ultimi || [];
  openSheet({
    title: nome,
    body: [
      el("p.muted.small", { style: "margin-top:8px" }, stat
        ? `Nell'ultima lettura la banca ha dato ${stat.letti} ${stat.letti === 1 ? "movimento" : "movimenti"}${stat.letti ? `: ${riassuntoStati(stat.stati)}` : ""}.`
        : "Nessuna lettura ancora."),
      ultimi.length ? fascia("Gli ultimi, con l'esito") : stat ? el("p.meta", { style: "margin-top:12px" }, "Tocca «Leggi ora» per vedere qui i singoli movimenti.") : null,
      ...ultimi.map((m) => {
        const contab = m.contabilizzato && m.contabilizzato !== m.giorno ? ` · contabilizzato ${fmtDate(m.contabilizzato)}` : "";
        return el("div.riga", { style: "cursor:default" },
          el("div.testo", {}, el("b", {}, m.descrizione), el("span", { style: "white-space:normal" }, `${m.esito}${contab}`)),
          el(`div.importo.${m.verso === "CRDT" ? "credito" : "neutro"}`, {}, el("b", {}, `${m.verso === "CRDT" ? "+" : ""}${fmtMoney(m.importo)}`), el("small", {}, fmtDate(m.giorno))),
        );
      }),
    ],
  });
}

/** Uscite non ancora contabilizzate (es. acquisti con la carta di ieri): si vedono, ma non sono proposte. */
function inAttesa(lista) {
  if (!lista?.length) return null;
  return el("div", {},
    fascia("In attesa di contabilizzazione"),
    el("p.meta", { style: "margin-bottom:2px" }, "Diventano proposte quando la banca le contabilizza: prima l'importo può ancora cambiare."),
    ...lista.map((x) => el("div.riga", { style: "cursor:default" },
      el("div.testo", {}, el("b", {}, x.descrizione), el("span", {}, x.conto)),
      el("div.importo.neutro", {}, el("b", {}, fmtMoney(x.importo)), el("small", {}, fmtDate(x.giorno))),
    )),
  );
}

/** Uscite lette ma non proposte (saldo della carta, giroconti), col motivo: per controllare le regole. */
function scartati(lista) {
  if (!lista?.length) return null;
  return el("div", {},
    fascia("Scartati, non sono spese"),
    ...lista.slice(0, 6).map((x) => el("div.riga", { style: "cursor:default" },
      el("div.testo", {}, el("b", {}, x.descrizione), el("span", {}, x.motivo)),
      el("div.importo.neutro", {}, el("b", {}, fmtMoney(x.importo)), el("small", {}, fmtDate(x.giorno))),
    )),
  );
}

/** La banca ha chiuso il consenso prima della scadenza (vedi sessioneChiusa in enable.js). */
const interrotto = (c) => !!c?.needsRenewal || /EXPIRED_SESSION/.test(c?.lastError || "");

/** Riga sul consenso: quanto vale ancora, con avviso quando sta per scadere. */
function consenso(c) {
  const d = toDate(c.consentExpiresAt);
  if (!d) return null;
  const giorni = Math.ceil((d - Date.now()) / 86400e3);
  if (giorni < 0) return { testo: "Consenso scaduto: rinnovalo per riprendere la lettura", tardi: true };
  if (giorni === 0) return { testo: "Il consenso scade oggi", tardi: true };
  if (giorni <= 14) return { testo: `Il consenso scade tra ${giorni} giorni, ${minuscola(giornoRelativo(d))}`, tardi: true };
  return { testo: `Consenso valido fino al ${minuscola(giornoRelativo(d))}`, tardi: false };
}

/** Chiede alla function l'url del consenso e ci manda l'utente. Ritorna false se non ci riesce. */
async function avviaConsenso(aspsp) {
  try {
    const res = await bank({ azione: "avvia", aspsp: { name: aspsp.name, country: aspsp.country }, ritorno: location.origin });
    location.assign(res.data.url);
    return true;
  } catch (err) {
    console.warn("banca avvia", err);
    toast(messaggio(err), { ms: 8000 });
    return false;
  }
}

/** Foglio con l'elenco delle banche italiane: toccarne una avvia il consenso. */
async function apriScelta() {
  const cerca = el("input.linea-input", { placeholder: "Cerca la tua banca", autofocus: true, autocomplete: "off", enterkeyhint: "search", style: "margin-top:12px" });
  const elenco = el("div", {}, el("p.meta", { style: "padding:16px 0" }, "Leggo l'elenco delle banche…"));
  let banche = [];
  let inCorso = false;

  async function scegli(b) {
    if (inCorso) return;
    inCorso = true;
    elenco.replaceChildren(el("p.meta", { style: "padding:16px 0" }, `Apro la pagina di ${b.name}…`));
    if (!(await avviaConsenso(b))) { inCorso = false; disegna(); }
  }
  function disegna() {
    const q = norm(cerca.value.trim());
    const viste = banche.filter((b) => !q || norm(b.name).includes(q)).slice(0, 80);
    elenco.replaceChildren(...(viste.length
      ? viste.map((b) => el("div.riga", { onclick: () => scegli(b) },
          el("div.pallino", {}, icon("banca")),
          el("div.testo", {}, el("b", {}, b.name), b.beta ? el("span", {}, "In prova su Enable Banking") : null),
          icon("freccia", "freccia-riga"),
        ))
      : [vuoto("Nessuna banca", q ? "Prova con un altro nome." : "Enable Banking non ha restituito banche.")]));
  }
  cerca.addEventListener("input", disegna);

  openSheet({
    title: "Scegli la banca",
    body: [
      el("p.muted.small", { style: "margin-top:8px" }, "Darai il consenso sul sito della banca e tornerai qui. Il consenso vale fino a 180 giorni, secondo la banca, poi si rinnova."),
      cerca, elenco,
    ],
  });
  try {
    const res = await bank({ azione: "banche", country: "IT" });
    banche = res.data?.banche || [];
    disegna();
  } catch (err) {
    console.warn("banca elenco", err);
    elenco.replaceChildren(el("p.errore", { style: "margin-top:14px" }, messaggio(err)));
  }
}

/** Foglio di conferma per scollegare: l'azione principale sta in basso a destra, come sempre. */
function apriScollega(c, dopo) {
  openSheet({
    title: "Scollega la banca",
    confirmLabel: "Scollega",
    body: [
      el("p", { style: "margin-top:14px;line-height:1.45" }, `Chiude il consenso dato a ${c.aspsp?.name || "la banca"}. Le proposte di spesa già create restano; per ricollegarla darai di nuovo il consenso.`),
    ],
    onConfirm: async () => {
      try { await bank({ azione: "scollega" }); toast("Banca scollegata"); dopo?.(); }
      catch (err) { toast(messaggio(err), { ms: 8000 }); return false; }
    },
  });
}

export function mount(container) {
  const uid = session.user.uid;
  let c = null;              // bank_connections/{uid}, o null
  let caricato = false;      // prima risposta di Firestore arrivata
  let concludendo = false;   // POST /sessions in corso dopo il ritorno dalla banca
  let erroreRitorno = null;  // esito negativo del ritorno, da mostrare finché non si riparte
  let leggendo = false;

  const corpo = el("div");
  const piu = fab("Collega una banca", apriScelta);
  // Consenso chiuso dalla banca: l'azione principale è rinnovarlo, in basso a destra come il +.
  const rinnovaFab = el("button.fab", { type: "button", "aria-label": "Rinnova il consenso", onclick: async () => {
    rinnovaFab.disabled = true;
    if (!(await avviaConsenso(c.aspsp))) rinnovaFab.disabled = false;
  } }, icon("collegamento"), "Rinnova il consenso");
  const mostra = (...nodi) => corpo.replaceChildren(...nodi.filter(Boolean)); // replaceChildren non salta i null come el()

  function render() {
    const attiva = !!c?.active;
    const fermo = attiva && interrotto(c);
    piu.hidden = attiva || concludendo || !caricato;
    rinnovaFab.hidden = !fermo || concludendo || !caricato;
    if (!caricato) { mostra(); return; }

    if (concludendo) {
      mostra(vuoto("Collego la banca…", "Chiedo alla banca i conti autorizzati."));
      return;
    }

    if (!attiva) {
      mostra(
        erroreRitorno ? el("p.errore", { style: "margin-top:16px" }, erroreRitorno) : null,
        vuoto("Nessuna banca collegata", "Le uscite del tuo conto diventano proposte di spesa, da confermare una per una. Tocca + per collegare la banca."),
        el("div.blocco", {},
          el("h3", {}, "Come funziona"),
          el("p", {}, "Il consenso lo dai sul sito della tua banca (PSD2, tramite Enable Banking) e vale fino a 180 giorni, secondo la banca. Ogni mattina l'app legge le uscite degli ultimi giorni: ciascuna compare in «Azioni da confermare», che vedi solo tu. Quelle che confermi diventano spese condivise."),
        ),
        c?.pending?.aspsp ? el("p.meta", { style: "margin-top:12px" }, `Collegamento con ${c.pending.aspsp.name} avviato e non concluso: puoi ricominciare da +.`) : null,
      );
      return;
    }

    const cons = fermo ? null : consenso(c);
    const chiusoIl = toDate(c.sessionEndedAt) || toDate(c.lastSyncAt);
    const ultima = toDate(c.lastSyncAt);
    const conti = c.accounts?.length ? c.accounts : (c.accountIds || []).map((uid) => ({ uid, name: "Conto" }));
    const leggi = el("button.pillola", { type: "button", disabled: leggendo, onclick: leggiOra }, icon("ripeti"), leggendo ? "Leggo…" : "Leggi ora");
    const rinnova = el("button.btn", { type: "button", onclick: async () => { rinnova.disabled = true; if (!(await avviaConsenso(c.aspsp))) rinnova.disabled = false; } }, icon("collegamento"), "Rinnova il consenso");

    mostra(
      el("div.blocco", {},
        el("h3", {}, c.aspsp?.name || "Banca"),
        cons ? el("p", { style: cons.tardi ? "color:var(--frutto)" : null }, cons.testo) : null,
        fermo ? el("p", { style: "color:var(--frutto)" }, `Collegamento interrotto${chiusoIl ? ` ${quando(chiusoIl)}` : ""}: la banca ha chiuso il consenso prima della scadenza. La lettura è ferma finché non lo rinnovi.`) : null,
        el("div", {}, ...conti.map((a) => {
          const nome = nomeConto(a);
          const stat = (c.lettura?.conti || []).find((r) => r.uid === a.uid);
          return el("div.riga", { onclick: () => apriDettaglioConto(nome, stat) },
            el("div.pallino", {}, icon("banca")),
            el("div.testo", {}, el("b", {}, nome), el("span", {}, dettaglioConto(a, nome, stat) || "\u00a0")),
            icon("freccia", "freccia-riga"),
          );
        })),
      ),
      el("div.blocco", {},
        el("h3", {}, "Movimenti"),
        el("p", {}, "Letti ogni mattina alle 7:15: ogni uscita diventa una proposta di spesa, che vedi solo tu. Della carta di credito si leggono gli acquisti uno per uno; il suo addebito mensile sul conto si scarta."),
        el("p.meta", {}, fermo
          ? "Lettura sospesa: riprende dopo il rinnovo."
          : ultima
          ? `Ultima lettura ${minuscola(giornoRelativo(ultima))} alle ${ora(ultima)}${c.lastSyncCreated != null ? ` · ${c.lastSyncCreated} ${c.lastSyncCreated === 1 ? "proposta nuova" : "proposte nuove"}` : ""}`
          : "Nessuna lettura ancora"),
        c.lastError && !fermo ? el("p.errore", { style: "margin-top:10px" }, c.lastError) : null,
        el("div.segmenti", {},
          fermo ? null : leggi,
          el("button.pillola", { type: "button", onclick: () => vaiA("proposte") }, icon("scintilla"), "Azioni da confermare"),
        ),
        fermo ? null : inAttesa(c.lettura?.inAttesa),
        scartati(c.scartati),
      ),
      el("div.blocco", {},
        el("h3", {}, "Consenso"),
        el("p", {}, "Rinnovarlo apre di nuovo il sito della banca; scollegare chiude il consenso. Un collegamento nuovo alla stessa banca, anche dal pannello di Enable Banking, chiude quello di qui."),
        el("div.segmenti", {},
          fermo ? null : rinnova,
          el("button.btn.btn--pericolo", { type: "button", onclick: () => apriScollega(c) }, icon("chiudi"), "Scollega"),
        ),
      ),
    );
  }

  async function leggiOra() {
    if (leggendo) return;
    leggendo = true; render();
    try {
      const res = await bank({ azione: "sincronizza" });
      const n = res.data?.created ?? 0;
      toast(n ? `${n} ${n === 1 ? "movimento nuovo" : "movimenti nuovi"} in «Azioni da confermare»` : "Nessun movimento nuovo", { ms: 5000 });
    } catch (err) {
      console.warn("banca sincronizza", err);
      toast(messaggio(err), { ms: 8000 });
    } finally { leggendo = false; render(); }
  }

  // Ritorno dalla banca: il codice va scambiato subito con la sessione.
  async function concludi(r) {
    if (r.error) {
      erroreRitorno = r.error === "access_denied" ? "Collegamento annullato sulla pagina della banca." : `La banca ha risposto con un errore: ${r.description || r.error}`;
      render();
      return;
    }
    concludendo = true; render();
    try {
      const res = await bank({ azione: "concludi", code: r.code, state: r.state });
      const n = res.data?.accounts?.length || 0;
      toast(`Banca collegata: ${n} ${n === 1 ? "conto" : "conti"}`, { ms: 5000 });
      erroreRitorno = null;
    } catch (err) {
      console.warn("banca concludi", err);
      erroreRitorno = messaggio(err);
    } finally { concludendo = false; render(); }
  }

  container.append(corpo, piu, rinnovaFab);
  const stop = onSnapshot(doc(db, COLL, uid), (snap) => {
    c = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    caricato = true;
    render();
  }, (err) => { console.error("bank_connections", err); caricato = true; render(); });

  const r = ritornoDallaBanca();
  if (r) concludi(r);

  return () => { stop(); piu.remove(); rinnovaFab.remove(); };
}
