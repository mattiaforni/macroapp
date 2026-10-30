// Scorrimento tra le sezioni della barra in basso, come in Leghe Fantacalcio: la pagina segue il
// dito e quella accanto entra dal lato (a sinistra la sezione dopo, a destra quella prima, nello
// stesso ordine della barra); al rilascio si assesta, poi il router monta la sezione nuova. Vale
// solo sulla pagina di una sezione, con foglio e menu chiusi; non parte dai bordi (lì c'è il gesto
// «indietro» del telefono) né da un elenco che scorre in orizzontale. Testata e barra stanno ferme.
//
// Come: la pagina accanto si monta davvero (`mount` del modulo) in un pannello fisso a lato
// (`.scorro`), senza il suo + (`.scorro .fab` è nascosto: il + della pagina aperta resta fermo e
// quello della pagina nuova prende il suo posto). I figli della vista e il pannello si spostano con
// `--scorro-dx`; con «riduci movimento» si cambia di colpo al rilascio.
import { navigate } from "./router.js";

const DECISIONE = 10;   // px dopo i quali si capisce se il gesto è orizzontale o verticale
const BORDO = 24;       // px ai lati dello schermo lasciati al gesto del sistema
const SOGLIA = 0.25;    // frazione della larghezza oltre la quale si cambia sezione
const LANCIO = 0.45;    // px/ms: un colpo deciso cambia sezione anche prima della soglia
const ASSESTA = 220;    // ms per assestarsi al rilascio (base.css, --t-scorro)
const riduci = window.matchMedia?.("(prefers-reduced-motion: reduce)");

/** Attiva il gesto sull'elemento (la vista) per le sezioni `ids`, nell'ordine della barra;
 *  `attuale()` dice la pagina aperta (all'avvio l'hash è vuoto, la sezione è quella predefinita),
 *  `moduloDi(id)` il modulo da montare accanto. */
export function attivaScorrimento(elemento, ids, attuale, moduloDi) {
  const html = document.documentElement;
  let gesto = null; // { x, y, t, asse, verso, id, pannello, smonta, ultimo: { x, t } }
  let inCorso = false; // si sta assestando: niente gesti nuovi

  function libero(bersaglio) {
    if (inCorso) return false;
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

  function sposta(dx, animato) {
    html.style.setProperty("--scorro-dx", `${dx}px`);
    html.toggleAttribute("data-scorro-assesta", !!animato);
  }

  // Monta la sezione accanto nel pannello a lato (destra se si va avanti, sinistra se indietro).
  function prepara(g) {
    const i = ids.indexOf(attuale());
    const id = ids[i + g.verso];
    if (!id) return false;
    const mod = moduloDi(id);
    if (!mod) return false;
    const testata = document.querySelector(".testata");
    const vista = document.createElement("div");
    vista.className = "vista";
    const pannello = document.createElement("div");
    pannello.className = "scorro";
    pannello.style.paddingTop = `${testata?.offsetHeight || 0}px`;
    pannello.style.setProperty("--scorro-lato", `${g.verso * window.innerWidth}px`);
    pannello.append(vista);
    document.body.append(pannello);
    g.id = id; g.pannello = pannello;
    html.setAttribute("data-scorro", g.verso > 0 ? "avanti" : "indietro");
    Promise.resolve(mod.mount(vista)).then((smonta) => { g.smonta = smonta; }).catch((e) => console.error(e));
    return true;
  }

  function fine(g, dx) {
    inCorso = true;
    const larghezza = window.innerWidth;
    const veloce = g.ultimo && (Date.now() - g.ultimo.t) < 120 ? Math.abs(dx - g.ultimo.x) / Math.max(1, Date.now() - g.ultimo.t) : 0;
    const cambia = Math.abs(dx) > larghezza * SOGLIA || (veloce > LANCIO && Math.abs(dx) > 40 && Math.sign(dx) === -g.verso);
    const durata = riduci?.matches ? 0 : ASSESTA;
    const chiudi = () => {
      if (cambia) {
        // La pagina accanto è a posto: il suo modulo si ferma (il disegno resta a coprire) e il
        // router monta la sezione nuova nella vista; poi il pannello se ne va.
        try { g.smonta?.(); } catch (e) { console.error(e); }
        g.smonta = null;
        navigate(g.id);
      }
      const togli = () => {
        try { g.smonta?.(); } catch (e) { console.error(e); }
        g.pannello.remove();
        html.removeAttribute("data-scorro");
        html.removeAttribute("data-scorro-assesta");
        html.style.removeProperty("--scorro-dx");
        inCorso = false;
      };
      cambia ? requestAnimationFrame(() => requestAnimationFrame(togli)) : togli();
    };
    sposta(cambia ? -g.verso * larghezza : 0, durata > 0);
    setTimeout(chiudi, durata + 20);
  }

  elemento.addEventListener("touchstart", (e) => {
    gesto = null;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.clientX < BORDO || t.clientX > window.innerWidth - BORDO) return;
    if (!libero(e.target)) return;
    gesto = { x: t.clientX, y: t.clientY, t: Date.now(), asse: null, verso: 0, id: null, pannello: null, smonta: null, ultimo: null };
  }, { passive: true });

  elemento.addEventListener("touchmove", (e) => {
    if (!gesto || gesto.asse === "verticale") return;
    const t = e.touches[0];
    const dx = t.clientX - gesto.x, dy = t.clientY - gesto.y;
    if (!gesto.asse) {
      if (Math.abs(dx) <= DECISIONE && Math.abs(dy) <= DECISIONE) return;
      if (Math.abs(dx) <= Math.abs(dy) * 1.5) { gesto.asse = "verticale"; return; }
      gesto.asse = "orizzontale";
      gesto.verso = dx < 0 ? 1 : -1;
      if (!prepara(gesto)) { gesto = null; return; }
    }
    // Oltre l'ultima sezione il dito non porta niente: la pagina resta.
    const utile = Math.sign(dx) === -gesto.verso ? dx : 0;
    gesto.ultimo = { x: utile, t: Date.now() };
    if (!riduci?.matches) sposta(utile, false);
  }, { passive: true });

  function rilascio(e) {
    const g = gesto;
    gesto = null;
    if (!g || g.asse !== "orizzontale" || !g.pannello) return;
    const t = e.changedTouches?.[0];
    const dx = t ? t.clientX - g.x : 0;
    fine(g, Math.sign(dx) === -g.verso ? dx : 0);
  }
  elemento.addEventListener("touchend", rilascio, { passive: true });
  elemento.addEventListener("touchcancel", rilascio, { passive: true });
}
