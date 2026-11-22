// Prova del connettore MCP per claude.ai senza rete (22/11, docs/PIANO-DRIVE-MCP.md, passo 4): Firestore finto
// (strumenti/finti.mjs), richieste HTTP finte alla function `mcp` (src/mcp.js → gestisciHttp). Controlla i metadati
// OAuth, la registrazione dei client (solo i ritorni di Claude), il consenso con l'ID token, PKCE e codice usabile una
// volta, i token (rinnovo con rotazione, scadenza), il 401 che fa partire l'accesso, il protocollo MCP (initialize,
// notifiche, strumenti), la privacy degli strumenti (come Chiedi) e le proposte, che sono l'unica cosa che si scrive.
// Uso: node functions/strumenti/prova-mcp.mjs (servono le dipendenze di functions).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dbFinto } from "./finti.mjs";
import { gestisciHttp, ritornoAmmesso } from "../src/mcp.js";

const O = "https://macroapp-b9bd0.web.app";
const ts = (x) => ({ toMillis: () => new Date(x).getTime(), toDate: () => new Date(x) });
const DATI = {
  households: { casa: { members: ["io", "lei"], memberNames: { io: "Mattia Rossi", lei: "Giulia Bianchi" } } },
  users: { io: { householdId: "casa", email: "mattia@example.com" }, lei: { householdId: "casa" } },
  projects: {
    tennis: { ownerUid: "io", householdId: "casa", visibility: "private", name: "Tennis", istruzioni: "Riassumi la lezione", sintesi: "## Dritto\nStato: migliora", createdAt: ts("2026-10-01") },
    casa: { ownerUid: "lei", householdId: "casa", visibility: "shared", name: "Casa al mare", createdAt: ts("2026-10-02") },
    suo: { ownerUid: "lei", householdId: "casa", visibility: "private", name: "Il suo", createdAt: ts("2026-10-03") },
  },
  journal_entries: {
    n1: { ownerUid: "io", householdId: "casa", visibility: "private", projectId: "tennis", titolo: "Rovescio", text: "Lezione: rovescio a due mani.", createdAt: ts("2026-10-12T18:00:00Z") },
    n2: { ownerUid: "lei", householdId: "casa", visibility: "private", titolo: "Privata di lei", text: "Rovescio segreto.", createdAt: ts("2026-10-13T18:00:00Z") },
  },
  tasks: {
    t1: { ownerUid: "io", householdId: "casa", visibility: "private", text: "Comprare le corde", done: false, projectId: "tennis", createdAt: ts("2026-11-01") },
    t2: { ownerUid: "lei", householdId: "casa", visibility: "private", text: "Regalo per Mattia", done: false, createdAt: ts("2026-11-02") },
  },
};
const db = dbFinto(DATI);
const verificaIdToken = async (t) => { if (t === "idtoken-io") return { uid: "io" }; throw new Error("token non valido"); };
const fetchFn = async (url) => {
  if (url === "https://claude.ai/oauth/claude-metadata") {
    return new Response(JSON.stringify({ client_id: url, client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method: "none" }), { status: 200 });
  }
  return new Response("no", { status: 404 });
};
const opz = { db, verificaIdToken, fetchFn, clientGoogle: null, tokenServer: async () => { throw Object.assign(new Error("non collegato"), { details: { motivo: "non-collegato" } }); } };

