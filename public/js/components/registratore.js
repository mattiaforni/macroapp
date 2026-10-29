// Nota vocale: registra dal microfono e trascrive con la function `trascrivi` (Gemini; Claude non accetta
// audio). È il flusso della dettatura dell'app Claude: si parla quanto serve, senza le interruzioni del
// microfono della tastiera, e la trascrizione si fa alla fine sul discorso intero, con il vocabolario del
// progetto (nome, istruzioni, temi della sintesi) e i nomi della rubrica.
// Pulsante per la barra del foglio (a sinistra di Salva): tocca per registrare, ritocca per fermare.
// Il microfono si libera appena si ferma o si chiude il foglio; l'audio non viene salvato.
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-functions.js";
import { functions } from "../core/firebase.js";
import { el, icon, toast } from "../core/ui.js";

const trascrivi = httpsCallable(functions, "trascrivi", { timeout: 130000 }); // la function ha 120 s
const MASSIMO_S = 20 * 60; // oltre si ferma da sola
const BITRATE = 32000;     // voce: 32 kbit/s bastano, ~240 KB al minuto

export const registrazionePossibile = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

function formato() {
  for (const t of ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"]) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) {}
  }
  return "";
}

const durata = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function inBase64(blob) {
  return new Promise((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] || "");
    r.onerror = () => ko(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Pulsante «Registra». inserisci(testo) riceve la trascrizione; progetto() dice il progetto scelto
 * nel foglio in quel momento (per il vocabolario); `cosa` completa l'etichetta per chi legge lo schermo
 * («Registra una nota vocale», «Registra le istruzioni»).
 */
export function pulsanteRegistra({ inserisci, progetto = () => null, cosa = "una nota vocale" }) {
  let stato = "fermo"; // fermo | registra | trascrive
  let rec = null, flusso = null, pezzi = [], inizio = 0, tic = null, veglia = null;
  const btn = el("button.pillola", { type: "button", onclick: () => { if (stato === "fermo") avvia(); else if (stato === "registra") ferma(); } });

  function disegna() {
    btn.disabled = stato === "trascrive";
    btn.classList.toggle("registra--attiva", stato === "registra");
    btn.setAttribute("aria-label", stato === "registra" ? "Ferma la registrazione" : stato === "trascrive" ? "Trascrivo" : `Registra ${cosa}`);
    if (stato === "fermo") btn.replaceChildren(icon("microfono"), "Registra");
    else if (stato === "registra") btn.replaceChildren(el("span.registra__punto"), durata((Date.now() - inizio) / 1000), " · Ferma");
    else btn.replaceChildren(icon("microfono"), "Trascrivo…");
  }

  function libera() {
    clearInterval(tic); tic = null;
    flusso?.getTracks().forEach((t) => t.stop()); flusso = null;
    veglia?.release?.().catch(() => {}); veglia = null;
  }

  async function avvia() {
    if (!registrazionePossibile()) { toast("Questo browser non registra l'audio: usa il microfono della tastiera", { ms: 5000 }); return; }
    try {
      flusso = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      console.warn("registra", e);
      toast(e.name === "NotAllowedError" ? "Serve il permesso del microfono: consentilo dalle impostazioni del sito" : "Microfono non disponibile", { ms: 6000 });
      return;
    }
    const tipo = formato();
    try {
      rec = new MediaRecorder(flusso, { ...(tipo ? { mimeType: tipo } : {}), audioBitsPerSecond: BITRATE });
    } catch (e) {
      rec = new MediaRecorder(flusso);
    }
    pezzi = [];
    rec.ondataavailable = (e) => { if (e.data?.size) pezzi.push(e.data); };
    rec.onstop = concludi;
    rec.start(1000); // un pezzo al secondo: se la registrazione si interrompe, quello che c'è resta
    inizio = Date.now();
    stato = "registra";
    // Schermo acceso mentre si parla: col telefono in standby il browser può sospendere la registrazione.
    try { veglia = await navigator.wakeLock?.request("screen"); } catch (e) {}
    tic = setInterval(() => {
      if (!btn.isConnected) { scarta(); return; } // foglio chiuso: si butta tutto
      if ((Date.now() - inizio) / 1000 >= MASSIMO_S) { toast("Registrazione al limite di 20 minuti: la trascrivo"); ferma(); return; }
      disegna();
    }, 250);
    disegna();
  }

  function ferma() {
    if (rec?.state === "recording") rec.stop(); // → concludi
    libera();
  }

  function scarta() {
    if (rec) { rec.onstop = null; if (rec.state === "recording") rec.stop(); }
    rec = null; pezzi = []; libera(); stato = "fermo";
  }

  async function concludi() {
    const tipo = rec?.mimeType || pezzi[0]?.type || "audio/webm";
    const blob = new Blob(pezzi, { type: tipo });
    rec = null; pezzi = [];
    if ((Date.now() - inizio) < 800 || blob.size < 2000) { stato = "fermo"; disegna(); toast("Registrazione troppo breve"); return; }
    stato = "trascrive"; disegna();
    try {
      const audio = await inBase64(blob);
      const res = await trascrivi({ audio, mimeType: tipo, projectId: progetto() || null });
      const testo = String(res.data?.testo || "").trim();
      if (!btn.isConnected) return; // foglio chiuso nel frattempo
      if (!testo) toast("Non ho sentito niente: riprova", { ms: 4000 });
      else { inserisci(testo); toast("Trascritta: controlla e salva", { ms: 3000 }); }
    } catch (e) {
      console.warn("trascrivi", e);
      toast(`${e.message || "Trascrizione non riuscita"}`, { ms: 7000 });
    } finally {
      stato = "fermo";
      if (btn.isConnected) disegna();
    }
  }

  disegna();
  return btn;
}
