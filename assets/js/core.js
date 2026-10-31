// Vinicellar · socle partagé par toutes les pages connectées :
// client Supabase, contrôle de session, navigation, icônes, formats, fiche (formulaire), étoiles, toasts.
(function () {
  // Lien reçu par e-mail (invitation, création de compte, mot de passe oublié) ouvert sur une autre page :
  // on l'oriente vers la bonne page AVANT que supabase-js ne consomme le jeton.
  const h = location.hash;
  if (/type=(invite|recovery|signup|magiclink)|error_code=/.test(h)) {
    const recovery = /type=recovery/.test(h) || (/error_code=/.test(h) && /mot-de-passe/.test(location.pathname));
    const target = recovery ? "/nouveau-mot-de-passe.html" : "/bienvenue.html";
    if (location.pathname !== target) { location.replace(target + h); return; }
  }

  const cfg = window.VC_CONFIG || {};
  const sb = window.supabase && cfg.supabaseUrl
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey)
    : null;

  // ------------------------------------------------------------------ icônes (traits 1.6, 24×24)
  const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    logo: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h14l-1 9a6 6 0 0 1-12 0z"/><path d="M16 18v10M11 28h10"/><path d="M10.2 9h11.6" opacity=".55"/></svg>`,
    cellar: P('<path d="M3 10 12 4l9 6v10H3z"/><path d="M7 20v-6h10v6M7 17h10"/>'),
    plus: P('<path d="M12 5v14M5 12h14"/>'),
    journal: P('<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/>'),
    places: P('<path d="M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
    user: P('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    camera: P('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
    image: P('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'),
    search: P('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    glass: P('<path d="M7 3h10l-.7 6.5a4.3 4.3 0 0 1-8.6 0z"/><path d="M12 14v7M8.5 21h7"/>'),
    star: `<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="vc-half"><stop offset="50%" style="stop-color:var(--gold)"/><stop offset="50%" style="stop-color:var(--line)"/></linearGradient></defs><path fill="currentColor" d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/></svg>`,
    starHalf: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="url(#vc-half)" d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/></svg>`,
    edit: P('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
    trash: P('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
    sparkle: P('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'),
    back: P('<path d="M15 5 8 12l7 7"/>'),
    move: P('<path d="M4 12h16M14 6l6 6-6 6"/>'),
    out: P('<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>'),
    check: P('<path d="m5 12 4.5 4.5L19 7"/>'),
    thermo: P('<path d="M10 4a2 2 0 0 1 4 0v10a4 4 0 1 1-4 0z"/><path d="M12 9v7"/>'),
    clock: P('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    plate: P('<circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="9"/>'),
    download: P('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>')
  };

  // ------------------------------------------------------------------ libellés
  const CATEGORY = { wine: "Vin", whisky: "Whisky", sake: "Saké", rum: "Rhum", brandy: "Cognac, armagnac, brandy", gin: "Gin", liqueur: "Liqueur", other: "Autre spiritueux" };
  const CATEGORY_SHORT = { wine: "Vin", whisky: "Whisky", sake: "Saké", rum: "Rhum", brandy: "Brandy", gin: "Gin", liqueur: "Liqueur", other: "Autre" };
  const STYLE = { red: "Rouge", white: "Blanc", rose: "Rosé", sparkling: "Effervescent", sweet: "Liquoreux / doux", fortified: "Muté (porto, xérès…)", orange: "Orange (macération)" };
  const KIND = { home: "Domicile", secondary: "Résidence secondaire", storage: "Dépôt / garde-meuble", office: "Bureau", other: "Autre" };
  const CURRENCIES = ["CHF", "EUR", "USD", "GBP"];

  // ------------------------------------------------------------------ utilitaires
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const year = new Date().getFullYear();
  const money = (n, cur = "CHF") => n == null || n === "" ? "" :
    new Intl.NumberFormat("de-CH", { style: "currency", currency: cur || "CHF", maximumFractionDigits: Number(n) % 1 ? 2 : 0 }).format(Number(n));
  const date = (d) => d ? new Date(d + (String(d).length === 10 ? "T12:00:00" : "")).toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
  const today = () => new Date().toISOString().slice(0, 10);
  const range = (a, b, unit = "") => a && b ? (a === b ? `${a}${unit}` : `${a}–${b}${unit}`) : a ? `dès ${a}${unit}` : b ? `jusqu'à ${b}${unit}` : "";
  const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
  const isWine = (it) => (it.category || "wine") === "wine";
  const title = (it) => [it.producer, it.name].filter(Boolean).join(" · ");

  // Statut de la fenêtre de dégustation, du plus urgent au moins urgent.
  function windowStatus(it) {
    const { drink_from: f, drink_to: t, peak_from: pf, peak_to: pt } = it;
    if (!f && !t) return null;
    if (t && year > t) return { key: "past", label: "Fenêtre dépassée", rank: 0 };
    if (t && year >= t - 1) return { key: "soon", label: "À boire vite", rank: 1 };
    if (pf && pt && year >= pf && year <= pt) return { key: "peak", label: "À l'apogée", rank: 2 };
    if (f && year < f) return { key: "young", label: `Garder (dès ${f})`, rank: 4 };
    return { key: "ready", label: "Prêt à boire", rank: 3 };
  }

  // Bouteille dessinée quand aucune image n'est disponible.
  const LIQUID = {
    red: "#5A1525", white: "#D8C27A", rose: "#E6A0A6", sparkling: "#CDB866", sweet: "#C6862A", fortified: "#4A1A12", orange: "#D2873A",
    whisky: "#B0651F", sake: "#DCE6E1", rum: "#77401A", brandy: "#9A5524", gin: "#CFE2E5", liqueur: "#8A3B5A", other: "#8C7A6B"
  };
  function bottleSvg(it = {}) {
    const cat = it.category || "wine";
    const fill = cat === "wine" ? LIQUID[it.style] || LIQUID.red : LIQUID[cat] || LIQUID.other;
    const wine = "M24 4h12v26c0 6 10 10 10 22v62a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V52c0-12 10-16 10-22z";
    const spirit = "M25 4h10v14c0 3 13 6 13 16v80a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4V34c0-10 13-13 13-16z";
    const d = cat === "wine" ? wine : spirit;
    return `<svg viewBox="0 0 60 122" aria-hidden="true"><path d="${d}" fill="${fill}" opacity=".9"/><path d="${d}" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="1.2"/>
      <rect x="${cat === "wine" ? 17 : 15}" y="66" width="${cat === "wine" ? 26 : 30}" height="30" rx="2" fill="#FBF8F3" opacity=".92"/>
      <path d="M${cat === "wine" ? 21 : 19} 76h${cat === "wine" ? 18 : 22}M${cat === "wine" ? 23 : 21} 83h${cat === "wine" ? 14 : 18}" stroke="#6B1E2E" stroke-width="1.6" opacity=".55"/>
      <rect x="${cat === "wine" ? 23.5 : 24.5}" y="2" width="${cat === "wine" ? 13 : 11}" height="9" rx="1.5" fill="${cat === "wine" ? "#3A2A24" : "#6B4B2E"}"/></svg>`;
  }

  // ------------------------------------------------------------------ images privées (URL signées)
  const signedCache = new Map();
  async function signed(paths) {
    const need = [...new Set(paths.filter((p) => p && !signedCache.has(p)))];
    if (need.length && sb) {
      const { data } = await sb.storage.from("labels").createSignedUrls(need, 3600);
      (data || []).forEach((r) => r.signedUrl && signedCache.set(r.path, r.signedUrl));
    }
    return (p) => signedCache.get(p) || null;
  }
  const mainImagePath = (it) => it.bottle_path || it.label_path || null;

  // ------------------------------------------------------------------ navigation
  const NAV = [
    { id: "cellar", href: "/app/", label: "Ma cave", icon: "cellar" },
    { id: "journal", href: "/app/journal.html", label: "Journal", icon: "journal" },
    { id: "add", href: "/app/ajouter.html", label: "Ajouter", icon: "plus" },
    { id: "places", href: "/app/caves.html", label: "Caves", icon: "places" },
    { id: "account", href: "/app/compte.html", label: "Compte", icon: "user" }
  ];
  function renderNav(active) {
    const top = $("#topbar");
    if (top) {
      top.className = "topbar";
      top.innerHTML = `<div class="wrap"><a class="brand" href="/app/">${I.logo}<span>Vinicellar</span></a>
        <nav class="nav" aria-label="Navigation principale">
          ${NAV.filter((n) => n.id !== "add").map((n) => `<a href="${n.href}"${n.id === active ? ' aria-current="page"' : ""}>${n.label}</a>`).join("")}
          <a class="btn" href="/app/ajouter.html">${I.plus}Ajouter</a>
        </nav></div>`;
    }
    const tab = $("#tabbar");
    if (tab) {
      tab.className = "tabbar";
      tab.setAttribute("aria-label", "Navigation");
      tab.innerHTML = NAV.map((n) => n.id === "add"
        ? `<a class="tab-add" href="${n.href}"${n.id === active ? ' aria-current="page"' : ""}><span class="plus">${I.plus}</span><span class="sr">${n.label}</span></a>`
        : `<a href="${n.href}"${n.id === active ? ' aria-current="page"' : ""}>${I[n.icon]}<span>${n.label}</span></a>`).join("");
    }
  }

  // ------------------------------------------------------------------ session
  async function boot(active) {
    renderNav(active);
    if (!sb) { location.replace("/"); return new Promise(() => {}); }
    const { data } = await sb.auth.getSession();
    if (!data.session) { location.replace("/?next=" + encodeURIComponent(location.pathname + location.search)); return new Promise(() => {}); }
    const user = data.session.user;
    const { data: profile } = await sb.from("profiles").select("*").eq("id", user.id).single();
    if (!profile || !profile.onboarded_at) { location.replace("/bienvenue.html"); return new Promise(() => {}); }
    return { user, profile };
  }

  // ------------------------------------------------------------------ toasts et erreurs
  let toastTimer;
  function toast(text, action) {
    $(".toast")?.remove();
    clearTimeout(toastTimer);
    const el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.innerHTML = `<span>${esc(text)}</span>`;
    if (action) {
      const b = document.createElement("button");
      b.textContent = action.label;
      b.addEventListener("click", () => { el.remove(); action.run(); });
      el.append(b);
    }
    document.body.append(el);
    toastTimer = setTimeout(() => el.remove(), action ? 7000 : 3500);
  }
  function fail(error, fallback = "Une erreur est survenue.") {
    console.error(error);
    const m = error && error.message ? error.message : "";
    toast(/aucune bouteille|pas assez|invalide|introuvable/.test(m) ? m.charAt(0).toUpperCase() + m.slice(1) + "." : fallback);
  }

  // ------------------------------------------------------------------ étoiles (0 à 5, demi-points)
  function stars(value, onChange, { read = false, label = "Note" } = {}) {
    const box = document.createElement("div");
    box.className = "stars" + (read ? " read" : "");
    box.setAttribute("role", read ? "img" : "group");
    box.setAttribute("aria-label", `${label} : ${value ? String(value).replace(".", ",") : "aucune"} sur 5`);
    let v = Number(value) || 0;
    const draw = () => {
      box.innerHTML = "";
      for (let i = 1; i <= 5; i++) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = v >= i ? "on" : v >= i - .5 ? "half" : "";
        b.innerHTML = v >= i ? I.star : v >= i - .5 ? I.starHalf : I.star;
        if (!read) {
          b.setAttribute("aria-label", `${i} étoile${i > 1 ? "s" : ""}`);
          b.addEventListener("click", (e) => {
            const r = b.getBoundingClientRect();
            const half = e.clientX && e.clientX - r.left < r.width / 2;
            let nv = half ? i - .5 : i;
            if (nv === v) nv = 0;          // toucher la même étoile efface la note
            v = nv; draw(); onChange && onChange(v || null);
          });
        }
        box.append(b);
      }
    };
    draw();
    box.value = () => v || null;
    return box;
  }

  // ------------------------------------------------------------------ formulaire de fiche (ajout et modification)
  const F = (k, label, type = "text", extra = {}) => ({ k, label, type, ...extra });
  const SECTIONS = [
    { legend: "Identité", fields: [
      F("category", "Type", "select", { opts: CATEGORY }),
      F("style", "Couleur / style", "select", { opts: STYLE, empty: "—", wineOnly: true }),
      F("name", "Nom de la cuvée", "text", { required: true, wide: true, placeholder: "ex. Dézaley Grand Cru Médinette" }),
      F("producer", "Producteur / domaine / distillerie"),
      F("vintage", "Millésime", "number", { min: 1800, max: 2100, placeholder: "ex. 2019" }),
      F("country", "Pays"),
      F("region", "Région"),
      F("appellation", "Appellation"),
      F("grapes", "Cépages (séparés par des virgules)", "csv", { wineOnly: true, wide: true }),
      F("abv", "Degré (% vol.)", "number", { step: .1, min: 0, max: 100 }),
      F("volume_cl", "Contenance (cl)", "number", { min: 1, max: 3000 }),
      F("producer_url", "Site du producteur", "url", { wide: true, placeholder: "https://" })
    ] },
    { legend: "Garde et service", fields: [
      F("drink_from", "Fenêtre idéale, de", "number", { min: 1800, max: 2200 }),
      F("drink_to", "jusqu'à", "number", { min: 1800, max: 2200 }),
      F("aging_potential_years", "Garde recommandée (années)", "number", { min: 0, max: 200 }),
      F("peak_from", "Apogée, de", "number", { min: 1800, max: 2200 }),
      F("peak_to", "jusqu'à", "number", { min: 1800, max: 2200 }),
      F("window_source", "Source de la fenêtre", "text", { placeholder: "ex. producteur, estimation" }),
      F("serving_temp_min", "Service, de (°C)", "number", { min: -5, max: 30 }),
      F("serving_temp_max", "à (°C)", "number", { min: -5, max: 30 })
    ] },
    { legend: "Description", fields: [
      F("description", "Le vin", "textarea", { wide: true }),
      F("vinification", "Vinification / élaboration", "textarea", { wide: true }),
      F("terroir", "Sols et climat", "textarea", { wide: true }),
      F("vintage_notes", "Particularités du millésime ou de la cuvée", "textarea", { wide: true }),
      F("pairings", "Accords mets (un par ligne)", "lines", { wide: true }),
      F("details", "Détails (une ligne « clé : valeur », ex. Âge : 18 ans)", "kv", { wide: true })
    ] },
    { legend: "Notes et prix", fields: [
      F("avg_score", "Note moyenne", "number", { step: .1, min: 0, max: 100 }),
      F("avg_score_scale", "Sur", "select", { opts: { 5: "/5", 10: "/10", 20: "/20", 100: "/100" }, empty: "—" }),
      F("avg_score_source", "Source de la note"),
      F("market_price", "Prix du marché", "number", { step: .05, min: 0 }),
      F("market_currency", "Devise", "select", { opts: Object.fromEntries(CURRENCIES.map((c) => [c, c])) }),
      F("price_source", "Source du prix"),
      F("purchase_price", "Mon prix d'achat", "number", { step: .05, min: 0 }),
      F("purchase_currency", "Devise", "select", { opts: Object.fromEntries(CURRENCIES.map((c) => [c, c])) }),
      F("purchase_year", "Année d'achat", "number", { min: 1900, max: 2100 }),
      F("purchase_place", "Acheté chez", "text", { wide: true }),
      F("notes", "Mes remarques", "textarea", { wide: true })
    ] }
  ];

  function fieldValue(f, it) {
    const v = it[f.k];
    if (f.type === "csv") return (v || []).join(", ");
    if (f.type === "lines") return (v || []).join("\n");
    if (f.type === "kv") return Object.entries(v || {}).map(([a, b]) => `${a} : ${b}`).join("\n");
    return v ?? "";
  }

  function renderItemForm(form, it = {}, { currency = "CHF" } = {}) {
    const data = { category: "wine", market_currency: currency, purchase_currency: currency, volume_cl: 75, ...it };
    form.innerHTML = SECTIONS.map((s) => `<fieldset><legend>${s.legend}</legend><div class="grid2">${s.fields.map((f) => {
      const val = esc(fieldValue(f, data));
      const attrs = `name="${f.k}"${f.required ? " required" : ""}${f.min != null ? ` min="${f.min}"` : ""}${f.max != null ? ` max="${f.max}"` : ""}${f.step ? ` step="${f.step}"` : ""}${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ""}`;
      let input;
      if (f.type === "select") {
        input = `<select ${attrs}>${f.empty ? `<option value="">${f.empty}</option>` : ""}${Object.entries(f.opts).map(([k, l]) => `<option value="${k}"${String(data[f.k] ?? "") === k ? " selected" : ""}>${l}</option>`).join("")}</select>`;
      } else if (f.type === "textarea" || f.type === "lines" || f.type === "kv") {
        input = `<textarea ${attrs} rows="${f.type === "textarea" ? 3 : 4}">${val}</textarea>`;
      } else {
        input = `<input ${attrs} type="${f.type === "csv" ? "text" : f.type}" value="${val}"${f.type === "number" ? ' inputmode="decimal"' : ""}>`;
      }
      return `<label${f.wide ? ' class="wide"' : ""}${f.wineOnly ? " data-wine-only" : ""}>${f.label}${input}</label>`;
    }).join("")}</div></fieldset>`).join("");
    const cat = form.querySelector('[name="category"]');
    const sync = () => $$("[data-wine-only]", form).forEach((el) => (el.hidden = cat.value !== "wine"));
    cat.addEventListener("change", sync);
    sync();
  }

  function readItemForm(form) {
    const out = {};
    for (const s of SECTIONS) for (const f of s.fields) {
      const el = form.elements[f.k];
      if (!el) continue;
      const raw = el.value.trim();
      if (f.type === "number") out[f.k] = raw === "" ? null : Number(raw.replace(",", "."));
      else if (f.type === "csv") out[f.k] = raw ? raw.split(",").map((x) => x.trim()).filter(Boolean) : [];
      else if (f.type === "lines") out[f.k] = raw ? raw.split("\n").map((x) => x.trim()).filter(Boolean) : [];
      else if (f.type === "kv") out[f.k] = Object.fromEntries(raw.split("\n").map((l) => l.split(/\s*:\s*/)).filter((p) => p[0] && p.length > 1).map(([a, ...b]) => [a.trim(), b.join(" : ").trim()]));
      else if (f.k === "avg_score_scale") out[f.k] = raw ? Number(raw) : null;
      else out[f.k] = raw || null;
    }
    if (out.category !== "wine") { out.style = null; }
    if (out.producer_url && !safeUrl(out.producer_url)) out.producer_url = safeUrl("https://" + out.producer_url);
    return out;
  }

  // Champs renvoyés par l'analyse IA et copiés tels quels dans la fiche.
  const AI_FIELDS = ["category", "style", "name", "producer", "producer_url", "vintage", "country", "region", "appellation", "grapes", "abv", "volume_cl",
    "description", "vinification", "terroir", "vintage_notes", "pairings", "serving_temp_min", "serving_temp_max", "drink_from", "drink_to",
    "peak_from", "peak_to", "aging_potential_years", "window_source", "avg_score", "avg_score_scale", "avg_score_source", "market_price",
    "market_currency", "price_source", "details"];

  // Appel de la fonction d'analyse (photo et/ou nom).
  async function identify(payload) {
    const { data, error } = await sb.functions.invoke("identify", { body: payload });
    if (error) {
      let msg = "L'analyse a échoué.";
      try { const j = await error.context.json(); if (j && j.message) msg = j.message; } catch { /* réponse vide */ }
      throw new Error(msg);
    }
    return data;
  }

  // Redimensionne une photo (côté navigateur) : envoi plus rapide, quota de stockage préservé.
  async function shrink(file, max = 1600, quality = .85) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", quality));
      const b64 = c.toDataURL("image/jpeg", quality).split(",")[1];
      return { blob, b64, preview: URL.createObjectURL(blob) };
    } finally { URL.revokeObjectURL(url); }
  }

  window.VC = {
    sb, cfg, I, CATEGORY, CATEGORY_SHORT, STYLE, KIND, CURRENCIES, AI_FIELDS,
    $, $$, esc, money, date, today, year, range, safeUrl, host, isWine, title,
    windowStatus, bottleSvg, signed, mainImagePath, renderNav, boot, toast, fail, stars,
    renderItemForm, readItemForm, identify, shrink
  };
})();
