// Scelta delle persone di un task, prese dalla rubrica del manuale.
// Le persone scelte sono pillole: toccandone una la togli. Mentre scrivi compaiono le persone
// della rubrica che corrispondono; Invio sceglie la prima, oppure tiene il nome come persona
// nuova, che entra in rubrica solo quando il task viene salvato. Invio a campo vuoto conferma.
import { el, icon } from "../core/ui.js";
import { persone, personaDaId, trovaPersona, separaNomi, risolviPersone } from "../core/rubrica.js";

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * sceltaPersone({ ids, testo, onInvioVuoto })
 * ids: peopleIds del task; testo: il vecchio campo people ("Marco, Giulia"), usato se mancano gli id.
 * Ritorna { node, valore(visibility) → { peopleIds, people } }.
 */
export function sceltaPersone({ ids = [], testo = "", onInvioVuoto } = {}) {
  // Persone che la rubrica non mostra (voci private dell'altra persona): restano collegate.
  const nascosti = ids.filter((id) => !personaDaId(id));
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

  const giàScelta = (p) => scelte.some((s) => (s.id && s.id === p.id) || norm(s.name) === norm(p.name));

  function candidati(q) {
    const n = norm(q);
    if (!n) return [];
    return persone()
      .filter((p) => !giàScelta(p))
      .filter((p) => norm(p.name).split(" ").some((parola) => parola.startsWith(n)) || norm(p.name).startsWith(n))
      .slice(0, 5);
  }

  function aggiungi(s) {
    if (!giàScelta(s)) scelte.push(s);
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
    // pointerdown senza fuoco: la tastiera resta aperta mentre tocchi un suggerimento.
    const tieni = (e) => e.preventDefault();
    suggeriti.replaceChildren(
      ...c.map((p) => el("button.pillola", { type: "button", onpointerdown: tieni, onclick: () => aggiungi({ id: p.id, name: p.name }) },
        icon("persona"), p.name)),
      q && !esatta ? el("button.pillola.pillola--accento", { type: "button", onpointerdown: tieni,
        onclick: () => aggiungi({ id: null, name: cap(q) }) }, icon("piu"), `Nuova: ${cap(q)}`) : null,
    );
    suggeriti.hidden = !q;
  }

  input.addEventListener("input", disegna);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = input.value.trim();
    if (!q) { onInvioVuoto?.(); return; }
    const p = trovaPersona(q) || candidati(q)[0];
    aggiungi(p ? { id: p.id, name: p.name } : { id: null, name: cap(q) });
  });
  disegna();

  return {
    node: el("div", {}, pillole, input, suggeriti),
    /** Al salvataggio: le persone nuove entrano in rubrica con la visibilità del task. */
    valore(visibility) {
      const daScrivere = input.value.trim(); // nome scritto ma non confermato con Invio
      if (daScrivere) aggiungi({ id: trovaPersona(daScrivere)?.id || null, name: trovaPersona(daScrivere)?.name || cap(daScrivere) });
      const nuovi = scelte.filter((s) => !s.id);
      const idNuovi = risolviPersone(nuovi.map((s) => s.name), visibility);
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
