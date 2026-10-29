// Foglio: pannello a tutta altezza per inserire o modificare qualcosa.
// In alto solo freccia indietro e titolo (servono a orientarsi). In basso una barra fissa con
// le azioni: a sinistra le secondarie (Elimina…), a destra la principale (Salva), sotto il
// pollice destro. Quando si apre la tastiera la barra le sta sopra.
// Il tasto indietro del telefono chiude il foglio invece di uscire dalla pagina.
// Movimento come in Leghe Fantacalcio (animazioni in base.css): si apre sfumando, si chiude con
// una dissolvenza breve; un foglio che ne sostituisce un altro cambia solo il contenuto.
import { el, icon } from "../core/ui.js";

let current = null;
let chiusura = null; // foglio che sta svanendo: { finisci }

const riduci = window.matchMedia?.("(prefers-reduced-motion: reduce)");
const MODI = ["foglio--entra", "foglio--sostituisce", "foglio--chiude"];

// Fa ripartire da capo un'animazione: toglie le classi, ricalcola lo stile, mette quella nuova.
function anima(host, classe) {
  host.classList.remove(...MODI);
  if (!classe) return;
  void host.offsetWidth;
  host.classList.add(classe);
}

// Altezza della tastiera dove il browser non ridimensiona la pagina da solo (iOS):
// la barra in basso si alza di quanto la copre. Su Android ci pensa interactive-widget
// nel meta viewport e il valore resta 0.
function seguiTastiera(host) {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  const aggiorna = () => {
    const coperto = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    host.style.setProperty("--tastiera", `${Math.round(coperto)}px`);
  };
  vv.addEventListener("resize", aggiorna);
  vv.addEventListener("scroll", aggiorna);
  aggiorna();
  return () => {
    vv.removeEventListener("resize", aggiorna);
    vv.removeEventListener("scroll", aggiorna);
    host.style.removeProperty("--tastiera");
  };
}

