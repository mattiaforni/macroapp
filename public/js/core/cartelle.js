// Cartelle dei progetti su Google Drive (22/11, docs/PIANO-DRIVE-MCP.md): una cartella `D&D/<progetto>` nel Drive di
// chi ha creato il progetto, condivisa con l'altra persona se il progetto è condiviso. Le crea e le tiene allineate
// la function `cartella` (functions/src/google/cartelle.js), con il permesso Google del proprietario del progetto e lo
// scope dei file creati dall'app (`permessi.cartelle`); l'app chiama e legge `projects.cartella` = { id, link, nome,
// condivisaCon }, che scrive solo il server.
// Dal passo 2 (22/11) anche la copia leggibile del progetto nella cartella (sintesi e da fare, note per mese, foto: la
// rifà il server, functions/src/google/copia.js) e «Apri come documento» (`bottoneDocumento`).
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-functions.js";
import { functions } from "./firebase.js";
import { statoGoogle } from "./google.js";
import { session } from "./auth.js";
import { el, icon, toast } from "./ui.js";
import { vaiA } from "./router.js";
import { suScrittura, update, leggiUno, serverTimestamp } from "./db.js";

const chiama = (dati) => httpsCallable(functions, "cartella")(dati).then((r) => r.data, (e) => {
  throw Object.assign(new Error(e?.message || String(e)), { motivo: e?.details?.motivo || null, proprietario: e?.details?.proprietario || "", code: e?.code });
});

/** Se questo account ha dato a Google il permesso sui file creati dall'app (serve a chi crea il progetto). */
export const permessoCartelle = () => !!statoGoogle().permessi.cartelle;

/** Crea (o ritrova e allinea) la cartella del progetto: { cartella: { id, link, nome, condivisaCon } | null, inCorso }. */
export const creaCartella = (projectId) => chiama({ azione: "crea", projectId });

/** Allinea nome e condivisione della cartella al progetto (dopo un cambio di visibilità o di nome). */
export const allineaCartella = (projectId) => chiama({ azione: "allinea", projectId });

/**
 * Alla creazione di un progetto: la sua cartella, se chi lo crea ha dato il permesso (altrimenti la si crea poi con
 * un tocco dalla pagina del progetto). `nuovo` = { id, saved } di db.create: si aspetta che il progetto sia sul server.
 */
export function cartellaPerNuovo(nuovo) {
  if (!permessoCartelle()) return;
  nuovo.saved.then(() => creaCartella(nuovo.id)).catch((e) => console.warn("cartella del progetto non creata", e.motivo || e.message));
}

/** Messaggio per chi usa l'app, da un errore della function. */
export function messaggioCartella(err) {
  const m = err?.motivo || "";
  if (m === "cartelle" || m === "non-collegato" || m === "scaduto") {
    if (err.proprietario) return `La cartella sta nel Drive di ${err.proprietario}: deve ${m === "cartelle" ? "ricollegare Google e lasciare la spunta per i file creati dall'app" : "collegare Google dalla pagina Google"}.`;
    return m === "cartelle" ? "Ricollega Google e lascia la spunta per i file creati dall'app." : "Collega Google dalla pagina Google, nel menu.";
  }
  if (m === "progetto") return "Progetto non trovato.";
  return err?.message || "Drive non raggiungibile.";
}

// ───────────── Il pulsante «Drive» (pagina del progetto e Task) ─────────────

const inCreazione = new Set(); // progetti di cui si sta creando la cartella

/**
 * «Drive» per un progetto: un link alla cartella se c'è; se non c'è ancora, un tocco la crea nel Drive di chi ha creato
 * il progetto (anche dall'altra persona: il server usa il permesso del proprietario). `ridisegna()` dopo un cambio di
 * stato (l'arrivo della cartella lo porta l'ascolto dei progetti).
 */
export function bottoneDrive(progetto, ridisegna = () => {}) {
  const c = progetto.cartella;
  if (c?.id && c.link && !c.persa) {
    return el("a.btn.btn--piatto", { href: c.link, target: "_blank", rel: "noopener", "aria-label": "Apri la cartella su Drive", style: "text-decoration:none" }, icon("cartella"), "Drive");
  }
  const creando = inCreazione.has(progetto.id);
  return el("button.btn.btn--piatto", { type: "button", disabled: creando, "aria-label": "Crea la cartella su Drive", onclick: async () => {
    if (progetto.ownerUid === session.user.uid && !permessoCartelle()) {
      toast(statoGoogle().collegato ? "Per la cartella su Drive ricollega Google e lascia la spunta per i file creati dall'app" : "Per la cartella su Drive collega Google",
        { azione: { label: "Google", fn: () => vaiA("google") } });
      return;
    }
    inCreazione.add(progetto.id); ridisegna();
    try {
      const r = await creaCartella(progetto.id);
      const link = r.cartella?.link;
      if (link) toast(`Cartella su Drive: D&D/${r.cartella.nome || progetto.name}`, { azione: { label: "Apri", fn: () => window.open(link, "_blank", "noopener") } });
      else if (r.inCorso) toast("La cartella si sta già creando");
    } catch (e) {
      toast(messaggioCartella(e), { ms: 6000 });
    } finally { inCreazione.delete(progetto.id); ridisegna(); }
  } }, icon("cartella"), creando ? "Creo…" : "Drive");
}

