# Architettura

## Principi

1. **Un solo progetto, due utenti.** Login Google per entrambi; una "casa" (`households/{id}`) è il contenitore delle aree condivise.
2. **Visibilità per documento, non per modulo.** Ogni documento ha `ownerUid`, `householdId`, `visibility` (`shared`|`private`). Un modulo può contenere voci condivise e personali insieme (manuale, task); il diario è sempre personale.
3. **"Separato" = nascosto nell'interfaccia.** Le regole Firestore impediscono all'altra persona di leggere i documenti personali, ma il gestore del progetto Firebase vede tutto dalla console. Chi usa il diario deve saperlo. Se servisse riservatezza reale, il testo del diario andrebbe cifrato sul dispositivo.
4. **Niente entra nei moduli senza approvazione.** Tutto ciò che è generato automaticamente (agente, banca, contenuti condivisi da altre app) passa dalla coda `proposals`. Un solo componente (`components/proposals.js`) rende e applica le proposte di qualunque origine.
5. **Il backend non sa quale modello risponde.** `functions/src/ai/provider.js` espone `reason()` e `transcribe()`; i provider (`claude.js`, `gemini.js`) sono intercambiabili. Il modello riceve sempre testo. Quale modello di Claude
   lo sceglie l'utente (`users.modelli`, pagina Modelli AI): uno per le note semplici, uno per quelle dei progetti con istruzioni.

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

Scelte: nessun framework né bundler (coerente con i progetti precedenti, deploy = copia di file). SDK Firebase modulare da CDN. Query in tempo reale con `onSnapshot`; cache IndexedDB per usare la lista anche senza rete. Le query in tempo reale sono condivise e restano aperte 10 minuti dopo l'uscita da una pagina (db.js): tornandoci i dati ci sono già, senza schermo vuoto né «vuoto» di passaggio.

## Backend (`functions/`)

- `analyzeEntry` (callable): legge una nota del diario del chiamante, chiama `reason()` con uno schema JSON e scrive proposte. Non modifica mai i moduli. In ogni nota scrive il titolo e le persone nominate (`persone`: collegate a una voce della rubrica o a un contatto Google, scelto tra quelli con una parola del nome nel testo: `src/google/contatti.js`; nessuna voce entra in rubrica), salvo che l'utente li abbia scritti a mano nel foglio della nota. Se la nota è di un progetto con istruzioni, scrive anche il riepilogo nella nota (testo della nota, correggibile, come titolo e persone) con i temi della nota, e propone la sintesi aggiornata del progetto (`project_summary`, da confermare; solo se cambia). Contesto: la sintesi attuale e le ultime 8 note dello stesso progetto (riepilogo se c'è, se no testo); senza sintesi, fino a 30 note, per costruire la prima. Ritorna `{ proposals, riepilogo, titolo, persone, sintesi, sintesiEsito, modello }`.
- `bank` (callable, `{ azione }`): `banche` (elenco per paese), `avvia` (`POST /auth` → url del consenso, `state` salvato in `bank_connections/{uid}.pending`), `concludi` (`POST /sessions` col `code`, controlla lo `state`, chiude la sessione precedente, salva conti e scadenza), `scollega` (`DELETE /sessions/{id}`), `sincronizza` (la lettura di `syncBank`, a richiesta). Scrive solo nel documento del chiamante.
- `contatti` (callable): Google Contatti. `avvio` → pagina di Google (OAuth con codice, `access_type=offline`);
  `collega` → scambia il codice, conserva il refresh token in `google_tokens/{uid}`; `token` → permesso di un'ora
  per la People API, che l'app usa direttamente; `scollega` → revoca e cancella.
- `avvisa` (callable): notifiche push (Firebase Cloud Messaging), vedi «Notifiche» sotto.
- `prodotto` (callable, `{ ean, aggiorna? }`): scheda di un prodotto dal codice a barre, vedi «Prodotti» sotto.
- `syncBank` (schedulata, 07:15 Europe/Rome): per ogni `bank_connections` attiva scarica i movimenti contabilizzati degli ultimi 7 giorni e crea una proposta di spesa **personale** per ogni uscita (la spesa confermata nasce condivisa). Deduplica con id deterministico della proposta (`eb_<entry_reference>`).
- Segreti in Secret Manager, mai nel repository.

## Banca (Enable Banking)

