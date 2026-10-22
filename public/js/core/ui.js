// Piccole utilità per costruire l'interfaccia senza framework.

/** el("button.btn.btn--primary", { onclick }, "Testo", childNode, ...) */
export function el(spec, attrs = {}, ...children) {
  const [tag, ...classes] = spec.split(".");
  const node = document.createElement(tag || "div");
  if (classes.length) node.className = classes.join(" ");
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k in node && k !== "style") node[k] = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

let toastTimer;
export function toast(msg, ms = 2500) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export function fmtDate(ts) {
  const d = ts?.toDate ? ts.toDate() : ts instanceof Date ? ts : null;
  if (!d) return "";
  return d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}

export function fmtMoney(n) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n || 0);
}

/** Selettore condivisa/personale, usato da tutti i moduli con contenuti misti. */
export function visibilityToggle(value = "shared", onChange) {
  const sel = el("select", {
    onchange: (e) => onChange(e.target.value),
    "aria-label": "Visibilità",
  },
    el("option", { value: "shared", selected: value === "shared" }, "Condivisa"),
    el("option", { value: "private", selected: value === "private" }, "Personale"),
  );
  return sel;
}

export function icon(name) {
  const paths = {
    spese: "M3 6h18v12H3zM3 10h18M7 14h4",
    lista: "M4 6h16M4 12h16M4 18h10",
    manuale: "M4 4h12l4 4v12H4zM8 12h8M8 16h8",
    diario: "M12 3v18M5 8l7-5 7 5M5 16l7 5 7-5",
    task: "M5 12l4 4L19 6",
    proposte: "M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z",
    impostazioni: "M4 7h16M4 12h16M4 17h16M8 5v4M16 10v4M11 15v4",
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", paths[name] || paths.task);
  svg.append(p);
  return svg;
}
