# Ispirazione da un gestionale esterno

Brief per una sessione che legge un altro repository (un gestionale) **in sola lettura** e scrive qui, nella sezione
Risultati, le idee utili per D&D. Quella sessione non modifica altri file di macroapp: fa un solo commit, su questo file.

**Questo repo è pubblico**: nei Risultati si scrivono idee, schemi di dati e comportamenti, in parole proprie. Niente codice
copiato, nomi di organizzazioni o persone, dati, URL interni, chiavi o configurazioni del gestionale.

## Cosa cercare

Per ciascun punto: modello dati (entità, campi, relazioni), come si presenta nell'interfaccia, logica dietro
(automatismi, ricerche, AI), e cosa conviene riprendere in D&D rispettando CLAUDE.md (design, conferma delle azioni dell'AI).

1. **Persone collegate a tutto**: una persona legata ad azioni/task, progetti, documenti e note; la pagina di una persona
   con tutto ciò che la riguarda.
2. **Ricerca di bonus, bandi e incentivi**: fonti, frequenza, filtri (requisiti, scadenze, enti), come i risultati diventano
   schede o promemoria. In D&D servirebbe per le associazioni di volontariato di Mattia.
3. **Biblioteca di documenti di riferimento**: organizzazione (categorie, etichette, collegamenti a progetti e persone), dove
   stanno i file, come si cercano.
4. **Contatti con informazioni in più**: campi oltre a quelli classici (ruolo, organizzazione, relazioni, storico, note),
   convivenza con Google Contatti.

## Cosa c'è già in D&D

- Note del Diario con `persone` taggate (titolo e persone dall'agente); toccare una persona porta alle sue note.
- Rubrica nel Manuale (voci `person`, collegate a Google Contatti con `googleId`).
- Documenti di Drive collegati a mano a progetti e voci del manuale.
- In programma (21/11): una cartella Drive per progetto, dove l'app scrive (copia leggibile, documenti nuovi, allegati) e
  da cui legge le novità; poi un connettore MCP perché la chat legga e scriva il database.

## Risultati

Letto il 21/11, in sola lettura, sulla versione del gestionale in produzione e sui suoi documenti di lavoro. Per ogni
punto: come lo fa il gestionale (dati, interfaccia, logica, limiti che dichiara lui stesso), poi cosa conviene a D&D. Sono
proposte: niente è costruito, e prima di costruire va deciso con Mattia.

**In breve.** Su bandi e biblioteca il gestionale è più avanti di D&D. Ha un vero radar dei bandi, con fonti, doppioni e
giudizio delle persone, e un'AI che impara da quei giudizi. Ha anche schede dei documenti che l'AI compila e una persona
conferma. Su persone e contatti è più indietro: i colleghi non hanno una pagina, i contatti sono schede semplici e con
Google Contatti non c'è nessun legame. Da lì conviene prendere soprattutto i comportamenti, più che gli schemi dei dati:
il controllo dei doppioni, la scheda con la storia, l'AI che compila un modulo normale e la lettura una sola volta per
ogni versione di un documento.

### 1. Persone collegate a tutto

**Nel gestionale**

- **Tre archivi di persone separati**, ciascuno con la sua chiave: colleghi (l'email), contatti esterni (un id),
  collaboratori esterni (un id). Gli archivi non si confrontano tra loro: la stessa persona può stare in due senza che
  l'app se ne accorga.
- **I legami salvano l'identificativo, non il nome**: il nome si ricava quando lo si mostra. Si copia solo dove serve:
  - perché lo veda chi non può leggere l'originale;
  - perché sopravviva a una cancellazione (le note tengono il nome del contatto).
  Quando l'originale cambia nome, una funzione del server aggiorna le copie.
- **Note**: una nota si lega a più cose insieme, con un elenco di `{ tipo, id, nome }` (contatto, opportunità, progetto).
  I colleghi però non si possono taggare in una nota.
- **Task**: possono avere più assegnatari, salvati come elenco di email. Il primo è quello il cui Google Tasks resta
  allineato. Chi è assegnato a un task diventa anche uno di quelli che possono leggerlo.
- **Scheda del contatto esterno**, dall'alto in basso:
  - i dati;
  - le opportunità collegate;
  - un bottone «Annota», che apre l'assistente con il contatto già collegato;
  - una riga per scrivere una nota veloce;
  - la cronologia delle note, dalla più recente, con data, autore e pillole verso le altre cose collegate.
  Non mostra progetti né task.
- **Scheda del collaboratore esterno**: elenca le collaborazioni registrate (i costi collegati a lui), ognuna con il
  rimando al suo progetto.
- **Colleghi senza pagina**: il nome di un collega non si può toccare. L'unico posto che raccoglie tutto è la home «Oggi»,
  e solo per chi la apre: i miei task, le scadenze dei miei progetti, il mio carico dei prossimi tre mesi, ciò che devo
  ancora completare. Una bacheca della persona è stata decisa, ma cosa debba contenere è ancora aperto.
- **Scelta delle persone nei moduli**: ricerca mentre si scrive. Una volta scelta la persona, l'icona del campo diventa
  le sue iniziali; se le persone sono più d'una compaiono come pillole con le iniziali.
- **Logica**:
  - chi entra per la prima volta viene aggiunto alle persone;
  - l'AI che legge una nota riceve l'elenco dei contatti, sfoltito con le parole della nota quando supera i 200. Per ogni
    persona nominata risponde con l'id di un contatto esistente oppure con «nuovo»;
  - **l'app poi corregge l'AI**: un «nuovo» che ha lo stesso nome normalizzato di un contatto esistente diventa quel
    contatto. Un nome solo simile si propone senza spunta, con «Forse c'è già»;
  - per assegnare un task, la persona citata si riconosce dal nome completo o dall'email. Basta il solo nome di battesimo
    solo se nessun altro si chiama così;
  - i nomi di contatti e colleghi vanno alla trascrizione come vocabolario.
- **Limiti** (visti nel codice o scritti nei suoi documenti):
  - l'app carica solo le ultime 500 note, quindi la cronologia di un contatto perde in silenzio le più vecchie;
  - un'opportunità ha una sola persona di riferimento;
  - cosa fare di chi lascia l'organizzazione (uno stato «non più attiva») non è deciso.

**Per D&D**

I pezzi ci sono già: note con `persone` (`voceId`, `googleId` o il nome), task con `peopleIds`, voci `person` con
`documenti`, «Note con …» dalla voce della rubrica (`mostraNoteDi`). Manca un posto che li metta insieme.

- **Scheda della persona.** È il foglio della voce in rubrica, o del contatto Google che in rubrica non c'è. Sotto i dati,
  una riga a filetti per ogni tipo di cosa:
  - Note: quante sono e l'ultima; toccandola si apre il Diario filtrato, come oggi;
  - Da fare: i task aperti con lei, poi quelli fatti di recente;
  - Progetti: quelli delle sue note e dei suoi task, ricavati al momento e non salvati;
  - Documenti: quelli della voce e, quando ci sarà la biblioteca (punto 3), quelli che la riguardano;
  - Calendario: i prossimi eventi che la nominano nel titolo. Gli eventi tenuti in memoria oggi non portano gli invitati:
    per abbinarli a una persona bisognerebbe leggerli.

  Tutto si calcola nel telefono da ciò che è già in memoria, senza collezioni nuove né copie. Una riga compare solo se ha
  qualcosa: niente «Nessun task». Valgono le regole già in vigore: niente «vuoto» prima che arrivino i dati, e la pagina
  non compare a pezzi (`attesa`).
- **Annota dalla persona.** Nel foglio della persona, il + in basso a destra apre una nota nuova con la persona già tra le
  `persone`, come «Annota» nel gestionale. Lo stesso per un task nuovo, con `peopleIds` già compilato.
- **Una sola regola per dire «è la stessa persona»**, uguale per note, task ed eventi: prima la voce, poi il contatto
  Google, poi il nome normalizzato. C'è già in `notaConPersona` (`core/cerca.js`): la scheda e l'abbinamento dell'agente
  la riusano, senza riscriverla.
- **Rete di sicurezza dopo l'agente**, come nel gestionale. Se l'agente scrive solo il nome, ma il nome normalizzato è
  quello di una voce, l'app (o il server) aggiunge il `voceId`. «Normalizzato» vuol dire senza titoli come «dott.» e con
  le parole in qualunque ordine. Il solo nome di battesimo vale solo se è unico in rubrica.
- **Da non prendere**: i tre archivi separati. In D&D la persona resta una: la voce, collegata se serve a Google.
- **Da decidere**: se una persona nominata che non è in rubrica debba diventare una proposta «Aggiungi in rubrica», senza
  spunta e da confermare. Per la decisione del 29/10 una persona taggata non entra in rubrica da sola. Una proposta da
  confermare la rispetterebbe, ma va chiesto a Mattia.

### 2. Ricerca di bonus, bandi e incentivi

**Nel gestionale (il «radar»)**

*Dati*

- **Fonti**. Per ognuna l'app tiene:
  - nome e livello: prioritaria, secondaria, o «solo segnali» (movimenti di politica senza bandi veri e propri);
  - cosa contiene e l'ambito: UE, Italia, regioni, fondazioni;
  - il modo di accesso: API, pagina web, esportazione a mano;
  - la frequenza (settimanale, mensile, annuale, a richiesta) e lo stato (da attivare, attiva, sospesa);
  - «alternativa di», cioè quale altra fonte sostituisce o completa;
  - quale lettore automatico usare e i termini di ricerca, nella lingua della fonte.

  Lo stato di salute lo scrive il server: ultimo giro, ultimo esito, errori di fila, giri vuoti di fila. Per ogni termine
  segna anche quante voci ha letto, quante nuove e quante già viste.
- **Bandi**. Per ognuno l'app tiene:
  - i dati del bando: titolo, tipo (bando, gara, call, avviso), ente, programma, codice, link, apertura, scadenza,
    importo, sintesi, fonte;
  - il giudizio della persona: da valutare, poi interessa o non interessa, poi passato in opportunità, con un motivo
    facoltativo;
  - la pertinenza dell'AI (alta, media, bassa) con una ragione di poche parole, e un segno quando una persona l'ha
    corretta: da quel momento l'AI non la riscrive più;
  - una chiave per riconoscere i doppioni, il giorno in cui è stato trovato, il segno «prorogato».

  «A che punto è» non si salva: si ricava dalle date (in apertura, aperto, chiuso).
- **Segnali**: notizie senza un bando, con tema, fonte, data, sintesi e «cosa vuol dire per noi».
- **Eventi**: convegni con date, luogo, scadenza dell'iscrizione, lo stesso giudizio dei bandi e «Metti in calendario».
- **Profilo**: uno solo, in testo libero: cosa si cerca, parole chiave, cosa scartare.
- **«Brain»**: una cartella di Drive con i documenti dell'organizzazione.
  - Per ogni documento l'AI propone una scheda di mezza pagina (titolo, tipo, sintesi, temi, parole chiave); una persona
    la corregge e la conferma.
  - Un documento si rilegge solo quando cambia su Drive, al più 6 per giro. Se cambia, la scheda torna «da rivedere» ma
    quella confermata resta valida.
  - Dalle schede confermate l'AI propone indicazioni per il profilo: parole chiave, esclusioni, termini di ricerca in due
    lingue. Anche queste le conferma una persona.

*Raccolta*

- **Quando**: un giro alla settimana, il lunedì mattina. In più c'è «Leggi ora» su una fonte, anche non attiva, per
  provarla, e «Aggiorna» su tutte.
- **Come**: un termine alla volta, e se uno non va gli altri proseguono. Al più 12 termini per fonte e 80 bandi nuovi per
  giro: quelli in più aspettano il giro dopo.
- **Lettori automatici**: solo due, su API pubbliche europee (bandi della Commissione e appalti pubblici), senza AI. Le
  pagine nazionali e regionali si leggono a mano: o non hanno un elenco leggibile, o bloccano le richieste automatiche.
  Un lettore che legga una pagina con l'AI è progettato ma non costruito. Niente newsletter e niente posta.
- **Lezioni scritte**:
  - i termini vanno nella lingua della fonte: con termini in inglese, una fonte italiana non dava niente;
  - le fonti elencano tra gli aperti anche bandi già scaduti, quindi questi si scartano subito, all'ingresso.
- **Doppioni**: la chiave è l'indirizzo della pagina, normalizzato: senza www, senza parametri di tracciamento, senza
  barra finale. Se manca il link, la chiave è titolo + ente + scadenza. Di un bando già visto:
  - se la scadenza è cambiata, la si aggiorna e il bando si segna «prorogato»;
  - i dati che mancavano si copiano;
  - il giudizio di una persona non si tocca mai.
- **Salute delle fonti**: una fonte va «da rivedere» dopo 2 errori di fila, o dopo 4 giri vuoti (prioritaria) o 8
  (secondaria). Le fonti da rivedere stanno in cima all'elenco, con «+ Alternativa».

*Filtro e AI*

- **Solo a richiesta**: la pertinenza dell'AI parte da un bottone, che mostra quanti bandi aspettano. Ne valuta 60 per
  volta, a gruppi di 20, per tenere bassi i costi. Senza profilo non parte; se l'AI non risponde, i bandi entrano lo stesso.
- **Impara per esempi**: insieme ai bandi l'AI riceve il profilo, i titoli delle schede confermate e gli ultimi 20
  giudizi delle persone con i loro motivi e le correzioni fatte a mano. Non c'è nessun addestramento: bastano gli esempi.
- **Testo da fuori**: bandi e documenti arrivano all'AI racchiusi in un contenitore, con l'istruzione di non eseguire ciò
  che contengono. La risposta segue uno schema fisso e viene ripulita.
- **Chi scrive cosa**: i campi dell'AI li scrive solo il server; alle persone le regole permettono solo di confermare.

*Interfaccia*

- **Schede**: bandi, eventi, segnali, fonti e indicazioni, ciascuna con il numero di cose da guardare.
- **Elenco dei bandi**: su telefono una scheda per bando, su computer una tabella. Pillole per il giudizio; tendine con i
  conteggi per «a che punto è», programma, pertinenza, fonte e tipo; la scadenza colorata come un semaforo.
- **Giudizio**: «Interessa» e «Non interessa» si danno con un tocco nella riga, e un secondo tocco lo annulla. Il motivo
  è facoltativo.
- **Passaggio in opportunità**: «Passa in opportunità» apre il modulo già compilato, e il bando cambia stato solo alla
  conferma. «Elimina» toglie in blocco i bandi scaduti che nessuno ha giudicato.
- **Riepilogo del lunedì**: una riga sola, con quanti bandi sono da valutare e quanti sono arrivati in settimana.

*Limiti dichiarati*

- mancano le fonti nazionali, regionali e delle fondazioni;
- la qualità della pertinenza con il modello vero non è stata provata;
- i bandi non hanno promemoria né calendario (gli eventi sì). La scadenza arriva alle persone solo dopo il passaggio in
  opportunità;
- il profilo è solo testo, senza criteri fissi (forma giuridica, territorio, cofinanziamento).

**Per D&D (associazioni di volontariato)**

Il gestionale cerca soprattutto bandi europei. Per le associazioni di Mattia le fonti utili sono quasi tutte pagine e
newsletter italiane: regione, comuni, fondazioni di origine bancaria, centri di servizio per il volontariato, ministeri,
5 per mille. È proprio la parte che il gestionale non ha costruito.

- **Dove**: una pagina «Bandi» nel menu, non nella barra in basso. Ogni associazione è un progetto di D&D, che ha già
  istruzioni, documenti e sintesi. Il bando si lega al progetto e ne prende la visibilità, come le note.
- **Profilo dell'associazione**: oltre al testo libero, pochi campi fissi:
  - forma: ODV, APS, altro ente del Terzo settore;
  - iscrizione al registro del Terzo settore;
  - regione e comune;
  - ordine di grandezza del bilancio;
  - cofinanziamento possibile;
  - temi.

  I campi fissi scartano per primi i bandi a cui l'associazione non può partecipare; l'AI valuta la pertinenza solo dopo.
  Il «Brain», in D&D, c'è quasi già: sono i documenti del progetto (statuto, ultimo bilancio, relazione), che l'agente
  legge già. Il testo dei PDF è già tenuto una volta per versione (`drive_testi`).
- **Collezioni nuove** (quindi regole, indici e casi di prova, regola 4):
  - `bandi_fonti`: come nel gestionale, cioè livello, modo di accesso, frequenza, termini, e stato e salute scritti dal
    server;
  - `bandi`: come nel gestionale, più beneficiari ammessi, territorio, cofinanziamento richiesto, «a sportello» (senza
    scadenza fissa) e `projectId`.

  La chiave dei doppioni si fa come nel gestionale, e il server non tocca mai il giudizio di una persona.
- **Lettore di pagine con Claude**: una function scarica la pagina di una fonte e chiede a Claude di elencarne i bandi in
  uno schema fisso. Lo scaricamento usa le stesse difese del gestionale:
  - solo https;
  - niente indirizzi interni o privati, ricontrollati anche dopo aver tradotto il nome del sito in indirizzo;
  - al più 3 reindirizzamenti, ciascuno ricontrollato;
  - tempo e dimensione massimi;
  - il testo della pagina passato racchiuso, con l'istruzione di non seguirlo.

  Le newsletter che arrivano per posta restano fuori, per la decisione del 14/11 di non leggere le mail.
- **Giro**: settimanale, a un'ora libera come `revisioneSettimana`, più «Leggi ora» su una fonte. Come nel gestionale:
  limiti per giro, bandi scaduti scartati all'ingresso, resoconto per termine.
- **Pertinenza**: all'inizio solo a richiesta, con un modello piccolo, dando come esempi i giudizi passati con i loro
  motivi. I costi stanno nei crediti del piano, ma vanno misurati in `consumi`.
- **Scadenze: qui D&D può fare meglio del gestionale.**
  - Toccando «Interessa», l'app propone (da confermare, regola 5) un task «Preparare la domanda per …», con `due` qualche
    giorno prima della scadenza, e un evento di tutto il giorno alla scadenza nel calendario scelto. L'evento porta con sé
    i promemoria che D&D manda già (`giroAvvisi`).
  - Vale anche al contrario: se in una nota del Diario c'è il link a un bando, l'agente propone «Aggiungi ai bandi».
- **Interfaccia**, con la grammatica di D&D:
  - righe a filetti, con pillole Da valutare / Interessa / Scartati;
  - la scadenza in evidenza, con i giorni che mancano;
  - un foglio a tutta altezza per ogni bando, con «Interessa» in basso a destra;
  - il + per aggiungere un bando a mano o da un link: Claude legge la pagina e compila il foglio, la persona salva.
- **Chiedi** potrebbe avere uno strumento di sola lettura sui bandi («ci sono bandi per … che scadono entro marzo?»). Lo
  stesso per il connettore MCP in programma.
- **Da decidere con Mattia**:
  - quali associazioni e quali territori;
  - quali fonti segue già: sono il punto di partenza dell'elenco;
  - se servono anche i bonus della casa. La struttura sarebbe la stessa, con un campo «per chi»: un'associazione o la
    casa;
  - se la pertinenza gira da sola nel giro settimanale o solo a richiesta.

### 3. Biblioteca di documenti di riferimento

**Nel gestionale**

- **La scheda è un link, mai il file.** Contiene:
  - titolo e tipo: sei tipi fissi, ciascuno con una descrizione che serve anche all'AI;
  - autore, ente, anno;
  - link al file, nome del file, link alla pagina web;
  - etichette libere e uso (interno o pubblico);
  - sintesi e «perché è importante»;
  - il collegamento a un progetto o a un'opportunità (solo l'id) e chi l'ha aggiunta.

  Non c'è nessun collegamento a persone oltre a chi l'ha aggiunta.
- **I file stanno su Drive.** Quelli caricati dall'app finiscono in una cartella fissa della biblioteca, caricati con il
  collegamento a Google della persona. A parte ci sono le cartelle per progetto, create dal server con sottocartelle e un
  documento di appunti; chi entra nel gruppo di un progetto ne riceve l'accesso.
- **Chi vede cosa**: le schede le leggono tutti. Le modifica chi le ha aggiunte o chi ha un ruolo.
- **Interfaccia, come un'app di libri**:
  - in cima una fila che scorre di lato con gli ultimi arrivi, poi una fila per tipo con «Vedi tutte»;
  - pillole per tipo, con i conteggi;
  - con una ricerca o un filtro le file diventano una griglia di copertine. Ogni copertina mostra tipo, titolo,
    autore · ente · anno, la riga del «perché» e al più tre etichette;
  - la scheda aperta mostra sintesi, «perché», uso, etichette e progetto, con «Apri il file» e «Pagina web».
- **Ricerca**: nel telefono, senza badare agli accenti, su titolo, autore, ente, etichette, sintesi, «perché» e progetto.
  Nella ricerca generale conta di più il titolo, soprattutto il suo inizio.
- **L'AI non usa la biblioteca** per rispondere. Le schede compaiono solo nel riepilogo del lunedì: quelle nuove della
  settimana, con chi le ha aggiunte e il loro «perché».
- **Come entra una scheda, dal modulo**: in vista ci sono titolo, tipo, link o file, progetto; il resto sta in due gruppi
  richiudibili.
- **Come entra una scheda, dall'assistente** (un file dato insieme a una nota):
  1. l'AI capisce dalla nota cosa farne (la biblioteca o un'altra strada) e copia le parole della persona come «perché»;
  2. la persona conferma;
  3. l'AI legge il file: PDF e immagini così come sono, i file Word convertiti in testo nel browser, fino a 15 MB e
     100 mila caratteri;
  4. l'AI compila titolo, tipo, una sintesi di 2–4 frasi, 3–6 etichette, autore, ente, anno, il progetto (scelto solo tra
     quelli che le sono stati mandati) e una nota con i suoi dubbi. Non può scrivere il «perché» e non deve seguire
     istruzioni scritte dentro il documento;
  5. si apre il modulo normale già compilato, con tutti i gruppi aperti e l'avviso «compilati dall'AI, controllali».
     Niente si salva né si carica su Drive prima di «Salva».

  Senza AI, o con un file troppo grande, il modulo si apre lo stesso, con il file e un titolo preso dal nome del file.
