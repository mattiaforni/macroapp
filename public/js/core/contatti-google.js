// Google Contatti, in sola lettura, con il permesso dell'account Google collegato (core/google.js).
//
// L'elenco dei contatti si legge con la People API e resta in memoria per la sessione: serve a
// cercare mentre scrivi un nome. In rubrica entrano solo le persone che colleghi; i loro
// recapiti si aggiornano da Google (sincronizzaDaGoogle in rubrica.js).
import { statoGoogle, permessoGoogle, chiamaGoogle, suSvuota, messaggioGoogle } from "./google.js";

const FRESCO = 10 * 60 * 1000; // dopo 10 minuti l'elenco si rilegge alla prima ricerca
const CAMPI = "names,nicknames,phoneNumbers,emailAddresses,addresses,organizations";

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

// ───────────── Stato ─────────────

/** { collegato, scaduto, email }: collegato = account Google collegato con il permesso dei contatti. */
export function statoContatti() {
  const g = statoGoogle();
  return { collegato: g.collegato && g.permessi.contatti, scaduto: g.scaduto, email: g.email };
}
export const contattiCollegati = () => statoContatti().collegato;

// ───────────── Elenco dei contatti ─────────────

let elenco = null;   // promessa dell'elenco in lettura o letto
let letti = [];      // ultimo elenco letto, per le ricerche mentre si scrive
let lettoAlle = 0;
const ascoltatori = new Set();

function svuota() { elenco = null; letti = []; lettoAlle = 0; }
suSvuota(svuota);

/** fn() quando arriva un elenco nuovo; ritorna la funzione per smettere. */
export function suContatti(fn) { ascoltatori.add(fn); return () => ascoltatori.delete(fn); }

function daGoogle(p) {
  const name = p.names?.[0]?.displayName?.trim();
  if (!name) return null;
  const primo = (v) => (v || []).find((x) => x.metadata?.primary) || (v || [])[0];
  return {
    googleId: p.resourceName,
    name,
    nickname: p.nicknames?.[0]?.value?.trim() || "",
    phone: primo(p.phoneNumbers)?.value || "",
    email: primo(p.emailAddresses)?.value || "",
    address: (primo(p.addresses)?.formattedValue || "").replace(/\n+/g, ", "),
    org: primo(p.organizations)?.name || "",
  };
}

async function leggiTutti() {
  const out = [];
  let pagina = "";
  for (;;) {
    const j = await chiamaGoogle("https://people.googleapis.com/v1/people/me/connections", {
      query: { personFields: CAMPI, pageSize: "1000", sortOrder: "FIRST_NAME_ASCENDING", pageToken: pagina },
    });
    for (const p of j.connections || []) {
      const c = daGoogle(p);
      if (c) out.push(c);
    }
    pagina = j.nextPageToken || "";
    if (!pagina) return out;
  }
}

/** Tutti i contatti: [{ googleId, name, nickname, phone, email, address, org }]. [] se non collegato. */
export function caricaContatti({ forza = false } = {}) {
  if (!contattiCollegati()) return Promise.resolve([]);
  if (elenco && !forza && Date.now() - lettoAlle < FRESCO) return elenco;
  lettoAlle = Date.now();
  const questo = leggiTutti().then(
    (c) => {
      if (elenco === questo) { letti = c; ascoltatori.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }
      return c;
    },
    (err) => { if (elenco === questo) { elenco = null; lettoAlle = 0; } throw err; },
  );
  elenco = questo;
  return questo;
}

/**
 * Contatti in cui una parola del nome (o del soprannome) comincia con q, i più vicini prima.
 * Lavora sull'elenco già letto; se manca lo chiede, e suContatti avvisa quando arriva.
 */
export function cercaContatti(q, quanti = 5) {
  const t = norm(q);
  if (!t) return [];
  if (contattiCollegati() && (!elenco || Date.now() - lettoAlle >= FRESCO)) caricaContatti().catch(() => {});
  const punteggio = (c) => {
    const n = norm(c.name);
    const s = norm(c.nickname);
    if (n === t || s === t) return 0;
    if (n.startsWith(t) || s.startsWith(t)) return 1;
    if (`${n} ${s}`.split(" ").some((w) => w.startsWith(t))) return 2;
    if (t.includes(" ") && n.includes(t)) return 3;
    return 9;
  };
  return letti.map((c) => [punteggio(c), c]).filter(([p]) => p < 9)
    .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).slice(0, quanti).map(([, c]) => c);
}

/**
 * Il contatto che corrisponde a un nome senza dubbi: nome completo o soprannome uguale, oppure
 * nome proprio di una sola persona. Serve a collegare le persone nominate dall'AI.
 */
export function contattoUnico(nome) {
  const t = norm(nome);
  if (!t || !letti.length) return null;
  const esatti = letti.filter((c) => norm(c.name) === t || norm(c.nickname) === t);
  if (esatti.length) return esatti.length === 1 ? esatti[0] : null;
  if (t.includes(" ")) return null;
  const perNome = letti.filter((c) => norm(c.name).split(" ")[0] === t);
  return perNome.length === 1 ? perNome[0] : null;
}

export const contattoDaId = (googleId) => letti.find((c) => c.googleId === googleId) || null;

/** Contatti che si chiamano esattamente così (nome completo o soprannome). */
export function contattiConNome(nome) {
  const t = norm(nome);
  return t ? letti.filter((c) => norm(c.name) === t || norm(c.nickname) === t) : [];
}

/** La scheda del contatto su contacts.google.com, dove si modifica. */
export const linkGoogle = (googleId) => `https://contacts.google.com/person/${String(googleId).replace(/^people\//, "")}`;

/** Una riga sotto il nome per distinguere omonimi: azienda, mail o numero. */
export const dettaglioContatto = (c) => c.org || c.email || c.phone || "";

/** { titolo, testo } per un errore di lettura dei contatti. */
export const messaggioContatti = (err) => messaggioGoogle(err, "i contatti");

/** Il permesso dei contatti manca anche se Google è collegato (spunta non data). */
export const mancaPermessoContatti = () => statoGoogle().collegato && !permessoGoogle("contatti");
