// Foglio: pannello a tutta altezza per inserire o modificare qualcosa.
// In alto: freccia indietro, titolo, spunta di conferma (come in Splitwise).
// Il tasto indietro del telefono chiude il foglio invece di uscire dalla pagina.
import { el, icon } from "../core/ui.js";

let current = null;

/**
 * openSheet({ title, body: Node|Node[], onConfirm: async () => boolean|void, confirmIcon })
 * onConfirm può restituire false per lasciare il foglio aperto (es. campo mancante).
 * Ritorna { close }.
 */
export function openSheet({ title, body, onConfirm, confirmIcon = "spunta" }) {
  // Un foglio che ne sostituisce un altro (es. dalle ricorrenti al singolo modello) riusa la
  // stessa voce della cronologia: tornare indietro con history.back() farebbe arrivare il
  // popstate al foglio nuovo, che si chiuderebbe da solo.
  const sostituisce = !!current;
  if (current) current.close({ fromHistory: true });
  const host = document.getElementById("foglio");
  let closed = false;

  const confirmBtn = onConfirm
    ? el("button.tondo.tondo--piatto", { type: "button", "aria-label": "Conferma", onclick: confirm }, icon(confirmIcon))
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

  function close({ fromHistory = false } = {}) {
    if (closed) return;
    closed = true;
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
      confirmBtn,
    ),
    el("div.foglio__corpo", {}, ...[].concat(body)),
  );
  host.hidden = false;
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
