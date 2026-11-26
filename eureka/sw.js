const CACHE = "eureka-static-v16";
const SCOPE = "/eureka/";
const FILES = [
  "/eureka/", "/eureka/fiche.html", "/eureka/editer.html", "/eureka/ajouter.html", "/eureka/rappels.html", "/eureka/agendas.html", "/eureka/planification.html", "/eureka/hors-ligne.html",
  "/eureka/assets/eureka.css", "/eureka/assets/eureka.js", "/eureka/assets/creneaux.js", "/eureka/assets/meteo.js", "/eureka/assets/frontiere-suisse.json",
  "/eureka/assets/p-index.js", "/eureka/assets/p-ajouter.js", "/eureka/assets/p-rappels.js", "/eureka/assets/p-agendas.js", "/eureka/assets/p-planification.js", "/eureka/assets/p-fiche.js", "/eureka/assets/p-editer.js",
  "/eureka/assets/monogramme.svg", "/eureka/assets/icon-192.png", "/eureka/assets/icon-512.png",
  "/eureka/assets/apple-touch-icon.png", "/eureka/manifest.webmanifest",
  "/eureka/assets/polices/cormorant-garamond.woff2", "/eureka/assets/polices/cormorant-garamond-italique.woff2",
  "/eureka/assets/polices/jost.woff2"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith("eureka-static-") && key !== CACHE).map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE);
      return cache.match("/eureka/hors-ligne.html");
    }));
  } else if (FILES.includes(url.pathname)) {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match(url.pathname)) || Response.error();
    }));
  }
});

function notificationUrl(value) {
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin === self.location.origin && ["/eureka/fiche.html", "/eureka/rappels.html"].includes(url.pathname)) return url;
  } catch { /* Une notification mal formée ouvre les rappels. */ }
  return new URL("/eureka/rappels.html", self.location.origin);
}

self.addEventListener("push", (event) => {
  let content;
  try { content = event.data?.json(); } catch { /* Message incomplet. */ }
  const actions = Array.isArray(content?.actions) ? content.actions.filter((item) =>
    item && ["reserver", "disponible", "plus-tard"].includes(item.action) && typeof item.title === "string").slice(0, 2) : [];
  event.waitUntil(self.registration.showNotification("Eurêka", {
    body: typeof content?.body === "string" ? content.body.slice(0, 150) : "Un nouveau rappel vous attend.",
    icon: "/eureka/assets/icon-192.png",
    tag: typeof content?.tag === "string" ? content.tag.slice(0, 60) : undefined,
    actions,
    data: { url: notificationUrl(content?.url).href }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = notificationUrl(event.notification.data?.url);
  if (["reserver", "disponible", "plus-tard"].includes(event.action) && url.pathname === "/eureka/rappels.html") {
    url.searchParams.set("action", event.action);
  }
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
    const open = windows.find((client) => new URL(client.url).pathname.startsWith("/eureka/"));
    if (open) {
      const client = await open.navigate(url.href).catch(() => null);
      if (client) return client.focus();
    }
    return self.clients.openWindow(url.href);
  }));
});
