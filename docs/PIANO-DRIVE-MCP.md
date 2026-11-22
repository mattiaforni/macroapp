# Piano: cartella Drive per progetto e connettore MCP (deciso con Mattia il 21/11)

Obiettivo: collegare meglio chat su Claude, database dell'app, AI dell'app e Google Drive.
Firestore resta la fonte dei dati; Drive è il posto dei documenti di lavoro; la chat legge e scrive il database
con un connettore MCP. Regola 5 di CLAUDE.md invariata: niente entra nei moduli dall'AI senza conferma (solo `proposals`).

## Decisioni di Mattia (21/11)

- Una **cartella per progetto** su Drive, `D&D/<nome progetto>`, creata dall'app (alla creazione del progetto, o con un tocco
  per quelli che esistono). Progetto condiviso → cartella condivisa con l'altra persona della casa; privato → no.
  Cambio di visibilità del progetto → cambia la condivisione della cartella.
- **App → Drive**, tutte e tre:
  1. copia leggibile del progetto (sintesi, task aperti, note; per le note un Doc per mese), aggiornata **subito**
     dopo ogni modifica (con un raggruppamento di pochi secondi, non a ogni carattere);
  2. «Apri come documento» da una nota o dalla sintesi: crea un Doc nella cartella e lo apre;
  3. allegati: le foto delle note salvate anche nella cartella (Firestore resta la fonte, `journal_photos`).
- **Drive → app**: l'app controlla le novità della cartella (chiamata a Drive con `modifiedTime`: non costa token);
  un file nuovo o cambiato e poi **fermo da 30 minuti** (Google Docs salva da solo mentre scrivi) si analizza una volta.
  L'agente legge **solo la parte nuova** (testo della versione precedente in cache, come `drive_testi`) e propone:
  sintesi aggiornata, task nuovi, task fatti, nota «avanzamento da Drive». Le modifiche a mano alla copia leggibile
  tornano anche loro come proposte. Le proposte si vedono nella pagina del progetto e in Proposte.
- I **documenti collegati a mano** (`projects.documenti`) restano e valgono come quelli della cartella.
- Anche **Chiedi** legge i documenti della cartella e quelli collegati (oggi non legge Drive).
- Mattia fa poche modifiche su Drive: controllo ogni pochi minuti va bene (si può agganciare a `giroAvvisi`), ma l'analisi
  con l'AI parte solo su file davvero cambiati.
- **Connettore MCP** per la chat su claude.ai (anche dal telefono): legge note, sintesi, task, eventi, spese dal database
  (riusare gli strumenti di sola lettura di `src/chiedi.js`) e scrive solo `proposals` (nota, task, voce di lista…).
  Usi previsti: lavorare in chat sui progetti; importare lo storico delle lezioni di tennis dalle chat del progetto Claude
  (punto «Aperti» di CLAUDE.md) come note proposte.

## Permessi Google

- Si aggiunge `drive.file` (creare e modificare i file dell'app) e si tiene `drive.readonly` (leggere ciò che Mattia o la
  chat mettono nella cartella). Serve ricollegare Google una volta, per entrambi.
- Mattia pensa che la schermata di consenso OAuth sia già «In produzione» (allora niente scadenza dei 7 giorni):
  verificarlo (pagina Google dell'app: collegato da più di 7 giorni) e scriverlo in «Da verificare».

## Attenzioni

- **Niente cicli**: le scritture dell'app sulla copia leggibile non devono tornare come novità (tenere l'ultima
  `modifiedTime`/revisione scritta dall'app per file) — solo le modifiche di altri diventano proposte.
- **Privacy**: le cartelle e le copie seguono `visibility`; l'altra persona vede solo i progetti condivisi; il server usa il
  permesso Google del proprietario del progetto. Stesse regole di Chiedi nel connettore MCP.
- Le cartelle stanno nel Drive di chi ha creato il progetto.
- Costi: le analisi in `consumi`; modello come per l'agente (`modelloPer`), le differenze piccole con un modello leggero.
- Nuove collezioni → regole, indici, casi in `prove/regole/prova-regole.mjs` (regola 4); nuove onCall → ultimo passo di
  `deploy.yml`; Google finto nelle prove per creare cartelle, scrivere Doc, elencare novità.

## Ordine di lavoro (un commit con prove per passo, pubblicazione automatica)

1. Scope `drive.file`, cartella per progetto (creazione, condivisione, cambio visibilità), link alla cartella nella pagina
   del progetto.
2. App → Drive: copia leggibile aggiornata subito; «Apri come documento»; foto nella cartella.
3. Drive → app: controllo delle novità, attesa di 30 minuti, differenze, proposte; Chiedi legge la cartella.
4. Connettore MCP: function HTTP con trasporto MCP, accesso OAuth col login di Firebase per i connettori personalizzati
   di claude.ai (verificare i requisiti attuali di claude.ai: registrazione del client, scoperta dei metadati OAuth),
   strumenti di lettura e `proponi`; istruzioni per Mattia per aggiungerlo su claude.ai.

Alla fine di ogni passo: `docs/STORIA.md`, `docs/ARCHITETTURA.md`, `docs/MODELLO-DATI.md`, `docs/MAPPA.md`, mappa e
«Da verificare» di CLAUDE.md; e le cose che Mattia deve fare a mano (console, ricollegamento, connettore) dette chiaramente.
