// Service worker minimo: cache dei file statici dell'app (network-first), nessuna cache delle API Firebase.
const CACHE = "macroapp-v4";
const STATIC = ["/", "/index.html", "/manifest.json", "/css/base.css", "/icons/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Condivisione verso l'app (manifest.json → share_target, 14/11): testo e immagini arrivano qui in POST. Le immagini
// vanno nella cache «dd-condivisi» (le prende il Diario e le toglie), il testo nell'indirizzo, poi si apre l'app.
async function condivisione(req) {
  const dati = await req.formData();
  const testo = ["title", "text", "url"].map((k) => dati.get(k)).filter(Boolean).join("\n");
  const foto = dati.getAll("foto").filter((f) => f && typeof f !== "string" && /^image\//.test(f.type || ""));
  if (foto.length) {
    const cache = await caches.open("dd-condivisi");
    await Promise.all((await cache.keys()).map((k) => cache.delete(k)));
    await Promise.all(foto.slice(0, 8).map((f, i) => cache.put(`/condivisi/${i}-${encodeURIComponent(f.name || "foto")}`, new Response(f, { headers: { "content-type": f.type } }))));
  }
  const q = new URLSearchParams({ share: "1", text: testo, ...(foto.length ? { foto: "1" } : {}) });
  return Response.redirect(`/?${q}`, 303);
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === "POST" && url.origin === location.origin && url.pathname === "/condividi") {
    e.respondWith(condivisione(e.request).catch(() => Response.redirect("/?share=1", 303)));
    return;
  }
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Pagine riservate di Firebase (login, configurazione): sempre dalla rete, mai toccate dal service worker.
  if (url.pathname.startsWith("/__/")) return;
  // File dell'app: sempre riconvalidati col server, così un aggiornamento arriva subito.
  const req = e.request.mode === "navigate" ? e.request : new Request(e.request, { cache: "no-cache" });
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/index.html"))),
  );
});

// Notifiche push (Firebase Cloud Messaging). Il server manda solo dati { titolo, testo, url, tag, silenzioso }
// (functions/src/avvisi.js): la notifica la disegna questo service worker. Stesso tag = la nuova
// sostituisce la vecchia senza suonare di nuovo (la lista si aggiorna in una notifica sola).
// `silenzioso` = di notte (22:30–7:30, deciso dal server con le preferenze della persona): niente suono né vibrazione.
self.addEventListener("push", (e) => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch (err) { p = {}; }
  const d = p.data || p.notification || p;
  const titolo = d.titolo || d.title || "Debiti e Doveri";
  e.waitUntil(self.registration.showNotification(titolo, {
    body: d.testo || d.body || "",
    tag: d.tag || undefined,
    silent: d.silenzioso === "1",
    icon: "/icons/icon-192.png",
    lang: "it",
    data: { url: d.url || "/" },
  }));
});

// Tocco sulla notifica: se l'app è aperta la si porta davanti sulla pagina giusta, se no la si apre lì.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const aperte = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const app = aperte.find((c) => new URL(c.url).origin === self.location.origin);
    if (app) {
      await app.focus();
      app.postMessage({ tipo: "apri", url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
