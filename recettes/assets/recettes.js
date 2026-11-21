// ARÔMES V&N : socle commun (client Supabase, garde d'authentification, navigation, helpers).
// Ne dépend ni de /assets/css/app.css ni de /assets/js/core.js.

// ---- phase 3 : ajustement des portions (fonctions pures, testables sous Node : tests/portions.test.js).
// Règles : docs/recettes/03-cuisiner-contrat.md §5. On part toujours de la quantité d'origine ; seul l'affichage est arrondi.
(function (root) {
  const EPS = 1e-9;
  const roundHalfUp = (x) => Math.floor(x + 0.5 + EPS);
  const dec = (n) => String(Math.round(n * 100) / 100).replace(".", ",");
  const dec1 = (n) => String(Math.round(n * 10) / 10).replace(".", ",");
  function fmtHalf(n) {
    const w = Math.floor(n + EPS), h = n - w > 0.25;
    return h ? (w ? w + " ½" : "½") : String(w);
  }
  function plural(u, q) {
    const p = q > 1;
    if (u === "piece") return p ? "pièces" : "pièce";
    if (u === "pincee") return p ? "pincées" : "pincée";
    if (u === "botte") return p ? "bottes" : "botte";
    if (u === "gousse") return p ? "gousses" : "gousse";
    if (u === "tranche") return p ? "tranches" : "tranche";
    if (u === "cas") return "c. à soupe";
    if (u === "cac") return "c. à café";
    return u || "";
  }
  const isQb = (p) => /^\s*q\.?\s?b\.?\s*$/i.test(String(p || ""));
  const mk = (num, unit, unitKey) => ({ text: num + (unit ? " " + unit : ""), num, unit: unit || "", unitKey: unitKey || "", changed: true });
  // Masse/volume (g, ml) : arrondi à 5 sous 100, à 10 dès 100 ; au-delà de 1000 : kg / l à une décimale.
  function metric(Q, big, small, smallKey, bigKey) {
    let v = Q < 100 ? Math.round(Q / 5 + EPS) * 5 : Math.round(Q / 10 + EPS) * 10;
    if (v <= 0) v = Math.max(1, Math.round(Q));
    if (v >= 1000) return mk(dec1(v / 1000), big, bigKey);
    return mk(String(v), small, smallKey);
  }
  // Quantité affichée pour une ligne : { text, num, unit, changed }. `changed` faux = valeur d'origine telle quelle.
  function scaleQty(quantity, unit, precision, factor) {
    const q = quantity == null || quantity === "" ? null : Number(quantity);
    const f = Number(factor);
    const orig = () => {
      if (q == null || isNaN(q)) return { text: precision || "q.b.", num: "", unit: "", changed: false, vide: true };
      const u = plural(unit, q), n = dec(q);
      return { text: n + (u ? " " + u : ""), num: n, unit: u, changed: false };
    };
    if (q == null || isNaN(q) || !(f > 0) || Math.abs(f - 1) < EPS || unit === "pincee" || isQb(precision)) return orig();
    const Q = q * f;
    if (unit === "piece" || unit === "gousse" || unit === "botte" || unit === "tranche") {
      let n = roundHalfUp(Q);
      if (q > 0 && n < 1) n = 1;
      return mk(String(n), plural(unit, n), unit);
    }
    if (unit === "cas" || unit === "cac") {
      if (Q < 0.25) return { text: "une pointe", num: "une pointe", unit: "", changed: true };
      const h = roundHalfUp(Q * 2) / 2;
      return mk(fmtHalf(h), plural(unit, h), unit);
    }
    if (unit === "g") return metric(Q, "kg", "g", "g", "kg");
    if (unit === "ml") return metric(Q, "l", "ml", "ml", "l");
    if (unit === "cl") {
      const r = metric(Q * 10, "l", "ml", "ml", "l");
      if (r.unit === "ml" && Number(r.num) % 10 === 0) return mk(String(Number(r.num) / 10), "cl", "cl");
      return r;
    }
    if (unit === "kg" || unit === "l") {
      if (Q < 1) return metric(Q * 1000, unit, unit === "kg" ? "g" : "ml", unit === "kg" ? "g" : "ml", unit);
      return mk(dec1(Q), unit, unit);
    }
    // Sans unité (« 3 » œufs saisis sans unité) ou unité inconnue : entier si la quantité d'origine l'est, sinon deux décimales.
    if (!unit && Number.isInteger(q)) { const n = Math.max(1, roundHalfUp(Q)); return mk(String(n), "", ""); }
    return mk(dec(Q), plural(unit, Q), unit);
  }
  const portionFactor = (wanted, servings) => (Number(servings) > 0 && Number(wanted) > 0 ? Number(wanted) / Number(servings) : 1);
  const api = { scaleQty, portionFactor, fmtHalf, roundHalfUp };
  root.ARPure = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

(function () {
  if (typeof window === "undefined") return; // chargé sous Node pour tester les fonctions pures
  const cfg = window.VC_CONFIG || {};
  const sb = window.supabase && cfg.supabaseUrl && cfg.supabaseAnonKey
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) // même stockage de session que Vinicellar
    : null;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const pad = (n) => String(n).padStart(2, "0");
  const fmtDate = (iso) => { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? "" : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };

  // Date sans heure (colonne « date » : AAAA-MM-JJ) en JJ.MM.AAAA, sans passer par le fuseau horaire.
  const fmtDay = (v) => { const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : fmtDate(v); };
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  // « JJ.MM.AAAA » (ou / ou -) saisi à la main -> AAAA-MM-JJ, ou null si la date n'existe pas.
  function parseDay(txt) {
    const m = String(txt || "").trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (!m) return null;
    const d = +m[1], mo = +m[2], y = +m[3], dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }

  const ROLES = { owner: "Propriétaire", member: "Membre", reader: "Lecteur" };
  const COURSES = { entree: "Entrée", plat: "Plat", dessert: "Dessert", accompagnement: "Accompagnement", base: "Base", boisson: "Boisson", autre: "Autre" };
  const DIFFICULTES = { 1: "Facile", 2: "Moyen", 3: "Difficile" };
  const UNITES = { g: "g", kg: "kg", ml: "ml", cl: "cl", l: "l", cas: "c. à soupe", cac: "c. à café", piece: "pièce", pincee: "pincée", botte: "botte", gousse: "gousse", tranche: "tranche" };

  // Message d'erreur lisible, toujours en français.
  function errMsg(e, fallback) {
    const m = String((e && (e.message || e.error_description)) || "");
    if (e) console.error(e);
    if (/row-level security|permission denied|not allowed|42501/i.test(m + (e && e.code || ""))) return "Cette action n'est pas permise avec votre rôle dans ce carnet.";
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return "Connexion impossible. Vérifiez votre réseau et réessayez.";
    if (/JWT|expired|not authenticated/i.test(m)) return "Votre session a expiré. Reconnectez-vous.";
    if (/duplicate|unique/i.test(m)) return "Cet élément existe déjà.";
    return fallback || "Une erreur est survenue. Réessayez dans un instant.";
  }

  function toast(text, kind) {
    let box = $("#toasts");
    if (!box) { box = document.createElement("div"); box.id = "toasts"; box.className = "toasts"; box.setAttribute("role", "status"); box.setAttribute("aria-live", "polite"); document.body.append(box); }
    const t = document.createElement("div");
    t.className = "toast" + (kind === "erreur" ? " erreur" : "");
    t.textContent = text;
    box.append(t);
    setTimeout(() => t.remove(), kind === "erreur" ? 7000 : 4000);
  }

  function setMsg(el, text, kind) { if (!el) return; el.textContent = text || ""; el.className = "msg" + (kind ? " " + kind : ""); }

  // Redirection interne uniquement vers /recettes/.
  function safeNext(v) {
    return v && /^\/recettes\/[^\\]*$/.test(v) && !v.startsWith("//") ? v : "/recettes/";
  }

  // Préférence de carnet (appareil seulement).
  const PREF = "ar.carnet";
  function getBookPref() { try { return localStorage.getItem(PREF) || "all"; } catch { return "all"; } }
  function setBookPref(v) { try { localStorage.setItem(PREF, v); } catch { /* stockage indisponible */ } }

  // URL signées des photos (bucket privé « recipes »).
  const urlCache = new Map();
  async function signedUrls(paths) {
    const fallback = {};
    const need = [...new Set(paths.filter((p) => p && !urlCache.has(p)))];
    if (need.length && sb) {
      let failed = false;
      try {
        const { data, error } = await sb.storage.from("recipes").createSignedUrls(need, 3600);
        if (error) { failed = true; console.error(error); }
        (data || []).forEach((d) => { if (d.signedUrl && d.path) urlCache.set(d.path, d.signedUrl); });
      } catch (e) { failed = true; console.error(e); }
      // Hors ligne : la signature est impossible. On construit l'adresse sans jeton ; le service worker sert alors la
      // copie enregistrée de l'image (clé = chemin, sans le jeton). En ligne, cette adresse serait refusée : repli réservé à l'échec.
      if (failed && cfg.supabaseUrl) need.forEach((p) => { if (!urlCache.has(p)) fallback[p] = `${cfg.supabaseUrl}/storage/v1/object/sign/recipes/${p.split("/").map(encodeURIComponent).join("/")}?token=hors-ligne`; });
    }
    const out = {};
    paths.forEach((p) => { if (urlCache.has(p)) out[p] = urlCache.get(p); else if (fallback[p]) out[p] = fallback[p]; });
    return out;
  }

  // Compression côté client : JPEG, 1600 px maximum.
  function compressImage(file, max = 1600, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * k));
        c.height = Math.max(1, Math.round(img.naturalHeight * k));
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error("Compression impossible."))), "image/jpeg", quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Ce fichier n'est pas une image lisible.")); };
      img.src = url;
    });
  }

  // Quantités et durées.
  function fmtQty(q) {
    if (q == null || q === "") return "";
    const n = Math.round(Number(q) * 100) / 100;
    return String(n).replace(".", ",");
  }
  function fmtUnit(u, q) {
    if (!u) return "";
    const plur = Number(q) > 1;
    if (u === "piece") return plur ? "pièces" : "pièce";
    if (u === "pincee") return plur ? "pincées" : "pincée";
    if (u === "botte") return plur ? "bottes" : "botte";
    if (u === "gousse") return plur ? "gousses" : "gousse";
    if (u === "tranche") return plur ? "tranches" : "tranche";
    if (u === "cas") return "c. à soupe";
    if (u === "cac") return "c. à café";
    return u;
  }
  function fmtMin(m) {
    if (m == null) return "";
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h} h ${pad(r)}` : `${h} h`;
  }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } }
  function safeUrl(u) { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; } }


  // ---- phase 2 : import, versions, fusion
  const uuid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); }));
  // Première adresse http(s) d'un texte partagé (« Regarde ça https://… »).
  function extractUrl(text) {
    const m = String(text || "").match(/https?:\/\/[^\s<>"']+/i);
    return m ? m[0].replace(/[.,;:!?)\]]+$/, "") : "";
  }
  function alertText(a) {
    if (a == null) return "";
    if (typeof a === "string") return a;
    return a.message || a.text || a.detail || a.label || a.type || "";
  }
  // Comparaison de quantités : g/kg et ml/cl/l ramenés à une base commune.
  const BASE = { g: ["m", 1], kg: ["m", 1000], ml: ["v", 1], cl: ["v", 10], l: ["v", 1000] };
  function qtyKey(l) {
    if (l.quantity == null) return "?";
    const b = BASE[l.unit];
    return b ? b[0] + ":" + Math.round(Number(l.quantity) * b[1] * 100) / 100 : (l.unit || "") + ":" + Math.round(Number(l.quantity) * 100) / 100;
  }
  const lineKey = (l) => (l.catalog_id ? "c:" + l.catalog_id : "l:" + norm(l.label_original));
  function fmtLine(l) {
    if (l.quantity == null) return l.precision || "q.b.";
    const u = fmtUnit(l.unit, l.quantity);
    return fmtQty(l.quantity) + (u ? " " + u : "");
  }
  // Écarts entre deux listes de lignes : { onlyA, onlyB, qty: [{a, b}], same: [{a, b}] }.
  function diffLines(la, lb) {
    const mb = new Map(); lb.forEach((l) => { const k = lineKey(l); if (!mb.has(k)) mb.set(k, l); });
    const seen = new Set(), out = { onlyA: [], onlyB: [], qty: [], same: [] };
    la.forEach((a) => {
      const k = lineKey(a), b = mb.get(k);
      if (!b || seen.has(k)) { if (!b) out.onlyA.push(a); return; }
      seen.add(k);
      (qtyKey(a) === qtyKey(b) ? out.same : out.qty).push({ a, b });
    });
    lb.forEach((b) => { if (!seen.has(lineKey(b)) && !la.some((a) => lineKey(a) === lineKey(b))) out.onlyB.push(b); });
    return out;
  }

  // ---- phases 4 à 6 : constantes, dates, catalogue, saisie assistée
  // Clé publique VAPID (notifications push). Laissée vide tant que le serveur n'est pas configuré : l'interrupteur est alors masqué.
  const AR_VAPID_PUBLIC = "BBkHgMDBgJTiHVrdDKjRY7SZCxJMSr3NRcdD0BPxrp9hY0YwtY629J6FobuCvam-WQ06ux1xkDhjEwKXs2coOq4";
  const ALLERGENES = { gluten: "Gluten", crustaces: "Crustacés", oeufs: "Œufs", poisson: "Poisson", arachides: "Arachides", soja: "Soja", lait: "Lait", fruits_a_coque: "Fruits à coque",
    celeri: "Céleri", moutarde: "Moutarde", sesame: "Sésame", sulfites: "Sulfites", lupin: "Lupin", mollusques: "Mollusques" };
  const REGIMES = { omnivore: "Omnivore", flexitarien: "Flexitarien", vegetarien: "Végétarien", vegan: "Végétalien (vegan)", pescetarien: "Pescétarien", sans_gluten: "Sans gluten", sans_lactose: "Sans lactose" };
  // Ordre d'un magasin.
  const RAYONS = [["fruits_legumes", "Fruits et légumes"], ["boulangerie", "Boulangerie"], ["boucherie", "Boucherie"], ["poissonnerie", "Poissonnerie"], ["cremerie", "Crémerie"],
    ["epicerie", "Épicerie"], ["epices", "Épices"], ["surgeles", "Surgelés"], ["boissons", "Boissons"], ["autre", "Autre"]];
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  // ---- phase 7 : invités et réceptions (contrat 07-invites-contrat.md)
  const RUBRIQUES = [["aperitif", "Apéritif"], ["entree", "Entrée"], ["plat", "Plat"], ["fromage", "Fromage"], ["dessert", "Dessert"], ["autre", "Autre"]];
  const CRENEAUX = { midi: "Midi", soir: "Soir" };
  // Rubrique proposée d'après la catégorie de la recette.
  const rubriqueDe = (course) => ({ entree: "entree", plat: "plat", dessert: "dessert" }[course] || "autre");
  const prenom = (name) => String(name || "").trim().split(/\s+/)[0] || "";
  // Pastilles d'allergies et de régime d'un invité.
  function guestPills(g) {
    const a = (g.allergens || []).map((k) => `<li class="iv-pastille iv-allergie">${esc(ALLERGENES[k] || k)}</li>`);
    const r = g.regime ? [`<li class="iv-pastille">${esc(REGIMES[g.regime] || g.regime)}</li>`] : [];
    const out = [...a, ...r];
    return out.length ? `<ul class="iv-pastilles" aria-label="Allergies et régime">${out.join("")}</ul>` : "";
  }
  // Jours en chaînes AAAA-MM-JJ (calculs en UTC : aucun décalage d'heure d'été).
  const toUtc = (iso) => { const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/); return Date.UTC(+m[1], +m[2] - 1, +m[3]); };
  const fromUtc = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  const addDays = (iso, n) => fromUtc(toUtc(iso) + n * 864e5);
  const weekdayOf = (iso) => (new Date(toUtc(iso)).getUTCDay() + 6) % 7; // 0 = lundi
  const mondayOf = (iso) => addDays(iso, -weekdayOf(iso));
  const dayLabel = (iso) => `${cap(JOURS[weekdayOf(iso)])} ${fmtDay(iso)}`;
  const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // Quantité d'une liste de courses (« 1,25 kg », « 3 pièces »), vide si aucune.
  function fmtShop(q, u) {
    if (q == null || q === "") return "";
    const n = Number(q), us = fmtUnit(u, n);
    return fmtQty(n) + (us ? " " + us : "");
  }

  // Message d'une edge function (corps JSON { message }) sinon message générique.
  async function fnMessage(error, fallback) {
    try {
      const res = error && error.context;
      if (res && typeof res.json === "function") { const j = await res.json(); if (j && j.message) return String(j.message); }
    } catch { /* corps illisible */ }
    return errMsg(error, fallback);
  }

  // Catalogue d'ingrédients (une lecture par page). Recherche tolérante aux accents, par nom puis alias.
  let catalogP = null;
  function loadCatalog() {
    if (!catalogP) catalogP = (async () => {
      const out = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from("recipe_ingredients_catalog").select("id,name,aliases,aisle,season_months,short_season,allergens").order("name").range(from, from + 999);
        if (error) throw error;
        out.push(...(data || []).map((c) => ({ ...c, _n: norm(c.name), _a: (c.aliases || []).map(norm) })));
        if (!data || data.length < 1000) break;
      }
      return out;
    })().catch((e) => { catalogP = null; throw e; });
    return catalogP;
  }
  function catalogFind(cat, q, max = 8, skip) {
    const n = norm(q);
    if (n.length < 1) return [];
    const scored = [];
    for (const c of cat) {
      if (skip && skip.has(c.id)) continue;
      let s = -1;
      if (c._n === n) s = 0; else if (c._n.startsWith(n)) s = 1; else if (c._a.some((a) => a.startsWith(n))) s = 2; else if (c._n.split(/[\s'’-]+/).some((w) => w.startsWith(n))) s = 3; else if (c._n.includes(n) || c._a.some((a) => a.includes(n))) s = 4;
      if (s >= 0) scored.push([s, c]);
    }
    return scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name, "fr")).slice(0, max).map((x) => x[1]);
  }
  const catalogByName = (cat, name) => { const n = norm(name); return cat.find((c) => c._n === n) || cat.find((c) => c._a.includes(n)) || null; };

  // Saisie avec suggestions du catalogue : champ + liste de boutons (44 px) sous le champ.
  //   opts : { label, placeholder, onPick(catalogRow), exclude(): Set d'ids déjà choisis, id }
  function catalogPicker(box, opts) {
    const id = opts.id || "ac" + Math.random().toString(36).slice(2, 7);
    box.innerHTML = `<label for="${id}">${esc(opts.label)}</label><input id="${id}" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-l" autocomplete="off" enterkeyhint="done" placeholder="${esc(opts.placeholder || "")}">
      <ul class="ac-liste" id="${id}-l" role="listbox" aria-label="Suggestions" hidden></ul><p class="aide ac-etat" role="status" aria-live="polite"></p>`;
    const input = $("input", box), list = $("ul", box), etat = $(".ac-etat", box);
    let cur = [];
    const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); };
    const pick = (c) => { input.value = ""; close(); etat.textContent = ""; opts.onPick(c); input.focus(); };
    async function refresh() {
      const q = input.value.trim();
      if (!q) { close(); etat.textContent = ""; return; }
      let cat;
      try { cat = await loadCatalog(); } catch (e) { etat.textContent = errMsg(e, "Le catalogue est indisponible."); return; }
      cur = catalogFind(cat, q, 8, opts.exclude ? opts.exclude() : null);
      if (!cur.length) { list.innerHTML = `<li class="ac-vide" role="presentation">Aucun ingrédient du catalogue ne correspond.</li>`; list.hidden = false; return; }
      list.innerHTML = cur.map((c, i) => `<li role="presentation"><button type="button" role="option" class="ac-opt" data-i="${i}">${esc(c.name)}</button></li>`).join("");
      list.hidden = false; input.setAttribute("aria-expanded", "true");
    }
    input.addEventListener("input", debounce(refresh, 120));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); refresh().then(() => { if (!list.hidden && cur[0]) pick(cur[0]); }); }
      else if (e.key === "Escape") close();
      else if (e.key === "ArrowDown") { const b = $(".ac-opt", list); if (b) { e.preventDefault(); b.focus(); } }
    });
    list.addEventListener("keydown", (e) => {
      const b = e.target.closest(".ac-opt"); if (!b) return;
      if (e.key === "ArrowDown") { e.preventDefault(); const n = b.parentElement.nextElementSibling; if (n) $(".ac-opt", n).focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); const p = b.parentElement.previousElementSibling; if (p) $(".ac-opt", p).focus(); else input.focus(); }
      else if (e.key === "Escape") { close(); input.focus(); }
    });
    list.addEventListener("click", (e) => { const b = e.target.closest(".ac-opt"); if (b && cur[+b.dataset.i]) pick(cur[+b.dataset.i]); });
    return { input, close };
  }

  // Cartes « planche » (recettes) pour les écrans de suggestion : cover = chemin de la couverture.
  async function fetchCards(ids) {
    if (!ids.length) return new Map();
    const { data, error } = await sb.from("recipes").select("id,book_id,title,source_author,source_url,family,review_state,course,version_group,time_total_min,difficulty,servings,recipe_photos(storage_path,is_cover)").in("id", ids);
    if (error) throw error;
    const rows = data || [];
    const urls = await signedUrls(rows.map((r) => { const p = (r.recipe_photos || []).find((x) => x.is_cover); return p && p.storage_path; }).filter(Boolean));
    const m = new Map();
    rows.forEach((r) => { const p = (r.recipe_photos || []).find((x) => x.is_cover); m.set(r.id, { ...r, cover: p ? urls[p.storage_path] || null : null }); });
    return m;
  }
  function plancheHtml(r, num, extra) {
    const src = r.source_author || host(r.source_url || "") || "";
    return `<a class="planche" href="/recettes/fiche.html?id=${encodeURIComponent(r.id)}">
      <div class="passe-partout"><div class="cadre">${r.cover ? `<img src="${esc(r.cover)}" alt="" loading="lazy">` : `<span class="vide">Sans photo</span>`}</div></div>
      <div class="legende">${r.family ? `<span class="planche-num">De famille</span>` : ""}
      <span class="planche-titre">${esc(r.title)}</span>${src ? `<span class="planche-source">${esc(src)}</span>` : ""}${extra || ""}</div></a>`;
  }
  // Une seule fiche par groupe de versions (la mieux classée).
  function dedupeVersions(items, get) {
    const seen = new Set();
    return items.filter((it) => { const g = get(it); if (!g) return true; if (seen.has(g)) return false; seen.add(g); return true; });
  }
  // Carnet courant d'un écran à carnet unique : préférence si valide, sinon premier carnet.
  function pickBook(books, prefer) {
    const want = prefer || getBookPref();
    return (books.find((b) => b.id === want) || books[0] || {}).id || null;
  }
  const isNetErr = (e) => !!e && (navigator.onLine === false || /Failed to fetch|NetworkError|Load failed|network|internetdisconnected/i.test(String(e.message || e)));


  // ---- notifications push (contrat 05-organiser §4). Sans clé VAPID publique, rien n'est proposé.
  const b64 = (v) => Uint8Array.from(atob((v + "=".repeat((4 - v.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const push = {
    available: () => !!AR_VAPID_PUBLIC,
    supported: () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
    async current() { try { const reg = await navigator.serviceWorker.ready; return await reg.pushManager.getSubscription(); } catch { return null; } },
    // À appeler sur un geste. Renvoie 'ok', 'refuse', 'non_supporte' ou 'erreur'.
    async enable() {
      if (!push.supported()) return "non_supporte";
      try {
        if (await Notification.requestPermission() !== "granted") return "refuse";
        const reg = await navigator.serviceWorker.ready;
        const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(AR_VAPID_PUBLIC) });
        const j = sub.toJSON();
        const { error } = await sb.rpc("recipe_push_subscribe", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
        if (error) { console.error(error); return "erreur"; }
        return "ok";
      } catch (e) { console.error(e); return "erreur"; }
    },
    async disable() {
      const sub = await push.current();
      if (!sub) return "ok";
      const { error } = await sb.from("recipe_push_subscriptions").delete().eq("endpoint", sub.endpoint);
      if (error) { console.error(error); return "erreur"; }
      await sub.unsubscribe().catch(() => {});
      return "ok";
    },
    // À chaque connexion : rattache l'abonnement existant au compte courant (idempotent).
    async refresh() {
      if (!AR_VAPID_PUBLIC || !push.supported() || Notification.permission !== "granted") return;
      const sub = await push.current();
      if (!sub) return;
      const j = sub.toJSON();
      sb.rpc("recipe_push_subscribe", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth }).then(() => {}, () => {});
    }
  };


  // Session et carnets.
  // Hors ligne, le jeton expiré ne peut pas être renouvelé : on lit l'utilisateur dans la session enregistrée (lecture seule des copies locales).
  function storedUser() {
    try {
      const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x));
      const j = k ? JSON.parse(localStorage.getItem(k)) : null;
      const u = j && (j.user || (j.currentSession && j.currentSession.user));
      return u && u.id ? u : null;
    } catch { return null; }
  }
  async function getUser() {
    if (!sb) return null;
    try {
      const { data } = await sb.auth.getSession();
      if (data.session) return data.session.user;
    } catch (e) { console.error(e); }
    return navigator.onLine === false ? storedUser() : null;
  }
  const BOOKS_KEY = "ar.books";
  async function loadBooks(userId) {
    const { data, error } = await sb.from("recipe_book_members").select("role, recipe_books(id, name)").eq("user_id", userId);
    if (error) {
      // Hors ligne : derniers carnets connus (lecture seule des copies locales).
      try { const c = JSON.parse(localStorage.getItem(BOOKS_KEY) || "null"); if (c && c.uid === userId && c.books.length && (navigator.onLine === false || /fetch|network|load failed/i.test(String(error.message)))) return c.books; } catch { /* copie illisible */ }
      throw error;
    }
    const order = { owner: 0, member: 1, reader: 2 };
    const out = (data || []).filter((r) => r.recipe_books)
      .map((r) => ({ id: r.recipe_books.id, name: r.recipe_books.name, role: r.role }))
      .sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name, "fr"));
    try { localStorage.setItem(BOOKS_KEY, JSON.stringify({ uid: userId, books: out })); } catch { /* stockage indisponible */ }
    return out;
  }

  // Barre de navigation : cinq entrées (en bas de l'écran sur mobile) ; profil, carnets et déconnexion dans le menu Compte.
  function mountNav(active, user) {
    const h = $("#site-header");
    if (!h) return;
    const item = (k, href, label) => `<a href="${href}"${active === k ? ' aria-current="page"' : ""}>${label}</a>`;
    const sub = (k, href, label) => `<a class="menu-lien" href="${href}"${active === k ? ' aria-current="page"' : ""}>${label}</a>`;
    const inCompte = active === "carnets" || active === "profil" || active === "invites";
    h.innerHTML = `<div class="wrap"><a class="brand" href="/recettes/" aria-label="ARÔMES V&amp;N, accueil">Arômes V&amp;N</a>
      <nav class="nav" aria-label="Navigation principale">${item("carnet", "/recettes/", "Le carnet")}${item("saisons", "/recettes/saisons.html", "Saisons")}${item("ajouter", "/recettes/ajouter.html", "Ajouter")}${item("semaine", "/recettes/semaine.html", "Semaine")}${item("courses", "/recettes/courses.html", "Courses")}</nav>
      <div class="account"><button type="button" id="account-btn" class="${inCompte ? "actif-compte" : ""}" aria-expanded="false" aria-controls="account-panel" aria-label="Compte">Compte</button>
      <div class="account-panel" id="account-panel" hidden><p class="libelle">Connecté</p><p>${esc(user.email || "")}</p>${sub("profil", "/recettes/profil.html", "Mon profil")}${sub("invites", "/recettes/invites.html", "Invités")}${sub("carnets", "/recettes/carnets.html", "Carnets")}<button type="button" class="btn sec petit large" id="logout">Se déconnecter</button></div></div></div>`;
    const btn = $("#account-btn"), panel = $("#account-panel");
    btn.addEventListener("click", () => { panel.hidden = !panel.hidden; btn.setAttribute("aria-expanded", String(!panel.hidden)); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); btn.focus(); } });
    document.addEventListener("click", (e) => { if (!panel.hidden && !e.target.closest(".account")) { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); } });
    $("#logout").addEventListener("click", async () => { await sb.auth.signOut(); await clearOfflineData(); location.href = "/recettes/connexion.html"; });
  }

  // Démarrage d'une page protégée : renvoie { user, books } ou null (redirection en cours).
  async function boot(active) {
    registerSW();
    const main = $("#main");
    if (!sb) { if (main) main.innerHTML = '<p class="msg erreur" role="alert">Le service n\'est pas disponible pour le moment.</p>'; return null; }
    const user = await getUser();
    if (!user) {
      location.replace("/recettes/connexion.html?next=" + encodeURIComponent(location.pathname + location.search));
      return null;
    }
    mountNav(active, user);
    let books = [];
    try { books = await loadBooks(user.id); }
    catch (e) { if (main) main.insertAdjacentHTML("afterbegin", `<p class="msg erreur" role="alert">${esc(errMsg(e, "Impossible de charger vos carnets."))}</p>`); }
    push.refresh();
    return { user, books };
  }

  // Copies hors ligne des recettes (service worker) : effacées à la déconnexion, pour ne rien laisser sur un appareil partagé.
  async function clearOfflineData() {
    try { const ks = await caches.keys(); await Promise.all(ks.filter((k) => /^aromes-.*-data$/.test(k)).map((k) => caches.delete(k))); } catch { /* cache indisponible */ }
    try { Object.keys(localStorage).filter((k) => /^ar\.(courses|books)/.test(k)).forEach((k) => localStorage.removeItem(k)); } catch { /* stockage indisponible */ }
  }
  // Bandeau « Hors ligne » : le service worker prévient la page quand il répond avec une copie enregistrée.
  function showOffline() {
    if (document.getElementById("hors-ligne")) return;
    const b = document.createElement("div");
    b.id = "hors-ligne"; b.className = "hors-ligne"; b.setAttribute("role", "status");
    b.textContent = "Hors ligne : version enregistrée";
    const h = document.getElementById("site-header");
    if (h && h.parentNode) h.parentNode.insertBefore(b, h.nextSibling); else document.body.prepend(b);
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.type === "ar-hors-ligne") showOffline(); });

  function registerSW() {
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      window.addEventListener("load", () => { navigator.serviceWorker.register("/recettes/sw.js", { scope: "/recettes/" }).catch(() => {}); });
    }
  }

  // Retour en arrière par balayage vers la droite (utile dans l'app installée, sans geste natif).
  function swipeBack(fallback) {
    const standalone = navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
    let t0 = null, moving = false;
    const page = document.querySelector("main") || document.body;
    const reset = () => { page.style.transition = "transform .2s ease, opacity .2s ease"; page.style.transform = ""; page.style.opacity = ""; };
    const blocked = (el) => {
      for (; el && el !== document.body; el = el.parentElement) {
        if (el.matches && el.matches("input,textarea,select,[contenteditable],[data-no-swipe],dialog")) return true;
        if (el.scrollWidth > el.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowX)) return true;
      }
      return false;
    };
    document.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      // Dans Safari, le bord gauche appartient au geste natif : on le laisse.
      t0 = e.touches.length === 1 && (standalone || t.clientX > 24) && !blocked(e.target) && !document.querySelector("dialog[open]")
        ? { x: t.clientX, y: t.clientY } : null;
      moving = false;
    }, { passive: true });
    document.addEventListener("touchmove", (e) => {
      if (!t0) return;
      const t = e.touches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y;
      if (!moving) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { t0 = null; return; }
        if (dx > 12 && dx > Math.abs(dy) * 1.5) moving = true; else return;
      }
      page.style.transition = "none";
      page.style.transform = `translateX(${Math.max(0, dx) * 0.6}px)`;
      page.style.opacity = String(1 - Math.min(dx, 300) / 900);
    }, { passive: true });
    const end = (e) => {
      if (!t0) return;
      const dx = e.changedTouches[0].clientX - t0.x, go = moving && dx > 90;
      t0 = null; moving = false;
      if (!go) { reset(); return; }
      page.style.transition = "transform .15s ease, opacity .15s ease";
      page.style.transform = "translateX(100%)"; page.style.opacity = "0";
      setTimeout(() => {
        const sameOrigin = document.referrer && document.referrer.startsWith(location.origin + "/recettes/");
        if (sameOrigin && history.length > 1) history.back(); else location.href = fallback || "./";
        setTimeout(reset, 400);   // si la page reste affichée (bfcache)
      }, 150);
    };
    document.addEventListener("touchend", end, { passive: true });
    document.addEventListener("touchcancel", () => { if (t0) { t0 = null; moving = false; reset(); } }, { passive: true });
    window.addEventListener("pageshow", reset);
  }

  // ---- astuces (contrat 08-astuces-contrat.md)
  const TIP_CATS = { cuisson: "Cuisson", technique: "Technique", conservation: "Conservation", produit: "Produit", materiel: "Matériel", patisserie: "Pâtisserie", accord: "Accord", autre: "Autre" };
  // Message d'erreur d'une requête sur les astuces : si la migration n'est pas appliquée, on le dit simplement.
  function tipErr(e, fallback) {
    const m = String((e && (e.message || "")) || "") + String((e && e.code) || "");
    if (/recipe_tip|PGRST20\d|42P01|42883|schema cache|does not exist|Could not find/i.test(m)) { console.error(e); return "Les astuces ne sont pas encore disponibles sur ce serveur."; }
    return errMsg(e, fallback);
  }
  // Astuces liées à une recette (RPC recipe_related_tips) : jamais bloquant, [] si indisponible.
  async function relatedTips(recipeId) {
    try {
      const { data, error } = await sb.rpc("recipe_related_tips", { p_recipe: recipeId });
      if (error) throw error;
      return data || [];
    } catch (e) { console.error(e); return []; }
  }
  const tipReason = (r) => (r === "liee" ? "liée à cette recette" : /^ingredient:/.test(r || "") ? "à propos de : " + String(r).slice(11) : "");
  // Liste d'astuces dépliables (fiche et mode cuisine). opts.link : lien vers la fiche de l'astuce.
  function tipsListHtml(list, opts = {}) {
    return `<ul class="tips-liste">${list.map((t) => `<li class="tip-item"><details${opts.open ? " open" : ""}><summary><span class="tip-titre">${esc(t.title)}</span>
      <span class="tip-meta">${esc([TIP_CATS[t.category] || "", tipReason(t.reason)].filter(Boolean).join(" · "))}</span></summary>
      <div class="tip-corps"><p>${esc(t.body)}</p>${opts.link === false ? "" : `<a class="btn sec petit" href="/recettes/astuce.html?id=${encodeURIComponent(t.id)}">Ouvrir l'astuce</a>`}</div></details></li>`).join("")}</ul>`;
  }
  // Appel de la fonction d'import. extra : { retype: "recette" | "astuce" }. Lève une Error au message lisible.
  async function callImport(importId, extra) {
    const { data } = await sb.auth.getSession();
    const token = data.session && data.session.access_token;
    if (!token) throw new Error("Votre session a expiré. Reconnectez-vous.");
    let res;
    try {
      res = await fetch(`${cfg.supabaseUrl}/functions/v1/recipe-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: cfg.supabaseAnonKey },
        body: JSON.stringify({ import_id: importId, ...(extra || {}) })
      });
    } catch (e) { throw new Error("Connexion impossible. Vérifiez votre réseau et réessayez."); }
    if (!res.ok) {
      let m = "";
      try { const j = await res.json(); m = (j && (j.message || j.error)) || ""; } catch { /* corps non JSON */ }
      const fallback = res.status === 429 ? "Limite quotidienne atteinte : 50 imports par 24 heures."
        : res.status === 401 ? "Votre session a expiré. Reconnectez-vous."
        : res.status === 403 ? "Cette action n'est pas permise avec votre rôle dans ce carnet."
        : res.status === 409 ? "Un traitement est déjà en cours pour cette source."
        : "Le changement de type n'a pas pu démarrer. Réessayez dans un instant.";
      const e = new Error(m || fallback); e.status = res.status; throw e;
    }
  }
  // Changer de type : relit la même source avec la cible forcée, puis attend la nouvelle fiche et renvoie son adresse.
  //   to : "recette" | "astuce" ; current : id de l'objet actuel (pour reconnaître le nouveau) ; onStep(texte) facultatif.
  async function retype(importId, to, current, onStep) {
    const prior = await sb.from("recipe_imports").select("recipe_id,tip_id").eq("id", importId).maybeSingle();
    const before = prior.data ? (to === "astuce" ? prior.data.tip_id : prior.data.recipe_id) : null; // d'un éventuel changement antérieur
    await callImport(importId, { retype: to });
    const t0 = Date.now();
    while (Date.now() - t0 < 180000) {
      await new Promise((ok) => setTimeout(ok, 2500));
      const { data, error } = await sb.from("recipe_imports").select("status,step,error,recipe_id,tip_id").eq("id", importId).maybeSingle();
      if (error || !data) continue;
      if (data.status === "echec") throw new Error(data.error || "Le changement de type a échoué. L'objet d'origine est conservé.");
      if (onStep && data.step) onStep(data.step);
      const nid = to === "astuce" ? data.tip_id : data.recipe_id, autre = to === "astuce" ? data.recipe_id : data.tip_id;
      if (data.status === "termine" || data.status === "a_relire") {
        // Succès : nouvel identifiant rempli, l'autre à null. Échec : statut revenu avec error non nul et liens inchangés.
        if (nid && !autre && nid !== current && nid !== before)
          return (to === "astuce" ? "/recettes/astuce.html?id=" : "/recettes/fiche.html?id=") + encodeURIComponent(nid);
        if (data.error) throw new Error(data.error);
      }
    }
    throw new Error("Le changement de type prend plus de temps que prévu. Revenez dans un instant : la nouvelle fiche arrivera dans votre carnet.");
  }

  window.AR = { TIP_CATS, tipErr, relatedTips, tipReason, tipsListHtml, callImport, retype, sb, cfg, $, $$, esc, norm, fmtDate, fmtDay, todayIso, parseDay, fmtQty, fmtUnit, fmtMin, host, safeUrl, errMsg, toast, setMsg, safeNext, getBookPref, setBookPref,
    signedUrls, compressImage, scaleQty: window.ARPure.scaleQty, portionFactor: window.ARPure.portionFactor, showOffline, clearOfflineData, uuid, extractUrl, alertText, diffLines, fmtLine, lineKey, getUser, loadBooks, boot, registerSW, ROLES, COURSES, DIFFICULTES, UNITES,
    VAPID_PUBLIC: AR_VAPID_PUBLIC, ALLERGENES, REGIMES, RAYONS, MOIS, JOURS, cap, addDays, weekdayOf, mondayOf, dayLabel, debounce, fmtShop, fnMessage,
    RUBRIQUES, CRENEAUX, rubriqueDe, prenom, guestPills, loadCatalog, catalogFind, catalogByName, catalogPicker, fetchCards, plancheHtml, dedupeVersions, pickBook, isNetErr, push, swipeBack };
})();
