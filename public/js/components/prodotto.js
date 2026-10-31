// Prodotti dal codice a barre: scansione con la fotocamera (BarcodeDetector, Chrome Android; altrove
// si scrive il codice), scheda da Open Food Facts via la function `prodotto` (cache in prodotti/{ean})
// con l'indice sintetico calcolato dal server (functions/src/prodotti/indice.js: Nutri-Score 50,
// additivi 25, NOVA 15, bio 10; tetto 49 con un additivo a rischio alto).
// Dalla scheda la voce entra nella Lista come tipo di prodotto («Spaghetti»), col prodotto nel dettaglio:
// «Preso» (in basso a destra) tra i comprati, «Da comprare» a sinistra.
import { el, icon } from "../core/ui.js";
import { functions } from "../core/firebase.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-functions.js";
import { openSheet, campo } from "./sheet.js";

const chiama = httpsCallable(functions, "prodotto", { timeout: 35000 });

/** Modello dell'indice in uso sul server (VERSIONE_INDICE in functions/src/prodotti/indice.js): tenerli uguali. */
export const VERSIONE_INDICE = 2;

export const NOME_FASCIA = { eccellente: "Eccellente", buono: "Buono", mediocre: "Mediocre", scarso: "Scarso" };
const NOME_NOVA = { 1: "Non trasformato o poco", 2: "Ingrediente da cucina", 3: "Trasformato", 4: "Ultra-trasformato" };
const NOME_COMPONENTE = { nutrizione: "Nutri-Score", additivi: "additivi", nova: "NOVA", bio: "bio" };
const FORMATI = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

// Voci simili per «In lista come»: tutte le parole della più corta stanno nella più lunga, senza
// articoli e preposizioni e senza l'ultima vocale (nocciola/nocciole). «Spaghetti» ~ «Spaghetti
// integrali»; «Crema mani» no con «Crema di nocciole» (prima bastava la prima parola, 29/10).
const VUOTE = new Set("di del della dello dei degli delle al alla allo ai agli alle con e ed in per da a il lo la i gli le un una".split(" "));
const radici = (s) => norm(s).split(/[^\p{L}\p{N}]+/u).filter((p) => p && !VUOTE.has(p)).map((p) => (p.length > 4 ? p.replace(/[aeiouàèéìòù]$/, "") : p));
export function simile(a, b) {
  const ra = radici(a), rb = radici(b);
  if (!ra.length || !rb.length) return false;
  const [corta, lunga] = ra.length <= rb.length ? [ra, rb] : [rb, ra];
  return corta.every((p) => lunga.includes(p));
}
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const n1 = (x) => (x == null ? "—" : String(x).replace(".", ","));

function messaggioErrore(e) {
  const c = e?.code || "";
  if (/resource-exhausted/.test(c)) return "Open Food Facts è occupato: riprova tra un minuto";
  if (/unavailable/.test(c)) return "Open Food Facts non risponde adesso";
  if (/invalid-argument/.test(c)) return "Codice a barre non valido";
  return e?.message || "Scheda non letta";
}

/** Pallino colorato della fascia (sulle tessere e nelle righe). */
export function pallinoIndice(fascia, cls = "") {
  return fascia ? el("span.indice-pallino", { class: `indice--${fascia} ${cls}`, "aria-label": NOME_FASCIA[fascia] }) : null;
}

/** Riassunto da tenere nella voce della lista: quello che serve a disegnare senza rileggere la scheda. */
export function riassunto(scheda) {
  if (!scheda?.trovato) return null;
  return { nome: scheda.nome || null, marca: scheda.marca || null, indice: scheda.indice ?? null, fascia: scheda.fascia || null, v: scheda.versioneIndice || 1 };
}

/**
 * Riassunti delle voci della lista calcolati con un modello dell'indice più vecchio: si rileggono le
 * schede (il server le ricalcola dalla cache, senza Open Food Facts) e si aggiornano i pallini.
 * Una volta per codice e per sessione; `aggiorna(voce, riassunto)` scrive la voce.
 */
const giaRiletti = new Set();
export async function aggiornaRiassunti(voci, aggiorna) {
  const vecchie = voci.filter((v) => v.ean && v.prodotto && (v.prodotto.v || 1) < VERSIONE_INDICE && !giaRiletti.has(v.ean));
  for (const v of vecchie) {
    giaRiletti.add(v.ean);
    try {
      const r = riassunto((await chiama({ ean: v.ean })).data);
      if (r) aggiorna(v, r);
    } catch (e) { /* si riprova alla prossima apertura dell'app */ giaRiletti.delete(v.ean); return; }
  }
}

