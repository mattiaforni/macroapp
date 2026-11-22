// Connettore MCP per la chat su claude.ai (22/11, docs/PIANO-DRIVE-MCP.md, passo 4), anche dal telefono.
//
// Cosa fa: la chat legge i dati dell'app con gli strumenti di sola lettura di Chiedi (src/chiedi.js: note, sintesi,
// task, eventi, spese, manuale, lista, documenti di Drive dei progetti) e scrive solo `proposals` (strumento `proponi`,
// anche il tipo «nota» per importare le lezioni passate), che la persona conferma nell'app: CLAUDE.md, regola 5. Stesse
// regole di Chiedi: ogni strumento vede solo ciò che la persona vede nell'app.
//
// Come (requisiti di claude.ai verificati il 22/11: claude.com/docs/connectors/building, …/authentication):
// - trasporto Streamable HTTP senza stato: ogni POST su /mcp è un messaggio JSON-RPC e la risposta è application/json
//   (niente SSE, niente Mcp-Session-Id); le notifiche ricevono 202; GET → 405;
// - OAuth 2.1 con il login di Firebase: questo server è anche il server di autorizzazione. Metadati della risorsa protetta
//   (RFC 9728) e del server (RFC 8414) su /.well-known; registrazione dei client dinamica (RFC 7591) e con documento di
//   metadati (CIMD: client_id = URL https di claude.ai/claude.com/anthropic.com); PKCE S256 obbligatorio; `resource`
//   (RFC 8707) controllato; token di accesso di un'ora e di rinnovo di 60 giorni, ruotati a ogni rinnovo. La pagina di
//   consenso (`/collega-claude`, public/collega-claude.html) fa accedere con Google come l'app e manda l'ID token di
//   Firebase a /oauth/consenti, che lo verifica e crea il codice;
// - un 401 con `WWW-Authenticate: Bearer resource_metadata=…` fa partire l'accesso su claude.ai.
// Tutto passa da Firebase Hosting (riscritture in firebase.json) sull'origine dell'app: https://macroapp-b9bd0.web.app/mcp.
//
// Dati (solo server, regole chiuse): mcp_clienti/{client_id} (client registrati), mcp_codici/{sha256} (codici di
// autorizzazione, 5 minuti, una volta), mcp_token/{sha256} (token: si salva solo l'hash). Nei registri niente contenuti.
import { createHash, randomBytes } from "node:crypto";

export const ORIGINE = "https://macroapp-b9bd0.web.app";
const ORIGINI = [ORIGINE, "https://macroapp-b9bd0.firebaseapp.com"];
const VERSIONI = ["2025-11-25", "2025-06-18", "2025-03-26"];
const CALLBACK = ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"];
const CIMD_HOST = /(^|\.)(claude\.ai|claude\.com|anthropic\.com)$/;
const SCOPE = "dati";
const ACCESSO_S = 3600;
const RINNOVO_MS = 60 * 86400e3;
const CODICE_MS = 5 * 60e3;
const MAX_IN_ATTESA = 200; // proposte della chat ancora da confermare, per persona
const VERSIONE_SERVER = "1.0.0";

const s = (x) => (typeof x === "string" ? x.trim() : "");
const sha = (x) => createHash("sha256").update(String(x)).digest("hex");
const casuale = (n = 32) => randomBytes(n).toString("base64url");
const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** L'origine pubblica della richiesta (quella che la persona ha scritto su claude.ai), tra quelle dell'app. */
export function origineDi(req) {
  const host = s(String(req.headers?.["x-forwarded-host"] || req.headers?.host || "").split(",")[0]);
  const o = `https://${host}`;
  return ORIGINI.includes(o) ? o : ORIGINE;
}

