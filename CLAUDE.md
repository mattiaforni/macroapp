# Macroapp — istruzioni per Claude

App personale e di coppia di Mattia (PWA): lista della spesa, spese condivise, diario con agente,
task per progetti, manuale di casa. Due utenti (Mattia e la compagna) in una "casa".
Interfaccia, codice e commenti in italiano. Mattia chiede modifiche spesso dal telefono:
il lavoro tipico è «cambia questo» → commit su `main` → pubblicazione automatica.

## Architettura

- **Frontend** in `public/`: HTML, CSS e moduli JavaScript ES, nessuna compilazione.
  SDK Firebase dal CDN gstatic a versione fissata (11.3.0).
- **Dati** su Firestore, progetto `macroapp-b9bd0`. Ogni documento di contenuto ha
  `ownerUid`, `householdId`, `visibility` (`shared` | `private`): vedi `docs/MODELLO-DATI.md`.
- **Functions** in `functions/` (Node 24, europe-west1): `analyzeEntry` (agente del diario,
  provider AI intercambiabile in `src/ai/`), `bank` (onCall con `azione`: elenco banche, avvio e
  conclusione del consenso, scollega, lettura a richiesta; `src/banking/enable.js`), `contatti` (Google
  Contatti: collegamento e permessi di un'ora, `src/google/contatti.js`), `syncBank` (lettura
  quotidiana alle 7:15). firebase-admin, agente e banca si importano dentro i gestori, non all'avvio.
- **Pubblicazione**: push su `main` → `.github/workflows/deploy.yml` pubblica hosting,
  regole, indici e functions (secret `FIREBASE_SERVICE_ACCOUNT`). Si può rilanciare a mano.
