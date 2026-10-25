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

- `analyzeEntry` (callable): legge una nota del diario del chiamante, chiama `reason()` con uno schema JSON e scrive proposte. Non modifica mai i moduli. Se la nota è di un progetto con istruzioni, scrive anche il riepilogo nella nota (unica scrittura senza conferma: è testo della nota, correggibile), con le ultime 8 note dello stesso progetto come contesto. Ritorna `{ proposals, riepilogo }`.
- `bank` (callable, `{ azione }`): `banche` (elenco per paese), `avvia` (`POST /auth` → url del consenso, `state` salvato in `bank_connections/{uid}.pending`), `concludi` (`POST /sessions` col `code`, controlla lo `state`, chiude la sessione precedente, salva conti e scadenza), `scollega` (`DELETE /sessions/{id}`), `sincronizza` (la lettura di `syncBank`, a richiesta). Scrive solo nel documento del chiamante.
- `contatti` (callable): Google Contatti. `avvio` → pagina di Google (OAuth con codice, `access_type=offline`);
  `collega` → scambia il codice, conserva il refresh token in `google_tokens/{uid}`; `token` → permesso di un'ora
  per la People API, che l'app usa direttamente; `scollega` → revoca e cancella.
- `syncBank` (schedulata, 07:15 Europe/Rome): per ogni `bank_connections` attiva scarica i movimenti contabilizzati degli ultimi 7 giorni e crea una proposta di spesa **personale** per ogni uscita (la spesa confermata nasce condivisa). Deduplica con id deterministico della proposta (`eb_<entry_reference>`).
- Segreti in Secret Manager, mai nel repository.

## Banca (Enable Banking)

Stato: in funzione dal 23/10 con Intesa Sanpaolo (quattro rapporti, due senza IBAN). Il 25/10 la sessione è stata chiusa nella notte, circa 36 ore dopo il consenso, con `access.valid_until` a gennaio: da allora un consenso chiuso prima della scadenza è uno stato previsto (`needsRenewal`, vedi sotto). Da verificare coi dati veri:
- quali conti espone ciascuna banca (Crédit Agricole non espone le carte di credito senza IBAN);
- formato di `entry_reference` / `transaction_id` per la deduplica, e come viene la descrizione (`descrizioneDi`: nome del creditore, altrimenti causale);
- presenza del codice categoria esercente (MCC, salvato in `payload.merchantCategory`);
- durata del consenso e flusso di rinnovo: Enable Banking documenta che molte banche italiane tengono **un solo consenso attivo per terza parte e per utente** e che uno nuovo invalida il precedente, anche se aperto dal Control Panel di Enable Banking («Link accounts» rifatto sulla stessa banca) o da un'altra app che passa da Enable Banking; una banca può anche chiudere il consenso da sé. `concludi` chiude comunque la sessione precedente. Si chiede il massimo che la banca concede (`maximum_consent_validity`, fino a 180 giorni: Intesa li concede).
- se le carte (rapporti senza IBAN) vanno lette: una carta di credito porterebbe ogni acquisto e poi l'addebito mensile sul conto, cioè due proposte per la stessa spesa.

Una sola app Enable Banking per la casa, in **produzione in modalità ristretta** (gratuita, uso personale): vede solo i conti collegati prima nel Control Panel («Link accounts»); appId e chiave stanno in Secret Manager. Un collegamento può avere credenziali proprie (`appId`/`privateKey` nel documento), ma oggi non le scrive nessuno: starebbero in un documento che il proprietario legge dal telefono.

Flusso di collegamento:
1. menu → Banca → + → elenco banche (`bank banche`) → tocco → `bank avvia`: JWT → `POST /auth` → l'app manda l'utente all'url della banca
2. la banca rimanda su `https://macroapp-b9bd0.web.app/banca?code=…&state=…` (o `?error=access_denied`): `app.js` mette l'esito in `sessionStorage` e va a `#/banca`, che chiama `bank concludi` → `POST /sessions` → conti e scadenza in `bank_connections/{uid}`
3. `syncBank` ogni mattina, o «Leggi ora» (`bank sincronizza`); la pagina avvisa quando il consenso scade entro 14 giorni (notifica push: in futuro).
4. Se Enable Banking risponde `EXPIRED_SESSION` (401 con codice `*SESSION*`, `sessioneChiusa` in enable.js): `syncConnection` legge lo stato della sessione, scrive `needsRenewal: true`, `sessionStatus`, `sessionEndedAt`; `syncBank` non la tocca più; la pagina mostra «Collegamento interrotto» e mette «Rinnova il consenso» in basso a destra, che rifà il punto 1 con la stessa banca.

## Spese: regole e saldo

- Saldo con `split: "equal"` (metà a testa) o `"full"` (tutta a carico dell'altro). Estensione prevista: percentuali.
- `expense_rules`: regole apprese dalle scelte ("ESSELUNGA → condivisa, categoria spesa"). Da applicare in `syncBank` prima di creare la proposta: se una regola corrisponde, la proposta nasce già classificata (o viene accettata automaticamente, se la regola lo prevede).
- Bonifici tra i due membri: da riconoscere come pareggi, non come spese.

## Integrazioni previste

- **Google Contatti** (People API, sola lettura), collegato una volta sola. Il refresh token resta sul server;
  l'app riceve permessi di un'ora e legge l'elenco dei contatti, che tiene solo in memoria per cercare mentre
  scrivi un nome (task, persona nuova del manuale). In rubrica (voci `person` del manuale) entrano solo le
  persone che colleghi, con `googleId`; all'avvio e all'apertura della scheda i loro recapiti si aggiornano
  da Google. Un nome proposto dall'AI si collega da solo se corrisponde a un solo contatto.
  Il deploy attiva la People API e scrive il segreto GOOGLE_OAUTH_CLIENT; l'URI di ritorno
  `https://macroapp-b9bd0.web.app/google-contatti` va autorizzato a mano nel client OAuth.
- **Registrazione audio** del diario: `transcribe()` è già prevista (Gemini accetta audio nativo); oggi si usa la dettatura da tastiera.
- **Notifiche push** (FCM): lista condivisa, consensi bancari in scadenza.
- **Web Share Target**: già dichiarato nel manifest; il contenuto condiviso diventa una proposta di appunto.

## Ordine di sviluppo

1. Shell, login, casa, lista, manuale — *fatto (base)*
2. Diario + agente + coda proposte — *fatto (base), da affinare il prompt sui casi reali*
3. Spese: inserimento manuale — *fatto (base)*; collegamento bancario — *codice fatto, da provare con l'app registrata in produzione*
4. Task — *base minima, da estendere se serve*
5. Identità visiva — *da definire*
