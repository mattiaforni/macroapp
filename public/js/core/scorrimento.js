// Scorrimento tra le sezioni della barra in basso: un dito trascinato a sinistra porta alla
// sezione dopo, a destra a quella prima (Diario ↔ Lista ↔ Spese ↔ Task), nello stesso ordine
// della barra. Vale solo sulla pagina di una sezione, con foglio e menu chiusi; non parte
// dai bordi (lì c'è il gesto «indietro» del telefono) né da un elenco che scorre in orizzontale.
import { navigate } from "./router.js";

const SOGLIA = 70;      // px in orizzontale per cambiare sezione
const DECISIONE = 10;   // px dopo i quali si capisce se il gesto è orizzontale o verticale
const BORDO = 24;       // px ai lati dello schermo lasciati al gesto del sistema

/** Attiva il gesto sull'elemento (la vista) per le sezioni `ids`, nell'ordine della barra;
 *  `attuale()` dice la pagina aperta (all'avvio l'hash è vuoto, la sezione è quella predefinita). */
export function attivaScorrimento(elemento, ids, attuale) {
  let gesto = null; // { x, y, asse }

  function libero(bersaglio) {
    if (!document.getElementById("foglio")?.hidden) return false;
    if (document.querySelector(".menu.aperto")) return false;
    if (!ids.includes(attuale())) return false;
    // Dentro qualcosa che scorre già in orizzontale (pillole, segmenti) il dito fa quello.
    for (let n = bersaglio; n && n !== elemento; n = n.parentElement) {
      const st = getComputedStyle(n);
      if ((st.overflowX === "auto" || st.overflowX === "scroll") && n.scrollWidth > n.clientWidth) return false;
    }
    return true;
  }

  elemento.addEventListener("touchstart", (e) => {
    gesto = null;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.clientX < BORDO || t.clientX > window.innerWidth - BORDO) return;
    if (!libero(e.target)) return;
    gesto = { x: t.clientX, y: t.clientY, asse: null };
  }, { passive: true });

  elemento.addEventListener("touchmove", (e) => {
    if (!gesto || gesto.asse === "verticale") return;
    const t = e.touches[0];
    const dx = t.clientX - gesto.x, dy = t.clientY - gesto.y;
    if (!gesto.asse && (Math.abs(dx) > DECISIONE || Math.abs(dy) > DECISIONE)) {
      gesto.asse = Math.abs(dx) > Math.abs(dy) * 1.5 ? "orizzontale" : "verticale";
    }
  }, { passive: true });

  elemento.addEventListener("touchend", (e) => {
    const g = gesto;
    gesto = null;
    if (!g || g.asse !== "orizzontale" || e.touches.length) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - g.x;
    if (Math.abs(dx) < SOGLIA) return;
    const i = ids.indexOf(attuale());
    const a = ids[i + (dx < 0 ? 1 : -1)];
    if (a) navigate(a);
  }, { passive: true });

  elemento.addEventListener("touchcancel", () => { gesto = null; }, { passive: true });
}
