# Modello dati (Firestore)

Campi comuni a tutte le collezioni di contenuto, compilati da `core/db.js`:

| campo | tipo | note |
|---|---|---|
| `ownerUid` | string | chi ha creato il documento |
| `householdId` | string | casa di appartenenza (anche per i documenti personali) |
| `visibility` | `shared` \| `private` | chi lo vede nell'interfaccia; applicato anche dalle regole |
| `createdAt`, `updatedAt` | timestamp | server |

## `users/{uid}`
`displayName, email, photoURL, householdId, createdAt`

## `households/{id}`
`name, members: [uid, uid], memberNames: { uid: "Nome Cognome" }, createdBy, createdAt` — l'id è il codice di invito.

## `shopping_items`
`text, detail, done, addedAt, boughtAt, count, doneBy` — sempre `shared`. `done: true` = comprato (resta tra i "usati di recente"), `false` = da comprare. Non si cancella quando lo compri.

## `manual_entries`
`type: "shop"|"info", name, category, notes, address, phone, url`

## `expenses`
`amount, description, paidBy, split: "equal"|"full", date, category, source: "manual"|"recurring"|"agent"|"bank", type?: "settlement", recurringId?, bankTxId?`
`split: "full"` = tutta a carico di chi non ha pagato. Il pareggio è una spesa `type: "settlement"` pagata da chi deve, tutta a carico dell'altro.

## `recurring_expenses`
`description, amount, paidBy, split, every: "week"|"month"|"year", nextDate, active` — all'avvio l'app genera le spese scadute con id `rec_<id>_<AAAA-MM-GG>` (nessun doppione se lo fanno entrambi i telefoni).

## `projects`
`name, archived` — personali o condivisi.

## `expense_rules`
`match: { description_contains }, set: { visibility, category, split, autoAccept }` — da definire con i dati reali.

## `tasks`
`text, done, doneAt, due ("AAAA-MM-GG"), projectId, people, note` — personali per impostazione predefinita, o con la visibilità del progetto.

## `journal_entries`
`text, analyzed, analyzedAt` — sempre `private`, solo il proprietario (anche nelle regole).

## `notes`
`text`, e per le bozze `type: "draft", channel, to, subject` — appunti e bozze salvate dalle azioni proposte.

## `proposals`
`kind: "task"|"shopping_item"|"expense"|"manual_entry"|"note"|"draft", source: "agent"|"bank"|"share", status: "pending"|"accepted"|"rejected", payload, summary, decidedBy, sourceEntryId`
Cosa fa la conferma, tipo per tipo: `APPLICA` in `public/js/components/proposals.js`. Le proposte dell'agente compaiono sotto la nota del diario da cui nascono; rianalizzare una nota sostituisce quelle ancora in attesa.

## `bank_connections/{uid}`
`ownerUid, householdId, active, appId, privateKey, sessionId, accountIds, consentExpiresAt, lastSyncAt, lastSyncCreated, lastError`
Scritta solo dalle Functions. Il client legge solo la propria.

## Regole in sintesi (`firestore.rules`)

- lettura: proprietario, oppure membro della casa se `shared`
- creazione: `ownerUid` = chiamante, `householdId` di cui è membro, `visibility` valida
- modifica: proprietario; i membri possono modificare i documenti condivisi senza toccare `ownerUid`, `householdId`, `visibility`
- cancellazione: proprietario o membro (se condiviso)
- `journal_entries`: solo proprietario, `visibility` forzata a `private`
- `households`: un non membro può solo aggiungersi, fino a 2 membri
