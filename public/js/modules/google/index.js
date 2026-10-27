// Google: il collegamento dell'account (una volta sola) e cosa ne fa l'app: Contatti (cerca tra i
// contatti mentre scrivi un nome), Calendario (il calendario «Casa», condiviso tra i due), Drive
// (documenti collegati ai progetti e al manuale, letti dall'agente). Il permesso si dà sulla pagina
// di Google; al ritorno (/google-contatti?code=…, messo da parte in core/google.js) si conclude qui.
import { el, icon, toast, vuoto, toDate, giornoRelativo } from "../../core/ui.js";
import {
  statoGoogle, collegaGoogle, scollegaGoogle, collegamentoInCorso, messaggioGoogle, suGoogle,
} from "../../core/google.js";
import { calendarioCasa, elencoCalendari, scegliCalendario } from "../../core/calendario.js";
import { openSheet } from "../../components/sheet.js";
import { vaiA, richiesto } from "../../core/router.js";

export const id = "google";
export const title = "Google";
export const nav = false;
const navIcon = "collegamento";
export { navIcon as icon };

const minuscola = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/** Foglio con i calendari dell'account: toccarne uno lo rende il calendario della casa. */
export async function apriSceltaCalendario(dopo) {
  const elenco = el("div", {}, el("p.meta", { style: "padding:16px 0" }, "Leggo i calendari…"));
  const attuale = await calendarioCasa().catch(() => null);
  const sheet = openSheet({
    title: "Calendario della casa",
    body: [
      el("p.muted.small", { style: "margin-top:8px" }, "Gli eventi della casa stanno in uno dei tuoi calendari di Google. Perché l'altra persona li veda, condividi quel calendario con il suo account da Google Calendar (impostazioni del calendario → Condividi con persone specifiche, con il permesso di modificare)."),
      elenco,
    ],
  });
  async function scegli(c) {
    try {
      await scegliCalendario(c);
      sheet.close();
      toast(c ? `Calendario della casa: ${c.nome}` : "Nessun calendario della casa");
      dopo?.();
    } catch (err) { toast(`Non salvato: ${err.code || err.message}`); }
  }
  try {
    const calendari = await elencoCalendari();
    const riga = (c, sotto, scelto) => el("div.riga", { onclick: () => scegli(c) },
      el("div.pallino", { class: scelto ? "pallino--accento" : "" }, icon(scelto ? "spunta" : "calendario")),
      el("div.testo", {}, el("b", {}, c ? c.nome : "Nessuno"), sotto ? el("span", {}, sotto) : null));
    elenco.replaceChildren(
      ...calendari.map((c) => riga(c, [c.primario ? "Il tuo calendario principale" : "", c.scrivibile ? "" : "Solo lettura: potrai vedere gli eventi, non scriverli"].filter(Boolean).join(" · "), attuale?.id === c.id)),
      attuale ? riga(null, "Toglie il calendario della casa", false) : null,
    );
    if (!calendari.length) elenco.replaceChildren(vuoto("Nessun calendario", "Google non ha restituito calendari per questo account."));
  } catch (err) {
    const m = messaggioGoogle(err, "il calendario");
    elenco.replaceChildren(vuoto(m.titolo, m.testo));
  }
}

function apriScollega(dopo) {
  openSheet({
    title: "Scollega Google",
    confirmLabel: "Scollega",
    body: [el("p", { style: "margin-top:14px;line-height:1.45" }, "Toglie all'app il permesso su contatti, calendario e Drive. Le persone in rubrica e i documenti collegati restano, ma non si aggiornano più da Google. Per ricollegare darai di nuovo il permesso.")],
    onConfirm: async () => {
      try { await scollegaGoogle(); toast("Google scollegato"); dopo?.(); }
      catch (err) { toast(`Non scollegato: ${messaggioGoogle(err).testo}`, { ms: 6000 }); return false; }
    },
  });
}

