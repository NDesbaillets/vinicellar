// Service worker Vinicellar : lancement rapide depuis l'écran d'accueil et page hors ligne.
// Ne met en cache que les fichiers du site et les bibliothèques versionnées des CDN.
// Supabase (données, photos signées, fonctions IA) et toute requête autre que GET passent sans cache.
const VERSION = "vinicellar-v1";
const STATIC = VERSION + "-static"; // CSS, JS, images, polices
const PAGES = VERSION + "-pages";   // pages déjà visitées
const OFFLINE = "/offline.html";
const PRECACHE = [OFFLINE, "/assets/img/icon.svg", "/assets/img/icon-192.png"];
const MAX_STATIC = 120;
// Fichiers externes immuables (version exacte dans l'adresse) : servis depuis le cache.
const IMMUTABLE = /^https:\/\/(cdn\.jsdelivr\.net\/npm\/[^/]+@\d|fonts\.gstatic\.com\/)/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC && k !== PAGES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (IMMUTABLE.test(req.url)) return e.respondWith(immutable(req));
  if (url.origin !== self.location.origin || url.pathname === "/sw.js") return;
  if (req.mode === "navigate") return e.respondWith(page(req, url));
  if (/\.(?:css|js|png|jpe?g|webp|svg|ico|woff2?|webmanifest)$/.test(url.pathname)) e.respondWith(asset(e, req));
});

// Pages : réseau d'abord ; si le réseau tarde plus de 4 s ou échoue, dernière version visitée, sinon page hors ligne.
// Les liens d'invitation et de mot de passe (jeton à usage unique) ne sont jamais gardés.
async function page(req, url) {
  const keep = !url.search.includes("token_hash");
  const cache = await caches.open(PAGES);
  const key = url.origin + url.pathname; // la même page quel que soit ?loc= ou ?id=
  const cached = keep ? await cache.match(key) : null;
  const net = fetch(req).then((res) => {
    if (keep && res.ok && res.type === "basic") cache.put(key, res.clone());
    return res;
  });
  if (!cached) return net.catch(async () => (await caches.match(OFFLINE)) || Response.error());
  return Promise.race([net, new Promise((ok) => setTimeout(() => ok(cached), 4000))]).catch(() => cached);
}

// Fichiers du site : copie en cache servie tout de suite, mise à jour en arrière-plan.
async function asset(e, req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  const net = fetch(req).then(async (res) => {
    if (res.ok) {
      await cache.put(req, res.clone());
      const keys = await cache.keys();
      if (keys.length > MAX_STATIC) await Promise.all(keys.slice(0, keys.length - MAX_STATIC).map((k) => cache.delete(k)));
    }
    return res;
  });
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
