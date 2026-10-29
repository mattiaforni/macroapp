// Agente del diario: dal testo di una nota ricava azioni e le scrive come proposte.
// Non modifica mai i moduli direttamente: ogni azione passa dalla conferma dell'utente.
import { FieldValue } from "firebase-admin/firestore";
import { reason, MODELLI } from "./ai/provider.js";
import { leggiDocumenti, sezioneDocumenti } from "./google/drive.js";

/**
 * Modello per la nota: users/{uid}.modelli = { note, progetti } (pagina «Modelli AI» dell'app).
 * `note` per le note semplici, `progetti` per quelle di un progetto con istruzioni (riepilogo e sintesi).
 * Scelte di Mattia del 27/10: Sonnet per le semplici, Opus per i progetti. Chiavi sconosciute → predefinito.
 */
export const MODELLI_PREDEFINITI = { note: "sonnet", progetti: "opus" };
export function modelloPer(profilo, conRiepilogo) {
  const tipo = conRiepilogo ? "progetti" : "note";
  const scelto = profilo?.modelli?.[tipo];
  return Object.hasOwn(MODELLI, scelto || "") ? scelto : MODELLI_PREDEFINITI[tipo];
}

/**
 * Sezione del prompt per una nota collegata a un progetto. Con le istruzioni del progetto
 * (come quelle di un progetto Claude) l'agente scrive anche il riepilogo della nota e propone
 * la sintesi aggiornata del progetto, tenendo conto delle note precedenti.
 */
function sezioneProgetto(progetto) {
  if (!progetto) return "";
  const righe = [`
La nota appartiene al progetto «${progetto.name}»: i task che ne ricavi vanno in questo progetto
(payload.project = "${progetto.name}"), salvo che la nota dica altro.`];
  if (progetto.istruzioni) {
    righe.push(`
Oltre alle azioni, scrivi nel campo "riepilogo" un riepilogo della nota seguendo queste istruzioni
dell'utente per il progetto:
<istruzioni>
${progetto.istruzioni}
</istruzioni>
Il riepilogo è testo semplice: righe che iniziano con "## " per i titoli di sezione, "- " per gli
elenchi, **grassetto** solo dove serve; niente tabelle, niente elenchi annidati né rientri. Per raggruppare
dei punti sotto una rubrica, una riga breve a sé che finisce con ":" (es. "Acquisito:") e sotto le sue voci
"- ". Ciò che va ricordato sta nel riepilogo e nella sintesi: le azioni restano per le cose da fare, comprare,
spendere o scrivere.

Il riepilogo riporta SOLO ciò che dice il testo della nota. La sintesi, le note precedenti e i documenti
servono a capirla e a collegarla, non a completarla: un punto che non è nella nota non entra nel riepilogo,
nemmeno se è plausibile o se torna da altre lezioni. Un collegamento con il passato si scrive come tale, con
la data ("torna la correzione del 15 ottobre"), solo se la nota stessa lo tocca. Se la nota è breve, vaga o
ricostruita a memoria, il riepilogo resta breve.

Il progetto ha anche una "sintesi": un testo vivo che raccoglie lo stato del progetto, ciò che è emerso
finora e va tenuto presente (non la cronaca delle singole note). Nel campo "sintesi" scrivi la sintesi
aggiornata con la nota di oggi, nello stesso formato del riepilogo. La struttura della sintesi è per
temi concreti del progetto, una sezione "## " per tema: nel tennis un colpo (Dritto, Rovescio, Servizio…),
gli spostamenti, il fisico; in un altro progetto gli argomenti equivalenti. Se le istruzioni elencano i
temi, usa quelli; altrimenti scegli nomi brevi e tienili identici da una volta all'altra, perché l'app li usa
per collegare le note ai temi. Le rubriche che le istruzioni chiedono per il riepilogo (cosa ho imparato,
cosa funziona, su cosa lavorare…) NON sono sezioni della sintesi: vivono dentro ogni tema, ciascuna come riga
a sé che finisce con ":" (es. "Acquisito:", "In lavorazione:") seguita dalle sue voci "- ", senza rientri;
una voce è un punto solo, in una frase breve. Le rubriche hanno gli stessi nomi in tutti i temi.
Oltre ai temi, al massimo due sezioni trasversali, es. "Nodi ricorrenti" (ciò che torna
lezione dopo lezione) e "Da provare". Dentro una sezione, come prima
riga facoltativa, "Stato: " e due-quattro parole sul punto in cui si è (es. "migliora", "da affrontare",
"tornato indietro"). Tieni ciò che resta valido, aggiorna ciò che cambia, togli ciò che è superato, non
ripetere le date né raccontare le lezioni una per una. Lunghezza: quanto serve per orientarsi, non di più.

Scrivi anche un "titolo" della nota (una riga, al massimo 60 caratteri, di cosa parla: niente data) e
"temi": i nomi esatti delle sezioni della sintesi che la nota tocca (quelle della sintesi aggiornata,
escluse le trasversali).`);
    if (progetto.dopo) {
      righe.push(`
La nota non è l'ultima del progetto: ci sono ${progetto.dopo >= DOPO_MAX ? `almeno ${DOPO_MAX}` : progetto.dopo} note con una
data successiva (è stata inserita dopo, con la sua data, o la si sta rianalizzando).${progetto.sintesi ? ` La sintesi
attuale le comprende già: aggiungi solo ciò che questa nota porta di nuovo e non far tornare indietro lo
stato di un tema per una nota più vecchia.` : ""}`);
    }
    if (progetto.sintesi) {
      righe.push(`
Sintesi attuale del progetto (l'utente può averla corretta a mano: rispettane struttura e scelte):
<sintesi>
${progetto.sintesi}
</sintesi>
Se la nota di oggi non cambia nulla della sintesi, restituiscila identica.`);
    } else {
      righe.push(`
Il progetto non ha ancora una sintesi: costruiscila da tutte le note che seguono e dalla nota di oggi.`);
      if (progetto.seguenti.length) righe.push(`
Note dello stesso progetto con una data successiva a questa (servono solo per la sintesi, non per il riepilogo):
<successive>
${progetto.seguenti.map((n) => `<nota data="${n.data}">\n${n.testo}\n</nota>`).join("\n")}
</successive>`);
    }
    righe.push(sezioneDocumenti(progetto.documenti));
    righe.push(progetto.precedenti.length
      ? `
Note precedenti dello stesso progetto (con una data anteriore a questa), dalla più vecchia alla più
recente. Servono a collegare la nota a ciò che è già emerso (correzioni che tornano, progressi, cose da
riprendere): nel riepilogo non riassumerle e non prenderne punti.
<precedenti>
${progetto.precedenti.map((n) => `<nota data="${n.data}">\n${n.testo}\n</nota>`).join("\n")}
</precedenti>`
      : progetto.dopo ? `
Non ci sono note del progetto con una data anteriore a questa.` : `
È la prima nota di questo progetto.`);
  }
  return righe.join("\n");
}

