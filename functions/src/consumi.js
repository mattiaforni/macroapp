// Quanto costa l'AI (14/11, dall'analisi dell'app: «costi al buio»). Ogni chiamata a Claude o a Gemini scrive i token
// usati e il costo stimato nel mese della persona: consumi/{uid}_{AAAAMM} (lo legge solo lei, lo scrive solo il
// server). La pagina Modelli AI mostra il totale del mese di Claude rispetto ai crediti del piano (100 $ al mese) e,
// a parte, Gemini (trascrizione, sul conto Google). Stima, non fattura: i prezzi sono quelli di listino qui sotto.
//
// consumi/{uid}_{AAAAMM} = { ownerUid, mese: "AAAA-MM", claude: { usd, chiamate }, gemini: { usd, chiamate },
//   voci: { <voce>: { usd, chiamate, ingresso, uscita } }, aggiornato }
// Voci: note (analisi delle note semplici), progetti (note dei progetti con istruzioni), chiedi, settimana (revisione
// della domenica), pdf (testo dei PDF di Drive), trascrizione.
import { FieldValue } from "firebase-admin/firestore";

// $ per milione di token: [ingresso, uscita, lettura dalla cache]. Novembre 2026.
// Claude: https://platform.claude.com/docs/en/about-claude/models/overview — Gemini: https://ai.google.dev/gemini-api/docs/pricing
// (livello a pagamento; i prezzi di Gemini raddoppiano dal 1° gennaio 2027).
const PREZZI = {
  "claude-haiku-5-5": [0.10, 0.50, 0.01],
  "claude-sonnet-5-5": [2, 10, 0.10],
  "claude-opus-5-5": [4, 20, 0.20],
  "gemini-3.8-flash": [0.75, 3.75, 0.075],
};
const RADDOPPIO_GEMINI = Date.UTC(2027, 0, 1);

/** Uso di Claude (`usage` della risposta) o di Gemini (`usageMetadata`) → { ingresso, uscita, cache, scrittura }. */
export function token(uso = {}) {
  if (!uso) return { ingresso: 0, uscita: 0, cache: 0, scrittura: 0 };
  if ("promptTokenCount" in uso || "candidatesTokenCount" in uso) {
    return { ingresso: (uso.promptTokenCount || 0) - (uso.cachedContentTokenCount || 0), uscita: (uso.candidatesTokenCount || 0) + (uso.thoughtsTokenCount || 0),
      cache: uso.cachedContentTokenCount || 0, scrittura: 0 };
  }
  return { ingresso: uso.input_tokens || 0, uscita: uso.output_tokens || 0, cache: uso.cache_read_input_tokens || 0, scrittura: uso.cache_creation_input_tokens || 0 };
}

/** Costo in dollari di una chiamata. La scrittura in cache costa 1,25 volte l'ingresso. */
export function costo(modello, uso, ora = Date.now()) {
  const p = PREZZI[modello];
  if (!p) return 0;
  const t = token(uso);
  const x = modello.startsWith("gemini") && ora >= RADDOPPIO_GEMINI ? 2 : 1;
  return x * (t.ingresso * p[0] + t.uscita * p[1] + t.cache * p[2] + t.scrittura * p[0] * 1.25) / 1e6;
}

/** Somma più usi (un giro di strumenti fa più chiamate). */
export function somma(usi) {
  const out = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  for (const u of usi) {
    const t = token(u);
    out.input_tokens += t.ingresso; out.output_tokens += t.uscita; out.cache_read_input_tokens += t.cache; out.cache_creation_input_tokens += t.scrittura;
  }
  return out;
}

const mese = (d) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit" }).format(d); // "2026-11"

/**
 * Aggiunge una chiamata al mese della persona. Non blocca mai chi chiama: un errore finisce nel registro.
 * Ritorna il costo stimato ({ usd, ingresso, uscita }) perché chi chiama lo possa scrivere anche altrove (nella nota).
 */
export async function registra(db, uid, voce, { modello, uso, chiamate = 1 }) {
  const usd = costo(modello, uso);
  const t = token(uso);
  const m = mese(new Date());
  const servizio = String(modello).startsWith("gemini") ? "gemini" : "claude";
  const inc = FieldValue.increment;
  try {
    await db.collection("consumi").doc(`${uid}_${m.replace("-", "")}`).set({
      ownerUid: uid, mese: m,
      [servizio]: { usd: inc(usd), chiamate: inc(chiamate) },
      voci: { [voce]: { usd: inc(usd), chiamate: inc(chiamate), ingresso: inc(t.ingresso + t.cache + t.scrittura), uscita: inc(t.uscita) } },
      aggiornato: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (e) {
    console.warn("consumi", voce, String(e.message || e).slice(0, 160));
  }
  return { usd, ingresso: t.ingresso + t.cache + t.scrittura, uscita: t.uscita };
}
