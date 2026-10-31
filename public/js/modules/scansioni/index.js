// Prodotti scansionati: la cronologia delle scansioni della casa, dalla più recente (29/10, richiesta di Mattia:
// «un orologino in alto a destra» nella Lista). Le righe sono quelle del Diario e del Calendario: giorno in serif a
// sinistra (solo sulla prima del giorno), nome del prodotto, marca e quantità, il pallino della fascia con l'indice.
// Toccando una riga si apre la scheda, con «Preso» / «Da comprare» come dopo una scansione; il codice a barre in
// basso a destra scansiona.
//
// Fonti: `scansioni` (una per prodotto e per casa, scritta dalla function `prodotto` a ogni scansione) e, per i
// prodotti scansionati prima che la cronologia esistesse, la cache `prodotti` letta da un membro della casa
// (`lettoDa`): la data è quella della prima lettura da Open Food Facts.
import { el, icon, fascia, vuoto, attesa, toDate, meseLungo, isoGiorno, stessoGiorno } from "../../core/ui.js";
import { watchVisible, leggiDove, where } from "../../core/db.js";
import { session } from "../../core/auth.js";
import { getHousehold } from "../../core/household.js";
import { pallinoIndice, NOME_FASCIA, apriProdotto } from "../../components/prodotto.js";
import { inserisciProdotto, scansionaInLista } from "../lista/index.js";

export const id = "scansioni";
export const title = "Prodotti scansionati";
export const nav = false;
const navIcon = "orologio";
export { navIcon as icon };

const GIORNI = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];

/** Una scansione o una scheda in cache come voce della cronologia. */
function voceDa(x, quando) {
  return {
    ean: x.ean || x.id, trovato: x.trovato !== false, nome: x.nome || null, marca: x.marca || null, quantita: x.quantita || null,
    categoria: x.categoria || null, indice: x.indice ?? null, fascia: x.fascia || null, volte: x.volte || 1, quando,
  };
}

export function mount(container) {
  let scansioni = [];
  let vecchie = [];
  let items = [];
  const dati = attesa(["scansioni", "prodotti", "lista"], () => render(), 1500);
  const elenco = el("div");
  const scansiona = el("button.fab.fab--tondo", { type: "button", "aria-label": "Scansiona un prodotto", title: "Scansiona un prodotto",
    onclick: () => scansionaInLista(() => items) }, icon("codice"));

  function apri(v) {
    const voce = items.find((i) => i.ean === v.ean) || null;
    apriProdotto(v.ean, { inLista: (r) => inserisciProdotto(r, items, voce), voci: items, nomeIniziale: voce?.text || "" });
  }

  function riga(v, conGiorno) {
    const d = v.quando || new Date();
    const voce = items.find((i) => i.ean === v.ean);
    const piede = [
      v.trovato
        ? el("span.scansione__indice", {}, pallinoIndice(v.fascia) || el("span.indice-pallino"),
          v.indice != null ? `${v.indice} · ${NOME_FASCIA[v.fascia] || ""}` : "senza indice")
        : el("span.lezione__stato.lezione__stato--muto", {}, "non trovato su Open Food Facts"),
      voce && !voce.done ? el("span.lezione__stato", {}, "in lista") : null,
      v.volte > 1 ? el("span.lezione__ora", {}, `${v.volte} volte`) : null,
    ].filter(Boolean);
    return el("div.voce-nota", {},
      el("button.lezione", { type: "button", onclick: () => apri(v) },
        el("div.lezione__giorno", {}, conGiorno ? [el("b.display", {}, String(d.getDate())), el("small", {}, stessoGiorno(d, new Date()) ? "oggi" : GIORNI[d.getDay()])] : null),
        el("div.lezione__testo", {},
          el("div.lezione__titolo", {}, v.nome || v.marca || (v.trovato ? "Prodotto senza nome" : "Prodotto non trovato")),
          el("div.lezione__anteprima", {}, [v.marca, v.quantita].filter(Boolean).join(" · ") || v.categoria || `Codice ${v.ean}`),
          el("div.lezione__temi", {}, ...piede),
        ),
      ),
    );
  }

  function render() {
    if (!dati.pronta()) return;
    // Una voce per prodotto: la scansione registrata vince sulla scheda in cache.
    const perEan = new Map();
    for (const p of vecchie) perEan.set(p.ean || p.id, voceDa(p, toDate(p.letto)));
    for (const s of scansioni) perEan.set(s.ean, voceDa(s, toDate(s.scansionataAt) || toDate(s.updatedAt) || toDate(s.createdAt)));
    const voci = [...perEan.values()].sort((a, b) => (b.quando?.getTime() || 0) - (a.quando?.getTime() || 0));
    if (!voci.length) {
      elenco.replaceChildren(dati.ha("scansioni") && dati.ha("prodotti")
        ? vuoto("Nessun prodotto scansionato", "Tocca il codice a barre in basso a destra e inquadra una confezione: la scheda finisce qui.")
        : el("div"));
      return;
    }
    const nodi = [];
    let mese = null, giorno = null;
    for (const v of voci) {
      const d = v.quando || new Date();
      const m = meseLungo(d);
      if (m !== mese) { nodi.push(fascia(m.charAt(0).toUpperCase() + m.slice(1))); mese = m; giorno = null; }
      nodi.push(riga(v, isoGiorno(d) !== giorno));
      giorno = isoGiorno(d);
    }
    elenco.replaceChildren(...nodi);
  }

  container.append(elenco, scansiona);
  const stop1 = watchVisible("scansioni", {}, (docs) => { scansioni = docs; dati.arriva("scansioni"); render(); });
  const stop2 = watchVisible("shopping_items", { order: ["createdAt", "asc"] }, (docs) => { items = docs; dati.arriva("lista"); render(); });
  // Prima della cronologia: le schede lette da Open Food Facts da un membro della casa.
  getHousehold().catch(() => null).then(async (h) => {
    const membri = (h?.members?.length ? h.members : [session.user.uid]).slice(0, 10);
    vecchie = await leggiDove("prodotti", where("lettoDa", "in", membri));
    dati.arriva("prodotti");
    render();
  });
  return () => { stop1(); stop2(); dati.ferma(); scansiona.remove(); };
}