/** Una richiesta alla function come la manda Firebase Hosting; ritorna { status, headers, body }. */
async function chiama(metodo, path, { body = undefined, auth = null, host = "macroapp-b9bd0.web.app" } = {}) {
  const out = { status: 200, headers: {}, body: undefined };
  const res = {
    set(k, v) { out.headers[k.toLowerCase()] = v; return res; },
    status(n) { out.status = n; return res; },
    json(x) { out.body = x; return res; },
    end() { return res; },
  };
  await gestisciHttp({ method: metodo, path, headers: { host, "x-forwarded-host": host, ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body }, res, opz);
  return out;
}
const sfidaDi = (v) => createHash("sha256").update(v).digest("base64url");
const VERIFICA = "verificatore-segreto-lungo-abbastanza-per-pkce-0123456789";
const RITORNO = "https://claude.ai/api/mcp/auth_callback";

// 1. Metadati: risorsa protetta e server di autorizzazione sull'origine dell'app.
const r1 = await chiama("GET", "/.well-known/oauth-protected-resource/mcp");
assert.equal(r1.body.resource, `${O}/mcp`);
assert.deepEqual(r1.body.authorization_servers, [O]);
assert.equal((await chiama("GET", "/.well-known/oauth-protected-resource")).body.resource, `${O}/mcp`);
const m = (await chiama("GET", "/.well-known/oauth-authorization-server")).body;
assert.equal(m.issuer, O);
assert.equal(m.authorization_endpoint, `${O}/collega-claude`);
assert.equal(m.token_endpoint, `${O}/oauth/token`);
assert.equal(m.registration_endpoint, `${O}/oauth/registra`);
assert.deepEqual(m.code_challenge_methods_supported, ["S256"]);
assert.deepEqual(m.token_endpoint_auth_methods_supported, ["none"]);
assert.equal(m.client_id_metadata_document_supported, true, "CIMD: Claude usa la sua identità pubblicata");
assert.equal((await chiama("GET", "/.well-known/oauth-authorization-server", { host: "macroapp-b9bd0.firebaseapp.com" })).body.issuer, "https://macroapp-b9bd0.firebaseapp.com");
assert.equal(r1.headers["cache-control"], "no-store");

// 2. Senza token: 401 con l'indirizzo dei metadati (così claude.ai fa partire l'accesso); GET e token sbagliato idem.
const r2 = await chiama("POST", "/mcp", { body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} } });
assert.equal(r2.status, 401);
assert.match(r2.headers["www-authenticate"], /^Bearer resource_metadata="https:\/\/macroapp-b9bd0\.web\.app\/\.well-known\/oauth-protected-resource\/mcp"/);
assert.equal((await chiama("POST", "/mcp", { auth: "inventato", body: {} })).status, 401);
assert.match((await chiama("POST", "/mcp", { auth: "inventato", body: {} })).headers["www-authenticate"], /error="invalid_token"/);

// 3. Registrazione dinamica: solo i ritorni di Claude (o un loopback); client pubblici.
assert.ok(ritornoAmmesso(RITORNO) && ritornoAmmesso("https://claude.com/api/mcp/auth_callback") && ritornoAmmesso("http://localhost:33418/callback"));
assert.ok(!ritornoAmmesso("https://cattivo.example/callback") && !ritornoAmmesso("https://claude.ai/altro") && !ritornoAmmesso("https://claude.ai.example.com/api/mcp/auth_callback"));
const cattivo = await chiama("POST", "/oauth/registra", { body: { client_name: "Furbo", redirect_uris: ["https://cattivo.example/cb"] } });
assert.equal(cattivo.status, 400);
assert.equal(cattivo.body.error, "invalid_redirect_uri");
assert.equal((await chiama("POST", "/oauth/registra", { body: { redirect_uris: [RITORNO], token_endpoint_auth_method: "client_secret_basic" } })).status, 400);
const reg = await chiama("POST", "/oauth/registra", { body: { client_name: "Claude", redirect_uris: [RITORNO], grant_types: ["authorization_code", "refresh_token"], token_endpoint_auth_method: "none" } });
assert.equal(reg.status, 201);
const CID = reg.body.client_id;
assert.match(CID, /^dd_/);
assert.equal(reg.body.token_endpoint_auth_method, "none");

// 4. Verifica della richiesta (la pagina di consenso) e consenso con l'ID token di Firebase.
const richiesta = { response_type: "code", client_id: CID, redirect_uri: RITORNO, state: "stato-1", code_challenge: sfidaDi(VERIFICA), code_challenge_method: "S256", scope: "dati", resource: `${O}/mcp` };
const v = await chiama("POST", "/oauth/verifica", { body: richiesta });
assert.equal(v.status, 200);
assert.deepEqual(v.body, { cliente: "Claude", ritorno: "claude.ai" });
assert.equal((await chiama("POST", "/oauth/verifica", { body: { ...richiesta, redirect_uri: "https://cattivo.example/cb" } })).body.error, "invalid_request", "ritorno non registrato");
assert.equal((await chiama("POST", "/oauth/verifica", { body: { ...richiesta, code_challenge_method: "plain" } })).body.error, "invalid_request", "PKCE S256 obbligatorio");
assert.equal((await chiama("POST", "/oauth/consenti", { body: { ...richiesta, redirect_uri: "https://cattivo.example/cb", idToken: "idtoken-io" } })).status, 400, "il consenso ricontrolla tutto");
assert.equal((await chiama("POST", "/oauth/verifica", { body: { ...richiesta, resource: "https://altro.example/mcp" } })).body.error, "invalid_target");
assert.equal((await chiama("POST", "/oauth/consenti", { body: { ...richiesta, idToken: "falso" } })).status, 401, "ID token falso");
const c = await chiama("POST", "/oauth/consenti", { body: { ...richiesta, idToken: "idtoken-io" } });
assert.equal(c.status, 200);
const ritorno = new URL(c.body.redirect);
assert.equal(`${ritorno.origin}${ritorno.pathname}`, RITORNO);
assert.equal(ritorno.searchParams.get("state"), "stato-1");
assert.equal(ritorno.searchParams.get("iss"), O);
const codice = ritorno.searchParams.get("code");
assert.ok(codice && !DATI.mcp_codici[codice], "nel database solo l'hash del codice");

