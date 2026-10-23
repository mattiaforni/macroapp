// Router a hash: #/lista, #/spese, ... Ogni modulo registra una route.
const routes = new Map();
let current = null; // { id, unmount }

export function addRoute(id, mount) { routes.set(id, mount); }

export function navigate(id) { location.hash = `#/${id}`; }

export function currentRoute() {
  const m = location.hash.match(/^#\/([a-z0-9-]+)/i);
  return m ? m[1] : null;
}

export function startRouter({ container, fallback, onChange }) {
  async function render() {
    const id = currentRoute() || fallback;
    const mount = routes.get(id) || routes.get(fallback);
    if (current?.unmount) { try { current.unmount(); } catch (e) { console.error(e); } }
    container.replaceChildren();
    container.scrollTop = 0;
    const unmount = await mount(container);
    current = { id, unmount };
    onChange?.(id);
  }
  window.addEventListener("hashchange", render);
  return render();
}

// Richieste di apertura: il menu può chiedere a una pagina di aprire un suo foglio
// (es. Spese → Ricorrenti). La pagina la legge nel mount con richiesto().
const CHIAVE_APRI = "macroapp.apri";

/** Va alla pagina id e le chiede di aprire `apri` (facoltativo). Se ci sei già, la rimonta. */
export function vaiA(id, apri = null) {
  try { apri ? sessionStorage.setItem(CHIAVE_APRI, `${id}:${apri}`) : sessionStorage.removeItem(CHIAVE_APRI); } catch (e) {}
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
