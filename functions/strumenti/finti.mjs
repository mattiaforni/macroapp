// Firestore e Google Drive finti, in memoria, per le prove delle functions senza rete (22/11: cartelle dei progetti,
// copia leggibile, novità da Drive, connettore MCP). Uso: import { dbFinto, driveFinto } from "./finti.mjs".
//
// dbFinto(DATI): DATI = { collezione: { id: { ...campi } } }, modificato sul posto. Supporta doc().get/set(merge)/update
// (anche «a.b» e i FieldValue: serverTimestamp, delete, increment, arrayUnion), delete, where (==, !=, >, >=, <, <=, in,
// array-contains), orderBy, limit, select, get, getAll, runTransaction, batch.
//
// driveFinto(): { files, fetch, token(uid, email, permessi?) }. `fetch` risponde alle chiamate a www.googleapis.com/drive
// e /upload/drive come Drive v3, per le parti che l'app usa; ogni token è di una persona (email) e vede i file che ha
// creato o che le sono stati condivisi. Gli altri indirizzi passano a `altro(url, opts)`.

const ts = (d) => ({ toMillis: () => d.getTime(), toDate: () => d, _ts: true });
const valore = (x) => (x?._ts ? x.toMillis() : x instanceof Date ? x.getTime() : x);

function applica(base, campi, { merge = true } = {}) {
  const out = merge ? structuredCloneSicuro(base || {}) : {};
  for (const [k, v] of Object.entries(campi)) {
    const parti = k.split(".");
    let o = out;
    for (const p of parti.slice(0, -1)) { if (typeof o[p] !== "object" || o[p] === null) o[p] = {}; o = o[p]; }
    const ult = parti[parti.length - 1];
    const nome = v?.constructor?.name;
    if (nome === "DeleteTransform") delete o[ult];
    else if (nome === "ServerTimestampTransform") o[ult] = ts(new Date());
    else if (nome === "NumericIncrementTransform") o[ult] = (Number(o[ult]) || 0) + Number(v.operand ?? v._operand ?? 1);
    else if (nome === "ArrayUnionTransform") o[ult] = [...new Set([...(o[ult] || []), ...(v.elements || v._elements || [])])];
    else o[ult] = pulisci(v);
  }
  return out;
}
/** Un valore scritto: i FieldValue dentro gli oggetti diventano valori (serverTimestamp → adesso). */
function pulisci(v) {
  const nome = v?.constructor?.name;
  if (nome === "ServerTimestampTransform") return ts(new Date());
  if (v instanceof Date || v?._ts || v === null || typeof v !== "object") return v;
  if (Buffer.isBuffer(v)) return v;
  if (Array.isArray(v)) return v.map(pulisci);
  const o = {};
  for (const [k, x] of Object.entries(v)) if (x?.constructor?.name !== "DeleteTransform") o[k] = pulisci(x);
  return o;
}
function structuredCloneSicuro(o) {
  if (o === null || typeof o !== "object" || o._ts || o instanceof Date || Buffer.isBuffer(o)) return o;
  if (Array.isArray(o)) return o.map(structuredCloneSicuro);
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, structuredCloneSicuro(v)]));
}
/** set con merge: gli oggetti annidati si uniscono (come Firestore), i FieldValue si applicano. */
function unisci(base, campi) {
  const out = structuredCloneSicuro(base || {});
  for (const [k, v] of Object.entries(campi)) {
    const nome = v?.constructor?.name;
    if (nome === "DeleteTransform") delete out[k];
    else if (nome) out[k] = applica({ [k]: out[k] }, { [k]: v })[k];
    else if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !v._ts && !Buffer.isBuffer(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) out[k] = unisci(out[k], v);
    else out[k] = pulisci(v);
  }
  return out;
}
const leggiCampo = (d, f) => f.split(".").reduce((o, p) => (o == null ? undefined : o[p]), d);

