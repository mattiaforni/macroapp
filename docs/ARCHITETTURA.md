# Architettura

## Principi

1. **Un solo progetto, due utenti.** Login Google per entrambi; una "casa" (`households/{id}`) è il contenitore delle aree condivise.
2. **Visibilità per documento, non per modulo.** Ogni documento ha `ownerUid`, `householdId`, `visibility` (`shared`|`private`). Un modulo può contenere voci condivise e personali insieme (manuale, task); il diario è sempre personale.
3. **"Separato" = nascosto nell'interfaccia.** Le regole Firestore impediscono all'altra persona di leggere i documenti personali, ma il gestore del progetto Firebase vede tutto dalla console. Chi usa il diario deve saperlo. Se servisse riservatezza reale, il testo del diario andrebbe cifrato sul dispositivo.
4. **Niente entra nei moduli senza approvazione.** Tutto ciò che è generato automaticamente (agente, banca, contenuti condivisi da altre app) passa dalla coda `proposals`. Un solo componente (`components/proposals.js`) rende e applica le proposte di qualunque origine.
5. **Il backend non sa quale modello risponde.** `functions/src/ai/provider.js` espone `reason()` e `transcribe()`; i provider (`claude.js`, `gemini.js`) sono intercambiabili. Il modello riceve sempre testo.

## Front-end (`public/`)

```
index.html                  shell: topbar, vista, nav inferiore
js/app.js                   avvio: sessione → login | onboarding | moduli
js/core/firebase.js         init SDK (CDN), persistenza offline
js/core/auth.js             login Google, profilo users/{uid}, sessione
js/core/household.js        crea/unisciti alla casa (codice = id documento)
js/core/db.js               strato dati: create/update/remove/watchVisible/watchMine
js/core/router.js           router a hash (#/lista, #/spese, …)
js/core/ui.js               el(), toast, formattazioni, icone, selettore visibilità
js/components/onboarding.js primo accesso
js/components/proposals.js  coda di approvazione (propose/accept/reject/render)
js/modules/registry.js      elenco moduli e barra di navigazione
js/modules/<id>/index.js    un modulo = { id, title, nav, icon, mount(container) → unmount }
sw.js                       cache statica, installazione PWA
```

Scelte: nessun framework né bundler (coerente con i progetti precedenti, deploy = copia di file). SDK Firebase modulare da CDN. Query in tempo reale con `onSnapshot`; cache IndexedDB per usare la lista anche senza rete.

## Backend (`functions/`)

- `analyzeEntry` (callable): legge una nota del diario del chiamante, chiama `reason()` con uno schema JSON e scrive proposte. Non modifica mai i moduli.
- `syncBank` (schedulata, 07:15 Europe/Rome): per ogni `bank_connections` attiva scarica i movimenti degli ultimi 7 giorni e crea proposte di spesa. Deduplica con id deterministico della proposta (`eb_<id banca>`).
- Segreti in Secret Manager, mai nel repository.

## Banca (Enable Banking)

Stato: struttura scritta, chiamate reali da completare dopo il test con l'API. Da verificare al primo collegamento:
- quali conti espone ciascuna banca (Crédit Agricole non espone le carte di credito senza IBAN);
- formato di `entry_reference` / `transaction_id` per la deduplica;
- presenza del codice categoria esercente (MCC);
- durata del consenso e flusso di rinnovo (molte banche italiane tengono un solo consenso attivo per utente: crearne uno nuovo invalida il precedente).

Ogni utente registra la propria app Enable Banking (modalità ristretta, uso personale non commerciale): il backend gestisce due coppie appId/chiave.

Flusso di collegamento (da implementare come callable + pagina di ritorno):
1. `startBankLink` → JWT → `POST /auth` → URL della banca → redirect dell'utente
2. ritorno su `/?bank=callback&code=…` → `finishBankLink` → `POST /sessions` → salva `accountIds` in `bank_connections/{uid}`
3. `syncBank` quotidiana; notifica push quando il consenso sta per scadere.

## Spese: regole e saldo

- Saldo con `split: "equal"` (metà a testa) o `"full"` (tutta a carico dell'altro). Estensione prevista: percentuali.
- `expense_rules`: regole apprese dalle scelte ("ESSELUNGA → condivisa, categoria spesa"). Da applicare in `syncBank` prima di creare la proposta: se una regola corrisponde, la proposta nasce già classificata (o viene accettata automaticamente, se la regola lo prevede).
- Bonifici tra i due membri: da riconoscere come pareggi, non come spese.

## Integrazioni previste

- **Google Contatti** (People API, sola lettura): il permesso si chiede solo quando tocchi «Prendi da Google Contatti».
  Nessuna copia in blocco: in rubrica (voci `person` del manuale) entrano solo le persone che scegli, collegate
  con `googleId`. Le persone dei task stanno nella stessa rubrica. Va attivata una volta la People API nel progetto Google Cloud.
- **Registrazione audio** del diario: `transcribe()` è già prevista (Gemini accetta audio nativo); oggi si usa la dettatura da tastiera.
- **Notifiche push** (FCM): lista condivisa, consensi bancari in scadenza.
- **Web Share Target**: già dichiarato nel manifest; il contenuto condiviso diventa una proposta di appunto.

## Ordine di sviluppo

1. Shell, login, casa, lista, manuale — *fatto (base)*
2. Diario + agente + coda proposte — *fatto (base), da affinare il prompt sui casi reali*
3. Spese: inserimento manuale — *fatto (base)*; collegamento bancario — *da fare dopo il test con Enable Banking*
4. Task — *base minima, da estendere se serve*
5. Identità visiva — *da definire*