/**
 * Foglio «Scansiona»: inquadra il codice; se la fotocamera o il rilevatore non ci sono, si scrive il
 * codice. Ritorna una promessa con il codice (stringa) o null se chiuso.
 * Con un codice il foglio resta aperto (fotocamera spenta) e chi chiama lo sostituisce subito con
 * apriProdotto. Chiuderlo qui farebbe un history.back() che arriva dopo l'apertura del foglio
 * successivo e lo chiude: era la schermata ferma durante la ricerca (29/10).
 */
export function scansiona() {
  return new Promise((risolvi) => {
    let finito = false;
    let stream = null;
    let timer = null;
    const input = el("input", { inputmode: "numeric", placeholder: "es. 8076809513753", autocomplete: "off", enterkeyhint: "search", "aria-label": "Codice a barre" });
    const stato = el("p.meta");
    const video = el("video.scanner__video", { autoplay: true, muted: true, playsinline: true });
    const mirino = el("div.scanner", {}, video, el("div.scanner__mirino"));

    function chiudi(codice) {
      if (finito) return;
      finito = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      risolvi(codice || null);
    }

    const sheet = openSheet({
      title: "Scansiona",
      body: [mirino, stato, el("div", { style: "margin-top:18px" }, campo("Oppure scrivi il codice", input))],
      onConfirm: () => {
        const c = input.value.replace(/\D/g, "");
        if (!/^\d{8,14}$/.test(c)) { input.focus(); return false; }
        chiudi(c);
        return false; // resta aperto: lo sostituisce la scheda
      },
      confirmLabel: "Cerca",
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sheet.confirm(); } });

    // Il foglio può chiudersi da solo (indietro, tasto del telefono): la promessa va sciolta comunque.
    const host = document.getElementById("foglio");
    const osserva = new MutationObserver(() => { if (host.hidden || !host.contains(video)) { osserva.disconnect(); chiudi(null); } });
    osserva.observe(host, { attributes: true, childList: true });

    (async () => {
      if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) {
        mirino.remove();
        stato.textContent = "Questo telefono non legge i codici dalla fotocamera: scrivi il numero sotto le barrette.";
        setTimeout(() => input.focus(), 80);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (finito) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.srcObject = stream;
        await video.play().catch(() => {});
        const rilevatore = new BarcodeDetector({ formats: FORMATI });
        stato.textContent = "Inquadra il codice a barre.";
        timer = setInterval(async () => {
          if (finito || video.readyState < 2) return;
          try {
            const codici = await rilevatore.detect(video);
            const c = codici.map((x) => x.rawValue.replace(/\D/g, "")).find((x) => /^\d{8,14}$/.test(x));
            if (c) { if (navigator.vibrate) navigator.vibrate(40); chiudi(c); }
          } catch (e) { /* un fotogramma non letto: si riprova */ }
        }, 180);
      } catch (e) {
        mirino.remove();
        stato.textContent = "Fotocamera non disponibile: scrivi il numero sotto le barrette.";
        setTimeout(() => input.focus(), 80);
      }
    })();
  });
}