export function system({ oggi, altro, progetti, persone, categorie, progetto = null, dataNota = "" }) {
  return `Sei l'assistente di un'app personale e di coppia (lista della spesa, spese condivise, task per progetti,
manuale di casa, calendario della casa, appunti). Ricevi una nota scritta o dettata dall'utente: può contenere errori di dettatura
e poca punteggiatura. Estrai SOLO le azioni concrete che la nota contiene o chiede, senza inventarne.

Oggi è ${oggi}.${dataNota ? ` La nota però è datata ${dataNota}: le date relative che contiene ("venerdì",
"domani") si contano da quel giorno.` : ""} L'altra persona della casa si chiama ${altro || "(non ancora indicata)"}.
Progetti esistenti dell'utente: ${progetti.length ? progetti.join(", ") : "nessuno"}.
Persone in rubrica: ${persone.length ? persone.join(", ") : "nessuna"}.
Quando la nota nomina una di queste persone (anche solo col nome proprio), scrivila come è in rubrica.

Tipi di azione:
- task: una cosa da fare. payload.text (frase breve all'infinito o imperativo), payload.due (AAAA-MM-GG solo se
  la nota indica una scadenza, anche relativa: "venerdì", "entro fine mese"), payload.project (uno dei progetti
  esistenti se pertinente, altrimenti un nome nuovo breve solo se la nota lo suggerisce chiaramente, altrimenti vuoto),
  payload.people (persone coinvolte, se nominate, separate da virgola).
- shopping_item: cose da comprare per la casa. payload.text (anche più voci separate da virgola).
- expense: una spesa già fatta da dividere. payload.description, payload.amount (numero in euro).
- manual_entry: un negozio, fornitore o artigiano ("shop"), una persona nuova da tenere in rubrica con i suoi
  recapiti ("person", solo se la nota dà un telefono o una mail o chiede di salvarla), oppure un'informazione di
  casa da ricordare ("info"). payload.type, payload.name, payload.category (una di: ${categorie.join(", ")};
  vuota se nessuna è adatta), payload.notes, payload.phone, payload.email.
- event: un appuntamento o impegno con un giorno preciso (visita, lezione, cena, partenza, consegna, scadenza
  da segnare), da mettere nel calendario condiviso della casa. payload.text (titolo breve dell'evento),
  payload.due (AAAA-MM-GG, obbligatorio: senza un giorno chiaro non è un evento ma al più un task),
  payload.time (HH:MM di inizio se la nota la dice, altrimenti vuoto = tutto il giorno), payload.place
  (luogo se indicato). Un impegno con un orario è un event, non un task; una cosa da fare "entro" un
  giorno è un task.
- draft: SOLO se la nota chiede di scrivere, rispondere, mandare o preparare un messaggio, una mail o un testo
  per qualcuno. Scrivi il testo pronto da inviare, in italiano, nel registro adatto al destinatario,
  firmato "Mattia" se serve una firma. payload.channel ("email", "messaggio" o "documento"),
  payload.to (destinatario se noto: il nome come in rubrica, o l'indirizzo mail), payload.subject (oggetto, per le mail), payload.body (il testo completo).

Nel payload scrivi sempre tutti i campi: quelli che non servono a quel tipo di azione lasciali vuoti
("" per i testi, 0 per amount).

Per ogni azione:
- summary: una riga chiara di cosa verrà fatto (es. "Chiamare l'idraulico entro venerdì").
- shared: true se riguarda la casa o la coppia (spesa, lista, manuale, faccende comuni), false se è personale
  (lavoro, volontariato, cose proprie).
Un'informazione da conservare non è un'azione: se riguarda la casa può essere una manual_entry "info",
se riguarda un progetto con istruzioni va nel riepilogo e nella sintesi, altrimenti resta nella nota.
Se la nota è una riflessione senza azioni, restituisci una lista vuota.
${sezioneProgetto(progetto)}`;
}

