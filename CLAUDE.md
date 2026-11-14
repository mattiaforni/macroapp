# Debiti e Doveri (D&D) — istruzioni per Claude

App personale e di coppia di Mattia (PWA), nome «Debiti e Doveri», breve «D&D» (repository e
chiavi interne restano `macroapp`): lista della spesa, spese condivise, diario con agente,
task per progetti, manuale di casa, calendario della casa e calendari di ciascuno (su Google Calendar). Due utenti (Mattia e la compagna) in una "casa".
Interfaccia, codice e commenti in italiano. Mattia chiede modifiche spesso dal telefono:
il lavoro tipico è «cambia questo» → commit su `main` → pubblicazione automatica.

## Architettura

- **Frontend** in `public/`: HTML, CSS e moduli JavaScript ES, nessuna compilazione.
  SDK Firebase dal CDN gstatic a versione fissata (11.3.0).
- **Dati** su Firestore, progetto `macroapp-b9bd0`. Ogni documento di contenuto ha
  `ownerUid`, `householdId`, `visibility` (`shared` | `private`): vedi `docs/MODELLO-DATI.md`.
- **Functions** in `functions/` (Node 24, europe-west1): `trascrivi` (nota vocale → testo con Gemini Flash e il
  vocabolario del progetto, `src/trascrizione.js`; dal 14/11 a pezzi con `prima`, la fine del testo già trascritto; l'audio non si salva), `analyzeEntry` (agente del diario,
  provider AI intercambiabile in `src/ai/`; legge i documenti di Drive del progetto, anche i PDF, `src/google/drive.js`, le foto della nota e ciò che c'è già: task aperti, lista, eventi, `esistenti` in `src/agent.js`; modello scelto dall'utente, `modelloPer`, 300 s; costi in `consumi`, `src/consumi.js`), `bank` (onCall con `azione`: elenco banche, avvio e
  conclusione del consenso, scollega, lettura a richiesta; `src/banking/enable.js`), `google` (account
  Google: collegamento una tantum con le spunte Contatti, Calendario e Drive, permessi di un'ora, `src/google/account.js`), `avvisa` (notifiche push,
  `src/avvisi.js`), `prodotto` (scheda di un prodotto da Open Food Facts con l'indice, cache in `prodotti/{ean}`;
  `src/prodotti/`, i cosmetici da Open Beauty Facts con `cosmetici.js`; con `scansione: true` anche la cronologia `scansioni`), `chiedi` (14/11: domande sui propri dati, Claude con strumenti di sola lettura, `src/chiedi.js`; stato e risposta su `domande/{id}`), `revisioneSettimana` (domenica 18:47, `src/settimana.js`), `contribuisci` (1/11: «Completa» su Open Food Facts / Open Beauty Facts: `leggi` le foto con Claude, `invia` i soli campi mancanti e le foto con l'account OFF dell'utente in `off_account/{uid}`, solo server; `src/prodotti/contributo.js`), `syncBank` (lettura quotidiana alle 7:15, poi le notifiche della banca a chi non riceve il riepilogo), `giroAvvisi` (ogni 5 minuti: eventi nuovi nel calendario della casa, promemoria degli eventi, riepilogo del mattino alle 7:30; `src/avvisi-calendario.js`). firebase-admin, agente e banca si importano dentro i gestori, non all'avvio.
- **Pubblicazione**: push su `main` → `.github/workflows/deploy.yml` pubblica hosting,
  regole, indici e functions (secret `FIREBASE_SERVICE_ACCOUNT`). Si può rilanciare a mano.