Stato: in funzione dal 23/10 con Intesa Sanpaolo (quattro rapporti, due senza IBAN). Il 25/10 la sessione è stata chiusa nella notte, circa 36 ore dopo il consenso, con `access.valid_until` a gennaio: da allora un consenso chiuso prima della scadenza è uno stato previsto (`needsRenewal`, vedi sotto). Da verificare coi dati veri:
- quali conti espone ciascuna banca (Crédit Agricole non espone le carte di credito senza IBAN);
- formato di `entry_reference` / `transaction_id` per la deduplica, e come viene la descrizione (`descrizioneDi`: nome del creditore, altrimenti causale);
- presenza del codice categoria esercente (MCC, salvato in `payload.merchantCategory`);
- durata del consenso e flusso di rinnovo: Enable Banking documenta che molte banche italiane tengono **un solo consenso attivo per terza parte e per utente** e che uno nuovo invalida il precedente, anche se aperto dal Control Panel di Enable Banking («Link accounts» rifatto sulla stessa banca) o da un'altra app che passa da Enable Banking; una banca può anche chiudere il consenso da sé. `concludi` chiude comunque la sessione precedente. Si chiede il massimo che la banca concede (`maximum_consent_validity`, fino a 180 giorni: Intesa li concede).
- carte (rapporti senza IBAN): deciso con Mattia il 25/10 di leggere gli acquisti della carta di credito uno per uno e scartare il suo addebito mensile sul conto (`classifica` in enable.js, vedi sotto). Da verificare coi dati veri: se Intesa dà gli acquisti della carta come `BOOK` presto o solo all'estratto conto (si leggono le carte a 14 giorni, contando dalla contabilizzazione; la data della spesa è `transaction_date`), se sulla carta compare il pagamento del saldo come entrata, e il testo dell'addebito sul conto. Cosa sia il quarto rapporto senza IBAN: se fosse una carta di debito, i suoi acquisti sarebbero anche sul conto (doppi).

Una sola app Enable Banking per la casa, in **produzione in modalità ristretta** (gratuita, uso personale): vede solo i conti collegati prima nel Control Panel («Link accounts»); appId e chiave stanno in Secret Manager. Un collegamento può avere credenziali proprie (`appId`/`privateKey` nel documento), ma oggi non le scrive nessuno: starebbero in un documento che il proprietario legge dal telefono.

Flusso di collegamento:
1. menu → Banca → + → elenco banche (`bank banche`) → tocco → `bank avvia`: JWT → `POST /auth` → l'app manda l'utente all'url della banca
2. la banca rimanda su `https://macroapp-b9bd0.web.app/banca?code=…&state=…` (o `?error=access_denied`): `app.js` mette l'esito in `sessionStorage` e va a `#/banca`, che chiama `bank concludi` → `POST /sessions` → conti e scadenza in `bank_connections/{uid}`
3. `syncBank` ogni mattina, o «Leggi ora» (`bank sincronizza`). Limite PSD2: senza l'utente presente la banca permette 4 letture al giorno per conto (Intesa risponde poi 429 `ASPSP_RATE_LIMIT_EXCEEDED`, «consented multiplicity per day»); «Leggi ora» manda quindi le intestazioni PSU (`Psu-Ip-Address`, `Psu-User-Agent`, … da `intestazioniPsu`) e non entra nel conto, `syncBank` no ed è una al giorno; la pagina avvisa quando il consenso scade entro 14 giorni (notifica push: in futuro).
4. Quali uscite sono spese (`classifica`, provata da `functions/strumenti/prova-banca.mjs`): con una carta di credito tra i conti letti, l'addebito mensile della carta sul conto si scarta se sulla carta c'è un'entrata dello stesso importo entro 5 giorni, altrimenti se il testo nomina carta di credito, saldo, estratto conto o e/c accanto a «carta» (`SALDO_CARTA`; «Pagamento POS … carta 1234» resta). Senza carte lette l'addebito resta, perché è l'unica traccia di quelle spese. Si scartano anche i giroconti verso un altro conto letto (IBAN del beneficiario). Gli scarti vanno in `scartati`, visibili nella pagina Banca. Le uscite non contabilizzate (`PDNG`, `HOLD`, `SCHD`) non diventano proposte, perché prima della contabilizzazione importo e riferimento possono cambiare (preautorizzazioni: benzinaio, albergo); vanno in `lettura.inAttesa` e la pagina le mostra in «In attesa di contabilizzazione». Le righe dei conti dicono quanti movimenti ha dato la banca e quante uscite sono in attesa.
5. Se Enable Banking risponde `EXPIRED_SESSION` (401 con codice `*SESSION*`, `sessioneChiusa` in enable.js): `syncConnection` legge lo stato della sessione, scrive `needsRenewal: true`, `sessionStatus`, `sessionEndedAt`; `syncBank` non la tocca più; la pagina mostra «Collegamento interrotto» e mette «Rinnova il consenso» in basso a destra, che rifà il punto 1 con la stessa banca.