export function dbFinto(DATI = {}) {
  const coll = (n) => (DATI[n] ||= {});
  let seq = 0;
  const docRef = (n, id) => ({
    id, path: `${n}/${id}`,
    async get() { const d = coll(n)[id]; return { id, exists: !!d, ref: docRef(n, id), data: () => (d ? structuredCloneSicuro(d) : undefined) }; },
    async set(v, o = {}) { coll(n)[id] = o.merge || o.mergeFields ? unisci(coll(n)[id], v) : pulisci(v); },
    async update(v) { if (!coll(n)[id]) { const e = new Error(`NOT_FOUND ${n}/${id}`); e.code = 5; throw e; } coll(n)[id] = applica(coll(n)[id], v); },
    async delete() { delete coll(n)[id]; },
    collection: (sub) => query(`${n}/${id}/${sub}`),
  });
  function query(n, filtri = [], ordine = [], quanti = Infinity) {
    return {
      doc: (id) => docRef(n, id ?? `auto${++seq}`),
      where: (f, op, v) => query(n, [...filtri, [f, op, v]], ordine, quanti),
      orderBy: (f, dir = "asc") => query(n, filtri, [...ordine, [f, dir]], quanti),
      limit: (k) => query(n, filtri, ordine, k),
      select: () => query(n, filtri, ordine, quanti),
      async add(v) { const r = docRef(n, `auto${++seq}`); await r.set(v); return r; },
      async get() {
        let docs = Object.entries(coll(n)).filter(([, d]) => filtri.every(([f, op, v]) => {
          const x = valore(leggiCampo(d, f)), y = valore(v);
          switch (op) {
            case "==": return x === y;
            case "!=": return x !== y && x !== undefined;
            case ">": return x !== undefined && x > y;
            case ">=": return x !== undefined && x >= y;
            case "<": return x !== undefined && x < y;
            case "<=": return x !== undefined && x <= y;
            case "in": return y.includes(x);
            case "array-contains": return Array.isArray(leggiCampo(d, f)) && leggiCampo(d, f).includes(v);
            default: throw new Error(`operatore ${op}`);
          }
        }));
        for (const [f, dir] of [...ordine].reverse()) {
          docs.sort(([, a], [, b]) => { const x = valore(leggiCampo(a, f)), y = valore(leggiCampo(b, f)); return (x > y ? 1 : x < y ? -1 : 0) * (dir === "desc" ? -1 : 1); });
        }
        docs = docs.slice(0, quanti);
        const out = docs.map(([id, d]) => ({ id, exists: true, ref: docRef(n, id), data: () => structuredCloneSicuro(d) }));
        return { docs: out, empty: !out.length, size: out.length };
      },
    };
  }
  const db = {
    DATI,
    collection: (n) => query(n),
    getAll: (...refs) => Promise.all(refs.map((r) => r.get())),
    async runTransaction(fn) {
      return fn({ get: (r) => r.get(), set: (r, v, o) => r.set(v, o), update: (r, v) => r.update(v), delete: (r) => r.delete() });
    },
    batch() {
      const op = [];
      return { set: (r, v, o) => op.push(() => r.set(v, o)), update: (r, v) => op.push(() => r.update(v)), delete: (r) => op.push(() => r.delete()),
        async commit() { for (const f of op) await f(); } };
    },
  };
  return db;
}

// ───────────── Google Drive ─────────────

const CARTELLA = "application/vnd.google-apps.folder";
const DOC = "application/vnd.google-apps.document";

