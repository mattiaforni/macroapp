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

function rigaDato(etichetta, valore, sotto) {
  return el("div.riga.riga--dato", {}, el("div.testo", {}, el("b", {}, etichetta), sotto ? el("span", {}, sotto) : null), valore);
}

function pillolaGrado(grado) {
  const g = String(grado || "").toLowerCase();
  if (!/^[a-e]$/.test(g)) return el("span.meta", {}, g === "not-applicable" ? "non applicabile" : "non noto");
  return el("span.grado", { class: `grado--${g}` }, g.toUpperCase());
}

/** Corpo della scheda di un prodotto trovato. */
function corpoScheda(s, { rileggi } = {}) {
  const testa = el("div.prodotto__testa", {},
    el("div.prodotto__indice", { class: s.fascia ? `indice--${s.fascia}` : "" },
      el("b.display", {}, s.indice == null ? "—" : String(s.indice)),
      el("small", {}, s.indice == null ? "senza indice" : NOME_FASCIA[s.fascia])),
    el("div.prodotto__nome", {},
      el("b", {}, s.nome || "Prodotto senza nome"),
      el("span", {}, [s.marca, s.quantita].filter(Boolean).join(" · ") || " "),
      s.categoria ? el("span.meta", {}, s.categoria) : null),
  );
  const avvisi = [];
  if (s.indice == null) avvisi.push("Dati insufficienti per una valutazione: la scheda non ha Nutri-Score né ingredienti.");
  else if (s.parziale) avvisi.push(`Valutazione parziale: ${s.mancano.map((k) => NOME_COMPONENTE[k]).join(", ")} non ${s.mancano.length > 1 ? "noti" : "noto"}.`);
  if (s.additivi?.some((a) => a.rischio === "alto")) avvisi.push("Contiene un additivo a rischio alto (EFSA): l'indice non supera 49.");

  const additivi = s.additivi || [];
  const righeAdditivi = additivi.length
    ? el("ul.additivi", {}, ...additivi.map((a) => el("li", { class: a.rischio ? `rischio--${a.rischio}` : "" },
        el("b", {}, a.codice), " ", a.nome,
        a.classe ? el("small", {}, ` · ${a.classe}`) : null,
        a.rischio && a.rischio !== "nessuno" ? el("small.rischio", {}, ` · rischio ${a.rischio}`) : null)))
    : null;

  const nutr = s.nutrienti || {};
  const valori = [["Energia", nutr.kcal == null ? null : `${n1(nutr.kcal)} kcal`], ["Grassi", nutr.grassi, "grassi"], ["di cui saturi", nutr.saturi, "saturi"],
    ["Zuccheri", nutr.zuccheri, "zuccheri"], ["Sale", nutr.sale, "sale"], ["Fibre", nutr.fibre], ["Proteine", nutr.proteine]];
  const livello = { low: "basso", moderate: "medio", high: "alto" };
  const chiaveLivello = { grassi: "fat", saturi: "saturated-fat", zuccheri: "sugars", sale: "salt" };
  const tabella = el("div.valori", {}, ...valori.filter(([, v]) => v != null).map(([k, v, liv]) => el("div.riga.riga--dato", {},
    el("div.testo", {}, el("b", {}, k)),
    liv && s.livelli?.[chiaveLivello[liv]] ? el("span.meta", {}, livello[s.livelli[chiaveLivello[liv]]] || "") : null,
    el("span", {}, typeof v === "number" ? `${n1(v)} g` : v))));
  const apriValori = el("button.nota__apri", { type: "button", "aria-expanded": "false" }, "Valori per 100 g", icon("giu"));
  tabella.hidden = true;
  apriValori.addEventListener("click", () => { tabella.hidden = !tabella.hidden; apriValori.setAttribute("aria-expanded", String(!tabella.hidden)); });

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
    rigaDato("Nutri-Score", pillolaGrado(s.nutriscore?.grado), "qualità nutrizionale"),
    rigaDato("Additivi", el("span", {}, s.ingredientiNoti ? String(additivi.length) : "?"), s.ingredientiNoti ? (additivi.length ? "elenco sotto" : "nessuno") : "ingredienti non noti"),
    righeAdditivi,
    rigaDato("Trasformazione", el("span", {}, s.nova ? `NOVA ${s.nova}` : "—"), s.nova ? NOME_NOVA[s.nova] : "non nota"),
    s.componenti?.bio?.stato === "ignoto"
      ? rigaDato("Biologico", el("span", {}, "?"), "non noto: la scheda è senza ingredienti")
      : rigaDato("Biologico", el("span", {}, s.bio ? "Sì" : "No"), s.etichette?.length ? s.etichette.slice(0, 3).join(", ") : null),
    valori.some(([, v]) => v != null) ? apriValori : null,
    tabella,
    fonte,
  ];
}

/**
 * Scheda del prodotto `ean`. Se c'è `inLista`, in basso le azioni per metterlo nella lista:
 * inLista({ ean, scheda, nome, preso }) → la Lista crea o aggiorna la voce.
 * `voci` sono le voci esistenti (per suggerire il nome), `nomeIniziale` il nome già in lista.
 */
export async function apriProdotto(ean, opzioni = {}) {
  const attesa = foglioAttesa(ean);
  let scheda;
  try {
    scheda = (await chiama(opzioni.aggiorna ? { ean, aggiorna: true } : { ean })).data;
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
  const rileggi = () => apriProdotto(s.ean, { ...opzioni, aggiorna: true, nomeIniziale: nome?.value.trim() || nomeIniziale });
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