- **Segreti** in Secret Manager (ANTHROPIC_API_KEY, GEMINI_API_KEY, ENABLE_BANKING_*):
  li gestisce Mattia dalla console; dopo un aggiornamento serve un nuovo deploy.
  GOOGLE_OAUTH_CLIENT invece lo scrive il deploy, copiando ID e secret del client web dalla
  configurazione di Firebase Authentication (stesso client dell'accesso con Google).

## Mappa (public/js)

| file | cosa fa |
|---|---|
| `app.js` | guscio: accesso, barra in basso, pulsante del menu, router, service worker, ricorrenti all'avvio |
| `core/router.js` | router a hash; `vaiA(id, apri)` + `richiesto(id, apri)`: il menu chiede a una pagina di aprire un suo foglio |
| `core/ui.js` | `el()`, icone disegnate a mano (`D`), date, importi, pillole |
| `core/db.js` | `create` (non aspetta il server, ritorna `{id, saved}`), `update`, `watchVisible`, `readVisible` |
| `core/household.js` | casa, nomi dei membri (`memberNames`), `nomeDi`, `updateHousehold` (es. categorie del manuale) |
| `core/rubrica.js` | voci del manuale in memoria, aggiornate in tempo reale: `trovaPersona`, `risolviPersone` (crea quelle che mancano, collegate a Google se il nome è univoco), `nomiTask`, `sincronizzaDaGoogle` (all'avvio) |
| `core/contatti-google.js` | Google Contatti: collegamento una tantum (ritorno su `/google-contatti`), permesso di un'ora dal server, elenco in memoria per `cercaContatti` / `contattoUnico` |
| `components/sheet.js` | foglio a tutta altezza: in alto indietro e titolo; in basso barra con le azioni secondarie a sinistra (anche un `div.foglio__piede` nel corpo finisce lì) e il pulsante principale a destra (`confirmLabel`, «Salva»), sopra la tastiera; il tasto indietro lo chiude |
| `components/menu.js` | menu a sinistra a gruppi (Casa, Collegamenti, Account), come in Leghe Fantacalcio |
| `components/proposals.js` | azioni proposte: `APPLICA` per tipo, `renderAzione` |
| `components/persone.js` | scelta delle persone di un task: suggerimenti dalla rubrica e da Google Contatti, persone nuove; una voce della rubrica non collegata e il contatto Google con lo stesso nome compaiono una volta sola, e sceglierla la collega |
| `modules/*/index.js` | un modulo = `{ id, title, nav, icon, mount(container) → smonta }`, in `modules/registry.js` |
| `modules/banca/index.js` | stato del collegamento (`bank_connections/{uid}` in tempo reale), scelta della banca, conclusione al ritorno da `/banca?code=…` (messo da parte in `app.js`), «Leggi ora», rinnovo, scollega |

## Regole di lavoro

1. **Design**: Mattia è preciso. Grammatica presa dall'app cura-del-verde: Instrument Sans/Serif,
   icone a linea sottile, righe con filetti invece di riquadri, campi con la sola linea sotto,
   pillole, fogli a tutta altezza. Colori solo dalle variabili in `css/base.css`.
   Identità visiva definitiva ancora da decidere: non inventarla senza che lo chieda.
2. Inserimento uniforme: in ogni pagina un + tondo in basso a destra (`fab()` in ui.js) apre il foglio
   per scrivere. Invio salva appena hai scritto tutto ciò che è obbligatorio; se manca un campo
   obbligatorio, Invio ti porta lì. Quindi: spesa = descrizione → importo → salva; task, voce del
   manuale, progetto = Invio sul primo campo salva; lista = Invio aggiunge e resta aperto per la
   prossima; nota del diario = Invio va a capo, salva il pulsante. Nei campi facoltativi a scelta
   (persone) Invio aggiunge, e a campo vuoto salva.
   **L'azione principale sta sempre in basso a destra** (zona del pollice destro): il + nelle pagine,
   «Salva» nella barra dei fogli. In alto solo orientamento (indietro, titolo, menu).
3. Navigazione: in basso le sezioni di tutti i giorni (Diario, Lista, Spese, Task); tutto il resto nel
   menu a sinistra. L'app si apre sul Diario. Riferimento di Mattia per struttura ed ergonomia (non per
   l'aspetto): l'app Leghe Fantacalcio.
4. Nuova collezione: blocco in `firestore.rules` + indici in `firestore.indexes.json`
   (servono per `householdId+visibility+ordine` e `ownerUid+ordine`). Gli ordinamenti fini
   si fanno nel modulo, per non moltiplicare gli indici.
5. Niente entra nei moduli dall'AI senza conferma: l'agente scrive solo `proposals`.
6. Mai nel repo chiavi o dati personali.

## Diagnosi delle functions

Le sessioni non leggono i log di GitHub né di Google Cloud. Il flusso «Diagnosi»
(`.github/workflows/diagnosi.yml`, da lanciare con `gh workflow run diagnosi.yml -f funzione=analyzeEntry`)
mette nelle annotazioni del job la risposta della funzione a una chiamata senza accesso, gli
invocatori del servizio Cloud Run e gli ultimi errori; con `-f ripara=true` rende la funzione
invocabile dall'app. Si leggono con `gh api repos/mattiaforni/macroapp/check-runs/<id del job>/annotations`.
Anche il deploy, se fallisce, scrive la coda del registro in un'annotazione.

Se l'app riceve «internal» da una funzione chiamata con `httpsCallable`, la prima cosa da
guardare sono gli invocatori: senza `allUsers` il preflight CORS prende 403. Il deploy lo reimposta
per le funzioni elencate nell'ultimo passo di `deploy.yml`: una nuova funzione onCall va aggiunta lì.

## Prove

```
npm install --prefix prove        # una volta: font per le schermate
python3 prove/costruisci.py       # copia public/ con Firebase finto in memoria
python3 prove/prova.py            # flusso completo in Chromium, schermate in prove/_schermate
```
Le regole di sicurezza non sono simulate. Se usi nuove funzioni dell'SDK, aggiorna `prove/finto/firebase.js`.

## Stato (23 ottobre 2026, sera) e prossimi passi

- [x] Pubblicazione automatica, accesso Google (anche da app installata), service worker
- [x] Lista (stile Bring), Spese (stile Splitwise, ricorrenti, pareggio), Diario con agente, Task per
      progetti con persone, Manuale con rubrica e categorie della casa
- [x] Agente del diario funzionante (Sonnet, ~7 s): le proposte entrano nei moduli con la spunta
- [x] Fogli con la barra in basso, menu a sinistra, apertura sul Diario, scorciatoie Chiama/WhatsApp/
      Telegram sui task con una persona che ha il numero (`modiDiContatto`, `canaleDa` in rubrica.js)
- [x] Pagine pubbliche `/privacy` e `/termini` (richieste da Enable Banking)
- [x] **Banca, codice**: function `bank` (banche → avvia `POST /auth` → ritorno su `/banca?code=…` →
      concludi `POST /sessions` → conti in `bank_connections/{uid}`; scollega; sincronizza), pagina
      Banca dal menu, proposte di spesa **personali** dai movimenti (la spesa confermata nasce condivisa).
      Il flusso è coperto dalle prove con una function finta (`prove/finto/firebase.js`).
- [ ] **Banca, messa in funzione** (Mattia, dal Control Panel di Enable Banking): app in **produzione**,
      modalità ristretta (gratuita, conti propri); «Allowed Redirect URLs» =
      `https://macroapp-b9bd0.web.app/banca`; **Link accounts** per ogni conto da leggere (senza questo
      passo `/sessions` torna senza conti); ENABLE_BANKING_APP_ID e ENABLE_BANKING_PRIVATE_KEY (il
      .pem intero) in Secret Manager, poi un deploy. Prima prova dal telefono: menu → Banca → + →
      banca → consenso → ritorno → «Leggi ora». Da verificare coi dati veri: formato di
      `entry_reference` (deduplica), descrizioni dei movimenti (`descrizioneDi` in enable.js), MCC,
      quali conti espone la banca. La compagna, per collegare il suo conto, lo aggiunge con «Link
      accounts» nello stesso Control Panel (una sola app per la casa).
- [x] **Google Contatti, integrazione vera**: permesso dato una volta (refresh token in `google_tokens`,
      solo server), ricerca nei contatti mentre si scrive un nome (task, persona nuova del manuale),
      in rubrica solo le persone collegate (`googleId`), telefono/mail/indirizzo aggiornati da Google
      all'avvio e all'apertura della scheda. L'elenco si legge tutto (`connections`, in memoria) e si
      filtra sul telefono: niente `searchContacts`, che ha una cache lenta ad aggiornarsi.
      Da fare una volta (Mattia): aggiungere `https://macroapp-b9bd0.web.app/google-contatti` agli URI
      di reindirizzamento del client «Web client (auto created by Google Service)». Se il permesso
      scade dopo 7 giorni, la schermata di consenso OAuth è in modalità di test.
- [ ] **Diario per progetto, primo caso il tennis** (idea di Mattia, 23/10). Oggi Mattia usa un
      progetto di Claude con una chat per lezione: manda la trascrizione e riceve il riepilogo (cosa ha
      fatto, cosa ha funzionato, cosa no), che tiene come diario. Scelta proposta: niente sezione a sé
      né task (un registro di lezioni non è una cosa da fare), ma **note del diario collegabili a un
      progetto**. Il progetto diventa un contenitore con due viste, Task e Diario.
      - `journal_entries.projectId` facoltativo, pillola del progetto nel foglio della nota. Le note
        restano private anche se il progetto è condiviso.
      - `projects.istruzioni`: istruzioni per l'agente, come quelle di un progetto Claude (Mattia ci
        copia le sue). Se la nota ha un progetto con istruzioni, l'agente scrive anche un riepilogo,
        avendo come contesto i riepiloghi delle ultime note dello stesso progetto (memoria tra lezioni).
      - Il riepilogo è un testo della nota (`summary`), mostrato sopra la trascrizione ripiegata. Non
        è un'azione: eccezione alla regola 5 **da confermare con Mattia**. Le azioni ricavate (task,
        spese) restano proposte.
      - Ingresso: Mattia detta da solo, dopo la lezione, ciò che il maestro gli ha insegnato (oggi con
        la dettatura di Claude in chat). Prima versione: testo incollato o condiviso nel diario (lo
        Share Target c'è già). Poi registrazione nel diario con `transcribe()` (Gemini): un parlato di
        pochi minuti passa da una chiamata onCall, senza Storage.
      - Storico: le chat del progetto Claude si possono importare dall'esportazione dei dati di claude.ai.
      - Lezioni che Mattia **prende**; nelle trascrizioni c'è solo la sua voce: nessun dato di terzi,
        niente da aggiungere alla pagina privacy. Il riepilogo serve a ricordare ciò che il maestro
        insegna; il contesto delle note precedenti serve a seguire correzioni ricorrenti e progressi.
      - Vale anche per altri progetti (es. Circolo: verbali delle riunioni).
- [ ] Pagina per appunti e bozze: le proposte `note` e `draft` confermate finiscono in `notes`,
      che oggi nessuna pagina mostra
- [ ] Riga di contesto per pagina, stile Leghe Fantacalcio (Task «2 in ritardo · 3 oggi»,
      Spese «Ottobre · X ti deve…»)
- [ ] Identità visiva definitiva: da decidere con Mattia

Bassa priorità (Mattia, 23/10: la revisione delle spese è meno rilevante), previste in
`docs/ARCHITETTURA.md`: regole di spesa apprese (`expense_rules`: c'è la regola Firestore, nessuno
le scrive né le applica in `syncBank`), bonifici tra i due membri riconosciuti come pareggi, divisione
a percentuale. Più avanti anche notifiche push (consenso in scadenza, lista condivisa).