// ───────────── Scheda come in Yuka (31/10, richiesta di Mattia) ─────────────
// Valori per 100 g (100 ml per le bevande) divisi tra «Positivo» e «Negativo», ognuno con una frase e un pallino
// di quattro colori (1 verde, 2 verdolino, 3 arancio, 4 rosso); toccando la riga si vede la scala. In fondo additivi,
// trasformazione (NOVA, spiegata) e Nutri-Score; il biologico è solo la foglia accanto al nome.
// Le soglie sono nostre e dichiarate (Yuka non pubblica le sue); servono a leggere la scheda, l'indice resta quello
// del server. Zuccheri, grassi saturi e sale: «basso» e «alto» del semaforo britannico (FSA 2016, gli stessi dei
// livelli di Open Food Facts), con la fascia di mezzo divisa a metà; «senza» dalle indicazioni nutrizionali UE
// (reg. 1924/2006). Energia: dove il Nutri-Score dà 2, 4½ e 7 punti (cibi: 670, 1506, 2343 kJ; bevande: 90, 225,
// 300 kJ). Fibre 3 e 6 g («fonte» e «alto contenuto», reg. 1924/2006), proteine 4 e 8 g, frutta e verdura 40 e 80%
// (soglie del Nutri-Score 2023); sotto la prima soglia non compaiono.
const NEGATIVI = [
  { k: "kcal", nome: "Energia", icona: "fiamma", u: "kcal", cibo: [160, 360, 560], bevanda: [21, 54, 72],
    frasi: ["Poco calorico", "Basso impatto", "Un po' troppo calorico", "Troppo calorico"] },
  { k: "zuccheri", nome: "Zuccheri", icona: "cubo", u: "g", cibo: [5, 13.75, 22.5], bevanda: [2.5, 6.875, 11.25], senza: 0.5,
    frasi: ["Povero di zuccheri", "Basso impatto", "Un po' troppo zuccherato", "Troppo zuccherato"], frasiSenza: "Senza zuccheri" },
  { k: "saturi", nome: "Grassi saturi", icona: "goccia", u: "g", cibo: [1.5, 3.25, 5], bevanda: [0.75, 1.625, 2.5], senza: 0.1,
    frasi: ["Povero di grassi saturi", "Basso impatto", "Un po' troppi grassi saturi", "Troppi grassi saturi"], frasiSenza: "Senza grassi saturi" },
  { k: "sale", nome: "Sale", icona: "sale", u: "g", cibo: [0.3, 0.9, 1.5], bevanda: [0.3, 0.525, 0.75], senza: 0.0125,
    frasi: ["Povero di sale", "Basso impatto", "Un po' troppo salato", "Troppo salato"], frasiSenza: "Senza sale" },
];
const POSITIVI = [
  { k: "proteine", nome: "Proteine", icona: "pesce", u: "g", soglie: [4, 8], frasi: ["Un po' di proteine", "Quantità eccellente"] },
  { k: "fibre", nome: "Fibre", icona: "spiga", u: "g", soglie: [3, 6], frasi: ["Un po' di fibre", "Quantità eccellente"] },
  { k: "frutta", nome: "Frutta e verdura", icona: "mela", u: "%", soglie: [40, 80], frasi: ["Un po' di frutta e verdura", "Quantità eccellente"] },
];

/** Livello di un valore «negativo» (1–4) con la sua frase; le soglie dipendono da cibo o bevanda. */
export function livelloNegativo(def, v, bevanda = false) {
  const t = bevanda ? def.bevanda : def.cibo;
  const liv = v <= t[0] ? 1 : v <= t[1] ? 2 : v <= t[2] ? 3 : 4;
  return { liv, frase: def.senza != null && v <= def.senza ? def.frasiSenza : def.frasi[liv - 1], soglie: t };
}
/** Livello di un valore «positivo»: 1 (eccellente), 2 (un po'), null sotto la prima soglia. */
export function livelloPositivo(def, v) {
  const [a, b] = def.soglie;
  return v >= b ? { liv: 1, frase: def.frasi[1] } : v >= a ? { liv: 2, frase: def.frasi[0] } : null;
}

// Numeri come sulle etichette: virgola, al più due decimali sotto 1, uno sotto 100.
const cifra = (x) => {
  if (x == null) return "—";
  const d = Math.abs(x) < 1 ? 2 : Math.abs(x) < 100 ? 1 : 0;
  return String(Number(x.toFixed(d))).replace(".", ",");
};
const conUnita = (x, u) => (u === "%" ? `${cifra(x)}%` : `${cifra(x)} ${u}`);

/** Scala sotto una riga: tratti colorati tra i confini, segno sul valore, soglie scritte sotto. */
function scala(confini, colori, valore, u) {
  const n = colori.length;
  let i = 0;
  while (i < n - 1 && valore > confini[i + 1]) i++;
  const dentro = Math.min(1, Math.max(0, (valore - confini[i]) / (confini[i + 1] - confini[i] || 1)));
  const pos = Math.min(100, ((i + dentro) / n) * 100);
  return el("div.scala", {},
    el("div.scala__barra", {}, ...colori.map((c) => el("span.scala__tratto", { class: c }))),
    el("span.scala__segno", { style: `left:${pos.toFixed(1)}%` }),
    el("div.scala__soglie", {}, ...confini.slice(1, -1).map((c, k) => el("span", { style: `left:${(((k + 1) / n) * 100).toFixed(1)}%` }, conUnita(c, u)))));
}

