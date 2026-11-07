// Diagnosi delle note dei progetti condivisi (flusso Diagnosi, `note`; 7/11: Mattia non vedeva la nota della compagna).
// Solo conteggi, date e sigle: niente testi, nomi né uid, perché le annotazioni del repository sono pubbliche.
// Con ALLINEA=1 fa sul server quello che fa `allineaNote` sul telefono (core/note.js): le note di un progetto condiviso
// diventano condivise, le condivise fuori da un progetto condiviso tornano private; le foto seguono la nota.
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp({ credential: applicationDefault(), projectId: "macroapp-b9bd0" });
const db = getFirestore();
const ALLINEA = process.env.ALLINEA === "1";
const sigla = (id) => String(id || "").slice(0, 4);
const giorno = (t) => (t?.toDate ? t.toDate() : t ? new Date(t) : null)?.toISOString().slice(0, 16).replace("T", " ") ?? "?";

for (const h of (await db.collection("households").get()).docs) {
  const membri = h.data().members || [];
  const chi = (uid) => (membri.indexOf(uid) >= 0 ? `membro ${membri.indexOf(uid) + 1}` : uid ? "fuori casa" : "senza autore");
  console.log(`\nCASA ${sigla(h.id)}: ${membri.length} membri`);

  const progetti = new Map((await db.collection("projects").where("householdId", "==", h.id).get()).docs
    .map((p) => [p.id, { vis: p.data().visibility, di: chi(p.data().ownerUid), arch: !!p.data().archived }]));
  for (const [id, p] of progetti) if (p.vis === "shared") console.log(`progetto condiviso ${sigla(id)} di ${p.di}${p.arch ? " (archiviato)" : ""}`);

  // Le note della casa, più quelle dei membri senza householdId (non dovrebbero esserci).
  const note = new Map((await db.collection("journal_entries").where("householdId", "==", h.id).get()).docs.map((d) => [d.id, d]));
  for (const uid of membri) {
    for (const d of (await db.collection("journal_entries").where("ownerUid", "==", uid).get()).docs) {
      if (!note.has(d.id)) { note.set(d.id, d); console.log(`nota ${sigla(d.id)} di ${chi(uid)} con householdId ${d.data().householdId ? "di un'altra casa" : "assente"}`); }
    }
  }

  const conti = new Map();
  const daCambiare = [];
  for (const d of note.values()) {
    const n = d.data();
    const p = n.projectId ? progetti.get(n.projectId) : null;
    const dove = !n.projectId ? "senza progetto" : !p ? `progetto ${sigla(n.projectId)} che non c'è` : `progetto ${sigla(n.projectId)} ${p.vis === "shared" ? "condiviso" : "privato"}`;
    const k = `${dove} · ${chi(n.ownerUid)} · ${n.visibility || "senza visibilità"}`;
    conti.set(k, (conti.get(k) || 0) + 1);
    const voluta = p?.vis === "shared" ? "shared" : "private";
    if ((n.visibility || "private") !== voluta) daCambiare.push({ d, voluta });
  }
  console.log("\nNOTE per progetto · autore · visibilità");
  for (const [k, v] of [...conti].sort()) console.log(`  ${v}  ${k}`);

  // Le ultime note di ciascuno: si vede se scrive con la versione nuova (visibilità giusta, firma delle modifiche).
  for (const uid of membri) {
    const mie = [...note.values()].filter((d) => d.data().ownerUid === uid)
      .sort((a, b) => (b.data().createdAt?.toMillis?.() || 0) - (a.data().createdAt?.toMillis?.() || 0)).slice(0, 5);
    console.log(`\nULTIME di ${chi(uid)}:`);
    for (const d of mie) {
      const n = d.data();
      const p = n.projectId ? progetti.get(n.projectId) : null;
      console.log(`  ${giorno(n.createdAt)} (agg. ${giorno(n.updatedAt)}) · ${n.projectId ? `progetto ${sigla(n.projectId)} ${p ? p.vis : "che non c'è"}` : "senza progetto"} · ${n.visibility} · foto ${(n.foto || []).length}${n.modificataDa ? ` · modificata da ${chi(n.modificataDa)}` : ""}`);
    }
  }

  console.log(`\nDA ALLINEARE: ${daCambiare.length}${daCambiare.length ? ` (${daCambiare.map(({ d, voluta }) => `${sigla(d.id)}→${voluta}`).join(", ")})` : ""}`);
  if (ALLINEA && daCambiare.length) {
    for (const { d, voluta } of daCambiare) {
      await d.ref.update({ visibility: voluta });
      const foto = await db.collection("journal_photos").where("entryId", "==", d.id).get();
      for (const f of foto.docs) if (f.data().visibility !== voluta) await f.ref.update({ visibility: voluta });
      console.log(`  allineata ${sigla(d.id)} → ${voluta} (foto ${foto.size})`);
    }
  }
}
