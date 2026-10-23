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
  provider AI intercambiabile in `src/ai/`), `syncBank` (Enable Banking, non ancora attivo).
  firebase-admin, agente e banca si importano dentro i gestori, non all'avvio.
- **Pubblicazione**: push su `main` → `.github/workflows/deploy.yml` pubblica hosting,
  regole, indici e functions (secret `FIREBASE_SERVICE_ACCOUNT`). Si può rilanciare a mano.
- **Segreti** in Secret Manager (ANTHROPIC_API_KEY, GEMINI_API_KEY, ENABLE_BANKING_*):
  li gestisce Mattia dalla console; dopo un aggiornamento serve un nuovo deploy.

## Mappa (public/js)

| file | cosa fa |
|---|---|
| `app.js` | guscio: accesso, barra in basso, router, service worker, ricorrenti all'avvio |
| `core/ui.js` | `el()`, icone disegnate a mano (`D`), date, importi, pillole |
| `core/db.js` | `create` (non aspetta il server, ritorna `{id, saved}`), `update`, `watchVisible`, `readVisible` |
| `core/household.js` | casa, nomi dei membri (`memberNames`), `nomeDi`, `updateHousehold` (es. categorie del manuale) |
| `core/rubrica.js` | voci del manuale in memoria, aggiornate in tempo reale: `trovaPersona`, `risolviPersone` (crea quelle che mancano), `nomiTask` |
| `core/contatti-google.js` | Google Contatti in sola lettura (People API), permesso chiesto solo al momento dell'uso |
| `components/sheet.js` | foglio a tutta altezza (indietro, titolo, spunta); il tasto indietro lo chiude |
| `components/proposals.js` | azioni proposte: `APPLICA` per tipo, `renderAzione` |
| `components/persone.js` | scelta delle persone di un task dalla rubrica (pillole, suggerimenti, persone nuove) |
| `modules/*/index.js` | un modulo = `{ id, title, nav, icon, mount(container) → smonta }`, in `modules/registry.js` |

## Regole di lavoro

1. **Design**: Mattia è preciso. Grammatica presa dall'app cura-del-verde: Instrument Sans/Serif,
   icone a linea sottile, righe con filetti invece di riquadri, campi con la sola linea sotto,
   pillole, fogli a tutta altezza. Colori solo dalle variabili in `css/base.css`.
   Identità visiva definitiva ancora da decidere: non inventarla senza che lo chieda.
2. Inserimento uniforme: in ogni pagina un + tondo in basso a destra (`fab()` in ui.js) apre il foglio
   per scrivere. Invio salva appena hai scritto tutto ciò che è obbligatorio; se manca un campo
   obbligatorio, Invio ti porta lì. Quindi: spesa = descrizione → importo → salva; task, voce del
   manuale, progetto = Invio sul primo campo salva; lista = Invio aggiunge e resta aperto per la
   prossima; nota del diario = Invio va a capo, salva la spunta. Nei campi facoltativi a scelta
   (persone) Invio aggiunge, e a campo vuoto salva.
3. Nuova collezione: blocco in `firestore.rules` + indici in `firestore.indexes.json`
   (servono per `householdId+visibility+ordine` e `ownerUid+ordine`). Gli ordinamenti fini
   si fanno nel modulo, per non moltiplicare gli indici.
4. Niente entra nei moduli dall'AI senza conferma: l'agente scrive solo `proposals`.
5. Mai nel repo chiavi o dati personali.

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