- **Link**: una pagina web la scarica il server, con le difese descritte al punto 2. Un link di Drive il server lo legge
  solo se il file sta in una cartella che la persona può vedere. Al browser torna solo ciò che è stato estratto, non il
  contenuto.
- **Limiti dichiarati**:
  - non è mai stata provata con documenti veri, né con caricamenti veri su Drive. Il permesso limitato ai file creati
    dall'app potrebbe rifiutare le cartelle create da altri;
  - non c'è una ricerca per significato;
  - restano da fare la ricezione dal menù «Condividi» del telefono e più allegati insieme.

**Per D&D**

D&D ha già i documenti di Drive collegati a progetti e voci (`documenti: [{ id, nome, mime, link }]`), la ricerca in
Drive per nome e il testo dei PDF letto una volta per versione. È in programma la cartella Drive per progetto.

- **Una scheda per ogni file, non una copia del file.** Collezione `riferimenti/{casa}_{fileId}`: una scheda per file,
  quindi niente doppioni anche se lo stesso file è collegato a due progetti. Campi: `nome, link, mime, tipo,
  etichette[], sintesi, perche, projectIds[], peopleIds[], scadenza?`, più i campi di base.
  - Pochi tipi fissi, adatti alla casa e alle associazioni: contratto, garanzia, istruzioni, ricevuta, statuto e atti,
    guida o articolo.
  - La `scadenza` è il campo in più che per una casa conta (una garanzia che scade, un contratto da disdire): diventa una
    proposta di promemoria.
