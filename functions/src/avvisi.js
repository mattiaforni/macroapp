// Notifiche push (Firebase Cloud Messaging).
//
// Ogni telefono che le attiva scrive il suo token in users/{uid}.dispositivi.<id> (core/notifiche.js).
// Dopo una scrittura condivisa (spesa, task, lista) l'app chiama la funzione `avvisa`: qui si rilegge
// il documento, si decide se c'è qualcosa da dire e lo si manda agli altri membri della casa, secondo
// le loro preferenze (users/{uid}.notifiche.<categoria>; assente = sì). Mai a chi ha fatto la cosa.
// Una spesa eliminata non si può rileggere: l'app ne manda una copia ridotta, che qui si ripulisce.
// La banca avvisa solo chi possiede il collegamento (syncBank, o il riepilogo del mattino).
// Calendario, promemoria degli eventi e riepilogo del mattino stanno in avvisi-calendario.js (giroAvvisi).
//
// Di notte (22:30–7:30, ora di Roma) le notifiche arrivano senza suono né vibrazione, salvo che la persona
// l'abbia spento (users.notifiche.silenzio === false): il server lo segna nel messaggio, sw.js lo applica.
//
// Il messaggio è solo `data` (titolo, testo, url, tag, silenzioso): lo mostra il service worker (sw.js).
// Nei registri solo codici d'errore, mai testi: il flusso Diagnosi li pubblica e il repository è pubblico.
import { FieldValue } from "firebase-admin/firestore";

export const CATEGORIE = ["spese", "task", "lista", "calendario", "promemoria", "riepilogo", "diario", "banca"];
const COLLEZIONI = { expenses: "spese", tasks: "task", shopping_items: "lista" };
const TOKEN_MORTO = /registration-token-not-registered|invalid-registration-token/;
const RECENTI_MS = 30 * 60 * 1000; // la notifica della lista riassume le aggiunte dell'ultima mezz'ora
export const FUSO = "Europe/Rome";
// Fascia silenziosa, in minuti dalla mezzanotte (ora di Roma). Lo stesso orario è scritto nella pagina Notifiche.
export const SILENZIO = { da: 22 * 60 + 30, a: 7 * 60 + 30 };

const EURO = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const euro = (n) => EURO.format(Number(n) || 0);
export const nomeDi = (h, uid) => String(h?.memberNames?.[uid] || "").trim().split(/\s+/)[0] || "L'altra persona";
const giorno = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? `${+m[3]} ${MESI[+m[2] - 1]}` : ""; };
export const breve = (s, n = 80) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const millis = (x) => (x?.toMillis ? x.toMillis() : x ? new Date(x).getTime() || 0 : 0);

const PARTI_ROMA = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
const SETTIMANA = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
/** Una data vista da Roma: { giorno: "AAAA-MM-GG", minuti (dalla mezzanotte), ora: "HH:MM", settimana (0 = domenica) }. */
export function oraRoma(d = new Date()) {
  const p = Object.fromEntries(PARTI_ROMA.formatToParts(d).map((x) => [x.type, x.value]));
  return { giorno: `${p.year}-${p.month}-${p.day}`, minuti: +p.hour * 60 + +p.minute, ora: `${p.hour}:${p.minute}`, settimana: SETTIMANA[p.weekday] };
}
/** Siamo nella fascia silenziosa? */
export function notturna(d = new Date()) {
  const { minuti } = oraRoma(d);
  return minuti >= SILENZIO.da || minuti < SILENZIO.a;
}
/** Il giorno ("AAAA-MM-GG", a Roma) di un Timestamp, di una Date o di una stringa; "" se non si legge. */
function giornoDi(x) {
  if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x)) return x.slice(0, 10);
  const ms = millis(x);
  return ms ? oraRoma(new Date(ms)).giorno : "";
}

function quota(d, dest, chi) {
  return d.split === "full"
    ? (d.paidBy === dest ? `tutta a carico di ${chi}` : "tutta a tuo carico")
    : `a metà, ${euro((Number(d.amount) || 0) / 2)} a testa`;
}

/**
 * Spesa o pareggio. evento: "nuovo" (creata), "modificata" (con `prima`, i campi di prima mandati dall'app:
 * si dice cosa è cambiato, e niente se non è cambiato nulla), "eliminata" (d = la copia mandata dall'app).
 */
