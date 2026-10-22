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
`name, members: [uid, uid], createdBy, createdAt` — l'id è il codice di invito.

## `shopping_items`
`text, done, doneBy` — sempre `shared`. Futuro: `section` (reparto), `qty`.

## `manual_entries`
`type: "shop"|"info", name, category, notes, address, phone, url`

## `expenses`
`amount, description, paidBy, split: "equal"|"full", date, category, source: "manual"|"bank", bankTxId`

## `expense_rules`
`match: { description_contains }, set: { visibility, category, split, autoAccept }` — da definire con i dati reali.

## `tasks`
`text, done, due, area` — personali per impostazione predefinita.

## `journal_entries`
`text, analyzed, analyzedAt` — sempre `private`, solo il proprietario (anche nelle regole).

## `notes`
`text` — appunti generici (dall'agente o da contenuti condivisi).

## `proposals`
`kind, source: "agent"|"bank"|"share"|"rule", status: "pending"|"accepted"|"rejected", target, payload, summary, explain, decidedBy, sourceEntryId`
Accettare = creare `target` con `payload` e la stessa `visibility`. Le proposte bancarie hanno id deterministico `eb_<id transazione>` per la deduplica.

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
