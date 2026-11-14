# Storia dei lavori

Cronaca di cosa è stato fatto, scelto e scoperto in Debiti e Doveri, dalla più vecchia alla più recente. Fino al 14/11
stava nella sezione «Stato» di CLAUDE.md (spostata qui intera il 14/11, senza togliere nulla: le voci sono le stesse, con
le date e le spunte di allora, raggruppate per il giorno in cui il lavoro è cominciato; una voce racconta anche i seguiti
dei giorni dopo). In CLAUDE.md restano le decisioni in vigore, ciò che è da verificare e ciò che è aperto.

**Le cronache nuove si aggiungono in fondo**, sotto il giorno, con lo stesso stile: cosa ha chiesto Mattia (con le sue
parole quando servono), cosa si è fatto e perché, cosa resta da verificare.

## 22–23 ottobre: la base

- [x] Pubblicazione automatica, accesso Google (anche da app installata), service worker

- [x] Lista (stile Bring), Spese (stile Splitwise, ricorrenti, pareggio), Diario con agente, Task per
      progetti con persone, Manuale con rubrica e categorie della casa

- [x] Agente del diario funzionante (Sonnet, ~7 s): le proposte entrano nei moduli con la spunta

- [x] Fogli con la barra in basso, menu a sinistra, apertura sul Diario, scorciatoie Chiama/WhatsApp/
      Telegram sui task con una persona che ha il numero (`modiDiContatto`, `canaleDa` in rubrica.js)

- [x] Pagine pubbliche `/privacy` e `/termini` (richieste da Enable Banking)

## 23 ottobre

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
      Diario apre il Diario filtrato. Le note restano private anche in un progetto condiviso (fino al 7/11: ora sono della casa, vedi Stato).
      Prova con l'API vera: Diagnosi con `provaai` e `istruzioni` compilato.

- [ ] Diario per progetto, seguiti: importare lo storico delle lezioni dalle chat del progetto Claude
      (esportazione dei dati di claude.ai); valutare con le note vere quante precedenti servono
      e se la sintesi proposta rispetta le correzioni fatte a mano.

- [ ] Riga di contesto per pagina, stile Leghe Fantacalcio (Task «2 in ritardo · 3 oggi»,
      Spese «Ottobre · X ti deve…»)

