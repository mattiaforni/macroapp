// Agente del diario: dal testo di una nota ricava azioni e le scrive come proposte.
// Non modifica mai i moduli direttamente: ogni azione passa dalla conferma dell'utente.
import { FieldValue } from "firebase-admin/firestore";
import { reason } from "./ai/provider.js";

function system({ oggi, altro, progetti, persone, categorie }) {
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
- note: un'idea o un'informazione da conservare che non è nessuna delle altre. payload.text.
- draft: SOLO se la nota chiede di scrivere, rispondere, mandare o preparare un messaggio, una mail o un testo
  per qualcuno. Scrivi il testo pronto da inviare, in italiano, nel registro adatto al destinatario,
  firmato "Mattia" se serve una firma. payload.channel ("email", "messaggio" o "documento"),
  payload.to (destinatario se noto: il nome come in rubrica, o l'indirizzo mail), payload.subject (oggetto, per le mail), payload.body (il testo completo).

Per ogni azione:
- summary: una riga chiara di cosa verrà fatto (es. "Chiamare l'idraulico entro venerdì").
- shared: true se riguarda la casa o la coppia (spesa, lista, manuale, faccende comuni), false se è personale
  (lavoro, volontariato, cose proprie).
Se la nota è una riflessione senza azioni, restituisci una lista vuota.`;
}

const SCHEMA = {
  type: "object",
  properties: {
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["task", "shopping_item", "expense", "manual_entry", "note", "draft"] },
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

/** Spese e lista riguardano sempre la casa; le bozze sono sempre solo tue. */
function visibilita(a) {
  if (a.kind === "expense" || a.kind === "shopping_item") return "shared";
  if (a.kind === "draft") return "private";
  if (a.kind === "manual_entry" && a.payload?.type === "person") return "private";
  return a.shared ? "shared" : "private";
}

/** Ritorna il numero di proposte create. */
export async function analyzeJournalEntry(db, entry, { uid, keys, provider }) {
  const ctx = await contesto(db, entry, uid);
  const out = await reason({ system: system(ctx), user: entry.text, schema: SCHEMA, keys, provider });
  const actions = (Array.isArray(out.actions) ? out.actions : []).filter((a) => SCHEMA.properties.actions.items.properties.kind.enum.includes(a.kind));

  // Rianalisi: le proposte ancora in attesa della stessa nota vengono sostituite.
  const vecchie = await db.collection("proposals")
    .where("ownerUid", "==", uid).where("sourceEntryId", "==", entry.id).where("status", "==", "pending").get();

  const batch = db.batch();
  vecchie.docs.forEach((d) => batch.delete(d.ref));
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
  await batch.commit();
  return actions.length;
}
