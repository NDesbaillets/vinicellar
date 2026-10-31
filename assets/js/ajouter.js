// Ajouter des bouteilles à la chaîne : étiquette (+ contre-étiquette) → analyse lancée en arrière-plan →
// on photographie la suivante pendant ce temps → on vérifie chaque fiche quand elle est prête.
(async function () {
  const VC = window.VC;
  const { sb, $, esc, I, CATEGORY, toast, fail } = VC;
  const ctx = await VC.boot("add");
  const main = $("#main");
  const places = await VC.loadPlaces().catch(() => []);
  let here = VC.getLoc();
  if (!places.some((p) => p.id === here)) here = places[0] ? places[0].id : "";

  const shots = [null, null];          // { blob, preview } : étiquette, contre-étiquette
  let drafts = [], thumbs = () => null, poll = null;
  let defaults = { loc: here, qty: 1 };
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
        const path = `${ctx.user.id}/${i ? "back" : "label"}-${crypto.randomUUID()}.jpg`;
        const { error } = await sb.storage.from("labels").upload(path, s.blob, { contentType: "image/jpeg" });
        if (error) throw error;
        paths.push(path);
      }
      const { data: d, error } = await sb.from("drafts").insert({
        collection_id: collOf(loc), location_id: loc || null, qty, photo_paths: paths, hint: hint || {}
      }).select("id").single();
      if (error) throw error;
      shots[0] = shots[1] = null;
      drawCapture();
      toast(hint ? "Recherche lancée." : "Analyse lancée. Photographiez la bouteille suivante.");
      const { error: fe } = await sb.functions.invoke("identify", { body: { draft_id: d.id } });
      if (fe) {
        let msg = "Analyse impossible.";
        try { const j = await fe.context.json(); if (j && j.message) msg = j.message; } catch { /* réponse vide */ }
        await sb.from("drafts").update({ status: "error", error: msg }).eq("id", d.id);
      }
    } catch (e) { fail(e, "Envoi impossible. Vérifiez la connexion."); }
    finally { if ($("#go")) $("#go").disabled = !shots[0]; loadDrafts(); }
  }

  // ---------------------------------------------------------------- saisie
  function slot(i) {
    const s = shots[i];
    const title = i ? "Contre-étiquette" : "Étiquette";
    if (s) return `<div class="shot"><img src="${s.preview}" alt="${title}"><span class="shot-label">${title}</span><button class="icon-btn shot-x" data-x="${i}" aria-label="Retirer">×</button></div>`;
    return `<div class="shot empty"><span class="shot-label">${title}${i ? " <small>(facultatif)</small>" : ""}</span>
      <div class="shot-btns"><label class="btn ${i ? "ghost" : ""}">${I.camera}Photo<input type="file" accept="image/*" capture="environment" data-shot="${i}" hidden></label>
      <label class="btn ghost">${I.image}Album<input type="file" accept="image/*" data-shot="${i}" hidden></label></div>
      ${i ? `<small class="muted">Souvent le millésime et l'assemblage</small>` : `<small class="muted">De face, sans reflet</small>`}</div>`;
  }

  function drawCapture() {
    $("#capture").innerHTML = `<div class="shots">${slot(0)}${slot(1)}</div>
      <div class="form-line" style="margin-top:14px">
        <label>Cave<select id="loc">${locOptions(defaults.loc)}</select></label>
        <label>Bouteilles<input id="qty" type="number" min="0" max="999" inputmode="numeric" value="${defaults.qty}"></label>
        <button class="btn big" id="go"${shots[0] ? "" : " disabled"}>${I.sparkle}Lancer l'analyse</button></div>
      <p class="hint" style="margin:10px 0 0">Enchaînez les bouteilles : chaque analyse continue pendant que vous photographiez la suivante.</p>`;
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
      </form>`;
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
    try { const img = await VC.shrink(inp.files[0]); shots[i] = { blob: img.blob, preview: img.preview }; }
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
      await removeDraft(d, true);
      loadDrafts();
    }
  });

  async function removeDraft(d, withPhotos) {
    await sb.from("drafts").delete().eq("id", d.id);
    const files = [...(withPhotos ? d.photo_paths : []), ...(withPhotos && d.bottle_path ? [d.bottle_path] : [])];
    if (files.length) await sb.storage.from("labels").remove(files);
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
      <form id="item-form" class="card" novalidate style="margin-top:16px">
        ${imgs.length ? `<div class="review-imgs">${imgs.map((u) => `<img src="${esc(u)}" alt="">`).join("")}</div>` : ""}
        <fieldset><legend>En cave</legend><div class="grid3">
          <label>Cave<select name="loc">${locOptions((d && d.location_id) || defaults.loc)}</select></label>
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
  }

  async function saveItem(f, d, back) {
    const out = f.querySelector(".form-msg");
    const data = VC.readItemForm(f);
    if (!data.name) { out.textContent = "Le nom de la cuvée est obligatoire."; out.className = "form-msg error"; f.elements.name.focus(); return; }
    const qty = parseInt(f.qty.value, 10) || 0;
    const loc = f.loc.value;
    if (qty > 0 && !loc) { out.textContent = "Choisissez une cave."; out.className = "form-msg error"; return; }
    const btn = f.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const coll = collOf(loc);
      // Doublon : même cuvée, même producteur, même millésime → on ajoute les bouteilles à la fiche existante.
      let q = sb.from("items").select("id, name").ilike("name", data.name);
      if (coll) q = q.eq("collection_id", coll);
      q = data.vintage ? q.eq("vintage", data.vintage) : q.is("vintage", null);
      if (data.producer) q = q.ilike("producer", data.producer);
      const { data: dup } = await q.limit(1);
      let id;
      if (dup && dup.length && confirm(`« ${dup[0].name} » est déjà dans votre cave. Ajouter ces ${qty} bouteille(s) à la fiche existante ?`)) {
        id = dup[0].id;
      } else {
        const row = { ...data, ...(coll ? { collection_id: coll } : {}),
          label_path: d ? d.photo_paths[0] || null : null, label_back_path: d ? d.photo_paths[1] || null : null,
          bottle_path: d && d.result ? d.bottle_path : null, bottle_image_url: d && d.result ? d.result.image_url || null : null,
          sources: d ? d.sources || [] : [], ai_enriched_at: d && d.result ? d.updated_at : null };
        const { data: ins, error } = await sb.from("items").insert(row).select("id").single();
        if (error) throw error;
        id = ins.id;
      }
      if (qty > 0) {
        const { error: se } = await sb.rpc("adjust_stock", { p_item: id, p_location: loc, p_delta: qty, p_bin: f.bin.value.trim() || null });
        if (se) throw se;
      }
      if (d) await removeDraft(d, false);
      defaults.loc = loc;
      toast("Ajouté à votre cave.", { label: "Voir la fiche", run: () => (location.href = `/app/fiche.html?id=${id}`) });
      back();
    } catch (e) {
      btn.disabled = false;
      fail(e, "Enregistrement impossible.");
    }
  }

  stepCapture();
  loadDrafts();
})();
