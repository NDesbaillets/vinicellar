// Fiche d'une bouteille (refonte, F1 compactée) : en-tête façon fiche de cave, stock par cave, tableau choisi dans le Compte,
// frise de garde, dernières dégustations, puis la fiche complète dépliée sur place. Photos et aperçu : dans une feuille.
(async function () {
  const VC = window.VC;
  const { sb, $, $$, esc, I, CATEGORY, STYLE, KIND, money, date, today, year, range, safeUrl, host, windowStatus, bottleSvg, signed, stars, toast, fail, flag } = VC;
  const ctx = await VC.boot("cellar");
  const main = $("#main");
  document.body.classList.add("is-fiche");
  const id = new URLSearchParams(location.search).get("id");
  if (!id) return location.replace("/app/");

  let it, places, stock, tastings, getUrl;

  // Retour : vers la page d'où l'on vient (Carnet, Sommelier, Sortir), sinon vers la Cave. Mémorisé par fiche pour
  // survivre à un rechargement ; un retour par l'historique garde la position et les filtres de la page d'origine.
  const ORIGINS = { "/app/journal.html": "Dégustations", "/app/historique.html": "Vins passés", "/app/envies.html": "Envies", "/app/bilan.html": "Bilan",
    "/app/sommelier.html": "Sommelier", "/app/sortir.html": "Sortir" };
  const back = (() => {
    const key = "vc.back." + id, cave = { href: `/app/?loc=${encodeURIComponent(VC.getLoc() || "all")}`, label: "Cave" };
    let ref = null;
    try { const r = new URL(document.referrer); if (r.origin === location.origin) ref = r; } catch { /* pas de page d'origine */ }
    try {
      if (ref && ORIGINS[ref.pathname]) { const b = { href: ref.pathname + ref.search, label: ORIGINS[ref.pathname], history: true }; sessionStorage.setItem(key, JSON.stringify(b)); return b; }
      if (ref && (ref.pathname === "/app/" || ref.pathname === "/app/index.html")) { sessionStorage.removeItem(key); return cave; }
      const saved = JSON.parse(sessionStorage.getItem(key) || "null");
      if (saved && ORIGINS[saved.href.split("?")[0]]) return { ...saved, history: false };
    } catch { /* stockage indisponible */ }
    return cave;
  })();
  main.addEventListener("click", (e) => {
    const a = e.target.closest(".f-back");
    if (a && back.history && history.length > 1) { e.preventDefault(); history.back(); }
  });

  async function load() {
    const [a, b, c, d] = await Promise.all([
      sb.from("items").select("*").eq("id", id).single(),
      VC.loadPlaces(),
      sb.from("stock").select("*").eq("item_id", id),
      sb.from("tastings").select("*").eq("item_id", id).order("tasted_on", { ascending: false }).order("created_at", { ascending: false })
    ]);
    if (a.error || !a.data) { main.innerHTML = `<div class="empty"><p>Fiche introuvable.</p><a class="btn" href="/app/">Retour à la cave</a></div>`; return false; }
    it = a.data; places = (b || []).filter((p) => p.collection_id === a.data.collection_id); stock = c.data || []; tastings = d.data || [];
    getUrl = await signed([it.bottle_path, it.label_path, it.label_back_path, ...(it.photo_paths || [])]);
    document.title = `${it.name}${it.vintage ? " " + it.vintage : ""} · Vinicellar`;
    return true;
  }

  const ro = () => !VC.canEdit(it.collection_id);
  const placeName = (pid) => (places.find((p) => p.id === pid) || {}).name || "Lieu supprimé";
  const total = () => stock.reduce((a, s) => a + s.quantity, 0);
  const withStock = () => stock.filter((s) => s.quantity > 0);

  // ---------------------------------------------------------------- rendu
  // Toutes les photos de la fiche ; la vignette (cover) est celle des listes. Ajout et choix réservés aux éditeurs.
  function visual() {
    const imgs = [it.bottle_path && { p: it.bottle_path, l: "Bouteille" }, it.label_path && { p: it.label_path, l: "Étiquette" },
      it.label_back_path && { p: it.label_back_path, l: "Contre-étiquette" }, ...(it.photo_paths || []).map((p) => ({ p, l: VC.Visual?.isVisual(p) ? "Visuel propre" : VC.Visual?.isFull(p) ? "Bouteille entière" : "Photo", extra: true }))]
      .filter(Boolean).map((x) => ({ ...x, u: getUrl(x.p) })).filter((x) => x.u);
    const cover = VC.mainImagePath(it);
    let cur = Math.max(0, imgs.findIndex((x) => x.p === cover));
    const show = (i) => {
      cur = i;
      $("#visual").innerHTML = imgs[i] ? `<img src="${esc(imgs[i].u)}" alt="${esc(imgs[i].l)} : ${esc(it.name)}" decoding="async">` : bottleSvg(it);
      $("#visual").dataset.kind = VC.Visual?.isVisual(imgs[i]?.p) ? "visual" : imgs[i]?.l.startsWith("Bouteille") ? "bottle" : "photo";
      $$("#vswitch button[data-i]").forEach((b, j) => b.setAttribute("aria-pressed", String(i === j)));
      const tools = $("#vtools");
      if (!tools) return;
      const x = imgs[i];
      const hasVisual = imgs.some((y) => VC.Visual?.isVisual(y.p));
      tools.innerHTML = `${VC.Visual && imgs.some((y) => !VC.Visual.isVisual(y.p)) ? `<button class="btn${hasVisual ? " quiet" : ""}" data-v="visual">${I.sparkle}${hasVisual ? "Refaire l'aperçu" : "Créer l'aperçu"}</button>` : ""}
        ${x && x.p !== cover ? `<button class="btn quiet" data-v="cover">${I.check}Utiliser comme vignette</button>` : x ? `<span class="faint" style="font-size:var(--fs-2)">Vignette actuelle</span>` : ""}
        ${x && x.extra ? `<button class="btn quiet" data-v="del">${I.trash}Retirer de la galerie</button>` : ""}
        <label class="btn ${imgs.some((y) => VC.Visual?.isFull(y.p)) ? "quiet" : "ghost"}">${I.camera}${imgs.some((y) => VC.Visual?.isFull(y.p)) ? "Nouvelle photo de la bouteille" : "Photo de la bouteille entière"}<input type="file" accept="image/*" capture="environment" data-v="full" hidden></label>
        <label class="btn quiet">${I.image}Ajouter une photo<input type="file" accept="image/*" data-v="add" hidden></label>
        ${!imgs.some((y) => VC.Visual?.isFull(y.p)) ? `<p class="hint vis-tip">Photographiez la bouteille entière, de la capsule au pied et de face : l'aperçu utilisera votre vraie bouteille.</p>` : ""}`;
    };
    $("#vswitch").innerHTML = imgs.length > 1 ? imgs.map((x, j) => `<button type="button" data-i="${j}" aria-label="${x.l}" class="${x.p === cover ? "is-cover" : ""}${VC.Visual?.isVisual(x.p) ? " is-visual" : ""}"><img src="${esc(x.u)}" alt=""></button>`).join("") : "";
    $$("#vswitch button[data-i]").forEach((b) => b.addEventListener("click", () => show(+b.dataset.i)));
    show(cur);
    if (ro() || !$("#vtools")) return;
    $("#vtools").onclick = async (e) => {
      const b = e.target.closest("[data-v]");
      if (!b || b.tagName === "INPUT") return;
      const x = imgs[cur];
      if (b.dataset.v === "visual") return VC.Visual.open(it, imgs.filter((y) => y.p !== it.bottle_path), refresh);
      if (b.dataset.v === "cover") {
        const { error } = await sb.from("items").update({ cover_path: x.p }).eq("id", id);
        if (error) return fail(error);
        toast("Vignette mise à jour."); return refresh();
      }
      if (b.dataset.v === "del") {
        if (!confirm("Retirer cette photo de la galerie ? Le fichier original sera conservé dans le stockage privé.")) return;
        const { error } = await sb.from("items").update({ photo_paths: (it.photo_paths || []).filter((p) => p !== x.p), ...(it.cover_path === x.p ? { cover_path: null } : {}) }).eq("id", id);
        if (error) return fail(error);
        toast("Photo retirée de la galerie. Original conservé."); return refresh();
      }
    };
    $("#vtools").onchange = async (e) => {
      const full = e.target.closest('input[data-v="full"]');
      if (full && full.files[0]) {
        // Photo de la bouteille entière (2400 px), puis la feuille d'aperçu s'ouvre directement dessus.
        try {
          const img = await VC.shrink(full.files[0], 2400, .9), path = `${ctx.user.id}/full-${crypto.randomUUID()}.jpg`;
          const up = await sb.storage.from("labels").upload(path, img.blob, { contentType: "image/jpeg" });
          if (up.error) throw up.error;
          const { error } = await sb.from("items").update({ photo_paths: [...(it.photo_paths || []), path] }).eq("id", id);
          if (error) throw error;
          await refresh();
          const srcs = [it.bottle_path && { p: it.bottle_path }, it.label_path && { p: it.label_path, l: "Étiquette" }, it.label_back_path && { p: it.label_back_path, l: "Contre-étiquette" },
            ...(it.photo_paths || []).map((p) => ({ p, l: VC.Visual.isFull(p) ? "Bouteille entière" : "Photo" }))].filter((x) => x && x.p !== it.bottle_path);
          const get = await signed(srcs.map((x) => x.p));
          VC.Visual.open(it, srcs.map((x) => ({ ...x, u: get(x.p) })).filter((x) => x.u), refresh, path);
        } catch (err) { fail(err, "Photo non enregistrée."); }
        return;
      }
      const inp = e.target.closest('input[data-v="add"]');
      if (!inp || !inp.files[0]) return;
      try {
        const img = await VC.shrink(inp.files[0]);
        const type = img.blob.type || "image/jpeg", path = `${ctx.user.id}/photo-${crypto.randomUUID()}.${type.split("/")[1]}`;
        const up = await sb.storage.from("labels").upload(path, img.blob, { contentType: type });
        if (up.error) throw up.error;
        const patch = { photo_paths: [...(it.photo_paths || []), path] };
        if (!VC.mainImagePath(it)) patch.cover_path = path;
        const { error } = await sb.from("items").update(patch).eq("id", id);
        if (error) throw error;
        toast("Photo ajoutée. Touchez « Utiliser comme vignette » pour l'afficher dans la liste.");
        await refresh();
        const k = $$("#vswitch button[data-i]").length - 1; if (k > 0) $$("#vswitch button[data-i]")[k].click();
      } catch (err) { fail(err, "Photo non enregistrée."); }
    };
  }

  // En cave : total et « Sortir » sur une ligne, puis une ligne par cave (une seule si le vin n'est que dans une cave).
  function stockCard() {
    const n = total(), rows = withStock();
    if (!n) return `<section class="f-stock card"><div class="f-stock-top"><b class="f-n">Plus en cave</b>${ro() ? "" : `<button class="btn ghost" id="add-stock">${I.plus}Remettre des bouteilles</button>`}</div>
      ${ro() ? "" : `<div class="f-links"><button class="btn quiet" id="wish">${I.plus}Ajouter aux envies</button></div>`}</section>`;
    const line = (s) => { const p = places.find((x) => x.id === s.location_id) || {};
      return `<div class="f-cave"><span><b>${esc(p.name || "Lieu supprimé")}</b>${s.bin ? `<small>${esc(s.bin)}</small>` : ""}</span>
        ${ro() ? `<output>${s.quantity}</output>` : `<button class="step" data-adj="-1" data-loc="${s.location_id}" aria-label="Retirer une bouteille, ${esc(p.name || "")} (correction sans trace)"${s.quantity ? "" : " disabled"}>−</button><output>${s.quantity}</output><button class="step" data-adj="1" data-loc="${s.location_id}" aria-label="Ajouter une bouteille, ${esc(p.name || "")}">+</button>`}</div>`; };
    return `<section class="f-stock card" aria-label="En cave">
      <div class="f-stock-top"><span class="f-n"><b>${n}</b> en cave</span>${ro() ? "" : `<button class="btn" id="drink">${I.glass}Sortir une bouteille</button>`}</div>
      ${rows.map(line).join("")}
      ${ro() ? `<p class="faint f-ro">Cave partagée en lecture seule.</p>` : `<div class="f-links"><button class="btn quiet" id="add-stock">${I.plus}Autre cave</button>${places.length > 1 ? `<button class="btn quiet" id="move">${I.move}Déplacer</button>` : ""}<button class="btn quiet" id="wish">${I.plus}Envies</button></div>`}</section>`;
  }

  function scoreText() {
    if (it.avg_score == null) return "";
    const s = String(it.avg_score).replace(".", ",");
    return it.avg_score_scale ? `${s}/${it.avg_score_scale}` : s;
  }

  // Tableau des informations essentielles : les lignes choisies dans le Compte, sans les lignes vides.
  function table() {
    const rows = VC.ficheRows(ctx.profile).map((k) => [VC.FICHE_ROWS[k].label, VC.FICHE_ROWS[k].v(it, { stock })]).filter(([, v]) => v !== "" && v != null);
    return rows.length ? `<section class="card f-table"><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></section>` : "";
  }

  // Frise de garde à l'échelle : buvable, apogée, année en cours.
  function garde() {
    if (!VC.isWine(it)) return "";
    const { vintage: v, drink_from: df, drink_to: dt, peak_from: pf, peak_to: pt, aging_potential_years: ap } = it;
    const to = dt || (v && ap ? v + ap : null);
    if (!df && !to && !pf) return "";
    const w = windowStatus(it);
    const a = Math.min(...[df, pf, year].filter(Boolean)) - 1, b = Math.max(...[to, pt, year + 1].filter(Boolean)) + 1, span = Math.max(1, b - a);
    const pc = (x) => `${(((x - a) / span) * 100).toFixed(1)}%`;
    const bar = (x0, x1, cls) => `<span class="${cls}" style="left:${pc(x0)};width:calc(${pc(x1)} - ${pc(x0)})"></span>`;
    const mid = Math.round((a + b) / 2);
    const label = [df || to ? `buvable ${range(df || a + 1, to || b - 1)}` : "", pf ? `apogée ${range(pf, pt)}` : "", `nous sommes en ${year}`].filter(Boolean).join(", ");
    return `<section class="card f-garde"><div class="f-sec-h"><h2 class="eyebrow">Garde</h2>${w ? `<span class="tag ${w.key}">${w.label}</span>` : ""}</div>
      <div class="tl" role="img" aria-label="Garde : ${label}"><div class="tl-bar">${df || to ? bar(df || a + .5, (to || b - .5) + 1, "tl-drink") : ""}${pf ? bar(pf, (pt || pf) + 1, "tl-peak") : ""}<span class="tl-now" style="left:${pc(year + .5)}"></span></div>
      <div class="tl-ax"><span>${a}</span><span>${mid}</span><span>${b}</span></div></div>
      <div class="tl-legend">${df || to ? `<span><i class="k-drink"></i>Buvable ${range(df, to)}</span>` : ""}${pf ? `<span><i class="k-peak"></i>Apogée ${range(pf, pt)}</span>` : ""}${it.window_source ? `<span class="faint">Source : ${esc(it.window_source)}</span>` : ""}</div></section>`;
  }

  const tastingRow = (t) => `<div class="f-tasting">
      <div class="f-tasting-h"><b>${date(t.tasted_on)}</b>${t.rating ? `<span class="stars-slot" data-r="${t.rating}"></span><span>${String(t.rating).replace(".", ",")}/5</span>` : ""}<span class="tag ${t.reason === "gifted" ? "peak" : t.reason === "other" ? "none" : "ready"}">${VC.REASON[t.reason] || "Bue"}${t.recipient ? " à " + esc(t.recipient) : ""}</span>
        ${ro() ? "" : `<button class="btn quiet f-undo" data-undo="${t.id}" aria-label="Supprimer cette sortie et remettre la bouteille en cave">${I.trash}</button>`}</div>
      ${t.pairing ? `<p class="f-pair">${esc(t.pairing)}</p>` : ""}${t.notes ? `<p>${esc(t.notes)}</p>` : ""}</div>`;

  // Mes dégustations : les 3 dernières, toujours visibles ; le reste dans la fiche complète.
  function tastingsRecent() {
    if (!tastings.length) return "";
    return `<section class="card f-tastings"><div class="f-sec-h"><h2 class="eyebrow">Mes dégustations</h2><span class="faint">${tastings.length}</span></div>${tastings.slice(0, 3).map(tastingRow).join("")}</section>`;
  }

  function prose() {
    const block = (h, t) => t ? `<h3>${h}</h3><p>${esc(t)}</p>` : "";
    const wine = VC.isWine(it);
    return block(wine ? "Le vin" : "Le produit", it.description) + block(wine ? "Vinification" : "Élaboration", it.vinification) +
      block(wine ? "Terroir et climat" : "Origine", it.terroir) + block(wine ? "Le millésime, la cuvée" : "Particularités", it.vintage_notes);
  }

  function prices() {
    const f = [];
    const add = (k, v, small) => v && f.push(`<dt>${k}</dt><dd>${v}${small ? ` <small class="faint">${small}</small>` : ""}</dd>`);
    add("Valeur actuelle", it.market_price ? money(it.market_price, it.market_currency) : "", esc(it.price_source || ""));
    add("Prix d'achat", it.purchase_price ? money(it.purchase_price, it.purchase_currency) : "", esc([it.purchase_year, it.purchase_place].filter(Boolean).join(" · ")));
    if (it.purchase_price && it.market_price && it.purchase_currency === it.market_currency) { const d = Math.round((it.market_price / it.purchase_price - 1) * 100); add("Plus-value", `${d > 0 ? "+" : ""}${d} %`); }
    if (VC.isWine(it)) add("Cépages", esc((it.grapes || []).join(", ")));
    add("Degré", it.abv ? `${String(it.abv).replace(".", ",")} % vol.` : "");
    return f.length ? `<dl class="f-kv">${f.join("")}</dl>` : "";
  }

  function sources() {
    const list = (Array.isArray(it.sources) ? it.sources : []).map((s) => ({ ...s, url: safeUrl(s.url) })).filter((s) => s.url).slice(0, 8);
    if (!it.ai_enriched_at && !list.length) return "";
    return `<p class="sources">${it.ai_enriched_at ? `Fiche complétée automatiquement le ${date(it.ai_enriched_at.slice(0, 10))}, à vérifier. ` : ""}
      ${list.length ? "Sources : " + list.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(host(s.url))}</a>`).join(", ") : ""}</p>`;
  }

  // Fiche complète, dépliée sur place : notes côte à côte, récit, accords, prix, détails, toutes les sorties, actions.
  function complete() {
    const d = Object.entries(it.details || {});
    return `<div class="f-full" id="full" hidden>
      <div class="f-scores"><div><span id="my-rating"></span><small>Ma note</small></div><div><b>${it.avg_score != null ? esc(scoreText()) : "–"}</b><small>Moyenne en ligne${it.avg_score_source ? ` · ${esc(it.avg_score_source)}` : ""}</small></div></div>
      ${prose()}
      ${(it.pairings || []).length ? `<h3>Accords</h3><ul class="pairings">${it.pairings.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
      ${prices() ? `<h3>Prix et caractéristiques</h3>${prices()}` : ""}
      ${d.length ? `<h3>Détails</h3><dl class="f-kv">${d.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
      ${it.notes ? `<h3>Mes remarques</h3><p style="white-space:pre-line">${esc(it.notes)}</p>` : ""}
      ${tastings.length > 3 ? `<h3>Toutes les sorties</h3>${tastings.slice(3).map(tastingRow).join("")}` : ""}
      ${sources()}
      ${ro() ? "" : `<div class="f-actions"><button class="btn ghost" id="edit">${I.edit}Modifier la fiche</button><button class="btn ghost" id="refresh">${I.sparkle}Actualiser avec l'IA</button><button class="btn danger" id="delete">${I.trash}Supprimer</button></div>`}
    </div>`;
  }

  // Vignette de l'en-tête : l'aperçu (ou la meilleure photo) ; toucher ouvre la galerie.
  function headThumb() {
    const path = VC.mainImagePath(it), u = path && getUrl(path);
    return `<div class="f-thumb${VC.Visual?.isVisual(path) ? " is-visual" : ""}">${u ? `<img src="${esc(u)}" alt="" decoding="async">` : bottleSvg(it)}${flag(it)}
      <button class="photo-btn" id="photos" aria-label="Photos et aperçu de la bouteille">${I.camera}</button></div>`;
  }

  function render() {
    const kind = it.category === "wine" ? (STYLE[it.style] ? `Vin ${STYLE[it.style].toLowerCase()}` : "Vin") : CATEGORY[it.category];
    const origin = [VC.regionOf(it) || it.region, VC.countryOf(it)].filter(Boolean).join(" · ");
    const r = it.my_rating;
    main.innerHTML = `<div class="f-page">
      <div class="f-top"><a class="f-back" href="${esc(back.href)}">${I.back}${back.label}</a><a class="me" href="/app/compte.html" aria-label="Mon compte">${I.user}</a></div>
      <header class="card f-head">${headThumb()}
        <div class="f-who"><span class="f-kind">${esc([it.producer, kind].filter(Boolean).join(" · "))}</span>
          <h1>${esc(it.name)}</h1>${it.vintage ? `<span class="f-vintage">${it.vintage}</span>` : ""}
          ${origin ? `<span class="f-origin">${esc(origin)}</span>` : ""}
          <span class="f-rate">${r ? `<span class="stars-slot" data-r="${r}"></span><b>${String(r).replace(".", ",")}</b><small>ma note</small>` : `<small>Pas encore noté</small>`}</span></div>
      </header>
      <div id="stock">${stockCard()}</div>
      ${table()}${garde()}${tastingsRecent()}
      <section class="card f-more-wrap"><button class="f-more" id="more" aria-expanded="false" aria-controls="full">Voir la fiche complète ${I.chevron || "▾"}</button>${complete()}</section>
    </div>`;
    $("#my-rating").append(stars(it.my_rating, async (v) => {
      const { error } = await sb.from("items").update({ my_rating: v }).eq("id", id);
      if (error) return fail(error);
      it.my_rating = v; toast(v ? "Note enregistrée." : "Note effacée.");
    }, { label: "Ma note", read: ro() }));
    $$(".stars-slot").forEach((s) => s.dataset.r && s.append(stars(+s.dataset.r, null, { read: true })));
    if (open) { $("#full").hidden = false; $("#more").setAttribute("aria-expanded", "true"); }
    bind();
  }
  let open = false;

  // Galerie : toutes les photos, le choix de la vignette, l'aperçu et l'ajout de photos (ancien bloc visuel de la fiche).
  function openGallery() {
    const d = VC.sheet(`<div class="gal"><h2>Photos et aperçu</h2><div class="visual" id="visual"></div><div class="visual-switch" id="vswitch"></div>${ro() ? "" : `<div class="row" id="vtools" style="margin-top:8px"></div>`}
      <div class="row end" style="margin-top:12px"><button class="btn quiet" data-close>Fermer</button></div></div>`);
    d.classList.add("wide");
    visual();
  }

  // ---------------------------------------------------------------- actions
  async function refresh() { if (await load()) { render(); if ($("dialog #visual")) visual(); } }

  function bind() {
    $("#stock").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-adj]");
      if (!b) return;
      b.disabled = true;
      const delta = +b.dataset.adj, loc = b.dataset.loc;
      const { error } = await sb.rpc("adjust_stock", { p_item: id, p_location: loc, p_delta: delta });
      if (error) return fail(error);
      await refresh();
      toast(delta > 0 ? "Bouteille ajoutée." : "Stock corrigé, sans trace dans le carnet.", { label: "Annuler", run: async () => {
        const { error: ue } = await sb.rpc("adjust_stock", { p_item: id, p_location: loc, p_delta: -delta });
        if (ue) return fail(ue);
        refresh();
      } });
    });
    $("#drink")?.addEventListener("click", openDrink);
    $("#add-stock")?.addEventListener("click", openAddStock);
    $("#move")?.addEventListener("click", openMove);
    $("#wish")?.addEventListener("click", addToWishlist);
    $("#photos")?.addEventListener("click", openGallery);
    $("#edit")?.addEventListener("click", openEdit);
    $("#refresh")?.addEventListener("click", aiRefresh);
    $("#delete")?.addEventListener("click", remove);
    $("#more").addEventListener("click", () => {
      open = !open; $("#full").hidden = !open; $("#more").setAttribute("aria-expanded", String(open));
      if (open) $("#full").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
    });
  }

  function dialog(html, onSubmit) {
    const d = document.createElement("dialog");
    d.innerHTML = `<form method="dialog" novalidate>${html}<p class="form-msg" role="status"></p></form>`;
    document.body.append(d);
    const f = d.querySelector("form");
    d.addEventListener("close", () => d.remove());
    f.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) d.close(); });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = f.querySelector("button[type=submit]");
      btn.disabled = true;
      try { if ((await onSubmit(f)) !== false) d.close(); }
      catch (err) { fail(err); }
      finally { btn.disabled = false; }
    });
    d.showModal();
    return f;
  }
  const locOptions = (list, sel) => list.map((p) => `<option value="${p.id}"${p.id === sel ? " selected" : ""}>${esc(p.name)}</option>`).join("");

  function openDrink() {
    const path = VC.mainImagePath(it);
    VC.takeOut({ item: it, stock, places, loc: VC.getLoc(), onDone: refresh, url: path && getUrl(path) });
  }

  function openAddStock() {
    if (!places.length) { toast("Créez d'abord une cave."); return (location.href = "/app/caves.html"); }
    dialog(`<h2>Ajouter des bouteilles</h2>
      <div class="grid2"><label>Cave<select name="loc">${locOptions(places, (withStock()[0] || {}).location_id)}</select></label>
      <label>Nombre<input type="number" name="qty" value="1" min="1" max="999" inputmode="numeric"></label></div>
      <label style="margin-top:14px">Emplacement (facultatif)<input name="bin" maxlength="60" placeholder="ex. Casier B3, rangée du haut"></label>
      <div class="row end" style="margin-top:18px"><button type="button" class="btn ghost" data-close>Annuler</button><button type="submit" class="btn">Ajouter</button></div>`,
    async (f) => {
      const q = parseInt(f.qty.value, 10);
      if (!(q > 0)) { f.querySelector(".form-msg").textContent = "Nombre invalide."; return false; }
      const { error } = await sb.rpc("adjust_stock", { p_item: id, p_location: f.loc.value, p_delta: q, p_bin: f.bin.value.trim() || null });
      if (error) throw error;
      toast(`${q} bouteille${q > 1 ? "s" : ""} ajoutée${q > 1 ? "s" : ""}.`); refresh();
    });
  }

  async function addToWishlist() {
    const lists = await VC.wishlistsFor(it.collection_id);
    if (!lists.length) return toast("Liste d'envies indisponible.");
    const put = async (wl) => {
      const { error } = await sb.from("wishlist_items").insert({ wishlist_id: wl.id, item_id: id });
      if (error && !/duplicate|unique/.test(error.message)) return fail(error);
      toast(error ? `Déjà dans « ${wl.name} ».` : `Ajouté à « ${wl.name} ».`, { label: "Voir", run: () => (location.href = "/app/envies.html") });
    };
    if (lists.length === 1) return put(lists[0]);
    const d = VC.sheet(`<h2>Ajouter à une liste</h2><div class="pick-list">${lists.map((l) => `<button class="pick" data-wl="${l.id}"><b>${esc(l.name)}</b></button>`).join("")}</div>
      <div class="row end" style="margin-top:12px"><button class="btn quiet" data-close>Annuler</button></div>`);
    d.addEventListener("click", (e) => { const b = e.target.closest("[data-wl]"); if (b) { d.close(); put(lists.find((l) => l.id === b.dataset.wl)); } });
  }

  function openMove() {
    const from = withStock().map((s) => ({ id: s.location_id, name: `${placeName(s.location_id)} (${s.quantity})` }));
    dialog(`<h2>Déplacer des bouteilles</h2>
      <div class="grid2"><label>De<select name="from">${locOptions(from, from[0].id)}</select></label>
      <label>Vers<select name="to">${locOptions(places.filter((p) => p.id !== from[0].id), "")}</select></label></div>
      <label style="margin-top:14px">Nombre<input type="number" name="qty" value="1" min="1" inputmode="numeric"></label>
      <div class="row end" style="margin-top:18px"><button type="button" class="btn ghost" data-close>Annuler</button><button type="submit" class="btn">${I.move}Déplacer</button></div>`,
    async (f) => {
      const { error } = await sb.rpc("move_stock", { p_item: id, p_from: f.from.value, p_to: f.to.value, p_qty: parseInt(f.qty.value, 10) });
      if (error) throw error;
      toast("Bouteilles déplacées."); refresh();
    });
  }

  function openEdit() {
    const f = dialog(`<h2>Modifier la fiche</h2><div id="edit-fields"></div>
      <fieldset><legend>Photo de l'étiquette</legend><label>Remplacer la photo<input type="file" name="photo" accept="image/*"></label></fieldset>
      <div class="row end" style="position:sticky;bottom:0;background:var(--card);padding:12px 0"><button type="button" class="btn ghost" data-close>Annuler</button><button type="submit" class="btn">${I.check}Enregistrer</button></div>`,
    async (f) => {
      const patch = VC.readItemForm(f);
      if (!patch.name) { f.querySelector(".form-msg").textContent = "Le nom est obligatoire."; return false; }
      const file = f.photo.files[0];
      if (file) {
        const img = await VC.shrink(file);
        const type = img.blob.type || "image/jpeg", path = `${ctx.user.id}/label-${crypto.randomUUID()}.${type.split("/")[1]}`;
        const up = await sb.storage.from("labels").upload(path, img.blob, { contentType: type });
        if (up.error) throw up.error;
        if (it.label_path) patch.photo_paths = [...new Set([...(it.photo_paths || []), it.label_path])];
        patch.label_path = path;
      }
      const { error } = await sb.from("items").update(patch).eq("id", id);
      if (error) throw error;
      toast("Fiche enregistrée."); refresh();
    });
    VC.renderItemForm($("#edit-fields", f), it, { currency: ctx.profile.currency });
  }

  async function aiRefresh() {
    if (!confirm("Relancer la recherche ? Les informations du vin seront mises à jour ; vos notes, prix d'achat, remarques et dégustations restent inchangés.")) return;
    const btn = $("#refresh");
    btn.disabled = true;
    btn.innerHTML = `${I.sparkle}Recherche en cours…`;
    try {
      const res = await VC.identify({ hint: { name: it.name, producer: it.producer, vintage: it.vintage, category: it.category } });
      const r = res.result || {};
      const patch = {};
      for (const k of VC.AI_FIELDS) {
        const v = r[k];
        if (v == null || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length)) continue;
        patch[k] = v;
      }
      if (res.bottle_path) {
        if (it.bottle_path) patch.photo_paths = [...new Set([...(it.photo_paths || []), it.bottle_path])];
        patch.bottle_path = res.bottle_path;
      }
      if (r.image_url) patch.bottle_image_url = r.image_url;
      patch.sources = res.sources || [];
      patch.ai_enriched_at = new Date().toISOString();
      const { error } = await sb.from("items").update(patch).eq("id", id);
      if (error) throw error;
      toast("Fiche actualisée."); refresh();
    } catch (e) {
      fail(e, e.message); btn.disabled = false; btn.innerHTML = `${I.sparkle}Actualiser avec l'IA`;
    }
  }

  async function remove() {
    const n = total();
    if (!confirm(`Supprimer définitivement cette fiche${n ? ` et ses ${n} bouteille${n > 1 ? "s" : ""} en stock` : ""}, avec l'historique des dégustations ?`)) return;
    const { error } = await sb.from("items").delete().eq("id", id);
    if (error) return fail(error);
    // Les fichiers sources restent dans le bucket privé, même après suppression de la fiche.
    location.replace(`/app/?loc=${encodeURIComponent(VC.getLoc() || "all")}`);
  }

  // Une seule fois : la page garde le même <main> d'un rendu à l'autre.
  main.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-undo]");
    if (!b || !confirm("Supprimer cette sortie ? La bouteille sera remise dans sa cave.")) return;
    const { error } = await sb.rpc("undo_tasting", { p_tasting: b.dataset.undo });
    if (error) return fail(error);
    toast("Sortie supprimée, bouteille remise en cave."); refresh();
  });
  if (await load()) render();
})();
