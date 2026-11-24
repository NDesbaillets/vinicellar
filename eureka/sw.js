const CACHE = "eureka-static-v1";
const SCOPE = "/eureka/";
const FILES = [
  "/eureka/", "/eureka/fiche.html", "/eureka/editer.html", "/eureka/hors-ligne.html",
  "/eureka/assets/eureka.css", "/eureka/assets/eureka.js",
  "/eureka/assets/p-index.js", "/eureka/assets/p-fiche.js", "/eureka/assets/p-editer.js",
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
