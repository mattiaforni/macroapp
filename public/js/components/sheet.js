// Foglio: pannello a tutta altezza per inserire o modificare qualcosa.
// In alto solo freccia indietro e titolo (servono a orientarsi). In basso una barra fissa con
// le azioni: a sinistra le secondarie (Elimina…), a destra la principale (Salva), sotto il
// pollice destro. Quando si apre la tastiera la barra le sta sopra.
// Il tasto indietro del telefono chiude il foglio invece di uscire dalla pagina.
import { el, icon } from "../core/ui.js";

let current = null;

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

/**
 * openSheet({ title, body: Node|Node[], onConfirm, confirmLabel, azioni })
 * onConfirm: async () => boolean|void; false lascia il foglio aperto (es. campo mancante).
 * confirmLabel: testo del pulsante principale (predefinito «Salva»).
 * azioni: pulsanti secondari per la barra in basso, a sinistra. Anche un div.foglio__piede
 * dentro il corpo finisce lì: è il modo in cui i fogli segnano le loro azioni secondarie.
 * Senza onConfirm né azioni la barra non c'è (fogli di sola consultazione).
 * Ritorna { close, confirm }.
 */
export function openSheet({ title, body, onConfirm, confirmLabel = "Salva", azioni = [] }) {
  // Un foglio che ne sostituisce un altro (es. dalle ricorrenti al singolo modello) riusa la
  // stessa voce della cronologia: tornare indietro con history.back() farebbe arrivare il
  // popstate al foglio nuovo, che si chiuderebbe da solo.
  const sostituisce = !!current;
  if (current) current.close({ fromHistory: true });
  const host = document.getElementById("foglio");
  let closed = false;

  const corpo = el("div.foglio__corpo", {}, ...[].concat(body));
  const secondarie = [...[].concat(azioni).filter(Boolean)];
  corpo.querySelectorAll(".foglio__piede").forEach((p) => { secondarie.push(...p.children); p.remove(); });

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
  function close({ fromHistory = false } = {}) {
    if (closed) return;
    closed = true;
    smettiTastiera();
    host.hidden = true;
    host.replaceChildren();
    window.removeEventListener("popstate", onPop);
    document.removeEventListener("keydown", onKey);
    if (!fromHistory && history.state && history.state.foglio) history.back();
    current = null;
  }

  function onPop() { close({ fromHistory: true }); }
  function onKey(e) { if (e.key === "Escape") close(); }

  host.replaceChildren(
    el("div.foglio__testa", {},
      el("button.tondo.tondo--piatto", { type: "button", "aria-label": "Indietro", onclick: () => close() }, icon("indietro")),
      el("h2", {}, title || ""),
    ),
    corpo,
    barra,
  );
  host.hidden = false;
  smettiTastiera = seguiTastiera(host);
  if (!(sostituisce && history.state && history.state.foglio)) {
    history.pushState({ ...(history.state || {}), foglio: true }, "");
  }
  window.addEventListener("popstate", onPop);
  document.addEventListener("keydown", onKey);

  // Primo campo pronto per scrivere.
  const first = host.querySelector("[autofocus]");
  // Se nel frattempo il fuoco è già dentro il foglio (scrivi velocissimo), non lo spostiamo.
  if (first) setTimeout(() => { if (!host.contains(document.activeElement)) first.focus(); }, 60);

  current = { close, confirm };
  return current;
}

/** Chiude il foglio aperto. { fromHistory: true } = senza toccare la cronologia (cambio di pagina). */
export function closeSheet(opts) { if (current) current.close(opts); }

/** Riga di un campo con etichetta piccola sopra. */
export function campo(label, input) {
  return el("div.campo", {}, el("label", {}, label), input);
}
