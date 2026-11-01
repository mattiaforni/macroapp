// «Completa»: contribuire a Open Food Facts / Open Beauty Facts da una scheda mancante o incompleta (1/11,
// richiesta di Mattia: «zero fatica o quasi»). Tre foto con la fotocamera dentro l'app (fronte, ingredienti,
// valori nutrizionali; «Salta» per quella che non c'è), il server le fa leggere a Claude, un riepilogo dei soli
// campi che su OFF mancano (correggibili, ma basta «Invia»), poi la function `contribuisci` scrive su OFF e
// ricarica la scheda. L'account OFF si chiede la prima volta, nello stesso riepilogo, e resta sul server.
// Tutto nello stesso foglio (stessoFoglio): attese e passaggi non lampeggiano.
import { el, icon, toast } from "../core/ui.js";
import { functions } from "../core/firebase.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-functions.js";
import { openSheet, campo } from "./sheet.js";

const contribuisci = httpsCallable(functions, "contribuisci", { timeout: 130000 });

const PASSI = {
  front: ["Fronte", "Nome e marca ben leggibili."],
  ingredients: ["Ingredienti", "Tutta la lista, da vicino."],
  nutrition: ["Valori nutrizionali", "La tabella intera. Salta se è un cosmetico."],
};
const LATO_MAX = 2000; // px: abbastanza per leggere una tabella, sotto 1 MB in JPEG

function messaggio(e) {
  const c = e?.code || "";
  if (/permission-denied/.test(c)) return "Open Food Facts non accetta nome utente e password";
  if (/failed-precondition/.test(c)) return e.message || "Serve l'account di Open Food Facts";
  if (/unavailable/.test(c)) return e.message || "Open Food Facts non risponde adesso";
  if (/deadline-exceeded/.test(c)) return "Ci ha messo troppo: riprova";
  return e?.message || "Non riuscito";
}

/** Foto dalla fotocamera: ImageCapture (scatto vero, con la messa a fuoco) se c'è, altrimenti il fotogramma del video. */
async function scatta(video, traccia) {
  let sorgente = video, w = video.videoWidth, h = video.videoHeight;
  if (traccia && "ImageCapture" in window) {
    try {
      const blob = await new ImageCapture(traccia).takePhoto();
      sorgente = await createImageBitmap(blob);
      w = sorgente.width; h = sorgente.height;
    } catch (e) { /* si usa il fotogramma */ }
  }
  if (!w || !h) return null;
  const k = Math.min(1, LATO_MAX / Math.max(w, h));
  const tela = document.createElement("canvas");
  tela.width = Math.round(w * k); tela.height = Math.round(h * k);
  tela.getContext("2d").drawImage(sorgente, 0, 0, tela.width, tela.height);
  return tela.toDataURL("image/jpeg", 0.85);
}

/** Da un file scelto (telefono senza fotocamera nell'app) allo stesso formato. */
async function daFile(file) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, LATO_MAX / Math.max(img.width, img.height));
  const tela = document.createElement("canvas");
  tela.width = Math.round(img.width * k); tela.height = Math.round(img.height * k);
  tela.getContext("2d").drawImage(img, 0, 0, tela.width, tela.height);
  return tela.toDataURL("image/jpeg", 0.85);
}

const perIlServer = (foto) => foto.map((f) => ({ campo: f.campo, mime: "image/jpeg", dati: f.url.split(",")[1] }));

/**
 * Avvia «Completa» per la scheda `s` (anche { trovato: false, ean }). `mostra(scheda)` disegna la scheda aggiornata
 * nello stesso foglio (la passa prodotto.js, che la sa disegnare).
 */
export function completaScheda(s, { mostra }) {
  const tipoNoto = s.trovato ? (s.tipo === "beauty" ? "beauty" : "food") : null;
  const campi = tipoNoto === "beauty" ? ["front", "ingredients"] : ["front", "ingredients", "nutrition"];
  fotografa(s.ean, campi, (foto) => leggi(s.ean, foto, tipoNoto, mostra));
}

