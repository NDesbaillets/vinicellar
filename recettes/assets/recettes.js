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
  // Appel de la fonction recipe-import. body : { import_id, retype? } ou { pdf_job_id }. Lève une Error au message lisible (e.status = code HTTP).
  async function callFn(body, defaultMsg) {
    const { data } = await sb.auth.getSession();
    const token = data.session && data.session.access_token;
    if (!token) throw new Error("Votre session a expiré. Reconnectez-vous.");
    let res;
    try {
      res = await fetch(`${cfg.supabaseUrl}/functions/v1/recipe-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: cfg.supabaseAnonKey },
        body: JSON.stringify(body)
      });
    } catch (e) { throw new Error("Connexion impossible. Vérifiez votre réseau et réessayez."); }
    if (!res.ok) {
      let m = "";
      try { const j = await res.json(); m = (j && (j.message || j.error)) || ""; } catch { /* corps non JSON */ }
      const fallback = res.status === 429 ? "Limite quotidienne atteinte : 50 imports par 24 heures."
        : res.status === 401 ? "Votre session a expiré. Reconnectez-vous."
        : res.status === 403 ? "Cette action n'est pas permise avec votre rôle dans ce carnet."
        : res.status === 409 ? "Un traitement est déjà en cours pour cette source."
        : defaultMsg;
      const e = new Error(m || fallback); e.status = res.status; throw e;
    }
  }
  const callImport = (importId, extra) => callFn({ import_id: importId, ...(extra || {}) }, "Le changement de type n'a pas pu démarrer. Réessayez dans un instant.");
  // Analyse d'un PDF à plusieurs recettes (contrat 09 §2) : { pdf_job_id }.
  const callPdfJob = (jobId) => callFn({ pdf_job_id: jobId }, "L'analyse n'a pas pu démarrer. Réessayez dans un instant.");

  // ---- menus et PDF à plusieurs recettes (contrat 09-menus-pdf-contrat.md)
  const MENU_RUBRIQUES = [["aperitif", "Apéritif"], ["entree", "Entrée"], ["plat", "Plat"], ["accompagnement", "Accompagnement"], ["fromage", "Fromage"], ["dessert", "Dessert"], ["base", "Base"], ["boisson", "Boisson"], ["autre", "Autre"]];
  // Rubrique d'un menu -> rubrique d'une réception (qui n'en a que six).
  const rubriqueReception = (k) => ({ accompagnement: "plat", base: "autre", boisson: "autre" }[k] || k);
  // Message d'erreur d'une requête sur les menus ou les analyses de PDF : migration absente = message simple.
  function menuErr(e, fallback) {
    const m = String((e && (e.message || "")) || "") + " " + String((e && e.code) || "");
    if (/row-level security|permission denied|42501/i.test(m)) return errMsg(e, fallback);
    if (/recipe_menu|recipe_pdf|menu_id|pdf_job|pdf_extrait|pdf_idx|menu_title|PGRST20\d|42P01|42703|42883|schema cache|does not exist|Could not find|23514/i.test(m)) { console.error(e); return "Les menus et l'import de PDF ne sont pas encore disponibles sur ce serveur."; }
    return errMsg(e, fallback);
  }
  // Pages d'un PDF en texte : [3,4,5,8] -> « p. 3 à 5, 8 ».
  function fmtPages(pages) {
    const p = [...new Set((pages || []).map(Number).filter((n) => n > 0))].sort((a, b) => a - b);
    if (!p.length) return "";
    const out = []; let a = p[0], b = a;
    for (const n of p.slice(1).concat([null])) {
      if (n === b + 1) { b = n; continue; }
      out.push(a === b ? String(a) : b === a + 1 ? `${a}, ${b}` : `${a} à ${b}`);
      a = b = n;
    }
    return "p. " + out.join(", ");
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

  // Source d'une fiche (formulaires recette et astuce) : champs vides = source retirée.
  function sourceFields(f) {
    const u = f.source_url.value.trim();
    return { source_author: f.source_author.value.trim() || null, source_url: u ? safeUrl(u) || null : null };
  }
  // Bouton « Retirer la source » : vide les deux champs ; l'enregistrement les met à null.
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("#src-clear");
    if (!b) return;
    const f = b.form; if (!f) return;
    f.source_author.value = ""; f.source_url.value = "";
    toast("Source retirée : enregistrez pour confirmer.");
  });

  // ---- « Qu'est-ce qu'on mange ce soir ? » et suggestions par type de plat (contrat 10-ce-soir-composer-contrat.md)
  const rpcMissing = (res) => !!res && !!res.error && (res.status === 404 || res.error.code === "PGRST202" || /Could not find the function|schema cache/i.test(String(res.error.message || "")));
  let noSuggestCourses = false; // RPC recipe_suggest_courses absente du serveur : repli sur recipe_suggestions + filtre côté client
  // Suggestions limitées à des types de plats. args : paramètres de recipe_suggestions (p_limit compris) ; courses : types voulus (défaut : plat).
  // Renvoie la liste de lignes { recipe_id, raisons, … }. Lève l'erreur Supabase si ce n'est pas une absence de la fonction.
  async function suggestCourses(args, courses) {
    const want = courses && courses.length ? courses : ["plat"];
    if (!noSuggestCourses) {
      const res = await sb.rpc("recipe_suggest_courses", { ...args, p_courses: want });
      if (!res.error) return res.data || [];
      if (!rpcMissing(res)) throw res.error;
      noSuggestCourses = true;
    }
    const limit = args.p_limit || 12;
    const res = await sb.rpc("recipe_suggestions", { ...args, p_limit: Math.min(Math.max(limit * 6, 40), 100) });
    if (res.error) throw res.error;
    const rows = res.data || [];
    if (!rows.length) return [];
    const c = await sb.from("recipes").select("id,course").in("id", rows.map((x) => x.recipe_id));
    if (c.error) throw c.error;
    const course = new Map((c.data || []).map((x) => [x.id, x.course]));
    const ok = (id) => { const k = course.get(id); return k ? want.includes(k) : want.includes("plat"); };
    return rows.filter((x) => course.has(x.recipe_id) && ok(x.recipe_id)).map((x) => ({ ...x, course: course.get(x.recipe_id) || null })).slice(0, limit);
  }

  // Panneau « Ce soir » : un bouton dans box ; opts : { books, user, getBook() (carnet courant de la page), onChange() après écriture de la case }.
  function ceSoir(box, opts) {
    const books = (opts && opts.books) || [], me = opts && opts.user && opts.user.id;
    const pool = books.filter((b) => b.role !== "reader").length ? books.filter((b) => b.role !== "reader") : books;
    if (!box || !pool.length || !me) return;
    box.innerHTML = `<button type="button" class="btn cs-btn" aria-haspopup="dialog">Qu'est-ce qu'on mange ce soir ?</button>`;
    const btn = $("button", box);
    const day = todayIso();
    const S = { book: null, who: new Set([me]), people: [], shown: new Set(), seq: 0 };
    let sheet = null;
    const editorOf = (id) => { const b = books.find((x) => x.id === id); return !!b && b.role !== "reader"; };
    const composerHref = () => `/recettes/menu.html?composer=1&book=${encodeURIComponent(S.book)}&jour=${day}&creneau=soir`;

    const onEsc = (e) => { if (e.key === "Escape" && sheet) close(); }; // le focus peut être perdu quand le contenu est redessiné
    function close() {
      if (!sheet) return;
      document.removeEventListener("keydown", onEsc);
      sheet.remove(); sheet = null; document.body.classList.remove("se-ouvert");
      if (document.contains(btn)) btn.focus();
    }
    function open() {
      close();
      const want = opts.getBook ? opts.getBook() : null;
      S.book = pool.some((b) => b.id === want) ? want : pickBook(pool);
      sheet = document.createElement("div");
      sheet.className = "se-fond";
      sheet.innerHTML = `<section class="se-feuille" role="dialog" aria-modal="true" aria-labelledby="cs-t"><div class="se-f-tete"><div><h2 id="cs-t">Ce soir</h2><p class="libelle or" style="margin:2px 0 0">${esc(dayLabel(day))}</p></div><button type="button" class="btn sec petit" data-close>Fermer</button></div>
        ${pool.length > 1 ? `<label for="cs-book">Carnet<select id="cs-book">${pool.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("")}</select></label>` : ""}
        <div id="cs-corps" aria-live="polite"></div></section>`;
      document.body.append(sheet); document.body.classList.add("se-ouvert");
      document.addEventListener("keydown", onEsc);
      const sel = $("#cs-book", sheet); if (sel) sel.value = S.book;
      sheet.addEventListener("click", onClick);
      sheet.addEventListener("change", onChange);
      sheet.addEventListener("keydown", (e) => {
        if (e.key === "Escape") return close();
        if (e.key !== "Tab") return;
        const f = $$("button:not([disabled]), input, select, a[href]", sheet).filter((x) => !x.hidden && x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
      start();
    }

    // La case du soir : RPC recipe_tonight, repli sur une lecture directe de recipe_meal_plan si la fonction est absente.
    async function fetchTonight(book) {
      const res = await sb.rpc("recipe_tonight", { p_book: book });
      if (!res.error) { const d = Array.isArray(res.data) ? res.data[0] : res.data; return d && (d.plan_id || d.recipe_id || d.menu_id || d.state) ? d : null; }
      if (!rpcMissing(res)) throw res.error;
      const p = await sb.from("recipe_meal_plan").select("*").eq("book_id", book).eq("day", day).eq("slot", "soir").maybeSingle();
      if (p.error) throw p.error;
      if (!p.data) return null;
      const d = { plan_id: p.data.id, state: p.data.state, recipe_id: p.data.recipe_id, menu_id: p.data.menu_id, servings: p.data.servings, title: null };
      if (d.recipe_id) { const r = await sb.from("recipes").select("title").eq("id", d.recipe_id).maybeSingle(); d.title = r.data ? r.data.title : null; }
      else if (d.menu_id) { const m = await sb.from("recipe_menus").select("title").eq("id", d.menu_id).maybeSingle(); d.title = m.data ? m.data.title : null; }
      return d;
    }
    const corps = () => $("#cs-corps", sheet);
    async function start() {
      const my = ++S.seq, c = corps();
      c.innerHTML = `<p class="chargement">Chargement de ce soir…</p>`;
      try {
        const row = await fetchTonight(S.book);
        if (my !== S.seq || !sheet) return;
        if (row && (row.recipe_id || row.menu_id || row.state === "dehors" || row.state === "travail")) return void renderTonight(row);
        suggest(true);
      } catch (e) { if (my === S.seq && sheet) c.innerHTML = `<p class="msg erreur" role="alert">${esc(errMsg(e, "Impossible de lire le planning."))}</p>`; }
    }
    async function renderTonight(row, card) {
      const my = S.seq, c = corps(), ed = editorOf(S.book);
      const changer = ed ? `<button type="button" class="btn sec" data-w="change">Changer</button>` : "";
      if (!row.recipe_id && !row.menu_id) { c.innerHTML = `<p class="se-prop-t">Ce soir : ${row.state === "travail" ? "au travail" : "dehors"}.</p><p class="muted italique">Aucun repas à préparer.</p><div class="rangee">${changer}</div>`; const g = $("[data-w=change]", c); if (g) g.focus(); return; }
      if (row.menu_id && !row.recipe_id) {
        c.innerHTML = `<p class="libelle or">Ce soir, au menu</p><p class="se-prop-t"><a href="/recettes/menu.html?id=${encodeURIComponent(row.menu_id)}">${esc(row.title || "Menu")}</a></p>
          <div class="rangee se-prop-b"><a class="btn" href="/recettes/menu.html?id=${encodeURIComponent(row.menu_id)}">Voir le menu</a>${changer}</div>`;
        return;
      }
      let cv = card || null;
      if (!cv) { try { cv = (await fetchCards([row.recipe_id])).get(row.recipe_id) || null; } catch (e) { console.error(e); } if (my !== S.seq || !sheet) return; }
      const title = (cv && cv.title) || row.title || "Recette";
      const srv = row.servings != null ? row.servings : null;
      c.innerHTML = `<p class="libelle or">Ce soir, au menu</p>
        <div class="se-prop"><div class="se-prop-photo"><a href="/recettes/fiche.html?id=${encodeURIComponent(row.recipe_id)}" aria-label="${esc(title)}"><div class="passe-partout"><div class="cadre">${cv && cv.cover ? `<img src="${esc(cv.cover)}" alt="">` : `<span class="vide">Sans photo</span>`}</div></div></a></div>
        <div><p class="se-prop-t"><a href="/recettes/fiche.html?id=${encodeURIComponent(row.recipe_id)}">${esc(title)}</a></p>${srv ? `<p class="muted">${srv} convive${srv > 1 ? "s" : ""}</p>` : ""}</div></div>
        <div class="rangee se-prop-b"><a class="btn" href="/recettes/cuisine.html?id=${encodeURIComponent(row.recipe_id)}${srv ? "&amp;p=" + srv : ""}">Cuisiner</a>${changer}</div>`;
    }

    // ---- suggestions de plats : 3 à la fois ; « Autres idées » demande les suivantes et écarte celles déjà montrées
    async function loadPeople() {
      const r = await sb.rpc("book_people", { b: S.book });
      const m = new Map();
      (r.data || []).forEach((x) => { if (!m.has(x.user_id)) m.set(x.user_id, x.full_name || x.email || "Membre"); });
      S.people = [[me, "Moi"], ...[...m].filter(([id]) => id !== me)];
      S.who = new Set([...S.who].filter((id) => S.people.some((p) => p[0] === id)));
      if (!S.who.size) S.who.add(me);
    }
    function whoHtml() {
      if (S.people.length < 2) return "";
      return `<fieldset class="sa-qui"><legend class="libelle or">Pour qui ?</legend><div class="sa-personnes">${S.people.map(([id, n]) => `<label class="case pf-case"><input type="checkbox" data-who="${esc(id)}"${S.who.has(id) ? " checked" : ""}> ${esc(n)}</label>`).join("")}</div></fieldset>`;
    }
    async function suggest(fresh) {
      const my = ++S.seq, c = corps(), ed = editorOf(S.book);
      if (fresh) { S.shown = new Set(); try { await loadPeople(); } catch (e) { console.error(e); S.people = [[me, "Moi"]]; S.who = new Set([me]); } if (my !== S.seq || !sheet) return; }
      c.innerHTML = `${whoHtml()}<div id="cs-liste"><p class="chargement">Recherche de suggestions…</p></div><div class="rangee se-prop-b" id="cs-pied"></div>`;
      const box = $("#cs-liste", c);
      try {
        const who = [...S.who];
        const data = await suggestCourses({ p_book_ids: [S.book], p_for_users: who.length === 1 && who[0] === me ? null : who, p_month: +day.slice(5, 7), p_limit: S.shown.size + 3, p_weekday: weekdayOf(day) < 5 }, ["plat"]);
        const fresh3 = (data || []).filter((x) => !S.shown.has(x.recipe_id));
        const cards = await fetchCards(fresh3.map((x) => x.recipe_id));
        if (my !== S.seq || !sheet) return;
        const rows = dedupeVersions(fresh3.filter((x) => cards.has(x.recipe_id)), (x) => cards.get(x.recipe_id).version_group).slice(0, 3);
        rows.forEach((x) => S.shown.add(x.recipe_id));
        const tail = `<a class="btn lien" href="${composerHref()}">Composer un menu</a>`;
        if (!rows.length) {
          box.innerHTML = `<div class="vide-etat"><p class="italique">${S.shown.size ? "Plus d'idées pour l'instant : modifiez les personnes ou ouvrez le carnet." : "Aucune suggestion de plat pour ce soir. Élargissez le carnet ou retirez une contrainte."}</p></div>`;
          $("#cs-pied", c).innerHTML = (S.shown.size ? `<button type="button" class="btn sec" data-w="restart">Revoir depuis le début</button>` : "") + tail;
          return;
        }
        box.innerHTML = `<ol class="cs-liste">${rows.map((x) => { const k = cards.get(x.recipe_id);
          return `<li class="cs-sugg" data-id="${esc(k.id)}"><div class="se-prop"><div class="se-prop-photo"><a href="/recettes/fiche.html?id=${encodeURIComponent(k.id)}" aria-label="${esc(k.title)}"><div class="passe-partout"><div class="cadre">${k.cover ? `<img src="${esc(k.cover)}" alt="" loading="lazy">` : `<span class="vide">Sans photo</span>`}</div></div></a></div>
            <div><p class="se-prop-t"><a href="/recettes/fiche.html?id=${encodeURIComponent(k.id)}">${esc(k.title)}</a></p><ul class="sa-raisons">${(x.raisons || []).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
            ${ed ? `<button type="button" class="btn" data-pick="${esc(k.id)}">Ce sera ça</button>` : ""}</div></div></li>`; }).join("")}</ol>`;
        S.cards = cards;
        $("#cs-pied", c).innerHTML = `<button type="button" class="btn sec" data-w="more">Autres idées</button>${tail}`;
      } catch (e) { if (my === S.seq && sheet) box.innerHTML = `<p class="msg erreur" role="alert">${esc(errMsg(e, "Impossible de calculer les suggestions."))}</p>`; }
    }

    // Écriture de la case du soir : même méthode que La semaine (mise à jour si la case existe, insertion sinon ; 23505 = case créée entre-temps).
    async function write(card, retry) {
      const ex = await sb.from("recipe_meal_plan").select("*").eq("book_id", S.book).eq("day", day).eq("slot", "soir").maybeSingle();
      if (ex.error) throw ex.error;
      const cur = ex.data; let res;
      if (cur) {
        const patch = { recipe_id: card.id, menu_id: null, state: cur.state === "invites" ? "invites" : "prevu" };
        if (!cur.servings && card.servings) patch.servings = card.servings;
        res = await sb.from("recipe_meal_plan").update(patch).eq("id", cur.id).select("*").single();
      } else {
        res = await sb.from("recipe_meal_plan").insert({ id: uuid(), book_id: S.book, day, slot: "soir", state: "prevu", recipe_id: card.id, menu_id: null, servings: card.servings || null, created_by: me }).select("*").single();
        if (res.error && res.error.code === "23505" && !retry) return write(card, true);
      }
      if (res.error) throw res.error;
      return res.data;
    }
    async function pick(id, b) {
      const card = S.cards && S.cards.get(id); if (!card) return;
      $$("#cs-corps button", sheet).forEach((x) => (x.disabled = true));
      try {
        const row = await write(card);
        S.seq++;
        toast("C'est noté : « " + card.title + " » ce soir.");
        if (opts.onChange) opts.onChange();
        await renderTonight({ plan_id: row.id, state: row.state, recipe_id: card.id, menu_id: null, servings: row.servings, title: card.title }, card);
        const f = $("a.btn", corps()); if (f) f.focus();
      } catch (e) { $$("#cs-corps button", sheet).forEach((x) => (x.disabled = false)); toast(errMsg(e, "Le planning n'a pas pu être modifié."), "erreur"); if (b) b.focus(); }
    }
    function onClick(e) {
      if (e.target === sheet || e.target.closest("[data-close]")) return close();
      const p = e.target.closest("[data-pick]"); if (p) return void pick(p.dataset.pick, p);
      const w = e.target.closest("[data-w]"); if (!w) return;
      if (w.dataset.w === "change" || w.dataset.w === "restart") return void suggest(true);
      if (w.dataset.w === "more") return void suggest(false);
    }
    function onChange(e) {
      if (e.target.id === "cs-book") { S.book = e.target.value; S.who = new Set([me]); S.people = []; return void start(); }
      const w = e.target.closest("[data-who]"); if (!w) return;
      if (w.checked) S.who.add(w.dataset.who); else S.who.delete(w.dataset.who);
      if (!S.who.size) { S.who.add(me); toast("Au moins une personne : « Moi » reste cochée."); }
      S.shown = new Set(); suggest(false).then(() => { const n = $(`[data-who="${CSS.escape(w.dataset.who)}"]`, sheet); if (n) n.focus(); });
    }
    btn.addEventListener("click", open);
  }

  window.AR = { suggestCourses, ceSoir, callPdfJob, MENU_RUBRIQUES, rubriqueReception, menuErr, fmtPages, TIP_CATS, tipErr, relatedTips, tipReason, tipsListHtml, callImport, retype, sb, cfg, $, $$, esc, norm, fmtDate, fmtDay, todayIso, parseDay, fmtQty, fmtUnit, fmtMin, host, safeUrl, errMsg, toast, setMsg, safeNext, getBookPref, setBookPref,
    signedUrls, compressImage, scaleQty: window.ARPure.scaleQty, portionFactor: window.ARPure.portionFactor, showOffline, clearOfflineData, uuid, extractUrl, alertText, diffLines, fmtLine, lineKey, getUser, loadBooks, boot, registerSW, ROLES, COURSES, DIFFICULTES, UNITES,
    VAPID_PUBLIC: AR_VAPID_PUBLIC, ALLERGENES, REGIMES, RAYONS, MOIS, JOURS, cap, addDays, weekdayOf, mondayOf, dayLabel, debounce, fmtShop, fnMessage,
    RUBRIQUES, CRENEAUX, rubriqueDe, prenom, guestPills, loadCatalog, catalogFind, catalogByName, catalogPicker, fetchCards, plancheHtml, dedupeVersions, pickBook, isNetErr, push, swipeBack, sourceFields };
})();