export function driveFinto({ altro = null } = {}) {
  const files = new Map();   // id → file
  const tokens = new Map();  // token → { email, uid }
  let n = 0, orologio = Date.parse("2026-11-22T08:00:00Z");
  const chiamate = [];
  const rifiuti = { aggiornamenti: 0 }; // per le prove: quante sostituzioni di contenuto rifiutare
  const adesso = () => new Date((orologio += 1000)).toISOString();
  const vede = (f, chi) => f.proprietario === chi.email || f.permessi.some((p) => p.emailAddress === chi.email)
    || f.parents.some((p) => files.has(p) && vede(files.get(p), chi));
  const pubblico = (f, campi = "") => {
    const out = { id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, trashed: f.trashed, webViewLink: f.webViewLink,
      modifiedTime: f.modifiedTime, createdTime: f.createdTime, version: String(f.version), appProperties: f.appProperties, size: String(f.contenuto?.length || 0),
      lastModifyingUser: { emailAddress: f.ultimoAutore, me: false }, owners: [{ emailAddress: f.proprietario }] };
    return out;
  };
  const risposta = (status, j) => new Response(j === undefined ? null : typeof j === "string" ? j : JSON.stringify(j), { status, headers: { "content-type": typeof j === "string" ? "text/plain" : "application/json" } });
  const errore = (status, reason) => risposta(status, { error: { code: status, message: reason, errors: [{ reason }] } });

  function nuovo(meta, chi, contenuto = null) {
    const id = `f${++n}`;
    const doc = meta.mimeType === DOC;
    const f = {
      id, name: meta.name || "Senza titolo", mimeType: meta.mimeType || "application/octet-stream", parents: meta.parents || ["root"],
      appProperties: meta.appProperties || {}, description: meta.description || "", trashed: false, proprietario: chi.email, ultimoAutore: chi.email,
      permessi: [], version: 1, createdTime: adesso(), modifiedTime: "", contenuto: contenuto == null ? null : Buffer.from(contenuto),
      webViewLink: meta.mimeType === CARTELLA ? `https://drive.google.com/drive/folders/${id}` : doc ? `https://docs.google.com/document/d/${id}/edit` : `https://drive.google.com/file/d/${id}/view`,
      app: true,
    };
    f.modifiedTime = f.createdTime;
    files.set(id, f);
    return f;
  }

  /** Il testo di una query `q` di Drive → filtro. Capisce le forme che l'app usa. */
  function filtroDa(q, chi) {
    const parti = [];
    for (const m of q.matchAll(/appProperties has \{ key='([^']+)' and value='([^']*)' \}/g)) parti.push((f) => f.appProperties?.[m[1]] === m[2]);
    const resto = q.replace(/appProperties has \{[^}]*\}/g, "");
    if (/trashed = false/.test(resto)) parti.push((f) => !f.trashed);
    for (const m of resto.matchAll(/mimeType (!?=) '([^']+)'/g)) parti.push((f) => (m[1] === "=" ? f.mimeType === m[2] : f.mimeType !== m[2]));
    const genitori = [...resto.matchAll(/'([^']+)' in parents/g)].map((m) => m[1]);
    if (genitori.length) parti.push((f) => f.parents.some((p) => genitori.includes(p)));
    for (const m of resto.matchAll(/name contains '([^']+)'/g)) parti.push((f) => f.name.toLowerCase().includes(m[1].toLowerCase()));
    for (const m of resto.matchAll(/modifiedTime > '([^']+)'/g)) parti.push((f) => f.modifiedTime > m[1]);
    return (f) => vede(f, chi) && parti.every((p) => p(f));
  }

  function multipart(corpo, tipo) {
    const confine = /boundary=([^;]+)/.exec(tipo)[1];
    const testo = corpo.toString("latin1");
    const pezzi = testo.split(`--${confine}`).slice(1, -1).map((p) => p.replace(/^\r\n/, ""));
    const separa = (p) => { const i = p.indexOf("\r\n\r\n"); return [p.slice(0, i), p.slice(i + 4).replace(/\r\n$/, "")]; };
    const [, meta] = separa(pezzi[0]);
    const [testaDati, dati] = separa(pezzi[1]);
    return { meta: JSON.parse(Buffer.from(meta, "latin1").toString("utf8")), mime: /content-type: ([^\r\n]+)/i.exec(testaDati)?.[1] || "", dati: Buffer.from(dati, "latin1") };
  }

  async function gestisci(url, opts = {}) {
    const u = new URL(url);
    const metodo = (opts.method || "GET").toUpperCase();
    const chi = tokens.get(String(opts.headers?.Authorization || opts.headers?.authorization || "").replace(/^Bearer /, ""));
    chiamate.push(`${metodo} ${u.pathname}${u.search ? "?" + [...u.searchParams.keys()].join("&") : ""}`);
    if (!chi) return errore(401, "authError");
    const corpo = opts.body == null ? null : Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(String(opts.body));
    const parti = u.pathname.replace(/^\/(upload\/)?drive\/v3\//, "").split("/");
    const upload = u.pathname.startsWith("/upload/");
    if (parti[0] !== "files") return errore(404, "notFound");
    const id = parti[1];
    if (!id) {
      if (metodo === "GET") {
        const q = u.searchParams.get("q") || "";
        const trovati = [...files.values()].filter(filtroDa(q, chi)).sort((a, b) => a.createdTime.localeCompare(b.createdTime));
        return risposta(200, { files: trovati.map((f) => pubblico(f)) });
      }
      if (metodo === "POST") {
        if (!chi.permessi.includes("cartelle")) return errore(403, "insufficientPermissions");
        if (upload) {
          const m = multipart(corpo, opts.headers["content-type"]);
          const daConvertire = m.meta.mimeType === DOC && /^text\//.test(m.mime);
          const f = nuovo(m.meta, chi, daConvertire ? m.dati.toString("utf8") : m.dati);
          f.formatoCaricato = m.mime;
          return risposta(200, pubblico(f));
        }
        const meta = JSON.parse(corpo.toString());
        if ((meta.parents || []).some((p) => !files.has(p) || !vede(files.get(p), chi))) return errore(404, "notFound");
        return risposta(200, pubblico(nuovo(meta, chi)));
      }
    }
    const f = files.get(id);
    if (!f || !vede(f, chi)) return errore(404, "notFound");
    // Con drive.file l'app modifica solo i file che ha creato lei.
    const scrive = () => chi.permessi.includes("cartelle") && f.app;
    if (parti[2] === "permissions") {
      if (!scrive()) return errore(403, "insufficientFilePermissions");
      if (metodo === "GET") return risposta(200, { permissions: [{ id: "p0", type: "user", role: "owner", emailAddress: f.proprietario }, ...f.permessi] });
      if (metodo === "POST") {
        const p = JSON.parse(corpo.toString());
        const nuovoP = { id: `p${++n}`, ...p, notificato: u.searchParams.get("sendNotificationEmail") !== "false" };
        f.permessi.push(nuovoP);
        return risposta(200, { id: nuovoP.id });
      }
      if (metodo === "DELETE") { f.permessi = f.permessi.filter((p) => p.id !== parti[3]); return new Response(null, { status: 204 }); }
    }
    if (parti[2] === "export") {
      if (f.mimeType !== DOC) return errore(400, "exportNotSupported");
      return risposta(200, (f.contenuto || Buffer.from("")).toString("utf8").replace(/<[^>]+>/g, "").trim());
    }
    if (metodo === "GET") {
      if (u.searchParams.get("alt") === "media") return new Response(f.contenuto || Buffer.from(""), { status: 200 });
      return risposta(200, pubblico(f));
    }
    if (metodo === "PATCH") {
      if (!scrive()) return errore(403, "insufficientFilePermissions");
      if (upload && rifiuti.aggiornamenti > 0) { rifiuti.aggiornamenti--; return errore(400, "badRequest"); }
      if (upload) {
        const tipo = opts.headers["content-type"] || "";
        let dati = corpo, meta = {};
        if (/multipart/.test(tipo)) { const m = multipart(corpo, tipo); dati = m.dati; meta = m.meta; }
        f.contenuto = dati;
        Object.assign(f, meta.name ? { name: meta.name } : {});
      } else {
        const meta = corpo ? JSON.parse(corpo.toString()) : {};
        if (meta.name) f.name = meta.name;
        if (meta.trashed !== undefined) f.trashed = meta.trashed;
        if (meta.appProperties) f.appProperties = { ...f.appProperties, ...meta.appProperties };
        const aggiungi = u.searchParams.get("addParents"), togli = u.searchParams.get("removeParents");
        if (aggiungi) f.parents = [...f.parents.filter((p) => p !== togli), aggiungi];
      }
      f.version++; f.modifiedTime = adesso(); f.ultimoAutore = chi.email;
      return risposta(200, pubblico(f));
    }
    if (metodo === "DELETE") { if (!scrive()) return errore(403, "insufficientFilePermissions"); files.delete(id); return new Response(null, { status: 204 }); }
    return errore(400, "badRequest");
  }

  return {
    files, chiamate, rifiuti,
    /** Un permesso di una persona: `permessi` = le spunte di Google (predefinite: Drive e cartelle). */
    token(nome, email, permessi = ["drive", "cartelle"]) { const t = `tok-${nome}`; tokens.set(t, { email, permessi }); return t; },
    /** Una modifica fatta da una persona su Drive (fuori dall'app): nuovo contenuto, nuova versione. */
    modificaAMano(id, email, testo, { quando = null } = {}) {
      const f = files.get(id);
      f.contenuto = Buffer.from(testo); f.version++; f.modifiedTime = quando || adesso(); f.ultimoAutore = email;
      return f;
    },
    /** Un file messo nella cartella da una persona (non dall'app). */
    aggiungiAMano(meta, email, testo, { quando = null } = {}) {
      const f = nuovo(meta, { email }, testo);
      f.app = false;
      if (quando) f.modifiedTime = f.createdTime = quando;
      return f;
    },
    avanza(ms) { orologio += ms; },
    fetch: async (url, opts) => {
      const s = String(url);
      if (/^https:\/\/www\.googleapis\.com\/(upload\/)?drive\/v3\//.test(s)) return gestisci(s, opts);
      if (altro) return altro(s, opts);
      throw new Error(`fetch non previsto: ${s}`);
    },
  };
}