## Prodotti (Open Food Facts)

Dalla Lista («Scansiona» nel foglio Mi serve, o nel foglio Modifica di una voce) si legge un codice a barre con la
fotocamera (`BarcodeDetector`, Chrome Android; dove manca, o senza fotocamera, si scrive il codice) e si apre la
scheda del prodotto: `components/prodotto.js` chiama la function `prodotto`, che legge Open Food Facts
(`GET /api/v2/product/{ean}?product_type=all&lc=it&fields=…`, con lo User-Agent che OFF richiede e che dal
browser non si può impostare) e tiene la scheda in `prodotti/{ean}` per un mese (un giorno se non trovata):
il secondo telefono e le scansioni successive non toccano OFF (limite di 15 letture al minuto per IP).
I campi `*_tags_it` arrivano già tradotti (categorie, additivi, etichette); `product_type=all` rinvia un
cosmetico a Open Beauty Facts.

**Indice** (`functions/src/prodotti/indice.js`, 0–100, sul modello di Yuka ma con regole dichiarate; modello 2 dal
29/10): Nutri-Score 50 (A 100 … E 10), additivi 25 (conta il rischio, non il numero: −5 per additivo senza giudizio EFSA,
al più −20, nulla per quelli rivalutati senza rischio; tetto 50 con un additivo a rischio EFSA «moderato», 20 con uno
«alto»), NOVA 15 (1–2 100, 3 75, 4 25), bio 10 (ignoto se la scheda non ha ingredienti né etichetta bio). Media pesata
delle componenti note; se ne manca una l'indice è «parziale» e lo dice; senza Nutri-Score né ingredienti non c'è indice.
Un additivo a rischio alto porta l'indice al massimo a 49. La scheda porta `versioneIndice`: quando il modello cambia
(`VERSIONE_INDICE`, uguale in `components/prodotto.js`), la function ricalcola dai campi salvati le schede in cache alla
loro prossima lettura (`ricalcola`, senza Open Food Facts), e la Lista rilegge le voci il cui riassunto ha una versione
più vecchia (`prodotto.v`) per aggiornarne il pallino (`aggiornaRiassunti`, una volta per codice e per sessione). Fasce: 75+ eccellente, 50 buono, 25 mediocre, sotto scarso. Il rischio degli
additivi viene dalla tassonomia OFF (`efsa_evaluation_overexposure_risk`, 38 additivi «alto» — nitriti, sorbati,
benzoati, solfiti, fosfati, carragenina, glutammato —, 14 «moderato»), estratta in `additivi.js` con
`prove/additivi.py`. Prova senza rete: `node functions/strumenti/prova-prodotti.mjs`.

**Nella Lista** la voce entra come tipo di prodotto (la categoria OFF più specifica, correggibile nel campo «In lista
come», con le voci simili già in lista da toccare per unirsi), la marca nel dettaglio, `ean` e il riassunto in
`prodotto`; «Preso» (in basso a destra) la mette tra i comprati, «Da comprare» in lista. La tessera porta il pallino
della fascia; dal foglio Modifica si riapre la scheda. Dati ODbL: la scheda cita Open Food Facts e rimanda alla pagina
del prodotto, anche per completarla quando è incompleta.

