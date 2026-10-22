// Agente del diario: dal testo di una nota ricava azioni e le scrive come proposte in coda.
// Non modifica mai i moduli direttamente: ogni azione passa dall'approvazione dell'utente.
import { FieldValue } from "firebase-admin/firestore";
import { reason } from "./ai/provider.js";

const SYSTEM = `Sei l'assistente di un'app personale e di coppia. Ricevi una nota dettata dall'utente
(può contenere errori di dettatura e nessuna punteggiatura). Estrai SOLO le azioni concrete
che la nota contiene, senza inventarne. Tipi possibili:
- task: una cosa da fare (text, due opzionale in formato YYYY-MM-DD se esplicita)
- shopping_item: una cosa da comprare (text)
- manual_entry: un negozio, fornitore o informazione di casa da ricordare (name, category, notes)
- note: un'idea o riflessione da conservare come appunto (text)
Per ogni azione indica "shared": true se riguarda la coppia o la casa, false se personale.
Scrivi in italiano, in modo essenziale. Se la nota è solo una riflessione senza azioni, restituisci una lista vuota.`;

const SCHEMA = {
  type: "object",
  properties: {
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["task", "shopping_item", "manual_entry", "note"] },
          shared: { type: "boolean" },
          summary: { type: "string", description: "Una riga che descrive l'azione" },
          payload: {
            type: "object",
            properties: {
              text: { type: "string" },
              due: { type: "string" },
              name: { type: "string" },
              category: { type: "string" },
              notes: { type: "string" },
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

const TARGET = {
  task: "tasks",
  shopping_item: "shopping_items",
  manual_entry: "manual_entries",
  note: "notes",
};

function cleanPayload(kind, p) {
  switch (kind) {
    case "task": return { text: p.text || "", done: false, due: p.due || null, area: "" };
    case "shopping_item": return { text: p.text || "", done: false };
    case "manual_entry": return { type: "shop", name: p.name || p.text || "", category: p.category || "Altro", notes: p.notes || "", address: "", phone: "", url: "" };
    default: return { text: p.text || p.notes || "" };
  }
}

/** Ritorna il numero di proposte create. */
export async function analyzeJournalEntry(db, entry, { uid, keys, provider }) {
  const out = await reason({ system: SYSTEM, user: entry.text, schema: SCHEMA, keys, provider });
  const actions = Array.isArray(out.actions) ? out.actions : [];
  if (!actions.length) return 0;

  const batch = db.batch();
  for (const a of actions) {
    const ref = db.collection("proposals").doc();
    batch.set(ref, {
      ownerUid: uid,
      householdId: entry.householdId || null,
      visibility: a.shared ? "shared" : "private",
      kind: a.kind,
      source: "agent",
      status: "pending",
      target: TARGET[a.kind] || "notes",
      payload: cleanPayload(a.kind, a.payload || {}),
      summary: a.summary || "",
      explain: `Dalla nota del diario`,
      sourceEntryId: entry.id,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return actions.length;
}
