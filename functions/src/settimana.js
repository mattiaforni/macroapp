// Revisione della settimana (14/11, dall'analisi dell'app): la domenica sera Claude scrive com'è andata la settimana
// per ciascuno — note e progetti, task fatti e fermi, spese, cosa c'è in calendario — con gli stessi strumenti di
// Chiedi (src/chiedi.js), e una notifica la apre nella pagina Chiedi. È una domanda di tipo «settimana», con le fonti,
// e si può continuare con altre domande. Solo per chi ha un telefono con le notifiche e non ha spento la categoria
// «settimana» (pagina Notifiche): chi non la leggerebbe non la paga.
import { FieldValue } from "firebase-admin/firestore";
import { chiedi } from "./chiedi.js";
import { invia } from "./avvisi.js";

const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

/** «dal 9 al 15 novembre», dal lunedì a oggi (domenica), ora di Roma. */
export function periodo(ora = new Date()) {
  const g = (d) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(d).split("-").map(Number);
  const [, m2, d2] = g(ora);
  const [, m1, d1] = g(new Date(ora.getTime() - 6 * 86400e3));
  return m1 === m2 ? `dal ${d1} al ${d2} ${MESI[m2 - 1]}` : `dal ${d1} ${MESI[m1 - 1]} al ${d2} ${MESI[m2 - 1]}`;
}

/** Prima riga leggibile della risposta, per il testo della notifica. */
export function anteprima(risposta = "") {
  // Le righe di testo, non i titoli delle sezioni.
  const riga = String(risposta).split("\n").filter((r) => !/^\s*#/.test(r)).map((r) => r.replace(/^\s*[-*]\s+|\*\*/g, "").trim()).find((r) => r.length > 8) || "";
  return riga.length > 140 ? `${riga.slice(0, 137).replace(/\s+\S*$/, "")}…` : riga;
}

export async function revisioni(db, { key, clientGoogle = null, ora = new Date() }) {
  const utenti = await db.collection("users").get();
  const quando = periodo(ora);
  for (const u of utenti.docs) {
    const x = u.data() || {};
    const telefoni = Object.values(x.dispositivi || {}).some((d) => d?.token);
    if (!telefoni || x.notifiche?.settimana === false || !x.householdId) continue;
    const ref = db.collection("domande").doc();
    try {
      await ref.set({
        ownerUid: u.id, householdId: x.householdId, visibility: "private", tipo: "settimana",
        turni: [{ domanda: `Com'è andata la settimana ${quando}?`, at: new Date() }],
        stato: "nuova", passi: [], createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      await chiedi(db, u.id, ref.id, { key, clientGoogle, passo: () => {} });
      const risposta = (await ref.get()).data()?.turni?.[0]?.risposta || "";
      await invia(db, [u.id], "settimana", { titolo: `La settimana ${quando}`, testo: anteprima(risposta) || "La revisione è pronta", url: `/#/chiedi/${ref.id}`, tag: "settimana" });
      console.log("revisioneSettimana: fatta", ref.id);
    } catch (err) {
      console.warn("revisioneSettimana: non riuscita", String(err.message).slice(0, 200));
    }
  }
}
