// Service worker ARÔMES V&N (scope /recettes/). Fichiers statiques de /recettes/ et bibliothèques versionnées des CDN en cache ;
// pages : réseau d'abord. Supabase (données, photos signées, fonctions) et toute requête non GET ne sont jamais mis en cache.
const VERSION = "aromes-20261119-r1";
const STATIC = VERSION + "-static";
const PAGES = VERSION + "-pages";
const PRECACHE = [
  "/recettes/assets/recettes.css", "/recettes/assets/recettes.js",
  "/recettes/assets/logo-aromes-vn-recadre.svg", "/recettes/assets/logo-aromes-vn-fond.svg", "/recettes/manifest.webmanifest"
];
const IMMUTABLE = /^https:\/\/(cdn\.jsdelivr\.net\/npm\/[^/]+@\d|fonts\.gstatic\.com\/)/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("aromes-") && k !== STATIC && k !== PAGES).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (IMMUTABLE.test(req.url)) return e.respondWith(immutable(req));
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/recettes/") || url.pathname === "/recettes/sw.js") return;
  if (req.mode === "navigate") return e.respondWith(page(req, url));
  if (/\.(?:css|js|png|jpe?g|webp|svg|ico|woff2?|webmanifest)$/.test(url.pathname)) e.respondWith(asset(e, req));
});

const HORS_LIGNE = () => new Response("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><body style='font-family:Georgia,serif;background:#FBF8F2;color:#2A221E;padding:32px'><h1 style='font-weight:300'>Hors ligne</h1><p>Cette page n'est pas disponible sans connexion. Réessayez dès que le réseau revient.</p>", { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });

// Pages : réseau d'abord (4 s), sinon dernière version visitée. Les liens d'invitation (token_hash) ne sont jamais gardés.
async function page(req, url) {
  const keep = !url.search.includes("token_hash");
  const cache = await caches.open(PAGES);
  const key = url.origin + url.pathname;
  const cached = keep ? await cache.match(key) : null;
  const net = fetch(req).then((res) => { if (keep && res.ok && res.type === "basic") cache.put(key, res.clone()); return res; });
  if (!cached) return net.catch(() => HORS_LIGNE());
  return Promise.race([net, new Promise((ok) => setTimeout(() => ok(cached), 4000))]).catch(() => cached);
}
async function asset(e, req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  const net = fetch(req).then(async (res) => { if (res.ok) await cache.put(req, res.clone()); return res; });
  if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
  try { return await net; } catch (err) { return (await caches.match(req, { ignoreSearch: true })) || Response.error(); }
}
async function immutable(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") cache.put(req, res.clone());
  return res;
}