- **I documenti già collegati restano come sono.** I `documenti` di progetti e voci non cambiano: la pagina «Biblioteca»
  li mostra insieme alle schede, e lo stesso `fileId` fa una riga sola. La scheda di un documento già collegato si crea
  senza spostare dati.
- **Come entra un documento**:
  - con il + della pagina: si cerca in Drive come oggi, oppure si carica una foto o un file. Caricare richiede la cartella
    con il permesso di scrittura: oggi il permesso di Drive è di sola lettura;
  - dal Diario: per una nota con un link o un file, l'agente propone «Aggiungi alla biblioteca» (regola 5);
  - in tutti e due i casi Claude compila tipo, sintesi, etichette, progetto e persone (solo tra gli id che riceve) e la
    scadenza, se la trova. Il «perché» viene dalle parole della nota, mai inventato. Si apre il foglio già compilato e si
    salva in basso a destra;
  - il menù «Condividi» del telefono oggi accetta solo testo, link e foto: per i PDF va allargato.
- **Sintesi una volta per versione**: la scheda nasce dalla stessa lettura di `drive_testi` (stesso `modifiedTime`). Se
  il file cambia, la scheda si segna «da rivedere» e quella confermata resta valida.
- **Ricerca**: nel telefono, come quella del Diario (senza accenti, con le parole evidenziate), su nome, tipo, etichette,
  sintesi, «perché», progetto e persone. Qui D&D può andare oltre il gestionale: uno strumento di sola lettura per
  Chiedi, che cerca nelle schede e nel testo dei documenti («quando scade la garanzia della lavatrice?»).
