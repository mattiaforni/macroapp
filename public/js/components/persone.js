// Scelta delle persone di un task, prese dalla rubrica del manuale e da Google Contatti.
// Le persone scelte sono pillole: toccandone una la togli. Mentre scrivi compaiono prima le
// persone della rubrica, poi i contatti Google che non ci sono ancora (con l'icona della rubrica
// di Google). Invio sceglie la prima, oppure tiene il nome come persona nuova. Le persone nuove,
// anche quelle prese da Google, entrano in rubrica solo quando il task viene salvato.
// Invio a campo vuoto conferma.
import { el, icon } from "../core/ui.js";
import { persone, personaDaId, personaDaGoogle, trovaPersona, separaNomi, risolviPersone } from "../core/rubrica.js";
import { cercaContatti, caricaContatti, suContatti, dettaglioContatto } from "../core/contatti-google.js";

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * sceltaPersone({ ids, testo, onInvioVuoto })
 * ids: peopleIds del task; testo: il vecchio campo people ("Marco, Giulia"), usato se mancano gli id.
 * Ritorna { node, valore(visibility) → { peopleIds, people } }.
 */
export function sceltaPersone({ ids = [], testo = "", onInvioVuoto } = {}) {
  // Persone che la rubrica non mostra (voci private dell'altra persona): restano collegate.
  const nascosti = ids.filter((id) => !personaDaId(id));
  // scelta: { id, name } dalla rubrica, { id: null, name, nuova } nuova, { id: null, name, google } da Google
  let scelte = ids.map((id) => personaDaId(id)).filter(Boolean).map((p) => ({ id: p.id, name: p.name }));
  if (!ids.length && testo) {
    scelte = separaNomi(testo).map((n) => {
      const p = trovaPersona(n);
      return p ? { id: p.id, name: p.name } : { id: null, name: n };
    });
  }
  const visibiliPrima = new Set(scelte.map((s) => norm(s.name)));

  const pillole = el("div.segmenti", { style: "padding-top:0;flex-wrap:wrap" });
  const input = el("input", { placeholder: scelte.length ? "Aggiungi un'altra persona" : "Scrivi un nome", autocomplete: "off", enterkeyhint: "done" });
  const suggeriti = el("div.segmenti", { style: "padding-top:6px;flex-wrap:wrap" });

  const giàScelta = (p) => scelte.some((s) => (s.id && s.id === p.id) || norm(s.name) === norm(p.name)
    || (s.google && p.googleId && s.google.googleId === p.googleId));

  /** Candidati per q: prima la rubrica, poi Google (tolti i contatti già in rubrica). */
  function candidati(q) {
    const n = norm(q);
    if (!n) return [];
    const daRubrica = persone()
      .filter((p) => !giàScelta(p))
      .filter((p) => norm(p.name).split(" ").some((parola) => parola.startsWith(n)) || norm(p.name).startsWith(n))
      .slice(0, 5)
      .map((p) => ({ id: p.id, name: p.name }));
    const daGoogle = cercaContatti(q, 8)
      .filter((c) => !personaDaGoogle(c.googleId) && !trovaPersona(c.name) && !giàScelta({ name: c.name, googleId: c.googleId }))
      .slice(0, Math.max(2, 6 - daRubrica.length))
      .map((c) => ({ id: null, name: c.name, google: c }));
    return [...daRubrica, ...daGoogle];
  }

  function aggiungi(s) {
    if (!giàScelta(s.google ? { name: s.name, googleId: s.google.googleId } : s)) scelte.push(s);
    input.value = "";
    input.placeholder = "Aggiungi un'altra persona";
    disegna();
    input.focus();
  }

  function disegna() {
    pillole.replaceChildren(...scelte.map((s, i) => el("button.pillola.on", {
      type: "button", "aria-label": `Togli ${s.name}`,
      onclick: () => { scelte.splice(i, 1); disegna(); },
    }, s.name, icon("chiudi"))));
    pillole.hidden = !scelte.length;

    const q = input.value.trim();
    const c = candidati(q);
    const esatta = c.some((p) => norm(p.name) === norm(q));
    // Omonimi tra i contatti Google: sotto il nome, l'azienda o un recapito per distinguerli.
    const nomiPropri = c.map((p) => norm(p.name).split(" ")[0]);
    const omonimo = (p) => nomiPropri.filter((x) => x === norm(p.name).split(" ")[0]).length > 1;
    // pointerdown senza fuoco: la tastiera resta aperta mentre tocchi un suggerimento.
    const tieni = (e) => e.preventDefault();
    suggeriti.replaceChildren(
      ...c.map((p) => el("button.pillola", {
        type: "button", onpointerdown: tieni, onclick: () => aggiungi(p),
        title: p.google ? `Da Google Contatti${dettaglioContatto(p.google) ? ` · ${dettaglioContatto(p.google)}` : ""}` : null,
      }, icon(p.google ? "contatto" : "persona"), p.name,
      p.google && omonimo(p) && dettaglioContatto(p.google) ? el("small", {}, dettaglioContatto(p.google)) : null)),
      q && !esatta ? el("button.pillola.pillola--accento", { type: "button", onpointerdown: tieni,
        onclick: () => aggiungi({ id: null, name: cap(q), nuova: true }) }, icon("piu"), `Nuova: ${cap(q)}`) : null,
    );
    suggeriti.hidden = !q;
  }

  input.addEventListener("input", disegna);
  input.addEventListener("focus", () => { caricaContatti().catch(() => {}); }, { once: true });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = input.value.trim();
    if (!q) { onInvioVuoto?.(); return; }
    const p = trovaPersona(q);
    aggiungi(p ? { id: p.id, name: p.name } : candidati(q)[0] || { id: null, name: cap(q) });
  });
  // I contatti Google arrivano dopo: si ridisegnano i suggerimenti finché il campo è nel foglio.
  const smetti = suContatti(() => { if (!input.isConnected) smetti(); else if (input.value.trim()) disegna(); });
  disegna();

  return {
    node: el("div", {}, pillole, input, suggeriti),
    /** Al salvataggio: le persone nuove entrano in rubrica con la visibilità del task. */
    valore(visibility) {
      smetti();
      const daScrivere = input.value.trim(); // nome scritto ma non confermato con Invio
      if (daScrivere) {
        const p = trovaPersona(daScrivere);
        aggiungi(p ? { id: p.id, name: p.name } : { id: null, name: cap(daScrivere) });
      }
      const nuovi = scelte.filter((s) => !s.id);
      const idNuovi = risolviPersone(nuovi.map((s) => (s.google || s.nuova ? s : s.name)), visibility);
      nuovi.forEach((s, i) => { s.id = idNuovi[i]; });
      // Nomi delle persone nascoste: dal vecchio testo, tolti quelli visibili all'apertura.
      const nomiNascosti = nascosti.length ? separaNomi(testo).filter((n) => !visibiliPrima.has(norm(n))) : [];
      return {
        peopleIds: [...scelte.map((s) => s.id), ...nascosti],
        people: [...scelte.map((s) => s.name), ...nomiNascosti].join(", "),
      };
    },
  };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