/** Un indirizzo di ritorno ammesso: il callback di claude.ai (o claude.com), o il loopback di un client sul computer. */
export function ritornoAmmesso(u) {
  try {
    const x = new URL(u);
    if (x.hash) return false;
    if (CALLBACK.includes(`${x.origin}${x.pathname}`) && !x.search) return true;
    return x.protocol === "http:" && (x.hostname === "localhost" || x.hostname === "127.0.0.1");
  } catch (e) { return false; }
}

// ───────────── Metadati ─────────────

export function metadatiRisorsa(o) {
  return { resource: `${o}/mcp`, authorization_servers: [o], bearer_methods_supported: ["header"], scopes_supported: [SCOPE],
    resource_name: "Debiti e Doveri", resource_documentation: `${o}/collega-claude` };
}
export function metadatiServer(o) {
  return {
    issuer: o, authorization_endpoint: `${o}/collega-claude`, token_endpoint: `${o}/oauth/token`, registration_endpoint: `${o}/oauth/registra`,
    response_types_supported: ["code"], response_modes_supported: ["query"], grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: [SCOPE],
    client_id_metadata_document_supported: true, service_documentation: `${o}/collega-claude`,
  };
}

// ───────────── Client ─────────────

class ErroreOAuth extends Error {
  constructor(codice, testo, status = 400) { super(testo); this.codice = codice; this.status = status; }
}

/** Il client: registrato qui (DCR) o descritto dal suo documento di metadati (CIMD). { id, nome, ritorni }. */
export async function clienteDi(db, clientId, { fetchFn = fetch } = {}) {
  const id = s(clientId);
  if (!id) throw new ErroreOAuth("invalid_client", "client_id mancante");
  if (/^https:\/\//.test(id)) {
    let u;
    try { u = new URL(id); } catch (e) { throw new ErroreOAuth("invalid_client", "client_id non valido"); }
    if (!CIMD_HOST.test(u.hostname)) throw new ErroreOAuth("invalid_client", "Client non ammesso");
    const r = await fetchFn(id, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000), redirect: "error" })
      .catch(() => null);
    const m = r?.ok ? await r.json().catch(() => null) : null;
    if (!m || m.client_id !== id || !Array.isArray(m.redirect_uris)) throw new ErroreOAuth("invalid_client", "Documento del client non valido");
    return { id, nome: s(m.client_name).slice(0, 100) || u.hostname, ritorni: m.redirect_uris.filter(ritornoAmmesso) };
  }
  if (id.includes("/")) throw new ErroreOAuth("invalid_client", "client_id non valido");
  const d = (await db.collection("mcp_clienti").doc(id).get()).data();
  if (!d) throw new ErroreOAuth("invalid_client", "Client sconosciuto");
  return { id, nome: d.nome || "Client", ritorni: d.ritorni || [] };
}

