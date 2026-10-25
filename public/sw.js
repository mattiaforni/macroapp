// Service worker minimo: cache dei file statici dell'app (network-first), nessuna cache delle API Firebase.
const CACHE = "macroapp-v3";
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

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
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

// Notifiche push (Firebase Cloud Messaging). Il server manda solo dati { titolo, testo, url, tag }
// (functions/src/avvisi.js): la notifica la disegna questo service worker. Stesso tag = la nuova
// sostituisce la vecchia senza suonare di nuovo (la lista si aggiorna in una notifica sola).
self.addEventListener("push", (e) => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch (err) { p = {}; }
  const d = p.data || p.notification || p;
  const titolo = d.titolo || d.title || "Debiti e Doveri";
  e.waitUntil(self.registration.showNotification(titolo, {
    body: d.testo || d.body || "",
    tag: d.tag || undefined,
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