const PAYLOAD = ["text", "due", "time", "place", "project", "people", "description", "amount", "name", "category", "notes",
  "type", "phone", "email", "channel", "to", "subject", "body"];

export const SCHEMA = {
  type: "object",
  properties: {
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["task", "shopping_item", "expense", "manual_entry", "event", "draft"] },
          shared: { type: "boolean" },
          summary: { type: "string" },
          payload: {
            type: "object",
            properties: {
              text: { type: "string" },
              due: { type: "string" },
              time: { type: "string" },
              place: { type: "string" },
              project: { type: "string" },
              people: { type: "string" },
              description: { type: "string" },
              amount: { type: "number" },
              name: { type: "string" },
              category: { type: "string" },
              notes: { type: "string" },
              type: { type: "string" },
              phone: { type: "string" },
              email: { type: "string" },
              channel: { type: "string" },
              to: { type: "string" },
              subject: { type: "string" },
              body: { type: "string" },
            },
            // Tutti obbligatori: con i campi facoltativi la grammatica dell'output strutturato
            // diventa troppo complessa («Schema is too complex» dopo decine di secondi).
            required: PAYLOAD,
            additionalProperties: false,
          },
        },
        required: ["kind", "shared", "summary", "payload"],
        additionalProperties: false,
      },
    },
  },
  required: ["actions"],
  additionalProperties: false,
};

/** Lo schema della risposta: riepilogo, sintesi, titolo e temi solo per le note di un progetto con istruzioni. */
export function schema(conRiepilogo = false) {
  if (!conRiepilogo) return SCHEMA;
  return {
    ...SCHEMA,
    properties: {
      riepilogo: { type: "string" }, sintesi: { type: "string" }, titolo: { type: "string" },
      temi: { type: "array", items: { type: "string" } },
      ...SCHEMA.properties,
    },
    required: ["riepilogo", "sintesi", "titolo", "temi", ...SCHEMA.required],
  };
}

const s = (x) => (typeof x === "string" ? x.trim() : "");

