# Debiti e Doveri (D&D) — istruzioni per Claude

App personale e di coppia di Mattia (PWA), nome «Debiti e Doveri», breve «D&D» (repository e
chiavi interne restano `macroapp`): lista della spesa, spese condivise, diario con agente,
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
  Contatti: collegamento e permessi di un'ora, `src/google/contatti.js`), `avvisa` (notifiche push,
  `src/avvisi.js`), `syncBank` (lettura quotidiana alle 7:15, poi le notifiche della banca). firebase-admin, agente e banca si importano dentro i gestori, non all'avvio.
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
| `core/router.js` | router a hash; `vaiA(id, apri)` + `richiesto(id, apri)`: il menu chiede a una pagina di aprire un suo foglio. Passaggi tra le pagine con View Transitions (`<html data-passaggio>` = `entra` / `torna`): vaiA entra sempre, il resto lo decide `transizione(da, a)` in app.js |
| `core/ui.js` | `el()`, icone disegnate a mano (`D`), date, importi, pillole, `sceltaColore` (cerchietti dei colori dei progetti, `COLORI`); `attesa(fonti, render)`: prima comparsa di una pagina quando sono arrivate tutte le sue fonti (max 400 ms), e «vuoto» solo per una fonte arrivata |
| `core/db.js` | `create` (non aspetta il server, ritorna `{id, saved}`), `update`, `watchVisible`, `readVisible`; dopo le scritture condivise di spese, task e lista chiama `segnala` (notifiche). Ascolti condivisi: la stessa query è un solo `onSnapshot`, che resta aperto 10 minuti dopo l'uscita dalla pagina; i dati già noti arrivano subito (microtask), quindi una pagina rimontata o un filtro già usato si disegnano pieni al primo fotogramma. `chiudiAscolti` all'uscita dall'account |
| `core/notifiche.js` | notifiche push: `attiva`/`disattiva` su questo telefono (token in `users.dispositivi`), categorie (`users.notifiche`), `prova`, `segnala` → funzione `avvisa`; il disegno e il tocco della notifica stanno in `sw.js` |
| `core/household.js` | casa, nomi dei membri (`memberNames`), `nomeDi`, `updateHousehold` (es. categorie del manuale) |
| `core/rubrica.js` | voci del manuale in memoria, aggiornate in tempo reale: `trovaPersona`, `risolviPersone` (crea quelle che mancano, collegate a Google se il nome è univoco), `nomiTask`, `sincronizzaDaGoogle` (all'avvio) |
| `core/contatti-google.js` | Google Contatti: collegamento una tantum (ritorno su `/google-contatti`), permesso di un'ora dal server, elenco in memoria per `cercaContatti` / `contattoUnico` |
| `components/sheet.js` | foglio a tutta altezza: in alto indietro e titolo; in basso barra con le azioni secondarie a sinistra (anche un `div.foglio__piede` nel corpo finisce lì) e il pulsante principale a destra (`confirmLabel`, «Salva»), sopra la tastiera; il tasto indietro lo chiude. Classi di movimento `foglio--entra` / `--sostituisce` / `--chiude`; `close({ subito: true })` senza dissolvenza |
| `components/menu.js` | menu a sinistra a gruppi (Progetti — quelli con istruzioni, letti all'apertura —, Casa, Collegamenti, Account), come in Leghe Fantacalcio |
| `components/proposals.js` | azioni proposte: `APPLICA` per tipo, `renderAzione` (la sintesi proposta si legge ripiegata) |
| `components/sintesi.js` | sintesi di un progetto (`projects.sintesi`): `sezioniSintesi` (una sezione «## » per tema, prima riga «Stato: …» facoltativa), `tonoStato`, foglio per correggerla |
| `components/persone.js` | scelta delle persone di un task: suggerimenti dalla rubrica e da Google Contatti, persone nuove; una voce della rubrica non collegata e il contatto Google con lo stesso nome compaiono una volta sola, e sceglierla la collega |
| `modules/*/index.js` | un modulo = `{ id, title, nav, icon, mount(container) → smonta }`, in `modules/registry.js` |
| `modules/diario/index.js` | note (anche dettate o condivise), filtro per progetto (`macroapp.diario.progetto`, lo scrive anche la pagina Task), riepilogo dell'AI con la trascrizione ripiegata, proposte sotto la nota. Esporta `apriNota`, `analizzaNota`, `titoloDi` (li usa la pagina Progetto) |
| `modules/progetto/index.js` | pagina di un progetto con istruzioni (`macroapp.progetto` = quale; menu → Progetti, o dal Diario e dai Task): viste Sintesi (righe per tema con stato e lezioni collegate via `journal_entries.temi`), Lezioni (giorno, titolo, anteprima, temi; foglio di lettura con Modifica e Rianalizza), Da fare. Titolo in testata = nome del progetto (`titoloCorrente`, letto da app.js) |
| `modules/lista/index.js` | tessere a 4 colonne; quelle da comprare divise per reparto (`REPARTI` = ordine del giro, `REGOLE_REPARTO` dal nome, `reparto` scelto a mano nel foglio Modifica); recenti e «Mi serve» per frequenza, senza reparti |
| `modules/task/index.js` | task per progetti; `apriProgetto` (nome, visibilità, istruzioni per il diario); dal progetto il pulsante Diario |
| `modules/notifiche/index.js` | pagina Notifiche (menu → Account): stato di questo telefono, «Attiva» in basso a destra, categorie, telefoni attivi, prova |
| `modules/banca/index.js` | stato del collegamento (`bank_connections/{uid}` in tempo reale), scelta della banca, conclusione al ritorno da `/banca?code=…` (messo da parte in `app.js`), «Leggi ora», rinnovo, scollega |

## Regole di lavoro

1. **Design**: Mattia è preciso. Grammatica presa dall'app cura-del-verde: Instrument Sans/Serif,
   icone a linea sottile, righe con filetti invece di riquadri, campi con la sola linea sotto,
   pillole, fogli a tutta altezza. Colori solo dalle variabili in `css/base.css`.
   Identità visiva definitiva ancora da decidere (l'icona sì, vedi Stato): non inventarla senza che lo chieda.
   Movimento come in Leghe Fantacalcio, solo opacità (durate `--t-*` in base.css): tra le sezioni
   della barra in basso nessun passaggio; menu, pulsanti che portano altrove e fogli entrano sfumando
   sul fondo (uscita breve, poi entrata); indietro e chiusura con una dissolvenza breve. Niente
   dissolvenze sull'arrivo dei dati. Con «riduci movimento» tutto cambia di colpo.
   **Mai «vuoto» prima dei dati** (26/10, dal video di Mattia): una pagina o un filtro non mostrano
   «Il diario è vuoto», «Niente da fare»… finché i dati non sono arrivati, e non compaiono a pezzi
   (`attesa` in ui.js); cambiando filtro non si svuota l'elenco. Le prove lo controllano
   (step «niente vuoto di passaggio»; il Firebase finto consegna la prima volta dopo 60 ms, come il telefono).
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
5. Niente entra nei moduli dall'AI senza conferma: l'agente scrive solo `proposals`. Unica eccezione,
   decisa da Mattia il 23/10: il riepilogo di una nota di un progetto con istruzioni
   (`journal_entries.riepilogo`), che è testo della nota stessa e si corregge dal suo foglio.
   La sintesi del progetto invece passa dalla conferma (scelta di Mattia, 26/10).
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
node functions/strumenti/prova-banca.mjs   # quali movimenti bancari diventano proposte (servono le dipendenze di functions)
node functions/strumenti/prova-avvisi.mjs  # cosa dicono le notifiche e a chi
```
Le regole di sicurezza non sono simulate. Se usi nuove funzioni dell'SDK, aggiorna `prove/finto/firebase.js`.

## Stato (26 ottobre 2026) e prossimi passi

- [x] Pubblicazione automatica, accesso Google (anche da app installata), service worker
- [x] Lista (stile Bring), Spese (stile Splitwise, ricorrenti, pareggio), Diario con agente, Task per
      progetti con persone, Manuale con rubrica e categorie della casa
- [x] Agente del diario funzionante (Sonnet, ~7 s): le proposte entrano nei moduli con la spunta
- [x] Fogli con la barra in basso, menu a sinistra, apertura sul Diario, scorciatoie Chiama/WhatsApp/
      Telegram sui task con una persona che ha il numero (`modiDiContatto`, `canaleDa` in rubrica.js)
- [x] Pagine pubbliche `/privacy` e `/termini` (richieste da Enable Banking)
- [x] **Dissolvenze come in Leghe** (24/10, dal video di Mattia: uscita ~150 ms sul fondo, entrata
      ~250 ms, indietro ~100 ms, schede in basso di fatto a taglio). Pagine: View Transitions nel
      router; fogli: animazioni CSS sul foglio, che resta attivo mentre compare; menu: velo in
      dissolvenza e cambio di pagina dopo il rientro del pannello. Le prove controllano i passaggi.
- [x] **Banca, codice**: function `bank` (banche → avvia `POST /auth` → ritorno su `/banca?code=…` →
      concludi `POST /sessions` → conti in `bank_connections/{uid}`; scollega; sincronizza), pagina
      Banca dal menu, proposte di spesa **personali** dai movimenti (la spesa confermata nasce condivisa).
      Il flusso è coperto dalle prove con una function finta (`prove/finto/firebase.js`).
- [x] **Banca collegata** (23/10, Intesa Sanpaolo, quattro rapporti di cui due senza IBAN). Il 25/10 la
      sessione si è chiusa nella notte con `EXPIRED_SESSION` (consenso dichiarato fino a gennaio): ora è uno
      stato gestito (`needsRenewal`, pagina «Collegamento interrotto» con «Rinnova il consenso» in basso a
      destra, `syncBank` lo salta, `sessionStatus` da `GET /sessions/{id}` per capire chi l'ha chiusa).
      Causa non accertata: Mattia ha riprovato a collegare, ma la sessione era già chiusa; la prossima
      volta `sessionStatus` dirà se è EXPIRED o REVOKED.
- [x] **Carta di credito** (25/10, scelta di Mattia): si leggono gli acquisti della carta uno per uno e si
      scarta il suo addebito mensile sul conto (importo abbinato a un'entrata sulla carta, altrimenti
      testo); giroconti tra conti letti scartati; scarti visibili nella pagina Banca. Regole in
      `classifica` (enable.js), prova senza rete: `node functions/strumenti/prova-banca.mjs`.
      Da verificare al primo estratto conto vero: che l'addebito finisca tra gli scartati e gli acquisti
      tra le proposte (vedi docs/ARCHITETTURA.md, Banca); cosa sia il quarto rapporto senza IBAN.
      25/10: Mattia non vedeva gli acquisti con la carta del giorno prima. Il rinnovo e le letture erano
      riusciti; ipotesi: movimenti non ancora contabilizzati, che non diventano proposte. Ora la pagina
      Banca li mostra («In attesa di contabilizzazione») e dice per conto quanti movimenti ha dato la banca
      (`lettura` in bank_connections). Se la carta risulta con 0 movimenti letti, Intesa non li espone.
      Poi: la carta dava 29 movimenti, ma gli acquisti del giorno prima né proposti né in attesa. Toccando
      un conto ora si vedono gli ultimi 12 movimenti con l'esito di ciascuno (`lettura.conti[].ultimi`):
      da lì si capisce se Intesa li segna come entrate, con uno stato diverso o con una data fuori periodo.
      Repository pubblico: niente testi dei movimenti nei registri (Diagnosi li pubblica).
      25/10, 11:42: dopo quattro letture col consenso nuovo Intesa ha risposto 429 «consented multiplicity
      per day» (limite PSD2 di 4 letture al giorno senza l'utente). «Leggi ora» ora manda le intestazioni
      PSU (IP e browser dell'utente), così non conta; da verificare che Intesa le rispetti.
- [ ] **Banca, messa in funzione** (fatto, tenuto come promemoria per l'altra persona): app in **produzione**,
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
- [x] **Diario per progetto** (primo caso il tennis: lezioni che Mattia prende, dettate da lui dopo
      la lezione). Una nota può avere un progetto (`journal_entries.projectId`); un progetto può avere
      istruzioni per il diario (`projects.istruzioni`, come quelle di un progetto Claude). Con le
      istruzioni l'agente scrive anche `riepilogo` nella nota, con come contesto le ultime 8 note dello
      stesso progetto (riepilogo se c'è, se no testo; indice ownerUid + projectId + createdAt, senza
      indice va avanti senza contesto). Diario: pillole Tutte/progetti (quelli con istruzioni o con
      note), riepilogo al posto del testo e «Trascrizione» ripiegata; nel progetto dei Task il pulsante
      Diario apre il Diario filtrato. Le note restano private anche in un progetto condiviso.
      Prova con l'API vera: Diagnosi con `provaai` e `istruzioni` compilato.
- [x] **Sintesi del progetto** (26/10, scelta di Mattia). Tre livelli: la nota (log), il riepilogo della nota
      (la lezione ripulita), la sintesi del progetto (lo stato: cosa è emerso finora, per temi, secondo le
      istruzioni). L'agente propone la sintesi aggiornata dopo ogni nota di un progetto con istruzioni
      (`project_summary`, sotto la nota, ripiegata); la spunta scrive `projects.sintesi`; si corregge a mano
      dalla pagina del progetto. La prima sintesi si costruisce da tutte le note del progetto (fino a 30); poi
      il contesto è sintesi + ultime 8 note. Il tipo di proposta «Appunto» (`note`) non viene più proposto: le
      informazioni vanno nella sintesi, nel manuale («info») o restano nella nota.
      Mattia prova per qualche settimana in parallelo il progetto Claude e questo diario.
- [x] **Pagina del progetto** (26/10, scelte C+D tra quattro schermate): menu → Progetti → Tennis. Sintesi per
      temi (le sezioni «## » del testo, con «Stato: …» come etichetta colorata e le lezioni in cui il tema è
      emerso), Lezioni (giorno grande, titolo e temi scritti dall'AI con il riepilogo: `journal_entries.titolo`,
      `temi`; foglio di lettura con riepilogo intero e trascrizione ripiegata), Da fare. La struttura per temi è
      una convenzione sul testo, non uno schema annidato (che l'output strutturato non regge): il collegamento
      tema → lezioni lo fa l'app incrociando `temi` con i nomi delle sezioni. Le note analizzate prima del 26/10
      non hanno titolo né temi finché non si rianalizzano (titolo di ripiego dalla prima riga del riepilogo).
      Da verificare con le note vere: che i nomi dei temi restino stabili da una lezione all'altra.
      La data di una nota si cambia dal suo foglio (pillola «Giorno», come in Spese): Mattia inserisce le
      lezioni passate per partire dalla stessa base del progetto Claude; l'ordine ovunque segue `createdAt`.
      26/10, 11:10: la prima sintesi vera aveva come sezioni le rubriche delle istruzioni («Nodi ricorrenti»,
      «Stato per colpo», «Su cosa lavorare», «Fisico»), quindi i temi delle note erano quelli e i contatori
      inutili. Il prompt ora dice che le sezioni sono i temi concreti (un colpo, gli spostamenti, il fisico) e
      che le rubriche delle istruzioni vivono dentro ogni tema; se le istruzioni elencano i temi, usa quelli.
      **Colore del progetto** (`projects.colore`: giallo pallina, arancio, azzurro, rosa, verde; scelta nel
      foglio del progetto, `sceltaColore` in ui.js): sulla pagina del progetto (`.pagina-progetto`, con
      `<html data-colore>`) prende il posto dell'accento su pillole attive, +, giorni, etichette dei temi,
      nome del tema aperto, pallino accanto al titolo e nel menu. Variabili `--c-<colore>*` in base.css,
      chiaro e notte. Primo caso: Tennis giallo (richiesta di Mattia).
      **Storico della sintesi** (26/10, richiesta di Mattia): ogni cambio (spunta della proposta, modifica a mano,
      ripristino) mette la versione precedente in `projects.sintesiStorico` (ultime 10, `{ testo, at, origine }`),
      sempre via `salvaSintesi` in components/sintesi.js. «Versioni» nella vista Sintesi: si rileggono e si
      ripristinano (l'attuale finisce nello storico).
- [ ] Diario per progetto, seguiti: importare lo storico delle lezioni dalle chat del progetto Claude
      (esportazione dei dati di claude.ai); registrare nel diario con `transcribe()` (Gemini: un parlato
      di pochi minuti passa da onCall, senza Storage); valutare con le note vere quante precedenti servono
      e se la sintesi proposta rispetta le correzioni fatte a mano.
- [x] **Lista per reparti** (25/10, scelta di Mattia tra tre anteprime: etichette con filetto). Reparti e
      ordine del giro sono un'ipotesi: da adattare quando Mattia dice in che ordine li trova nel suo
      supermercato. Corretta l'icona dei surgelati («gelat» prendeva anche «surgelate»).
- [x] **Nome** (25/10, scelta di Mattia): «Debiti e Doveri», breve «D&D» (manifest, titoli, pagine pubbliche).
- [x] **Notifiche push** (25/10): spese condivise e pareggi, task condivisi nuovi e fatti, aggiunte alla lista
      (una notifica che si aggiorna), banca (spese da confermare dopo la lettura del mattino, consenso chiuso).
      Mai a chi ha fatto la cosa; categorie per persona. L'app segnala, il server decide (docs/ARCHITETTURA.md,
      Notifiche). Da verificare dal telefono: attivazione (menu → Notifiche → Attiva → «Manda una prova») su
      entrambi i telefoni; se `getToken` fallisce, controllare che la chiave API web non escluda le API
      «Firebase Installations» e «FCM Registration».
- [x] **Niente lampi di «vuoto»** (26/10, dal video di Mattia): cambiando filtro nel Diario compariva per
      ~100 ms «Nessuna nota in questo progetto» / «Il diario è vuoto», e lo stesso in Task e Spese all'apertura.
      Ora ascolti condivisi in db.js, `attesa` nelle pagine con più fonti, anteprima del filtro dalle ultime note.
      Corretto anche il foglio di Google Contatti, che aspetta la rubrica (senza, chi c'è già sembrava nuovo).
- [ ] Bozze confermate: finiscono in `notes`, che nessuna pagina mostra (si usano dalla proposta: Copia, Apri
      nella mail/WhatsApp). Decidere se serve una pagina o se togliere la conferma.
- [ ] Riga di contesto per pagina, stile Leghe Fantacalcio (Task «2 in ritardo · 3 oggi»,
      Spese «Ottobre · X ti deve…»)
- [x] **Icona** (26/10, scelta di Mattia tra una trentina di varianti): due palline sovrapposte, giallo pallina
      (`--c-giallo`) a sinistra e verdolino (`--tessera-verde`) a destra, la parte in comune del colore del fondo
      (inchiostro #1F1F1C). Le due persone e ciò che condividono; il giallo richiama il tennis. Mattia usa le
      icone tonde: palline di raggio 16 su 64, dentro la zona sicura del ritaglio. Sorgenti `icons/icon.svg`
      (tonda, favicon e «any») e `icons/icon-maskable.svg` (fondo pieno: PNG maskable e `apple-touch-icon.png`).
      I PNG si rigenerano dagli SVG (Chromium, sfondo trasparente). Scartato lo sfondo carta: il giallo non si vedeva.
      Sui telefoni: Chrome rilegge il manifest all'avvio (al più una volta al giorno) e aggiorna l'app
      installata con nome e icona nuovi, senza reinstallarla; da Chrome 144 può chiedere conferma
      («Rivedi aggiornamento dell'app»). Il cambio di nome del 25/10 segue la stessa strada.
- [ ] Identità visiva definitiva (resto dell'app): da decidere con Mattia

Bassa priorità (Mattia, 23/10: la revisione delle spese è meno rilevante), previste in
`docs/ARCHITETTURA.md`: regole di spesa apprese (`expense_rules`: c'è la regola Firestore, nessuno
le scrive né le applica in `syncBank`), bonifici tra i due membri riconosciuti come pareggi, divisione
a percentuale. Notifiche ancora non previste: spese modificate o eliminate dall'altra persona, consenso
della banca vicino alla scadenza.