export function mount(container) {
  let errore = null;      // esito negativo del ritorno da Google
  let concludendo = false; // scambio del codice in corso
  let casa = null;         // calendario della casa, quando letto
  let casaLetta = false;

  const corpo = el("div");
  // L'azione principale, in basso a destra: collegare (o ricollegare) l'account.
  const collegaFab = el("button.fab", { type: "button", "aria-label": "Collega Google", onclick: async () => {
    collegaFab.disabled = true;
    try { await collegaGoogle(); } // la pagina passa a Google
    catch (err) { const m = messaggioGoogle(err); toast(`${m.titolo}: ${m.testo}`, { ms: 6000 }); collegaFab.disabled = false; }
  } }, icon("collegamento"), "Collega");
  const mostra = (...nodi) => corpo.replaceChildren(...nodi.filter(Boolean));

  function render() {
    const g = statoGoogle();
    collegaFab.hidden = g.collegato || concludendo;
    collegaFab.lastChild.textContent = g.scaduto || errore ? "Ricollega" : "Collega";

    if (concludendo) { mostra(vuoto("Collego Google…", "Chiedo a Google il permesso duraturo.")); return; }

    if (!g.collegato) {
      const msg = errore ? messaggioGoogle(errore) : null;
      mostra(
        msg ? el("div.nota-campo", { style: "margin:16px 0 0;color:var(--frutto)" }, icon("avviso"), el("span", {}, el("b", {}, msg.titolo), ". ", msg.testo)) : null,
        g.scaduto && !msg ? el("div.nota-campo", { style: "margin:16px 0 0;color:var(--frutto)" }, icon("avviso"), el("span", {}, `Il collegamento${g.email ? ` con ${g.email}` : ""} è scaduto: Google ha ritirato il permesso.`)) : null,
        vuoto("Google non collegato", "Colleghi il tuo account una volta sola; poi l'app usa contatti, calendario e Drive con il tuo permesso."),
        el("div.blocco", {},
          el("h3", {}, "Cosa fa l'app"),
          el("p", {}, el("b", {}, "Contatti"), ": mentre scrivi un nome in un task o in rubrica compaiono i tuoi contatti; in rubrica entra solo chi colleghi, con telefono, mail e indirizzo aggiornati da Google. Solo lettura."),
          el("p", {}, el("b", {}, "Calendario"), ": un tuo calendario diventa quello della casa, condiviso con l'altra persona; l'app lo legge, ci scrive gli eventi che aggiungi e quelli che l'agente ricava dalle note, dopo la tua conferma."),
          el("p", {}, el("b", {}, "Drive"), ": puoi collegare documenti del tuo Drive a un progetto o a una voce del manuale; l'agente li legge come contesto quando analizza una nota del progetto. Solo lettura."),
          el("p.meta", {}, "Si passa dalla pagina di Google e si torna qui. Se compare l'avviso «app non verificata», si prosegue con «Avanzate». Le tre spunte sono separate: puoi dare solo quelle che vuoi."),
        ),
      );
      return;
    }

    const dal = toDate(g.dal);
    const manca = (parte) => !g.permessi[parte];
    const rigaPermesso = (icona, nome, parte, sotto, onclick) => el("div.riga", { onclick, style: onclick ? null : "cursor:default" },
      el("div.pallino", { class: manca(parte) ? "" : "pallino--accento" }, icon(icona)),
      el("div.testo", {}, el("b", {}, nome), el("span", { class: manca(parte) ? "tardi" : "" }, manca(parte) ? "Spunta non data: ricollega e lasciala" : sotto)),
      onclick ? icon("freccia", "freccia-riga") : null);
    const calendario = !casaLetta ? " " : casa ? `Calendario della casa: ${casa.nome}` : "Scegli il calendario della casa";

    mostra(
      el("div.blocco", {},
        el("h3", {}, g.email || "Account collegato"),
        el("p", {}, dal ? `Collegato ${/^\d/.test(giornoRelativo(dal)) ? "il " : ""}${minuscola(giornoRelativo(dal))}. ` : "", "L'app chiede a Google permessi di un'ora quando servono; il permesso duraturo resta sul server."),
        el("div", {},
          rigaPermesso("contatto", "Contatti", "contatti", "Cerchi tra i contatti scrivendo un nome", manca("contatti") ? null : () => vaiA("manuale", "contatti")),
          rigaPermesso("calendario", "Calendario", "calendario", calendario, manca("calendario") ? null : () => apriSceltaCalendario(leggiCasa)),
          rigaPermesso("cartella", "Drive", "drive", "Documenti collegabili ai progetti e al manuale", null),
        ),
      ),
      casa || manca("calendario") ? null : el("p.meta", {}, "Senza un calendario della casa la pagina Calendario resta vuota: tocca Calendario qui sopra per sceglierlo."),
      el("div.blocco", {},
        el("h3", {}, "Collegamento"),
        el("p", {}, "Ricollegare riapre la pagina di Google: serve se una spunta manca o se il permesso è stato ritirato. Scollegare toglie ogni permesso all'app."),
        el("div.segmenti", {},
          el("button.btn", { type: "button", onclick: async (e) => { e.currentTarget.disabled = true; try { await collegaGoogle(); } catch (err) { toast(messaggioGoogle(err).testo, { ms: 6000 }); e.currentTarget.disabled = false; } } }, icon("collegamento"), "Ricollega"),
          el("button.btn.btn--pericolo", { type: "button", onclick: () => apriScollega(render) }, icon("chiudi"), "Scollega"),
        ),
      ),
    );
  }

  async function leggiCasa() {
    casa = await calendarioCasa({ fresh: true }).catch(() => null);
    casaLetta = true;
    render();
  }

  // Ritorno dalla pagina di Google: il codice è già in viaggio verso il server (core/google.js).
  async function concludi(inCorso) {
    concludendo = true; render();
    try {
      const r = await inCorso;
      const date = Object.entries(r.permessi || {}).filter(([, v]) => v).map(([k]) => ({ contatti: "contatti", calendario: "calendario", drive: "Drive" }[k]));
      toast(`Google collegato: ${date.join(", ") || "nessun permesso"}`, { ms: 5000 });
      errore = null;
    } catch (err) {
      errore = err;
    } finally { concludendo = false; render(); }
  }

  container.append(corpo, collegaFab);
  const stop = suGoogle(render);
  render();
  leggiCasa();
  const inCorso = collegamentoInCorso();
  if (inCorso) concludi(inCorso);
  if (richiesto("google", "calendario") && statoGoogle().permessi.calendario) setTimeout(() => apriSceltaCalendario(leggiCasa), 0);

  return () => { stop(); collegaFab.remove(); };
}
