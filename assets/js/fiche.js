// Fiche d'une bouteille : visuel, stock par lieu, « j'ouvre une bouteille », garde, description, accords,
// notes, prix, dégustations, mise à jour par l'IA, modification et suppression.
(async function () {
  const VC = window.VC;
  const { sb, $, $$, esc, I, CATEGORY, STYLE, KIND, money, date, today, year, range, safeUrl, host, windowStatus, bottleSvg, signed, stars, toast, fail } = VC;
  const ctx = await VC.boot("cellar");
  const main = $("#main");
  const id = new URLSearchParams(location.search).get("id");
  if (!id) return location.replace("/app/");

  let it, places, stock, tastings, getUrl;

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
      it.label_back_path && { p: it.label_back_path, l: "Contre-étiquette" }, ...(it.photo_paths || []).map((p) => ({ p, l: "Photo", extra: true }))]
      .filter(Boolean).map((x) => ({ ...x, u: getUrl(x.p) })).filter((x) => x.u);
    const cover = VC.mainImagePath(it);
    let cur = Math.max(0, imgs.findIndex((x) => x.p === cover));
    const show = (i) => {
      cur = i;
      $("#visual").innerHTML = imgs[i] ? `<img src="${esc(imgs[i].u)}" alt="${esc(imgs[i].l)} : ${esc(it.name)}">` : bottleSvg(it);
      $$("#vswitch button[data-i]").forEach((b, j) => b.setAttribute("aria-pressed", String(i === j)));
      const tools = $("#vtools");
      if (!tools) return;
      const x = imgs[i];
      tools.innerHTML = `${x && x.p !== cover ? `<button class="btn quiet" data-v="cover">${I.check}Utiliser comme vignette</button>` : x ? `<span class="faint" style="font-size:.85rem">Vignette actuelle</span>` : ""}
        ${x && x.extra ? `<button class="btn quiet" data-v="del">${I.trash}Supprimer</button>` : ""}
        <label class="btn quiet">${I.camera}Ajouter une photo<input type="file" accept="image/*" data-v="add" hidden></label>`;
    };
    $("#vswitch").innerHTML = imgs.length > 1 ? imgs.map((x, j) => `<button type="button" data-i="${j}" aria-label="${x.l}"${x.p === cover ? ' class="is-cover"' : ""}><img src="${esc(x.u)}" alt=""></button>`).join("") : "";
    $$("#vswitch button[data-i]").forEach((b) => b.addEventListener("click", () => show(+b.dataset.i)));
    show(cur);
    if (ro() || !$("#vtools")) return;
    $("#vtools").onclick = async (e) => {
      const b = e.target.closest("[data-v]");
      if (!b || b.tagName === "INPUT") return;
      const x = imgs[cur];
      if (b.dataset.v === "cover") {
        const { error } = await sb.from("items").update({ cover_path: x.p }).eq("id", id);
        if (error) return fail(error);
        toast("Vignette mise à jour."); return refresh();
      }
      if (b.dataset.v === "del") {
        if (!confirm("Supprimer cette photo ?")) return;
        const { error } = await sb.from("items").update({ photo_paths: (it.photo_paths || []).filter((p) => p !== x.p), ...(it.cover_path === x.p ? { cover_path: null } : {}) }).eq("id", id);
        if (error) return fail(error);
        await sb.storage.from("labels").remove([x.p]);
        toast("Photo supprimée."); return refresh();
      }
    };
    $("#vtools").onchange = async (e) => {
      const inp = e.target.closest('input[data-v="add"]');
      if (!inp || !inp.files[0]) return;
      try {
        const img = await VC.shrink(inp.files[0]);
        const path = `${ctx.user.id}/photo-${crypto.randomUUID()}.jpg`;
        const up = await sb.storage.from("labels").upload(path, img.blob, { contentType: "image/jpeg" });
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

  function stockCard() {
    const rows = stock.filter((s) => s.quantity > 0 || places.some((p) => p.id === s.location_id));
    const n = total();
    return `<div class="card"><div class="row"><h3 style="margin:0">En cave</h3><span class="spacer"></span><span class="tag ${n ? "qty" : "zero"}">${n} bouteille${n > 1 ? "s" : ""}</span></div>
      <ul class="stock-list" style="margin-top:12px">${rows.length ? rows.map((s) => {
        const p = places.find((x) => x.id === s.location_id) || {};
        return `<li><div class="where"><b>${esc(p.name || "Lieu supprimé")}</b><small>${esc([KIND[p.kind], s.bin && "Emplacement " + s.bin].filter(Boolean).join(" · "))}</small></div>
          ${ro() ? `<output style="font-weight:700">${s.quantity}</output>` : `<div class="stepper"><button class="icon-btn" data-adj="-1" data-loc="${s.location_id}" aria-label="Retirer une bouteille (correction)">−</button>
          <output>${s.quantity}</output><button class="icon-btn" data-adj="1" data-loc="${s.location_id}" aria-label="Ajouter une bouteille">+</button></div>`}</li>`;
      }).join("") : `<li><span class="muted">Plus aucune bouteille en cave.</span></li>`}</ul>
      ${ro() ? `<p class="muted" style="margin:12px 0 0">Cave partagée en lecture seule.</p>` : `<div style="display:grid;gap:8px;margin-top:14px">
        <button class="btn big block" id="drink"${n ? "" : " disabled"}>${I.glass}Sortir une bouteille</button>
        <div class="row"><button class="btn quiet" id="add-stock">${I.plus}Ajouter des bouteilles</button>${withStock().length && places.length > 1 ? `<button class="btn quiet" id="move">${I.move}Déplacer</button>` : ""}<button class="btn quiet" id="wish">${I.plus}Liste d'envies</button></div>
      </div>`}</div>`;
  }

  function scoreText() {
    if (it.avg_score == null) return "";
    const s = String(it.avg_score).replace(".", ",");
    return it.avg_score_scale ? `${s}/${it.avg_score_scale}` : s;
  }

  function facts() {
    const f = [];
    const add = (k, v, small) => v && f.push(`<div class="fact"><dt>${k}</dt><dd>${v}${small ? `<small>${small}</small>` : ""}</dd></div>`);
    if (VC.isWine(it)) add("Cépages", esc((it.grapes || []).join(", ")));
    add("Degré", it.abv ? `${String(it.abv).replace(".", ",")} % vol.` : "");
    add("Contenance", it.volume_cl ? `${it.volume_cl} cl` : "");
    add("Service", it.serving_temp_min || it.serving_temp_max ? range(it.serving_temp_min, it.serving_temp_max, " °C") : "");
    add("Note moyenne", esc(scoreText()), esc(it.avg_score_source || ""));
    add("Prix du marché", it.market_price ? money(it.market_price, it.market_currency) : "", esc(it.price_source || ""));
    add("Prix d'achat", it.purchase_price ? money(it.purchase_price, it.purchase_currency) : "", esc([it.purchase_year, it.purchase_place].filter(Boolean).join(" · ")));
    if (it.purchase_price && it.market_price && it.purchase_currency === it.market_currency) {
      const d = Math.round((it.market_price / it.purchase_price - 1) * 100);
      add("Plus-value", `${d > 0 ? "+" : ""}${d} %`);
    }
    return f.length ? `<dl class="facts">${f.join("")}</dl>` : "";
  }

  function ageing() {
    if (!VC.isWine(it)) return "";
    const { vintage: v, drink_from: df, drink_to: dt, peak_from: pf, peak_to: pt, aging_potential_years: ap } = it;
    if (!df && !dt && !pf && !ap) return "";
    const w = windowStatus(it);
    const parts = [];
    if (v) parts.push(`Garde actuelle <b>${Math.max(0, year - v)} an${year - v > 1 ? "s" : ""}</b>`);
    if (ap) parts.push(`Garde recommandée <b>${ap} ans</b>${v ? ` (jusqu'en ${v + ap})` : ""}`);
    if (pf || pt) parts.push(`Apogée <b>${range(pf, pt)}</b>`);
    if (df || dt) parts.push(`Fenêtre idéale <b>${range(df, dt)}</b>`);
    const start = Math.min(...[v, df, pf, year].filter(Boolean)) ;
    const end = Math.max(...[dt, pt, v && ap ? v + ap : null, year + 1].filter(Boolean)) + 1;
    return `<div class="card ageing"><div class="row" style="margin-bottom:10px"><h3 style="margin:0">${I.clock.replace("<svg", '<svg width="18" height="18" style="vertical-align:-3px;margin-right:6px"')}Garde</h3><span class="spacer"></span>${w ? `<span class="tag ${w.key}">${w.label}</span>` : ""}</div>
      <div class="ageing-line">${parts.map((p) => `<span>${p}</span>`).join("")}</div>
      <div class="timeline" data-start="${start}" data-end="${end}"><div class="track"></div>${df || dt ? `<div class="win" data-a="${df || start}" data-b="${dt || end}"></div>` : ""}${pf ? `<div class="peak" data-a="${pf}" data-b="${pt || pf + 1}"></div>` : ""}<div class="now" data-a="${year + .5}"></div></div>
      <div class="timeline-scale"><span>${start}</span><span>${end}</span></div>
      <div class="legend"><span><i style="background:color-mix(in srgb, var(--ok) 55%, transparent)"></i>Fenêtre idéale</span><span><i style="background:var(--wine)"></i>Apogée</span>${it.window_source ? `<span class="faint">Source : ${esc(it.window_source)}</span>` : ""}</div></div>`;
  }

  function placeTimeline() {
    const tl = $(".timeline");
    if (!tl) return;
    const s = +tl.dataset.start, e = +tl.dataset.end, span = Math.max(1, e - s);
    const pct = (x) => `${Math.min(100, Math.max(0, ((x - s) / span) * 100))}%`;
    $$("[data-a]", tl).forEach((el) => {
      el.style.left = pct(+el.dataset.a);
      if (el.dataset.b) el.style.width = `calc(${pct(+el.dataset.b)} - ${pct(+el.dataset.a)})`;
    });
  }

  function prose() {
    const block = (h, t) => t ? `<h3>${h}</h3><p>${esc(t)}</p>` : "";
    const wine = VC.isWine(it);
    const html = block(wine ? "Le vin" : "Le produit", it.description) + block(wine ? "Vinification" : "Élaboration", it.vinification) +
      block(wine ? "Terroir et climat" : "Origine", it.terroir) + block(wine ? "Le millésime, la cuvée" : "Particularités", it.vintage_notes);
    return html ? `<div class="card prose">${html}</div>` : "";
  }

  function pairings() {
    return (it.pairings || []).length ? `<div class="card"><h3>${I.plate.replace("<svg", '<svg width="18" height="18" style="vertical-align:-3px;margin-right:6px"')}Accords</h3><ul class="pairings">${it.pairings.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>` : "";
  }

  function details() {
    const d = Object.entries(it.details || {});
    return d.length ? `<div class="card"><h3>Détails</h3><dl class="kv">${d.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></div>` : "";
  }

  function tastingList() {
    return `<div class="card"><div class="row"><h3 style="margin:0">Sorties et dégustations</h3><span class="spacer"></span><span class="faint">${tastings.length || ""}</span></div>
      <div style="margin-top:12px">${tastings.length ? tastings.map((t) => `<div class="tasting">
        <div class="tasting-head"><b>${date(t.tasted_on)}</b><span class="stars-slot" data-r="${t.rating ?? ""}"></span><span class="tag ${t.reason === "drunk" ? "ready" : t.reason === "gifted" ? "peak" : ""}">${VC.REASON[t.reason] || "Bue"}${t.recipient ? " à " + esc(t.recipient) : ""}</span><span class="faint">${esc([t.location_id && placeName(t.location_id), t.occasion].filter(Boolean).join(" · "))}</span>
        <span class="spacer"></span>${ro() ? "" : `<button class="btn quiet" data-undo="${t.id}" title="Supprimer et remettre la bouteille en cave">${I.trash}</button>`}</div>
        ${t.pairing ? `<p class="pair">${I.plate.replace("<svg", '<svg width="15" height="15" style="vertical-align:-2px;margin-right:4px"')}${esc(t.pairing)}</p>` : ""}
        ${t.notes ? `<p>${esc(t.notes)}</p>` : ""}</div>`).join("") : `<p class="muted" style="margin:0">Aucune sortie pour l'instant. « Sortir une bouteille » la retire du stock : bue, offerte ou autre.</p>`}</div></div>`;
  }

  function sources() {
    const list = (Array.isArray(it.sources) ? it.sources : []).map((s) => ({ ...s, url: safeUrl(s.url) })).filter((s) => s.url).slice(0, 8);
    return `<div class="sources">${it.ai_enriched_at ? `Fiche complétée automatiquement le ${date(it.ai_enriched_at.slice(0, 10))}, à vérifier. ` : ""}
      ${list.length ? "Sources : " + list.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(host(s.url))}</a>`).join(", ") : ""}</div>`;
  }

  function render() {
    const kind = it.category === "wine" ? (STYLE[it.style] ? `Vin ${STYLE[it.style].toLowerCase()}` : "Vin") : CATEGORY[it.category];
    const prodUrl = safeUrl(it.producer_url);
    main.innerHTML = `<p style="margin:16px 0 0"><a class="btn quiet" href="/app/cave.html?loc=${encodeURIComponent(VC.getLoc() || "all")}">${I.back}Retour à la cave</a></p>
      <div class="sheet">
        <aside class="sheet-aside"><div class="visual" id="visual"></div><div class="visual-switch" id="vswitch"></div>${ro() ? "" : `<div class="row" id="vtools" style="margin-top:8px"></div>`}<div id="stock" style="margin-top:16px">${stockCard()}</div></aside>
        <div style="display:grid;gap:16px;min-width:0">
          <div class="sheet-title"><span class="eyebrow">${esc(kind)}</span>
            <h1>${esc(it.name)}${it.vintage ? ` <span class="faint">${it.vintage}</span>` : ""}</h1>
            ${it.producer ? `<p class="producer">${prodUrl ? `<a href="${esc(prodUrl)}" target="_blank" rel="noopener noreferrer">${esc(it.producer)}</a>` : esc(it.producer)}${prodUrl ? ` <span class="faint">· ${esc(host(prodUrl))}</span>` : ""}</p>` : ""}
            <div class="origin">${[it.appellation, it.region, it.country].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join("")}</div>
            <div class="row"><span class="muted">Ma note</span><span id="my-rating"></span>${it.avg_score != null ? `<span class="faint">· moyenne ${esc(scoreText())}</span>` : ""}</div>
          </div>
          ${facts()}${ageing()}${prose()}${pairings()}${details()}
          ${it.notes ? `<div class="card"><h3>Mes remarques</h3><p style="margin:0;white-space:pre-line">${esc(it.notes)}</p></div>` : ""}
          ${tastingList()}
          ${sources()}
          ${ro() ? "" : `<div class="row"><button class="btn ghost" id="edit">${I.edit}Modifier la fiche</button><button class="btn ghost" id="refresh">${I.sparkle}Actualiser avec l'IA</button><span class="spacer"></span><button class="btn danger" id="delete">${I.trash}Supprimer</button></div>`}
        </div>
      </div>`;
    visual();
    placeTimeline();
    $("#my-rating").append(stars(it.my_rating, async (v) => {
      const { error } = await sb.from("items").update({ my_rating: v }).eq("id", id);
      if (error) return fail(error);
      it.my_rating = v; toast(v ? "Note enregistrée." : "Note effacée.");
    }, { label: "Ma note", read: ro() }));
    $$(".stars-slot").forEach((s) => s.dataset.r && s.append(stars(+s.dataset.r, null, { read: true })));
    bind();
  }

  // ---------------------------------------------------------------- actions
  async function refresh() { if (await load()) render(); }

  function bind() {
    $("#stock").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-adj]");
      if (!b) return;
      b.disabled = true;
      const { error } = await sb.rpc("adjust_stock", { p_item: id, p_location: b.dataset.loc, p_delta: +b.dataset.adj });
      if (error) return fail(error);
      refresh();
    });
    $("#drink")?.addEventListener("click", openDrink);
    $("#add-stock")?.addEventListener("click", openAddStock);
    $("#move")?.addEventListener("click", openMove);
    $("#wish")?.addEventListener("click", addToWishlist);
    $("#edit")?.addEventListener("click", openEdit);
    $("#refresh")?.addEventListener("click", aiRefresh);
    $("#delete")?.addEventListener("click", remove);
    main.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-undo]");
      if (!b || !confirm("Supprimer cette dégustation ? La bouteille sera remise dans sa cave.")) return;
      const { error } = await sb.rpc("undo_tasting", { p_tasting: b.dataset.undo });
      if (error) return fail(error);
      toast("Dégustation supprimée, bouteille remise en cave."); refresh();
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
    VC.takeOut({ item: it, stock, places, loc: VC.getLoc(), onDone: refresh });
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
        const path = `${ctx.user.id}/label-${crypto.randomUUID()}.jpg`;
        const up = await sb.storage.from("labels").upload(path, img.blob, { contentType: "image/jpeg" });
        if (up.error) throw up.error;
        if (it.label_path) await sb.storage.from("labels").remove([it.label_path]);
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
        if (it.bottle_path) await sb.storage.from("labels").remove([it.bottle_path]);
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
    const files = [it.label_path, it.label_back_path, it.bottle_path, ...(it.photo_paths || [])].filter(Boolean);
    const { error } = await sb.from("items").delete().eq("id", id);
    if (error) return fail(error);
    if (files.length) await sb.storage.from("labels").remove(files);
    location.replace(`/app/cave.html?loc=${encodeURIComponent(VC.getLoc() || "all")}`);
  }

  if (await load()) render();
})();
