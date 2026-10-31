// Ajout d'une bouteille : photo (appareil ou album) ou nom → analyse IA → fiche pré-remplie à vérifier → stock.
(async function () {
  const VC = window.VC;
  const { sb, $, esc, I, CATEGORY, toast, fail } = VC;
  const ctx = await VC.boot("add");
  const main = $("#main");
  const { data: places } = await sb.from("locations").select("*").order("position").order("created_at");

  let draft = {};          // fiche en cours
  let labelPath = null;    // photo de l'étiquette déjà envoyée
  let labelUpload = null;  // promesse d'envoi
  let preview = null;

  const STEPS = ["Lecture de l'étiquette…", "Recherche du producteur…", "Fiche technique, cépages, élevage…", "Fenêtre de garde et accords mets…", "Note moyenne et prix du marché…", "Image de la bouteille…", "Mise en forme de la fiche…"];

  function stepCapture() {
    main.innerHTML = `<div class="page-head"><div><span class="eyebrow">Nouvelle bouteille</span><h1>Ajouter à ma cave</h1></div></div>
      <div class="capture">
        <label class="capture-btn">${I.camera}<span>Prendre une photo</span><small class="muted">Étiquette de face, bien éclairée, sans reflet</small><input type="file" accept="image/*" capture="environment" data-photo></label>
        <label class="capture-btn">${I.image}<span>Choisir dans mes photos</span><small class="muted">Photo d'étiquette ou capture d'écran</small><input type="file" accept="image/*" data-photo></label>
      </div>
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
    main.querySelectorAll("[data-photo]").forEach((inp) => inp.addEventListener("change", () => inp.files[0] && onPhoto(inp.files[0])));
    const f = $("#by-name");
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const hint = { producer: f.producer.value.trim(), name: f.cuvee.value.trim(), vintage: f.vintage.value.trim(), category: f.category.value };
      if (!hint.producer && !hint.name) { f.querySelector(".form-msg").textContent = "Indiquez au moins le producteur ou la cuvée."; f.querySelector(".form-msg").className = "form-msg error"; return; }
      analyse({ hint }, hint);
    });
    $("#manual").addEventListener("click", () => stepReview({ category: f.category.value, producer: f.producer.value.trim() || null, name: f.cuvee.value.trim() || null, vintage: f.vintage.value ? +f.vintage.value : null }));
  }

  async function onPhoto(file) {
    let img;
    try { img = await VC.shrink(file); } catch (e) { return fail(e, "Image illisible. Essayez une autre photo (JPEG ou PNG)."); }
    preview = img.preview;
    const path = `${ctx.user.id}/label-${crypto.randomUUID()}.jpg`;
    labelUpload = sb.storage.from("labels").upload(path, img.blob, { contentType: "image/jpeg" })
      .then(({ error }) => { if (!error) labelPath = path; else console.error(error); });
    analyse({ image: img.b64, media_type: "image/jpeg" });
  }

  async function analyse(payload, hint) {
    let i = 0;
    main.innerHTML = `<div class="page-head"><div><span class="eyebrow">Analyse en cours</span><h1>Je cherche votre bouteille</h1></div></div>
      <div class="card"><div class="${preview ? "preview" : ""}">${preview ? `<img src="${preview}" alt="Votre photo">` : ""}
        <div class="progress"><b id="step">${STEPS[0]}</b><div class="bar"><span></span></div><small class="muted">Comptez 30 à 90 secondes : la fiche est construite à partir du site du producteur et de revendeurs.</small></div></div></div>`;
    const timer = setInterval(() => { i = Math.min(i + 1, STEPS.length - 1); const s = $("#step"); if (s) s.textContent = STEPS[i]; }, 9000);
    try {
      const res = await VC.identify(payload);
      const r = res.result || {};
      const it = {};
      for (const k of VC.AI_FIELDS) if (r[k] != null) it[k] = r[k];
      if (hint) { for (const k of ["producer", "name"]) if (!it[k] && hint[k]) it[k] = hint[k]; if (!it.vintage && hint.vintage) it.vintage = +hint.vintage; }
      it.bottle_path = res.bottle_path || null;
      it.bottle_image_url = r.image_url || null;
      it.sources = res.sources || [];
      it.ai_enriched_at = new Date().toISOString();
      stepReview(it, r);
    } catch (e) {
      console.error(e);
      stepReview(hint ? { ...hint, vintage: hint.vintage ? +hint.vintage : null } : {}, null, e.message);
    } finally { clearInterval(timer); }
  }

  async function stepReview(it, ai, errorText) {
    draft = it;
    const conf = ai && ai.confidence != null ? Math.round(ai.confidence * 100) : null;
    let thumb = preview;
    if (!thumb && it.bottle_path) thumb = (await VC.signed([it.bottle_path]))(it.bottle_path);
    const notice = errorText
      ? `<p class="notice">${esc(errorText)} Complétez la fiche à la main ou <button class="btn quiet" type="button" id="retry">réessayez</button>.</p>`
      : ai && !ai.identified ? `<p class="notice">Bouteille non identifiée avec certitude. Vérifiez les champs avant d'enregistrer.</p>`
      : ai ? `<p class="notice info">Fiche pré-remplie${conf != null ? ` (confiance ${conf} %)` : ""}. Vérifiez et corrigez si besoin.${ai.caveats ? ` ${esc(ai.caveats)}` : ""}</p>` : "";
    main.innerHTML = `<div class="page-head"><div><span class="eyebrow">Vérification</span><h1>${esc(it.name || "Nouvelle fiche")}</h1></div></div>
      ${notice}
      <form id="item-form" class="card" novalidate style="margin-top:16px">
        ${thumb ? `<div class="preview" style="margin-bottom:20px"><img src="${esc(thumb)}" alt=""><div class="muted">${esc([it.producer, it.vintage, it.region, it.country].filter(Boolean).join(" · "))}</div></div>` : ""}
        <fieldset><legend>En cave</legend><div class="grid3">
          <label>Cave<select name="loc">${(places || []).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></label>
          <label>Bouteilles<input type="number" name="qty" value="1" min="0" max="999" inputmode="numeric"></label>
          <label>Emplacement<input name="bin" maxlength="60" placeholder="ex. Casier B3"></label>
        </div>${(places || []).length ? "" : `<p class="notice">Aucune cave créée. <a href="/app/caves.html">Créer une cave</a> d'abord.</p>`}</fieldset>
        <div id="fields"></div>
        <div class="row end" style="position:sticky;bottom:calc(var(--tab-h) + env(safe-area-inset-bottom));background:var(--card);padding:14px 0 4px;border-top:1px solid var(--line)">
          <button type="button" class="btn ghost" id="restart">Recommencer</button><button type="submit" class="btn big">${I.check}Enregistrer dans ma cave</button></div>
        <p class="form-msg" role="status"></p>
      </form>`;
    const f = $("#item-form");
    VC.renderItemForm($("#fields"), it, { currency: ctx.profile.currency });
    $("#restart").addEventListener("click", () => { preview = null; labelPath = null; stepCapture(); });
    $("#retry")?.addEventListener("click", () => stepCapture());
    f.addEventListener("submit", (e) => { e.preventDefault(); saveItem(f); });
  }

  async function saveItem(f) {
    const out = f.querySelector(".form-msg");
    const data = VC.readItemForm(f);
    if (!data.name) { out.textContent = "Le nom de la cuvée est obligatoire."; out.className = "form-msg error"; f.elements.name.focus(); return; }
    const qty = parseInt(f.qty.value, 10) || 0;
    const loc = f.loc.value;
    if (qty > 0 && !loc) { out.textContent = "Choisissez une cave."; out.className = "form-msg error"; return; }
    const btn = f.querySelector("button[type=submit]");
    btn.disabled = true;

    try {
      // Doublon : même cuvée, même producteur, même millésime → on ajoute les bouteilles à la fiche existante.
      let q = sb.from("items").select("id, name").ilike("name", data.name);
      q = data.vintage ? q.eq("vintage", data.vintage) : q.is("vintage", null);
      if (data.producer) q = q.ilike("producer", data.producer);
      const { data: dup } = await q.limit(1);
      if (dup && dup.length && confirm(`« ${dup[0].name} » est déjà dans votre cave. Ajouter ces ${qty} bouteille(s) à la fiche existante ?`)) {
        if (qty > 0) { const { error } = await sb.rpc("adjust_stock", { p_item: dup[0].id, p_location: loc, p_delta: qty, p_bin: f.bin.value.trim() || null }); if (error) throw error; }
        return location.replace(`/app/fiche.html?id=${dup[0].id}`);
      }

      if (labelUpload) await labelUpload;
      const row = { ...data, label_path: labelPath, bottle_path: draft.bottle_path || null, bottle_image_url: draft.bottle_image_url || null,
        sources: draft.sources || [], ai_enriched_at: draft.ai_enriched_at || null };
      const { data: ins, error } = await sb.from("items").insert(row).select("id").single();
      if (error) throw error;
      if (qty > 0) {
        const { error: se } = await sb.rpc("adjust_stock", { p_item: ins.id, p_location: loc, p_delta: qty, p_bin: f.bin.value.trim() || null });
        if (se) throw se;
      }
      toast("Ajouté à votre cave.");
      location.replace(`/app/fiche.html?id=${ins.id}`);
    } catch (e) {
      btn.disabled = false;
      fail(e, "Enregistrement impossible.");
    }
  }

  stepCapture();
})();
