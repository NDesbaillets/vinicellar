// Ajouter des bouteilles à la chaîne : étiquette (+ contre-étiquette) → analyse lancée en arrière-plan →
// on photographie la suivante pendant ce temps → on vérifie chaque fiche quand elle est prête.
(async function () {
  const VC = window.VC;
  const { sb, $, esc, I, CATEGORY, toast, fail } = VC;
  const ctx = await VC.boot("add");
  const main = $("#main");
  // Seules les caves où l'on peut écrire (pas les partages en lecture seule).
  const places = (await VC.loadPlaces().catch(() => [])).filter((p) => VC.canEdit(p.collection_id));
  const wishlists = ((await sb.from("wishlists").select("*").order("position").order("created_at")).data || []).filter((w) => VC.canEdit(w.collection_id));
  let here = VC.getLoc();
  if (!places.some((p) => p.id === here)) here = places[0] ? places[0].id : "";

  const shots = [null, null, null];    // { blob, preview } : étiquette, contre-étiquette, bouteille entière
  const KINDS = ["label", "back", "full"];   // préfixe du fichier : la photo est reconnue par son nom, pas par sa place
  const ready = () => !!(shots[0] && shots[2]);
  let drafts = [], thumbs = () => null, poll = null;
  let defaults = { loc: here, qty: 1 };
  const saveKeys = new WeakMap();
  const STUCK_MS = 4 * 60 * 1000;       // une analyse ne dépasse pas ~3 min côté serveur

  const collOf = (loc) => (places.find((p) => p.id === loc) || places[0] || {}).collection_id;
  const locOptions = (sel) => places.map((p) => `<option value="${p.id}"${p.id === sel ? " selected" : ""}>${esc(VC.placeLabel(p, places))}</option>`).join("");

  // ---------------------------------------------------------------- file d'analyses
  async function loadDrafts() {
    const { data } = await sb.from("drafts").select("*").order("created_at", { ascending: true });
    drafts = data || [];
    thumbs = await VC.signed(drafts.map((d) => d.photo_paths[0] || d.bottle_path).filter(Boolean));
    drawQueue();
    const pending = drafts.some((d) => d.status === "pending" && Date.now() - new Date(d.created_at) < STUCK_MS);
    clearTimeout(poll);
    if (pending) poll = setTimeout(loadDrafts, 4000);
  }

  function draftTitle(d) {
    const r = d.result || {}, h = d.hint || {};
    return [r.producer || h.producer, r.name || h.name, r.vintage || h.vintage].filter(Boolean).join(" · ");
  }

  function drawQueue() {
    const box = $("#queue");
    if (!box) return;
    if (!drafts.length) { box.innerHTML = ""; return; }
    const ready = drafts.filter((d) => d.status === "ready").length;
    box.innerHTML = `<div class="card" style="margin-bottom:16px"><div class="row"><h3 style="margin:0">Analyses</h3><span class="spacer"></span>
      ${ready ? `<span class="tag ready">${ready} prête${ready > 1 ? "s" : ""} à vérifier</span>` : ""}</div>
      <div class="queue">${drafts.map((d) => {
        const stuck = d.status === "pending" && Date.now() - new Date(d.created_at) > STUCK_MS;
        const st = stuck ? "error" : d.status;
        const url = thumbs(d.photo_paths[0] || d.bottle_path);
        return `<div class="qitem" data-id="${d.id}">
          <div class="qthumb">${url ? `<img src="${esc(url)}" alt="">` : I.glass}</div>
          <div class="qbody"><b>${esc(draftTitle(d) || (st === "pending" ? "Analyse en cours…" : "Bouteille"))}</b>
            <small>${st === "pending" ? `<span class="spin"></span>Recherche du producteur, de la garde, des prix…` : st === "ready" ? "Fiche prête" : esc(stuck ? "L'analyse n'a pas abouti." : d.error || "Analyse impossible.")}
            ${d.qty ? ` · ${d.qty} bt.` : ""}</small></div>
          <div class="qacts">${st === "ready" ? `<button class="btn" data-q="review">Vérifier</button>`
            : st === "error" ? `<button class="btn ghost" data-q="retry">Réessayer</button><button class="btn quiet" data-q="manual">À la main</button>` : ""}
            <button class="icon-btn" data-q="del" aria-label="Supprimer">${I.trash}</button></div></div>`;
      }).join("")}</div></div>`;
  }

  async function launch(hint) {
    const btn = $("#go");
    if (btn) btn.disabled = true;
    try {
      const loc = $("#loc").value, qty = Math.max(0, parseInt($("#qty").value, 10) || 0);
      defaults = { loc, qty: qty || 1 };
      const paths = [];
      for (const [i, s] of shots.entries()) {
        if (!s) continue;
        const path = `${ctx.user.id}/${KINDS[i]}-${crypto.randomUUID()}.${s.blob.type.split("/")[1] || "jpg"}`;
        const { error } = await sb.storage.from("labels").upload(path, s.blob, { contentType: s.blob.type, upsert: false });
        if (error) throw error;
        paths.push(path);
      }
      const { data: d, error } = await sb.from("drafts").insert({
        collection_id: collOf(loc), location_id: loc || null, qty, photo_paths: paths, hint: hint || {}
      }).select("id").single();
      if (error) throw error;
      shots[0] = shots[1] = shots[2] = null;
      drawCapture();
      toast(hint ? "Recherche lancée." : "Analyse lancée. Photographiez la bouteille suivante.");
      const { error: fe } = await sb.functions.invoke("identify", { body: { draft_id: d.id } });
      if (fe) {
        let msg = "Analyse impossible.";
        try { const j = await fe.context.json(); if (j && j.message) msg = j.message; } catch { /* réponse vide */ }
        await sb.from("drafts").update({ status: "error", error: msg }).eq("id", d.id);
      }
    } catch (e) { fail(e, "Envoi impossible. Vérifiez la connexion."); }
    finally { if ($("#go")) $("#go").disabled = !ready(); loadDrafts(); }
  }

  // Rôle d'une photo de brouillon, d'après le préfixe de son nom ; anciens brouillons : 1re = étiquette, 2e = contre-étiquette.
  function photoOf(d, kind) {
    const ps = (d.photo_paths || []).filter(Boolean), named = ps.find((p) => p.split("/").pop().startsWith(kind + "-"));
    if (named) return named;
    if (ps.some((p) => /\/(label|back|full)-/.test(p))) return null;
    return kind === "label" ? ps[0] || null : kind === "back" ? ps[1] || null : null;
  }

  // ---------------------------------------------------------------- saisie
  function slot(i) {
    const s = shots[i];
    const title = ["Étiquette", "Contre-étiquette", "Bouteille entière"][i];
    const hint = ["De face, sans reflet", "Souvent le millésime et l'assemblage", "De la capsule au pied, de face : pour l'aperçu"][i];
    if (s) return `<div class="shot"><img src="${s.preview}" alt="${title}"><span class="shot-label">${title}</span><button class="icon-btn shot-x" data-x="${i}" aria-label="Retirer">×</button></div>`;
    return `<div class="shot empty"><span class="shot-label">${title}${i === 1 ? " <small>(facultatif)</small>" : ""}</span>
      <div class="shot-btns"><label class="btn ${i === 1 ? "ghost" : ""}">${I.camera}<span>Photo</span><input type="file" accept="image/*" capture="environment" data-shot="${i}" hidden></label>
      <label class="btn ghost">${I.image}<span>Album</span><input type="file" accept="image/*" data-shot="${i}" hidden></label></div>
      <small class="muted">${hint}</small></div>`;
  }

  function drawCapture() {
    $("#capture").innerHTML = `<div class="shots shots-3">${slot(0)}${slot(1)}${slot(2)}</div>
      <div class="form-line" style="margin-top:14px">
        <label>Cave<select id="loc">${locOptions(defaults.loc)}</select></label>
        <label>Bouteilles<input id="qty" type="number" min="0" max="999" inputmode="numeric" value="${defaults.qty}"></label>
        <button class="btn big" id="go"${ready() ? "" : " disabled"}>${I.sparkle}Lancer l'analyse</button></div>
      <p class="hint" style="margin:10px 0 0">${shots[0] && !shots[2] ? "Ajoutez la photo de la bouteille entière : elle sert à créer l'aperçu." : "Enchaînez les bouteilles : chaque analyse continue pendant que vous photographiez la suivante."}</p>`;
  }

  function stepCapture() {
    main.innerHTML = `<div class="page-head"><div><span class="eyebrow">Nouvelles bouteilles</span><h1>Ajouter à ma cave</h1></div></div>
      ${places.length ? "" : `<p class="notice">Aucune cave créée. <a href="/app/caves.html">Créer une cave</a> d'abord.</p>`}
      <div id="queue"></div>
      <div class="card" id="capture"></div>
      <div class="divider">ou par le nom</div>
      <form class="card" id="by-name" novalidate>
        <div class="grid2">
          <label>Producteur / domaine<input name="producer" maxlength="200" placeholder="ex. Louis-Bovard"></label>
          <label>Cuvée<input name="cuvee" maxlength="200" placeholder="ex. Médinette Dézaley Grand Cru"></label>
          <label>Millésime<input name="vintage" type="number" min="1800" max="2100" inputmode="numeric" placeholder="ex. 2020"></label>
          <label>Type<select name="category">${Object.entries(CATEGORY).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
        </div>
        <div class="row" style="margin-top:16px"><button class="btn" type="submit">${I.sparkle}Rechercher et remplir la fiche</button><button class="btn ghost" type="button" id="manual">Saisir à la main</button></div>
        <p class="form-msg" role="status"></p>
      </form>
      <div class="divider">ou en nombre</div>
      <a class="card import-link" href="/app/importer.html"><b>Importer un tableau Excel</b><span class="muted">Toute une cave d'un coup, par exemple un tableau préparé par Claude à partir de vos photos.</span></a>`;
    drawCapture();
    drawQueue();
    const f = $("#by-name");
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const hint = { producer: f.producer.value.trim(), name: f.cuvee.value.trim(), vintage: f.vintage.value.trim(), category: f.category.value };
      if (!hint.producer && !hint.name) { const o = f.querySelector(".form-msg"); o.textContent = "Indiquez au moins le producteur ou la cuvée."; o.className = "form-msg error"; return; }
      f.reset();
      launch(hint);
    });
    $("#manual").addEventListener("click", () => stepReview(null, { category: f.category.value, producer: f.producer.value.trim() || null, name: f.cuvee.value.trim() || null, vintage: f.vintage.value ? +f.vintage.value : null }));
  }

  main.addEventListener("change", async (e) => {
    const inp = e.target.closest("[data-shot]");
    if (!inp || !inp.files[0]) return;
    const i = +inp.dataset.shot;
    try { const img = await (VC.Studio?.enabled() ? VC.Studio.original(inp.files[0]) : i === 2 ? VC.shrink(inp.files[0], 2400, .9) : VC.shrink(inp.files[0])); shots[i] = { blob: img.blob, preview: img.preview }; }
    catch (err) { return fail(err, "Image illisible. Essayez une autre photo (JPEG ou PNG)."); }
    const loc = $("#loc").value, qty = $("#qty").value;
    defaults = { loc, qty };
    drawCapture();
  });

  main.addEventListener("click", async (e) => {
    if (e.target.closest("#go")) return launch(null);
    const x = e.target.closest("[data-x]");
    if (x) { shots[+x.dataset.x] = null; defaults = { loc: $("#loc").value, qty: $("#qty").value }; return drawCapture(); }
    const q = e.target.closest("[data-q]");
    if (!q) return;
    const d = drafts.find((y) => y.id === q.closest(".qitem").dataset.id);
    if (!d) return;
    if (q.dataset.q === "review") return stepReview(d);
    if (q.dataset.q === "manual") return stepReview(d, d.hint || {});
    if (q.dataset.q === "retry") {
      await sb.from("drafts").update({ status: "pending", error: null, created_at: new Date().toISOString() }).eq("id", d.id);
      loadDrafts();
      const { error } = await sb.functions.invoke("identify", { body: { draft_id: d.id } });
      if (error) await sb.from("drafts").update({ status: "error", error: "Analyse impossible." }).eq("id", d.id);
      return loadDrafts();
    }
    if (q.dataset.q === "del") {
      if (!confirm("Supprimer cette analyse ?")) return;
      await removeDraft(d);
      loadDrafts();
    }
  });

  async function removeDraft(d) {
    await sb.from("drafts").delete().eq("id", d.id);
    // Ne jamais supprimer les photographies originales avec un brouillon.
  }

  // ---------------------------------------------------------------- vérification d'une fiche
  async function stepReview(d, manual) {
    clearTimeout(poll);
    const r = d && !manual ? d.result || {} : {};
    const it = {};
    if (!manual) for (const k of VC.AI_FIELDS) if (r[k] != null) it[k] = r[k];
    const h = manual || (d && d.hint) || {};
    for (const k of ["producer", "name", "category"]) if (!it[k] && h[k]) it[k] = h[k];
    if (!it.vintage && h.vintage) it.vintage = +h.vintage;
    const conf = r.confidence != null ? Math.round(r.confidence * 100) : null;
    const urls = d ? await VC.signed([...d.photo_paths, d.bottle_path].filter(Boolean)) : () => null;
    const imgs = d ? [...d.photo_paths, d.bottle_path].filter(Boolean).map(urls).filter(Boolean) : [];
    const notice = !d || manual ? "" : !r.identified ? `<p class="notice">Bouteille non identifiée avec certitude. Vérifiez les champs avant d'enregistrer.</p>`
      : `<p class="notice info">Fiche pré-remplie${conf != null ? ` (confiance ${conf} %)` : ""}. Vérifiez et corrigez si besoin.${r.caveats ? ` ${esc(r.caveats)}` : ""}</p>`;
    main.innerHTML = `<p style="margin:16px 0 0"><button class="btn quiet" id="back">${I.back}Retour</button></p>
      <div class="page-head" style="padding-top:8px"><div><span class="eyebrow">Vérification</span><h1>${esc(it.name || "Nouvelle fiche")}</h1></div></div>
      ${notice}
      <div id="dups"></div>
      <form id="item-form" class="card" novalidate style="margin-top:16px">
        ${imgs.length ? `<div class="review-imgs">${imgs.map((u) => `<img src="${esc(u)}" alt="">`).join("")}</div>` : ""}
        <fieldset><legend>En cave</legend><div class="grid3">
          <label>Mettre dans<select name="loc">${locOptions((d && d.location_id) || defaults.loc)}${(wishlists || []).length ? `<optgroup label="Liste d'envies (sans bouteille)">${wishlists.map((w) => `<option value="wl:${w.id}">${esc(w.name)}</option>`).join("")}</optgroup>` : ""}</select></label>
          <label>Bouteilles<input type="number" name="qty" value="${d ? d.qty : 1}" min="0" max="999" inputmode="numeric"></label>
          <label>Emplacement<input name="bin" maxlength="60" placeholder="ex. Casier B3" value="${esc((d && d.bin) || "")}"></label>
        </div></fieldset>
        <div id="fields"></div>
        <div class="row end" style="position:sticky;bottom:calc(var(--tab-h) + env(safe-area-inset-bottom));background:var(--card);padding:14px 0 4px;border-top:1px solid var(--line)">
          <button type="button" class="btn ghost" id="back2">Plus tard</button><button type="submit" class="btn big">${I.check}Enregistrer dans ma cave</button></div>
        <p class="form-msg" role="status"></p>
      </form>`;
    VC.renderItemForm($("#fields"), it, { currency: ctx.profile.currency });
    const back = () => { stepCapture(); loadDrafts(); window.scrollTo(0, 0); };
    $("#back").addEventListener("click", back);
    $("#back2").addEventListener("click", back);
    $("#item-form").addEventListener("submit", (e) => { e.preventDefault(); saveItem(e.target, d, back); });
    window.scrollTo(0, 0);
    showLookalikes(it, d, back);
  }

  // ---------------------------------------------------------------- même vin déjà en cave ?
  // On compare producteur, cuvée et millésime aux fiches existantes ; en cas de doute on demande.
  let dup = { cands: [], dismissed: false };
  async function showLookalikes(it, d, back) {
    dup = { cands: [], dismissed: false };
    const colls = [...new Set(places.map((p) => p.collection_id))];
    if (!colls.length || (!it.name && !it.producer)) return;
    const [{ data: items }, { data: st }] = await Promise.all([
      sb.from("items").select("id, name, producer, vintage, appellation, collection_id, label_path, bottle_path, cover_path, photo_paths").in("collection_id", colls),
      sb.from("stock").select("item_id, quantity, location_id")
    ]);
    dup.cands = VC.lookalikes(it, items || []);
    if (!dup.cands.length || !$("#dups")) return;
    const n = (id) => (st || []).filter((x) => x.item_id === id).reduce((a, x) => a + x.quantity, 0);
    const vint = () => { const v = $("#item-form").elements.vintage.value; return v ? +v : null; };
    const unknownVintage = !it.vintage;
    $("#dups").innerHTML = `<div class="card dup-card"><h3 style="margin:0 0 4px">Déjà en cave ?</h3>
      <p class="muted" style="margin:0 0 10px">Cette bouteille ressemble à ${dup.cands.length > 1 ? "ces vins" : "ce vin"} :</p>
      ${dup.cands.map((m) => `<div class="dup-row"><div><b>${esc([m.item.producer, m.item.name].filter(Boolean).join(" · "))}</b> ${m.item.vintage || "<span class='faint'>sans millésime</span>"}
        <small class="muted">${n(m.item.id)} bt. en cave${m.sameVintage ? " · même millésime" : ""}</small></div>
        <button type="button" class="btn" data-same="${m.item.id}">C'est ce vin</button></div>`).join("")}
      ${unknownVintage ? `<label style="margin-top:10px">Millésime de votre bouteille (illisible sur la photo)<input type="number" id="dup-vintage" min="1800" max="2100" inputmode="numeric" placeholder="ex. 2020"></label>` : ""}
      <button type="button" class="btn quiet" id="dup-no" style="margin-top:8px">Non, c'est un autre vin</button></div>`;
    $("#dup-vintage")?.addEventListener("input", (e) => { $("#item-form").elements.vintage.value = e.target.value; });
    $("#dup-no").addEventListener("click", () => { dup.dismissed = true; $("#dups").innerHTML = ""; });
    $("#dups").addEventListener("click", (e) => {
      const b = e.target.closest("[data-same]");
      if (!b) return;
      const m = dup.cands.find((x) => x.item.id === b.dataset.same);
      const v = vint();
      // Millésimes différents ou inconnus : on fait préciser avant de mélanger deux millésimes.
      if (m.item.vintage && v !== m.item.vintage) {
        const s = VC.sheet(`<h2>Quel millésime ?</h2>
          <p class="muted" style="margin-top:0">${v ? `Votre bouteille indique ${v}, la fiche en cave est ${m.item.vintage}.` : `La fiche en cave est un ${m.item.vintage} ; le millésime de votre bouteille n'a pas été lu.`}</p>
          <div style="display:grid;gap:8px"><button class="btn" data-k="same">C'est un ${m.item.vintage} : ajouter à la fiche existante</button>
          <label>Autre millésime : créer une nouvelle fiche<input type="number" id="other-v" min="1800" max="2100" inputmode="numeric" value="${v && v !== m.item.vintage ? v : ""}" placeholder="ex. 2019"></label>
          <button class="btn ghost" data-k="new">Créer la fiche de ce millésime</button></div>
          <div class="row end" style="margin-top:12px"><button class="btn quiet" data-close>Annuler</button></div>`);
        s.addEventListener("click", (ev) => {
          const k = ev.target.closest("[data-k]");
          if (!k) return;
          if (k.dataset.k === "same") { s.close(); return saveItem($("#item-form"), d, back, m.item); }
          const ov = s.querySelector("#other-v").value;
          if (!ov) return s.querySelector("#other-v").focus();
          $("#item-form").elements.vintage.value = ov; dup.dismissed = true; s.close();
          saveItem($("#item-form"), d, back);
        });
        return;
      }
      saveItem($("#item-form"), d, back, m.item);
    });
  }

  async function saveItem(f, d, back, target = null) {
    const out = f.querySelector(".form-msg");
    const data = VC.readItemForm(f);
    if (!data.name) { out.textContent = "Le nom de la cuvée est obligatoire."; out.className = "form-msg error"; f.elements.name.focus(); return; }
    const wish = f.loc.value.startsWith("wl:") ? (wishlists || []).find((w) => "wl:" + w.id === f.loc.value) : null;
    const qty = wish ? 0 : parseInt(f.qty.value, 10) || 0;
    const loc = wish ? "" : f.loc.value;
    if (qty > 0 && !loc) { out.textContent = "Choisissez une cave."; out.className = "form-msg error"; return; }
    const btn = f.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const coll = wish ? wish.collection_id : collOf(loc);
      let id, locUse = loc;
      if (VC.Studio?.enabled()) {
        const strong = !target && !dup.dismissed && dup.cands.find(m => (m.item.vintage || null) === (data.vintage || null));
        if (strong && !confirm("Une fiche du même millésime existe déjà. Créer quand même une nouvelle fiche ?")) { btn.disabled = false; return; }
        if (target && !wish && collOf(loc) !== target.collection_id) locUse = (places.find(p => p.collection_id === target.collection_id) || {}).id || loc;
        if (!saveKeys.has(f)) saveKeys.set(f, d?.id || crypto.randomUUID());
        const {data: saved, error: se} = await sb.rpc("studio_save_item", {p_request:saveKeys.get(f), p_payload:{data,target:target?.id || null,location:locUse || null,wishlist:wish?.id || null,qty:wish ? parseInt(f.qty.value,10) || 0 : qty,bin:f.bin.value.trim() || null,photos:d?.photo_paths || [],bottle_path:d?.bottle_path || null,bottle_image_url:d?.result?.image_url || null,sources:d?.sources || [],ai_enriched_at:d?.result ? d.updated_at : null,draft_id:d?.id || null}});
        if (se) throw se;
        id = saved;
      } else if (target) {
        // Même vin : les bouteilles rejoignent la fiche existante ; la photo y est ajoutée.
        id = target.id;
        if (!wish && collOf(loc) !== target.collection_id) locUse = (places.find((p) => p.collection_id === target.collection_id) || {}).id || loc;
        const photos = d ? d.photo_paths.filter(Boolean) : [];
        if (photos.length) {
          const patch = target.label_path ? { photo_paths: [...(target.photo_paths || []), ...photos] } : { label_path: photos[0], photo_paths: [...(target.photo_paths || []), ...photos.slice(1)] };
          await sb.from("items").update(patch).eq("id", id);
        }
      } else {
        // Une fiche très proche existe (même millésime) et l'utilisateur n'a pas tranché : on demande.
        const strong = !dup.dismissed && dup.cands.find((m) => (m.item.vintage || null) === (data.vintage || null));
        if (strong && !confirm(`« ${[strong.item.producer, strong.item.name].filter(Boolean).join(" · ")} ${strong.item.vintage || ""} » est déjà en cave. Créer quand même une nouvelle fiche ?\n(Annuler, puis « C'est ce vin » pour ajouter les bouteilles à la fiche existante.)`)) {
          btn.disabled = false; $("#dups").scrollIntoView({ behavior: "smooth" }); return;
        }
        const row = { ...data, ...(coll ? { collection_id: coll } : {}),
          label_path: d ? photoOf(d, "label") : null, label_back_path: d ? photoOf(d, "back") : null,
          photo_paths: d && photoOf(d, "full") ? [photoOf(d, "full")] : [],
          bottle_path: d && d.result ? d.bottle_path : null, bottle_image_url: d && d.result ? d.result.image_url || null : null,
          sources: d ? d.sources || [] : [], ai_enriched_at: d && d.result ? d.updated_at : null };
        const { data: ins, error } = await sb.from("items").insert(row).select("id").single();
        if (error) throw error;
        id = ins.id;
      }
      if (!VC.Studio?.enabled() && qty > 0) {
        const { error: se } = await sb.rpc("adjust_stock", { p_item: id, p_location: locUse, p_delta: qty, p_bin: f.bin.value.trim() || null });
        if (se) throw se;
      }
      if (!VC.Studio?.enabled() && wish) {
        const { error: we } = await sb.from("wishlist_items").insert({ wishlist_id: wish.id, item_id: id, qty_wanted: parseInt(f.qty.value, 10) || null });
        if (we && !/duplicate|unique/.test(we.message)) throw we;
      }
      if (d && !VC.Studio?.enabled()) await removeDraft(d);
      if (!wish) defaults.loc = loc;
      const full = d && photoOf(d, "full");
      if (full && VC.Visual) {
        // L'aperçu se prépare en arrière-plan : on peut enchaîner la bouteille suivante.
        VC.Visual.auto({ ...data, id }, full)
          .then(() => toast("Aperçu de la bouteille prêt.", { label: "Voir", run: () => (location.href = `/app/fiche.html?id=${id}`) }))
          .catch((err) => { console.warn(err); toast("Aperçu non créé : vous pourrez le faire depuis la fiche."); });
      }
      toast(wish ? `Ajouté à « ${wish.name} ».` : target ? `${qty} bouteille${qty > 1 ? "s" : ""} ajoutée${qty > 1 ? "s" : ""} à la fiche existante.` : "Ajouté à votre cave.", { label: "Voir la fiche", run: () => (location.href = `/app/fiche.html?id=${id}`) });
      back();
      VC.Studio?.offer(id);
    } catch (e) {
      btn.disabled = false;
      fail(e, "Enregistrement impossible.");
    }
  }

  stepCapture();
  loadDrafts();
})();
