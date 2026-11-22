// Cartelle dei progetti su Google Drive (22/11, docs/PIANO-DRIVE-MCP.md): una cartella `D&D/<progetto>` nel Drive di
// chi ha creato il progetto, condivisa con l'altra persona se il progetto è condiviso. Le crea e le tiene allineate
// la function `cartella` (functions/src/google/cartelle.js), con il permesso Google del proprietario del progetto e lo
// scope dei file creati dall'app (`permessi.cartelle`); l'app chiama e legge `projects.cartella` = { id, link, nome,
// condivisaCon }, che scrive solo il server.
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.3.0/firebase-functions.js";
import { functions } from "./firebase.js";
import { statoGoogle } from "./google.js";
import { session } from "./auth.js";
import { el, icon, toast } from "./ui.js";
import { vaiA } from "./router.js";

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