/** Tiene solo i campi che servono a ciascun tipo. */
function pulisci(kind, p = {}) {
  switch (kind) {
    case "task": return { text: s(p.text), due: /^\d{4}-\d{2}-\d{2}$/.test(s(p.due)) ? s(p.due) : "", project: s(p.project), people: s(p.people) };
    case "shopping_item": return { text: s(p.text) };
    case "event": return {
      text: s(p.text), due: /^\d{4}-\d{2}-\d{2}$/.test(s(p.due)) ? s(p.due) : "",
      time: /^\d{2}:\d{2}$/.test(s(p.time)) ? s(p.time) : "", place: s(p.place),
    };
    case "expense": return { description: s(p.description) || s(p.text), amount: Number(p.amount) || 0 };
    case "manual_entry": return {
      name: s(p.name) || s(p.text), category: s(p.category), notes: s(p.notes),
      type: ["shop", "person", "info"].includes(p.type) ? p.type : "shop", phone: s(p.phone), email: s(p.email),
    };
    case "draft": return { channel: ["email", "messaggio", "documento"].includes(p.channel) ? p.channel : "messaggio", to: s(p.to), subject: s(p.subject), body: s(p.body) };
    default: return { text: s(p.text) || s(p.notes) };
  }
}

const CATEGORIE_PREDEFINITE = ["Idraulica", "Elettricità", "Vernici e ferramenta", "Agraria e giardino", "Edilizia", "Auto", "Casa", "Salute"];

/** Contesto per il modello: progetti e persone visibili all'utente, categorie del manuale,
 *  nome dell'altra persona. Solo filtri di uguaglianza: non servono indici composti. */
async function contesto(db, entry, uid) {
  const hid = entry.householdId;
  const [mie, casa, h, mieVoci, vociCasa] = await Promise.all([
    db.collection("projects").where("ownerUid", "==", uid).get(),
    hid ? db.collection("projects").where("householdId", "==", hid).where("visibility", "==", "shared").get() : null,
    hid ? db.collection("households").doc(hid).get() : null,
    db.collection("manual_entries").where("ownerUid", "==", uid).where("type", "==", "person").select("name").get(),
    hid ? db.collection("manual_entries").where("householdId", "==", hid).where("visibility", "==", "shared")
      .where("type", "==", "person").select("name").get() : null,
  ]);
  const nomi = new Set();
  for (const d of [...mie.docs, ...(casa?.docs || [])]) if (!d.data().archived) nomi.add(d.data().name);
  const persone = new Set();
  for (const d of [...mieVoci.docs, ...(vociCasa?.docs || [])]) if (d.data().name) persone.add(d.data().name);
  const casaDati = h?.exists ? h.data() : {};
  const categorie = Array.isArray(casaDati.manualCategories) ? casaDati.manualCategories : CATEGORIE_PREDEFINITE;
  const nomiCasa = casaDati.memberNames || {};
  const altro = Object.entries(nomiCasa).find(([k]) => k !== uid)?.[1] || "";
  const oggi = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const iso = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());
  return { oggi: `${oggi} (${iso})`, altro: altro.split(" ")[0], progetti: [...nomi], persone: [...persone].slice(0, 300), categorie };
}

const PRECEDENTI = 8;         // note precedenti date come contesto, quando il progetto ha già una sintesi
const DOPO_MAX = 20;          // note successive contate (con la sintesi) o date (senza, per costruire la prima)
const PRIME_PRECEDENTI = 30;  // senza sintesi: tutte le note del progetto (fino a queste), per costruire la prima
const LUNGHEZZA_NOTA = 4000;  // caratteri per nota precedente
const LUNGHEZZA_SINTESI = 12000;
/** La data della nota, se non è di oggi (nota inserita con un altro giorno, o rianalizzata): "" altrimenti. */
function dataNota(t) {
  if (!t) return "";
  const d = t.toDate ? t.toDate() : new Date(t);
  const giorno = (x) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(x);
  if (Number.isNaN(d.getTime()) || giorno(d) === giorno(new Date())) return "";
  const lungo = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
  return `${lungo} (${giorno(d)})`;
}

const fmtData = (t) => new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "long", year: "numeric" })
  .format(t?.toDate ? t.toDate() : new Date(t || Date.now()));

