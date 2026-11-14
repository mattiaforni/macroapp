// Nota vocale: registra dal microfono e trascrive con la function `trascrivi` (Gemini; Claude non accetta audio).
// Si parla quanto serve, senza le interruzioni del microfono della tastiera, con il vocabolario del progetto (nome,
// istruzioni, temi della sintesi) e i nomi della rubrica.
//
// A pezzi, mentre parli (14/11, richiesta di Mattia: «non vedo quello che sto trascrivendo via via» e «se blocco lo
// schermo la trascrizione non registra quello che ho detto»). La registrazione si taglia nelle pause (al primo
// silenzio dopo PEZZO_MIN_S, al più tardi dopo PEZZO_MAX_S) e ogni pezzo si trascrive subito, in ordine, con la fine
// del testo già trascritto come contesto: il testo compare nel campo una frase alla volta. Ferma trascrive solo
// l'ultimo pezzo. Non parola per parola: il riconoscimento dal vivo del telefono (Web Speech) si contende il
// microfono con la registrazione su Android, e Gemini sul pezzo intero scrive meglio nomi e termini.
//
// Niente si perde. Ogni secondo di audio va nell'archivio del telefono (core/archivio.js, IndexedDB) insieme al testo
// già trascritto, e ci resta finché la nota non è salvata (`conclusa()`). Un pezzo la cui trascrizione non arriva
// (telefono bloccato, rete) si riprova da solo, anche tornando nell'app; se l'app si chiude o il foglio si chiude
// senza salvare, la registrazione resta e il Diario la offre in cima («Note vocali da salvare», `sospese()`), con il
// testo già trascritto e il resto da trascrivere. Se il telefono smette di dare audio (schermo spento, una chiamata),
// lo si dice tornando nell'app. Solo le note del diario (`archivia: true`) si tengono; le istruzioni di un progetto
// si trascrivono a pezzi allo stesso modo, ma in memoria.
//
// sessioni/{id} = { id, inizio, durataMs, mimeType, projectId, stato: "registra" | "ferma", pezzi: { n: { stato:
//   "attesa" | "fatto" | "vuoto", testo, aCapo } }, aggiornata }
// audio/{id}|{n}|{i} = pezzo di un secondo (Blob) del pezzo n
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-functions.js";
import { functions } from "../core/firebase.js";
import { el, icon, toast } from "../core/ui.js";
import * as archivio from "../core/archivio.js";

const trascrivi = httpsCallable(functions, "trascrivi", { timeout: 70000 }); // la function ha 120 s; un pezzo è corto
const MASSIMO_S = 45 * 60;   // oltre si ferma da sola
const BITRATE = 32000;       // voce: 32 kbit/s bastano, ~240 KB al minuto
const PEZZO_MIN_S = 6;       // un pezzo si chiude al primo silenzio dopo questi secondi…
const PEZZO_MAX_S = 30;      // …o dopo questi, appena la voce si abbassa…
const PEZZO_DURO_S = 45;     // …o comunque dopo questi
const PAUSA_MS = 600;        // quanto silenzio è una pausa
const A_CAPO_MS = 2200;      // una pausa più lunga di così, tra due pezzi, va a capo
const CONTESTO = 400;        // caratteri del testo precedente mandati con ogni pezzo
const BUCO_MS = 3000;        // il telefono non ha dato audio per più di così: lo si dice

export const registrazionePossibile = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

function formato() {
  for (const t of ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"]) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) {}
  }
  return "";
}

export const durata = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const n4 = (n) => String(n).padStart(4, "0");
const n5 = (n) => String(n).padStart(5, "0");

function inBase64(blob) {
  return new Promise((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] || "");
    r.onerror = () => ko(r.error);
    r.readAsDataURL(blob);
  });
}

// ───────────── Sessioni nell'archivio ─────────────

