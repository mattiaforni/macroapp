// Piccole utilità per costruire l'interfaccia senza framework, e le icone.

/** el("button.btn.btn--primario", { onclick }, "Testo", nodo, ...) */
export function el(spec, attrs = {}, ...children) {
  const [tag, ...classes] = spec.split(".");
  const node = document.createElement(tag || "div");
  if (classes.length) node.className = classes.join(" ");
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k === "class") node.className = [node.className, v].filter(Boolean).join(" ");
    else if (k in node && k !== "style" && k !== "list") node[k] = v;
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
/** Messaggio breve in basso. `azione` = { label, fn } per un pulsante (es. Annulla). */
export function toast(msg, { ms = 2600, azione } = {}) {
  const t = document.getElementById("toast");
  t.replaceChildren(el("span", {}, msg));
  if (azione) t.append(el("button", { onclick: () => { t.hidden = true; azione.fn(); } }, azione.label));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, azione ? 5000 : ms);
}

// ───────────── Date e importi ─────────────

/** Timestamp di Firestore, Date o stringa → Date (o null). */
export function toDate(x) {
  if (!x) return null;
  if (x.toDate) return x.toDate();
  if (x instanceof Date) return x;
  const d = new Date(x);
  return isNaN(d) ? null : d;
}

const MESI_BREVI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
export const meseBreve = (d) => MESI_BREVI[d.getMonth()];
export const meseLungo = (d) => `${MESI[d.getMonth()]} ${d.getFullYear()}`;

export function fmtDate(ts) {
  const d = toDate(ts);
  return d ? `${d.getDate()} ${MESI_BREVI[d.getMonth()]}` : "";
}

export function fmtMoney(n) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n || 0);
}