// Campi su più righe alti quanto il loro testo, così una nota lunga si legge scorrendo il foglio
// e non dentro una finestrella. Lo fa il CSS (field-sizing: content); qui solo dove manca (Safari).
const CAMPI_ALTI = !window.CSS?.supports?.("field-sizing", "content");
function altezzaDelTesto(area, corpo) {
  const adatta = () => {
    if (!area.isConnected) return;
    const s = getComputedStyle(area);
    const bordi = parseFloat(s.borderTopWidth) + parseFloat(s.borderBottomWidth);
    const sopra = corpo.scrollTop; // l'altezza «auto» di un attimo farebbe saltare il foglio
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight + bordi}px`;
    corpo.scrollTop = sopra;
  };
  area.addEventListener("input", adatta);
  // Alla comparsa e quando cambia la larghezza (le righe vanno a capo altrove); non sull'altezza,
  // che cambia adatta stesso.
  let larghezza = -1;
  new ResizeObserver(([r]) => {
    if (r.contentRect.width === larghezza) return;
    larghezza = r.contentRect.width;
    adatta();
  }).observe(area);
}

/**
 * openSheet({ title, body: Node|Node[], onConfirm, confirmLabel, azioni })
 * onConfirm: async () => boolean|void; false lascia il foglio aperto (es. campo mancante).
 * confirmLabel: testo del pulsante principale (predefinito «Salva»).
 * azioni: pulsanti secondari per la barra in basso, a sinistra. Anche un div.foglio__piede
 * dentro il corpo finisce lì: è il modo in cui i fogli segnano le loro azioni secondarie.
 * Senza onConfirm né azioni la barra non c'è (fogli di sola consultazione).
 * stessoFoglio: sostituisce il foglio aperto senza dissolvenza, perché è lo stesso foglio che riceve
 * i suoi dati (attesa → scheda del prodotto): niente dissolvenze sull'arrivo dei dati.
 * Ritorna { close, confirm, aperto } (aperto() = non ancora chiuso né sostituito).
 */
export function openSheet({ title, body, onConfirm, confirmLabel = "Salva", azioni = [], stessoFoglio = false }) {
  // Un foglio che ne sostituisce un altro (es. dalle ricorrenti al singolo modello) riusa la
  // stessa voce della cronologia: tornare indietro con history.back() farebbe arrivare il
  // popstate al foglio nuovo, che si chiuderebbe da solo.
  const sostituisce = !!current;
  // Per il movimento vale come sostituzione anche un foglio appena chiuso che sta ancora svanendo
  // (chiudi e apri il successivo nello stesso gesto): niente lampo della pagina in mezzo.
  // La cronologia invece segue solo `sostituisce`.
  const fondoPieno = sostituisce || !!chiusura;
  if (current) current.close({ fromHistory: true, subito: true });
  chiusura?.finisci();
  const host = document.getElementById("foglio");
  let closed = false;

  const corpo = el("div.foglio__corpo", {}, ...[].concat(body));
  const secondarie = [...[].concat(azioni).filter(Boolean)];
  corpo.querySelectorAll(".foglio__piede").forEach((p) => { secondarie.push(...p.children); p.remove(); });
  if (CAMPI_ALTI) corpo.querySelectorAll("textarea").forEach((a) => altezzaDelTesto(a, corpo));

  const confirmBtn = onConfirm
    ? el("button.btn.btn--accento.btn--conferma", { type: "button", onclick: confirm }, icon("spunta"), confirmLabel)
    : null;
  const barra = confirmBtn || secondarie.length
    ? el("div.foglio__barra", {}, el("div.foglio__secondarie", {}, ...secondarie), confirmBtn)
    : null;

  async function confirm() {
    if (!onConfirm) return;
    confirmBtn.disabled = true;
    try {
      const ok = await onConfirm();
      if (ok !== false) close();
    } finally {
      confirmBtn.disabled = false;
    }
  }

  let smettiTastiera = () => {};
  function svuota() {
    anima(host, null);
    host.hidden = true;
    host.replaceChildren();
  }

  // subito: senza dissolvenza (cambio di pagina, foglio sostituito da un altro).
  function close({ fromHistory = false, subito = false } = {}) {
    if (closed) return;
    closed = true;
    smettiTastiera();
    window.removeEventListener("popstate", onPop);
    document.removeEventListener("keydown", onKey);
    if (!fromHistory && history.state && history.state.foglio) history.back();
    current = null;
    if (subito || riduci?.matches) { svuota(); return; }
    // Dissolvenza breve verso la pagina, poi si svuota. Un foglio aperto nel frattempo la chiude
    // subito (chiusura.finisci); il timeout copre il caso in cui l'animazione non parta.
    let timer;
    const fine = (e) => { if (e.target === host && e.animationName === "svanisce") finisci(); };
    const mia = { finisci };
    function finisci() {
      clearTimeout(timer);
      host.removeEventListener("animationend", fine);
      if (chiusura === mia) chiusura = null;
      svuota();
    }
    chiusura = mia;
    host.addEventListener("animationend", fine);
    timer = setTimeout(finisci, 400);
    anima(host, "foglio--chiude");
  }

  function onPop() { close({ fromHistory: true }); }
  function onKey(e) { if (e.key === "Escape") close(); }

  // Senza barra non si passa null a replaceChildren: lo scriverebbe come testo in fondo al foglio.
  host.replaceChildren(...[
    el("div.foglio__testa", {},
      el("button.tondo.tondo--piatto", { type: "button", "aria-label": "Indietro", onclick: () => close() }, icon("indietro")),
      el("h2", {}, title || ""),
    ),
    corpo,
    barra,
  ].filter(Boolean));
  host.hidden = false;
  // Durante il passaggio a una pagina (es. «Spese ricorrenti» dal menu) il foglio entra con la
  // pagina, senza una seconda dissolvenza.
  anima(host, document.documentElement.dataset.passaggio || (stessoFoglio && sostituisce) ? null : fondoPieno ? "foglio--sostituisce" : "foglio--entra");
  smettiTastiera = seguiTastiera(host);
  if (!(sostituisce && history.state && history.state.foglio)) {
    history.pushState({ ...(history.state || {}), foglio: true }, "");
  }
  window.addEventListener("popstate", onPop);
  document.addEventListener("keydown", onKey);

  // Primo campo pronto per scrivere.
  const first = host.querySelector("[autofocus]");
  // Se nel frattempo il fuoco è già dentro il foglio (scrivi velocissimo), non lo spostiamo.
  if (first) setTimeout(() => {
    if (host.contains(document.activeElement)) return;
    // Un testo su più righe già scritto si apre dall'inizio: cursore in cima, non in fondo
    // (dove lo mette il browser dopo aver assegnato value), e foglio non scorso.
    if (first.tagName === "TEXTAREA" && first.value) {
      first.setSelectionRange(0, 0);
      first.focus({ preventScroll: true });
      corpo.scrollTop = 0;
      return;
    }
    first.focus();
  }, 60);

  current = { close, confirm, aperto: () => !closed };
  return current;
}

/** Chiude il foglio aperto. { fromHistory: true } = senza toccare la cronologia;
 *  { subito: true } = senza dissolvenza (cambio di pagina). */
export function closeSheet(opts) { if (current) current.close(opts); }

/** Riga di un campo con etichetta piccola sopra. */
export function campo(label, input) {
  return el("div.campo", {}, el("label", {}, label), input);
}