/** Sessioni seguite da un pulsante in questa pagina: sid → occupata() (foglio aperto o pezzi ancora da trascrivere in
 *  memoria). Finché lo è non è «da salvare»: un secondo pulsante la trascriverebbe due volte. */
const attive = new Map();
const occupata = (sid) => !!attive.get(sid)?.();
const avvisa = () => window.dispatchEvent(new Event("registrazioni"));

/** Il testo trascritto finora di una sessione, pezzi in ordine; una pausa lunga tra due pezzi va a capo. */
export function testoDi(sessione) {
  let testo = "";
  for (const [, p] of Object.entries(sessione?.pezzi || {}).sort(([a], [b]) => a - b)) {
    if (p.stato !== "fatto" || !p.testo) continue;
    testo = testo ? `${testo}${p.aCapo ? "\n\n" : " "}${p.testo}` : p.testo;
  }
  return testo;
}

/** I numeri dei pezzi di una sessione che hanno audio nell'archivio e non sono ancora trascritti. */
async function pezziInAttesa(s) {
  const chiavi = await archivio.tutti("audio", `${s.id}|`);
  const numeri = new Set(chiavi.map(([k]) => Number(String(k).split("|")[1])));
  return [...numeri].filter((n) => !["fatto", "vuoto", "salvato"].includes(s.pezzi?.[n]?.stato)).sort((a, b) => a - b);
}

/**
 * Le note vocali non salvate su questo telefono (app chiusa durante la registrazione, foglio chiuso senza salvare),
 * dalla più recente: [{ id, inizio, durataMs, projectId, testo, daTrascrivere }]. Quelle senza testo né audio si buttano.
 */
export async function sospese() {
  const out = [];
  for (const [, s] of await archivio.tutti("sessioni")) {
    if (!s?.id || occupata(s.id)) continue;
    const resto = await pezziInAttesa(s);
    const testo = testoDi(s);
    if (!testo && !resto.length) { elimina(s.id); continue; }
    out.push({ id: s.id, inizio: s.inizio, durataMs: s.durataMs || 0, projectId: s.projectId || null, testo, daTrascrivere: resto.length });
  }
  return out.sort((a, b) => b.inizio - a.inizio);
}

/** Toglie una registrazione dal telefono (audio e testo). */
export async function elimina(id) {
  await Promise.all([archivio.togli("sessioni", id), archivio.togliTutti("audio", `${id}|`)]);
  avvisa();
}

// ───────────── Pulsante ─────────────

/**
 * Pulsante «Registra». `inserisci(testo, { primo, aCapo })` riceve ogni pezzo trascritto: `primo` per il primo pezzo
 * di una registrazione (va staccato da ciò che c'era), `aCapo` dopo una pausa lunga. `progetto()` dice il progetto
 * scelto nel foglio in quel momento (per il vocabolario); `cosa` completa l'etichetta per chi legge lo schermo.
 * `archivia`: la registrazione resta sul telefono finché non chiami `conclusa()` (nota del diario salvata).
 * `riprendi`: id di una registrazione non salvata (sospese()) di cui finire la trascrizione in questo foglio; il testo
 * già trascritto lo mette chi apre il foglio. `onStato({ stato, inAttesa })` a ogni cambio (fermo | registra | trascrive).
 * Ritorna il pulsante, con `attendi(ms)` (ferma la registrazione e aspetta gli ultimi pezzi: true se sono arrivati tutti)
 * e `conclusa()` (nota salvata: la registrazione si toglie dal telefono; un pezzo che non è ancora arrivato resta, e
 * il Diario lo offre da solo quando è trascritto).
 */