/**
 * Il progetto della nota, se ce l'ha e l'utente lo vede (suo, o condiviso nella sua casa).
 * Con le istruzioni, anche la sintesi del progetto e le note dello stesso progetto con una data anteriore a
 * quella della nota (il riepilogo se c'è, se no il testo): le ultime PRECEDENTI, o senza sintesi fino a
 * PRIME_PRECEDENTI per costruire la prima. Le note con una data successiva (nota inserita dopo con la sua
 * data, o rianalizzata) non sono «precedenti» (29/10: una lezione ricostruita a posteriori aveva preso nel
 * riepilogo punti di lezioni successive): con la sintesi se ne dice solo quante sono, senza si danno a parte.
 * Le query usano l'indice ownerUid + projectId + createdAt; se manca (appena pubblicato) si va avanti senza.
 */
async function progettoDellaNota(db, entry, uid, passo, clientGoogle) {
  if (!entry.projectId) return null;
  const snap = await db.collection("projects").doc(entry.projectId).get();
  if (!snap.exists) return null;
  const p = snap.data();
  const visibile = p.ownerUid === uid || (p.visibility === "shared" && p.householdId && p.householdId === entry.householdId);
  if (!visibile) return null;
  const istruzioni = s(p.istruzioni).slice(0, 8000);
  const sintesi = s(p.sintesi).slice(0, LUNGHEZZA_SINTESI);
  const quante = sintesi ? PRECEDENTI : PRIME_PRECEDENTI;
  let precedenti = [], seguenti = [], dopo = 0;
  if (istruzioni) {
    const nota = (d) => ({ data: fmtData(d.data().createdAt), testo: (s(d.data().riepilogo) || s(d.data().text)).slice(0, LUNGHEZZA_NOTA) });
    try {
      const base = db.collection("journal_entries").where("ownerUid", "==", uid).where("projectId", "==", entry.projectId);
      const quando = entry.createdAt || null;
      const [q, succ] = await Promise.all([
        (quando ? base.where("createdAt", "<", quando) : base).orderBy("createdAt", "desc").limit(quante + 1).get(),
        quando ? base.where("createdAt", ">", quando).orderBy("createdAt", "desc").limit(DOPO_MAX).get() : null,
      ]);
      precedenti = q.docs.filter((d) => d.id !== entry.id).slice(0, quante).reverse().map(nota).filter((n) => n.testo);
      const altre = (succ?.docs || []).filter((d) => d.id !== entry.id);
      dopo = altre.length;
      if (!sintesi) seguenti = altre.reverse().map(nota).filter((n) => n.testo);
    } catch (err) {
      passo(`note precedenti non lette: ${err.message}`);
    }
  }
  // Documenti di Drive collegati al progetto: letti con il permesso dell'utente, se Google è collegato.
  let documenti = [];
  if (istruzioni && Array.isArray(p.documenti) && p.documenti.length) {
    let token = null;
    try {
      const { tokenServer } = await import("./google/account.js");
      const t = await tokenServer(db, uid, clientGoogle);
      token = t.permessi?.drive ? t.accessToken : null;
      if (!token) passo("documenti: Google collegato senza il permesso per Drive");
    } catch (err) {
      passo(`documenti: permesso Google non ottenuto (${err.details?.motivo || err.message})`);
    }
    documenti = await leggiDocumenti(token, p.documenti, passo);
  }
  return { id: snap.id, name: p.name || "senza nome", istruzioni, sintesi, precedenti, seguenti, dopo, documenti };
}

/** Spese e lista riguardano sempre la casa; le bozze sono sempre solo tue. */
function visibilita(a) {
  if (a.kind === "expense" || a.kind === "shopping_item" || a.kind === "event") return "shared";
  if (a.kind === "draft") return "private";
  if (a.kind === "manual_entry" && a.payload?.type === "person") return "private";
  return a.shared ? "shared" : "private";
}

/**
 * Legge la nota, scrive le proposte e, per le note di un progetto con istruzioni, il riepilogo
 * (con titolo e temi) nella nota stessa (testo correggibile, non un'azione: vedi CLAUDE.md, regola 5) e la proposta
 * di sintesi aggiornata del progetto (quella sì da confermare: sostituisce `projects.sintesi`).
 * Ritorna { azioni, riepilogo, sintesi, modello }: quante proposte, se ha scritto il riepilogo, se ha proposto
 * la sintesi, con quale modello (chiave di MODELLI; l'app la segna sulla nota).
 */