**Confronto con Yuka** (29/10, cinque prodotti scansionati da Mattia con le due app; Yuka / D&D): cracker Belle Buone
57 / 59, pizza margherita Le Stagioni d'Italia 54 / 35, Wasa sesamo 78 / 86, Natù fragole 73 / 80, crema 100% nocciole
Esselunga 84 / 25. Yuka dichiara nutrizione 60, additivi 30 (quattro livelli di rischio, criteri propri: EFSA, IARC e
altri studi), bio 10, tetto 49 con un additivo a rischio alto; la trasformazione non entra. La sua parte nutrizionale si
ricostruisce esattamente su quattro prodotti come **80 − 5 × punti del Nutri-Score 2017** (scala continua; la frutta a
guscio conta tra i positivi, «Frutta a guscio 100%»), mentre OFF pubblica la lettera del Nutri-Score 2023 e noi la
convertiamo a gradini. Applicando i pesi e le regole di Yuka ai dati OFF le distanze grandi restano (crema 26, Natù 99):
vengono dalla parte nutrizionale e dai dati, non dai pesi. Per prodotto:
- pizza (−19): NOVA 4 vale 0 su 15 punti, e un additivo senza rischio (E330) ne toglie 20 su 100 della sua componente;
- crema (−59): la scheda OFF non ha ingredienti (additivi e NOVA ignoti, indice parziale) e ha Nutri-Score D, quasi certamente
  perché OFF la tratta come crema spalmabile (algoritmo generale: conta l'energia, la frutta a guscio non è più tra i
  positivi) e non come frutta a guscio, che nel 2023 ha una categoria sua con regole più favorevoli. Si corregge su OFF
  (ingredienti e categoria), poi «Rileggi» nella scheda;
