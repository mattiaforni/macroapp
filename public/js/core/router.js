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