/** "12,50" o "12.50" → 12.5; NaN se non è un numero. */
export function parseImporto(s) {
  return parseFloat(String(s).trim().replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
}

export function stessoGiorno(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Data → "2026-10-23" (per <input type=date>), nel fuso locale. */
export function isoGiorno(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function giornoRelativo(d) {
  const oggi = new Date();
  const ieri = new Date(); ieri.setDate(oggi.getDate() - 1);
  if (stessoGiorno(d, oggi)) return "Oggi";
  if (stessoGiorno(d, ieri)) return "Ieri";
  return `${d.getDate()} ${MESI[d.getMonth()]}${d.getFullYear() !== oggi.getFullYear() ? " " + d.getFullYear() : ""}`;
}

export const nomeProprio = (s) => String(s || "").trim().split(/\s+/)[0] || "";

// ───────────── Componenti piccoli ─────────────

/** Due pillole "Solo io / Condiviso". Ritorna il nodo; onChange("private"|"shared"). */
export function sceltaVisibilita(value, onChange) {
  const wrap = el("div.segmenti", { style: "padding-top:0" });
  const opts = [["private", "Solo io"], ["shared", "Condiviso"]];
  function draw() {
    wrap.replaceChildren(...opts.map(([v, l]) => el("button.pillola", {
      type: "button", class: v === value ? "on" : "",
      onclick: () => { value = v; draw(); onChange(v); },
    }, l)));
  }
  draw();
  return wrap;
}

/** Il "+" in basso a destra: lo stesso in ogni pagina. */
export function fab(label, onclick) {
  return el("button.fab.fab--tondo", { type: "button", "aria-label": label, title: label, onclick }, icon("piu"));
}

export function fascia(testo, extra) {
  return el("div.fascia", {}, el("span", {}, testo), extra || null);
}

export function vuoto(titolo, testo) {
  return el("div.vuoto", {}, el("b", {}, titolo), testo ? el("p", {}, testo) : null);
}

// ───────────── Icone ─────────────
// Disegnate a mano in un quadrato 24×24, tratto sottile; il colore viene dal contenitore.

const D = {
  // navigazione e comandi
  lista: '<path d="M3.5 9.5h17l-2 10.5h-13l-2-10.5z"/><path d="M8 9.5 12 3.5l4 6"/><path d="M9.5 13.5v3M14.5 13.5v3"/>',
  spese: '<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1V7z"/><path d="M4 7V6a2 2 0 0 1 2-2h10v3"/><circle cx="16" cy="13.5" r="1" fill="currentColor" stroke="none"/>',
  diario: '<path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6V3z"/><path d="M9 3v18M12.5 8h3.5M12.5 11.5h3.5"/>',
  task: '<circle cx="12" cy="12" r="8.5"/><path d="m8.3 12.3 2.5 2.5 5-5.3"/>',
  manuale: '<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z"/><path d="M12 6.5v13"/>',
  impostazioni: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  piu: '<path d="M12 5v14M5 12h14"/>',
  indietro: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  chiudi: '<path d="M6 6l12 12M18 6 6 18"/>',
  spunta: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  matita: '<path d="M4 20h4L20 8a2.8 2.8 0 0 0-4-4L4 16v4z"/>',
  cestino: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  freccia: '<path d="m9 5 7 7-7 7"/>',
  giu: '<path d="m6 9 6 6 6-6"/>',
  calendario: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  ripeti: '<path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19l-3-3"/><path d="M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5l3 3"/>',
  persona: '<circle cx="12" cy="8.2" r="3.4"/><path d="M5.5 19.5c.7-3.5 3.3-5.4 6.5-5.4s5.8 1.9 6.5 5.4"/>',
  persone: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8"/><path d="M15.5 5.8a3 3 0 0 1 0 5.4M17.5 14.6c1.6.6 2.7 2.1 3 4.4"/>',
  copia: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 7 8.5-7"/>',
  messaggio: '<path d="M4 5h16v11H9l-5 4V5z"/>',
  scintilla: '<path d="M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7z"/>',
  cartella: '<path d="M3.5 6.5a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V6.5z"/>',
  negozio: '<path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5.5 12v8h13v-8M10 20v-4.5h4V20"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".7" fill="currentColor" stroke="none"/>',
  appunto: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  scambio: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  telefono: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
  luogo: '<path d="M12 21s7-6.4 7-11a7 7 0 1 0-14 0c0 4.6 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  collegamento: '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 1 0-5.7-5.7L11.9 6.4"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 1 0 5.7 5.7l1.4-1.4"/>',
  esci: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H4"/>',
  sole: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>',
  luna: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  auto: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none"/>',
  punti: '<circle cx="12" cy="5.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r="1.3" fill="currentColor" stroke="none"/>',

  // categorie delle spese
  scontrino: '<path d="M6 3h12v18l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3L6 21V3z"/><path d="M9 8h6M9 11.5h6M9 15h4"/>',
  carrello: '<path d="M3 4h2l2.2 10.2a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.8L19.5 8H6.2"/><circle cx="9" cy="19" r="1.4"/><circle cx="16.5" cy="19" r="1.4"/>',
  lampadina: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
  fiamma: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.5-5.4 3.6-8.3.6 1.8 1.6 2.9 2.7 3.4C12 6.5 13.4 4.4 15 3c.2 3.6 3.5 6.2 3.5 10.6 0 4.3-2.7 7.4-6.5 7.4z"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.3a9.5 9.5 0 0 1 13 0M8.6 15.5a5 5 0 0 1 6.8 0"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/>',
  casa: '<path d="M3 11 12 4l9 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>',
  carburante: '<path d="M4 20V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15M3 20h11M6.5 8h4"/><path d="M13 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-2.5-2.5"/>',
  schermo: '<rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M8 21h8M12 17v4"/>',
  avviso: '<path d="M12 4 2.8 19.5h18.4L12 4z"/><path d="M12 10v4.5"/><circle cx="12" cy="17" r=".7" fill="currentColor" stroke="none"/>',
  forchetta: '<path d="M7 3v7a2 2 0 0 0 2 2v9M11 3v7a2 2 0 0 1-2 2M9 3v6"/><path d="M17 21V3c-2 1.5-3 4-3 7 0 2 1 3 3 3"/>',
  salute: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/>',
  regalo: '<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12"/><path d="M12 8C9.5 8 7.5 7 7.5 5.5S9.5 3.5 12 8zM12 8c2.5 0 4.5-1 4.5-2.5S14.5 3.5 12 8z"/>',
  valigia: '<rect x="3.5" y="7" width="17" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3.5 12h17"/>',
  goccia: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
  macchina: '<path d="M5 15.5 6.5 10a2 2 0 0 1 1.9-1.5h7.2a2 2 0 0 1 1.9 1.5l1.5 5.5"/><rect x="3.5" y="15.5" width="17" height="3.5" rx="1"/><path d="M6 19v1.5M18 19v1.5"/>',
  zampa: '<circle cx="7" cy="10" r="1.7"/><circle cx="10.5" cy="6.5" r="1.7"/><circle cx="14.5" cy="6.5" r="1.7"/><circle cx="18" cy="10" r="1.7"/><path d="M8.5 17c0-3 1.8-5 3.5-5s3.5 2 3.5 5c0 2-1.5 2.5-3.5 2.5S8.5 19 8.5 17z"/>',

  // lista della spesa
  mela: '<path d="M12 7.5c-2-1.5-6-1-6.5 3-.5 4.5 2.5 9.5 5 9.5 1 0 1-.5 1.5-.5s.5.5 1.5.5c2.5 0 5.5-5 5-9.5-.5-4-4.5-4.5-6.5-3z"/><path d="M12 7.5c0-2 1-3.5 2.5-4"/>',
  carota: '<path d="M14.5 9.5 4 20c4-1 9-4 11.5-7.5a2.5 2.5 0 0 0-1-3z"/><path d="M15 9c1-2 3-3 5-3M15 9c.5-2 0-4-1.5-5.5M15.5 9.5c2 .5 3.5 2 4 3.5"/>',
  pane: '<path d="M4 11c0-3 3.5-5 8-5s8 2 8 5c0 1-.7 1.6-1.5 1.8V19h-13v-6.2C4.7 12.6 4 12 4 11z"/><path d="M9 9.5l1 2M13 9l1 2"/>',
  bottiglia: '<path d="M10 3h4v3l2 3v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9l2-3V3z"/><path d="M8 12h8"/>',
  formaggio: '<path d="M3.5 17.5h17V10L7 6.5 3.5 10v7.5z"/><path d="M3.5 10h17"/><circle cx="9" cy="14" r="1.2"/><circle cx="15" cy="13.5" r="1"/>',
  uovo: '<path d="M12 3.5c3 0 6 5 6 9.5a6 6 0 0 1-12 0c0-4.5 3-9.5 6-9.5z"/>',
  carne: '<path d="M14.5 4a5.5 5.5 0 0 1 4 9.3c-1.6 1.6-3.8 2-5.7 1.4L9 18.5a2 2 0 1 1-2.6 2.6 2 2 0 1 1-2.6-2.6 2 2 0 0 1 2.6-.2l3.8-3.8c-.6-1.9-.2-4.1 1.4-5.7A5.4 5.4 0 0 1 14.5 4z"/>',
  pesce: '<path d="M3.5 12c3-4 6.5-5.5 9.5-5.5 3.5 0 6 2.5 8 5.5-2 3-4.5 5.5-8 5.5-3 0-6.5-1.5-9.5-5.5z"/><path d="M3.5 12 2 8.5M3.5 12 2 15.5"/><circle cx="16.5" cy="11" r=".8" fill="currentColor" stroke="none"/>',
  spiga: '<path d="M12 21V8"/><path d="M12 8c-2.5-.5-3.5-2.5-3.5-5 2.5.5 3.5 2.5 3.5 5zM12 8c2.5-.5 3.5-2.5 3.5-5-2.5.5-3.5 2.5-3.5 5zM12 13c-2.5-.5-3.5-2.5-3.5-5 2.5.5 3.5 2.5 3.5 5zM12 13c2.5-.5 3.5-2.5 3.5-5-2.5.5-3.5 2.5-3.5 5z"/>',
  fiocco: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/>',
  tazza: '<path d="M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9z"/><path d="M16 11h1.5a2 2 0 0 1 0 4H16M8 3.5c0 1.5 1 1.5 1 3M11.5 3.5c0 1.5 1 1.5 1 3"/>',
  vino: '<path d="M8 3h8l-.5 6a3.5 3.5 0 0 1-7 0L8 3z"/><path d="M12 12.5V20M8.5 20h7"/>',
  gelato: '<path d="M8 10.5 12 21l4-10.5"/><path d="M7.5 10.5a4.5 4.5 0 1 1 9 0z"/>',
  spray: '<path d="M9 8h6v13H9zM9 8V5h6v3M9 5H6"/><path d="M18 5h.01M20 8h.01M18 11h.01"/>',
  foglia: '<path d="M4 20c0-8 5-14 16-15 1 10-4 16-12 16H4z"/><path d="M4 20C8 16 11 13 16 11"/>',
};

export function icon(name, cls) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  if (cls) svg.setAttribute("class", cls);
  svg.innerHTML = D[name] || D.punti;
  return svg;
}

export const haIcona = (name) => name in D;

/** Prima icona la cui regola corrisponde al testo, altrimenti `predefinita`. */
export function iconaDa(testo, regole, predefinita) {
  const t = String(testo || "").toLowerCase();
  for (const [re, nome] of regole) if (re.test(t)) return nome;
  return predefinita;
}