- **Interfaccia**: righe a filetti, non copertine. Pillole per tipo; in cima «Aggiunti di recente», poi i documenti per
  tipo. La riga «Documenti» compare anche nella scheda della persona (punto 1) e nella pagina del progetto.
- **Sicurezza**: D&D legge Drive con il permesso della persona, quindi è Drive stesso a impedire di aprire i file che lei
  non vede. Le schede seguono la visibilità solita: privata o condivisa, oppure quella del progetto se ne hanno uno.

### 4. Contatti con informazioni in più

**Nel gestionale**

- **Contatto**: nome, email, telefono, ruolo, un'organizzazione, note in testo libero, chi l'ha creato e chi l'ha
  modificato.
- **Organizzazione**: nome, tipo (una dozzina di tipi fissi), sito, paese, note. A parte, un gruppo con i dati di
  fatturazione, che un ruolo può modificare senza toccare il resto.
- **Legami**: un contatto ha una sola organizzazione, senza la storia dei ruoli, e non ci sono relazioni tra contatti.
- **Storia**: è fatta dalle note collegate. Quando si crea un contatto l'app scrive una nota «Nuovo contatto: … ·
  organizzazione», così la cronologia comincia da lì. Ogni modifica a contatti e organizzazioni finisce in un registro
  (campo, prima, dopo, chi, quando) che legge solo il vertice. Le note non si possono collegare alle organizzazioni.