// 5. Token: PKCE sbagliato no; giusto sì (una volta sola).
const sbagliato = await chiama("POST", "/oauth/token", { body: { grant_type: "authorization_code", code: codice, client_id: CID, redirect_uri: RITORNO, code_verifier: "altro-verificatore-che-non-va-bene-0123456789-abcdef" } });
assert.equal(sbagliato.body.error, "invalid_grant");
// Il codice si è consumato anche col tentativo sbagliato: se ne chiede un altro.
const c2 = new URL((await chiama("POST", "/oauth/consenti", { body: { ...richiesta, idToken: "idtoken-io" } })).body.redirect).searchParams.get("code");
const t = await chiama("POST", "/oauth/token", { body: { grant_type: "authorization_code", code: c2, client_id: CID, redirect_uri: RITORNO, code_verifier: VERIFICA, resource: `${O}/mcp` } });
assert.equal(t.status, 200);
assert.equal(t.body.token_type, "Bearer");
assert.equal(t.body.expires_in, 3600);
assert.ok(t.body.access_token && t.body.refresh_token);
assert.equal((await chiama("POST", "/oauth/token", { body: { grant_type: "authorization_code", code: c2, client_id: CID, code_verifier: VERIFICA } })).body.error, "invalid_grant", "un codice vale una volta");
assert.ok(!Object.keys(DATI.mcp_token).includes(t.body.access_token), "nel database solo gli hash dei token");
const A = t.body.access_token;

// 6. MCP: initialize, notifiche, strumenti.
const rpc = async (method, params = {}, id = 1) => (await chiama("POST", "/mcp", { auth: A, body: { jsonrpc: "2.0", id, method, params } })).body;
const init = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "Anthropic/ClaudeAI", version: "1" } });
assert.equal(init.result.protocolVersion, "2025-11-25");
assert.equal(init.result.serverInfo.name, "debiti-e-doveri");
assert.ok(init.result.capabilities.tools);
assert.match(init.result.instructions, /proponi/);
assert.equal((await rpc("initialize", { protocolVersion: "1999-01-01" })).result.protocolVersion, "2025-11-25", "versione sconosciuta: la più recente");
const notifica = await chiama("POST", "/mcp", { auth: A, body: { jsonrpc: "2.0", method: "notifications/initialized" } });
assert.equal(notifica.status, 202);
assert.equal((await chiama("GET", "/mcp", { auth: A })).status, 405);
const strumenti = (await rpc("tools/list")).result.tools;
const nomi = strumenti.map((x) => x.name);
for (const n of ["cerca_note", "leggi_nota", "spese", "task", "eventi", "progetti", "manuale", "lista", "documenti", "leggi_documento", "proponi"]) assert.ok(nomi.includes(n), n);
assert.ok(strumenti.every((x) => x.name.length <= 64 && x.title && x.inputSchema?.type === "object"));
assert.equal(strumenti.find((x) => x.name === "cerca_note").annotations.readOnlyHint, true);
assert.equal(strumenti.find((x) => x.name === "proponi").annotations.readOnlyHint, false);
assert.ok(strumenti.find((x) => x.name === "proponi").inputSchema.properties.tipo.enum.includes("nota"));
assert.equal((await rpc("metodo/inventato")).error.code, -32601);