/** Riga di un valore: icona, nome e frase, valore, pallino; con `sotto` si apre al tocco. */
function rigaValore({ icona, nome, frase, valore, liv, sotto, classe }) {
  const corpo = sotto ? el("div.nutr__sotto", {}, sotto) : null;
  if (corpo) corpo.hidden = true;
  const riga = el("div.nutr", { class: classe || "" },
    el("div.nutr__riga", {},
      el("span.nutr__icona", {}, icona ? icon(icona) : null),
      el("div.testo", {}, el("b", {}, nome), frase ? el("span", {}, frase) : null),
      valore ? el("span.nutr__valore", {}, valore) : null,
      liv != null ? el("span.indice-pallino", { class: `liv--${liv}` }) : null,
      corpo ? el("span.nutr__apri", {}, icon("giu")) : null),
    corpo);
  if (corpo) {
    riga.setAttribute("role", "button");
    riga.tabIndex = 0;
    riga.setAttribute("aria-expanded", "false");
    const gira = () => { corpo.hidden = !corpo.hidden; riga.setAttribute("aria-expanded", String(!corpo.hidden)); };
    riga.addEventListener("click", gira);
    riga.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); gira(); } });
  }
  return riga;
}

function sezione(titolo, destra) {
  return el("div.prodotto__sezione", {}, el("h3", {}, titolo), destra ? el("span", {}, destra) : null);
}

const RISCHIO = { alto: ["rischio alto", 4], moderato: ["rischio moderato", 3], nessuno: ["nessun rischio", 1] };
const SPIEGA_NOVA = [
  ["Non trasformati o poco", "come in natura o appena lavorati: frutta, verdura, latte, uova, legumi, pasta secca"],
  ["Ingredienti da cucina", "olio, burro, zucchero, sale, miele"],
  ["Trasformati", "alimenti del gruppo 1 con ingredienti del gruppo 2: pane, formaggi, conserve"],
  ["Ultra-trasformati", "preparati industriali con ingredienti che in cucina non si usano: aromi, emulsionanti, addensanti, sciroppi, proteine isolate"],
];

/** Spiegazione del NOVA sotto la riga Trasformazione: i quattro gruppi, il suo evidenziato, e cosa lo ha deciso. */
function spiegazioneNova(gruppo, marcatori = []) {
  return [
    el("p.nova__intro", {}, "NOVA dice quanto un alimento è lavorato dall'industria, non quanto è nutriente."),
    el("ol.nova", {}, ...SPIEGA_NOVA.map(([titolo, esempi], i) => el("li", { class: i + 1 === gruppo ? `on liv--${i + 1}` : "", "data-n": String(i + 1) },
      el("b", {}, titolo), ": ", esempi, "."))),
    el("p.nova__perche", {},
      marcatori.length ? `Qui il ${gruppo} viene da: ${marcatori.join(", ")}. ` : "",
      gruppo > 1 ? "Open Food Facts dà il gruppo più alto tra quelli dei suoi ingredienti: ne basta uno." : ""),
  ];
}