- **Elenco**: due schede, Persone e Organizzazioni.
  - Pillole per le persone: tutte, con opportunità aperte, aggiunte da me.
  - Pillole per le organizzazioni: tutte, committenti, partner, senza attività.
  - Tendine con i conteggi per tipo, paese e ordine.
- **Cancellare**:
  - un contatto si cancella togliendo in un colpo solo i riferimenti; le note tengono il nome;
  - un'organizzazione usata altrove non si può cancellare, e l'app dice dove è usata;
  - non c'è un cestino, e non c'è «Unisci» (proposto, non fatto).
- **Doppioni: la parte migliore.**
  - I nomi si normalizzano: minuscole, niente accenti né punteggiatura, niente parole vuote; per le organizzazioni niente
    forme giuridiche, per le persone niente titoli.
  - Il punteggio:
    - stesso nome: 1;
    - stesso nome senza spazi: 0,97;
    - stesse parole in un altro ordine (persone): 0,95;
    - altrimenti conta quante parole distintive hanno in comune, tollerando un errore nelle parole da 6 lettere e due in
      quelle da 9;
    - un nome contenuto nell'altro alza il punteggio;
    - per le organizzazioni le parole generiche («comune», «fondazione») non contano.

    Due voci sono doppioni sopra 0,75.
  - Sono doppioni anche due voci con la stessa email, lo stesso telefono (confrontato sulle ultime 9 cifre), la stessa
    partita IVA o lo stesso sito. Del sito conta il dominio, oppure l'indirizzo intero per le pagine ospitate da
    piattaforme e social.
  - Dove si vede:
    - mentre si scrive, un riquadro «già presente» con «Apri»;
    - al salvataggio il modulo si ferma una volta e il bottone diventa «Crea comunque»;
    - nelle scelte con ricerca, le voci simili portano la scritta «simile».

    Non blocca mai.