// ───────────── 1. Foto ─────────────
function fotografa(ean, campi, poi) {
  const foto = [];
  let i = 0, stream = null, traccia = null, finito = false;
  const titolo = el("b");
  const aiuto = el("span");
  const video = el("video.scanner__video", { autoplay: true, muted: true, playsinline: true });
  const mirino = el("div.scanner.scanner--foto", {}, video);
  const file = el("input", { type: "file", accept: "image/*", capture: "environment", hidden: true });
  const miniature = el("div.foto-miniature");
  const stato = el("p.meta");

  function spegni() { stream?.getTracks().forEach((t) => t.stop()); stream = null; }
  function disegna() {
    const [nome, consiglio] = PASSI[campi[i]];
    titolo.textContent = `${i + 1} di ${campi.length} · ${nome}`;
    aiuto.textContent = consiglio;
    miniature.replaceChildren(...foto.map((f) => el("figure", {}, el("img", { src: f.url, alt: PASSI[f.campo][0] }), el("figcaption", {}, PASSI[f.campo][0]))));
  }
  function avanti() {
    i++;
    if (i < campi.length) { disegna(); return; }
    finito = true;
    spegni();
    if (!foto.length) { sheet.close(); return; }
    poi(foto);
  }

  const sheet = openSheet({
    title: "Completa",
    body: [el("div.contributo__passo", {}, titolo, aiuto), mirino, stato, miniature, file],
    confirmLabel: "Scatta",
    onConfirm: async () => {
      if (!stream) { file.click(); return false; }
      const url = await scatta(video, traccia);
      if (!url) return false;
      foto.push({ campo: campi[i], url });
      if (navigator.vibrate) navigator.vibrate(30);
      avanti();
      return false; // il foglio resta: passa alla foto dopo o alla lettura
    },
    azioni: [el("button.btn", { type: "button", onclick: () => avanti() }, "Salta")],
  });
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    foto.push({ campo: campi[i], url: await daFile(f) });
    avanti();
  });
  // Chiuso con indietro: la fotocamera si spegne.
  const host = document.getElementById("foglio");
  const osserva = new MutationObserver(() => { if (host.hidden || !host.contains(video)) { osserva.disconnect(); spegni(); } });
  osserva.observe(host, { attributes: true, childList: true });

  disegna();
  (async () => {
    if (!navigator.mediaDevices?.getUserMedia) { mirino.remove(); stato.textContent = "Tocca «Scatta» per aprire la fotocamera del telefono."; return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false });
      if (finito) { spegni(); return; }
      traccia = stream.getVideoTracks()[0] || null;
      video.srcObject = stream;
      await video.play().catch(() => {});
    } catch (e) {
      stream = null;
      mirino.remove();
      stato.textContent = "Fotocamera non disponibile qui: tocca «Scatta» per scegliere o fare la foto.";
    }
  })();
}

// ───────────── 2. Lettura ─────────────
function attesa(titolo, sotto, foto = []) {
  return openSheet({
    title: "Completa",
    stessoFoglio: true,
    body: [
      el("div.prodotto__testa", { role: "status", "aria-busy": "true" },
        el("div.prodotto__indice.prodotto__indice--attesa", { "aria-hidden": "true" }),
        el("div.prodotto__nome", {}, el("b", {}, titolo), el("span", {}, sotto))),
      foto.length ? el("div.foto-miniature", {}, ...foto.map((f) => el("figure", {}, el("img", { src: f.url, alt: PASSI[f.campo][0] })))) : null,
    ].filter(Boolean),
  });
}

function errore(testo, riprova) {
  openSheet({
    title: "Completa",
    stessoFoglio: true,
    body: [el("div.prodotto__testa", {},
      el("div.prodotto__indice", {}, el("b.display", {}, "!"), el("small", {}, "non riuscito")),
      el("div.prodotto__nome", {}, el("b", {}, testo)))],
    onConfirm: () => { riprova(); return false; },
    confirmLabel: "Riprova",
  });
}

async function leggi(ean, foto, tipoNoto, mostra) {
  const foglio = attesa("Leggo le etichette…", "Ci vogliono una decina di secondi", foto);
  let r;
  try {
    r = (await contribuisci({ azione: "leggi", ean, foto: perIlServer(foto) })).data;
  } catch (e) {
    if (foglio.aperto()) errore(messaggio(e), () => leggi(ean, foto, tipoNoto, mostra));
    return;
  }
  if (foglio.aperto()) riepilogo(ean, foto, r, mostra);
}