export function pulsanteRegistra({ inserisci, progetto = () => null, cosa = "una nota vocale", archivia = false, riprendi = null, onStato = () => {} }) {
  let stato = "fermo"; // fermo | registra | trascrive
  let flusso = null, contesto = null, misura = null, tic = null, veglia = null;
  let sessione = null;         // la registrazione in corso (o ripresa)
  let corrente = null;         // il registratore del pezzo in corso: { rec, n, pezzi, voce, inizio, aCapo, conta }
  let numero = 0;              // prossimo numero di pezzo
  let inizio = 0;              // inizio della registrazione (ms)
  let silenzioDa = 0, fondo = 0.01, livello = 0, mutoDa = 0;
  const coda = [];             // pezzi da trascrivere: { sid, n, blob?, aCapo, mimeType, projectId }
  let lavorando = false, tentativi = 0, fermoPerErrore = false;
  const mie = new Set();       // sessioni nate o riprese qui: conclusa() le toglie
  const mia = (sid) => () => vivo() || !!corrente && corrente.sid === sid || coda.some((p) => p.sid === sid);
  const prendi = (sid) => { mie.add(sid); attive.set(sid, mia(sid)); sorveglia(); };
  // Quando il foglio si chiude (salvato o no) il Diario deve saperlo: una registrazione non salvata diventa «da salvare».
  let guardia = null;
  function sorveglia() {
    if (guardia) return;
    guardia = setInterval(() => { if (!vivo()) { clearInterval(guardia); guardia = null; avvisa(); } }, 700);
  }
  const testoFinora = new Map(); // sid → testo trascritto finora (contesto del pezzo dopo)
  const primoInserito = new Set(); // sid di cui un pezzo è già entrato nel campo

  const btn = el("button.pillola", { type: "button", onclick: () => { if (stato === "registra") ferma(); else if (stato === "fermo" || coda.length) avvia(); } });
  const vivo = () => btn.isConnected;
  const inAttesa = () => coda.length + (corrente ? 1 : 0);

  function disegna() {
    btn.disabled = stato === "trascrive" && !fermoPerErrore;
    btn.classList.toggle("registra--attiva", stato === "registra");
    btn.setAttribute("aria-label", stato === "registra" ? "Ferma la registrazione" : stato === "trascrive" ? "Trascrivo" : `Registra ${cosa}`);
    if (stato === "registra") {
      const punto = el("span.registra__punto");
      punto.style.setProperty("--livello", String(Math.min(1, livello * 12).toFixed(2)));
      btn.replaceChildren(punto, durata((Date.now() - inizio) / 1000), " · Ferma");
    } else if (stato === "trascrive") btn.replaceChildren(icon("microfono"), fermoPerErrore ? "Riprova" : "Trascrivo…");
    else btn.replaceChildren(icon("microfono"), "Registra");
  }
  let ultimoStato = "";
  function cambia(s) {
    stato = s;
    disegna();
    const chiave = `${stato}:${inAttesa()}`;
    if (chiave !== ultimoStato) { ultimoStato = chiave; try { onStato({ stato, inAttesa: inAttesa() }); } catch (e) {} }
  }

  // ── Archivio ──
  const salvaSessione = () => (archivia && sessione ? archivio.metti("sessioni", sessione.id, { ...sessione, aggiornata: Date.now() }) : Promise.resolve());

  // ── Microfono e livello della voce ──
  function libera() {
    clearInterval(tic); tic = null;
    flusso?.getTracks().forEach((t) => t.stop()); flusso = null;
    contesto?.close?.().catch(() => {}); contesto = null; misura = null;
    veglia?.release?.().catch(() => {}); veglia = null;
    document.removeEventListener("visibilitychange", suVisibilita);
  }

  function ascolta() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      contesto = new AC();
      const sorgente = contesto.createMediaStreamSource(flusso);
      misura = contesto.createAnalyser();
      misura.fftSize = 1024;
      sorgente.connect(misura);
      contesto.resume?.().catch(() => {});
    } catch (e) { contesto = null; misura = null; } // senza livello: pezzi tagliati a tempo
  }
  const campioni = new Float32Array(1024);
  /** RMS dell'ultimo istante, e se c'è voce: sopra il fondo del rumore, che si adatta piano. */
  function senti() {
    // Senza livello (o con l'audio del browser sospeso, che darebbe solo zeri) tutto conta come voce: niente si butta.
    if (!misura || contesto?.state !== "running") return { voce: true, rms: 0.05 };
    misura.getFloatTimeDomainData(campioni);
    let s = 0;
    for (const x of campioni) s += x * x;
    const rms = Math.sqrt(s / campioni.length);
    fondo = rms < fondo ? rms : fondo + (rms - fondo) * 0.005;
    return { voce: rms > Math.max(0.012, fondo * 3), rms };
  }

  // ── Pezzi ──
  function nuovoPezzo(aCapo) {
    const tipo = sessione.mimeType;
    let rec;
    try { rec = new MediaRecorder(flusso, { ...(tipo ? { mimeType: tipo } : {}), audioBitsPerSecond: BITRATE }); }
    catch (e) { rec = new MediaRecorder(flusso); }
    const p = { rec, n: numero++, pezzi: [], voce: false, inizio: Date.now(), aCapo, conta: 0, sid: sessione.id };
    rec.ondataavailable = (e) => {
      if (!e.data?.size) return;
      p.pezzi.push(e.data);
      if (archivia) archivio.metti("audio", `${p.sid}|${n4(p.n)}|${n5(p.conta++)}`, e.data);
    };
    rec.onstop = () => chiudiPezzo(p);
    rec.start(1000); // un pezzo al secondo: se la registrazione si interrompe, quello che c'è resta
    return p;
  }

  /** Taglia nella pausa: il pezzo nuovo parte prima che il vecchio si fermi, così non manca nulla. */
  function taglia() {
    const vecchio = corrente;
    corrente = nuovoPezzo(false);
    setTimeout(() => { if (vecchio.rec.state !== "inactive") vecchio.rec.stop(); }, 250);
  }

  function chiudiPezzo(p) {
    const tipo = p.rec.mimeType || p.pezzi[0]?.type || sessione?.mimeType || "audio/webm";
    if (!p.voce || !p.pezzi.length) {
      // Solo silenzio: niente da trascrivere.
      if (sessione?.id === p.sid) { sessione.pezzi[p.n] = { stato: "vuoto" }; salvaSessione(); }
      if (archivia) archivio.togliTutti("audio", `${p.sid}|${n4(p.n)}|`);
    } else {
      if (sessione?.id === p.sid) { sessione.pezzi[p.n] = { stato: "attesa", aCapo: p.aCapo }; salvaSessione(); }
      coda.push({ sid: p.sid, n: p.n, blob: new Blob(p.pezzi, { type: tipo }), aCapo: p.aCapo, mimeType: tipo, projectId: sessione?.projectId || null });
    }
    if (corrente === p) corrente = null;
    if (stato === "trascrive" || stato === "fermo") cambia(coda.length || corrente ? "trascrive" : "fermo");
    lavora();
  }

  // ── Trascrizione dei pezzi, in ordine ──
  const definitivo = (e) => /^(functions\/)?(invalid-argument|failed-precondition|resource-exhausted|permission-denied|unauthenticated)$/.test(e?.code || "");
  let sveglia = null;
  function attendi(ms) {
    return new Promise((ok) => {
      const fatto = () => { clearTimeout(t); window.removeEventListener("online", fatto); document.removeEventListener("visibilitychange", seVisibile); sveglia = null; ok(); };
      const seVisibile = () => { if (document.visibilityState === "visible") fatto(); };
      const t = setTimeout(() => { if (document.visibilityState === "visible") fatto(); }, ms); // in secondo piano si aspetta il ritorno
      window.addEventListener("online", fatto);
      document.addEventListener("visibilitychange", seVisibile);
      sveglia = fatto;
    });
  }

  async function lavora() {
    if (lavorando) return;
    lavorando = true;
    try {
      while (coda.length && !fermoPerErrore) {
        const p = coda[0];
        try {
          const testo = await trascriviPezzo(p);
          await registraTesto(p, testo);
          coda.shift();
          tentativi = 0;
        } catch (e) {
          console.warn("trascrivi", e);
          if (definitivo(e)) {
            fermoPerErrore = true;
            for (const f of attese.splice(0)) f(false);
            toast(`${e.message || "Trascrizione non riuscita"}. L'audio resta sul telefono: tocca «Riprova».`, { ms: 8000 });
            break;
          }
          tentativi++;
          // La prima volta in silenzio (spesso è solo la rete che torna), poi lo si dice.
          if (tentativi === 2 && vivo() && document.visibilityState === "visible") toast("La trascrizione non arriva: riprovo da solo, l'audio è al sicuro.", { ms: 4000 });
          await attendi(Math.min(30000, 1500 * 2 ** Math.min(tentativi - 1, 5)));
        }
      }
    } finally {
      lavorando = false;
      if (stato !== "registra") cambia(coda.length || corrente ? "trascrive" : "fermo");
      else cambia("registra");
      if (!coda.length && !corrente && stato === "fermo") finita();
    }
  }

  async function trascriviPezzo(p) {
    let blob = p.blob;
    if (!blob) {
      const pezzi = await archivio.tutti("audio", `${p.sid}|${n4(p.n)}|`);
      blob = new Blob(pezzi.map(([, b]) => b), { type: p.mimeType || pezzi[0]?.[1]?.type || "audio/webm" });
      p.blob = blob;
    }
    if (blob.size < 1500) return "";
    const audio = await inBase64(blob);
    const prima = (testoFinora.get(p.sid) || "").slice(-CONTESTO);
    const res = await trascrivi({ audio, mimeType: blob.type || p.mimeType, projectId: progetto() || p.projectId || null, prima, pezzo: p.n });
    return String(res.data?.testo || "").trim();
  }

  /** Il testo di un pezzo: prima nella sessione sul telefono, poi via il suo audio (mai l'audio senza il testo). */
  async function registraTesto(p, testo) {
    const vuoto = !testo || /^\[(silenzio|incomprensibile)\]$/i.test(testo);
    const s = sessione?.id === p.sid ? sessione : null;
    if (s) { s.pezzi[p.n] = vuoto ? { stato: "vuoto" } : { stato: "fatto", testo, aCapo: p.aCapo }; await salvaSessione(); }
    else if (archivia) await aggiornaSessioneArchiviata(p, vuoto ? null : testo); // registrazione ripresa
    if (archivia) await archivio.togliTutti("audio", `${p.sid}|${n4(p.n)}|`);
    if (vuoto) return;
    testoFinora.set(p.sid, `${testoFinora.get(p.sid) || ""} ${testo}`.trim());
    if (!vivo()) { avvisa(); return; } // foglio chiuso: il testo resta nell'archivio, il Diario lo offre
    const primo = !primoInserito.has(p.sid);
    primoInserito.add(p.sid);
    inserisci(testo, { primo, aCapo: primo || p.aCapo });
  }

  async function aggiornaSessioneArchiviata(p, testo) {
    const s = await archivio.prendi("sessioni", p.sid);
    if (!s) return;
    s.pezzi[p.n] = testo ? { stato: "fatto", testo, aCapo: p.aCapo } : { stato: "vuoto" };
    await archivio.metti("sessioni", p.sid, s);
  }

  /** Registrazione chiusa e tutta trascritta. Il foglio aperto ne ha il testo; se è chiuso, resta per il Diario. */
  function finita() {
    if (!vivo()) avvisa();
    for (const f of attese.splice(0)) f(true);
  }
  const attese = [];

  // ── Comandi ──
  async function avvia() {
    // Dopo un errore definitivo il pulsante dice «Riprova»: riparte la coda, non una registrazione nuova.
    if (fermoPerErrore) { fermoPerErrore = false; tentativi = 0; cambia("trascrive"); lavora(); return; }
    if (!registrazionePossibile()) { toast("Questo browser non registra l'audio: usa il microfono della tastiera", { ms: 5000 }); return; }
    try {
      flusso = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      console.warn("registra", e);
      toast(e.name === "NotAllowedError" ? "Serve il permesso del microfono: consentilo dalle impostazioni del sito" : "Microfono non disponibile", { ms: 6000 });
      return;
    }
    inizio = Date.now();
    // Una seconda registrazione nello stesso foglio (o in quello di una registrazione ripresa) continua la stessa
    // sessione: una sola «nota vocale da salvare» per foglio. Il suo primo pezzo va a capo.
    if (sessione) {
      sessione.stato = "registra";
      sessione.projectId = progetto() || sessione.projectId || null;
    } else {
      numero = 0;
      sessione = { id: `${inizio.toString(36)}${Math.random().toString(36).slice(2, 6)}`, inizio, durataMs: 0, mimeType: formato(), projectId: progetto() || null, stato: "registra", pezzi: {} };
      prendi(sessione.id);
    }
    salvaSessione();
    ascolta();
    silenzioDa = 0; mutoDa = 0;
    corrente = nuovoPezzo(true);
    const traccia = flusso.getAudioTracks()[0];
    // Il telefono smette di dare audio (schermo spento, una chiamata): lo si dice al ritorno. Se la traccia finisce, si ferma.
    if (traccia) {
      traccia.onmute = () => { mutoDa = Date.now(); };
      traccia.onunmute = () => { const buco = mutoDa ? Date.now() - mutoDa : 0; mutoDa = 0; if (buco > BUCO_MS) buchi.push(buco); avvisaBuchi(); };
      traccia.onended = () => { if (stato === "registra") { toast("La registrazione si è interrotta: tengo quello che c'è", { ms: 5000 }); ferma(); } };
    }
    cambia("registra");
    // Schermo acceso mentre si parla; si richiede tornando nell'app.
    prendiVeglia();
    document.addEventListener("visibilitychange", suVisibilita);
    let ultimo = Date.now();
    tic = setInterval(() => {
      const ora = Date.now();
      if (archivia && !vivo() && stato === "registra") { // foglio chiuso: si ferma e si tiene tutto
        ferma();
        return;
      }
      if (!archivia && !vivo()) { scarta(); return; }
      if ((ora - inizio) / 1000 >= MASSIMO_S) { toast(`Registrazione al limite di ${MASSIMO_S / 60} minuti: la fermo`); ferma(); return; }
      const { voce, rms } = senti();
      livello = rms;
      // In secondo piano i timer rallentano (un giro al secondo o meno): si taglia solo a tempo, nel primo momento quieto.
      const fuori = document.visibilityState === "hidden" || ora - ultimo > 900;
      ultimo = ora;
      if (voce) {
        if (!corrente.voce) corrente.aCapo = corrente.aCapo || (silenzioDa && ora - silenzioDa >= A_CAPO_MS && corrente.n > 0);
        corrente.voce = true;
        silenzioDa = 0;
      } else if (!silenzioDa) silenzioDa = ora;
      const eta = (ora - corrente.inizio) / 1000;
      const pausa = silenzioDa ? ora - silenzioDa : 0;
      const quieto = !voce;
      if (corrente.voce && ((!fuori && eta >= PEZZO_MIN_S && pausa >= PAUSA_MS) || (eta >= PEZZO_MAX_S && quieto) || eta >= PEZZO_DURO_S)) taglia();
      disegna();
    }, 100);
  }

  const buchi = [];
  function avvisaBuchi() {
    if (!buchi.length || document.visibilityState !== "visible") return;
    const totale = buchi.reduce((a, b) => a + b, 0) / 1000;
    buchi.length = 0;
    toast(`Per ${durata(totale)} il telefono non ha dato audio (schermo spento o un'altra app): quel pezzo manca.`, { ms: 7000 });
  }
  async function prendiVeglia() {
    try { veglia = await navigator.wakeLock?.request("screen"); } catch (e) { veglia = null; }
  }
  function suVisibilita() {
    if (document.visibilityState !== "visible") return;
    if (stato === "registra" && (!veglia || veglia.released)) prendiVeglia();
    avvisaBuchi();
    sveglia?.();
  }

  function ferma() {
    if (sessione) { sessione.stato = "ferma"; sessione.durataMs = (sessione.durataMs || 0) + (Date.now() - inizio); salvaSessione(); }
    const p = corrente;
    if (p?.rec.state === "recording") p.rec.stop(); // → chiudiPezzo
    libera();
    cambia(coda.length || corrente ? "trascrive" : "fermo");
  }

  /** Foglio chiuso senza archivio (istruzioni): si butta tutto, come prima. */
  function scarta() {
    if (corrente) { corrente.rec.onstop = null; if (corrente.rec.state === "recording") corrente.rec.stop(); corrente = null; }
    coda.length = 0; libera(); stato = "fermo";
    for (const sid of mie) attive.delete(sid);
  }

  /** Prima di salvare: ferma la registrazione e aspetta gli ultimi pezzi, al più `ms` (true se sono arrivati tutti). */
  btn.attendi = (ms = 20000) => {
    if (stato === "registra") ferma();
    if (!coda.length && !corrente) return Promise.resolve(true);
    if (fermoPerErrore) return Promise.resolve(false);
    return new Promise((ok) => {
      const t = setTimeout(() => { attese.splice(attese.indexOf(fatto), 1); ok(false); }, ms);
      const fatto = (v) => { clearTimeout(t); ok(v); };
      attese.push(fatto);
    });
  };

  /** La nota è salvata: le registrazioni di questo foglio non servono più. Quella con un pezzo ancora da trascrivere
   *  resta, senza il testo già salvato: quando il pezzo arriva il Diario lo offre come nota vocale da salvare. */
  btn.conclusa = async () => {
    const resto = new Set([...coda.map((p) => p.sid), ...(corrente ? [corrente.sid] : [])]);
    for (const sid of mie) {
      if (!resto.has(sid)) { attive.delete(sid); elimina(sid); continue; }
      const s = sid === sessione?.id ? sessione : await archivio.prendi("sessioni", sid);
      if (!s) continue;
      for (const p of Object.values(s.pezzi || {})) if (p.stato === "fatto") { p.stato = "salvato"; delete p.testo; }
      if (archivia) await archivio.metti("sessioni", sid, s);
      testoFinora.delete(sid);
      primoInserito.delete(sid);
    }
    mie.clear();
  };

  // Ripresa di una registrazione non salvata: si finiscono i pezzi che mancano, in coda al testo già nel campo.
  if (riprendi) {
    prendi(riprendi);
    primoInserito.add(riprendi);
    cambia("trascrive");
    (async () => {
      const s = await archivio.prendi("sessioni", riprendi);
      if (!s) { cambia("fermo"); return; }
      // Da qui la sessione è di questo foglio: una registrazione nuova la continua.
      s.pezzi = s.pezzi || {};
      if (!sessione) { sessione = s; numero = Math.max(-1, ...Object.keys(s.pezzi).map(Number)) + 1; }
      testoFinora.set(riprendi, testoDi(s));
      const resto = await pezziInAttesa(s);
      // Un pezzo che stava registrando quando l'app si è chiusa: a capo se era il primo dopo una pausa, non si sa.
      for (const n of resto) coda.push({ sid: riprendi, n, aCapo: !!s.pezzi?.[n]?.aCapo, mimeType: s.mimeType, projectId: s.projectId || null });
      numero = Math.max(numero, ...resto.map((n) => n + 1));
      if (!coda.length) { cambia("fermo"); finita(); return; }
      lavora();
    })();
  } else disegna();
  return btn;
}
