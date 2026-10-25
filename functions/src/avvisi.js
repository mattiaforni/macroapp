// Notifiche push (Firebase Cloud Messaging).
//
// Ogni telefono che le attiva scrive il suo token in users/{uid}.dispositivi.<id> (core/notifiche.js).
// Dopo una scrittura condivisa (spesa, task, lista) l'app chiama la funzione `avvisa`: qui si rilegge
// il documento, si decide se c'è qualcosa da dire e lo si manda agli altri membri della casa, secondo
// le loro preferenze (users/{uid}.notifiche.<categoria>; assente = sì). Mai a chi ha fatto la cosa.
// La banca avvisa solo chi possiede il collegamento (syncBank).
//
// Il messaggio è solo `data` (titolo, testo, url, tag): lo mostra il service worker dell'app (sw.js).
// Nei registri solo codici d'errore, mai testi: il flusso Diagnosi li pubblica e il repository è pubblico.
import { FieldValue } from "firebase-admin/firestore";

export const CATEGORIE = ["spese", "task", "lista", "banca"];
const COLLEZIONI = { expenses: "spese", tasks: "task", shopping_items: "lista" };
const TOKEN_MORTO = /registration-token-not-registered|invalid-registration-token/;
const RECENTI_MS = 30 * 60 * 1000; // la notifica della lista riassume le aggiunte dell'ultima mezz'ora

const EURO = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const euro = (n) => EURO.format(Number(n) || 0);
const nomeDi = (h, uid) => String(h?.memberNames?.[uid] || "").trim().split(/\s+/)[0] || "L'altra persona";
const giorno = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? `${+m[3]} ${MESI[+m[2] - 1]}` : ""; };
const breve = (s, n = 80) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const millis = (x) => (x?.toMillis ? x.toMillis() : x ? new Date(x).getTime() || 0 : 0);

function spesa(d, attore, dest, h) {
  // Le ricorrenti le genera il primo telefono che si apre: nessuno le ha appena fatte.
  if (d.source === "recurring") return null;
  const chi = nomeDi(h, attore);
  const base = { url: "/#/spese", tag: `spesa-${d.id}` };
  if (d.type === "settlement") {
    const testo = d.paidBy === attore ? `${chi} ti ha dato ${euro(d.amount)}`
      : d.paidBy === dest ? `Registrato da ${chi}: hai dato ${euro(d.amount)}`
      : `${euro(d.amount)}, registrato da ${chi}`;
    return { ...base, titolo: "Pareggio", testo };
  }
  const quota = d.split === "full"
    ? (d.paidBy === dest ? `tutta a carico di ${chi}` : "tutta a tuo carico")
    : `a metà, ${euro((Number(d.amount) || 0) / 2)} a testa`;
  const parti = [breve(d.description) || "Spesa", euro(d.amount), quota, d.paidBy === dest ? "pagata da te" : null];
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
 * (categoria null = sempre, per la prova). Toglie i token che FCM non riconosce più.
 * Ritorna quanti telefoni l'hanno ricevuto.
 */
export async function invia(db, uids, categoria, msg) {
  if (!uids.length) return 0;
  const snaps = await db.getAll(...uids.map((u) => db.collection("users").doc(u)));
  const voci = [];
  for (const s of snaps) {
    const u = s.data() || {};
    if (categoria && u.notifiche?.[categoria] === false) continue;
    for (const [id, x] of Object.entries(u.dispositivi || {})) if (x?.token) voci.push({ ref: s.ref, id, token: x.token });
  }
  if (!voci.length) return 0;
  const { getMessaging } = await import("firebase-admin/messaging");
  const res = await getMessaging().sendEachForMulticast({
    tokens: voci.map((v) => v.token),
    data: { titolo: String(msg.titolo), testo: String(msg.testo || ""), url: msg.url || "/", tag: msg.tag || "" },
    webpush: { headers: { Urgency: "high", TTL: String(msg.ttl ?? 86400) } },
  });
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

/**
 * Chiamata dall'app (funzione `avvisa`). { coll, id, evento } dopo una scrittura condivisa:
 * evento "nuovo" (creazione), "fatto" (task completato), "aggiunto" (cosa rimessa in lista).
 * { prova: true } manda una notifica di prova ai telefoni di chi chiama.
 */
export async function avvisaDaApp(db, uid, { coll, id, evento, prova } = {}) {
  if (prova) {
    const inviati = await invia(db, [uid], null, {
      titolo: "Notifiche attive", testo: "Su questo telefono arrivano le cose condivise fatte dall'altra persona.", url: "/#/notifiche", tag: "prova", ttl: 600,
    });
    return { inviati };
  }
  const categoria = COLLEZIONI[coll];
  if (!categoria || typeof id !== "string" || !id || id.includes("/")) return { inviati: 0 };
  const hid = (await db.collection("users").doc(uid).get()).data()?.householdId;
  if (!hid) return { inviati: 0 };
  const [hSnap, dSnap] = await Promise.all([db.collection("households").doc(hid).get(), db.collection(coll).doc(id).get()]);
  const h = hSnap.data();
  const d = dSnap.exists ? { id, ...dSnap.data() } : null;
  if (!h?.members?.includes(uid) || !d || d.householdId !== hid || d.visibility !== "shared") return { inviati: 0 };

  let inviati = 0;
  for (const dest of h.members.filter((m) => m !== uid)) {
    const msg = coll === "expenses" ? spesa(d, uid, dest, h)
      : coll === "tasks" ? await task(db, d, evento, uid, h)
      : await lista(db, d, uid, h);
    if (msg) inviati += await invia(db, [dest], categoria, msg);
  }
  return { inviati };
}

/** Dopo la lettura del mattino (syncBank): a ciascuno le sue spese da confermare, o il consenso interrotto. */
export async function avvisaBanca(db, esiti) {
  for (const e of esiti) {
    const msg = e.interrotto
      ? { titolo: "Banca: collegamento interrotto", testo: "La banca ha chiuso il consenso: rinnovalo dalla pagina Banca.", url: "/#/banca", tag: "banca" }
      : e.created > 0
      ? { titolo: "Spese dalla banca", testo: e.created === 1 ? "1 spesa da confermare" : `${e.created} spese da confermare`, url: "/#/proposte", tag: "banca" }
      : null;
    if (!msg || !e.uid) continue;
    try { await invia(db, [e.uid], "banca", msg); } catch (err) { console.warn("avvisi banca", err.code || err.message); }
  }
}