function spesa(d, attore, dest, h, evento = "nuovo", prima = null) {
  // Le ricorrenti le genera il primo telefono che si apre: nessuno le ha appena fatte.
  if (evento === "nuovo" && d.source === "recurring") return null;
  const chi = nomeDi(h, attore);
  const base = { url: "/#/spese", tag: `spesa-${d.id}` };
  const pareggio = d.type === "settlement";
  if (evento === "eliminata") {
    return { ...base, titolo: `${chi} ha eliminato ${pareggio ? "un pareggio" : "una spesa"}`,
      testo: pareggio ? euro(d.amount) : `${breve(d.description) || "Spesa"} · ${euro(d.amount)}` };
  }
  if (evento === "modificata") {
    if (!prima) return { ...base, titolo: `${chi} ha modificato ${pareggio ? "un pareggio" : "una spesa"}`, testo: `${breve(d.description) || "Spesa"} · ${euro(d.amount)}` };
    const importo = Math.round((Number(d.amount) || 0) * 100) !== Math.round((Number(prima.amount) || 0) * 100);
    const descr = (d.description || "").trim() !== (prima.description || "").trim();
    const divisione = d.split !== prima.split || d.paidBy !== prima.paidBy;
    const data = prima.date && giornoDi(d.date) && giornoDi(d.date) !== prima.date;
    if (!importo && !descr && !divisione && !data) return null;
    const parti = [
      `${breve(d.description) || "Spesa"}${descr && prima.description ? ` (era «${breve(prima.description, 40)}»)` : ""}`,
      `${euro(d.amount)}${importo ? ` (era ${euro(prima.amount)})` : ""}`,
      pareggio ? null : quota(d, dest, chi),
      data ? `data ${giorno(giornoDi(d.date))}` : null,
    ];
    return { ...base, titolo: `${chi} ha modificato ${pareggio ? "un pareggio" : "una spesa"}`, testo: parti.filter(Boolean).join(" · ") };
  }
  if (pareggio) {
    const testo = d.paidBy === attore ? `${chi} ti ha dato ${euro(d.amount)}`
      : d.paidBy === dest ? `Registrato da ${chi}: hai dato ${euro(d.amount)}`
      : `${euro(d.amount)}, registrato da ${chi}`;
    return { ...base, titolo: "Pareggio", testo };
  }
  const parti = [breve(d.description) || "Spesa", euro(d.amount), quota(d, dest, chi), d.paidBy === dest ? "pagata da te" : null];
  return { ...base, titolo: `${chi} ha aggiunto una spesa`, testo: parti.filter(Boolean).join(" · ") };
}

async function task(db, d, evento, attore, h) {
  const chi = nomeDi(h, attore);
  const base = { url: "/#/task", tag: `task-${d.id}` };
  if (evento === "fatto") return d.done ? { ...base, titolo: `Fatto da ${chi}`, testo: breve(d.text, 120) } : null;
  if (evento !== "nuovo" || d.done) return null;
  const progetto = d.projectId ? (await db.collection("projects").doc(d.projectId).get()).data()?.name : null;
  const parti = [breve(d.text, 120), progetto, d.due ? `entro il ${giorno(d.due)}` : null];
  return { ...base, titolo: `${chi} ha aggiunto un task`, testo: parti.filter(Boolean).join(" · ") };
}

async function lista(db, d, attore, h) {
  if (d.done) return null;
  // Una notifica sola che si aggiorna (stesso tag): le cose che la stessa persona ha aggiunto
  // nell'ultima mezz'ora e che sono ancora da comprare.
  const ora = Date.now();
  const snap = await db.collection("shopping_items").where("householdId", "==", d.householdId).where("done", "==", false).get();
  const voci = snap.docs.map((s) => ({ id: s.id, ...s.data() }))
    .filter((x) => x.id === d.id || (x.addedBy === attore && ora - millis(x.addedAt) < RECENTI_MS))
    .sort((a, b) => millis(a.addedAt) - millis(b.addedAt));
  const n = voci.length;
  const nomi = voci.slice(0, 8).map((x) => breve(x.text, 30)).join(", ");
  const chi = nomeDi(h, attore);
  return {
    url: "/#/lista", tag: "lista",
    titolo: n === 1 ? `${chi} ha aggiunto alla lista` : `${chi} ha aggiunto ${n} cose alla lista`,
    testo: n > 8 ? `${nomi} e altre ${n - 8}` : nomi,
  };
}