- Wasa (+8): bio secondo OFF, non secondo Yuka (il nome della scheda OFF fa pensare a un'altra versione dello stesso codice);
- Natù: non si ricostruisce, la parte «Negativo» di Yuka non è nello screenshot.
Da qui il modello 2, **applicato il 29/10 su decisione di Mattia**: additivi per rischio e non per numero, NOVA 4 = 25
invece di 0 (OFF assegna NOVA 4 con un solo ingrediente marcatore, e spesso il marcatore è un additivo già contato), bio
«ignoto» quando la scheda non ha ingredienti. Sui cinque prodotti: 63, 43, 86, 88, 30 (Yuka 57, 54, 78, 73, 84); la prova
`prova-prodotti.mjs` li controlla. Restano lontane la crema (dati OFF da completare) e la pizza (la trasformazione, che
Yuka non conta); Natù sale invece di scendere, per il bio e l'A del Nutri-Score.

## Spese: regole e saldo

- Saldo con `split: "equal"` (metà a testa) o `"full"` (tutta a carico dell'altro). Estensione prevista: percentuali.
- `expense_rules`: regole apprese dalle scelte ("ESSELUNGA → condivisa, categoria spesa"). Da applicare in `syncBank` prima di creare la proposta: se una regola corrisponde, la proposta nasce già classificata (o viene accettata automaticamente, se la regola lo prevede).
- Bonifici tra i due membri: da riconoscere come pareggi, non come spese.

## Google (Contatti, Calendario, Drive)

Un solo collegamento dell'account Google per persona, dato una volta (pagina Google nel menu → Collegamenti): la
pagina di Google chiede tre spunte facoltative e torna su `/google-contatti` (percorso del primo collegamento, già
autorizzato nel client OAuth). Il refresh token resta sul server (`google_tokens/{uid}`, `functions/src/google/account.js`);
l'app riceve permessi di un'ora (`core/google.js` → `chiamaGoogle`) e con quelli chiama direttamente le API di Google.
Scope: `contacts.readonly`, `calendar.readonly` + `calendar.events`, `drive.readonly`. Google considera i primi due
«sensibili» e Drive «ristretto»: finché la schermata di consenso OAuth è in modalità di test il permesso scade dopo
7 giorni (per entrambi gli utenti) e l'app mostra «Collegamento scaduto»; pubblicarla per Drive richiederebbe la
verifica di sicurezza di Google, che per un'app di due persone non ha senso. Il deploy attiva le tre API e scrive
il segreto GOOGLE_OAUTH_CLIENT.

- **Contatti** (People API, sola lettura, `core/contatti-google.js`): l'elenco dei contatti si legge tutto e resta in
  memoria per cercare mentre scrivi un nome (task, persona nuova del manuale). In rubrica (voci `person` del manuale)
  entrano solo le persone che colleghi, con `googleId`; all'avvio e all'apertura della scheda i loro recapiti si
  aggiornano da Google. Un nome proposto dall'AI si collega da solo se corrisponde a un solo contatto.
- **Calendario** (`core/calendario.js`, pagina `modules/calendario`): Google resta il contenitore, l'app non copia
  gli eventi. Uno dei due sceglie dalla pagina Google quale dei suoi calendari è quello della casa
  (`households.calendario`) e lo condivide con l'altro da Google Calendar; ciascuno lo legge e ci scrive con il proprio
  permesso. La pagina Calendario è un'agenda dei prossimi 60 giorni (ricorrenze espanse con `singleEvents`), con il +
  per un evento nuovo (giorno, tutto il giorno o con orario, luogo, note), scritto subito su Google; un evento si
  modifica e si elimina dal suo foglio. In cima al Diario, «Prossimi giorni» mostra gli eventi di oggi e dei due
  giorni dopo dalla stessa lettura. L'ultima lettura resta anche nel localStorage del telefono, solo come anteprima
  all'apertura (scollegando Google si cancella). L'agente propone eventi dalle note (`event`), che si scrivono solo
  con la spunta. Letture e scritture passano dal telefono; il server non tocca il calendario.
- **Drive** (`core/drive.js`, `components/documenti.js`): dal foglio di un progetto o di una voce del manuale si cercano
  file per nome in tutto il Drive dell'utente (anche nei Drive condivisi) e si collegano (`documenti`). Per un progetto
  con istruzioni, il server legge il testo dei documenti collegati con il permesso dell'utente (`tokenServer` in
  account.js, `functions/src/google/drive.js`: Documenti, Fogli e Presentazioni esportati come testo, file di testo
  così come sono, fino a 6 documenti, 6000 caratteri l'uno e 20000 in tutto) e li dà all'agente come contesto della
  nota; PDF e altri formati si elencano solo per nome. Nel manuale i documenti servono a ritrovare contratti e
  garanzie con un tocco. Una ricerca libera dell'agente su tutto il Drive non c'è: su un Drive intero la rilevanza per
  parole chiave è troppo rumorosa per finire nel prompt senza una scelta dell'utente.

## Integrazioni previste

- **Note vocali** del diario (27/10): il telefono registra (components/registratore.js), la function `trascrivi` manda l'audio
  a Gemini con il vocabolario del progetto e della rubrica (src/trascrizione.js) e restituisce il testo, che entra nel campo
  della nota; poi tutto come una nota scritta. Claude non accetta audio. L'audio non viene salvato.
- **Notifiche push** (FCM): lista condivisa, consensi bancari in scadenza.
- **Web Share Target**: già dichiarato nel manifest; il contenuto condiviso diventa una proposta di appunto.

## Ordine di sviluppo

1. Shell, login, casa, lista, manuale — *fatto (base)*
2. Diario + agente + coda proposte — *fatto (base), da affinare il prompt sui casi reali*
3. Spese: inserimento manuale — *fatto (base)*; collegamento bancario — *codice fatto, da provare con l'app registrata in produzione*
4. Task — *base minima, da estendere se serve*
5. Identità visiva — *da definire*

## Notifiche

Notifiche push con Firebase Cloud Messaging, senza chiave VAPID propria (quella predefinita dell'SDK).
- **Telefoni**: dalla pagina Notifiche (menu → Account) un telefono chiede il permesso, prende il token con
  `getToken` sul service worker dell'app (`sw.js`) e lo scrive in `users/{uid}.dispositivi.<id>`. All'avvio il
  token si riconferma (`aggiornaAllAvvio`). Su iPhone funziona solo dall'app aggiunta alla schermata Home.
- **Quando**: `core/db.js` segnala alla funzione `avvisa` le scritture condivise che possono interessare l'altra
  persona: creazione di spese, task e voci della lista; task segnato fatto; voce rimessa in lista. La lista
  aspetta 1,5 s e manda una chiamata sola per più voci di seguito. Il server rilegge il documento e decide:
  solo documenti `shared` della casa di chi chiama, niente spese ricorrenti, mai a chi ha fatto la cosa.
  Si è scelta la chiamata dall'app invece dei trigger di Firestore per non introdurre Eventarc (e i permessi
  IAM che il deploy dovrebbe concedere): il prezzo è che una scrittura fatta senza rete avvisa solo se l'app
  è ancora aperta quando la scrittura arriva al server.
- **Cosa**: messaggio di soli dati `{ titolo, testo, url, tag }`, disegnato da `sw.js`; il tocco apre la pagina
  (`url`). Stesso `tag` = la notifica si sostituisce: la lista ha un tag solo e riassume le cose aggiunte dalla
  stessa persona nell'ultima mezz'ora ancora da comprare.
- **Banca**: dopo `syncBank`, a chi possiede il collegamento: spese nuove da confermare, o consenso chiuso.
- **Preferenze**: `users/{uid}.notifiche.<spese|task|lista|banca>`, per persona. Prova senza rete:
  `node functions/strumenti/prova-avvisi.mjs`.