/** Corpo della scheda di un prodotto trovato. */
function corpoScheda(s, { rileggi } = {}) {
  const titolo = s.nome || s.marca || "Prodotto senza nome";
  const testa = el("div.prodotto__testa", {},
    el("div.prodotto__indice", { class: s.fascia ? `indice--${s.fascia}` : "" },
      el("b.display", {}, s.indice == null ? "—" : String(s.indice)),
      el("small", {}, s.indice == null ? "senza indice" : NOME_FASCIA[s.fascia])),
    el("div.prodotto__nome", {},
      el("b", {}, titolo, s.bio ? el("span.prodotto__bio", { role: "img", title: "Biologico", "aria-label": "Biologico" }, icon("bio")) : null),
      el("span", {}, [s.nome ? s.marca : null, s.quantita].filter(Boolean).join(" · ") || " "),
      s.categoria ? el("span.meta", {}, s.categoria) : null),
  );
  const avvisi = [];
  if (s.indice == null) avvisi.push("Dati insufficienti per una valutazione: la scheda non ha Nutri-Score né ingredienti.");
  else if (s.parziale) avvisi.push(`Valutazione parziale: ${s.mancano.map((k) => NOME_COMPONENTE[k]).join(", ")} non ${s.mancano.length > 1 ? "noti" : "noto"}.`);
  if (s.additivi?.some((a) => a.rischio === "alto")) avvisi.push("Contiene un additivo a rischio alto (EFSA): l'indice non supera 49.");

  // Positivo e Negativo
  const nutr = s.nutrienti || {};
  const per = s.bevanda ? "per 100 ml" : "per 100 g";
  const positivo = [], negativo = [];
  for (const d of POSITIVI) {
    const v = nutr[d.k];
    if (v == null) continue;
    const l = livelloPositivo(d, v);
    if (!l) continue;
    const [a, b] = d.soglie;
    positivo.push(rigaValore({ icona: d.icona, nome: d.nome, frase: l.frase, valore: conUnita(v, d.u), liv: l.liv, classe: `nutr--${d.k}`,
      sotto: scala([0, a, b, d.u === "%" ? 100 : b * 1.6], ["liv--0", "liv--2", "liv--1"], v, d.u) }));
  }
  for (const d of NEGATIVI) {
    const v = nutr[d.k];
    if (v == null) continue;
    const l = livelloNegativo(d, v, s.bevanda);
    const [a, b, c] = l.soglie;
    (l.liv <= 2 ? positivo : negativo).push(rigaValore({ icona: d.icona, nome: d.nome, frase: l.frase, valore: conUnita(v, d.u), liv: l.liv, classe: `nutr--${d.k}`,
      sotto: scala([0, a, b, c, c * 1.6], ["liv--1", "liv--2", "liv--3", "liv--4"], v, d.u) }));
  }
  const valori = [["Energia", nutr.kcal == null ? null : `${cifra(nutr.kcal)} kcal`], ["Grassi", nutr.grassi], ["di cui saturi", nutr.saturi],
    ["Zuccheri", nutr.zuccheri], ["Sale", nutr.sale], ["Fibre", nutr.fibre], ["Proteine", nutr.proteine]].filter(([, v]) => v != null);
  const tabella = el("div.valori", {}, ...valori.map(([k, v]) => el("div.riga.riga--dato", {},
    el("div.testo", {}, el("b", {}, k)), el("span", {}, typeof v === "number" ? `${cifra(v)} g` : v))));
  tabella.hidden = true;
  const apriValori = el("button.nota__apri", { type: "button", "aria-expanded": "false" }, `Tutti i valori ${per}`, icon("giu"));
  apriValori.addEventListener("click", () => { tabella.hidden = !tabella.hidden; apriValori.setAttribute("aria-expanded", String(!tabella.hidden)); });
  const nutrizione = [
    positivo.length ? [sezione("Positivo", per), ...positivo] : null,
    negativo.length ? [sezione("Negativo", per), ...negativo] : null,
    !positivo.length && !negativo.length ? [sezione("Valori nutrizionali"), el("p.meta.prodotto__vuoto", {}, "Open Food Facts non ha i valori nutrizionali di questo prodotto.")] : null,
    valori.length ? [apriValori, tabella] : null,
  ];

  // Additivi
  const additivi = s.additivi || [];
  const elencoAdditivi = !s.ingredientiNoti
    ? [el("p.meta.prodotto__vuoto", {}, "Open Food Facts non ha gli ingredienti di questo prodotto: si possono aggiungere dalla sua pagina.")]
    : !additivi.length
      ? [rigaValore({ nome: "Nessun additivo", frase: "Senza sostanze aggiunte", liv: 1, classe: "additivo" })]
      : [...additivi.map((a) => {
          const [testo, liv] = RISCHIO[a.rischio] || ["non valutato", 0];
          return el("div.additivo", { class: `rischio--${a.rischio || "ignoto"}` },
            el("span.additivo__punto", {}, el("span.indice-pallino", { class: `liv--${liv}` })),
            el("div.testo", {}, el("b", {}, a.nome && a.nome !== a.codice ? `${a.codice} ${a.nome}` : a.codice), a.classe ? el("span", {}, a.classe) : null),
            el("span.additivo__rischio", {}, testo));
        }),
        el("p.meta.prodotto__nota", {}, "Rischio: parere dell'EFSA sulla sovraesposizione (tassonomia di Open Food Facts). «Non valutato» vuol dire che un parere non c'è, non che sia pericoloso.")];

  // Trasformazione
  const nova = s.nova
    ? rigaValore({ icona: "fabbrica", nome: `NOVA ${s.nova}`, frase: `${NOME_NOVA[s.nova]} · cosa vuol dire`, liv: s.nova, classe: "nutr--nova",
        sotto: spiegazioneNova(s.nova, s.novaMarcatori || []) })
    : rigaValore({ icona: "fabbrica", nome: "Non nota", frase: "servono gli ingredienti", classe: "nutr--nova" });

  // Nutri-Score
  const g = String(s.nutriscore?.grado || "").toLowerCase();
  const punti = s.nutriscore?.punteggio;
  const nutriscore = /^[a-e]$/.test(g)
    ? [el("div.nutriscore", { role: "img", "aria-label": `Nutri-Score ${g.toUpperCase()}` },
        ..."abcde".split("").map((l) => el("span.nutriscore__lettera", { class: `grado--${l}${l === g ? " on" : ""}` }, l.toUpperCase()))),
      el("p.meta.prodotto__nota", {}, "Calcolato da Open Food Facts con la versione 2023: energia, zuccheri, grassi saturi e sale tolgono punti, fibre, proteine, frutta e verdura ne restituiscono",
        punti != null ? `. Punteggio di questo prodotto: ${punti} (più è basso, meglio è).` : ".")]
    : [el("p.meta.prodotto__vuoto", {}, g === "not-applicable" ? "Non si applica a questo prodotto." : "Non noto: mancano i valori nutrizionali.")];

  const quando = s.aggiornatoOff ? new Date(s.aggiornatoOff) : null;
  // La scheda resta un mese in prodotti/{ean}: dopo averla corretta su OFF, «rileggi» la riprende subito.
  const fonte = el("p.meta.prodotto__fonte", {},
    "Dati: ", el("a", { href: `https://it.openfoodfacts.org/prodotto/${s.ean}`, target: "_blank", rel: "noopener" }, "Open Food Facts"),
    " (ODbL)", quando ? `, scheda aggiornata il ${quando.toLocaleDateString("it-IT")}` : "",
    s.completezza != null && s.completezza < 0.5 ? ". Scheda incompleta: si può completare lì." : ".",
    rileggi ? " " : null,
    rileggi ? el("a.prodotto__rileggi", { href: "#", role: "button", onclick: (e) => { e.preventDefault(); rileggi(); } }, "Rileggi") : null);

  return [
    testa,
    ...avvisi.map((t) => el("p.meta.prodotto__avviso", {}, t)),
    ...nutrizione.flat().filter(Boolean),
    sezione("Additivi", s.ingredientiNoti ? (additivi.length ? String(additivi.length) : "nessuno") : "non noti"),
    ...elencoAdditivi,
    sezione("Trasformazione"),
    nova,
    sezione("Nutri-Score"),
    ...nutriscore,
    fonte,
  ];
}

