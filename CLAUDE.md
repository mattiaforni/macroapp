# Debiti e Doveri (D&D) — istruzioni per Claude

App personale e di coppia di Mattia (PWA), nome «Debiti e Doveri», breve «D&D» (repository e
chiavi interne restano `macroapp`): lista della spesa, spese condivise, diario con agente,
task per progetti, manuale di casa, calendario della casa e calendari di ciascuno (su Google Calendar), domande all'AI sui
propri dati (Chiedi). Due utenti (Mattia e la compagna) in una "casa".
Interfaccia, codice e commenti in italiano. Mattia chiede modifiche spesso dal telefono:
il lavoro tipico è «cambia questo» → commit su `main` → prove → pubblicazione automatica.

Documenti: `docs/ARCHITETTURA.md` (come funziona e perché), `docs/MODELLO-DATI.md` (collezioni e campi),
`docs/MAPPA.md` (ogni file del front-end nel dettaglio), `docs/STORIA.md` (cronaca dei lavori, dalla più vecchia).

## Architettura

- **Frontend** in `public/`: HTML, CSS e moduli JavaScript ES, nessuna compilazione.
  SDK Firebase dal CDN gstatic a versione fissata (11.3.0).
- **Dati** su Firestore, progetto `macroapp-b9bd0`. Ogni documento di contenuto ha
  `ownerUid`, `householdId`, `visibility` (`shared` | `private`): vedi `docs/MODELLO-DATI.md`.