// 7. Privacy come in Chiedi: mai le cose private dell'altra persona. I codici valgono da una chiamata all'altra.
const call = async (name, args) => { const r = (await rpc("tools/call", { name, arguments: args })).result; return { ...r, dati: JSON.parse(r.content[0].text) }; };
const note = await call("cerca_note", { testo: "rovescio" });
assert.deepEqual(note.dati.note.map((x) => x.titolo), ["Rovescio"], "solo le note che vedo");
const cod = note.dati.note[0].codice;
assert.equal(cod, "n:n1", "codice stabile");
assert.match((await call("leggi_nota", { codice: cod })).dati.testo, /due mani/, "il codice vale nella chiamata dopo");
assert.ok((await call("leggi_nota", { codice: "n:n2" })).dati.errore, "una nota privata dell'altra persona no, nemmeno con l'id");
assert.equal((await call("leggi_nota", { codice: "n:n2" })).isError, true);
const task = await call("task", { stato: "aperti" });
assert.deepEqual(task.dati.task.map((x) => x.testo), ["Comprare le corde"]);
assert.deepEqual((await call("progetti", {})).dati.progetti.map((x) => x.nome).sort(), ["Casa al mare", "Tennis"], "non il progetto privato di lei");

// 8. Proposte: l'unica scrittura. Task fatto col codice stabile; nota (una lezione passata) nel progetto; niente sul
// task privato dell'altra persona.
const fatto = await call("proponi", { tipo: "task_fatto", riassunto: "Segna fatto: corde", codice: "t:t1" });
assert.equal(fatto.dati.ok, true);
assert.ok((await call("proponi", { tipo: "task_fatto", riassunto: "x", codice: "t:t2" })).dati.errore, "task privato di lei: no");
const lezione = await call("proponi", { tipo: "nota", riassunto: "Lezione del 3 settembre", titolo: "Prima lezione", testo: "Palleggio da fondo, piedi sempre in movimento.", giorno: "2026-09-03", progetto: "tennis" });
assert.equal(lezione.dati.ok, true);
assert.match(lezione.dati.nota, /pagina del progetto/);
assert.ok((await call("proponi", { tipo: "nota", riassunto: "x", testo: "y", progetto: "Il suo" })).dati.errore, "un progetto che non vedo: no");
const proposte = Object.values(DATI.proposals);
assert.equal(proposte.length, 2);
for (const x of proposte) {
  assert.equal(x.source, "mcp");
  assert.equal(x.status, "pending");
  assert.equal(x.ownerUid, "io");
  assert.equal(x.visibility, "private");
}
const pn = proposte.find((x) => x.kind === "journal_entry");
assert.equal(pn.projectId, "tennis", "compare nella pagina del progetto");
assert.deepEqual({ ...pn.payload, fonte: undefined }, { projectId: "tennis", titolo: "Prima lezione", text: "Palleggio da fondo, piedi sempre in movimento.", giorno: "2026-09-03", analizza: true, fonte: undefined });
assert.equal(proposte.find((x) => x.kind === "task_done").payload.taskId, "t1");
assert.equal(DATI.tasks.t1.done, false, "niente cambia senza conferma");
assert.equal(Object.keys(DATI.journal_entries).length, 2, "nessuna nota scritta");

// 9. Rinnovo con rotazione: il vecchio token di rinnovo non vale più; un token scaduto dà 401.
const r9 = await chiama("POST", "/oauth/token", { body: { grant_type: "refresh_token", refresh_token: t.body.refresh_token, client_id: CID } });
assert.equal(r9.status, 200);
assert.notEqual(r9.body.refresh_token, t.body.refresh_token);
assert.equal((await chiama("POST", "/oauth/token", { body: { grant_type: "refresh_token", refresh_token: t.body.refresh_token, client_id: CID } })).body.error, "invalid_grant");
assert.equal((await chiama("POST", "/mcp", { auth: r9.body.access_token, body: { jsonrpc: "2.0", id: 2, method: "ping" } })).status, 200);
for (const d of Object.values(DATI.mcp_token)) d.scade = Date.now() - 1;
assert.equal((await chiama("POST", "/mcp", { auth: r9.body.access_token, body: { jsonrpc: "2.0", id: 3, method: "ping" } })).status, 401, "scaduto: si rinnova");
assert.equal((await chiama("POST", "/oauth/token", { body: { grant_type: "refresh_token", refresh_token: r9.body.refresh_token } })).body.error, "invalid_grant");

// 10. CIMD: un client descritto da un documento di claude.ai va bene; uno di un altro dominio no.
const cimd = await chiama("POST", "/oauth/verifica", { body: { ...richiesta, client_id: "https://claude.ai/oauth/claude-metadata" } });
assert.equal(cimd.status, 200);
assert.equal(cimd.body.cliente, "Claude");
assert.equal((await chiama("POST", "/oauth/verifica", { body: { ...richiesta, client_id: "https://cattivo.example/meta" } })).body.error, "invalid_client");

assert.equal((await chiama("GET", "/qualcosa")).status, 404);
console.log("prova-mcp: connettore per claude.ai a posto");