/**
 * Manda un messaggio a tutti i telefoni di queste persone, salvo chi ha spento la categoria
 * (categoria null = sempre: la prova, Google scollegato). Di notte senza suono (vedi SILENZIO).
 * Toglie i token che FCM non riconosce più. Ritorna quanti telefoni l'hanno ricevuto.
 */
export async function invia(db, uids, categoria, msg, ora = new Date()) {
  if (!uids.length) return 0;
  const snaps = await db.getAll(...uids.map((u) => db.collection("users").doc(u)));
  const notte = notturna(ora);
  const voci = [];
  const messaggi = [];
  for (const s of snaps) {
    const u = s.data() || {};
    if (categoria && u.notifiche?.[categoria] === false) continue;
    const zitto = notte && u.notifiche?.silenzio !== false;
    const data = { titolo: String(msg.titolo), testo: String(msg.testo || ""), url: msg.url || "/", tag: msg.tag || "", ...(zitto ? { silenzioso: "1" } : {}) };
    for (const [id, x] of Object.entries(u.dispositivi || {})) {
      if (!x?.token) continue;
      voci.push({ ref: s.ref, id });
      messaggi.push({ token: x.token, data, webpush: { headers: { Urgency: "high", TTL: String(Math.max(60, Math.round(msg.ttl ?? 86400))) } } });
    }
  }
  if (!messaggi.length) return 0;
  const { getMessaging } = await import("firebase-admin/messaging");
  const res = await getMessaging().sendEach(messaggi);
  const morti = [];
  res.responses.forEach((r, i) => {
    if (r.success) return;
    const codice = r.error?.code || "sconosciuto";
    if (TOKEN_MORTO.test(codice)) morti.push(voci[i]);
    else console.warn("avvisi: notifica non consegnata", codice);
  });
  // App disinstallata o permesso tolto: quel telefono esce dall'elenco.
  await Promise.all(morti.map((v) => v.ref.update({ [`dispositivi.${v.id}`]: FieldValue.delete() }).catch(() => {})));
  return res.successCount;
}

/** La copia di una spesa eliminata mandata dall'app, ridotta ai campi che servono alla notifica. */
function copiaSpesa(c, id) {
  if (!c || typeof c !== "object") return null;
  const amount = Number(c.amount);
  if (!Number.isFinite(amount)) return null;
  return { id, description: breve(c.description, 120), amount, type: c.type === "settlement" ? "settlement" : "",
    visibility: c.visibility === "shared" ? "shared" : "private" };
}
/** I campi di prima di una spesa modificata, mandati dall'app. */
function primaSpesa(p) {
  if (!p || typeof p !== "object") return null;
  return { description: breve(p.description, 120), amount: Number(p.amount) || 0, split: String(p.split || ""),
    paidBy: String(p.paidBy || ""), date: /^\d{4}-\d{2}-\d{2}$/.test(p.date || "") ? p.date : "" };
}

/**
 * Chiamata dall'app (funzione `avvisa`). { coll, id, evento } dopo una scrittura condivisa:
 * evento "nuovo" (creazione), "fatto" (task completato), "aggiunto" (cosa rimessa in lista),
 * "modificata" (spesa, con `prima`), "eliminata" (spesa, con `copia`: il documento non c'è più).
 * { prova: true } manda una notifica di prova ai telefoni di chi chiama.
 */
