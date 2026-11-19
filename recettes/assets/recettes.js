// ARÔMES V&N : socle commun (client Supabase, garde d'authentification, navigation, helpers).
// Ne dépend ni de /assets/css/app.css ni de /assets/js/core.js.
(function () {
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

  const ROLES = { owner: "Propriétaire", member: "Membre", reader: "Lecteur" };
  const COURSES = { entree: "Entrée", plat: "Plat", dessert: "Dessert", accompagnement: "Accompagnement", boisson: "Boisson", autre: "Autre" };
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
    const need = [...new Set(paths.filter((p) => p && !urlCache.has(p)))];
    if (need.length && sb) {
      const { data, error } = await sb.storage.from("recipes").createSignedUrls(need, 3600);
      if (error) console.error(error);
      (data || []).forEach((d) => { if (d.signedUrl && d.path) urlCache.set(d.path, d.signedUrl); });
    }
    const out = {};
    paths.forEach((p) => { if (urlCache.has(p)) out[p] = urlCache.get(p); });
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

  // Session et carnets.
  async function getUser() {
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data.session ? data.session.user : null;
  }
  async function loadBooks(userId) {
    const { data, error } = await sb.from("recipe_book_members").select("role, recipe_books(id, name)").eq("user_id", userId);
    if (error) throw error;
    const order = { owner: 0, member: 1, reader: 2 };
    return (data || []).filter((r) => r.recipe_books)
      .map((r) => ({ id: r.recipe_books.id, name: r.recipe_books.name, role: r.role }))
      .sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name, "fr"));
  }

  function mountNav(active, user) {
    const h = $("#site-header");
    if (!h) return;
    const item = (k, href, label) => `<a href="${href}"${active === k ? ' aria-current="page"' : ""}>${label}</a>`;
    h.innerHTML = `<div class="wrap"><a class="brand" href="/recettes/" aria-label="ARÔMES V&amp;N, accueil">Arômes V&amp;N</a>
      <nav class="nav" aria-label="Navigation principale">${item("carnet", "/recettes/", "Le carnet")}${item("ajouter", "/recettes/ajouter.html", "Ajouter")}${item("carnets", "/recettes/carnets.html", "Carnets")}
      <div class="account"><button type="button" id="account-btn" aria-expanded="false" aria-controls="account-panel" aria-label="Compte">Compte</button>
      <div class="account-panel" id="account-panel" hidden><p class="libelle">Connecté</p><p>${esc(user.email || "")}</p><button type="button" class="btn sec petit bloc" id="logout">Se déconnecter</button></div></div></nav></div>`;
    const btn = $("#account-btn"), panel = $("#account-panel");
    btn.addEventListener("click", () => { panel.hidden = !panel.hidden; btn.setAttribute("aria-expanded", String(!panel.hidden)); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); btn.focus(); } });
    $("#logout").addEventListener("click", async () => { await sb.auth.signOut(); location.href = "/recettes/connexion.html"; });
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
    return { user, books };
  }

  function registerSW() {
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      window.addEventListener("load", () => { navigator.serviceWorker.register("/recettes/sw.js", { scope: "/recettes/" }).catch(() => {}); });
    }
  }

  window.AR = { sb, cfg, $, $$, esc, norm, fmtDate, fmtQty, fmtUnit, fmtMin, host, safeUrl, errMsg, toast, setMsg, safeNext, getBookPref, setBookPref,
    signedUrls, compressImage, uuid, extractUrl, alertText, diffLines, fmtLine, lineKey, getUser, loadBooks, boot, registerSW, ROLES, COURSES, DIFFICULTES, UNITES };
})();
