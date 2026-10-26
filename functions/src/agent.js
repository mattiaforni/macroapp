// Agente del diario: dal testo di una nota ricava azioni e le scrive come proposte.
// Non modifica mai i moduli direttamente: ogni azione passa dalla conferma dell'utente.
import { FieldValue } from "firebase-admin/firestore";
import { reason } from "./ai/provider.js";

/**
 * Sezione del prompt per una nota collegata a un progetto. Con le istruzioni del progetto
 * (come quelle di un progetto Claude) l'agente scrive anche il riepilogo della nota e propone
 * la sintesi aggiornata del progetto, tenendo conto delle note precedenti.
 */
function sezioneProgetto(progetto) {
  if (!progetto) return "";
  const righe = [`
La nota appartiene al progetto «${progetto.name}»: i task che ne ricavi vanno in questo progetto
(payload.project = "${progetto.name}"), salvo che la nota dica altro.`];
  if (progetto.istruzioni) {
    righe.push(`
Oltre alle azioni, scrivi nel campo "riepilogo" un riepilogo della nota seguendo queste istruzioni
dell'utente per il progetto:
<istruzioni>
${progetto.istruzioni}
</istruzioni>
Il riepilogo è testo semplice: righe che iniziano con "## " per i titoli di sezione, "- " per gli
elenchi, **grassetto** solo dove serve; niente tabelle. Ciò che va ricordato sta nel riepilogo e nella
sintesi: le azioni restano per le cose da fare, comprare, spendere o scrivere.

Il progetto ha anche una "sintesi": un testo vivo che raccoglie lo stato del progetto, ciò che è emerso
finora e va tenuto presente (non la cronaca delle singole note). Nel campo "sintesi" scrivi la sintesi
aggiornata con la nota di oggi, nello stesso formato del riepilogo, organizzata per temi secondo le
istruzioni: una sezione "## " per tema (es. un colpo, un argomento), con nomi brevi e stabili da una
volta all'altra, perché l'app li usa per collegare le note ai temi. Dentro una sezione, come prima
riga facoltativa, "Stato: " e due-quattro parole sul punto in cui si è (es. "migliora", "da affrontare",
"tornato indietro"). Tieni ciò che resta valido, aggiorna ciò che cambia, togli ciò che è superato, non
ripetere le date né raccontare le lezioni una per una. Lunghezza: quanto serve per orientarsi, non di più.

Scrivi anche un "titolo" della nota (una riga, al massimo 60 caratteri, di cosa parla: niente data) e
"temi": i nomi esatti delle sezioni della sintesi che la nota tocca (quelle della sintesi aggiornata).`);
    if (progetto.sintesi) {
      righe.push(`
Sintesi attuale del progetto (l'utente può averla corretta a mano: rispettane struttura e scelte):
<sintesi>
${progetto.sintesi}
</sintesi>
Se la nota di oggi non cambia nulla della sintesi, restituiscila identica.`);
    } else {
      righe.push(`
Il progetto non ha ancora una sintesi: costruiscila da tutte le note che seguono e dalla nota di oggi.`);
    }
    righe.push(progetto.precedenti.length
      ? `
Note precedenti dello stesso progetto, dalla più vecchia alla più recente. Servono a collegare la nota
di oggi a ciò che è già emerso (correzioni che tornano, progressi, cose da riprendere): nel riepilogo
non riassumerle di nuovo.
<precedenti>
${progetto.precedenti.map((n) => `<nota data="${n.data}">\n${n.testo}\n</nota>`).join("\n")}
</precedenti>`
      : `
È la prima nota di questo progetto.`);
  }
  return righe.join("\n");
}