export async function avvisaDaApp(db, uid, { coll, id, evento, prova, prima, copia } = {}) {
  if (prova) {
    const inviati = await invia(db, [uid], null, {
      titolo: "Notifiche attive", testo: "Su questo telefono arrivano le notifiche di D&D.", url: "/#/notifiche", tag: "prova", ttl: 600,
    });
    return { inviati };
  }
  const categoria = COLLEZIONI[coll];
  if (!categoria || typeof id !== "string" || !id || id.includes("/")) return { inviati: 0 };
  if (["modificata", "eliminata"].includes(evento) && coll !== "expenses") return { inviati: 0 };
  const hid = (await db.collection("users").doc(uid).get()).data()?.householdId;
  if (!hid) return { inviati: 0 };
  const [hSnap, dSnap] = await Promise.all([db.collection("households").doc(hid).get(), db.collection(coll).doc(id).get()]);
  const h = hSnap.data();
  if (!h?.members?.includes(uid)) return { inviati: 0 };
  let d;
  if (evento === "eliminata") {
    // Solo se il documento non c'è davvero più: non si annuncia l'eliminazione di una spesa che esiste.
    d = dSnap.exists ? null : copiaSpesa(copia, id);
  } else {
    d = dSnap.exists ? { id, ...dSnap.data() } : null;
    if (d && d.householdId !== hid) d = null;
  }
  if (!d || d.visibility !== "shared") return { inviati: 0 };

  let inviati = 0;
  for (const dest of h.members.filter((m) => m !== uid)) {
    const msg = coll === "expenses" ? spesa(d, uid, dest, h, evento, evento === "modificata" ? primaSpesa(prima) : null)
      : coll === "tasks" ? await task(db, d, evento, uid, h)
      : await lista(db, d, uid, h);
    if (msg) inviati += await invia(db, [dest], categoria, msg);
  }
  return { inviati };
}

/**
 * Fine dell'analisi di una nota (funzione analyzeEntry): segna la nota come letta (anche se l'app nel frattempo
 * è stata chiusa e non può farlo lei) e, se l'app ha detto di essere passata in secondo piano mentre aspettava
 * (`journal_entries.avvisaAFine`), avvisa chi l'ha chiesta (chi l'ha scritta, o l'altra persona per una nota condivisa). esito: { azioni, riepilogo, sintesiEsito, modello }
 * oppure { errore: "messaggio" }.
 */
export async function fineAnalisi(db, uid, entryId, esito = {}) {
  const ref = db.collection("journal_entries").doc(entryId);
  const n = (await ref.get()).data();
  if (!n || (n.ownerUid !== uid && n.visibility !== "shared")) return 0; // eliminata nel frattempo, o non di chi chiama (analyzeEntry ha già controllato la casa)
  const fuori = n.avvisaAFine === true;
  await ref.update(esito.errore
    ? { analysisError: breve(esito.errore, 300), avvisaAFine: FieldValue.delete() }
    : { analyzed: true, analyzedAt: FieldValue.serverTimestamp(), analysisError: null, modello: esito.modello || null, avvisaAFine: FieldValue.delete() });
  if (!fuori) return 0;
  const titolo = breve(n.titolo, 60) || "Nota del diario";
  let testo;
  if (esito.errore) testo = `Analisi non riuscita: ${breve(esito.errore, 100)}. La nota è salvata.`;
  else {
    const k = esito.azioni || 0;
    const parti = [
      k ? `${k} ${k === 1 ? "proposta" : "proposte"} da confermare` : esito.riepilogo ? "Riepilogo pronto" : "Nessuna azione da proporre",
      esito.sintesiEsito === "invariata" ? "sintesi del progetto invariata" : null,
    ];
    testo = `Analisi pronta: ${parti.filter(Boolean).join(" · ")}`;
  }
  return invia(db, [uid], "diario", { titolo, testo, url: "/#/diario", tag: `nota-${entryId}` });
}

/**
 * Dopo la lettura del mattino (syncBank): a ciascuno le sue spese da confermare, o il consenso interrotto.
 * Chi riceve il riepilogo del mattino (users.notifiche.riepilogo non spento) le trova lì alle 7:30: qui si salta.
 */
export async function avvisaBanca(db, esiti) {
  for (const e of esiti) {
    const msg = e.interrotto
      ? { titolo: "Banca: collegamento interrotto", testo: "La banca ha chiuso il consenso: rinnovalo dalla pagina Banca.", url: "/#/banca", tag: "banca" }
      : e.created > 0
      ? { titolo: "Spese dalla banca", testo: e.created === 1 ? "1 spesa da confermare" : `${e.created} spese da confermare`, url: "/#/spese/banca", tag: "banca" }
      : null;
    if (!msg || !e.uid) continue;
    try {
      const u = (await db.collection("users").doc(e.uid).get()).data() || {};
      if (u.notifiche?.riepilogo !== false) continue;
      await invia(db, [e.uid], "banca", msg);
    } catch (err) { console.warn("avvisi banca", err.code || err.message); }
  }
}