/**
 * Scheda del prodotto `ean`. Se c'è `inLista`, in basso le azioni per metterlo nella lista:
 * inLista({ ean, scheda, nome, preso }) → la Lista crea o aggiorna la voce.
 * `voci` sono le voci esistenti (per suggerire il nome), `nomeIniziale` il nome già in lista; `scansione` dice
 * che il codice è appena stato letto (cronologia dei prodotti scansionati, modules/scansioni).
 */
export async function apriProdotto(ean, opzioni = {}) {
  const attesa = foglioAttesa(ean);
  let scheda;
  try {
    // `scansione`: il codice viene dalla fotocamera (o scritto a mano): la function lo mette nella cronologia.
    scheda = (await chiama({ ean, ...(opzioni.aggiorna ? { aggiorna: true } : {}), ...(opzioni.scansione ? { scansione: true } : {}) })).data;
  } catch (e) {
    attesa.ferma();
    if (attesa.foglio.aperto()) foglioErrore(ean, e, opzioni);
    return null;
  }
  attesa.ferma();
  // Chiuso durante la ricerca (indietro): la scheda non ricompare da sola dopo.
  if (attesa.foglio.aperto()) mostraScheda(scheda, opzioni);
  return scheda;
}

/**
 * Attesa della scheda (function `prodotto`: alla prima chiamata dopo un po' la function parte da
 * fredda e OFF può metterci qualche secondo). Il foglio è già quello del prodotto: al posto
 * dell'indice un anello che gira, il codice letto, e dopo 6 s una riga che dice che è lento.
 */