export async function analyzeJournalEntry(db, entry, { uid, keys, provider, clientGoogle = null, passo = () => {} }) {
  const [ctx, progetto, profilo] = await Promise.all([
    contesto(db, entry, uid), progettoDellaNota(db, entry, uid, passo, clientGoogle),
    db.collection("users").doc(uid).get().then((d) => (d.exists ? d.data() : {}), () => ({})),
  ]);
  const conRiepilogo = !!progetto?.istruzioni;
  const modello = modelloPer(profilo, conRiepilogo);
  passo(`contesto pronto (${ctx.progetti.length} progetti, ${ctx.persone.length} persone`
    + (progetto ? `, progetto con ${progetto.precedenti.length} note precedenti${progetto.dopo ? ` e ${progetto.dopo} successive` : ""}${progetto.documenti.filter((d) => d.testo).length ? `, ${progetto.documenti.filter((d) => d.testo).length} documenti letti` : ""}${conRiepilogo ? ", riepilogo" : ""}` : "") + `), modello ${modello}`);
  // Tetti larghi: il ragionamento del modello conta nel tetto (vedi ai/claude.js), si paga solo l'usato.
  const out = await reason({
    system: system({ ...ctx, progetto, dataNota: dataNota(entry.createdAt) }), user: entry.text, schema: schema(conRiepilogo), keys, provider,
    maxTokens: conRiepilogo ? 32000 : 8000, model: modello,
  });
  passo(`risposta dell'AI (${Array.isArray(out.actions) ? out.actions.length : 0} azioni)`);
  const actions = (Array.isArray(out.actions) ? out.actions : []).filter((a) => SCHEMA.properties.actions.items.properties.kind.enum.includes(a.kind));
  const riepilogo = conRiepilogo ? s(out.riepilogo) : "";
  const titolo = conRiepilogo ? s(out.titolo).slice(0, 80) : "";
  const temi = conRiepilogo && Array.isArray(out.temi) ? [...new Set(out.temi.map(s).filter(Boolean))].slice(0, 12) : [];
  // La sintesi si propone solo se cambia davvero rispetto a quella del progetto.
  const sintesi = conRiepilogo ? s(out.sintesi) : "";
  const nuovaSintesi = sintesi && sintesi !== progetto.sintesi ? sintesi : "";

  // Rianalisi: le proposte ancora in attesa della stessa nota vengono sostituite. Una sintesi
  // proposta da una nota precedente e ancora in attesa è superata da quella nuova.
  const [vecchie, sintesiInAttesa] = await Promise.all([
    db.collection("proposals")
      .where("ownerUid", "==", uid).where("sourceEntryId", "==", entry.id).where("status", "==", "pending").get(),
    nuovaSintesi
      ? db.collection("proposals").where("ownerUid", "==", uid).where("kind", "==", "project_summary")
        .where("status", "==", "pending").get()
      : { docs: [] },
  ]);

  const batch = db.batch();
  vecchie.docs.forEach((d) => batch.delete(d.ref));
  sintesiInAttesa.docs.filter((d) => d.data().payload?.projectId === progetto?.id).forEach((d) => batch.delete(d.ref));
  for (const a of actions) {
    const ref = db.collection("proposals").doc();
    batch.set(ref, {
      ownerUid: uid,
      householdId: entry.householdId || null,
      visibility: visibilita(a),
      kind: a.kind,
      source: "agent",
      status: "pending",
      payload: pulisci(a.kind, a.payload),
      summary: s(a.summary),
      sourceEntryId: entry.id,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  if (riepilogo) {
    batch.update(db.collection("journal_entries").doc(entry.id), {
      riepilogo, titolo, temi, riepilogoAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
  }
  if (nuovaSintesi) {
    batch.set(db.collection("proposals").doc(), {
      ownerUid: uid,
      householdId: entry.householdId || null,
      visibility: "private",
      kind: "project_summary",
      source: "agent",
      status: "pending",
      payload: { projectId: progetto.id, projectName: progetto.name, sintesi: nuovaSintesi, prima: !progetto.sintesi },
      summary: progetto.sintesi ? `Sintesi di ${progetto.name} aggiornata` : `Prima sintesi di ${progetto.name}`,
      sourceEntryId: entry.id,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  passo(`proposte scritte${riepilogo ? ", riepilogo scritto" : ""}${nuovaSintesi ? ", sintesi proposta" : ""}`);
  return { azioni: actions.length + (nuovaSintesi ? 1 : 0), riepilogo: !!riepilogo, sintesi: !!nuovaSintesi, modello };
}