- [ ] Identità visiva definitiva (resto dell'app): da decidere con Mattia

Bassa priorità (Mattia, 23/10: la revisione delle spese è meno rilevante), previste in
`docs/ARCHITETTURA.md`: regole di spesa apprese (`expense_rules`: c'è la regola Firestore, nessuno
le scrive né le applica in `syncBank`), bonifici tra i due membri riconosciuti come pareggi, divisione
a percentuale.

## 24 ottobre

- [x] **Dissolvenze come in Leghe** (24/10, dal video di Mattia: uscita ~150 ms sul fondo, entrata
      ~250 ms, indietro ~100 ms, schede in basso di fatto a taglio). Pagine: View Transitions nel
      router; fogli: animazioni CSS sul foglio, che resta attivo mentre compare; menu: velo in
      dissolvenza e cambio di pagina dopo il rientro del pannello. Le prove controllano i passaggi.

## 25 ottobre

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

## 26 ottobre

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
      **Rubriche e fonti** (29/10, dalle prime lezioni vere con Opus): nella sintesi le rubriche dentro un tema
      («Acquisito:», «In lavorazione:», «Chiave:») uscivano come voci rientrate e l'app le appiattiva in un solo
      elenco; ora `testoRicco` le mostra come etichette (h5) con l'elenco sotto, e il prompt chiede righe con i due
      punti senza rientri. Una lezione ricostruita a posteriori (dettata il 29/10, con la data del giorno) aveva nel
      riepilogo punti mai detti, presi dalla sintesi o dalle note precedenti: ora il riepilogo prende SOLO dal testo
      della nota (rianalizzata, Mattia la trova «molto buona»). Corretto anche un difetto vicino, che quella volta
      non c'entrava: le «precedenti» erano le ultime 8 per `createdAt`, comprese quelle successive alla data di una
      nota datata indietro, e il modello non sapeva la data della nota. Ora precedenti = solo quelle con data
      anteriore, la nota porta la sua data (`dataNota`), le successive si contano (con la sintesi) o si danno a parte
      (senza). Tempi veri di Opus su una lezione: 30–46 s.
      La sintesi si propone solo se il modello la cambia: rianalizzando una nota già entrata nella sintesi (proposta
      confermata), torna identica e prima non compariva nulla. Ora (scelta A di Mattia, 29/10: sintesi sempre
      automatica, niente pulsante «Aggiorna la sintesi») il server scrive `journal_entries.sintesiEsito`
      («proposta» | «invariata») e l'app mostra «Sintesi del progetto invariata» sotto la nota e nel foglio della
      lezione (`sintesiInvariata` in diario), più un avviso a fine analisi.
      Da valutare con Mattia: Fable 5.1 per le note dei progetti (10/50 $ per milione
      contro 4/20 di Opus; più lento: servirebbero streaming e un tempo massimo più lungo) o Opus con `effort` alto
      (oggi non è impostato: Opus 5.5 va a «medium»).
      **Storico della sintesi** (26/10, richiesta di Mattia): ogni cambio (spunta della proposta, modifica a mano,
      ripristino) mette la versione precedente in `projects.sintesiStorico` (ultime 10, `{ testo, at, origine }`),
      sempre via `salvaSintesi` in components/sintesi.js. «Versioni» nella vista Sintesi: si rileggono e si
      ripristinano (l'attuale finisce nello storico).

- [x] **Niente lampi di «vuoto»** (26/10, dal video di Mattia): cambiando filtro nel Diario compariva per
      ~100 ms «Nessuna nota in questo progetto» / «Il diario è vuoto», e lo stesso in Task e Spese all'apertura.
      Ora ascolti condivisi in db.js, `attesa` nelle pagine con più fonti, anteprima del filtro dalle ultime note.
      Corretto anche il foglio di Google Contatti, che aspetta la rubrica (senza, chi c'è già sembrava nuovo).

- [ ] Bozze confermate: finiscono in `notes`, che nessuna pagina mostra (si usano dalla proposta: Copia, Apri
      nella mail/WhatsApp). Decidere se serve una pagina o se togliere la conferma.

- [x] **Icona** (26/10, scelta di Mattia tra una trentina di varianti): due palline sovrapposte, giallo pallina
      (`--c-giallo`) a sinistra e verdolino (`--tessera-verde`) a destra, la parte in comune del colore del fondo
      (inchiostro #1F1F1C). Le due persone e ciò che condividono; il giallo richiama il tennis. Mattia usa le
      icone tonde: palline di raggio 16 su 64, dentro la zona sicura del ritaglio. Sorgenti `icons/icon.svg`
      (tonda, favicon e «any») e `icons/icon-maskable.svg` (fondo pieno: PNG maskable e `apple-touch-icon.png`).
      I PNG si rigenerano dagli SVG (Chromium, sfondo trasparente). Scartato lo sfondo carta: il giallo non si vedeva.
      Sui telefoni: Chrome rilegge il manifest all'avvio (al più una volta al giorno) e aggiorna l'app
      installata con nome e icona nuovi, senza reinstallarla; da Chrome 144 può chiedere conferma
      («Rivedi aggiornamento dell'app»). Il cambio di nome del 25/10 segue la stessa strada.
      Su Android Chrome chiede il nuovo WebAPK solo con tutte le finestre dell'app chiuse, telefono in carica e
      Wi-Fi (web.dev, «manifest-updates»). Da Chrome 144 un'icona conta come cambiata solo se cambia il campo
      `icons` del manifest: **cambiando il disegno, cambia anche il nome del file** (o un `?v=` nell'URL).
      28/10: due giorni dopo l'icona sul telefono di Mattia era ancora la vecchia; il manifest pubblicato era
      quello nuovo. Per forzare: in carica e in Wi-Fi, chiudere e «Arresto forzato» dell'app, `chrome://webapks`
      in Chrome → «Update» su D&D («Update Status» = Pending), aprire e richiudere l'app; se D&D non è
      nell'elenco, è un collegamento semplice e va reinstallata da Chrome.

## 27 ottobre

- [x] **Modelli AI** (27/10, scelta di Mattia): Sonnet per le note semplici, Opus per quelle dei progetti con
      istruzioni; si cambiano da menu → Modelli AI (anche Haiku). Il server legge `users.modelli` (chiavi non
      valide → predefinito); la nota segna `modello` e il Diario lo mostra accanto all'ora. Tutti e tre ragionano
      prima di rispondere e il ragionamento conta in `max_tokens`: tetti 8000 (semplici) e 32000 (progetti).
      Opus su una nota di progetto lunga può metterci minuti: function a 300 s, app a 310 s. Da verificare con le
      lezioni vere: durata di Opus e se la sintesi è davvero migliore di quella di Sonnet.
      Prova con l'API vera da terminale: `MODELLO=opus ISTRUZIONI=… node functions/strumenti/prova-agente.mjs "…"`.

- [x] **Google, collegamento unico** (27/10, scelta di Mattia: calendario condiviso «completamente» su Google
      Calendar e accesso completo in lettura al suo Drive). La function `contatti` è diventata `google`
      (deploy.yml la rende invocabile; `firebase deploy --force` toglie la vecchia); scope aggiunti
      `calendar.readonly` + `calendar.events` e `drive.readonly`, tre spunte facoltative nella pagina di Google
      (`users.google.permessi`). Chi aveva collegato solo i contatti (`users.contattiGoogle`) resta collegato
      con quel solo permesso finché non ricollega dalla pagina Google. L'URI di ritorno resta
      `/google-contatti`, così non c'è niente da aggiungere nel client OAuth. Gli scope sono «sensibili» (Calendar)
      e «ristretto» (Drive): in modalità di test il permesso scade dopo 7 giorni per entrambi.
      **Da verificare dal telefono**: il primo ricollegamento con le tre spunte; se la pagina di Google blocca
      lo scope di Drive («app non verificata» non basta), togliere `drive.readonly` da SCOPES in account.js e
      tenere i documenti come link.
      **Calendario** (27/10): menu → Google → Calendario → scelta tra i propri calendari (`households.calendario`);
      Mattia crea «Casa» su Google Calendar e lo condivide con la compagna (permesso di modificare), lei lo vede
      con il suo account una volta collegato Google. Pagina Calendario (menu → Casa): agenda dei prossimi 60
      giorni, + per un evento (scritto subito su Google), modifica ed eliminazione dal foglio; l'agente propone
      `event` dalle note con giorno, ora e luogo (conferma → evento nel calendario della casa; senza calendario
      scelto la conferma dice di sceglierlo e la proposta resta). Le prove fingono le API di Calendar e Drive
      con `pg.route`. Da verificare con l'API vera: che il PATCH con `date`/`dateTime` a `null` cambi davvero un
      evento da orario a giorno intero e viceversa; i colori del calendario non si usano.
      **Aspetto** (27/10, sera, scelte di Mattia tra schermate: B per il Diario, 1 per il Calendario): il Calendario
      nel menu era scomodo, quindi in cima al Diario «Prossimi giorni» con le righe del Calendario e il link alla
      pagina; il Calendario ha preso la grammatica delle lezioni del tennis (numero del giorno in Instrument Serif,
      giorno della settimana sotto, fascia per mese). La striscia non compare prima delle note (`dati.pronta()`) e
      all'apertura usa l'ultima lettura salvata sul telefono, così non spinge giù la pagina quando arriva Google.
      **Drive** (27/10): dal foglio del progetto e della voce del manuale, «Documenti da Drive» (ricerca per nome in
      tutto il Drive, anche condivisi; `documenti` [{ id, nome, mime, link }]); nella pagina del progetto in fondo alla
      Sintesi; per i progetti con istruzioni l'agente legge il testo (Docs/Sheets/Slides esportati, file di testo; PDF solo
      per nome; limiti in `functions/src/google/drive.js`) con il permesso dell'utente (`tokenServer`). Non c'è una ricerca
      libera dell'agente su tutto il Drive (troppo rumore per il prompt). Da valutare: lettura dei PDF (serve una libreria
      nelle functions), cache del testo per `modifiedTime`.

- [x] **Note vocali** (27/10, richiesta di Mattia: «lo stesso flusso della dettatura nell'app Claude»). Nel foglio
      della nota «Registra» in basso a sinistra: si parla quanto serve, «Ferma», la trascrizione si aggiunge al campo
      e si salva come sempre (poi l'agente). Trascrive Gemini (`gemini-3.8-flash`, generateContent con l'audio in
      linea) perché Claude non accetta audio, come nell'app Claude dove a Claude arriva il testo. Il prompt ha il
      vocabolario: nome, istruzioni e temi della sintesi del progetto scelto nel foglio, nomi della rubrica. Scartato
      `gemini-3.5-transcribe`: vocabolario solo come elenco di termini, audio da caricare con la Files API, costo
      ~2,5 volte. Costo stimato ~0,2 centesimi di dollaro al minuto (prezzi raddoppiati dal 2027); nel registro di
      `trascrivi` durata e token, mai il testo. Prova: Diagnosi con `provatrascrizione` (campione sintetico in functions/strumenti/campioni,
      con e senza contesto) o `node functions/strumenti/prova-trascrizione.mjs file.webm`.
      27/10, sera: la Diagnosi ha dato `API_KEY_INVALID` per GEMINI_API_KEY (chiave in Secret Manager non valida):
      Mattia ne crea una in AI Studio nel progetto macroapp-b9bd0 (che ha già la fatturazione per Firebase), nuova
      versione del segreto, poi deploy e Diagnosi con `provatrascrizione`.
      **Da verificare dal telefono**: qualità rispetto all'app Claude su una lezione vera; su iPhone (audio/mp4 →
      `audio/m4a`) se Gemini lo accetta; se lo schermo si spegne, che la registrazione non si interrompa (wake lock).
      Possibile seguito, se Mattia lo vuole: salvare e analizzare subito dopo la trascrizione, senza passare dal campo.

- [x] **Prodotti dal codice a barre** (27/10, richiesta di Mattia: «come Yuka, ma su dati aperti»). Open Food Facts
      via function `prodotto` (User-Agent, cache `prodotti/{ean}`), indice 0–100 nostro (docs/ARCHITETTURA.md,
      Prodotti: Nutri-Score 50, additivi 25 con rischio EFSA dalla tassonomia OFF, NOVA 15, bio 10; tetto 49 con un
      additivo a rischio alto; dal 29/10 il modello 2, sotto), scheda con «In lista come», «Preso»/«Da comprare», pallino sulla tessera.
      Scanner: `BarcodeDetector` (Chrome Android); su iPhone non c'è e si scrive il codice (eventuale libreria ZXing).
      **Non verificato con l'API vera**: la sessione non raggiungeva openfoodfacts.org (né i dump), quindi la prova
      è su schede costruite a mano nel formato dell'API e la copertura dei prodotti italiani è da misurare dal
      telefono: menu → Lista → + → Scansiona su una decina di prodotti della dispensa. Da controllare al primo uso: i nomi in
      `categories_tags_it` (sono il nome proposto per la tessera) e che la function non prenda 403/429 da OFF (il
      messaggio lo dice). L'API v2 riconverte i nutrienti nel formato `*_100g` anche col nuovo schema di OFF (API.pm).
      **Primo uso vero** (29/10, Mattia, cinque prodotti con OFF e Yuka): le schede arrivano. Corretti: la schermata ferma
      durante la ricerca (lo scanner chiudeva con un `history.back()` che chiudeva anche il foglio di attesa: ora lo
      sostituisce, e l'attesa ha l'anello, il codice, l'avviso dopo 6 s, «Riprova»); il tondo «Scansiona» sopra il + della
      Lista (richiesta di Mattia: un passaggio in meno); «Crema mani» proposta come simile a «Crema di nocciole»; «Rileggi».
      **Confronto con Yuka** in docs/ARCHITETTURA.md (Prodotti): le distanze grandi vengono dalla parte nutrizionale e dai
      dati OFF, non dai pesi. **Modello 2 dell'indice** (29/10, deciso da Mattia): additivi per rischio (−5 per non valutato,
      al più −20; tetti 50/20), NOVA 4 = 25, bio ignoto senza ingredienti. `VERSIONE_INDICE` (server e `components/prodotto.js`,
      da tenere uguali): le schede in cache si ricalcolano alla prossima lettura (`ricalcola`), le voci della Lista con un
      riassunto vecchio si rileggono all'apertura (`aggiornaRiassunti`). Da fare a mano su OFF: ingredienti e categoria
      della crema 100% nocciole Esselunga, poi «Rileggi».
      **Scheda come in Yuka** (31/10, richiesta di Mattia, docs/ARCHITETTURA.md, Prodotti): valori divisi in Positivo e
      Negativo con frase e pallino, poi additivi, trasformazione spiegata e Nutri-Score in fondo; bio solo come foglia verde
      accanto al nome. Schede v2 (`VERSIONE_SCHEDA` in off.js): nome di ripiego (breve, inglese, francese; in mancanza il
      titolo è la marca), `bevanda`, frutta e verdura stimata, `novaMarcatori`; le schede in cache più vecchie si rileggono
      da OFF alla prossima apertura. Secondo confronto con Yuka (Belle Buone sesamo e mais, 57 contro 30): la scheda OFF
      è senza ingredienti né nome, e il Nutri-Score 2023 dà D (11) dove il 2017 di Yuka dà C (7). Proposto un Nutri-Score
      continuo dentro la lettera: Mattia (31/10) «il Nutri-Score non mi interessa», quindi niente, e la sezione Nutri-Score
      è tolta dalla scheda (negli avvisi «valori nutrizionali»). Resta metà dell'indice: proposto di ricavare la parte
      nutrizionale dalle fasce di Positivo / Negativo, Mattia (31/10) ha scelto di tenere l'indice com'è («una media di
      tutto, un punteggio nostro»). Non riproporlo.
      **Cosmetici** (31/10 sera, richiesta di Mattia; docs/ARCHITETTURA.md, Prodotti): la scansione di un cosmetico arriva da
      Open Beauty Facts (rinvio di `product_type=all`) e `normalizzaCosmetico` legge la lista INCI. Voto come in Yuka, deciso
      dall'ingrediente peggiore, ma su liste pubbliche (`functions/src/prodotti/cosmetici.js`): alto = interferenti endocrini
      riconosciuti dall'ECHA (butylparaben, 4-MBC), vietati (Lilial, Lyral), benzophenone (CMR); moderato = gruppo A della lista
      della Commissione sui possibili interferenti endocrini nei cosmetici (2019); basso = gruppo B e allergeni delle fragranze
      del reg. UE 2023/1545. 100 − 30/15/4 per ingrediente, tetti 24 e 49. Il «parfum» non conta (non è in nessuna lista).
      Nomi INCI verificati sulla tassonomia CosIng di OBF (GitHub raw, raggiungibile dalla sessione; edlists.org ed EUR-Lex no).
      Un cosmetico entra in Lista nel reparto «Casa e persona». `VERSIONE_SCHEDA` 3: tutte le schede in cache si rileggono
      una volta. **Da verificare dal telefono**: copertura di OBF sui prodotti italiani e qualità delle liste INCI.
      **Completa su Open Food Facts** (1/11, richiesta di Mattia: «zero fatica o quasi»; account OFF creato da lui): dalla
      scheda mancante o senza nome/ingredienti/valori, tre foto → Claude (Sonnet, output strutturato con soli testi,
      `pulisciLettura` converte i numeri) legge → riepilogo dei soli campi mancanti → «Invia» → `product_jqm2.pl` (campi, mai
      sovrascritture; prodotto nuovo con `lang=it`; categoria come `add_categories=it:…`; valori per 100 g, anche per 100 ml)
      e `product_image_upload.pl` (`front_it`, `ingredients_it`, `nutrition_it`), con `app_name` DebitiEDoveri, `app_uuid`
      (sha256 dell'uid) e commento; poi rilettura e cache. Scelta: confermare prima di pubblicare (un errore di lettura
      finirebbe pubblico col nome di Mattia); account chiesto nell'app e non in Secret Manager, così ognuno usa il suo.
      Prova senza rete: `node functions/strumenti/prova-contributo.mjs`. **Non verificato con OFF vero** (la sessione non
      raggiunge openfoodfacts.org): da controllare al primo uso la risposta di `product_jqm2.pl` con l'account (status 1) e
      di `product_image_upload.pl`, che la categoria in italiano venga riconosciuta e che OFF calcoli subito il Nutri-Score.
      Da fare (Mattia o Claude): il modulo d'uso dell'API di OFF che le app che scrivono devono compilare.
      **Primo contributo vero** (1/11, Canestrellini): campi e foto arrivati su OFF (OFF ha calcolato subito il Nutri-Score), ma
      la rilettura ha dato la scheda di prima, finita in cache per un mese. Ora letture fresche dopo una scrittura e con
      «Rileggi» (`leggiOff(ean, { fresco })`), rilettura ripetuta fino a ~10 s su `last_modified_t`, altrimenti cache con
      `rileggere` (riletta a ogni apertura per un giorno) e scheda con `inAggiornamento` (docs/ARCHITETTURA.md, Prodotti).
      Riepilogo «Da aggiungere»: i valori erano in una griglia a due colonne con i «di cui» sfalsati, ora righe come l'etichetta.
      Poi (Mattia: «Rileggi in fondo è scomodo», deve comparire «pratico e visibile» dopo un contributo): «Rileggi» nella barra
      in basso del foglio (↻), e dopo un invio non ancora pubblicato la scheda si aggiorna da sola (`aspetta` in mostraScheda).

## 29 ottobre

- [x] **Diario come le lezioni, titolo e persone** (29/10, richiesta di Mattia dal telefono: una nota lunga occupava
      tutto lo schermo; Diario e lezioni del tennis «mi sembrano due strumenti diversi, quando invece sono lo stesso»; un'
      analisi senza azioni non lasciava traccia). Elenco del Diario con le righe delle lezioni (`rigaNota`), la nota si
      legge toccandola (`apriLettura`, anche dalla pagina del progetto); Rianalizza ed Elimina stanno nel foglio. Per ogni
      nota l'agente scrive titolo e persone nominate (rubrica, o contatti Google con una parola del nome nel testo, letti
      dal server con il permesso dell'utente: `functions/src/google/contatti.js`; all'AI vanno solo quei nomi). Titolo e
      persone si scrivono anche a mano (foglio della nota), e allora l'AI non li cambia. Prova senza Firestore:
      `CONTATTI="Nome Cognome, …" node functions/strumenti/prova-agente.mjs "…"` stampa titolo e persone.
      Da verificare con le note vere: che i nomi dettati male («Ani» per Anna) si colleghino al contatto giusto; costo dei
      token in più (titolo, persone, candidati: poche decine di token per nota).
      Mattia, 29/10 sera: per le note semplici bastano titolo e persone (niente revisione del testo né riepilogo, per ora).
      Possibile seguito: filtro del Diario per persona.

- [x] **Progetti per tutti e Lista più comoda** (29/10, sera, richieste di Mattia dal telefono, con tre progetti: LAMA,
      Leccio, Tennis). Pagina del progetto: «Sintesi · Note · Da fare» per ogni progetto («Lezioni» valeva solo per il
      tennis). Undici colori per i progetti (aggiunti ocra, rosso, viola, blu, terra, grigio; testo sulla tinta sopra 4,5:1).
      Nel Diario l'etichetta del progetto e i temi di una nota hanno il colore del suo progetto. Istruzioni del progetto
      dettabili («Registra» sotto il campo, come nella nota). Lista: la scheda di un prodotto si apriva solo da tre puntini
      di 24 px e dal foglio Modifica; scelta di tenere le tessere a 4 colonne (decisione del 25/10) e cambiare l'accesso: il
      pallino della fascia apre la scheda (angolo di 34 px), i tre puntini hanno anch'essi un angolo di 34 px, nel foglio
      Modifica il prodotto sta in cima. Se le tessere restano scomode, l'alternativa è tornare a 3 colonne.
      **Cronologia delle scansioni**: orologio in testata della Lista → pagina «Prodotti scansionati» (collezione `scansioni`,
      scritta dalla function `prodotto`; le scansioni di prima dalla cache `prodotti`, `lettoDa`). Condivisa nella casa,
      come la Lista: da chiedere a Mattia se la vuole solo sua.

## 1 novembre

- [x] **Altri calendari** (1/11, richiesta di Mattia: il personale, la band, l'associazione accanto a «Casa»). Scelta per
      persona (`users.calendari`), non per casa: l'app legge con l'account di chi guarda, quindi chi vede e chi modifica
      lo decide Google. Scelte di Mattia: il personale (il principale dell'account) si modifica dall'app, gli altri sono in
      sola lettura anche se Google lo permetterebbe; «Prossimi giorni» mostra tutti i calendari. Perché la compagna veda
      il personale di Mattia, lui glielo condivide da Google Calendar («Vedere tutti i dettagli degli eventi») e lei lo
      sceglie: per lei non è il principale, quindi lo legge soltanto. Scartato: leggere i calendari dell'uno per l'altra
      dal server (porterebbe gli eventi dove Google non li porta). Nessun permesso Google nuovo (bastano gli scope del 27/10).
      Le prove fingono quattro calendari, un invito e un concerto presente in due calendari.
      **Da verificare con l'API vera**: il `move` tra la casa e il personale; che gli inviti abbiano davvero
      `organizer.self` assente (se no risulterebbero modificabili).

- [x] **Notifiche, seconda tornata** (1/11, richiesta di Mattia: eventi, promemoria, «pensiamo a quali altre», scelte 1–5 tra
      quelle proposte). Dall'altra persona: spese modificate (cosa è cambiato, «45,00 € (era 40,00 €)») ed eliminate; eventi
      nuovi nel calendario della casa, anche aggiunti da Google Calendar (≤ 5 minuti). Per te: promemoria degli eventi con
      orario dei calendari che vedi, 15/30/60/120 minuti prima (predefinito 1 ora), saltati quando Google Calendar ti avvisa
      già; riepilogo del mattino alle 7:30 (eventi di oggi, task in scadenza o in ritardo, banca: prende il posto della
      notifica delle 7:15); fine analisi del diario se nel frattempo hai lasciato l'app (`avvisaAFine` sulla nota); consenso
      della banca in scadenza; «Google scollegato». Di notte (22:30–7:30) senza suono, si spegne dalla pagina. Funzione
      programmata `giroAvvisi` ogni 5 minuti (docs/ARCHITETTURA.md, Notifiche). Pagina Notifiche in due gruppi.
      **Da verificare dal telefono**: che Chrome rispetti `silent` di notte; il primo riepilogo vero (7:30); un evento
      aggiunto dall'altra persona da Google Calendar; che i promemoria saltino davvero gli eventi per cui Google avvisa.
      **Da controllare (Mattia)**: se la schermata di consenso OAuth è «In produzione» (Google Cloud → Google Auth Platform →
      Pubblico); in test il permesso scade ogni 7 giorni e con lui promemoria e riepilogo (arriva «Google scollegato»). La
      pagina Google dice da quando è collegato: oltre 7 giorni = in produzione.

## 2 novembre

- [x] **Evento dal Diario** (2/11, richiesta di Mattia dal telefono; scelte B + C tra tre schermate, scartata la A: «+ Evento»
      accanto a «Calendario» in cima, contro la regola dell'azione in basso a destra e assente quando la striscia non c'è).
      B: tondo col calendario sopra il + del Diario, come «Scansiona» nella Lista, apre il foglio dell'evento. C: «Evento» tra
      le trasformazioni del foglio della nota (la nota non si salva). Entrambi solo con un calendario in cui scrivere
      (`scriviEventi`). Il giorno non si ricava dal testo: per quello resta la proposta `event` dell'agente.

## 3 novembre

- [x] **Barra in basso per persona** (3/11, richiesta di Mattia: la compagna vuole il Calendario al posto del Diario,
      lui il Diario e il progetto Tennis; scelte: pagina nel menu a sinistra, progetti come sezioni, apertura sulla prima
      sezione). `users.barra`, al più 5 sezioni tra Diario, Lista, Spese, Task, Calendario, Manuale, In attesa e i progetti
      non archiviati; un progetto in barra ha la route `progetto-<id>` e il suo colore quando è aperto. Le prove coprono
      scelta, ordine, limite, apertura sulla prima sezione e il menu che porta alla sezione.
      **Da verificare dal telefono**: il nome del progetto in barra alla prima apertura (viene da localStorage: la prima
      volta su un telefono nuovo dice «Progetto» finché i progetti non arrivano) e lo scorrimento col dito verso un progetto.

## 4 novembre

- [x] **Foto nelle note** (4/11, richiesta di Mattia dal telefono: caricare foto nelle note e, aperta la nota, vederle). Nel
      foglio della nota «Scatta» (fotocamera del telefono) e «Galleria» (anche più d'una; aggiunto «Scatta» lo stesso giorno, Mattia:
      «fammi anche scattare la foto, non solo caricare») con la striscia delle miniature e la × per toglierle; nell'elenco la fotocamera col numero accanto all'ora (icona, non le immagini: l'elenco resta leggero);
      nel foglio di lettura la striscia delle miniature sotto le persone, il tocco apre la foto intera (fondo nero, si chiude
      al tocco; il tasto indietro chiude anche il foglio: i fogli non si impilano). Scelta tecnica: foto in Firestore
      (`journal_photos`, una per documento, JPEG ≤ 1600 px e ≤ 900 KB in base64 più miniatura; regole come le note) e non in
      Cloud Storage, per non aggiungere bucket, regole e passo di deploy; costa di più per GB ma a questi volumi non conta.
      Se le foto diventano tante (centinaia), passare a Storage con gli stessi campi. Le prove coprono scelta, elenco,
      lettura, visore e rimozione. **Da verificare dal telefono**: che «Scatta» apra la fotocamera e torni alla nota con
      il testo già scritto (se Android chiude Chrome mentre la fotocamera è aperta, si perde: allora fotocamera dentro l'app,
      come in contributo.js, ma in un velo sopra il foglio); i tempi con foto da 12 MP (ridotte sul telefono prima di salvare); con la
      cache offline di Firestore le foto si rileggono dal telefono senza rete.

## 5 novembre

- [x] **Giorno a sinistra nei task** (5/11, richiesta di Mattia dal telefono: «anche i task li voglio con i numeri delle date a sx
      come il diario»; le fasce restano). `rigaTask` ha la colonna del giorno delle lezioni (`.riga__giorno`, stessa grammatica
      di `.lezione__giorno`): numero del giorno, sotto «oggi», il giorno della settimana (Prossimi 7 giorni) o il mese (In ritardo,
      Più avanti, completati con la data del fatto); numero solo sulla prima riga dello stesso giorno, colonna vuota senza scadenza
      per tenere i testi allineati; in ritardo il numero è color `--frutto`, sulla pagina del progetto del colore del progetto.
      Tolti dal testo «era per il …», «domani», il giorno della settimana e «fatto il …»: li dicono colonna e fascia.
      Le prove coprono le cinque fasce e la riga senza numero (`4b-task-giorni`).

## 7 novembre

- [x] **Quattro richieste del 7/11** (dal telefono, con tre schermate):
      1. **Evento come in Google Calendar** («rendi l'inserimento degli eventi più simile a Google Calendar come struttura delle info»,
         con la schermata del foglio di Google): `apriEvento` rifatto in tre gruppi separati da filetti — titolo grande e calendari;
         «Tutto il giorno», inizio e fine (data a sinistra, ora a destra), ripetizione; luogo e descrizione. Il nuovo evento è con orario
         come in Google (prima era di tutto il giorno), e c'è la ripetizione (`RIPETIZIONI` → RRULE). Restano fuori, di proposito, il
         fuso (sempre Europe/Rome), gli invitati e le notifiche (quelle dell'app hanno il loro anticipo in Notifiche).
      2. **Note dei progetti condivisi condivise** («io non vedo quelle della mia compagna e lei non vede le mie»): `journal_entries` e
         `journal_photos` con la visibilità del progetto (`core/note.js`); regole: lettura come le altre collezioni della casa, modifica
         ed eliminazione solo di chi ha scritto. Nel Diario e nella pagina del progetto le note dell'altra persona col suo nome, in sola
         lettura (superato la sera stessa: Mattia le vuole modificabili da tutti e due, vedi sopra).
         Note già scritte: all'avvio ciascuno porta le sue (`allineaNote`, dai progetti letti dal server: una copia vecchia sul
         telefono rimetterebbe in comune note appena rese private); cambiando la visibilità di un progetto (solo chi l'ha creato) le
         proprie note la seguono. Le regole
         non lasciano cambiare `ownerUid` né `householdId` di una nota, e l'agente legge le note della casa solo se chi chiama ne è
         membro. L'agente, per una nota di un progetto condiviso, legge come precedenti anche quelle dell'altra persona (`di="Nome"`
         nella richiesta). Indici nuovi `householdId+visibility(+projectId)+createdAt`; finché si costruiscono, `seguiNote` ripiega
         sulle sole note proprie. Casi scoperti: un progetto condiviso reso privato non rende private subito le note dell'altra
         persona (lo fa il suo telefono al prossimo allineamento); le foto aggiunte da una versione vecchia dell'app a una nota già
         condivisa restano private.
      3. **Colori dei progetti sempre visibili** («anche quando sei nel diario, che caratterizzino sempre il progetto»): pillole dei
         progetti col pallino del colore e piene del colore quando scelte (`pillolaProgetto`: Diario, foglio della nota, Task); Diario
         filtrato col + e i giorni nel colore del progetto, come la pagina del progetto; su «Tutte» l'etichetta col pallino.
      4. **Barra in basso che scorreva nella Lista**: una tessera con la marca sotto il nome (nowrap) allargava la griglia dei recenti
         di ~12 px oltre lo schermo; il telefono allargava la pagina e la barra fissa si spostava col dito. `minmax(0, 1fr)` e
         `min-width: 0` sulle tessere, più `overflow-x: clip` su `#app` perché non ricapiti altrove.
      Le prove coprono il foglio dell'evento (struttura, durata che segue l'inizio, fine dopo mezzanotte e ritorno allo stesso giorno,
      tutto il giorno da un evento fino a mezzanotte, ripetizione), le note condivise (allineamento al cambio di visibilità nei due
      sensi e all'avvio, nota della compagna in sola lettura, nota nuova condivisa) e i colori. Una revisione separata del diff ha
      trovato i casi corretti sopra (copia vecchia dei progetti, fine rimasta al giorno dopo, `householdId` preso sulla parola).

- [x] **Seconda tornata del 7/11** (dal telefono, dopo la prima):
      1. **Note condivise modificabili da tutti e due** («le note condivise possono modificarle tutte, al massimo fammi vedere chi ha
         modificato per ultimo»): regole come le altre collezioni della casa (`modificaNota`: nessuno cambia proprietario né casa, la
         visibilità solo chi l'ha scritta; eliminazione con `canDelete`), `analyzeEntry` accetta una nota condivisa della propria casa.
         Il foglio di una nota dell'altra persona offre solo i progetti condivisi (niente «Nessuno»: resterebbe visibile solo a lei).
         Ogni modifica a mano firma la nota (`modificataDa`, `modificataAt`): in fondo al foglio di lettura, in piccolo e chiaro,
         «Ultima modifica: Giulia, oggi alle 18:40». Le azioni proposte tornano sotto tutte le note.
      2. **Progetto negli eventi**: riga col pallino del colore nel foglio dell'evento («Nessun progetto» o un progetto), salvato su
         Google in `extendedProperties.shared.ddProgetto`; nelle righe del Calendario e dei Prossimi giorni l'etichetta del progetto
         nel suo colore; il tondo del Diario filtrato e «Evento» dalla nota partono col progetto; gli eventi proposti da una nota di
         un progetto lo portano (`payload.projectId`).
      3. **Banca in Spese** («rendi più intuitive le azioni della banca da confermare… accanto a ricorrenti con un pallino»): vedi
         `modules/spese` nella mappa. La notifica delle spese lette apre `#/spese/banca`; la pagina Banca porta lì.
      4. **Azioni da confermare più chiare** («separare importo dalla descrizione, la data con l'impostazione classica sulla sx»):
         `renderAzione` rifatta come le righe delle altre sezioni (vedi la mappa), uguale sotto le note e in «Azioni da confermare».
      Le prove coprono la modifica della nota di Giulia (firma e riga in fondo, solo progetti condivisi), il progetto dell'evento
      (proprietà su Google, etichetta col colore), le tre scelte della banca in Spese (dividi, riga toccata con divisione cambiata,
      solo mia) col pallino che scende, e la riga d'azione (giorno a sinistra, titolo senza la scadenza, icona senza giorno).

- [x] **Analisi e telefono bloccato** (7/11, notte, Mattia: «spesso dice non analizzata dopo aver bloccato il telefono e rilancio
      l'analisi… poi l'analisi dopo un po' compare»). Causa: bloccando il telefono la richiesta ad `analyzeEntry` cadeva, l'app
      scriveva `analysisError` e mostrava «non analizzata» mentre il server finiva; rilanciandola ne partiva una seconda in
      parallelo. Ora lo stato sta sulla nota e lo scrive il server (`journal_entries.analisi`, docs/MODELLO-DATI.md): «Analizzo…»
      nella riga e nel foglio (pulsante spento) finché il server non ha finito, su tutti e due i telefoni; una seconda richiesta
      mentre una è in corso non riparte (`giaInCorso`); una risposta persa (codici di collegamento senza messaggio del server) non
      è un errore, l'app dice che l'analisi continua; un «in corso» oltre 330 s (funzione interrotta) torna «non analizzata» e si
      rilancia (`analisiInCorso`, `scadenzaAnalisi` in diario). Il Firebase finto fa come il server (`finto.analisi.persa`,
      `finto.analisi.ritardo`); la prova copre risposta persa, pulsante spento, esito che arriva da solo e analisi morta.

- [x] **Diagnosi delle note, primo uso** (7/11 sera; stava nella sezione Diagnosi di CLAUDE.md fino al 14/11): la nota della
      compagna nel progetto condiviso, scritta prima dell'aggiornamento, era ancora privata (il suo telefono non aveva ancora
      aperto la versione nuova); allineata dal server con il consenso di Mattia (Diagnosi con `note` e `allinea`).

## 14 novembre

- [x] **Più AI e trascrizione a pezzi** (14/11, dopo un'analisi dell'app chiesta da Mattia; scelte sue: tutte le proposte tranne
      la banca che impara, che gli interessa meno; Gmail da spiegare meglio; più la trascrizione: «non vedo quello che sto
      trascrivendo via via» e «se blocco lo schermo la trascrizione non registra quello che ho detto»). Pubblicato il 14/11:
      1. **Trascrizione a pezzi** (`components/registratore.js`, `trascrivi` con `prima`): il testo arriva nel campo a ogni pausa
         mentre parli; audio e testo restano sul telefono (IndexedDB) finché la nota non è salvata; un pezzo che non arriva si
         riprova da solo; app o foglio chiusi → «Nota vocale da salvare» in cima al Diario. Causa probabile del problema: prima
         l'audio stava solo in memoria e andava a Gemini tutto insieme a Ferma: se la richiesta cadeva (telefono bloccato durante
         «Trascrivo…») o la pagina si chiudeva, si perdeva tutto; chiudendo il foglio la registrazione si buttava.
      2. **L'agente vede foto e PDF** (immagini della nota a Claude; PDF di Drive trascritti da Haiku in `drive_testi`) e **sa cosa
         c'è già** (task aperti con un codice, lista, eventi dei prossimi 21 giorni): niente doppioni, e proposte nuove
         `task_done` / `task_due`. Nota di sole foto ammessa.
      3. **Costi**: ogni chiamata a Claude e a Gemini scrive token e costo stimato in `consumi`; in fondo alla pagina Modelli AI il
         mese di Claude rispetto ai 100 $ del piano, per voce. Nuovo modello «Domande» (Sonnet) per Chiedi e la revisione.
      4. **Chiedi** (`modules/chiedi`, function `chiedi`): domande sui propri dati con strumenti di sola lettura e fonti toccabili.
      5. **Revisione della settimana** (domenica 18:47, categoria «settimana» nelle Notifiche, si apre in Chiedi).
      6. **Condivisione di immagini verso l'app** (share target in POST, `sw.js`) e **scorciatoie dell'icona** (Nota vocale, Lista,
         Scansiona, Chiedi).
      Le prove coprono: pezzi che arrivano mentre registri, risposta persa e riprovata, a capo dopo una pausa lunga, foglio chiuso
      e app ricaricata durante la registrazione (riga in cima, ripresa, salvataggio, archivio vuoto), Chiedi (ricerca visibile,
      risposta con fonti, seguito con risposta persa, fonte → nota, pagina), consumi nella pagina Modelli AI, scorciatoie, foto
      condivisa; `prova-chiedi.mjs` il motore sul server (privacy compresa). Non provato con le API vere (la sessione non ha le
      chiavi): **da verificare dopo il deploy** — una domanda in Chiedi (tempi, qualità delle fonti; il ripiego `fallbacks` è in
      beta e si toglie da solo se l'API lo rifiuta), una nota con uno scontrino fotografato, un task che la nota dice fatto, un PDF
      collegato a un progetto, la trascrizione a pezzi su una lezione vera (qualità ai confini dei pezzi) e **con lo schermo
      bloccato** (se Android ferma il microfono, l'app ora lo dice al ritorno: quanto manca), la prima revisione della domenica.
      Condivisione e scorciatoie arrivano quando Chrome aggiorna il WebAPK (vedi Icona: in carica, Wi-Fi, app chiusa).
      Gmail: proposto di trasformare le bozze dell'agente (oggi in `notes`, che nessuna pagina mostra) in bozze vere di Gmail e, più
      avanti, leggere bollette e ordini. Mattia (14/11): **niente lettura delle mail**, non riproporla. Le bozze in Gmail restano
      una possibilità non decisa (servirebbe il permesso Gmail e un nuovo collegamento a Google).

- [x] **Aggiornamento più agile** (14/11, Mattia: «non c'è modo di avere una modalità più agile di aggiornamento?»). Le pagine
      arrivano già alla riapertura dell'app, ma un'app rimasta aperta in background restava sulla versione vecchia (il service
      worker, che ricaricava, cambia di rado). Ora a ogni ritorno nell'app (al più ogni 10 s) si rilegge `version.js`, che il
      deploy riscrive col commit: se è cambiata la pagina si ricarica da sola; con un foglio o il menu aperti lo chiede soltanto.
      Resta fuori ciò che sta nell'«involucro» installato da Chrome (nome, icona, condivisione, scorciatoie dell'icona): lo
      aggiorna Chrome quando vuole; si forza con `chrome://webapks` → Update o reinstallando l'app (i dati sono sul server).

- [x] **Prove prima della pubblicazione** (14/11, richiesta di Mattia). Il deploy aspetta il job `prove` (`prove.yml`, chiamato
      da deploy.yml): le cinque prove delle functions, le regole di Firestore sull'emulatore (`prove/regole`, nuove: 34 casi —
      case separate, documenti privati, note e foto condivise modificabili da tutti e due senza cambiare `ownerUid`,
      `householdId` né, se non chi l'ha scritta, la visibilità; `off_account`, `consumi`, `domande` e le altre collezioni del
      server) e il flusso dell'app in Chromium, che ora esce con 1 quando si ferma. Se fallisce, le schermate sono nell'artifact
      «schermate» dell'esecuzione (7 giorni). Emergenza: Actions → Deploy Firebase → Run workflow con «Emergenza: pubblica
      senza prove». Un'esecuzione alla volta: un commit vecchio non si pubblica dopo uno nuovo. Il deploy ora dura ~8 minuti
      in più.

- [x] **Backup** (14/11, richiesta di Mattia): `backupSettimanale` ogni lunedì alle 3:17 esporta tutte le collezioni (nominate,
      fotografia coerente di un minuto prima) in `gs://macroapp-b9bd0-backup/AAAA-MM-GG-HHMM`; il deploy crea bucket (zona del
      database, niente accesso pubblico), regola dei 56 giorni e permessi, o lascia un avviso col passo da fare in console.
      Ripristino: flusso Ripristino (prova su un database temporaneo con i conteggi, o sui dati veri dopo aver salvato lo stato
      attuale; tutte o alcune collezioni; anche «com'era alle 21:00»). Diagnosi con `backup` (ultimo riuscito, oltre 8 giorni
      è un errore) e `backupora`. PITR valutato e non attivato (docs/ARCHITETTURA.md, Backup): decide Mattia.

- [x] **CLAUDE.md ristrutturata** (14/11, richiesta di Mattia: pesava 84 KB, per tre quarti storia dei lavori). La sezione
      «Stato» è passata intera qui, in ordine cronologico; la mappa dettagliata di `public/js` è in docs/MAPPA.md, con le righe
      dei file che mancavano (manuale, proposte, impostazioni, onboarding, auth, firebase, theme, sw.js); in CLAUDE.md una
      mappa breve e tre sezioni nuove: «Decisioni in vigore», «Da verificare», «Aperti». Nuova regola 7: le cronache si
      scrivono qui. CLAUDE.md è passata a ~22 KB.

- [x] **Backup, primo giro** (14/11, dopo il deploy del backup). Il deploy ha creato `gs://macroapp-b9bd0-backup` in
      europe-west1 (stessa zona del database) con la regola dei 56 giorni e i permessi sul bucket; non ha potuto dare
      `roles/datastore.importExportAdmin` sul progetto (`github-deploy` non può cambiare l'IAM del progetto: avviso nel deploy,
      come previsto). La Diagnosi con `backupora` ha lanciato la funzione: «backup non avviato (HTTP 403): The caller does not
      have permission», cioè la catena Scheduler → funzione → errore nella Diagnosi funziona e manca solo il ruolo, da dare in
      console (docs/ARCHITETTURA.md, Backup). La Diagnosi ora si ferma appena la funzione scrive un errore, invece di aspettare
      9 minuti, e dice il passo da fare. Mattia ha scelto di attivare anche il PITR (7 giorni, pochi centesimi al mese): lo fa
      il deploy.

- [x] **Chiedi che agisce** (14/11, richiesta di Mattia: oggi Chiedi aveva solo strumenti di sola lettura). Nuovo strumento
      `proponi` in `functions/src/chiedi.js`: Claude propone un'azione per volta (task nuovo, task fatto, scadenza nuova,
      lista, spesa, voce del manuale, evento nuovo, modifica o spostamento di un evento che c'è). Il server controlla tutto
      prima di tenerla e rimanda l'errore al modello: task ed eventi da cambiare solo tra quelli che gli strumenti hanno
      appena mostrato (dal codice, tradotto in id dal server), eventi solo nei calendari in cui l'app scrive e non inviti,
      progetti solo tra quelli visibili, lista/spesa/evento solo con una casa; al più 8, senza doppioni. Le proposte vanno in
      `proposals` con `source: "chiedi"`, `domandaId`, `turno`, sempre private come la domanda (la cosa creata ha la sua
      visibilità in `payload.visibilita`). Nell'app compaiono sotto la risposta del loro turno con `renderAzione` («Da
      confermare») e si applicano con `APPLICA`, come quelle del Diario; nuovo tipo `event_update`, applicato rileggendo
      l'evento da Google e tenendo la durata (`leggiEvento` + `aggiornaEvento`). La revisione della settimana resta senza
      azioni. Il prompt dice di proporre solo ciò che è chiesto e di non dire mai «fatto». Prove: `prova-chiedi.mjs` (task e
      eventi visibili e modificabili, codici inventati, calendario in sola lettura, invito, senza casa, limite, doppioni,
      giro con un Claude finto che propone anche una cosa sbagliata, revisione senza strumento, proposte scritte private col
      turno e quelle in attesa di un turno rifatto sostituite) e `prova.py` (passo «chiedi che agisce»: due azioni sotto la
      risposta, «2 azioni da confermare» nella pagina, conferma del task che compare nei Task, conferma dello spostamento
      della cena con le sue due ore su Google Calendar finto, luogo e descrizione intatti). Trovato per strada: aprendo una
      persona già in rubrica senza Google collegato il foglio mostrava «null» (`replaceChildren(null)`), corretto.

- [x] **Ricerca nel Diario e note di una persona** (14/11, richiesta di Mattia; scelte sue tra tre schermate: A, lente in
      testata, scartati B campo fisso in cima e C pillola «Cerca» tra i filtri; il tocco sulla persona nel foglio di lettura
      filtra il Diario invece di aprire la rubrica). La lente accanto al «?» apre il campo in cima con la tastiera (stato e
      prossimi giorni spariscono, × torna com'era); ricerca locale e istantanea, senza AI e senza accenti né maiuscole, su
      titolo, testo, riepilogo, persone e temi di tutte le note che vedi (non solo le ultime 100), combinabile con la pillola
      del progetto; righe del Diario con le parole evidenziate e, se la parola è avanti nel testo, l'estratto intorno.
      Persona: pillola col nome prima di quelle dei progetti (× per toglierla), sotto «N note con … · scheda in rubrica»;
      ci si arriva toccando la persona nel foglio di lettura (anche dalla pagina del progetto) o da «Note con …» in cima alla
      sua voce in rubrica, con quante note e l'ultima. Una nota è «di» una persona se è tra le sue persone (stessa voce,
      stesso contatto Google o stesso nome) o se nome e cognome sono nel testo (un nome solo no: «Bruno del bar»).
      Regola del vuoto: finché tutte le note non sono arrivate si filtrano quelle in memoria e il conteggio non compare;
      «Nessuna nota per «…»» è una riga, non la pagina vuota. Prova: passo «ricerca nel diario» e «note di una persona» in
      prova.py (nota d'agosto oltre le ultime 100, accenti e maiuscole, estratto, progetto, nessun risultato, persona dal
      foglio di lettura, scheda in rubrica col conteggio, «Note con …» da un'altra pagina).