// ───────────── Copia leggibile (passo 2) ─────────────

const RAGGRUPPA_MS = 4000;          // la copia parte qualche secondo dopo l'ultima modifica, non a ogni scrittura
const inAttesa = new Set();          // progetti da copiare al prossimo invio
const segnati = new Set();           // progetti con copiaRichiesta già scritta in questo giro
let timer = null;
const SOLO_STATO = new Set(["avvisaAFine", "analisi", "updatedAt", "copiaRichiesta"]); // campi che non cambiano la copia

/**
 * Una modifica a un progetto con la cartella (sue note, suoi task, la sintesi): segna `copiaRichiesta` sul progetto
 * (resta anche se l'app si chiude: la recupera il giro del server) e, dopo qualche secondo senza altre modifiche,
 * chiede la copia alla function `cartella`.
 */
export async function toccaProgetto(pid) {
  if (!pid || !session.user) return;
  const p = await leggiUno("projects", pid);
  if (!p?.cartella?.id || p.cartella.persa) return;
  if (!segnati.has(pid)) { segnati.add(pid); update("projects", pid, { copiaRichiesta: serverTimestamp() }); }
  inAttesa.add(pid);
  clearTimeout(timer);
  timer = setTimeout(manda, RAGGRUPPA_MS);
}

function manda() {
  clearTimeout(timer);
  const ids = [...inAttesa];
  inAttesa.clear();
  for (const pid of ids) {
    segnati.delete(pid);
    chiama({ azione: "copia", projectId: pid }).catch((e) => console.warn("copia del progetto su Drive", e.motivo || e.message));
  }
}

// Uscendo dall'app (telefono bloccato, altra app) si manda subito ciò che aspetta.
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && inAttesa.size) manda(); });

suScrittura((coll, id, dati, tipo, copia) => {
  if (coll === "projects") {
    if (tipo === "modifica" && Object.keys(dati).some((k) => !SOLO_STATO.has(k))) toccaProgetto(id);
    return;
  }
  if (coll !== "journal_entries" && coll !== "tasks") return;
  if (tipo === "modifica" && Object.keys(dati).every((k) => SOLO_STATO.has(k))) return;
  if (dati.projectId) toccaProgetto(dati.projectId);
  if (copia?.projectId) toccaProgetto(copia.projectId);
  // Una modifica che non dice il progetto (task fatto, analisi): lo si legge dal documento.
  if (tipo === "modifica" && !("projectId" in dati)) leggiUno(coll, id).then((d) => d?.projectId && toccaProgetto(d.projectId));
});

// ───────────── «Apri come documento» (passo 2) ─────────────

/**
 * «Apri come documento» per una nota di un progetto (`entryId`) o per la sua sintesi: un Documento Google nella cartella
 * del progetto, creato la prima volta e poi riaperto. Si mostra se il progetto ha la cartella o se chi lo usa può
 * crearla. La finestra si apre subito al tocco (dopo, il telefono la bloccherebbe) e riceve il documento quando è pronto.
 */
export function bottoneDocumento(progetto, { entryId = null } = {}) {
  if (!progetto?.id || !(progetto.cartella?.id || permessoCartelle())) return null;
  const b = el("button.btn.btn--piatto", { type: "button", onclick: async () => {
    b.disabled = true;
    const testo = b.lastChild.textContent;
    b.lastChild.textContent = "Preparo il documento…";
    let w = null;
    try { w = window.open("", "_blank"); } catch (e) { w = null; }
    try {
      const r = await chiama({ azione: "documento", projectId: progetto.id, ...(entryId ? { entryId } : {}) });
      if (w && !w.closed) w.location.href = r.link;
      else toast(r.nuovo ? "Documento pronto su Drive" : "Il documento c'è già su Drive", { azione: { label: "Apri", fn: () => window.open(r.link, "_blank", "noopener") } });
    } catch (e) {
      try { w?.close(); } catch (x) {}
      toast(e.motivo === "privata" ? "La nota è privata e la cartella del progetto è condivisa: non la metto lì." : messaggioCartella(e), { ms: 6000 });
    } finally { b.disabled = false; b.lastChild.textContent = testo; }
  } }, icon("appunto"), "Apri come documento");
  return b;
}