- **Segreti** in Secret Manager (ANTHROPIC_API_KEY, GEMINI_API_KEY, ENABLE_BANKING_*):
  li gestisce Mattia dalla console; dopo un aggiornamento serve un nuovo deploy.
  ANTHROPIC_API_KEY (dal 27/10) è una chiave dell'organizzazione Console dell'account col piano Max, collegata
  ai crediti API inclusi nel piano (100 $ al mese, scadono a fine mese, nessun metodo di pagamento): non
  proporre di comprare crediti. Claude non accetta audio: le note vocali le trascrive Gemini con GEMINI_API_KEY
  (function `trascrivi`, scelta di Mattia del 27/10: pochi centesimi al mese sul livello a pagamento di Google,
  dove l'audio non è usato per migliorare i prodotti; sul livello gratuito sì).
  GOOGLE_OAUTH_CLIENT invece lo scrive il deploy, copiando ID e secret del client web dalla
  configurazione di Firebase Authentication (stesso client dell'accesso con Google).

## Mappa (public/js)

| file | cosa fa |
|---|---|
| `app.js` | guscio: accesso, barra in basso (le sezioni scelte dalla persona, `core/barra.js`; `idsBarra` aggiornato sul posto, route dei progetti `progetto-<id>` registrate quando compaiono, apertura sulla prima sezione), pulsante del menu, router, service worker (14/11: tornando nell'app si rilegge `version.js`; se è uscita una versione nuova si ricarica da sola, o con un foglio o il menu aperti mostra «C'è una versione nuova · Ricarica»), ricorrenti all'avvio; in testata a destra le `azioni()` del modulo aperto (oggi solo l'orologio della Lista) |
| `core/barra.js` | barra in basso personalizzabile (3/11): `users.barra` = id delle sezioni (pagine di `PAGINE` o `progetto-<id>`), al più `MASSIMO` (5), per persona; `scelte()`, `sezione(id)` → { id, title, icon, colore, modulo, mount } (un progetto monta la pagina Progetto dopo aver scritto `macroapp.progetto`), `sezioneAttiva(route)` (la pagina Progetto aperta dal menu conta come la sua sezione se è in barra), `progettiDisponibili`, `salvaBarra`, `suBarra`; nomi e colori dei progetti in barra copiati in localStorage per disegnarla subito; `apriPaginaProgetto(pid)` (menu, Diario, Task): la sezione se è in barra, se no la pagina Progetto |
| `core/router.js` | router a hash (`fallback` può essere una funzione: la prima sezione della barra); `vaiA(id, apri)` + `richiesto(id, apri)` (o `richiestaPer(id)`: cosa è stato chiesto, es. `nota:<id>` per il Diario); `sostituisci(id, smonta, figli)` adotta una pagina già montata (scorrimento): il menu chiede a una pagina di aprire un suo foglio. Passaggi tra le pagine con View Transitions (`<html data-passaggio>` = `entra` / `torna`): vaiA entra sempre, il resto lo decide `transizione(da, a)` in app.js |
| `core/scorrimento.js` | scorrimento tra le sezioni della barra come in Leghe (30/10, dal video di Mattia): la pagina segue il dito e quella accanto (montata davvero, in un pannello fisso `.scorro` a lato, senza il suo +) entra con lei; al rilascio si assesta (`--t-scorro`, oltre un quinto dello schermo o con un colpo deciso: velocità sugli ultimi 100 ms), poi la pagina nuova passa nella vista così com'è (`sostituisci` nel router: niente rimontaggio; il 30/10 rimontare dava scatti). Solo sulle sezioni, con foglio e menu chiusi, non dai bordi (gesto «indietro» del telefono) né da pillole che scorrono in orizzontale; con «riduci movimento» cambio secco. Attivato in app.js |
| `core/ui.js` | `el()`, icone disegnate a mano (`D`), date, importi, `colonnaGiorno(d)` (7/11: il giorno a sinistra come nel Diario e nei Task, oggi/ieri/domani, settimana o mese; azioni da confermare e «Dalla banca»), pillole, `pillolaProgetto` (7/11: pallino del colore del progetto, scelta piena del colore; Diario, foglio della nota, Task), `sceltaColore` (cerchietti dei colori dei progetti, `COLORI`: undici dal 29/10, variabili `--c-<nome>*` in base.css, chiaro e notte); `fabDoppio()` (seconda azione sopra il +: `<html data-fab-doppio>` contato, perché scorrendo Diario e Lista sono montate insieme; ritorna chi lo lascia); `attesa(fonti, render)`: prima comparsa di una pagina quando sono arrivate tutte le sue fonti (max 400 ms), e «vuoto» solo per una fonte arrivata; `puntoToccato(e, sorgente, da)`: dove cade un tocco su un testo mostrato, nella sua sorgente (anche dopo `testoRicco`) |
| `core/db.js` | `create` (non aspetta il server, ritorna `{id, saved}`), `update`, `watchVisible` (con `onErrore` facoltativo: query non passata, es. indice in costruzione), `readVisible`, `leggiDove` (lettura una tantum con soli vincoli, per la cache `prodotti`), `leggiUno` / `seguiUno` (un documento, una volta o in tempo reale); dopo le scritture condivise di spese, task e lista chiama `segnala` (notifiche). Ascolti condivisi: la stessa query è un solo `onSnapshot`, che resta aperto 10 minuti dopo l'uscita dalla pagina; i dati già noti arrivano subito (microtask), quindi una pagina rimontata o un filtro già usato si disegnano pieni al primo fotogramma. `chiudiAscolti` all'uscita dall'account |
| `core/note.js` | chi vede le note (7/11): `visibilitaNota(projectId, progetti)` (condivisa se il progetto è condiviso), `notaMia`, `seguiNote` (ascolto delle note che vedi, `watchVisible` con ripiego su `watchMine` se la query non passa), `allineaProgetto(pid, vis)` (le proprie note e foto di un progetto alla sua visibilità: dal foglio del progetto quando cambia), `allineaNote` (all'avvio, in app.js, al più ogni 6 ore per telefono: progetti condivisi letti dal server con `leggiDalServer`, le proprie note private di quei progetti diventano condivise e le proprie condivise fuori da quei progetti tornano private) |
| `core/modelli.js` | modelli dell'AI per l'analisi (`users.modelli` = { note, progetti, domande }, chiavi haiku/sonnet/opus, predefiniti Sonnet, Opus e Sonnet), `nomeModello`; consumi del mese (14/11): `leggiConsumi` (`consumi/{uid}_{AAAAMM}`), `dollari`, `CREDITI_MESE` (100 $), mostrati in fondo alla pagina Modelli AI |
| `core/notifiche.js` | notifiche push: `attiva`/`disattiva` su questo telefono (token in `users.dispositivi`), `GRUPPI` di categorie («Dall'altra persona», «Per te»; `users.notifiche`, anche `anticipo` dei promemoria e `silenzio` di notte), `prova`, `segnala(coll, id, evento, { prima | copia })` → funzione `avvisa`; il disegno e il tocco della notifica stanno in `sw.js` (`silent` di notte) |
| `core/household.js` | casa, nomi dei membri (`memberNames`), `nomeDi`, `updateHousehold` (es. categorie del manuale) |
| `core/rubrica.js` | voci del manuale in memoria, aggiornate in tempo reale: `trovaPersona`, `risolviPersone` (crea quelle che mancano, collegate a Google se il nome è univoco), `nomiTask`, `sincronizzaDaGoogle` (all'avvio) |
| `core/google.js` | account Google: `statoGoogle` (`users.google`: collegato, email, `permessi` {contatti, calendario, drive}), collegamento una tantum (ritorno su `/google-contatti`, poi pagina Google), permesso di un'ora dal server in localStorage, `chiamaGoogle(url, { method, query, body })` con rinnovo su 401, `messaggioGoogle` |
| `core/contatti-google.js` | Google Contatti: elenco in memoria per `cercaContatti` / `contattoUnico`; `contattiCollegati` = Google collegato con la spunta dei contatti |
| `core/calendario.js` | calendario «Casa» (`households.calendario`) e gli altri calendari di ciascuno (`users.calendari`: `altriCalendari`, `scegliAltri`; `modificabile` = il principale dell'account); `calendariVisti` (casa + altri, `calendariNoti` senza aspettare), `suCalendari`; `scriviEventi()` (Google col calendario e un calendario modificabile: tondo e «Evento» del Diario); `elencoCalendari` (il principale si chiama «Personale»), `scegliCalendario`, `leggiEventi` (tutti i calendari insieme, prossimi 60 giorni, `finestra()`, condivisa da Calendario e Diario; uno che non risponde non ferma gli altri, `erroriLettura`; doppioni per `iCalUID` + inizio, vince la copia `originale`; in memoria e, come anteprima per l'apertura, in localStorage `macroapp.calendario.eventi`; `suEventi`, `eventiNoti`), `creaEvento(d, calId)` / `aggiornaEvento(ev, d, calId)` (con un altro calendario prima `move`) / `eliminaEvento(ev)` direttamente sull'API di Calendar, solo nei calendari modificabili; `RIPETIZIONI` (7/11: giorno, settimana, mese, anno, feriali → RRULE in `recurrence`; dopo un evento che si ripete si rilegge); una ricorrenza letta ha `serie` (`recurringEventId`); `giornoMostrato`. Niente copia su Firestore |
| `core/drive.js` | ricerca per nome in tutto il Drive (`cercaDrive`, `recentiDrive`), `tipoDocumento`, `documentoDa` |
| `components/sheet.js` | foglio a tutta altezza: in alto indietro e titolo; in basso barra con le azioni secondarie a sinistra (anche un `div.foglio__piede` nel corpo finisce lì) e il pulsante principale a destra (`confirmLabel`, «Salva»), sopra la tastiera; il tasto indietro lo chiude. Classi di movimento `foglio--entra` / `--sostituisce` / `--chiude`; `close({ subito: true })` senza dissolvenza; `stessoFoglio: true` sostituisce senza dissolvenza (attesa → dati); `aperto()` dice se non è stato chiuso o sostituito. I campi su più righe sono alti quanto il testo (`field-sizing: content`, a mano dove manca): si scorre il foglio, mai il campo; il campo `autofocus` prende il fuoco solo se è vuoto (l'attributo si toglie prima dell'inserimento, se no Chrome lo mette da solo); `scriviDa(campo, pos)` mette il cursore lì con la tastiera e scorre il foglio perché la riga stia nel quarto alto (da chiamare dentro il tocco, subito dopo openSheet) |
| `components/menu.js` | menu a sinistra a gruppi (Progetti — quelli con istruzioni, letti all'apertura —, Casa, Collegamenti, Account), come in Leghe Fantacalcio |
| `components/proposals.js` | azioni proposte: `APPLICA` per tipo (l'evento con `payload.projectId` va nel progetto), `renderAzione` (7/11: come le righe delle altre sezioni — `colonnaGiorno` a sinistra con `giornoDi`, o l'icona del tipo; tipo in piccolo, `titoloDi` senza importo né data, dettagli sotto, importo della spesa a destra, poi conferma e scarta; la sintesi proposta si legge ripiegata), `segnaAccettata` (applicata altrove: la spesa della banca dal suo foglio); dal 14/11 `task_done` e `task_due` (un task aperto fatto o con una scadenza nuova, riga col giorno nuovo e «era per il …») |
| `components/sintesi.js` | sintesi di un progetto (`projects.sintesi`): `sezioniSintesi` (una sezione «## » per tema, prima riga «Stato: …» facoltativa), `tonoStato`, foglio per correggerla |
| `components/prodotto.js` | codice a barre: `scansiona()` (fotocamera con `BarcodeDetector`, altrimenti il codice scritto; con un codice il foglio **resta aperto** e lo sostituisce `apriProdotto`: chiuderlo faceva un `history.back()` che chiudeva anche l'attesa), `apriProdotto(ean, { inLista, aggiorna })` (foglio di attesa con l'anello e il codice, dopo 6 s «ci mette più del solito»; indietro annulla; errore nello stesso foglio con «Riprova»; poi la scheda da Open Food Facts via function `prodotto`, **come in Yuka** (31/10): indice, nome con la foglia se bio, Positivo / Negativo (righe dei valori con frase, pallino a quattro livelli `liv--1..4` e scala al tocco; soglie `NEGATIVI` / `POSITIVI` dichiarate nel file), Tutti i valori, Additivi, Trasformazione (NOVA spiegato, `novaMarcatori`), «Rileggi» che salta la cache (dall'1/11 nella barra in basso, icona ↻ accanto a «Da comprare»; prima era un link in fondo alla scheda); il Nutri-Score non si mostra (31/10, Mattia: «non mi interessa»); per un cosmetico (`tipo` «beauty», 31/10) `corpoCosmetico`: Da sapere (ingredienti segnalati col pallino e il motivo), Ingredienti (lista INCI), nota sui limiti delle liste, fonte Open Beauty Facts; con `inLista` il campo «In lista come» con le voci simili (`simile`: tutte le parole della più corta nella più lunga), «Preso» a destra e «Da comprare» a sinistra), `pallinoIndice`, `riassunto` (con `v` = modello dell'indice), `aggiornaRiassunti`, `VERSIONE_INDICE` |
| `components/contributo.js` | «Completa» (1/11): `completaScheda(s, { mostra })` → foto con la fotocamera dentro l'app (fronte, ingredienti, valori; «Scatta» in basso a destra, «Salta» a sinistra; ImageCapture se c'è, lato lungo 2000 px; senza fotocamera il file del telefono) → «Leggo le etichette…» (`contribuisci leggi`) → «Da aggiungere»: solo i campi che su OFF mancano, correggibili (valori come la tabella dell'etichetta, «di cui» rientrati), account OFF la prima volta (rifiutato → si richiede, le correzioni restano) → «Invia» → scheda aggiornata nello stesso foglio (se OFF dà ancora quella di prima: `inAggiornamento`, in cima la riga «Contributo inviato» con l'anello al posto di «Completa», e la scheda si rilegge da sola per ~40 s e si sostituisce quando arriva quella nuova; poi la riga diventa «tocca per riprovare»). In `prodotto.js` la riga «Completa la scheda» / «Aggiungilo a Open Food Facts» (`daCompletare`) |
| `components/documenti.js` | documenti di Drive collegati a un progetto o a una voce del manuale: `sceltaDocumenti` (elenco + ricerca, in un foglio), `elencoDocumenti`, `rigaDocumento` |
| `components/foto.js` | foto delle note (4/11): `sceltaFoto` (striscia con la × e due pillole nel foglio della nota: «Scatta», campo con `capture` che apre la fotocamera, e «Galleria», più foto insieme — separati perché su Android un campo `multiple` non offre la fotocamera; `preparaFoto` → JPEG ≤ 1600 px e ≤ 900 KB più miniatura), `strisciaFoto` (foglio di lettura: riquadri subito dalle proporzioni in `foto`, immagini quando arrivano, tocco → `apriVisore` a tutto schermo, si chiude al tocco, senza voce in cronologia), `salvaFoto` (con la visibilità della nota) / `visibilitaFoto` / `eliminaFoto` / `eliminaFotoDi` / `leggiFoto` (le proprie e, per una nota condivisa, anche quelle della casa) su `journal_photos` (una foto per documento, base64 in Firestore, non Cloud Storage; la nota tiene solo `foto: [{ id, w, h }]`) |
| `components/registratore.js` | nota vocale **a pezzi** (14/11): `pulsanteRegistra({ inserisci(testo, { primo, aCapo }), progetto, cosa, archivia, riprendi, onStato })` per la barra del foglio della nota e sotto le istruzioni del progetto (Registra → tempo e pallino col livello della voce · Ferma → «Trascrivo…»). Taglia nelle pause (AudioContext: silenzio di 0,6 s dopo 6 s, al più 30/45 s), ogni pezzo va subito a `trascrivi` con la fine del testo (`prima`) e il testo entra nel campo a ogni pausa; MediaRecorder webm/opus a 32 kbit/s, schermo acceso, microfono liberato a Ferma o alla chiusura del foglio. Con `archivia` (note del diario) audio e testo stanno nell'archivio del telefono (`core/archivio.js`) finché la nota non è salvata (`attendi()` prima di salvare, `conclusa()` dopo): un pezzo che non arriva si riprova da solo, una registrazione rimasta (app chiusa, foglio chiuso) è in `sospese()` e il Diario la offre in cima; due registrazioni nello stesso foglio sono una sessione sola. Traccia muta (schermo spento) → avviso al ritorno |
| `core/archivio.js` | archivio sul telefono (IndexedDB `dd-archivio`, 14/11): `metti`, `prendi`, `togli`, `tutti(prefisso)`, `togliTutti`; oggi le note vocali (`sessioni`, `audio`) |
| `modules/chiedi/index.js` | pagina Chiedi (14/11; menu → Casa, il punto di domanda in testata del Diario, la barra in basso, la scorciatoia dell'icona): domande come righe del Diario, + per una nuova (`nuovaDomanda`: Invio chiede, esempi, Registra), `apriDomanda(id)` segue `domande/{id}` (`seguiUno`): la domanda in serif, «Cerco…» con i passi scritti dal server, la risposta (`testoRicco`) con le fonti come righe (nota → Diario, spesa, task, voce, progetto, evento → Calendario) e il campo per continuare; Elimina a sinistra. `#/chiedi/<id>` apre una domanda (notifica della revisione), `#/chiedi/nuova` il foglio. Una risposta persa per strada non è un errore (la scrive il server) |
| `components/persone.js` | scelta delle persone di un task: suggerimenti dalla rubrica e da Google Contatti, persone nuove; una voce della rubrica non collegata e il contatto Google con lo stesso nome compaiono una volta sola, e sceglierla la collega. Con `perNota` (persone di una nota) niente entra in rubrica: `valore()` → [{ nome, voceId?, googleId? }] |
| `modules/*/index.js` | un modulo = `{ id, title, nav, icon, mount(container) → smonta }`, in `modules/registry.js` |
| `modules/diario/index.js` | note che vedi (`seguiNote`: le tue e quelle dei progetti condivisi, 7/11; quelle dell'altra persona col suo nome, `autore`, modificabili come le tue; in fondo al foglio di lettura «Ultima modifica: …», `ultimaModifica`); `salvaNotaNuova` / `salvaModificaNota` (visibilità dal progetto, foto comprese; anche per la pagina Progetto); filtrato su un progetto il Diario ne prende il colore (7/11: pillola piena, + con `data-colore`, giorni delle note con `.elenco--progetto`), su «Tutte» l'etichetta del progetto col pallino del colore; in cima «Prossimi giorni» (eventi di tutti i calendari visti di oggi e dei due giorni dopo, non finiti, al più 4, righe di `rigaEvento`; solo se ce ne sono); tondo col calendario sopra il + → `apriEvento` (2/11, scelta B; solo con `scriviEventi`); note come le lezioni (29/10): `rigaNota` (giorno in serif solo sulla prima nota del giorno, titolo, anteprima su due righe, ora · modello, fotocamera col numero se la nota ha foto, progetto su «Tutte», persone, temi; etichetta del progetto e temi nel colore del progetto, `data-colore` sulla riga; proposte sotto la riga), `elencoNote` (fasce per mese), `apriLettura` (foglio di lettura: persone che aprono la rubrica o Google Contatti, riepilogo con la trascrizione ripiegata o testo, proposte; Rianalizza ed Elimina a sinistra, Modifica a destra; toccando titolo, testo, riepilogo o trascrizione il foglio della nota prende il suo posto col cursore lì, `onModifica({ campo, pos })` → `apriNota({ fuoco })`); `apriNota` (titolo in serif sopra il testo, Invio porta al testo; Foto (4/11, `sceltaFoto`; `onSalva(dati, foto)` → `applicaFoto`, usata anche dalla pagina Progetto); Persone; progetto; giorno; trasformazioni Task, Lista, Spesa, Manuale ed Evento — 2/11, scelta C: titolo della nota o prima riga → titolo, il resto → note, giorno della nota; una nota già scritta si riapre dall'inizio, senza tastiera); `testaNota` (titolo dell'AI o a mano, se no la prima frase, e l'anteprima riprende da lì); filtro per progetto (`macroapp.diario.progetto`, lo scrive anche la pagina Task; pillole = progetti con istruzioni o con note tra le ultime 100, seguite sempre anche col filtro: il 2/11 un progetto senza istruzioni spariva riaprendo il Diario filtrato). Riga, foglio e `analizzaNota` li usa la pagina Progetto; dal 14/11: in cima «Nota vocale da salvare» (registrazioni rimaste sul telefono, `sospese()`: tocco → nota col testo, il resto si trascrive; × con Annulla), in testata il punto di domanda → Chiedi, foto condivise da un'altra app (`fotoCondivise`, cache `dd-condivisi`) e nota di sole foto, scorciatoia `#/diario/vocale` (registra subito), `nota:<id>` chiesta da Chiedi (`richiestaPer`) apre il foglio di lettura; l'analisi parte quando nota e foto sono scritte (`pronta`) |
| `modules/progetto/index.js` | pagina di un progetto con istruzioni (`macroapp.progetto` = quale; menu → Progetti, o dal Diario e dai Task; in un progetto condiviso anche le note dell'altra persona, 7/11): viste Sintesi (righe per tema con stato e note collegate via `journal_entries.temi`; toccando il testo di un tema si apre il foglio della sintesi col cursore lì, `sezioniSintesi` dà l'`inizio` di ogni sezione), Note (le righe e il foglio di lettura del Diario; «Lezioni» fino al 29/10, valeva solo per il tennis), Da fare. Titolo in testata = nome del progetto (`titoloCorrente`, letto da app.js) |
| `modules/lista/index.js` | tessere a 4 colonne (`minmax(0, 1fr)`: 7/11, una marca lunga allargava la griglia oltre lo schermo e la barra in basso si spostava; in più `#app` ha `overflow-x: clip`) (il pallino della fascia apre la scheda del prodotto, `apriProdottoDi`, e i tre puntini il foglio Modifica: entrambi in un angolo di 34 px; nel foglio Modifica il prodotto sta in cima); in testata l'orologio → `scansioni`; quelle da comprare divise per reparto (`REPARTI` = ordine del giro, `REGOLE_REPARTO` dal nome, `reparto` scelto a mano nel foglio Modifica); recenti e «Mi serve» per frequenza, senza reparti. Tondo «Scansiona» sopra il + (`fab--sopra`, 29/10; `fabDoppio()` alza toast e spazio in fondo) e «Scansiona» in Mi serve e in Modifica → `inserisciProdotto` (voce = tipo di prodotto, marca nel dettaglio, `ean` + `prodotto`; pallino della fascia sulla tessera); scorciatoie dell'icona `#/lista/nuova` («Mi serve») e `#/lista/scansiona` (14/11) |
| `modules/task/index.js` | task per progetti, fasce In ritardo / Oggi / Prossimi 7 giorni / Più avanti / Senza scadenza; `rigaTask` con il giorno a sinistra come nel Diario (5/11: numero in serif, sotto «oggi», il giorno della settimana entro una settimana o il mese; solo sulla prima riga del giorno, `conGiorno`; rosso in ritardo; colonna vuota senza scadenza; la data non si ripete nel testo); `apriProgetto` (nome, visibilità, istruzioni per il diario, scritte o dettate con «Registra» sotto il campo, documenti di Drive, colore); dal progetto il pulsante Diario |
| `modules/scansioni/index.js` | prodotti scansionati (dall'orologio della Lista): righe come il Diario, una per prodotto, dalla più recente (`scansioni` + schede in cache lette dalla casa prima della cronologia); tocco → scheda con Preso / Da comprare; in basso a destra Scansiona |
| `modules/barra/index.js` | pagina Barra in basso (menu → Account): le sezioni scelte con frecce su/giù e spunta accesa per toglierle (mai sotto una), poi Pagine e Progetti da aggiungere (spunta spenta, tocco = in fondo); si salva al tocco |
| `modules/modelli/index.js` | pagina Modelli AI (menu → Account): un modello per le note semplici e uno per le note dei progetti con istruzioni, salvati al tocco |
| `modules/notifiche/index.js` | pagina Notifiche (menu → Account): stato di questo telefono, «Attiva» in basso a destra, categorie in due gruppi con l'anticipo dei promemoria (pillole dentro la riga), «Senza suono di notte», telefoni attivi, prova |
| `modules/google/index.js` | pagina Google (menu → Collegamenti): stato del collegamento, righe Contatti / Calendario (foglio «Calendari», `apriSceltaCalendari` dal modulo calendario) / Drive, «Collega» in basso a destra, Ricollega e Scollega; conclude il ritorno dalla pagina di Google |
| `modules/calendario/index.js` | pagina Calendario (menu → Casa, o «Calendario» sopra i prossimi giorni del Diario): in testata «Calendari» → `apriSceltaCalendari` (foglio: il calendario della casa su una riga, «Tocca per cambiarlo»; «Da vedere anche» con gli altri dell'account, colore a scelta sotto quelli scelti; si salva con Salva); pillole Tutti / un calendario (`macroapp.calendario.filtro`) quando sono più d'uno; agenda dei prossimi 60 giorni con una fascia per mese e `rigaEvento` (giorno in serif come le lezioni, numero solo sulla prima riga del giorno; nome del calendario davanti all'orario nel suo colore, tranne per la casa; `quandoEvento`, `inOrdine`), + per un evento nuovo (`apriEvento`, dal 7/11 con la struttura del foglio di Google Calendar: titolo grande — Invio salva — e pillole dei calendari modificabili se sono più d'uno; «Tutto il giorno» con la spunta, righe dell'inizio e della fine con la data a sinistra e l'ora a destra (testo che apre il selettore del telefono, `sceltaNativa`), «Non si ripete» che apre le ripetizioni; poi progetto (7/11, pillole col colore, `extendedProperties.shared.ddProgetto`), luogo e descrizione con le icone; nelle righe l'etichetta del progetto col suo colore, `etichettaProgetto`. Nuovo = con orario dall'ora piena dopo adesso, un'ora; spostando l'inizio la fine lo segue; una fine prima dell'inizio nello stesso giorno passa al giorno dopo; una ricorrenza si cambia solo per quella volta; niente riga del fuso, sempre Europe/Rome), foglio dell'evento con Modifica, Elimina e il link a Google; un evento di un calendario in sola lettura o un invito apre un foglio di sola lettura (`apriLettura`) con «Apri in Google»; senza Google o senza calendari scelti invita a sceglierli |
| `modules/spese/index.js` | saldo, pareggio, ricorrenti; «Dalla banca» accanto a «Ricorrenti» (7/11) con il numero delle uscite della banca da confermare in un pallino (`.contatore`): foglio con una riga per uscita (giorno a sinistra, conto, importo) e sotto «Dividi a metà» (`accept`) e «Solo mia» (`reject`); la riga toccata apre `apriSpesa` già compilato (`prefill`: date, source «bank», bankTxId, `dopo` → `segnaAccettata`). Si apre anche da `#/spese/banca` (notifica delle spese lette) e da `vaiA("spese", "banca")` (pagina Banca) |
| `modules/banca/index.js` | stato del collegamento (`bank_connections/{uid}` in tempo reale), scelta della banca, conclusione al ritorno da `/banca?code=…` (messo da parte in `app.js`), «Leggi ora», rinnovo, scollega |

## Regole di lavoro

1. **Design**: Mattia è preciso. Grammatica presa dall'app cura-del-verde: Instrument Sans/Serif,
   icone a linea sottile, righe con filetti invece di riquadri, campi con la sola linea sotto,
   pillole, fogli a tutta altezza. Colori solo dalle variabili in `css/base.css`.
   Identità visiva definitiva ancora da decidere (l'icona sì, vedi Stato): non inventarla senza che lo chieda.
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
   (servono per `householdId+visibility+ordine` e `ownerUid+ordine`). Gli ordinamenti fini
   si fanno nel modulo, per non moltiplicare gli indici.
5. Niente entra nei moduli dall'AI senza conferma: l'agente scrive solo `proposals` (anche gli eventi
   del calendario: proposta `event`, scritta su Google solo con la spunta). Eccezioni, perché sono la nota
   stessa e si correggono dal suo foglio: il riepilogo di una nota di un progetto con istruzioni
   (`journal_entries.riepilogo`, deciso da Mattia il 23/10), il titolo e le persone nominate di ogni nota
   (`titolo`, `persone`, richiesta di Mattia del 29/10; una persona taggata non entra in rubrica).
   La sintesi del progetto invece passa dalla conferma (scelta di Mattia, 26/10).
6. Mai nel repo chiavi o dati personali.

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
`gh workflow run` qui non va (GraphQL bloccato): `gh api -X POST repos/mattiaforni/macroapp/actions/workflows/diagnosi.yml/dispatches -f ref=main -f 'inputs[note]=true'`.
Primo uso, 7/11 sera: la nota della compagna nel progetto condiviso, scritta prima dell'aggiornamento, era ancora privata
(il suo telefono non aveva ancora aperto la versione nuova); allineata dal server con il consenso di Mattia.

Se l'app riceve «internal» da una funzione chiamata con `httpsCallable`, la prima cosa da
guardare sono gli invocatori: senza `allUsers` il preflight CORS prende 403. Il deploy lo reimposta
per le funzioni elencate nell'ultimo passo di `deploy.yml`: una nuova funzione onCall va aggiunta lì.

## Prove

```
npm install --prefix prove        # una volta: font per le schermate
python3 prove/costruisci.py       # copia public/ con Firebase finto in memoria
python3 prove/prova.py            # flusso completo in Chromium, schermate in prove/_schermate
node functions/strumenti/prova-banca.mjs   # quali movimenti bancari diventano proposte (servono le dipendenze di functions)
node functions/strumenti/prova-avvisi.mjs  # cosa dicono le notifiche e a chi (anche giro del calendario con Google finto e riepilogo)
node functions/strumenti/prova-prodotti.mjs # indice dei prodotti su schede OFF costruite a mano
node functions/strumenti/prova-chiedi.mjs   # Chiedi senza rete: strumenti, privacy, fonti, giro con un Claude finto; revisione e costi
python3 prove/additivi.py                   # rigenera la tabella degli additivi dalla tassonomia OFF
```
Le regole di sicurezza non sono simulate. Se usi nuove funzioni dell'SDK, aggiorna `prove/finto/firebase.js`.

## Stato (14 novembre 2026) e prossimi passi

- [x] **Aggiornamento più agile** (14/11, Mattia: «non c'è modo di avere una modalità più agile di aggiornamento?»). Le pagine
      arrivano già alla riapertura dell'app, ma un'app rimasta aperta in background restava sulla versione vecchia (il service
      worker, che ricaricava, cambia di rado). Ora a ogni ritorno nell'app (al più ogni 10 s) si rilegge `version.js`, che il
      deploy riscrive col commit: se è cambiata la pagina si ricarica da sola; con un foglio o il menu aperti lo chiede soltanto.
      Resta fuori ciò che sta nell'«involucro» installato da Chrome (nome, icona, condivisione, scorciatoie dell'icona): lo
      aggiorna Chrome quando vuole; si forza con `chrome://webapks` → Update o reinstallando l'app (i dati sono sul server).

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

- [x] **Analisi e telefono bloccato** (7/11, notte, Mattia: «spesso dice non analizzata dopo aver bloccato il telefono e rilancio
      l'analisi… poi l'analisi dopo un po' compare»). Causa: bloccando il telefono la richiesta ad `analyzeEntry` cadeva, l'app
      scriveva `analysisError` e mostrava «non analizzata» mentre il server finiva; rilanciandola ne partiva una seconda in
      parallelo. Ora lo stato sta sulla nota e lo scrive il server (`journal_entries.analisi`, docs/MODELLO-DATI.md): «Analizzo…»
      nella riga e nel foglio (pulsante spento) finché il server non ha finito, su tutti e due i telefoni; una seconda richiesta
      mentre una è in corso non riparte (`giaInCorso`); una risposta persa (codici di collegamento senza messaggio del server) non
      è un errore, l'app dice che l'analisi continua; un «in corso» oltre 330 s (funzione interrotta) torna «non analizzata» e si
      rilancia (`analisiInCorso`, `scadenzaAnalisi` in diario). Il Firebase finto fa come il server (`finto.analisi.persa`,
      `finto.analisi.ritardo`); la prova copre risposta persa, pulsante spento, esito che arriva da solo e analisi morta.

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


- [x] **Giorno a sinistra nei task** (5/11, richiesta di Mattia dal telefono: «anche i task li voglio con i numeri delle date a sx
      come il diario»; le fasce restano). `rigaTask` ha la colonna del giorno delle lezioni (`.riga__giorno`, stessa grammatica
      di `.lezione__giorno`): numero del giorno, sotto «oggi», il giorno della settimana (Prossimi 7 giorni) o il mese (In ritardo,
      Più avanti, completati con la data del fatto); numero solo sulla prima riga dello stesso giorno, colonna vuota senza scadenza
      per tenere i testi allineati; in ritardo il numero è color `--frutto`, sulla pagina del progetto del colore del progetto.
      Tolti dal testo «era per il …», «domani», il giorno della settimana e «fatto il …»: li dicono colonna e fascia.
      Le prove coprono le cinque fasce e la riga senza numero (`4b-task-giorni`).

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

- [x] **Barra in basso per persona** (3/11, richiesta di Mattia: la compagna vuole il Calendario al posto del Diario,
      lui il Diario e il progetto Tennis; scelte: pagina nel menu a sinistra, progetti come sezioni, apertura sulla prima
      sezione). `users.barra`, al più 5 sezioni tra Diario, Lista, Spese, Task, Calendario, Manuale, In attesa e i progetti
      non archiviati; un progetto in barra ha la route `progetto-<id>` e il suo colore quando è aperto. Le prove coprono
      scelta, ordine, limite, apertura sulla prima sezione e il menu che porta alla sezione.
      **Da verificare dal telefono**: il nome del progetto in barra alla prima apertura (viene da localStorage: la prima
      volta su un telefono nuovo dice «Progetto» finché i progetti non arrivano) e lo scorrimento col dito verso un progetto.

- [x] Pubblicazione automatica, accesso Google (anche da app installata), service worker
- [x] Lista (stile Bring), Spese (stile Splitwise, ricorrenti, pareggio), Diario con agente, Task per
      progetti con persone, Manuale con rubrica e categorie della casa
- [x] Agente del diario funzionante (Sonnet, ~7 s): le proposte entrano nei moduli con la spunta
- [x] **Modelli AI** (27/10, scelta di Mattia): Sonnet per le note semplici, Opus per quelle dei progetti con
      istruzioni; si cambiano da menu → Modelli AI (anche Haiku). Il server legge `users.modelli` (chiavi non
      valide → predefinito); la nota segna `modello` e il Diario lo mostra accanto all'ora. Tutti e tre ragionano
      prima di rispondere e il ragionamento conta in `max_tokens`: tetti 8000 (semplici) e 32000 (progetti).
      Opus su una nota di progetto lunga può metterci minuti: function a 300 s, app a 310 s. Da verificare con le
      lezioni vere: durata di Opus e se la sintesi è davvero migliore di quella di Sonnet.
      Prova con l'API vera da terminale: `MODELLO=opus ISTRUZIONI=… node functions/strumenti/prova-agente.mjs "…"`.
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
- [x] **Evento dal Diario** (2/11, richiesta di Mattia dal telefono; scelte B + C tra tre schermate, scartata la A: «+ Evento»
      accanto a «Calendario» in cima, contro la regola dell'azione in basso a destra e assente quando la striscia non c'è).
      B: tondo col calendario sopra il + del Diario, come «Scansiona» nella Lista, apre il foglio dell'evento. C: «Evento» tra
      le trasformazioni del foglio della nota (la nota non si salva). Entrambi solo con un calendario in cui scrivere
      (`scriviEventi`). Il giorno non si ricava dal testo: per quello resta la proposta `event` dell'agente.
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
- [ ] Diario per progetto, seguiti: importare lo storico delle lezioni dalle chat del progetto Claude
      (esportazione dei dati di claude.ai); valutare con le note vere quante precedenti servono
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
      Su Android Chrome chiede il nuovo WebAPK solo con tutte le finestre dell'app chiuse, telefono in carica e
      Wi-Fi (web.dev, «manifest-updates»). Da Chrome 144 un'icona conta come cambiata solo se cambia il campo
      `icons` del manifest: **cambiando il disegno, cambia anche il nome del file** (o un `?v=` nell'URL).
      28/10: due giorni dopo l'icona sul telefono di Mattia era ancora la vecchia; il manifest pubblicato era
      quello nuovo. Per forzare: in carica e in Wi-Fi, chiudere e «Arresto forzato» dell'app, `chrome://webapks`
      in Chrome → «Update» su D&D («Update Status» = Pending), aprire e richiudere l'app; se D&D non è
      nell'elenco, è un collegamento semplice e va reinstallata da Chrome.
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
- [ ] Identità visiva definitiva (resto dell'app): da decidere con Mattia

Bassa priorità (Mattia, 23/10: la revisione delle spese è meno rilevante), previste in
`docs/ARCHITETTURA.md`: regole di spesa apprese (`expense_rules`: c'è la regola Firestore, nessuno
le scrive né le applica in `syncBank`), bonifici tra i due membri riconosciuti come pareggi, divisione
a percentuale.
