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
js/modules/registry.js      elenco moduli e barra di navigazione (sezioni scelte per persona: js/core/barra.js)
js/modules/<id>/index.js    un modulo = { id, title, nav, icon, mount(container) → unmount }
sw.js                       cache statica, installazione PWA
```

Scelte: nessun framework né bundler (coerente con i progetti precedenti, deploy = copia di file). SDK Firebase modulare da CDN. Query in tempo reale con `onSnapshot`; cache IndexedDB per usare la lista anche senza rete. Le query in tempo reale sono condivise e restano aperte 10 minuti dopo l'uscita da una pagina (db.js): tornandoci i dati ci sono già, senza schermo vuoto né «vuoto» di passaggio.

## Backend (`functions/`)

- `analyzeEntry` (callable): legge una nota del diario del chiamante, chiama `reason()` con uno schema JSON e scrive proposte. Non modifica mai i moduli. In ogni nota scrive il titolo e le persone nominate (`persone`: collegate a una voce della rubrica o a un contatto Google, scelto tra quelli con una parola del nome nel testo: `src/google/contatti.js`; nessuna voce entra in rubrica), salvo che l'utente li abbia scritti a mano nel foglio della nota. Se la nota è di un progetto con istruzioni, scrive anche il riepilogo nella nota (testo della nota, correggibile, come titolo e persone) con i temi della nota, e propone la sintesi aggiornata del progetto (`project_summary`, da confermare; solo se cambia). Contesto: la sintesi attuale e le ultime 8 note dello stesso progetto (riepilogo se c'è, se no testo); senza sintesi, fino a 30 note, per costruire la prima. Ritorna `{ proposals, riepilogo, titolo, persone, sintesi, sintesiEsito, modello }`.
- Dal 14/11 l'agente legge anche: le foto della nota (al più 4, immagini prima del testo); ciò che c'è già (task aperti propri
  e della casa con un codice [t1…], la lista della spesa, gli eventi dei prossimi 21 giorni dei calendari che la persona vede):
  non propone doppioni e può proporre `task_done` / `task_due` su un task aperto (il codice diventa l'id sul server); i PDF di
  Drive dei progetti (`drive_testi`). Ogni chiamata scrive i token e il costo stimato in `consumi` (`src/consumi.js`).
- `chiedi` (callable, `{ id }`, 14/11): risponde a una domanda di `domande/{id}` con Claude e strumenti di sola lettura
  (`cerca_note`, `leggi_nota`, `spese`, `task`, `eventi`, `progetti`, `manuale`, `lista`; `src/chiedi.js`), in un giro di al più
  8 chiamate e ~230 s. Le funzioni usano l'Admin SDK, che salta le regole: ogni strumento filtra a mano (proprio, o `shared`
  della casa di cui la persona è membro). La risposta cita i codici delle fonti ([n3], [s12]): il server li toglie dal testo e
  scrive le fonti accanto. Stato, passi e risposta sul documento, come l'analisi delle note. Modello da `users.modelli.domande`
  (Sonnet); ripiego dei rifiuti lato server (`fallbacks: "default"`, beta), tolto da solo se l'API non lo accetta.
- `revisioneSettimana` (schedulata, domenica 18:47): per chi ha un telefono con le notifiche e non ha spento «settimana», una
  domanda di tipo `settimana` scritta con gli stessi strumenti (`src/settimana.js`) e una notifica che la apre in Chiedi.
- `bank` (callable, `{ azione }`): `banche` (elenco per paese), `avvia` (`POST /auth` → url del consenso, `state` salvato in `bank_connections/{uid}.pending`), `concludi` (`POST /sessions` col `code`, controlla lo `state`, chiude la sessione precedente, salva conti e scadenza), `scollega` (`DELETE /sessions/{id}`), `sincronizza` (la lettura di `syncBank`, a richiesta). Scrive solo nel documento del chiamante.
- `contatti` (callable): Google Contatti. `avvio` → pagina di Google (OAuth con codice, `access_type=offline`);
  `collega` → scambia il codice, conserva il refresh token in `google_tokens/{uid}`; `token` → permesso di un'ora
  per la People API, che l'app usa direttamente; `scollega` → revoca e cancella.
- `avvisa` (callable): notifiche push (Firebase Cloud Messaging), vedi «Notifiche» sotto.
- `giroAvvisi` (schedulata, ogni 5 minuti): eventi nuovi nel calendario della casa, promemoria degli eventi, riepilogo
  del mattino; vedi «Notifiche» sotto.
- `prodotto` (callable, `{ ean, aggiorna?, scansione? }`): scheda di un prodotto dal codice a barre, vedi «Prodotti» sotto. Con `scansione` la mette nella cronologia della casa (`scansioni`, `src/prodotti/scansioni.js`).
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

**Secondo confronto** (31/10, Belle Buone sesamo e mais, Yuka 57 / D&D 30). La scheda OFF non ha nome né ingredienti
(additivi, NOVA e bio ignoti): l'indice parziale è il solo Nutri-Score, D = 30. I valori per 100 g coincidono con Yuka.
Ricostruzione: Nutri-Score 2017 (Yuka) = 12 punti negativi (energia 6, zuccheri 0, saturi 2, sodio 4) − 5 (fibre) = 7, C;
nutrizione di Yuka 80 − 5 × 7 = 45, più 30 per due additivi senza rischio = 57. Nutri-Score 2023 (OFF) = 14 negativi
(energia 6, zuccheri 1, saturi 2, sale 5) − 3 (fibre; le proteine non contano con 11 negativi o più) = 11, D al primo punto.
Quindi: −27 dai dati mancanti su OFF (Yuka ha gli ingredienti), il resto dalla versione del Nutri-Score (2023 più severa su
sale e zuccheri, meno generosa sulle fibre) e dalla conversione a gradini della lettera. Con gli ingredienti su OFF
(due additivi innocui, NOVA 3) l'indice sarebbe ~49.

**Scheda come in Yuka** (31/10, richiesta di Mattia; `components/prodotto.js`): dopo il nome (con la foglia verde se bio,
nessuna riga) le sezioni «Positivo» e «Negativo» per 100 g (100 ml se `bevanda`), una riga per valore con frase e pallino
di quattro livelli (1 verde, 2 verdolino, 3 arancio, 4 rosso del Nutri-Score) e la scala al tocco; poi «Tutti i valori»,
Additivi (pallino del rischio EFSA, grigio = non valutato), Trasformazione (NOVA con i quattro gruppi spiegati e gli
ingredienti che hanno deciso il gruppo, `novaMarcatori` da `nova_groups_markers`). Il Nutri-Score non si mostra (31/10,
Mattia: «non mi interessa»; tolta la sezione con la scala A–E) ma resta la componente nutrizionale dell'indice.

**Cosmetici** (31/10, sera, richiesta di Mattia). La stessa scansione: OFF con `product_type=all` rinvia un cosmetico a
Open Beauty Facts (stessa API, ODbL), e `normalizza` lo passa a `normalizzaCosmetico` (`product_type` «beauty»), che legge la
lista INCI (`ingredients_text*`: virgole, non quella tra due cifre; note a piè di lista scartate) e valuta ogni ingrediente
con `functions/src/prodotti/cosmetici.js`. OBF non dà valutazioni dei rischi; Yuka usa una sua banca dati (~12.500
ingredienti, rivista da una tossicologa) e decide il voto dall'ingrediente peggiore (rosso → sotto 25, arancio → sotto 50).
Noi lo stesso metodo su liste pubbliche:
- alto: interferenti endocrini riconosciuti dall'UE (ECHA, SVHC per interferenza endocrina: butylparaben 2020, 4-MBC 2022,
  poi vietato nei cosmetici, reg. 2024/996), ingredienti vietati (Lilial dal 2022, Lyral dal 2021), benzophenone (CMR);
- moderato: gruppo A della lista di priorità della Commissione sui possibili interferenti endocrini nei cosmetici (2019:
  benzophenone-3, propylparaben, resorcinol, octocrylene, homosalate, kojic acid, triclosan, triclocarban, BHT, benzyl
  salicylate, genistein, daidzein);
- basso: gruppo B della stessa lista (methylparaben, octinoxate, benzophenone-1/2/4/5, BHA, triphenyl phosphate, salicylic
  acid, D5, cyclomethicone, deltamethrin) e allergeni delle fragranze del reg. UE 2023/1545 (24 storici e 58 aggiunti; gli
  oli vegetali per genere e specie, non le acque floreali).
Voto 100 − 30 per alto, −15 per moderato, −4 per basso; al più 24 con un alto, 49 con un moderato; senza ingredienti niente
voto. Il «parfum» non conta: non è in nessuna lista (Yuka lo segnala). La scheda lo dice: le liste segnalano sostanze
sospette o allergeniche, non il rischio alle dosi d'uso, che il reg. (CE) 1223/2009 già limita. I nomi INCI sono verificati
sulla tassonomia CosIng di OBF (`taxonomies/beauty/ingredients-cosing-obf.txt` su GitHub). Le liste vanno aggiornate a mano
quando la Commissione o l'ECHA decidono (es. resorcinol, proposto come interferente endocrino dalla Francia nel 2025).

**Completa su Open Food Facts** (1/11, richiesta di Mattia). Una scheda che non c'è, o senza nome, ingredienti o (per gli
alimenti) valori nutrizionali, ha in cima «Completa la scheda» / «Aggiungilo a Open Food Facts» (`daCompletare` in
prodotto.js, flusso in `components/contributo.js`, function `contribuisci`, logica in `functions/src/prodotti/contributo.js`):
1. foto con la fotocamera dentro l'app: fronte, ingredienti, valori nutrizionali (due per un cosmetico già noto); «Salta» per
   quella che non c'è. ImageCapture (scatto con la messa a fuoco) dove c'è, altrimenti il fotogramma; lato lungo 2000 px, JPEG.
2. `contribuisci leggi`: Claude (Sonnet) legge le foto con istruzioni strette (solo ciò che si legge, valori solo per 100 g o
   100 ml, nota se c'è un dubbio); in parallelo il server rilegge il prodotto su OFF e dice quali campi mancano (`mancanti`).
3. «Da aggiungere»: solo i campi mancanti, già compilati e correggibili; i valori come la tabella dell'etichetta (una riga
   per valore, «di cui» rientrati, cifre e unità allineate a destra); la prima volta nome utente e password di OFF.
4. `contribuisci invia`: `product_jqm2.pl` con i soli campi mancanti (`campiOff`: niente sovrascritture), poi le foto con
   `product_image_upload.pl`; account dell'utente, `app_name`, `app_version`, `app_uuid` (sha256 dell'uid con un sale) e
   `comment`, come OFF chiede alle app che scrivono. Un errore sui campi ferma tutto, una foto rifiutata è un avviso.
   L'account si salva in `off_account/{uid}` (regole: nessun accesso dall'app) solo dopo una scrittura riuscita; se OFF lo
   rifiuta l'app torna al riepilogo a chiederlo. Poi rilettura da OFF e cache `prodotti/{ean}`: la scheda nuova compare subito.
   1/11, primo contributo vero (Canestrellini): scrittura riuscita, ma la rilettura ha dato la scheda di prima (stessa URL
   letta un minuto prima: una cache davanti all'API) ed è finita in cache per un mese. Ora le letture dopo una scrittura e
   «Rileggi» sono «fresche» (`leggiOff(ean, { fresco: true })`: parametro `_` in più e `Cache-Control: no-cache`); la
   rilettura riprova fino a ~10 s finché `last_modified_t` non è più recente di quello di prima; se no la cache prende
   `rileggere: { prima, dal }`, la function `prodotto` la rilegge fresca a ogni apertura per un giorno, e la scheda arriva
   con `inAggiornamento`: in cima la riga «Contributo inviato · La scheda si aggiorna da sola tra poco» con l'anello che
   gira, senza «Completa» (rimanderebbe gli stessi dati); l'app richiama `prodotto` con `aggiorna` dopo 3, 4, 5, 6, 8 e
   10 s e, quando la scheda non è più `inAggiornamento`, la mette al posto di questa; se no la riga diventa «tocca per
   riprovare». «Rileggi» sta nella barra in basso del foglio (↻ accanto a «Da comprare»), non più in fondo alla scheda.
I cosmetici vanno su Open Beauty Facts (stessi account). Costo: una lettura di Sonnet con tre immagini, ~1–2 centesimi.
Soglie nostre, dichiarate nel codice: zuccheri, saturi e sale tra «basso» e «alto» del semaforo britannico (FSA 2016,
come i `nutrient_levels` di OFF) con la fascia media divisa a metà, «senza» dal reg. UE 1924/2006; energia dove il
Nutri-Score dà 2, 4½ e 7 punti (160, 360, 560 kcal; bevande 21, 54, 72); fibre 3 e 6 g (reg. 1924/2006), proteine 4 e 8 g,
frutta e verdura 40 e 80%. Sono solo lettura: l'indice non cambia. Le schede in cache prima del 31/10 non hanno
`bevanda`, frutta e marcatori: `VERSIONE_SCHEDA` in off.js le fa rileggere da OFF alla prossima apertura (se OFF non
risponde, resta la cache).

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
  gli eventi. Uno dei due sceglie quale dei suoi calendari è quello della casa (`households.calendario`) e lo condivide
  con l'altro da Google Calendar; ciascuno lo legge e ci scrive con il proprio permesso. Accanto, ognuno può vedere
  altri suoi calendari (`users.calendari`, dal 1/11: il personale, la band, l'associazione), ciascuno con un colore.
  Chi vede e chi modifica cosa lo decide Google, l'app non ha permessi suoi: un calendario dell'uno compare all'altra
  solo se lui glielo condivide su Google Calendar, e lei lo sceglie a sua volta. Nell'app si scrive nel calendario
  della casa e nel calendario principale dell'account (`modificabile`); gli altri, gestiti anche da altre persone, si
  leggono e si aprono in Google, anche dove Google permetterebbe di scrivere (così non si tocca per sbaglio il
  calendario della band). Un invito (evento il cui `organizer.self` manca) si legge soltanto. La scelta sta nel foglio
  «Calendari» (testata della pagina Calendario, o pagina Google → Calendario). La pagina Calendario è un'agenda dei
  prossimi 60 giorni di tutti i calendari, letti insieme (ricorrenze espanse con `singleEvents`; uno che non risponde
  non ferma gli altri e la pagina dice quale), con pillole per vederne uno solo; un evento che non è della casa porta
  il nome del suo calendario nel suo colore. Lo stesso evento in due calendari (un concerto della band a cui si è
  invitati, che compare anche nel personale) si mostra una volta, dal calendario a cui appartiene. Il + apre un evento
  nuovo (calendario, giorno, tutto il giorno o con orario, luogo, note), scritto subito su Google; un evento
  modificabile si modifica, si sposta tra la casa e il personale (`move` di Google) e si elimina dal suo foglio. In cima
  al Diario, «Prossimi giorni» mostra gli eventi di oggi e dei due giorni dopo da tutti i calendari, dalla stessa
  lettura. L'ultima lettura resta anche nel localStorage del telefono, solo come anteprima all'apertura (scollegando
  Google si cancella). L'agente propone eventi dalle note (`event`), che si scrivono solo con la spunta e vanno nel
  calendario della casa. Letture e scritture passano dal telefono; il server non tocca il calendario.
- **Drive** (`core/drive.js`, `components/documenti.js`): dal foglio di un progetto o di una voce del manuale si cercano
  file per nome in tutto il Drive dell'utente (anche nei Drive condivisi) e si collegano (`documenti`). Per un progetto
  con istruzioni, il server legge il testo dei documenti collegati con il permesso dell'utente (`tokenServer` in
  account.js, `functions/src/google/drive.js`: Documenti, Fogli e Presentazioni esportati come testo, file di testo
  così come sono, fino a 6 documenti, 6000 caratteri l'uno e 20000 in tutto) e li dà all'agente come contesto della
  nota; i PDF (dal 14/11, fino a 10 MB) li trascrive Claude Haiku una volta per versione del file (`drive_testi`), gli altri
  formati si elencano solo per nome. Nel manuale i documenti servono a ritrovare contratti e
  garanzie con un tocco. Una ricerca libera dell'agente su tutto il Drive non c'è: su un Drive intero la rilevanza per
  parole chiave è troppo rumorosa per finire nel prompt senza una scelta dell'utente.

## Integrazioni previste

- **Note vocali** del diario (27/10): il telefono registra (components/registratore.js), la function `trascrivi` manda l'audio
  a Gemini con il vocabolario del progetto e della rubrica (src/trascrizione.js) e restituisce il testo, che entra nel campo
  della nota; poi tutto come una nota scritta. Claude non accetta audio. Sul server l'audio non viene salvato.
  **A pezzi, dal 14/11** (Mattia: «non vedo quello che sto trascrivendo» e «se blocco lo schermo non registra»): il registratore
  ascolta il livello della voce (AudioContext) e taglia nelle pause (al primo silenzio di 0,6 s dopo 6 s, al più tardi a 30 s
  appena la voce cala, comunque a 45 s; in secondo piano solo a tempo), con il registratore del pezzo nuovo avviato prima di
  fermare il vecchio. Ogni pezzo va a `trascrivi` subito, in ordine, con la fine del testo già trascritto (`prima`), e il testo
  entra nel campo a ogni pausa; una pausa lunga (oltre 2,2 s) va a capo. Audio (un blob al secondo) e testo stanno nell'archivio
  del telefono (IndexedDB, core/archivio.js) finché la nota non è salvata: un pezzo la cui risposta si perde si riprova da solo
  (subito al ritorno nell'app o in rete); se l'app si chiude o il foglio si chiude senza salvare, il Diario mostra in cima
  «Nota vocale da salvare» e riapre la nota col testo, trascrivendo il resto. Se il telefono smette di dare audio (traccia
  muta: schermo spento, chiamata) lo si dice al ritorno. Non parola per parola: il riconoscimento del telefono (Web Speech)
  su Android si contende il microfono con la registrazione, e Gemini sul pezzo intero scrive meglio nomi e termini.
- **Notifiche push** (FCM): fatte (vedi «Notifiche»).
- **Condivisione verso l'app** (manifest → `share_target`, dal 14/11 in POST con le immagini): `sw.js` riceve `/condividi`,
  mette le immagini nella cache `dd-condivisi` e apre `/?share=1&text=…&foto=1`; il Diario apre una nota nuova con il testo e
  le foto, e l'agente le legge (scontrini, biglietti da visita, screenshot). Solo immagini: un PDF condiviso non passa.
- **Scorciatoie dell'icona** (manifest → `shortcuts`, 14/11): tenendo premuta l'icona, «Nota vocale» (`#/diario/vocale`, registra
  subito), «Lista» (`#/lista/nuova`), «Scansiona» (`#/lista/scansiona`), «Chiedi» (`#/chiedi/nuova`). Icone 96 px in `icons/`,
  disegnate dalle icone a linea dell'app su fondo inchiostro. Android le aggiorna con il WebAPK (vedi Stato in CLAUDE.md).

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
- **Dall'altra persona, subito** (`avvisa`): `core/db.js` segnala le scritture condivise che possono interessare
  l'altra persona: creazione di spese, task e voci della lista; task segnato fatto; voce rimessa in lista; spesa
  modificata dal suo foglio (con i campi di prima: la notifica dice cosa è cambiato, «45,00 € (era 40,00 €)», e
  niente se non è cambiato nulla) o eliminata (con una copia ridotta, perché il server non la trova più; si annuncia
  solo se il documento non esiste davvero più). La lista aspetta 1,5 s e manda una chiamata sola per più voci di
  seguito. Il server rilegge il documento e decide: solo documenti `shared` della casa di chi chiama, niente spese
  ricorrenti nuove (le genera il primo telefono che si apre), mai a chi ha fatto la cosa.
  Si è scelta la chiamata dall'app invece dei trigger di Firestore per non introdurre Eventarc (e i permessi
  IAM che il deploy dovrebbe concedere): il prezzo è che una scrittura fatta senza rete avvisa solo se l'app
  è ancora aperta quando la scrittura arriva al server.