export function system({ oggi, altro, progetti, persone, categorie, progetto = null }) {
  return `Sei l'assistente di un'app personale e di coppia (lista della spesa, spese condivise, task per progetti,
manuale di casa, appunti). Ricevi una nota scritta o dettata dall'utente: può contenere errori di dettatura
e poca punteggiatura. Estrai SOLO le azioni concrete che la nota contiene o chiede, senza inventarne.

Oggi è ${oggi}. L'altra persona della casa si chiama ${altro || "(non ancora indicata)"}.
Progetti esistenti dell'utente: ${progetti.length ? progetti.join(", ") : "nessuno"}.
Persone in rubrica: ${persone.length ? persone.join(", ") : "nessuna"}.
Quando la nota nomina una di queste persone (anche solo col nome proprio), scrivila come è in rubrica.

Tipi di azione:
- task: una cosa da fare. payload.text (frase breve all'infinito o imperativo), payload.due (AAAA-MM-GG solo se
  la nota indica una scadenza, anche relativa: "venerdì", "entro fine mese"), payload.project (uno dei progetti
  esistenti se pertinente, altrimenti un nome nuovo breve solo se la nota lo suggerisce chiaramente, altrimenti vuoto),
  payload.people (persone coinvolte, se nominate, separate da virgola).
- shopping_item: cose da comprare per la casa. payload.text (anche più voci separate da virgola).
- expense: una spesa già fatta da dividere. payload.description, payload.amount (numero in euro).
- manual_entry: un negozio, fornitore o artigiano ("shop"), una persona nuova da tenere in rubrica con i suoi
  recapiti ("person", solo se la nota dà un telefono o una mail o chiede di salvarla), oppure un'informazione di
  casa da ricordare ("info"). payload.type, payload.name, payload.category (una di: ${categorie.join(", ")};
  vuota se nessuna è adatta), payload.notes, payload.phone, payload.email.
- draft: SOLO se la nota chiede di scrivere, rispondere, mandare o preparare un messaggio, una mail o un testo
  per qualcuno. Scrivi il testo pronto da inviare, in italiano, nel registro adatto al destinatario,
  firmato "Mattia" se serve una firma. payload.channel ("email", "messaggio" o "documento"),
  payload.to (destinatario se noto: il nome come in rubrica, o l'indirizzo mail), payload.subject (oggetto, per le mail), payload.body (il testo completo).

Nel payload scrivi sempre tutti i campi: quelli che non servono a quel tipo di azione lasciali vuoti
("" per i testi, 0 per amount).

Per ogni azione:
- summary: una riga chiara di cosa verrà fatto (es. "Chiamare l'idraulico entro venerdì").
- shared: true se riguarda la casa o la coppia (spesa, lista, manuale, faccende comuni), false se è personale
  (lavoro, volontariato, cose proprie).
Un'informazione da conservare non è un'azione: se riguarda la casa può essere una manual_entry "info",
se riguarda un progetto con istruzioni va nel riepilogo e nella sintesi, altrimenti resta nella nota.
Se la nota è una riflessione senza azioni, restituisci una lista vuota.
${sezioneProgetto(progetto)}`;
}

const PAYLOAD = ["text", "due", "project", "people", "description", "amount", "name", "category", "notes",
  "type", "phone", "email", "channel", "to", "subject", "body"];

export const SCHEMA = {
  type: "object",
  properties: {
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["task", "shopping_item", "expense", "manual_entry", "draft"] },
          shared: { type: "boolean" },
          summary: { type: "string" },
          payload: {
            type: "object",
            properties: {
              text: { type: "string" },
              due: { type: "string" },
              project: { type: "string" },
              people: { type: "string" },
              description: { type: "string" },
              amount: { type: "number" },
              name: { type: "string" },
              category: { type: "string" },
              notes: { type: "string" },
              type: { type: "string" },
              phone: { type: "string" },
              email: { type: "string" },
              channel: { type: "string" },
              to: { type: "string" },
              subject: { type: "string" },
              body: { type: "string" },
            },
            // Tutti obbligatori: con i campi facoltativi la grammatica dell'output strutturato
            // diventa troppo complessa («Schema is too complex» dopo decine di secondi).
            required: PAYLOAD,
            additionalProperties: false,
          },
        },
        required: ["kind", "shared", "summary", "payload"],
        additionalProperties: false,
      },
    },
  },
  required: ["actions"],
  additionalProperties: false,
};

/** Lo schema della risposta: riepilogo, sintesi, titolo e temi solo per le note di un progetto con istruzioni. */
export function schema(conRiepilogo = false) {
  if (!conRiepilogo) return SCHEMA;
  return {
    ...SCHEMA,
    properties: {
      riepilogo: { type: "string" }, sintesi: { type: "string" }, titolo: { type: "string" },
      temi: { type: "array", items: { type: "string" } },
      ...SCHEMA.properties,
    },
    required: ["riepilogo", "sintesi", "titolo", "temi", ...SCHEMA.required],
  };
}

const s = (x) => (typeof x === "string" ? x.trim() : "");

/** Tiene solo i campi che servono a ciascun tipo. */
function pulisci(kind, p = {}) {
  switch (kind) {
    case "task": return { text: s(p.text), due: /^\d{4}-\d{2}-\d{2}$/.test(s(p.due)) ? s(p.due) : "", project: s(p.project), people: s(p.people) };
    case "shopping_item": return { text: s(p.text) };
    case "expense": return { description: s(p.description) || s(p.text), amount: Number(p.amount) || 0 };
    case "manual_entry": return {
      name: s(p.name) || s(p.text), category: s(p.category), notes: s(p.notes),
      type: ["shop", "person", "info"].includes(p.type) ? p.type : "shop", phone: s(p.phone), email: s(p.email),
    };
    case "draft": return { channel: ["email", "messaggio", "documento"].includes(p.channel) ? p.channel : "messaggio", to: s(p.to), subject: s(p.subject), body: s(p.body) };
    default: return { text: s(p.text) || s(p.notes) };
  }
}

