// Service worker ARÔMES V&N (scope /recettes/). Fichiers statiques de /recettes/ et bibliothèques versionnées des CDN en cache ;
// pages : réseau d'abord. Supabase : seules les lectures (GET) nécessaires à l'affichage d'une recette déjà consultée sont gardées
// (réseau d'abord, repli sur la copie) ; écritures, authentification, fonctions et signatures ne sont jamais mises en cache.
const VERSION = "aromes-20261120-r9";
const STATIC = VERSION + "-static";
const PAGES = VERSION + "-pages";
const DATA = VERSION + "-data";
const CONFIG = "/assets/js/config.js";
const PRECACHE = [
  "/recettes/assets/recettes.css", "/recettes/assets/recettes.js",
  "/recettes/assets/logo-aromes-vn-recadre.svg", "/recettes/assets/logo-aromes-vn-fond.svg", "/recettes/manifest.webmanifest", CONFIG
];
const IMMUTABLE = /^https:\/\/(cdn\.jsdelivr\.net\/npm\/[^/]+@\d|fonts\.gstatic\.com\/)/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("aromes-") && k !== STATIC && k !== PAGES && k !== DATA).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (IMMUTABLE.test(req.url)) return e.respondWith(immutable(req));
  if (/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)) {
    if (SB_LECTURE.test(url.pathname) && recipeQuery(url)) return e.respondWith(donnees(e, req, url.href));
    if (SB_IMAGE.test(url.pathname) && req.mode === "cors") return e.respondWith(donnees(e, req, url.origin + url.pathname)); // clé sans le jeton, qui change à chaque signature
    return;
  }
  if (url.origin !== self.location.origin || url.pathname === "/recettes/sw.js") return;
  if (!url.pathname.startsWith("/recettes/") && url.pathname !== CONFIG) return; // config.js (adresse Supabase) est lu par chaque page : sans lui, rien ne s'affiche hors ligne
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

// ---- lecture des recettes hors ligne (phase 3)
const SB_LECTURE = /^\/rest\/v1\/(recipes|recipe_ingredient_lines|recipe_steps|recipe_photos)$/;
const SB_IMAGE = /^\/storage\/v1\/object\/sign\/recipes\//;
// Une seule recette à la fois (id= ou recipe_id=) : on ne garde jamais de listes entières.
function recipeQuery(url) { return /^eq\.[0-9a-f-]{36}$/i.test(url.searchParams.get("id") || url.searchParams.get("recipe_id") || ""); }
async function prevenir(e) {
  try {
    const c = (e.clientId && await self.clients.get(e.clientId)) || null;
    if (c) return c.postMessage({ type: "ar-hors-ligne" });
    (await self.clients.matchAll({ type: "window" })).forEach((x) => x.postMessage({ type: "ar-hors-ligne" }));
  } catch (err) { /* sans conséquence */ }
}
// Images : seulement en mode CORS (attribut crossorigin des <img> de la fiche), pour éviter les réponses opaques, très coûteuses en quota.
// Réseau d'abord (8 s si une copie existe), sinon copie enregistrée + bandeau « Hors ligne : version enregistrée ».
async function donnees(e, req, key) {
  const cache = await caches.open(DATA);
  const net = fetch(req).then((res) => { if (res.ok && res.type !== "opaque") cache.put(key, res.clone()); return res; });
  net.catch(() => {});
  const hit = () => cache.match(key, { ignoreVary: true });
  const secours = async () => { const c = await hit(); if (c) { e.waitUntil(prevenir(e)); return c; } return null; };
  try {
    const cached = await hit();
    if (!cached) return await net;
    return await Promise.race([net, new Promise((ok, ko) => setTimeout(() => ko(new Error("lent")), 8000))]);
  } catch (err) {
    const c = await secours();
    if (c) return c;
    return Response.error();
  }
}

// ---- notifications push (phase 5) : le corps reçu est { title, body, url, tag, kind, icon }
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  const titre = typeof d.title === "string" && d.title ? d.title : "ARÔMES V&N";
  e.waitUntil(self.registration.showNotification(titre, {
    body: typeof d.body === "string" ? d.body : "", tag: typeof d.tag === "string" ? d.tag : undefined,
    icon: typeof d.icon === "string" ? d.icon : "/recettes/assets/logo-aromes-vn-fond.svg",
    data: { url: typeof d.url === "string" ? d.url : "/recettes/" }
  }));
});
// Ouvre l'adresse de la notification (limitée à /recettes/) en réutilisant un onglet déjà ouvert.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  let cible = new URL("/recettes/", self.location.origin);
  try { const u = new URL((e.notification.data && e.notification.data.url) || "/recettes/", self.location.origin); if (u.origin === self.location.origin && u.pathname.startsWith("/recettes/")) cible = u; } catch { /* adresse invalide */ }
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((onglets) => {
    const ouvert = onglets.find((c) => new URL(c.url).pathname.startsWith("/recettes/"));
    if (ouvert) return ouvert.focus().then((c) => (c && "navigate" in c ? c.navigate(cible.href) : c)).catch(() => self.clients.openWindow(cible.href));
    return self.clients.openWindow(cible.href);
  }));
});