- **A orario** (`giroAvvisi`, ogni 5 minuti, `src/avvisi-calendario.js`). Gli eventi stanno solo su Google Calendar,
  quindi il server li legge con il permesso Google di ciascuno (`tokenServer`, lo stesso con cui l'agente legge Drive):
  - *Eventi nuovi nel calendario della casa*, a chi non li ha creati: eventi con `created` dopo l'ultimo giro
    (`updatedMin`), creatore riconosciuto da `creator.email` = `users.google.email`. Anche quelli aggiunti da Google
    Calendar, con al più 5 minuti di ritardo. Modifiche ed eliminazioni no: Google non dice chi le ha fatte.
  - *Promemoria* degli eventi con orario dei calendari che la persona vede (la casa + `users.calendari`), `anticipo`
    minuti prima (predefinito 60), con la lettura del suo account. Si salta un evento per cui Google Calendar avvisa già
    quella persona (promemoria «popup» dell'evento, o i predefiniti del calendario nella sua `calendarList`): due avvisi
    per la stessa cosa sarebbero rumore. Eventi rifiutati e di un giorno intero no (questi stanno nel riepilogo).
  - *Riepilogo del mattino* alle 7:30 (primo giro dopo, al più fino alle 10:30; una transazione su `avvisi_stato` lo
    manda una volta): eventi di oggi, task con scadenza oggi o passata (condivisi e propri), banca (spese da confermare,
    collegamento interrotto, consenso entro 14 giorni). Niente se non c'è niente. Chi lo spegne riceve la banca come
    prima (`syncBank`) e il consenso in scadenza a parte, a 14, 7, 3, 1 e 0 giorni.
  - *Google scollegato*: se il permesso è stato ritirato (`invalid_grant`; in modalità di test della schermata di consenso
    OAuth succede dopo 7 giorni), una notifica una volta, a prescindere dalle categorie.
- **Fine analisi del diario** (`analyzeEntry` → `fineAnalisi`): il server segna la nota come letta (anche con l'app chiusa) e,
  se l'app ha scritto `avvisaAFine: true` passando in secondo piano mentre aspettava, avvisa chi l'ha scritta (proposte da
  confermare, riepilogo pronto, o l'errore). Si è scelto il segno nella nota invece di mandare sempre e lasciar decidere
  `sw.js`: un push che non mostra nulla Chrome lo tollera solo con l'app in primo piano, Safari su iPhone no (ritira l'iscrizione).
- **Cosa**: messaggio di soli dati `{ titolo, testo, url, tag, silenzioso }`, disegnato da `sw.js`; il tocco apre la pagina
  (`url`). Stesso `tag` = la notifica si sostituisce: la lista ha un tag solo e riassume le cose aggiunte dalla
  stessa persona nell'ultima mezz'ora ancora da comprare; una spesa modificata sostituisce la notifica della stessa spesa.
  Un promemoria scade (TTL) all'inizio dell'evento: se il telefono era spento, non arriva dopo.
- **Di notte** (22:30–7:30, ora di Roma, `SILENZIO` in avvisi.js): il server aggiunge `silenzioso` e `sw.js` mostra la notifica con
  `silent` (niente suono né vibrazione), salvo `users.notifiche.silenzio === false`.
- **Preferenze**: `users/{uid}.notifiche.<spese|task|lista|calendario|promemoria|riepilogo|diario|banca>`, `anticipo`, `silenzio`,
  per persona (pagina Notifiche: «Dall'altra persona» e «Per te»). Prova senza rete (anche Google Calendar finto):
  `node functions/strumenti/prova-avvisi.mjs`.
- **Costi**: lavori di Cloud Scheduler `syncBank` e `giroAvvisi` (con `revisioneSettimana` e, dal 14/11, `backupSettimanale` sono quattro: tre gratuiti per account di fatturazione, il quarto 0,10 $ al mese);
  ogni giro legge il documento della casa, i due profili e lo stato (~1.200 letture al giorno), qualche chiamata a Calendar.

## Prove e pubblicazione

Ogni push su `main` passa da `.github/workflows/deploy.yml`, che prima chiama `.github/workflows/prove.yml` e pubblica
solo se il job `prove` è passato (`needs`). Un'esecuzione alla volta (`concurrency: deploy-firebase`): un commit vecchio
non si pubblica mai dopo uno nuovo; con più push ravvicinati resta in coda solo l'ultimo.
- **Functions** (`functions/strumenti/prova-*.mjs`, senza rete): banca, avvisi, prodotti, Chiedi, contributo a OFF.
- **Regole di Firestore** (`prove/regole/prova-regole.mjs`): `@firebase/rules-unit-testing` sull'emulatore vero, avviato da
  `firebase emulators:exec` con un progetto `demo-macroapp` (l'emulatore non parla con il progetto vero). Due case (A con due
  membri, B con uno) e una terza casa del primo membro: una casa non legge né scrive le cose dell'altra; i documenti privati
  non si vedono, non si modificano e non si cercano dall'altro membro; le note e le foto condivise le modificano ed eliminano
  tutti e due, ma nessuno cambia `ownerUid` o `householdId` (nemmeno verso una casa propria) e la visibilità la cambia solo chi
  ha scritto; `off_account`, `google_tokens`, `avvisi_stato`, `drive_testi` chiusi all'app; `consumi` letti solo dal
  proprietario (anche un mese senza documento) e mai scritti; `domande` solo del proprietario e sempre private.
  Versioni fissate in `prove/regole/package.json` (firebase-tools compreso), Java 21 per l'emulatore.
- **App** (`prove/costruisci.py` + `prove/prova.py`): il flusso completo in Chromium con il Firebase finto; esce con 1 se uno
  step si ferma o se la pagina ha un errore non gestito o un `console.error`.
Se una prova non passa, le schermate di `prove/_schermate` vanno nell'artifact `schermate` dell'esecuzione (7 giorni; il
repository è pubblico, ma le schermate mostrano solo i dati finti delle prove). In emergenza il deploy si lancia a mano con
«Emergenza: pubblica senza prove» (`senza_prove`): il job delle prove risulta saltato e il deploy lo segnala con un avviso.
Sugli altri rami `prove.yml` gira da solo a ogni push: una modifica si prova su GitHub prima di portarla su `main`.

## Backup

**Cosa** (14/11). La funzione programmata `backupSettimanale` (functions/src/backup.js), il lunedì alle 3:17 ora di Roma, fa un
export gestito di Firestore (`exportDocuments`) di tutte le collezioni nel bucket `gs://macroapp-b9bd0-backup`, una cartella
per volta con data e ora (`2026-11-16-0317`). Dettagli:
- le collezioni si nominano una per una (`collectionIds`, lette con `listCollections()`: sono tutte al primo livello): solo così
  dal backup se ne può ripristinare una sola;
- l'export è una fotografia coerente di un minuto prima (`snapshotTime`: Firestore tiene un'ora di versioni anche senza PITR);
- la funzione aspetta la fine (fino a 7 minuti) e scrive nel registro «backup riuscito: N documenti, X byte» o l'errore;
- dentro c'è tutto il database, compresi i permessi di Google (`google_tokens`), l'account di Open Food Facts e i collegamenti
  della banca: il bucket non è pubblico (accesso uniforme, prevenzione dell'accesso pubblico) e lo leggono solo i proprietari
  del progetto e i service account a cui il deploy lo dà. I dati non escono dal progetto.

**Preparazione** (deploy.yml, passo «Backup», ripetuto a ogni deploy e innocuo): crea il bucket nella zona del database
(`eur3` → `EU`, `nam5` → `US`, altrimenti la stessa regione), con la regola di ciclo di vita che cancella gli oggetti dopo 56
giorni (8 settimane: restano circa otto backup; Cloud Storage tiene poi per 7 giorni gli oggetti cancellati, «eliminazione
temporanea» predefinita); dà `roles/datastore.importExportAdmin` sul progetto al service account delle functions
(`<numero>-compute@developer.gserviceaccount.com`) e a quello del deploy (per il flusso Ripristino), e `roles/storage.admin`
sul solo bucket a loro e all'agente di servizio di Firestore (`service-<numero>@gcp-sa-firestore.iam.gserviceaccount.com`).
Se un permesso non si può dare da GitHub (il service account del deploy non può cambiare l'IAM del progetto), il deploy
lascia un avviso con il passo da fare nella console e va avanti.

**Costi**: l'export si paga come una lettura per documento (qualche migliaio: frazioni di centesimo); il bucket costa circa
2 centesimi di dollaro al GB al mese, per otto copie; il lavoro di Cloud Scheduler è il quarto (`syncBank`, `giroAvvisi`,
`revisioneSettimana`, `backupSettimanale`) e i gratuiti sono tre per account di fatturazione: 0,10 $ al mese.

**Controllo**: Diagnosi con `backup` (`-f 'inputs[backup]=true'`): data dell'ultimo backup riuscito (la cartella più recente
con il file `.overall_export_metadata`, che Firestore scrive solo a export finito; oltre 8 giorni è un errore), backup nel
bucket, spazio, conservazione, zona, stato del PITR, ultime operazioni di export e import. Con anche `backupora` fa un backup
subito (lancia il lavoro di Cloud Scheduler) e ne aspetta la fine.

### Ripristino

Tutto da GitHub, senza terminale: **Actions → Ripristino → Run workflow** (`.github/workflows/ripristino.yml`).

1. **Scegli il backup**: quello dell'ultimo lunedì prima del guaio. I nomi stanno nella Diagnosi con `backup` (o in Cloud
   Storage → `macroapp-b9bd0-backup`). Campo `backup`: la cartella, o `ultimo`. In alternativa `momento`, «com'era il database
   alle 21:00 di ieri» (ora di Roma): il flusso esporta lì per lì il database a quel minuto e usa quella copia
   (`momento-…`); senza PITR funziona solo per l'ultima ora.
2. **Scegli cosa**: `collezioni` vuoto = tutte quelle del backup; altrimenti i nomi separati da virgole, per esempio
   `journal_entries,journal_photos` (le note e le loro foto vanno insieme), `expenses,recurring_expenses`, `tasks,projects`.
3. **Prova prima** (`destinazione` = `prova`, predefinita): il backup va in un database temporaneo `ripristino-<numero>`
   dello stesso progetto, il flusso conta i documenti per collezione accanto a quelli del database vero (annotazione
   «Ripristino di prova riuscito», solo nomi e numeri) ed elimina il database temporaneo. I dati veri non si toccano.
   Le differenze nei numeri sono le modifiche fatte dopo il backup.
4. **Ripristina** (`destinazione` = `produzione`, `conferma` = `RIPRISTINA`), meglio con l'app chiusa sui due telefoni:
   il flusso salva prima lo stato attuale in `prima-del-ripristino-AAAA-MM-GG-HHMM`, poi importa. Un documento del backup
   sostituisce quello con lo stesso id; un documento nato dopo il backup **resta** (l'import non cancella). Per tornare
   a com'era prima del ripristino: stesso flusso con `backup` = `prima-del-ripristino-…`.
5. **Dopo**: aprire l'app sui due telefoni (le cache locali si riallineano da sole) e controllare la sezione ripristinata.

Dalla console, se GitHub non c'è: Firestore → Importa/Esporta → Importa → sfoglia `macroapp-b9bd0-backup`, la cartella, il
file `….overall_export_metadata` → database `(default)` (o uno nuovo, per provare) → Importa. Così si importa tutto il backup.

Non è nel backup (e non serve): gli eventi (stanno su Google Calendar), i documenti di Drive, il codice (GitHub), i segreti
(Secret Manager), gli account di accesso (Firebase Authentication: se un account venisse eliminato, rientrando con Google
avrebbe un uid nuovo e non vedrebbe più i suoi dati; il caso non è coperto).

Permessi che il flusso usa (service account del deploy): import ed export (`roles/datastore.importExportAdmin`, dato dal
deploy), creazione ed eliminazione di un database (se manca, l'annotazione dice di dare «Proprietario Cloud Datastore» a
github-deploy dalla console).

### Ripristino a un momento passato (PITR): valutato, non attivo

Firestore può tenere per 7 giorni una versione al minuto di ogni documento (`gcloud firestore databases update
--database='(default)' --enable-pitr`). Vantaggi: il backup settimanale può perdere fino a 7 giorni di modifiche, il PITR
nessuna (si torna al minuto prima del guaio, con il campo `momento` del flusso Ripristino); si recupera una sola nota
cancellata leggendola com'era, senza ripristinare altro. Costo: si paga lo spazio delle versioni (per un database che cambia
poco, circa quanto il database stesso) al prezzo dello spazio di Firestore, senza la quota gratuita: per un database di
qualche decina di MB, uno o due centesimi di dollaro al mese; le letture delle versioni passate si pagano come letture.
Limiti: 7 giorni soltanto e dentro lo stesso database (non sostituisce il backup nel bucket). Si spegne quando si vuole.
Decisione a Mattia (14/11).