// ───────────── 3. Riepilogo e invio ─────────────
const VOCI = [["nome", "Nome"], ["marca", "Marca"], ["quantita", "Quantità"], ["categoria", "Tipo di prodotto"]];
const NUTRIENTI = [["kcal", "Energia (kcal)"], ["grassi", "Grassi"], ["saturi", "di cui saturi"], ["carboidrati", "Carboidrati"],
  ["zuccheri", "di cui zuccheri"], ["fibre", "Fibre"], ["proteine", "Proteine"], ["sale", "Sale"]];
const NOMI_MANCANTI = { nome: "nome", marca: "marca", quantita: "quantità", categoria: "tipo", ingredienti: "ingredienti", nutrizione: "valori" };
const numeroScritto = (x) => (x == null ? "" : String(x).replace(".", ","));
const numeroLetto = (s) => { const n = parseFloat(String(s || "").replace(",", ".")); return isFinite(n) ? n : null; };

function riepilogo(ean, foto, r, mostra, { rifiutato = false } = {}) {
  const { letti, mancanti, tipo, account } = r;
  const manca = new Set(mancanti);
  const presenti = Object.keys(NOMI_MANCANTI).filter((k) => !manca.has(k) && (tipo !== "beauty" || k !== "nutrizione"));
  const input = {};
  const corpo = [];
  if (rifiutato) corpo.push(el("p.meta.prodotto__avviso.contributo__rifiutato", {}, "Open Food Facts non ha accettato nome utente e password: riscrivili."));
  if (letti.nota) corpo.push(el("p.meta.prodotto__avviso", {}, letti.nota));

  const righe = VOCI.filter(([k]) => manca.has(k)).map(([k, etichetta]) => {
    input[k] = el("input", { value: letti[k] || "", placeholder: "non letto", enterkeyhint: "next", "aria-label": etichetta });
    return campo(etichetta, input[k]);
  });
  if (manca.has("ingredienti")) {
    input.ingredienti = el("textarea", { rows: 3, placeholder: "non letti", "aria-label": "Ingredienti" });
    input.ingredienti.value = letti.ingredienti || "";
    righe.push(campo("Ingredienti", input.ingredienti));
  }
  if (righe.length) corpo.push(...righe);

  const nutr = letti.nutrizione;
  if (tipo !== "beauty" && manca.has("nutrizione")) {
    if (nutr) {
      input.nutrizione = {};
      corpo.push(el("div.prodotto__sezione", {}, el("h3", {}, "Valori"), el("span", {}, nutr.per === "100ml" ? "per 100 ml" : "per 100 g")),
        // Come la tabella dell'etichetta (1/11, Mattia: «i di cui sono sfalsati» nella griglia a due colonne): una riga per
        // valore, nome a sinistra, cifra e unità allineate a destra, «di cui» rientrati sotto la loro voce.
        el("div.contributo__valori", {}, ...NUTRIENTI.map(([k, etichetta]) => {
          input.nutrizione[k] = el("input", { value: numeroScritto(nutr[k]), inputmode: "decimal", placeholder: "—", enterkeyhint: "next", "aria-label": etichetta });
          return el(`label.contributo__valore${etichetta.startsWith("di cui") ? ".contributo__valore--dicui" : ""}`, {},
            el("span", {}, etichetta.replace(/ \(kcal\)$/, "")), input.nutrizione[k], el("small", {}, k === "kcal" ? "kcal" : "g"));
        })));
    } else {
      corpo.push(el("p.meta", {}, "Valori nutrizionali non letti: si aggiungono solo i dati sopra."));
    }
  }
  const daInviare = righe.length || input.nutrizione;
  if (!daInviare) corpo.push(el("p.meta", {}, "Non ho letto niente di nuovo da aggiungere: carico solo le foto."));
  if (presenti.length) corpo.push(el("p.meta.contributo__presenti", {}, `Già su Open Food Facts: ${presenti.map((k) => NOMI_MANCANTI[k]).join(", ")}.`));

  // Account: la prima volta (o «cambia») nome utente e password; poi resta sul server.
  const utente = el("input", { autocomplete: "username", autocapitalize: "none", placeholder: "nome utente, non l'email", "aria-label": "Nome utente di Open Food Facts" });
  const password = el("input", { type: "password", autocomplete: "current-password", "aria-label": "Password di Open Food Facts" });
  const campiAccount = el("div.contributo__account", {}, campo("Nome utente di Open Food Facts", utente), campo("Password", password),
    el("p.meta", {}, "Si chiede una volta: resta sul server dell'app, non sul telefono."));
  let chiediAccount = !account || rifiutato;
  campiAccount.hidden = !chiediAccount;
  const cambia = el("a", { href: "#", role: "button", onclick: (e) => { e.preventDefault(); chiediAccount = true; campiAccount.hidden = false; rigaAccount?.remove(); setTimeout(() => utente.focus(), 30); } }, "cambia");
  const rigaAccount = account && !rifiutato ? el("p.meta.contributo__chi", {}, `Invio come ${account.utente} · `, cambia) : null;
  if (rifiutato && account) utente.value = account.utente;
  corpo.push(...[rigaAccount, campiAccount].filter(Boolean));
  corpo.push(el("p.meta.contributo__pubblico", {}, "Foto e dati diventano pubblici su Open Food Facts (licenze aperte), col tuo nome utente."));

  const raccogli = () => {
    const campi = { tipo: letti.tipo, linguaIngredienti: letti.linguaIngredienti };
    for (const [k] of VOCI) if (input[k]) campi[k] = input[k].value.trim();
    if (input.ingredienti) campi.ingredienti = input.ingredienti.value.trim();
    if (input.nutrizione) campi.nutrizione = { per: nutr.per, ...Object.fromEntries(NUTRIENTI.map(([k]) => [k, numeroLetto(input.nutrizione[k].value)])), kj: nutr.kj };
    return campi;
  };
  // Account rifiutato: si torna qui, con nome utente e password da riscrivere (le correzioni ai campi restano).
  const invia = (campi, conto) => manda(ean, foto, campi, tipo, conto, mostra,
    () => riepilogo(ean, foto, { ...r, letti: { ...letti, ...campi, nutrizione: campi.nutrizione || letti.nutrizione }, account: conto || account }, mostra, { rifiutato: true }));
  const rifai = () => fotografa(ean, tipo === "beauty" ? ["front", "ingredients"] : ["front", "ingredients", "nutrition"], (nuove) => leggi(ean, nuove, tipo, mostra));

  openSheet({
    title: "Da aggiungere",
    stessoFoglio: true,
    body: corpo,
    confirmLabel: "Invia",
    onConfirm: () => {
      let conto = null;
      if (chiediAccount) {
        if (!utente.value.trim()) { utente.focus(); return false; }
        if (!password.value) { password.focus(); return false; }
        conto = { utente: utente.value.trim(), password: password.value };
      }
      invia(raccogli(), conto);
      return false;
    },
    azioni: [el("button.btn", { type: "button", onclick: rifai }, icon("fotocamera"), "Rifai le foto")],
  });
  password.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); document.querySelector("#foglio .btn--conferma")?.click(); } });
}

async function manda(ean, foto, campi, tipo, conto, mostra, rifiutato) {
  const foglio = attesa("Aggiungo a Open Food Facts…", "Carico le foto e i dati", foto);
  let r;
  try {
    r = (await contribuisci({ azione: "invia", ean, foto: perIlServer(foto), campi, tipo, ...(conto ? { account: conto } : {}) })).data;
  } catch (e) {
    if (!foglio.aperto()) return;
    if (/permission-denied|failed-precondition/.test(e?.code || "")) { rifiutato(); return; }
    errore(messaggio(e), () => manda(ean, foto, campi, tipo, conto, mostra, rifiutato));
    return;
  }
  if (!foglio.aperto()) return;
  toast(r.avvisi?.length ? "Scheda aggiornata (qualche foto non è passata)" : "Grazie: scheda aggiornata su Open Food Facts", { ms: 4000 });
  mostra(r.scheda);
}
