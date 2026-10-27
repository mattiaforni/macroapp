// Contesto per la trascrizione di una nota vocale (function `trascrivi`): le parole che un riconoscimento
// generico sbaglia. Nome, istruzioni e temi del progetto della nota (i temi sono le sezioni «## » della
// sintesi: per il tennis i colpi, gli spostamenti…) e i nomi delle persone in rubrica.
// Solo filtri di uguaglianza, come in agent.js: non servono indici composti.

const LUNGHEZZA_ISTRUZIONI = 1500;
const MAX_PERSONE = 150;
const MAX_TEMI = 30;

const s = (x) => (typeof x === "string" ? x.trim() : "");

/** I nomi delle sezioni «## » della sintesi di un progetto (gli stessi che usa components/sintesi.js). */
export function temiDellaSintesi(sintesi) {
  return [...new Set(s(sintesi).split("\n").map((r) => r.match(/^##\s+(.+)$/)?.[1]?.trim()).filter(Boolean))].slice(0, MAX_TEMI);
}

export async function contestoTrascrizione(db, uid, projectId) {
  const utente = await db.collection("users").doc(uid).get();
  const hid = utente.exists ? utente.data().householdId || null : null;
  const [mieVoci, vociCasa, progetto] = await Promise.all([
    db.collection("manual_entries").where("ownerUid", "==", uid).where("type", "==", "person").select("name").get(),
    hid ? db.collection("manual_entries").where("householdId", "==", hid).where("visibility", "==", "shared")
      .where("type", "==", "person").select("name").get() : null,
    projectId && typeof projectId === "string" ? db.collection("projects").doc(projectId).get() : null,
  ]);
  const persone = new Set();
  for (const d of [...mieVoci.docs, ...(vociCasa?.docs || [])]) if (s(d.data().name)) persone.add(s(d.data().name));

  const contesto = { persone: [...persone].slice(0, MAX_PERSONE) };
  if (progetto?.exists) {
    const p = progetto.data();
    // Stesso controllo dell'agente: progetto proprio, o condiviso nella propria casa.
    const visibile = p.ownerUid === uid || (p.visibility === "shared" && p.householdId && p.householdId === hid);
    if (visibile) {
      contesto.progetto = s(p.name) || "senza nome";
      contesto.istruzioni = s(p.istruzioni).slice(0, LUNGHEZZA_ISTRUZIONI);
      contesto.temi = temiDellaSintesi(p.sintesi);
    }
  }
  return contesto;
}