const CATEGORIE_PREDEFINITE = ["Idraulica", "Elettricità", "Vernici e ferramenta", "Agraria e giardino", "Edilizia", "Auto", "Casa", "Salute"];

/** Contesto per il modello: progetti e persone visibili all'utente, categorie del manuale,
 *  nome dell'altra persona. Solo filtri di uguaglianza: non servono indici composti. */
async function contesto(db, entry, uid) {
  const hid = entry.householdId;
  const [mie, casa, h, mieVoci, vociCasa] = await Promise.all([
    db.collection("projects").where("ownerUid", "==", uid).get(),
    hid ? db.collection("projects").where("householdId", "==", hid).where("visibility", "==", "shared").get() : null,
    hid ? db.collection("households").doc(hid).get() : null,
    db.collection("manual_entries").where("ownerUid", "==", uid).where("type", "==", "person").select("name").get(),
    hid ? db.collection("manual_entries").where("householdId", "==", hid).where("visibility", "==", "shared")
      .where("type", "==", "person").select("name").get() : null,
  ]);
  const nomi = new Set();
  for (const d of [...mie.docs, ...(casa?.docs || [])]) if (!d.data().archived) nomi.add(d.data().name);
  const persone = new Set();
  for (const d of [...mieVoci.docs, ...(vociCasa?.docs || [])]) if (d.data().name) persone.add(d.data().name);
  const casaDati = h?.exists ? h.data() : {};
  const categorie = Array.isArray(casaDati.manualCategories) ? casaDati.manualCategories : CATEGORIE_PREDEFINITE;
  const nomiCasa = casaDati.memberNames || {};
  const altro = Object.entries(nomiCasa).find(([k]) => k !== uid)?.[1] || "";
  const oggi = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const iso = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());
  return { oggi: `${oggi} (${iso})`, altro: altro.split(" ")[0], progetti: [...nomi], persone: [...persone].slice(0, 300), categorie };
}

const PRECEDENTI = 8;         // note precedenti date come contesto, quando il progetto ha già una sintesi
const PRIME_PRECEDENTI = 30;  // senza sintesi: tutte le note del progetto (fino a queste), per costruire la prima
const LUNGHEZZA_NOTA = 4000;  // caratteri per nota precedente
const LUNGHEZZA_SINTESI = 12000;
const fmtData = (t) => new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "long", year: "numeric" })
  .format(t?.toDate ? t.toDate() : new Date(t || Date.now()));

/**
 * Il progetto della nota, se ce l'ha e l'utente lo vede (suo, o condiviso nella sua casa).
 * Con le istruzioni, anche la sintesi del progetto e le ultime note dello stesso progetto (il riepilogo
 * se c'è, se no il testo); senza sintesi, tutte le note (fino a PRIME_PRECEDENTI) per costruire la prima.
 * La query usa l'indice ownerUid + projectId + createdAt; se manca (appena pubblicato) si va avanti senza.
 */
async function progettoDellaNota(db, entry, uid, passo) {
  if (!entry.projectId) return null;
  const snap = await db.collection("projects").doc(entry.projectId).get();
  if (!snap.exists) return null;
  const p = snap.data();
  const visibile = p.ownerUid === uid || (p.visibility === "shared" && p.householdId && p.householdId === entry.householdId);
  if (!visibile) return null;
  const istruzioni = s(p.istruzioni).slice(0, 8000);
  const sintesi = s(p.sintesi).slice(0, LUNGHEZZA_SINTESI);
  const quante = sintesi ? PRECEDENTI : PRIME_PRECEDENTI;
  let precedenti = [];
  if (istruzioni) {
    try {
      const q = await db.collection("journal_entries")
        .where("ownerUid", "==", uid).where("projectId", "==", entry.projectId)
        .orderBy("createdAt", "desc").limit(quante + 1).get();
      precedenti = q.docs.filter((d) => d.id !== entry.id).slice(0, quante).reverse()
        .map((d) => ({ data: fmtData(d.data().createdAt), testo: (s(d.data().riepilogo) || s(d.data().text)).slice(0, LUNGHEZZA_NOTA) }))
        .filter((n) => n.testo);
    } catch (err) {
      passo(`note precedenti non lette: ${err.message}`);
    }
  }
  return { id: snap.id, name: p.name || "senza nome", istruzioni, sintesi, precedenti };
}

