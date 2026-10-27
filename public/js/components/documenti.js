// Documenti di Google Drive collegati a qualcosa (un progetto, una voce del manuale): elenco di quelli
// collegati, con il link per aprirli in Drive, e ricerca per nome in tutto il Drive dell'utente per
// aggiungerne (core/drive.js). Si salva [{ id, nome, mime, link }]: l'agente legge il testo di quelli
// di un progetto (functions/src/google/drive.js), gli altri servono a ritrovarli con un tocco.
import { el, icon } from "../core/ui.js";
import { statoGoogle, messaggioGoogle } from "../core/google.js";
import { cercaDrive, recentiDrive, tipoDocumento, leggibileDallAgente, documentoDa } from "../core/drive.js";
import { vaiA } from "../core/router.js";
import { closeSheet } from "./sheet.js";

/** Riga di un documento collegato: si apre in Drive; con `onTogli` ha il pulsante per scollegarlo. */
export function rigaDocumento(d, { onTogli = null, nota = "" } = {}) {
  return el("div.riga", { style: "cursor:default" },
    el("div.pallino", {}, icon("appunto")),
    el("div.testo", {},
      d.link ? el("a", { href: d.link, target: "_blank", rel: "noopener", style: "color:inherit;text-decoration:none" }, el("b", {}, d.nome)) : el("b", {}, d.nome),
      el("span", {}, [tipoDocumento(d.mime), nota].filter(Boolean).join(" · "))),
    onTogli ? el("button.tondo.tondo--piatto", { type: "button", "aria-label": `Togli ${d.nome}`, onclick: onTogli }, icon("chiudi")) : null,
  );
}

/** Elenco di sola lettura (pagina del progetto): null se non ci sono documenti. */
export function elencoDocumenti(documenti = []) {
  if (!documenti?.length) return null;
  return el("div", {}, ...documenti.map((d) => rigaDocumento(d)));
}

/**
 * Campo di un foglio: i documenti collegati e la ricerca per aggiungerne.
 * { documenti, perAgente } → { node, valore() }. Con `perAgente` la riga dice se l'agente ne legge il testo.
 */
export function sceltaDocumenti({ documenti = [], perAgente = false } = {}) {
  let scelti = [...documenti];
  const elenco = el("div");
  const risultati = el("div");
  const cerca = el("input.linea-input", { placeholder: "Cerca nel tuo Drive per nome", autocomplete: "off", enterkeyhint: "search" });
  let ultima = 0;

  function disegna() {
    elenco.replaceChildren(...scelti.map((d) => rigaDocumento(d, {
      nota: perAgente ? (leggibileDallAgente(d.mime) ? "l'agente ne legge il testo" : "solo il link: formato non letto dall'agente") : "",
      onTogli: () => { scelti = scelti.filter((x) => x.id !== d.id); disegna(); },
    })));
  }

  function disegnaRisultati(trovati, q) {
    const nuovi = trovati.filter((f) => !scelti.some((d) => d.id === f.id));
    risultati.replaceChildren(
      q || nuovi.length ? el("div.etichetta-campo", { style: "margin-top:10px" }, q ? "Risultati" : "Modificati di recente") : null,
      ...nuovi.map((f) => el("div.riga", { onclick: () => { scelti = [...scelti, documentoDa(f)]; cerca.value = ""; risultati.replaceChildren(); disegna(); } },
        el("div.pallino", {}, icon("appunto")),
        el("div.testo", {}, el("b", {}, f.nome), el("span", {}, [tipoDocumento(f.mime), f.di].filter(Boolean).join(" · "))),
        icon("piu", "freccia-riga"))),
      q && !nuovi.length ? el("p.meta", { style: "padding:8px 0" }, "Nessun file con questo nome") : null,
    );
  }

  async function esegui({ recenti = false } = {}) {
    const q = cerca.value.trim();
    const questa = ++ultima;
    if (!q && !recenti) { risultati.replaceChildren(); return; }
    try {
      const trovati = q ? await cercaDrive(q) : await recentiDrive();
      if (questa === ultima) disegnaRisultati(trovati, q);
    } catch (err) {
      if (questa !== ultima) return;
      const m = messaggioGoogle(err, "Drive");
      risultati.replaceChildren(el("p.meta", { style: "padding:8px 0;color:var(--frutto)" }, `${m.titolo}: ${m.testo}`));
    }
  }
  let timer = null;
  cerca.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(esegui, 350); });
  cerca.addEventListener("focus", () => { if (!cerca.value.trim()) esegui({ recenti: true }); });
  cerca.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); clearTimeout(timer); esegui(); } });

  const g = statoGoogle();
  const ricerca = g.collegato && g.permessi.drive
    ? el("div", {}, cerca, risultati)
    : el("div.nota-campo", {}, icon("cartella"),
      el("button", { type: "button", onclick: () => { closeSheet(); vaiA("google"); } }, g.collegato ? "Ricollega Google con Drive" : "Collega Google"),
      el("span", {}, "per cercare nel tuo Drive"));

  disegna();
  return {
    node: el("div.campo", { style: "margin-top:18px" }, el("label", {}, "Documenti da Drive"), elenco, ricerca),
    valore: () => scelti.map(documentoDa),
  };
}
