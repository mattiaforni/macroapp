# Macroapp

App personale e di coppia, installabile come PWA. Moduli: **Lista** della spesa, **Spese** condivise (sostituto di Splitwise), **Manuale** di casa, **Diario** con agente, **Task**, **Proposte** (coda di approvazione).

Nome e identità visiva sono provvisori.

## Stack

- Front-end: HTML/CSS/JavaScript senza framework né bundler, SDK Firebase via CDN (`public/`)
- Backend: Firebase Auth (Google), Firestore, Cloud Functions 2ª gen in `europe-west1` (`functions/`)
- Hosting: Firebase Hosting, deploy automatico da GitHub Actions a ogni push su `main`
- AI: provider intercambiabile (Claude o Gemini), vedi `functions/src/ai/`
- Banca: Enable Banking (PSD2), vedi `functions/src/banking/`

Dettagli in [docs/ARCHITETTURA.md](docs/ARCHITETTURA.md) e [docs/MODELLO-DATI.md](docs/MODELLO-DATI.md).

## Setup iniziale (una volta sola)

1. **Progetto Firebase**: crea il progetto nella console, piano Blaze (serve per le Functions; a questa scala il costo è zero).
2. **Autenticazione**: Authentication → Metodo di accesso → Google → abilita.
3. **Firestore**: crea il database in modalità produzione, regione `europe-west1` (o `eur3`).
4. **App web**: Impostazioni progetto → Aggiungi app → Web. Copia la configurazione in `public/js/firebase-config.js`.
5. **Id progetto** in `.firebaserc`.
6. **Segreti** (da terminale con Firebase CLI, `npm i -g firebase-tools` e `firebase login`):
   ```
   firebase functions:secrets:set ANTHROPIC_API_KEY
   firebase functions:secrets:set GEMINI_API_KEY
   firebase functions:secrets:set ENABLE_BANKING_APP_ID
   firebase functions:secrets:set ENABLE_BANKING_PRIVATE_KEY
   ```
   Quelli non ancora disponibili possono avere un valore fittizio: la funzione fallisce solo quando li usa.
7. **Primo deploy**: `firebase deploy`.

## Deploy automatico

1. Console Google Cloud → IAM e amministrazione → Account di servizio → crea `github-deploy` con i ruoli *Editor*, *Amministratore Firebase*, *Utente account di servizio*, *Amministratore Secret Manager*.
2. Crea una chiave JSON e incollane il contenuto nel secret GitHub `FIREBASE_SERVICE_ACCOUNT` (Settings → Secrets and variables → Actions). Poi cancella il file scaricato.
3. Da quel momento ogni push su `main` pubblica hosting, regole, indici e functions. Per rilanciare a mano: Actions → Deploy Firebase → Run workflow.

La chiave dà accesso quasi completo al progetto: deve stare solo nei secret di GitHub, mai nel repository o in una chat.

## Segreti senza terminale

- **Aggiornare un segreto esistente**: Console Google Cloud → Secret Manager → nome del segreto → *Nuova versione* → incolla il valore. Poi Actions → Deploy Firebase → Run workflow (le functions leggono la versione attiva al momento del deploy).
- **Nuovo segreto**: crealo prima in Secret Manager (*Crea secret*), poi va dichiarato nel codice con `defineSecret`.

## Sviluppo locale

```
npm i -g firebase-tools
cd functions && npm install && cd ..
firebase emulators:start
```
Apri `http://localhost:5000`. Per usare gli emulatori anche per Auth/Firestore dal front-end, aggiungi in `public/js/core/firebase.js` le chiamate `connectAuthEmulator` / `connectFirestoreEmulator` quando `location.hostname === "localhost"`.

## Primo accesso

Chi accede per primo crea la casa e trova il codice di invito in Impostazioni. L'altra persona accede con Google e inserisce il codice.

## Aggiungere un modulo

1. Crea `public/js/modules/<id>/index.js` che esporta `id`, `title`, `nav`, `icon`, `mount(container)` (ritorna una funzione di smontaggio).
2. Aggiungilo a `public/js/modules/registry.js`.
3. Se usa una nuova collezione: aggiungi il blocco `match` in `firestore.rules` e gli indici in `firestore.indexes.json`.
4. Usa `core/db.js` (`create`, `update`, `remove`, `watchVisible`, `watchMine`): il modello di visibilità è applicato automaticamente.