- **Functions** in `functions/` (Node 24, europe-west1; firebase-admin, agente e banca si importano dentro i gestori,
  non all'avvio):
  - `analyzeEntry`: agente del diario (`src/agent.js`, provider in `src/ai/`): legge la nota, le foto, i documenti di Drive
    del progetto (anche i PDF, `src/google/drive.js`) e ciò che c'è già (task aperti, lista, eventi); scrive proposte;
    modello scelto dall'utente (`modelloPer`), 300 s; costi in `consumi` (`src/consumi.js`);
  - `trascrivi`: nota vocale → testo con Gemini Flash e il vocabolario del progetto, a pezzi (`src/trascrizione.js`);
    l'audio non si salva;
  - `chiedi`: domande sui propri dati, Claude con strumenti di sola lettura (`src/chiedi.js`, stato su `domande/{id}`);
    `revisioneSettimana` (domenica 18:47, `src/settimana.js`);
  - `bank` (consenso, letture, `src/banking/enable.js`) e `syncBank` (ogni giorno alle 7:15);
  - `google`: collegamento una tantum con Contatti, Calendario e Drive, permessi di un'ora (`src/google/account.js`);
  - `avvisa` (notifiche push, `src/avvisi.js`) e `giroAvvisi` (ogni 5 minuti: eventi nuovi, promemoria, riepilogo delle
    7:30, `src/avvisi-calendario.js`);
  - `prodotto` (scheda da Open Food Facts / Open Beauty Facts con l'indice, cache `prodotti/{ean}`, `src/prodotti/`) e
    `contribuisci` («Completa» su OFF con l'account dell'utente in `off_account/{uid}`, `src/prodotti/contributo.js`);
  - `backupSettimanale` (lunedì 3:17: export di Firestore nel bucket `macroapp-b9bd0-backup`, `src/backup.js`;
    ripristino con il flusso Ripristino, docs/ARCHITETTURA.md, Backup).
- **Pubblicazione**: push su `main` → `.github/workflows/deploy.yml` fa girare le prove (`prove.yml`: functions,
  regole di Firestore sull'emulatore, flusso dell'app in Chromium) e, solo se passano, pubblica hosting, regole, indici e
  functions (secret `FIREBASE_SERVICE_ACCOUNT`) e prepara il bucket dei backup. Prove non passate → niente pubblicazione,
  schermate nell'artifact `schermate` dell'esecuzione. Si può rilanciare a mano; la spunta «Emergenza: pubblica senza
  prove» salta le prove. Le prove girano da sole anche sui push degli altri rami.
- **Segreti** in Secret Manager (ANTHROPIC_API_KEY, GEMINI_API_KEY, ENABLE_BANKING_*):
  li gestisce Mattia dalla console; dopo un aggiornamento serve un nuovo deploy.
  ANTHROPIC_API_KEY (dal 27/10) è una chiave dell'organizzazione Console dell'account col piano Max, collegata
  ai crediti API inclusi nel piano (100 $ al mese, scadono a fine mese, nessun metodo di pagamento).
  Claude non accetta audio: le note vocali le trascrive Gemini con GEMINI_API_KEY (livello a pagamento di Google,
  dove l'audio non è usato per migliorare i prodotti). GOOGLE_OAUTH_CLIENT invece lo scrive il deploy, copiando ID e
  secret del client web dalla configurazione di Firebase Authentication (stesso client dell'accesso con Google).

## Mappa (public/js)

Una riga per file, per orientarsi; i dettagli di ciascuno sono in `docs/MAPPA.md`.

| file | cosa fa |
|---|---|
| `app.js` | guscio: accesso, barra in basso, router, service worker, versione nuova al ritorno nell'app, azioni in testata |
| `core/barra.js` | sezioni della barra in basso per persona (`users.barra`, al più 5, anche i progetti `progetto-<id>`) |
| `core/router.js` | router a hash: `vaiA` / `richiesto`, `sostituisci` (pagina già montata), passaggi con View Transitions |
| `core/scorrimento.js` | scorrimento col dito tra le sezioni della barra, con la pagina accanto montata a lato |
| `core/ui.js` | `el()`, icone, date, importi, `colonnaGiorno`, pillole e colori dei progetti, `fab` / `fabDoppio`, `attesa`, `puntoToccato` |
| `core/db.js` | scritture con visibilità, ascolti condivisi (aperti 10 min dopo l'uscita), `segnala` per le notifiche |
| `core/note.js` | chi vede le note: visibilità dal progetto, `seguiNote`, `allineaProgetto` / `allineaNote` |
| `core/modelli.js` | modelli dell'AI per persona (`users.modelli`) e consumi del mese |
| `core/notifiche.js` | notifiche push su questo telefono, categorie per persona, `segnala` → function `avvisa` |
| `core/household.js` · `core/auth.js` | casa e nomi dei membri · accesso con Google e profilo |
| `core/rubrica.js` | voci del manuale in memoria, persone dei task, allineamento con Google Contatti |
| `core/google.js` · `core/contatti-google.js` | account Google (stato, permesso di un'ora, `chiamaGoogle`) · Contatti in memoria |
| `core/calendario.js` | calendari (casa + altri per persona), eventi dei prossimi 60 giorni, scrittura su Google, ripetizioni |
| `core/drive.js` · `core/archivio.js` | ricerca in Drive · archivio sul telefono (IndexedDB) delle note vocali |
| `components/sheet.js` | foglio a tutta altezza: azioni in basso, tastiera solo su campo vuoto, `scriviDa` |
| `components/menu.js` · `components/onboarding.js` | menu a sinistra a gruppi · primo accesso (crea casa o entra col codice) |
| `components/proposals.js` | azioni proposte: `APPLICA` per tipo, `renderAzione`, `segnaAccettata` |
| `components/sintesi.js` | sintesi di un progetto per temi, foglio per correggerla, storico |
| `components/prodotto.js` | scanner del codice a barre e scheda del prodotto come in Yuka (alimenti e cosmetici) |
| `components/contributo.js` | «Completa» la scheda su Open Food Facts: foto, lettura con Claude, invio dei campi mancanti |
| `components/documenti.js` | documenti di Drive collegati a progetti e voci del manuale |
| `components/foto.js` | foto delle note: scelta, riduzione, striscia, visore (`journal_photos`) |
| `components/registratore.js` | nota vocale a pezzi: taglia nelle pause, trascrive ogni pezzo, tiene tutto sul telefono fino al salvataggio |
| `components/persone.js` | scelta delle persone (rubrica e Google Contatti) |
| `modules/*/index.js` | un modulo = `{ id, title, nav, icon, mount(container) → smonta }`, in `modules/registry.js` |
| `modules/diario` | Diario: note che vedi, riga, foglio di lettura e di scrittura, filtro per progetto, prossimi giorni, analisi |
| `modules/progetto` | pagina di un progetto: Sintesi, Note, Da fare |
| `modules/chiedi` | Chiedi: domande sui propri dati, risposta con fonti toccabili |
| `modules/lista` · `modules/scansioni` | lista della spesa a tessere e reparti, scansione · prodotti scansionati |
| `modules/task` | task per progetti a fasce, giorno a sinistra, foglio del progetto |
| `modules/calendario` | agenda, foglio dell'evento come in Google Calendar, scelta dei calendari |
| `modules/spese` · `modules/banca` | saldo, pareggio, ricorrenti, uscite della banca da confermare · collegamento con la banca |
| `modules/manuale` · `modules/proposte` | manuale di casa e rubrica · tutte le azioni in attesa |
| `modules/barra`, `modelli`, `notifiche`, `google`, `impostazioni` | pagine del menu (Account, Collegamenti) |

## Regole di lavoro

1. **Design**: Mattia è preciso. Grammatica presa dall'app cura-del-verde: Instrument Sans/Serif,
   icone a linea sottile, righe con filetti invece di riquadri, campi con la sola linea sotto,
   pillole, fogli a tutta altezza. Colori solo dalle variabili in `css/base.css`.
   Identità visiva definitiva ancora da decidere (l'icona sì, docs/STORIA.md 26/10): non inventarla senza che lo chieda.
   Movimento come in Leghe Fantacalcio, solo opacità (durate `--t-*` in base.css): tra le sezioni
   della barra in basso nessun passaggio dalla barra, scorrimento che segue il dito col gesto (core/scorrimento.js); menu, pulsanti che portano altrove e fogli entrano sfumando
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
   **Tastiera solo per scrivere** (31/10, dal video di Mattia): un foglio si apre con la tastiera solo se il
   primo campo è vuoto (il +, una ricerca). Aprendo una cosa già scritta (progetto, task, spesa, voce, sintesi,
   nota, pareggio, un task nato da una nota) niente tastiera: si legge tutto il foglio e la tastiera arriva
   toccando il campo. Regola in `components/sheet.js`. **Un testo si tocca per scriverlo** (stessa richiesta):
   dove un testo è mostrato da leggere (nota nel foglio di lettura, sintesi del progetto) toccarlo apre il
   campo col cursore dove hai toccato, senza passare da «Modifica» (`puntoToccato` + `scriviDa`). Un pulsante
   («Modifica», «Modifica la sintesi», «Modifica progetto») apre invece il foglio senza tastiera.
   **L'azione principale sta sempre in basso a destra** (zona del pollice destro): il + nelle pagine,
   «Salva» nella barra dei fogli. In alto solo orientamento (indietro, titolo, menu).
3. Navigazione: in basso le sezioni di tutti i giorni (di base Diario, Lista, Spese, Task; dal 3/11 ognuno
   sceglie le sue e l'ordine, anche un progetto, da menu → Barra in basso: `core/barra.js`), tra cui si passa anche
   scorrendo la pagina a sinistra o a destra (30/10, richiesta di Mattia); tutto il resto nel
   menu a sinistra. L'app si apre sulla prima sezione della barra. Riferimento di Mattia per struttura ed ergonomia (non per
   l'aspetto): l'app Leghe Fantacalcio.
4. Nuova collezione: blocco in `firestore.rules` + indici in `firestore.indexes.json`
   (servono per `householdId+visibility+ordine` e `ownerUid+ordine`) + casi in `prove/regole/prova-regole.mjs`.
   Gli ordinamenti fini si fanno nel modulo, per non moltiplicare gli indici.
5. Niente entra nei moduli dall'AI senza conferma: l'agente scrive solo `proposals` (anche gli eventi
   del calendario: proposta `event`, scritta su Google solo con la spunta). Eccezioni, perché sono la nota
   stessa e si correggono dal suo foglio: il riepilogo di una nota di un progetto con istruzioni
   (`journal_entries.riepilogo`, deciso da Mattia il 23/10), il titolo e le persone nominate di ogni nota
   (`titolo`, `persone`, richiesta di Mattia del 29/10; una persona taggata non entra in rubrica).
   La sintesi del progetto invece passa dalla conferma (scelta di Mattia, 26/10).
6. Mai nel repo chiavi o dati personali.
7. **Cronache in `docs/STORIA.md`**: cosa si è fatto, scelto e scoperto in un lavoro si aggiunge in fondo a STORIA.md,
   sotto il giorno (stile delle voci che ci sono). In CLAUDE.md non si scrivono cronache: si aggiornano solo la mappa,
   le regole, «Decisioni in vigore» (una riga per una scelta nuova di Mattia da non rimettere in discussione),
   «Da verificare» (togliere ciò che è stato verificato, aggiungere il nuovo) e «Aperti». Obiettivo: sotto i 25 KB.

## Diagnosi delle functions

Le sessioni non leggono i log di GitHub né di Google Cloud. Il flusso «Diagnosi»
(`.github/workflows/diagnosi.yml`, da lanciare con `gh workflow run diagnosi.yml -f funzione=analyzeEntry`)
mette nelle annotazioni del job la risposta della funzione a una chiamata senza accesso, gli
invocatori del servizio Cloud Run e gli ultimi errori; con `-f ripara=true` rende la funzione
invocabile dall'app. Si leggono con `gh api repos/mattiaforni/macroapp/check-runs/<id del job>/annotations`.
Anche il deploy, se fallisce, scrive la coda del registro in un'annotazione.
Con `-f note=true` (7/11) il flusso conta le note per progetto, autore («membro 1/2») e visibilità, mostra le ultime di
ciascuno e lo stato degli indici di `journal_entries` (niente testi, nomi né uid: le annotazioni sono pubbliche); con anche
`-f allinea=true` porta sul server le note e le foto alla visibilità del loro progetto (`functions/strumenti/diagnosi-note.mjs`).
Con `backup=true` (14/11) la data dell'ultimo backup riuscito, i backup nel bucket, la conservazione e le ultime operazioni
di export e import; con anche `backupora=true` fa un backup subito. Il ripristino è un flusso a parte,
`.github/workflows/ripristino.yml` (prova su un database temporaneo, o sui dati veri con `conferma` = RIPRISTINA).
`gh workflow run` qui non va (GraphQL bloccato): `gh api -X POST repos/mattiaforni/macroapp/actions/workflows/diagnosi.yml/dispatches -f ref=main -f 'inputs[note]=true'`,
oppure gli strumenti `mcp__github__actions_*` (lancio, esecuzioni, job).

Se l'app riceve «internal» da una funzione chiamata con `httpsCallable`, la prima cosa da
guardare sono gli invocatori: senza `allUsers` il preflight CORS prende 403. Il deploy lo reimposta
per le funzioni elencate nell'ultimo passo di `deploy.yml`: una nuova funzione onCall va aggiunta lì.

## Prove

Le stesse prove girano prima di ogni pubblicazione (`.github/workflows/prove.yml`): una prova rossa ferma il deploy.
```
npm install --prefix prove        # una volta: font per le schermate
python3 prove/costruisci.py       # copia public/ con Firebase finto in memoria
python3 prove/prova.py            # flusso completo in Chromium, schermate in prove/_schermate (esce con 1 se si ferma
                                  # o se la pagina ha un errore non gestito / console.error)
npm ci --prefix prove/regole && npm run prova --prefix prove/regole   # regole di Firestore sull'emulatore (serve Java)
node functions/strumenti/prova-banca.mjs   # quali movimenti bancari diventano proposte (servono le dipendenze di functions)
node functions/strumenti/prova-avvisi.mjs  # cosa dicono le notifiche e a chi (anche giro del calendario con Google finto e riepilogo)
node functions/strumenti/prova-prodotti.mjs # indice dei prodotti su schede OFF costruite a mano
node functions/strumenti/prova-chiedi.mjs   # Chiedi senza rete: strumenti, privacy, fonti, giro con un Claude finto; revisione e costi
node functions/strumenti/prova-contributo.mjs # «Completa» su Open Food Facts senza rete
node functions/strumenti/prova-backup.mjs   # backup settimanale con l'API di export finta
python3 prove/additivi.py                   # rigenera la tabella degli additivi dalla tassonomia OFF
```
Il Firebase finto di `prova.py` non applica le regole: per quelle c'è `prove/regole/prova-regole.mjs` (emulatore vero, due
case, note e foto condivise, collezioni del server). Una regola nuova o cambiata → un caso lì. Se usi nuove funzioni dell'SDK,
aggiorna `prove/finto/firebase.js`. In questa sessione Python Playwright si installa con
`pip install --break-system-packages playwright==1.63.0` (stessa versione del Chromium in /opt/pw-browsers).
Altre prove con le API vere, da terminale: `MODELLO=opus ISTRUZIONI=… node functions/strumenti/prova-agente.mjs "…"`
(agente; con `CONTATTI="Nome Cognome, …"` stampa titolo e persone), `node functions/strumenti/prova-trascrizione.mjs file.webm`.

## Decisioni in vigore

Scelte di Mattia da non riproporre (il perché e il contesto in docs/STORIA.md, alla data):
- **Niente lettura delle mail** (14/11): né bollette né ordini da Gmail. Le bozze vere in Gmail restano una possibilità
  non decisa (servirebbe il permesso Gmail e un nuovo collegamento a Google).
- **Nutri-Score**: non gli interessa (31/10): non si mostra nella scheda né si propone un Nutri-Score continuo.
- **Indice dei prodotti com'è** (31/10): «una media di tutto, un punteggio nostro» (modello 2 del 29/10); non proporre di
  ricavare la parte nutrizionale da Positivo / Negativo né altre formule.
- **Banca che impara a bassa priorità** (23/10, ribadito il 14/11): regole di spesa apprese (`expense_rules`), bonifici tra
  i due come pareggi, divisione a percentuale. Non proporli.
- **Idee scartate il 27/10** (riferite da Mattia il 14/11): faccende, scadenze, menu, dispensa.
- Crediti API: inclusi nel piano Max, 100 $ al mese: non proporre di comprarne.
- Trascrizione con Gemini Flash (27/10; scartato `gemini-3.5-transcribe`); non parola per parola col riconoscimento del telefono.
- Lista a 4 colonne (25/10, confermato il 29/10: si è cambiato l'accesso alla scheda, non le colonne).
- Foto delle note su Firestore (`journal_photos`), non su Cloud Storage (4/11), finché non sono centinaia.
- Sintesi del progetto: passa dalla conferma (26/10), si propone da sola a ogni nota, senza pulsante «Aggiorna» (29/10).
  Il tipo «Appunto» (`note`) non si propone più (26/10). Per le note semplici bastano titolo e persone (29/10).
- Calendario: eventi solo su Google, niente copia su Firestore; altri calendari per persona, si scrive solo nel principale
  e in quello della casa; scartato leggere i calendari dell'uno per l'altra dal server (1/11). Nessun «+ Evento» in alto
  nel Diario (2/11: tondo sopra il + e trasformazione della nota).
- Niente ricerca libera dell'agente su tutto il Drive (27/10).
- Backup: export settimanale (8 settimane) **più** ripristino a un momento passato (PITR, 7 giorni), scelto il 14/11.
- Icona: due palline, giallo e verdolino (26/10). Nome: «Debiti e Doveri» (25/10).

## Da verificare

Dal telefono o con i dati veri (dettagli in docs/STORIA.md alla data):
- **Backup** (14/11): **prima Mattia** dà in console il ruolo di export ai due service account (docs/ARCHITETTURA.md,
  Backup, «Da fare una volta in console»: oggi il backup prende 403); poi Diagnosi con `backup` e `backupora`, un Ripristino
  di prova, il PITR attivo (Diagnosi), il primo backup del lunedì.
- **Più AI** (14/11): una domanda in Chiedi (tempi, fonti; `fallbacks` in beta); una nota con uno scontrino fotografato; un
  task che la nota dice fatto; un PDF collegato a un progetto; la trascrizione a pezzi su una lezione vera e con lo schermo
  bloccato; la prima revisione della domenica; condivisione e scorciatoie dopo l'aggiornamento del WebAPK.
- **Foto** (4/11): «Scatta» torna alla nota col testo già scritto; tempi con foto da 12 MP; foto senza rete.
- **Barra** (3/11): nome di un progetto in barra alla prima apertura su un telefono nuovo; scorrimento verso un progetto.
- **Notifiche** (25/10, 1/11): attivazione su entrambi i telefoni; `silent` di notte; il riepilogo delle 7:30; un evento
  aggiunto dall'altra persona da Google Calendar; promemoria saltati quando avvisa già Google. Mattia: schermata di
  consenso OAuth «In produzione» (in test il permesso scade ogni 7 giorni).
- **Google** (27/10, 1/11): ricollegamento con le tre spunte; lo scope di Drive accettato; PATCH tra evento con orario e di
  tutto il giorno; `move` tra la casa e il personale; inviti senza `organizer.self`.
- **Note vocali e modelli** (27/10): qualità rispetto all'app Claude; iPhone (`audio/mp4`); durata di Opus e sintesi
  migliore di Sonnet; nomi dei temi stabili tra le lezioni (26/10); nomi dettati male collegati al contatto giusto (29/10).
- **Banca** (23–25/10): `entry_reference`, descrizioni, MCC e conti esposti; addebito della carta tra gli scartati al primo
  estratto conto; il quarto rapporto senza IBAN; intestazioni PSU rispettate da Intesa; chi chiude la sessione
  (`sessionStatus`).
- **Prodotti** (27/10–1/11): copertura di OFF e OBF sui prodotti italiani; `categories_tags_it`; nessun 403/429 da OFF;
  risposte di `product_jqm2.pl` e `product_image_upload.pl`, categoria in italiano riconosciuta.

## Aperti

- Bozze confermate: finiscono in `notes`, che nessuna pagina mostra: una pagina, togliere la conferma o bozze vere in Gmail.
- Riga di contesto per pagina, stile Leghe Fantacalcio (Task «2 in ritardo · 3 oggi», Spese «Ottobre · X ti deve…»).
- Identità visiva definitiva (resto dell'app): da decidere con Mattia.
- Diario per progetto: importare lo storico delle lezioni dalle chat del progetto Claude; quante note precedenti servono;
  se la sintesi proposta rispetta le correzioni a mano. Da valutare: Fable 5.1 o Opus con `effort` alto per i progetti.
- Lista: ordine dei reparti da adattare al supermercato di Mattia; cronologia delle scansioni condivisa o solo sua.
- Note vocali: salvare e analizzare subito dopo la trascrizione, se Mattia lo vuole.
- Filtro del Diario per persona e ricerca nelle note (richiesta del 14/11, in corso).
- Prodotti, a mano: ingredienti e categoria della crema 100% nocciole Esselunga su OFF; il modulo d'uso dell'API di OFF.
- Banca: la compagna collega il suo conto con «Link accounts» nel Control Panel di Enable Banking (una sola app per la casa).
- Note condivise, casi scoperti (7/11): un progetto condiviso reso privato rende private le note dell'altra persona solo al
  suo prossimo allineamento; foto aggiunte da una versione vecchia a una nota già condivisa restano private.
- Account di accesso (Firebase Authentication) non coperti dal backup.