- **AI**: da una nota propone contatti nuovi (nome, ente, ruolo), con la correzione dei doppioni descritta al punto 1. Non
  aggiorna mai un contatto che c'è già.
- **Google Contatti**: nessun legame, perché il gestionale non chiede quel permesso.
- **Biglietto da visita**: è quello della persona stessa, una pagina pubblica con la vCard. Leggere i biglietti degli
  altri è solo in programma.

**Per D&D**

Qui D&D è già più avanti, perché la rubrica è allineata con Google Contatti. Dal gestionale conviene prendere questo.

- **Appartenenze.** Sulla voce `person`, un elenco `appartenenze: [{ orgId, ruolo, dal?, al? }]`, dove `orgId` è un'altra
  voce: un tipo nuovo `org`, oppure `info` con una categoria (da decidere). Per le associazioni è proprio ciò che serve
  («presidente di …», «volontaria di …»). Una persona può averne più d'una, ed è meglio dell'unica organizzazione del
  gestionale. Nella scheda dell'organizzazione compaiono le sue persone.
- **Convivenza con Google.** Oggi, per le voci collegate, telefono, mail e indirizzo arrivano da Google e il nome resta
  quello della rubrica. L'app legge già le organizzazioni da Google, ma solo il nome dell'ente.
  - Proposta: ente e qualifica di Google compaiono come suggerimento per la prima appartenenza, da confermare con un
    tocco. Appartenenze, note e storia stanno solo in D&D.
  - Scrivere su Google, no: il permesso è di sola lettura, e un'app che riscrive i contatti rischia di rovinarli.