/** Spese e lista riguardano sempre la casa; le bozze sono sempre solo tue. */
function visibilita(a) {
  if (a.kind === "expense" || a.kind === "shopping_item") return "shared";
  if (a.kind === "draft") return "private";
  if (a.kind === "manual_entry" && a.payload?.type === "person") return "private";
  return a.shared ? "shared" : "private";
}

/**
 * Legge la nota, scrive le proposte e, per le note di un progetto con istruzioni, il riepilogo
 * (con titolo e temi) nella nota stessa (testo correggibile, non un'azione: vedi CLAUDE.md, regola 5) e la proposta
 * di sintesi aggiornata del progetto (quella sì da confermare: sostituisce `projects.sintesi`).
 * Ritorna { azioni, riepilogo, sintesi }: quante proposte, se ha scritto il riepilogo, se ha proposto la sintesi.
 */
export async function analyzeJournalEntry(db, entry, { uid, keys, provider, passo = () => {} }) {
  const [ctx, progetto] = await Promise.all([contesto(db, entry, uid), progettoDellaNota(db, entry, uid, passo)]);
  const conRiepilogo = !!progetto?.istruzioni;
  passo(`contesto pronto (${ctx.progetti.length} progetti, ${ctx.persone.length} persone`
    + (progetto ? `, progetto con ${progetto.precedenti.length} note precedenti${conRiepilogo ? ", riepilogo" : ""}` : "") + ")");
  const out = await reason({
    system: system({ ...ctx, progetto }), user: entry.text, schema: schema(conRiepilogo), keys, provider,
    maxTokens: conRiepilogo ? 12000 : 4096,
  });
  passo(`risposta dell'AI (${Array.isArray(out.actions) ? out.actions.length : 0} azioni)`);
  const actions = (Array.isArray(out.actions) ? out.actions : []).filter((a) => SCHEMA.properties.actions.items.properties.kind.enum.includes(a.kind));
  const riepilogo = conRiepilogo ? s(out.riepilogo) : "";
  const titolo = conRiepilogo ? s(out.titolo).slice(0, 80) : "";
  const temi = conRiepilogo && Array.isArray(out.temi) ? [...new Set(out.temi.map(s).filter(Boolean))].slice(0, 12) : [];
  // La sintesi si propone solo se cambia davvero rispetto a quella del progetto.
  const sintesi = conRiepilogo ? s(out.sintesi) : "";
  const nuovaSintesi = sintesi && sintesi !== progetto.sintesi ? sintesi : "";

  // Rianalisi: le proposte ancora in attesa della stessa nota vengono sostituite. Una sintesi
  // proposta da una nota precedente e ancora in attesa è superata da quella nuova.
  const [vecchie, sintesiInAttesa] = await Promise.all([
    db.collection("proposals")
      .where("ownerUid", "==", uid).where("sourceEntryId", "==", entry.id).where("status", "==", "pending").get(),
    nuovaSintesi
      ? db.collection("proposals").where("ownerUid", "==", uid).where("kind", "==", "project_summary")
        .where("status", "==", "pending").get()
      : { docs: [] },
  ]);

  const batch = db.batch();
  vecchie.docs.forEach((d) => batch.delete(d.ref));
  sintesiInAttesa.docs.filter((d) => d.data().payload?.projectId === progetto?.id).forEach((d) => batch.delete(d.ref));
  for (const a of actions) {
    const ref = db.collection("proposals").doc();
    batch.set(ref, {
      ownerUid: uid,
      householdId: entry.householdId || null,
      visibility: visibilita(a),
      kind: a.kind,
      source: "agent",
      status: "pending",
      payload: pulisci(a.kind, a.payload),
      summary: s(a.summary),
      sourceEntryId: entry.id,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  if (riepilogo) {
    batch.update(db.collection("journal_entries").doc(entry.id), {
      riepilogo, titolo, temi, riepilogoAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
  }
  if (nuovaSintesi) {
    batch.set(db.collection("proposals").doc(), {
      ownerUid: uid,
      householdId: entry.householdId || null,
      visibility: "private",
      kind: "project_summary",
      source: "agent",
      status: "pending",
      payload: { projectId: progetto.id, projectName: progetto.name, sintesi: nuovaSintesi, prima: !progetto.sintesi },
      summary: progetto.sintesi ? `Sintesi di ${progetto.name} aggiornata` : `Prima sintesi di ${progetto.name}`,
      sourceEntryId: entry.id,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  passo(`proposte scritte${riepilogo ? ", riepilogo scritto" : ""}${nuovaSintesi ? ", sintesi proposta" : ""}`);
  return { azioni: actions.length + (nuovaSintesi ? 1 : 0), riepilogo: !!riepilogo, sintesi: !!nuovaSintesi };
}
