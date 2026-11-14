// Ricerca nelle note del Diario (14/11, richiesta di Mattia): locale, istantanea, senza AI e senza distinguere gli accenti
// né le maiuscole, su titolo, testo (la trascrizione, nelle note dei progetti), riepilogo, persone e temi. Più parole:
// la nota deve averle tutte, anche in campi diversi. E il filtro per persona: le note in cui una persona è tra le persone
// nominate (dall'AI o a mano), o in cui il suo nome e cognome compaiono nel testo.
//
// Le funzioni lavorano su testi già in memoria (le note che vedi, core/note.js → seguiTutteLeNote): niente rete.
import { el } from "./ui.js";
import { vaiA, currentRoute } from "./router.js";

/** Il testo per il confronto: minuscolo e senza accenti («Perché» → «perche»). */
export function normalizza(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Le parole da cercare, normalizzate (gli spazi le separano; niente parole vuote). */
export function parole(testo) {
  return [...new Set(normalizza(testo).split(/\s+/).map((p) => p.trim()).filter(Boolean))];
}

/**
 * Il testo normalizzato con, per ogni suo carattere, la posizione nel testo originale: così un pezzo trovato nel testo
 * normalizzato si ritrova (e si evidenzia) in quello vero, anche se un carattere si è sciolto in due o è sparito.
 */
function mappa(s) {
  let norm = "";
  const pos = [];
  for (let i = 0; i < s.length; i++) {
    const n = normalizza(s[i]);
    for (let k = 0; k < n.length; k++) { norm += n[k]; pos.push(i); }
  }
  return { norm, pos };
}

/** Dove compaiono le parole nel testo originale: [[inizio, fine)], ordinati e fusi quando si toccano. */
export function trovaIn(testo, ps) {
  const s = String(testo ?? "");
  if (!s || !ps.length) return [];
  const { norm, pos } = mappa(s);
  const pezzi = [];
  for (const p of ps) {
    for (let i = norm.indexOf(p); i >= 0; i = norm.indexOf(p, i + p.length)) pezzi.push([pos[i], pos[i + p.length - 1] + 1]);
  }
  pezzi.sort((a, b) => a[0] - b[0]);
  const fusi = [];
  for (const x of pezzi) {
    const u = fusi[fusi.length - 1];
    if (u && x[0] <= u[1]) u[1] = Math.max(u[1], x[1]); else fusi.push([...x]);
  }
  return fusi;
}

/** Il testo come nodi, con le parole trovate in <mark class="trovato">. */
export function evidenzia(testo, ps) {
  const s = String(testo ?? "");
  const pezzi = trovaIn(s, ps);
  if (!pezzi.length) return [s];
  const out = [];
  let da = 0;
  for (const [a, b] of pezzi) {
    if (a > da) out.push(s.slice(da, a));
    out.push(el("mark.trovato", {}, s.slice(a, b)));
    da = b;
  }
  if (da < s.length) out.push(s.slice(da));
  return out;
}

/** I campi in cui si cerca, uno per uno (testo originale). */
export function campiNota(n) {
  return {
    titolo: String(n.titolo || ""),
    testo: String(n.text || ""),
    riepilogo: String(n.riepilogo || ""),
    persone: (Array.isArray(n.persone) ? n.persone : []).map((p) => p?.nome || "").filter(Boolean).join(" · "),
    temi: (Array.isArray(n.temi) ? n.temi : []).join(" · "),
  };
}

/** La nota ha tutte le parole (ognuna in almeno un campo)? Senza parole: sì. */
export function notaTrovata(n, ps) {
  if (!ps.length) return true;
  const tutto = normalizza(Object.values(campiNota(n)).join("\n"));
  return ps.every((p) => tutto.includes(p));
}

/**
 * Un estratto del testo intorno alla prima parola trovata, perché nella riga (due righe di anteprima) si veda: un po'
 * di testo prima, «…» davanti se si taglia. `null` se nel testo non c'è nessuna delle parole.
 */
export function estratto(testo, ps, prima = 40, lunghezza = 280) {
  const s = String(testo ?? "").replace(/\s+/g, " ").trim();
  const [p] = trovaIn(s, ps);
  if (!p) return null;
  if (p[0] <= prima) return s.slice(0, lunghezza);
  let da = p[0] - prima;
  const spazio = s.lastIndexOf(" ", p[0] - 1);
  if (spazio > da - 15 && spazio < p[0]) da = spazio + 1; // da un inizio di parola, se ce n'è uno vicino
  return `…${s.slice(da, da + lunghezza)}`;
}

/**
 * La nota riguarda la persona? `chi` = { nome, voceId?, googleId? } (dalla rubrica, da Google Contatti, o il nome scritto
 * in una nota). Sì se è tra le persone della nota (stessa voce, stesso contatto o stesso nome), o se nome e cognome
 * compaiono nel testo (un nome solo, come «Marco», nel testo no: troppe omonimie).
 */
export function notaConPersona(n, chi) {
  if (!chi?.nome) return true;
  const nome = normalizza(chi.nome).trim();
  const tra = (Array.isArray(n.persone) ? n.persone : []).some((p) =>
    (chi.voceId && p?.voceId === chi.voceId) || (chi.googleId && p?.googleId === chi.googleId) || normalizza(p?.nome).trim() === nome);
  if (tra) return true;
  if (nome.split(/\s+/).length < 2) return false;
  const c = campiNota(n);
  return normalizza(`${c.titolo}\n${c.testo}\n${c.riepilogo}`).includes(nome);
}

// ───────────── Le note di una persona, da qualunque pagina ─────────────

let filtroDelDiario = null; // il Diario montato registra qui come filtrarsi per persona
/** Il Diario, montandosi, dice come filtrarsi per persona; smontandosi lo toglie (solo se è ancora il suo). */
export function registraFiltroPersona(fn) { filtroDelDiario = fn; }
export function lasciaFiltroPersona(fn) { if (filtroDelDiario === fn) filtroDelDiario = null; }

/**
 * Porta alle note di `chi` ({ nome, voceId?, googleId? }): il tocco su una persona nel foglio di lettura di una nota,
 * «Note con …» nella sua voce della rubrica. Nel Diario si filtra lì (`chiudi` chiude il foglio da cui si viene);
 * altrove si va al Diario, che lo legge in `richiestaPer("diario")` («persona:{json}»; il router chiude i fogli).
 */
export function mostraNoteDi(chi, chiudi = null) {
  const p = { nome: String(chi?.nome || "").trim(), voceId: chi?.voceId || null, googleId: chi?.googleId || null };
  if (!p.nome) return;
  if (filtroDelDiario && currentRoute() === "diario") { chiudi?.(); filtroDelDiario(p); return; }
  vaiA("diario", `persona:${JSON.stringify(p)}`);
}