/** Registrazione dinamica (RFC 7591): solo client pubblici con ritorni ammessi. */
export async function registra(db, corpo = {}) {
  const ritorni = Array.isArray(corpo.redirect_uris) ? corpo.redirect_uris.map(String).slice(0, 5) : [];
  if (!ritorni.length || !ritorni.every(ritornoAmmesso)) {
    throw new ErroreOAuth("invalid_redirect_uri", "Indirizzi di ritorno ammessi: quello di claude.ai (https://claude.ai/api/mcp/auth_callback) o un loopback");
  }
  const metodo = s(corpo.token_endpoint_auth_method) || "none";
  if (metodo !== "none") throw new ErroreOAuth("invalid_client_metadata", "Solo client pubblici (token_endpoint_auth_method: none)");
  const id = `dd_${casuale(18)}`;
  const nome = s(corpo.client_name).slice(0, 100) || "Client MCP";
  const { FieldValue } = await import("firebase-admin/firestore");
  await db.collection("mcp_clienti").doc(id).set({ nome, ritorni, creato: FieldValue.serverTimestamp() });
  return { client_id: id, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: nome, redirect_uris: ritorni,
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
}

// ───────────── Autorizzazione ─────────────

/** I parametri della richiesta di autorizzazione, controllati: { cliente, ritorno, stato, sfida, scope, resource }. */
export async function controllaRichiesta(db, q = {}, o, opz = {}) {
  if (s(q.response_type) !== "code") throw new ErroreOAuth("unsupported_response_type", "Serve response_type=code");
  const cliente = await clienteDi(db, q.client_id, opz);
  const ritorno = s(q.redirect_uri);
  if (!ritorno || !cliente.ritorni.includes(ritorno)) throw new ErroreOAuth("invalid_request", "Indirizzo di ritorno non registrato per questo client");
  if (s(q.code_challenge_method) !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(s(q.code_challenge))) throw new ErroreOAuth("invalid_request", "PKCE S256 obbligatorio");
  const resource = s(q.resource).replace(/\/$/, "");
  if (resource && resource.toLowerCase() !== `${o}/mcp`.toLowerCase()) throw new ErroreOAuth("invalid_target", "Risorsa sconosciuta");
  return { cliente, ritorno, stato: s(q.state), sfida: s(q.code_challenge), scope: SCOPE, resource: resource || `${o}/mcp` };
}

/** Dopo il consenso (ID token di Firebase verificato): il codice e l'indirizzo a cui tornare. */
export async function consenti(db, q, o, { verificaIdToken, ...opz }) {
  const r = await controllaRichiesta(db, q, o, opz);
  let chi;
  try { chi = await verificaIdToken(s(q.idToken)); } catch (e) { throw new ErroreOAuth("access_denied", "Accesso non valido: rientra con Google", 401); }
  const profilo = (await db.collection("users").doc(chi.uid).get()).data();
  if (!profilo) throw new ErroreOAuth("access_denied", "Prima entra almeno una volta nell'app", 403);
  const codice = casuale(32);
  await db.collection("mcp_codici").doc(sha(codice)).set({ uid: chi.uid, clientId: r.cliente.id, ritorno: r.ritorno, sfida: r.sfida, scope: r.scope, resource: r.resource, scade: Date.now() + CODICE_MS });
  const u = new URL(r.ritorno);
  u.searchParams.set("code", codice);
  if (r.stato) u.searchParams.set("state", r.stato);
  u.searchParams.set("iss", o);
  return { redirect: u.toString(), cliente: r.cliente.nome };
}

/** Token di accesso e di rinnovo nuovi per una persona e un client. */
async function nuoviToken(db, { uid, clientId, scope, resource }) {
  const accesso = casuale(32), rinnovo = casuale(32);
  const ora = Date.now();
  const batch = db.batch();
  batch.set(db.collection("mcp_token").doc(sha(accesso)), { tipo: "accesso", uid, clientId, scope, resource, scade: ora + ACCESSO_S * 1000, creato: ora });
  batch.set(db.collection("mcp_token").doc(sha(rinnovo)), { tipo: "rinnovo", uid, clientId, scope, resource, scade: ora + RINNOVO_MS, creato: ora });
  await batch.commit();
  return { access_token: accesso, token_type: "Bearer", expires_in: ACCESSO_S, refresh_token: rinnovo, scope };
}

/** L'endpoint dei token: grant_type authorization_code (con PKCE) o refresh_token (con rotazione). */
export async function token(db, corpo = {}, o) {
  const tipo = s(corpo.grant_type);
  const clientId = s(corpo.client_id);
  if (tipo === "authorization_code") {
    const ref = db.collection("mcp_codici").doc(sha(s(corpo.code)));
    // Una volta sola: il codice si cancella appena letto.
    const c = await db.runTransaction(async (t) => { const d = (await t.get(ref)).data(); if (d) t.delete(ref); return d; });
    if (!c || c.scade < Date.now()) throw new ErroreOAuth("invalid_grant", "Codice non valido o scaduto");
    if (clientId && clientId !== c.clientId) throw new ErroreOAuth("invalid_grant", "Codice di un altro client");
    if (s(corpo.redirect_uri) && s(corpo.redirect_uri) !== c.ritorno) throw new ErroreOAuth("invalid_grant", "Indirizzo di ritorno diverso");
    const verifica = s(corpo.code_verifier);
    if (!verifica || b64url(createHash("sha256").update(verifica).digest()) !== c.sfida) throw new ErroreOAuth("invalid_grant", "PKCE non valido");
    const resource = s(corpo.resource).replace(/\/$/, "");
    if (resource && resource.toLowerCase() !== c.resource.toLowerCase()) throw new ErroreOAuth("invalid_target", "Risorsa diversa");
    return nuoviToken(db, { uid: c.uid, clientId: c.clientId, scope: c.scope, resource: c.resource });
  }
  if (tipo === "refresh_token") {
    const ref = db.collection("mcp_token").doc(sha(s(corpo.refresh_token)));
    const r = await db.runTransaction(async (t) => { const d = (await t.get(ref)).data(); if (d?.tipo === "rinnovo") t.delete(ref); return d; });
    if (!r || r.tipo !== "rinnovo" || r.scade < Date.now()) throw new ErroreOAuth("invalid_grant", "Token di rinnovo non valido o scaduto");
    if (clientId && clientId !== r.clientId) throw new ErroreOAuth("invalid_grant", "Token di un altro client");
    return nuoviToken(db, { uid: r.uid, clientId: r.clientId, scope: r.scope, resource: r.resource });
  }
  throw new ErroreOAuth("unsupported_grant_type", "grant_type non gestito");
}

/** Il token di accesso di una richiesta: { uid, clientId } o null. */
export async function chiDalToken(db, intestazione, o) {
  const m = /^Bearer\s+(\S+)$/i.exec(s(intestazione));
  if (!m) return null;
  const d = (await db.collection("mcp_token").doc(sha(m[1])).get()).data();
  if (!d || d.tipo !== "accesso" || d.scade < Date.now()) return null;
  if (d.resource && d.resource.toLowerCase() !== `${o}/mcp`.toLowerCase()) return null;
  return { uid: d.uid, clientId: d.clientId };
}

// ───────────── MCP ─────────────

const TITOLI = {
  cerca_note: "Cerca nelle note", leggi_nota: "Leggi una nota", spese: "Spese", task: "Task", eventi: "Calendario",
  progetti: "Progetti e sintesi", manuale: "Manuale e rubrica", lista: "Lista della spesa", documenti: "Documenti di un progetto",
  leggi_documento: "Leggi un documento", proponi: "Proponi un'azione da confermare",
};

export const ISTRUZIONI = `Dati di «Debiti e Doveri», l'app personale e di coppia di chi ti scrive: diario con note (anche per
progetti, come le lezioni di tennis, con una sintesi per temi), task, spese condivise, lista della spesa, manuale di casa con
la rubrica, calendari di Google, documenti di Drive dei progetti. Gli strumenti vedono solo ciò che la persona vede
nell'app. I risultati portano dei codici (n:…, t:…, e:…, d:…): usali per leggere una nota o un documento, o per proporre di
segnare fatto un task o di spostare un evento. Non cambi niente da solo: «proponi» crea un'azione che la persona conferma o
scarta nell'app (pagina Proposte, o la pagina del progetto); dillo così («te lo propongo nell'app»), mai che l'hai fatto.
Per importare note passate (per esempio le lezioni scritte in questa chat), una «proponi» di tipo nota per ciascuna, con il
giorno in cui è successa e il progetto: confermate, l'agente dell'app le legge come le altre.`;

/** Gli strumenti come li vuole MCP: nome, titolo, descrizione, schema, annotazioni. */
export async function elencoStrumenti() {
  const { STRUMENTI_LETTURA, PROPONI_MCP } = await import("./chiedi.js");
  return [...STRUMENTI_LETTURA, PROPONI_MCP].map((t) => ({
    name: t.name, title: TITOLI[t.name] || t.name, description: t.description, inputSchema: t.input_schema,
    annotations: t.name === "proponi"
      ? { title: TITOLI.proponi, readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
      : { title: TITOLI[t.name] || t.name, readOnlyHint: true, openWorldHint: false },
  }));
}

/** Esegue uno strumento per una persona. Ritorna il risultato MCP { content, structuredContent, isError }. */
export async function chiamaStrumento(db, uid, nome, argomenti = {}, { clientGoogle = null, tokenServer }) {
  const { strumentiDi, contestoDi } = await import("./chiedi.js");
  const nomi = (await elencoStrumenti()).map((t) => t.name);
  if (!nomi.includes(nome)) return { content: [{ type: "text", text: `Strumento sconosciuto: ${nome}` }], isError: true };
  const ctx = await contestoDi(db, uid);
  const permessi = new Map();
  const tokenPer = (u) => (permessi.has(u) ? permessi.get(u) : permessi.set(u, tokenServer(db, u, clientGoogle)).get(u));
  const { esegui, proposte } = strumentiDi(db, { uid, hid: ctx.hid, nomi: ctx.nomi, tokenGoogle: () => tokenPer(uid), tokenPer,
    casa: ctx.casa, utente: ctx.utente, stabili: true, conNota: true });
  if (nome === "proponi") {
    const n = (await db.collection("proposals").where("ownerUid", "==", uid).where("status", "==", "pending").get()).docs.filter((d) => d.data().source === "mcp").length;
    if (n >= MAX_IN_ATTESA) return risultato({ errore: `Ci sono già ${n} proposte della chat da confermare nell'app: aspetta che la persona le guardi.` });
  }
  let out;
  try { out = await esegui[nome](argomenti || {}); } catch (e) { out = { errore: `Non riuscito: ${String(e.message).slice(0, 200)}` }; }
  if (nome === "proponi" && out?.ok && proposte.length) {
    const p = proposte[proposte.length - 1];
    const { FieldValue } = await import("firebase-admin/firestore");
    const ref = db.collection("proposals").doc();
    await ref.set({
      ownerUid: uid, householdId: ctx.hid || null, visibility: "private", kind: p.kind, source: "mcp", status: "pending",
      payload: p.payload, summary: p.summary, sourceEntryId: null, ...(p.projectId ? { projectId: p.projectId } : {}),
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    out = { ok: true, nota: "Proposta creata: la persona la conferma o la scarta nell'app (pagina Proposte" + (p.projectId ? " e pagina del progetto" : "") + ")." };
  }
  return risultato(out);
}
const risultato = (out) => ({ content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out, isError: !!out?.errore });

/** Un messaggio JSON-RPC → la risposta (null per le notifiche). */
export async function rispondiMcp(db, uid, msg, opz) {
  const id = msg?.id;
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const ko = (code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return ko(-32600, "Richiesta non valida");
  if (id === undefined || id === null) return null; // notifica (es. notifications/initialized): niente risposta
  switch (msg.method) {
    case "initialize": {
      const chiesta = s(msg.params?.protocolVersion);
      return ok({ protocolVersion: VERSIONI.includes(chiesta) ? chiesta : VERSIONI[0], capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "debiti-e-doveri", title: "Debiti e Doveri", version: VERSIONE_SERVER }, instructions: ISTRUZIONI });
    }
    case "ping": return ok({});
    case "tools/list": return ok({ tools: await elencoStrumenti() });
    case "tools/call": {
      const nome = s(msg.params?.name);
      const t0 = Date.now();
      const r = await chiamaStrumento(db, uid, nome, msg.params?.arguments || {}, opz);
      console.log(`mcp: ${nome} in ${Date.now() - t0} ms${r.isError ? " (errore)" : ""}`); // niente argomenti né risultati nei registri
      return ok(r);
    }
    case "resources/list": return ok({ resources: [] });
    case "prompts/list": return ok({ prompts: [] });
    default: return ko(-32601, `Metodo non gestito: ${msg.method}`);
  }
}

// ───────────── HTTP ─────────────

/**
 * La function `mcp` (onRequest, dietro Firebase Hosting): instrada metadati, OAuth e MCP. `opz` = { db, verificaIdToken,
 * clientGoogle, tokenServer, fetchFn }.
 */
export async function gestisciHttp(req, res, opz) {
  const { db } = opz;
  const o = origineDi(req);
  const percorso = String(req.path || new URL(req.url || "/", o).pathname).replace(/\/+$/, "") || "/";
  res.set("Cache-Control", "no-store");
  const json = (status, x, intestazioni = {}) => { for (const [k, v] of Object.entries(intestazioni)) res.set(k, v); res.status(status).json(x); };
  const erroreOAuth = (e) => {
    if (e instanceof ErroreOAuth) return json(e.status, { error: e.codice, error_description: e.message });
    console.error("mcp oauth", String(e.message).slice(0, 200));
    return json(500, { error: "server_error", error_description: "Errore del server" });
  };
  try {
    if (/^\/\.well-known\/oauth-protected-resource(\/mcp)?$/.test(percorso)) return json(200, metadatiRisorsa(o), { "Access-Control-Allow-Origin": "*" });
    if (/^\/\.well-known\/(oauth-authorization-server|openid-configuration)(\/mcp)?$/.test(percorso)) return json(200, metadatiServer(o), { "Access-Control-Allow-Origin": "*" });
    if (percorso === "/oauth/registra") {
      if (req.method !== "POST") return json(405, { error: "invalid_request" });
      try { return json(201, await registra(db, req.body || {})); } catch (e) { return erroreOAuth(e); }
    }
    // Per la pagina di consenso (solo nostra): una richiesta non valida risponde 200 con `error`, così il browser non lo
    // segna come errore di rete; la pagina lo mostra e non torna a Claude.
    if (percorso === "/oauth/verifica") {
      try { const r = await controllaRichiesta(db, req.body || {}, o, opz); return json(200, { cliente: r.cliente.nome, ritorno: new URL(r.ritorno).host }); }
      catch (e) { return e instanceof ErroreOAuth ? json(200, { error: e.codice, error_description: e.message }) : erroreOAuth(e); }
    }
    if (percorso === "/oauth/consenti") {
      if (req.method !== "POST") return json(405, { error: "invalid_request" });
      try { return json(200, await consenti(db, req.body || {}, o, opz)); } catch (e) { return erroreOAuth(e); }
    }
    if (percorso === "/oauth/token") {
      if (req.method !== "POST") return json(405, { error: "invalid_request" });
      try { return json(200, await token(db, req.body || {}, o), { Pragma: "no-cache" }); } catch (e) { return erroreOAuth(e); }
    }
    if (percorso === "/mcp") {
      const chi = await chiDalToken(db, req.headers?.authorization, o);
      if (!chi) {
        return json(401, { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Accesso richiesto" } },
          { "WWW-Authenticate": `Bearer resource_metadata="${o}/.well-known/oauth-protected-resource/mcp", scope="${SCOPE}"${req.headers?.authorization ? ', error="invalid_token"' : ""}` });
      }
      if (req.method !== "POST") { res.set("Allow", "POST"); return json(405, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Solo POST" } }); }
      const corpo = req.body;
      if (Array.isArray(corpo)) {
        const risposte = (await Promise.all(corpo.map((m) => rispondiMcp(db, chi.uid, m, opz)))).filter(Boolean);
        return risposte.length ? json(200, risposte) : res.status(202).end();
      }
      const r = await rispondiMcp(db, chi.uid, corpo, opz);
      return r ? json(200, r) : res.status(202).end();
    }
    return json(404, { error: "not_found" });
  } catch (e) {
    console.error("mcp", String(e.message).slice(0, 200));
    return json(500, { jsonrpc: "2.0", id: null, error: { code: -32603, message: "Errore del server" } });
  }
}