- **Storia**: è la scheda della persona del punto 1 (note, task, documenti, progetti). Un registro delle modifiche campo
  per campo, per una casa di due persone, non vale la fatica.
- **Doppioni**, con le stesse idee ma scritti in D&D, in `core/cerca.js` accanto a `normalizza`:
  - mentre si scrive una voce nuova, un riquadro «C'è già» con le voci e i contatti Google simili (per nome, email, ultime
    9 cifre del telefono). Al secondo tocco il bottone salva comunque;
  - le stesse regole servono ad abbinare le persone nominate dall'agente;
  - in più, «Unisci» tra due voci, che il gestionale non ha: sposta sulla voce che resta i `peopleIds` dei task e il
    `voceId` delle persone nelle note, con una conferma.
- **Cancellare una voce usata**: l'app dice dove è usata (task, note) e toglie i riferimenti in una sola scrittura. Le note
  tengono il nome.
- **Voce da un biglietto da visita**: una foto, letta da Claude, compila il foglio della voce, che poi si salva a mano. D&D
  sa già fotografare e far leggere le foto a Claude; nel gestionale è solo un'idea.
- **Da non prendere**: dati di fatturazione, tipi di organizzazione aziendali, filtri commerciali.

### Cose utili per tutti e quattro i punti

- **L'AI compila un modulo normale, che la persona salva.** D&D lo fa già con le proposte; conviene farlo anche per le
  schede nuove (bando, documento, voce da un biglietto da visita).
