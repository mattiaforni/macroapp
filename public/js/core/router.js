// Router a hash: #/lista, #/spese, ... Ogni modulo registra una route.
const routes = new Map();
let current = null; // { id, unmount }

export function addRoute(id, mount) { routes.set(id, mount); }

export function navigate(id) { location.hash = `#/${id}`; }

export function currentRoute() {
  const m = location.hash.match(/^#\/([a-z0-9-]+)/i);
  return m ? m[1] : null;
}

// Passaggi tra le pagine, come in Leghe Fantacalcio (animazioni in base.css):
// "entra" (lo schermo sfuma sul fondo, poi compare la pagina nuova), "torna" (dissolvenza
// incrociata breve) o nessuno (cambio secco). Chi naviga con vaiA (menu, pulsanti nelle pagine)
// entra sempre; per il resto (barra in basso, tasto indietro) decide transizione(da, a).
// Il browser fotografa lo schermo vecchio (View Transitions); dove non c'è, o con «riduci
// movimento», la pagina cambia di colpo. Durante il passaggio <html data-passaggio> dice quale.
const riduci = window.matchMedia?.("(prefers-reduced-motion: reduce)");
let passaggi = 0;
let forzato = null; // passaggio chiesto da vaiA per la prossima pagina

export function startRouter({ container, fallback, onChange, transizione }) {
  async function monta(id, mount) {
    if (current?.unmount) { try { current.unmount(); } catch (e) { console.error(e); } }
    container.replaceChildren();
    container.scrollTop = 0;
    const unmount = await mount(container);
    current = { id, unmount };
    onChange?.(id);
  }
  function render() {
    const id = currentRoute() || fallback;
    const mount = routes.get(id) || routes.get(fallback);
    const tipo = !current ? null : forzato || (current.id !== id ? transizione?.(current.id, id) : null);
    forzato = null;
    if (!tipo || !document.startViewTransition || riduci?.matches) return monta(id, mount);
    const html = document.documentElement;
    const mio = ++passaggi;
    html.dataset.passaggio = tipo;
    let montata;
    const vt = document.startViewTransition(() => {
      montata = monta(id, mount);
      // Una pagina che aspetta dati lenti non tiene fermo lo schermo vecchio: dopo poco si sfuma
      // comunque, e il resto arriva mentre la pagina compare.
      return Promise.race([montata, new Promise((r) => setTimeout(r, 150))]);
    });
    vt.ready.catch(() => {});
    vt.finished.catch(() => {}).then(() => { if (passaggi === mio) delete html.dataset.passaggio; });
    return vt.updateCallbackDone.then(() => montata);
  }
  window.addEventListener("hashchange", render);
  return render();
}

// Richieste di apertura: il menu può chiedere a una pagina di aprire un suo foglio
// (es. Spese → Ricorrenti). La pagina la legge nel mount con richiesto().
const CHIAVE_APRI = "macroapp.apri";

/** Va alla pagina id e le chiede di aprire `apri` (facoltativo). Se ci sei già, la rimonta.
 *  Si entra con la dissolvenza; il foglio chiesto, se si apre durante il passaggio, entra con la pagina. */
export function vaiA(id, apri = null) {
  try { apri ? sessionStorage.setItem(CHIAVE_APRI, `${id}:${apri}`) : sessionStorage.removeItem(CHIAVE_APRI); } catch (e) {}
  forzato = "entra";
  if (currentRoute() === id) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else navigate(id);
}

/** Nel mount di un modulo: true, una volta sola, se il menu ha chiesto di aprire quella cosa. */
export function richiesto(id, apri) {
  try {
    if (sessionStorage.getItem(CHIAVE_APRI) !== `${id}:${apri}`) return false;
    sessionStorage.removeItem(CHIAVE_APRI);
    return true;
  } catch (e) { return false; }
}
