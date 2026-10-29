// Contatti Google che una nota del diario potrebbe nominare, per l'agente (29/10, richiesta di Mattia:
// le persone nominate in una nota diventano etichette della nota).
// L'elenco si legge con il permesso di un'ora dell'utente (account.js → tokenServer) e resta qui: all'agente
// vanno solo i contatti con una parola del nome (o del soprannome) che compare nel testo della nota.

const CAMPI = "names,nicknames";
const MAX_PAGINE = 5;      // 5000 contatti al più
const MAX_CANDIDATI = 60;

/** minuscole, senza accenti, solo lettere e cifre separate da spazi */
export const normalizza = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const parole = (s) => normalizza(s).split(" ").filter((w) => w.length >= 3);

/** Tutti i contatti: [{ nome, soprannome, googleId }]. Errori HTTP → eccezione con `status`. */
export async function leggiContatti(token) {
  const out = [];
  let pagina = "";
  for (let i = 0; i < MAX_PAGINE; i++) {
    const u = new URL("https://people.googleapis.com/v1/people/me/connections");
    u.searchParams.set("personFields", CAMPI);
    u.searchParams.set("pageSize", "1000");
    if (pagina) u.searchParams.set("pageToken", pagina);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) { const e = new Error(`People ${r.status}`); e.status = r.status; throw e; }
    const j = await r.json();
    for (const p of j.connections || []) {
      const nome = p.names?.[0]?.displayName?.trim();
      if (nome) out.push({ nome, soprannome: p.nicknames?.[0]?.value?.trim() || "", googleId: p.resourceName });
    }
    pagina = j.nextPageToken || "";
    if (!pagina) break;
  }
  return out;
}

/**
 * I contatti con almeno una parola del nome o del soprannome nel testo, prima quelli con più parole in
 * comune (nome e cognome), al più MAX_CANDIDATI. Escluso chi ha il nome dell'utente stesso.
 */
export function candidati(contatti, testo, { escludi = [] } = {}) {
  const nelTesto = new Set(parole(testo));
  const fuori = new Set(escludi.map(normalizza).filter(Boolean));
  return contatti
    .map((c) => [parole(`${c.nome} ${c.soprannome}`).filter((w) => nelTesto.has(w)).length, c])
    .filter(([n, c]) => n > 0 && !fuori.has(normalizza(c.nome)))
    .sort((a, b) => b[0] - a[0] || a[1].nome.localeCompare(b[1].nome))
    .slice(0, MAX_CANDIDATI)
    .map(([, c]) => c);
}

/**
 * Candidati per la nota, o [] se Google non è collegato con il permesso dei contatti o la lettura non
 * riesce (l'analisi va avanti senza). `token`: () => Promise<{ accessToken, permessi }>.
 */
export async function contattiNominati(token, testo, { escludi = [], passo = () => {} } = {}) {
  let t;
  try { t = await token(); } catch (err) { return []; } // Google non collegato: niente da dire
  if (!t?.permessi?.contatti || !t.accessToken) return [];
  try {
    return candidati(await leggiContatti(t.accessToken), testo, { escludi });
  } catch (err) {
    passo(`contatti Google non letti (${err.message})`);
    return [];
  }
}