function foglioAttesa(ean) {
  const sotto = el("div.prodotto__lento");
  const foglio = openSheet({
    title: "Prodotto",
    body: [
      el("div.prodotto__testa", { role: "status", "aria-busy": "true" },
        el("div.prodotto__indice.prodotto__indice--attesa", { "aria-hidden": "true" }),
        el("div.prodotto__nome", {}, el("b", {}, "Cerco il prodotto…"), el("span", {}, `Codice ${ean} · Open Food Facts`))),
      sotto,
    ],
  });
  const timer = setTimeout(() => sotto.replaceChildren(el("p.meta", {}, "Ci mette più del solito: Open Food Facts risponde piano. Puoi aspettare o tornare indietro.")), 6000);
  return { foglio, ferma: () => clearTimeout(timer) };
}

/** Errore della ricerca nello stesso foglio, con «Riprova» in basso a destra. */
function foglioErrore(ean, e, opzioni) {
  openSheet({
    title: "Prodotto",
    stessoFoglio: true,
    body: [
      el("div.prodotto__testa", {},
        el("div.prodotto__indice", {}, el("b.display", {}, "!"), el("small", {}, "non letto")),
        el("div.prodotto__nome", {}, el("b", {}, messaggioErrore(e)), el("span", {}, `Codice ${ean}`))),
    ],
    onConfirm: () => { apriProdotto(ean, opzioni); return false; },
    confirmLabel: "Riprova",
  });
}

function mostraScheda(s, opzioni = {}) {
  const { inLista, voci = [], nomeIniziale = "" } = opzioni;
  const trovato = !!s.trovato;
  // Rileggi: stessa scheda, letta di nuovo da OFF; il nome già scritto in «In lista come» resta.
  const rileggi = () => apriProdotto(s.ean, { ...opzioni, aggiorna: true, scansione: false, nomeIniziale: nome?.value.trim() || nomeIniziale });
  const corpo = trovato ? corpoScheda(s, { rileggi }) : [
    el("div.prodotto__testa", {}, el("div.prodotto__indice", {}, el("b.display", {}, "?"), el("small", {}, "non trovato")),
      el("div.prodotto__nome", {}, el("b", {}, "Prodotto non trovato"), el("span", {}, `Codice ${s.ean}`))),
    el("p.meta", {}, "Open Food Facts è una banca dati collaborativa: questo codice non c'è ancora. Puoi comunque mettere il prodotto in lista, e ",
      el("a", { href: `https://it.openfoodfacts.org/prodotto/${s.ean}`, target: "_blank", rel: "noopener" }, "aggiungerlo lì"), " quando hai tempo."),
  ];

  let nome = null;
  if (inLista) {
    // Il nome con cui la voce sta in lista: il tipo di prodotto (categoria), correggibile; sotto, le
    // voci già in lista che somigliano, da toccare per unirsi a quelle.
    nome = el("input", { value: nomeIniziale || cap(s.categoria || s.nome || ""), placeholder: "es. Spaghetti", enterkeyhint: "done", "aria-label": "In lista come" });
    const simili = el("div.segmenti", { style: "flex-wrap:wrap;padding-top:6px" });
    const disegnaSimili = () => {
      const q = norm(nome.value);
      const parole = [q, norm(s.categoria), norm(s.nome)].filter(Boolean);
      const scelte = voci.filter((v) => norm(v.text) !== q && parole.some((p) => simile(p, v.text))).slice(0, 6);
      simili.replaceChildren(...scelte.map((v) => el("button.pillola", { type: "button", onclick: () => { nome.value = v.text; disegnaSimili(); } }, v.text)));
    };
    nome.addEventListener("input", disegnaSimili);
    disegnaSimili();
    // Prima della riga della fonte, che resta l'ultima cosa del foglio.
    corpo.splice(trovato ? corpo.length - 1 : corpo.length, 0, el("div", { style: "margin-top:22px" }, campo("In lista come", nome), simili));
  }

  const conferma = (preso) => {
    const testo = cap(nome.value.trim());
    if (!testo) { nome.focus(); return false; }
    inLista({ ean: s.ean, scheda: s, nome: testo, preso });
  };
  const sheet = openSheet({
    title: "Prodotto",
    stessoFoglio: true,
    body: corpo,
    onConfirm: inLista ? () => conferma(true) : undefined,
    confirmLabel: "Preso",
    azioni: inLista ? [el("button.btn", { type: "button", onclick: () => { if (conferma(false) !== false) sheet.close(); } }, icon("lista"), "Da comprare")] : [],
  });
  if (nome) nome.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sheet.confirm(); } });
}
