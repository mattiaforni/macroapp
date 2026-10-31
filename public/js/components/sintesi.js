// Sintesi di un progetto: un testo vivo con lo stato del progetto e ciò che è emerso dalle note del
// diario, organizzato per temi secondo le istruzioni del progetto. La scrive l'agente come proposta
// dopo ogni nota analizzata; confermata, finisce in `projects.sintesi`. Si legge nella pagina del
// progetto (modules/progetto), per temi, e da qui si corregge a mano. Ogni cambio tiene la versione
// precedente in `sintesiStorico` (ultime 10): si rileggono e si ripristinano dal foglio «Versioni».
//
// Convenzione del testo (la conosce anche l'agente): una sezione «## Tema» per tema; dentro, come
// prima riga facoltativa, «Stato: …» (due-quattro parole). Le note portano in `temi` i nomi delle
// sezioni che toccano: così ogni tema sa in quali note è emerso.
import { el, icon, toast, toDate, testoRicco } from "../core/ui.js";
import { update, readVisible } from "../core/db.js";
import { openSheet, scriviDa } from "./sheet.js";

const VERSIONI = 10; // versioni precedenti tenute in projects.sintesiStorico

/**
 * Scrive la sintesi del progetto tenendo la versione precedente nello storico
 * (`sintesiStorico`: le ultime VERSIONI, dalla più recente; { testo, at, origine }).
 * `progetto` può essere il documento o solo l'id (allora si legge). `origine`: "ai" | "mano" | "ripristino".
 */
export async function salvaSintesi(progetto, nuova, origine = "mano") {
  const p = typeof progetto === "string" ? (await readVisible("projects")).find((x) => x.id === progetto) : progetto;
  if (!p) throw new Error("progetto non trovato");
  const testo = String(nuova || "").trim();
  if (testo === String(p.sintesi || "").trim()) return;
  const storico = Array.isArray(p.sintesiStorico) ? p.sintesiStorico : [];
  const precedente = p.sintesi ? [{ testo: p.sintesi, at: toDate(p.sintesiAt) || new Date(), origine: p.sintesiOrigine || "" }] : [];
  await update("projects", p.id, {
    sintesi: testo, sintesiAt: new Date(), sintesiOrigine: origine,
    sintesiStorico: [...precedente, ...storico].slice(0, VERSIONI),
  });
}

/** Foglio con le versioni precedenti della sintesi: si leggono e si ripristinano (l'attuale finisce nello storico). */
export function apriVersioni(progetto) {
  const storico = Array.isArray(progetto.sintesiStorico) ? progetto.sintesiStorico : [];
  const aperte = new Set();
  const elenco = el("div");
  const disegna = () => elenco.replaceChildren(...storico.map((v, i) => {
    const d = toDate(v.at);
    const quando = d ? `${d.toLocaleDateString("it-IT", { day: "numeric", month: "long" })}, ${d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}` : "";
    const origine = v.origine === "ai" ? "dall'AI" : v.origine === "ripristino" ? "ripristinata" : v.origine === "mano" ? "a mano" : "";
    const aperta = aperte.has(i);
    return el("div.versione", {},
      el("button.versione__testa", { type: "button", "aria-expanded": aperta ? "true" : "false", onclick: () => { aperta ? aperte.delete(i) : aperte.add(i); disegna(); } },
        el("span", {}, quando), origine ? el("span.meta", {}, origine) : null, el("span.spazio"), icon("giu")),
      aperta ? el("div.sintesi-testo.versione__testo", {}, ...testoRicco(v.testo)) : null,
      aperta ? el("div", { style: "padding: 4px 0 12px" },
        el("button.btn", { onclick: async () => { await salvaSintesi(progetto, v.testo, "ripristino"); sheet.close(); toast("Sintesi ripristinata"); } }, icon("ripeti"), "Ripristina questa versione")) : null,
    );
  }));
  disegna();
  const sheet = openSheet({
    title: "Versioni della sintesi",
    body: [
      el("p.meta", { style: "margin-top:12px" }, storico.length ? (storico.length === 1 ? "La versione prima di quella attuale. Ripristinandola, l'attuale finisce qui." : `Le ultime ${storico.length} versioni prima di quella attuale, dalla più recente. Ripristinandone una, l'attuale finisce qui.`) : "Nessuna versione precedente: lo storico parte dalla prossima modifica."),
      elenco,
    ],
  });
}

/**
 * Le sezioni della sintesi: [{ nome, stato, corpo }]. Il testo prima del primo titolo è una
 * sezione senza nome. `stato` è la riga «Stato: …», tolta dal corpo.
 */
export function sezioniSintesi(testo) {
  const out = [];
  let corrente = null;
  let inizio = 0; // dove comincia la riga nel testo: `inizio` della sezione, per il cursore dopo un tocco
  for (const grezza of String(testo || "").split("\n")) {
    const qui = inizio;
    inizio += grezza.length + 1;
    const riga = grezza.trim();
    const titolo = riga.match(/^#{1,4}\s+(.*)$/);
    if (titolo) {
      corrente = { nome: titolo[1].replace(/\*\*/g, "").trim(), stato: "", corpo: [], inizio: qui };
      out.push(corrente);
      continue;
    }
    if (!corrente) {
      if (!riga) continue;
      corrente = { nome: "", stato: "", corpo: [], inizio: qui };
      out.push(corrente);
    }
    const stato = riga.match(/^\**\s*stato\s*:\**\s*(.+)$/i);
    if (stato && !corrente.stato) { corrente.stato = stato[1].replace(/\*\*/g, "").trim(); continue; }
    corrente.corpo.push(grezza);
  }
  return out.map((sez) => ({ ...sez, corpo: sez.corpo.join("\n").trim() })).filter((sez) => sez.nome || sez.corpo);
}

/** Tono di uno stato, per il colore: "bene", "male" o "". */
export function tonoStato(stato) {
  const t = String(stato || "").toLowerCase();
  if (/indietro|peggior|male|problem|bloccat|regred|perso/.test(t)) return "male";
  if (/miglior|meglio|sicur|bene|acquisit|funzion|stabil|ok\b/.test(t)) return "bene";
  return "";
}

/** Foglio per correggere la sintesi a mano. Svuotarla la toglie.
 *  `fuoco` = { pos }: arrivando da un tocco sul testo della sintesi, cursore lì e tastiera aperta. */
export function apriSintesi(progetto, fuoco = null) {
  const area = el("textarea", { rows: Math.min(18, (progetto.sintesi || "").split("\n").length + 2), autofocus: true });
  area.value = progetto.sintesi || "";
  openSheet({
    title: `Sintesi di ${progetto.name}`,
    body: [
      el("div.taccuino", {}, area),
      el("p.meta", { style: "margin-top:6px" }, "Testo semplice: «## » per ogni tema, sotto «Stato: …» se vuoi, poi «- » per gli elenchi. L'AI ne propone una versione aggiornata dopo ogni nota del diario."),
    ],
    onConfirm: () => {
      salvaSintesi(progetto, area.value, "mano").then(() => toast("Sintesi salvata"), () => toast("Non sono riuscito a salvare"));
    },
  });
  if (fuoco) scriviDa(area, fuoco.pos);
}