- **Il «perché è importante» lo scrive sempre la persona.** Al più, l'AI lo prende dalle sue parole.
- **Un documento si legge una volta per versione**, cioè per data di modifica. La scheda confermata resta valida finché
  una persona non ha rivisto quella nuova.
- **All'AI si danno solo id noti**, e quelli che restituisce si ricontrollano. Il testo che arriva da fuori va racchiuso,
  con l'istruzione di non eseguirlo. La risposta segue uno schema e si ripulisce sia sul server sia nell'app.
- **I campi dell'AI li scrive solo il server**: le regole lasciano alle persone soltanto la conferma.
- **La ricerca guarda solo ciò che è già nel telefono**: così non mostra niente che la persona non possa leggere, e non
  servono indici nuovi.
- **Il nome si copia solo dove serve**, cioè quando deve sopravvivere a una cancellazione. Altrimenti si salva l'id.

### Ordine consigliato

1. **Scheda della persona e «Annota dalla persona».** Lavoro piccolo: i dati sono già in memoria e non servono collezioni
   nuove.
2. **Doppioni in rubrica e appartenenze.** Lavoro medio: un campo sulla voce, una funzione che misura quanto due nomi si
   somigliano, «Unisci».
3. **Biblioteca con una scheda per file.** Lavoro medio, meglio dopo la cartella per progetto e il permesso di scrittura
   su Drive.
4. **Bandi.** Lavoro grande: due collezioni, una function con il lettore di pagine, un giro settimanale. Prima va deciso
   con Mattia per quali associazioni e da quali fonti.
