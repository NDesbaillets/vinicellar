// Listes d'envies : vins à acheter (fiches sans bouteille), plusieurs listes ; « Acheté » les fait entrer en cave.
(async function () {
  const VC = window.VC;
  const { sb, $, esc, I, CATEGORY, money, toast, fail, bottleSvg, signed, mainImagePath } = VC;
  const ctx = await VC.boot("carnet");
  const main = $("#main");
  let lists = [], entries = [], places = [], colls = [], current = null, getUrl = () => null;

  async function load() {
    const [a, b, c, d] = await Promise.all([
      sb.from("wishlists").select("*").order("position").order("created_at"),
      sb.from("wishlist_items").select("*, items(*)").order("created_at", { ascending: false }),
      VC.loadPlaces(),
      sb.from("collections").select("id, name")
    ]);
    if (a.error) throw a.error;
    lists = a.data || []; entries = b.data || []; places = c; colls = d.data || [];
    if (!lists.length && colls.length) lists = await VC.wishlistsFor((places[0] || {}).collection_id || colls[0].id);
    if (!lists.some((l) => l.id === current)) current = lists[0] ? lists[0].id : null;
    getUrl = await signed(entries.map((e) => e.items && mainImagePath(e.items)).filter(Boolean));
    draw();
  }

  const list = () => lists.find((l) => l.id === current);
  const multi = () => new Set(lists.map((l) => l.collection_id)).size > 1;
  const listLabel = (l) => multi() ? `${l.name} · ${(colls.find((c) => c.id === l.collection_id) || {}).name || ""}` : l.name;

  function row(e) {
    const it = e.items || {};
    const url = getUrl(mainImagePath(it));
    const price = it.market_price ? money(it.market_price, it.market_currency) : "";
    return `<div class="bottle-wrap wish" data-e="${e.id}"><a class="bottle" href="/app/fiche.html?id=${it.id}">
      <div class="thumb">${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : bottleSvg(it)}</div>
      <div><h3>${esc(it.name || "")}${it.vintage ? ` <span class="faint">${it.vintage}</span>` : ""}</h3>
      <p class="sub">${esc([it.producer, it.appellation || it.region, it.country].filter(Boolean).join(" · ")) || (e.pending ? "Fiche en cours…" : "")}</p>
      <div class="tags">${e.qty_wanted ? `<span class="tag">${e.qty_wanted} bt. voulues</span>` : ""}${price ? `<span class="tag">marché ${price}</span>` : ""}${e.target_price ? `<span class="tag ready">cible ${money(e.target_price, it.market_currency || ctx.profile.currency)}</span>` : ""}</div>
      ${e.note ? `<p class="sub" style="margin:6px 0 0;white-space:normal">${esc(e.note)}</p>` : ""}</div></a>
      <div class="wish-acts"><button class="btn" data-w="bought">${I.check}Acheté</button><button class="icon-btn" data-w="del" aria-label="Retirer de la liste">${I.trash}</button></div></div>`;
  }

  function draw() {
    const l = list();
    const mine = entries.filter((e) => e.wishlist_id === current);
    main.innerHTML = `<div class="page-head"><div><span class="eyebrow">Vins à acheter</span><h1>Carnet</h1></div></div>${VC.carnetNav("envies")}
      <div class="chips" id="lists">${lists.map((x) => `<button class="chip" data-l="${x.id}" aria-pressed="${x.id === current}">${esc(listLabel(x))}<span class="n">${entries.filter((e) => e.wishlist_id === x.id).length}</span></button>`).join("")}
        <button class="chip" data-new>${I.plus.replace("<svg", '<svg width="14" height="14" style="vertical-align:-2px"')} Nouvelle liste</button></div>
      ${l ? `<div class="row" style="margin:6px 0 14px"><h2 style="margin:0">${esc(l.name)}</h2><span class="spacer"></span>
        <button class="btn quiet" data-ren>${I.edit}Renommer</button><button class="btn quiet" data-delete>${I.trash}Supprimer</button></div>
      <form class="card" id="add" novalidate><h3>Ajouter un vin</h3><div class="grid2">
        <label>Producteur / domaine<input name="producer" maxlength="200" placeholder="ex. Domaine Leflaive"></label>
        <label>Cuvée<input name="cuvee" maxlength="200" placeholder="ex. Puligny-Montrachet Les Pucelles"></label>
        <label>Millésime<input name="vintage" type="number" min="1800" max="2100" inputmode="numeric"></label>
        <label>Type<select name="category">${Object.entries(CATEGORY).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
        <label>Bouteilles voulues<input name="qty" type="number" min="1" max="999" inputmode="numeric" placeholder="ex. 6"></label>
        <label>Prix cible<input name="price" type="number" min="0" step="0.5" inputmode="decimal" placeholder="${esc(ctx.profile.currency || "CHF")}"></label>
        <label class="wide">Note<input name="note" maxlength="300" placeholder="ex. Goûté chez Paul, demander chez Gerstl"></label></div>
        <label class="row" style="margin-top:12px;font-weight:400;color:var(--ink)"><input type="checkbox" name="ai" checked> Compléter la fiche avec l'IA (garde, accords, prix)</label>
        <div class="row" style="margin-top:14px"><button class="btn" type="submit">${I.plus}Ajouter à la liste</button></div></form>
      <div class="list" id="entries" style="margin-top:16px">${mine.map(row).join("") || `<div class="empty" style="grid-column:1/-1"><p class="muted">Liste vide. Ajoutez un vin ci-dessus, ou depuis l'historique et les fiches.</p></div>`}</div>`
      : `<div class="empty"><p class="muted">Aucune liste.</p></div>`}`;
  }

  async function newList() {
    const name = prompt("Nom de la liste (ex. Pour les 40 ans, Bourgognes à goûter)");
    if (!name || !name.trim()) return;
    let coll = places[0] ? places[0].collection_id : null;
    if (colls.length > 1) {
      const pick = prompt(`Dans quelle collection ?\n${colls.map((c, i) => `${i + 1}. ${c.name}`).join("\n")}`, "1");
      coll = (colls[Number(pick) - 1] || colls[0]).id;
    }
    const { data, error } = await sb.from("wishlists").insert({ name: name.trim().slice(0, 80), ...(coll ? { collection_id: coll } : {}), position: lists.length }).select("id").single();
    if (error) return fail(error);
    current = data.id; load();
  }

  main.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("[data-l]")) { current = t.closest("[data-l]").dataset.l; return draw(); }
    if (t.closest("[data-new]")) return newList();
    if (t.closest("[data-ren]")) {
      const name = prompt("Nouveau nom", list().name);
      if (!name || !name.trim()) return;
      const { error } = await sb.from("wishlists").update({ name: name.trim().slice(0, 80) }).eq("id", current);
      return error ? fail(error) : load();
    }
    if (t.closest("[data-delete]")) {
      if (!confirm(`Supprimer la liste « ${list().name} » ? Les fiches des vins restent dans l'historique.`)) return;
      const { error } = await sb.from("wishlists").delete().eq("id", current);
      return error ? fail(error) : load();
    }
    const b = t.closest("[data-w]");
    if (!b) return;
    e.preventDefault();
    const en = entries.find((x) => x.id === b.closest("[data-e]").dataset.e);
    if (b.dataset.w === "del") {
      const { error } = await sb.from("wishlist_items").delete().eq("id", en.id);
      if (error) return fail(error);
      toast("Retiré de la liste."); return load();
    }
    // Acheté : choisir la cave et le nombre, puis la bouteille entre en stock et quitte la liste.
    const own = places.filter((p) => p.collection_id === en.items.collection_id);
    if (!own.length) return toast("Créez d'abord une cave.");
    const here = own.find((p) => p.id === VC.getLoc()) || own[0];
    const d = VC.sheet(`<form novalidate><h2>${esc(en.items.name)}</h2><p class="muted" style="margin-top:0">Entrée en cave</p>
      <div class="grid2"><label>Cave<select name="loc">${own.map((p) => `<option value="${p.id}"${p.id === here.id ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
      <label>Bouteilles<input type="number" name="qty" value="${en.qty_wanted || 1}" min="1" max="999" inputmode="numeric"></label>
      <label>Prix d'achat (par bouteille)<input type="number" name="price" min="0" step="0.05" inputmode="decimal"></label>
      <label>Acheté chez<input name="place" maxlength="120"></label></div>
      <div class="row end" style="margin-top:18px"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn" type="submit">${I.check}Entrer en cave</button></div></form>`);
    d.querySelector("form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const f = ev.target, q = parseInt(f.qty.value, 10);
      if (!(q > 0)) return;
      const { error } = await sb.rpc("adjust_stock", { p_item: en.item_id, p_location: f.loc.value, p_delta: q });
      if (error) return fail(error);
      const patch = { purchase_year: VC.year };
      if (f.price.value) { patch.purchase_price = Number(f.price.value); patch.purchase_currency = ctx.profile.currency || "CHF"; }
      if (f.place.value.trim()) patch.purchase_place = f.place.value.trim();
      await sb.from("items").update(patch).eq("id", en.item_id);
      await sb.from("wishlist_items").delete().eq("id", en.id);
      d.close(); toast(`${q} bouteille${q > 1 ? "s" : ""} en cave.`, { label: "Voir la fiche", run: () => (location.href = `/app/fiche.html?id=${en.item_id}`) });
      load();
    });
  });

  main.addEventListener("submit", async (e) => {
    if (e.target.id !== "add") return;
    e.preventDefault();
    const f = e.target;
    const producer = f.producer.value.trim(), name = f.cuvee.value.trim();
    if (!producer && !name) return toast("Indiquez au moins le producteur ou la cuvée.");
    const l = list();
    const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
    const { data: it, error } = await sb.from("items").insert({
      collection_id: l.collection_id, name: name || producer, producer: producer || null, category: f.category.value,
      vintage: f.vintage.value ? Number(f.vintage.value) : null
    }).select("*").single();
    if (error) { btn.disabled = false; return fail(error); }
    const { error: we } = await sb.from("wishlist_items").insert({
      wishlist_id: l.id, item_id: it.id, qty_wanted: f.qty.value ? Number(f.qty.value) : null,
      target_price: f.price.value ? Number(f.price.value) : null, note: f.note.value.trim() || null
    });
    if (we) { btn.disabled = false; return fail(we); }
    const ai = f.ai.checked;
    toast(ai ? "Ajouté. La fiche se complète en arrière-plan." : "Ajouté à la liste.");
    await load();
    if (ai) {
      try {
        const res = await VC.identify({ hint: { producer, name, vintage: it.vintage, category: it.category } });
        const r = res.result || {}, patch = {};
        for (const k of VC.AI_FIELDS) { const v = r[k]; if (v == null || (Array.isArray(v) && !v.length)) continue; patch[k] = v; }
        if (res.bottle_path) patch.bottle_path = res.bottle_path;
        patch.sources = res.sources || []; patch.ai_enriched_at = new Date().toISOString();
        await sb.from("items").update(patch).eq("id", it.id);
        load();
      } catch (err) { console.error(err); toast("Fiche non complétée : " + err.message); }
    }
  });

  try { await load(); } catch (e) { fail(e, "Impossible de charger les listes."); }
})();
