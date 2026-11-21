// ARÔMES V&N · saisie d'une astuce (contrat 08-astuces-contrat.md §3). ?id= pour modifier, ?recette= pour lier à une recette.
(async function () {
  const AR = window.AR, { sb, $, $$, esc, norm, setMsg, toast } = AR;
  const ctx = await AR.boot("ajouter");
  if (!ctx) return;
  const main = $("#main");
  const qs = new URLSearchParams(location.search);
  const qid = qs.get("id"), qrec = qs.get("recette");
  const editable = ctx.books.filter((b) => b.role === "owner" || b.role === "member");
  const stop = (t) => { main.setAttribute("aria-busy", "false"); main.innerHTML = `<div class="vide-etat"><p role="alert">${esc(t)}</p><a class="btn sec petit" href="/recettes/">Retour au carnet</a></div>`; };
  const MAX_BODY = 20000;

  // État : ingrédients (id -> nom) et recettes liées (id -> titre), avec l'état d'origine pour calculer les écarts à l'enregistrement.
  const state = { id: qid || null, bookId: null, ings: new Map(), recs: new Map(), ings0: new Set(), recs0: new Set(), ignored: new Set(), cover: null, file: null };
  let tip = null;

  if (qid) {
    try {
      const tt = await sb.from("recipe_tips").select("*").eq("id", qid).maybeSingle();
      if (tt.error) throw tt.error;
      if (!tt.data) return stop("Astuce introuvable, ou vous n'avez pas accès à son carnet.");
      tip = tt.data;
      const [i, r, p] = await Promise.all([
        sb.from("recipe_tip_ingredients").select("catalog_id,recipe_ingredients_catalog(name)").eq("tip_id", qid),
        sb.from("recipe_tip_recipes").select("recipe_id,recipes(id,title)").eq("tip_id", qid),
        sb.from("recipe_tip_photos").select("*").eq("tip_id", qid).eq("is_cover", true)
      ]);
      for (const x of [i, r, p]) if (x.error) throw x.error;
      (i.data || []).forEach((x) => { state.ings.set(x.catalog_id, (x.recipe_ingredients_catalog || {}).name || "Ingrédient"); state.ings0.add(x.catalog_id); });
      (r.data || []).forEach((x) => { if (x.recipes) { state.recs.set(x.recipe_id, x.recipes.title); state.recs0.add(x.recipe_id); } });
      state.cover = (p.data || [])[0] || null;
    } catch (e) { return stop(AR.tipErr(e, "Impossible de charger l'astuce.")); }
    if (!editable.some((b) => b.id === tip.book_id)) return stop("Votre rôle dans ce carnet ne permet pas de modifier cette astuce.");
    state.bookId = tip.book_id;
  } else {
    if (!editable.length) return stop("Vous n'avez aucun carnet où ajouter une astuce (il faut y être propriétaire ou membre).");
    if (qrec) {
      // Astuce liée à une recette : même carnet que la recette.
      try {
        const rr = await sb.from("recipes").select("id,title,book_id").eq("id", qrec).maybeSingle();
        if (rr.error) throw rr.error;
        if (!rr.data) return stop("Recette introuvable, ou vous n'avez pas accès à son carnet.");
        if (!editable.some((b) => b.id === rr.data.book_id)) return stop("Votre rôle dans ce carnet ne permet pas d'y ajouter une astuce.");
        state.bookId = rr.data.book_id; state.recs.set(rr.data.id, rr.data.title);
      } catch (e) { return stop(AR.errMsg(e, "Impossible de charger la recette.")); }
    } else {
      const pref = AR.getBookPref();
      state.bookId = (editable.find((b) => b.id === pref) || editable[0]).id;
    }
  }
  document.title = (tip ? "Modifier l'astuce" : "Écrire une astuce") + " · ARÔMES V&N";
  const v = (x) => (x == null ? "" : x);
  const lockBook = !!tip || !!qrec;

  main.setAttribute("aria-busy", "false");
  main.innerHTML = `<h1 class="chapitre">${tip ? "Modifier l'astuce" : "Écrire une astuce"}</h1><span class="filet" aria-hidden="true"></span>
    <form id="form" class="champs" novalidate>
      <label>Carnet de destination<select name="book"${lockBook ? " disabled" : ""}>${editable.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("")}</select></label>
      <label>Titre<input name="title" maxlength="200" required value="${esc(v(tip && tip.title))}" placeholder="ex. Garder les herbes fraîches"></label>
      <label>Catégorie<select name="category">${Object.entries(AR.TIP_CATS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select></label>
      <label>Texte<textarea name="body" id="body" rows="10" maxlength="${MAX_BODY}" placeholder="Le conseil, avec les quantités, températures et durées utiles.">${esc(v(tip && tip.body))}</textarea></label>
      <fieldset class="source-bloc">
        <legend class="etiquette">Source</legend>
        <label>Créateur ou auteur<input name="source_author" maxlength="120" placeholder="ex. @chef, Mamie" value="${esc(v(tip && tip.source_author))}"></label>
        <label>Lien<input name="source_url" type="url" inputmode="url" maxlength="500" placeholder="https://" value="${esc(v(tip && tip.source_url))}"></label>
        <button type="button" class="btn lien" id="src-clear">Retirer la source</button>
      </fieldset>
      <p class="aide compteur" id="compteur" aria-live="polite"></p>
      <div>
        <h2 class="section" style="margin-top:12px">Ingrédients liés</h2>
        <ul class="pf-puces" id="ing-puces" aria-label="Ingrédients liés"></ul>
        <div id="ing-picker"></div>
        <div id="ing-prop" hidden><span class="etiquette">Proposés d'après le texte</span>
          <ul class="pf-puces" id="prop-puces" aria-label="Ingrédients proposés"></ul></div>
      </div>
      <div>
        <h2 class="section" style="margin-top:12px">Recettes liées</h2>
        <ul class="pf-puces" id="rec-puces" aria-label="Recettes liées"></ul>
        <label for="rec-q">Chercher une recette du carnet</label>
        <input id="rec-q" type="search" autocomplete="off" enterkeyhint="search" placeholder="Titre de la recette">
        <ul class="ac-liste" id="rec-liste" aria-label="Recettes trouvées" hidden></ul>
        <p class="aide" id="rec-etat" role="status" aria-live="polite"></p>
      </div>
      <div>
        <span class="etiquette">Photo (facultative)</span>
        <div id="photo-prev" class="apercu-photo" style="margin-top:8px" hidden><div class="passe-partout"><div class="cadre"><img id="photo-img" alt="Aperçu de la photo"></div></div></div>
        <input type="file" name="photo" accept="image/*" aria-label="Choisir une photo">
        <p class="aide">Redimensionnée à 1600 px au plus et enregistrée en JPEG.</p>
      </div>
      <div class="rangee" style="margin-top:20px"><button class="btn" type="submit" id="save">Enregistrer l'astuce</button><a class="btn sec" href="${tip ? "/recettes/astuce.html?id=" + encodeURIComponent(tip.id) : qrec ? "/recettes/fiche.html?id=" + encodeURIComponent(qrec) : "/recettes/"}">Annuler</a></div>
      <p class="msg" id="msg" role="status" aria-live="polite"></p>
    </form>`;
  const f = $("#form"), out = $("#msg");
  f.book.value = state.bookId;
  f.category.value = (tip && tip.category) || "technique";

  const fmtN = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  function drawCount() {
    const n = f.body.value.length, c = $("#compteur");
    c.textContent = `${fmtN(n)} / ${fmtN(MAX_BODY)} caractères`;
    c.classList.toggle("erreur", n > MAX_BODY);
  }

  // ---- ingrédients : sélecteur du catalogue + puces
  const chip = (id, label, kind) => `<li class="pf-puce"><span>${esc(label)}</span><button type="button" class="pf-x" data-rm-${kind}="${esc(id)}" aria-label="Retirer : ${esc(label)}">×</button></li>`;
  function drawIngs() { $("#ing-puces").innerHTML = [...state.ings].map(([id, n]) => chip(id, n, "ing")).join(""); drawProps(); }
  AR.catalogPicker($("#ing-picker"), { label: "Ajouter un ingrédient du catalogue", placeholder: "ex. citron", id: "ing-ac", exclude: () => new Set(state.ings.keys()),
    onPick: (c) => { state.ings.set(c.id, c.name); drawIngs(); } });
  $("#ing-puces").addEventListener("click", (e) => { const b = e.target.closest("[data-rm-ing]"); if (!b) return; state.ings.delete(b.dataset.rmIng); drawIngs(); });

  // Propositions locales : mots (et paires de mots) du texte dont le nom ou l'alias correspond exactement à une entrée du catalogue.
  let cat = null, props = [];
  function computeProps() {
    if (!cat) return;
    const words = norm(f.body.value + " " + f.title.value).split(/[^a-z0-9œ]+/).filter((w) => w.length >= 3);
    const cands = new Set(words);
    for (let i = 0; i < words.length - 1; i++) cands.add(words[i] + " " + words[i + 1]);
    const seen = new Set(), found = [];
    cands.forEach((w) => {
      [w, w.replace(/[sx]$/, "")].forEach((x) => {
        if (x.length < 3) return;
        AR.catalogFind(cat, x, 4).forEach((c) => {
          if ((c._n === x || c._a.includes(x)) && !seen.has(c.id) && !state.ings.has(c.id) && !state.ignored.has(c.id)) { seen.add(c.id); found.push(c); }
        });
      });
    });
    props = found.slice(0, 8);
  }
  function drawProps() {
    computeProps();
    $("#ing-prop").hidden = !props.length;
    $("#prop-puces").innerHTML = props.map((c) => `<li class="pf-puce pf-prop"><button type="button" class="pf-add" data-add-ing="${esc(c.id)}" aria-label="Ajouter : ${esc(c.name)}">+ ${esc(c.name)}</button><button type="button" class="pf-x" data-ign-ing="${esc(c.id)}" aria-label="Ne pas proposer : ${esc(c.name)}">×</button></li>`).join("");
  }
  $("#prop-puces").addEventListener("click", (e) => {
    const a = e.target.closest("[data-add-ing]"), x = e.target.closest("[data-ign-ing]");
    if (a) { const c = props.find((p) => p.id === a.dataset.addIng); if (c) state.ings.set(c.id, c.name); drawIngs(); }
    if (x) { state.ignored.add(x.dataset.ignIng); drawProps(); }
  });
  const redraw = AR.debounce(drawProps, 400);
  f.body.addEventListener("input", () => { drawCount(); redraw(); });
  f.title.addEventListener("input", redraw);
  AR.loadCatalog().then((c) => { cat = c; drawProps(); }).catch((e) => console.error(e)); // sans catalogue : pas de propositions, la saisie reste possible
  drawCount(); drawIngs();

  // ---- recettes liées (recherche dans le carnet)
  const drawRecs = () => { $("#rec-puces").innerHTML = [...state.recs].map(([id, n]) => chip(id, n, "rec")).join(""); };
  drawRecs();
  $("#rec-puces").addEventListener("click", (e) => { const b = e.target.closest("[data-rm-rec]"); if (!b) return; state.recs.delete(b.dataset.rmRec); drawRecs(); });
  const rq = $("#rec-q"), rl = $("#rec-liste"), re = $("#rec-etat");
  let rseq = 0, rcur = [];
  async function searchRecs() {
    const q = rq.value.trim().replace(/[%_\\,()]/g, " ").trim(), my = ++rseq;
    if (!q) { rl.hidden = true; re.textContent = ""; return; }
    const book = tip ? state.bookId : f.book.value;
    const { data, error } = await sb.from("recipes").select("id,title").eq("book_id", book).is("deleted_at", null).is("archived_at", null).ilike("title", `%${q}%`).order("title").limit(8);
    if (my !== rseq) return;
    if (error) { re.textContent = AR.errMsg(error, "Recherche impossible."); return; }
    rcur = (data || []).filter((x) => !state.recs.has(x.id));
    re.textContent = "";
    rl.innerHTML = rcur.length ? rcur.map((x, i) => `<li role="presentation"><button type="button" class="ac-opt" data-i="${i}">${esc(x.title)}</button></li>`).join("") : `<li class="ac-vide" role="presentation">Aucune recette du carnet ne correspond.</li>`;
    rl.hidden = false;
  }
  rq.addEventListener("input", AR.debounce(searchRecs, 250));
  rq.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); searchRecs().then(() => { if (rcur[0]) pickRec(rcur[0]); }); } });
  function pickRec(x) { state.recs.set(x.id, x.title); drawRecs(); rq.value = ""; rl.hidden = true; rq.focus(); }
  rl.addEventListener("click", (e) => { const b = e.target.closest(".ac-opt"); if (b && rcur[+b.dataset.i]) pickRec(rcur[+b.dataset.i]); });
  f.book.addEventListener("change", () => { state.recs.clear(); drawRecs(); rl.hidden = true; });

  // ---- photo
  let blobUrl = null;
  (async function showCover() {
    if (!state.cover) return;
    const u = await AR.signedUrls([state.cover.storage_path]);
    if (u[state.cover.storage_path] && !state.file) { $("#photo-img").src = u[state.cover.storage_path]; $("#photo-prev").hidden = false; }
  })();
  f.photo.addEventListener("change", () => {
    const file = f.photo.files && f.photo.files[0];
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    state.file = file || null;
    if (file) { blobUrl = URL.createObjectURL(file); $("#photo-img").src = blobUrl; $("#photo-prev").hidden = false; }
  });

  // ---- enregistrement
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = f.title.value.trim(), body = f.body.value.trim();
    if (!title) return setMsg(out, "Indiquez le titre de l'astuce.", "erreur");
    if (!body) return setMsg(out, "Écrivez le texte de l'astuce.", "erreur");
    if (f.source_url.value.trim() && !AR.safeUrl(f.source_url.value.trim())) return setMsg(out, "Le lien de la source doit commencer par https://.", "erreur");
    if (f.body.value.length > MAX_BODY) return setMsg(out, `Le texte dépasse ${fmtN(MAX_BODY)} caractères : raccourcissez-le.`, "erreur");
    const btn = $("#save"); btn.disabled = true; setMsg(out, "Enregistrement…");
    try {
      const fields = { title, body, category: f.category.value, ...AR.sourceFields(f) };
      if (!state.id) {
        const id = AR.uuid(), book = f.book.value;
        const { error } = await sb.from("recipe_tips").insert({ id, ...fields, book_id: book, source_type: "manuel", created_by: ctx.user.id });
        if (error) throw error;
        state.id = id; state.bookId = book;
      } else {
        const { error } = await sb.from("recipe_tips").update(fields).eq("id", state.id);
        if (error) throw error;
      }
      // Liens : on ajoute les nouveaux, puis on retire ceux qui ont disparu (l'état de référence suit chaque étape réussie).
      const diff = async (table, col, cur, ref) => {
        const add = [...cur.keys()].filter((k) => !ref.has(k)), del = [...ref].filter((k) => !cur.has(k));
        if (add.length) { const r = await sb.from(table).insert(add.map((k) => ({ tip_id: state.id, [col]: k }))); if (r.error) throw r.error; add.forEach((k) => ref.add(k)); }
        if (del.length) { const r = await sb.from(table).delete().eq("tip_id", state.id).in(col, del); if (r.error) throw r.error; del.forEach((k) => ref.delete(k)); }
      };
      await diff("recipe_tip_ingredients", "catalog_id", state.ings, state.ings0);
      await diff("recipe_tip_recipes", "recipe_id", state.recs, state.recs0);
      // Photo facultative : devient la couverture.
      if (state.file) {
        const blob = await AR.compressImage(state.file);
        const path = `${state.bookId}/tips/${state.id}/${Date.now()}.jpg`;
        const up = await sb.storage.from("recipes").upload(path, blob, { contentType: "image/jpeg", upsert: false });
        if (up.error) throw up.error;
        const old = state.cover;
        if (old) { const u = await sb.from("recipe_tip_photos").update({ is_cover: false }).eq("id", old.id); if (u.error) { await sb.storage.from("recipes").remove([path]); throw u.error; } }
        const ins = await sb.from("recipe_tip_photos").insert({ tip_id: state.id, storage_path: path, kind: "perso", is_cover: true, created_by: ctx.user.id }).select("*").single();
        if (ins.error) {
          await sb.storage.from("recipes").remove([path]);
          if (old) await sb.from("recipe_tip_photos").update({ is_cover: true }).eq("id", old.id);
          throw ins.error;
        }
        state.cover = ins.data; state.file = null;
      }
      toast("Astuce enregistrée.");
      location.assign("/recettes/astuce.html?id=" + encodeURIComponent(state.id));
    } catch (err) {
      btn.disabled = false;
      setMsg(out, AR.tipErr(err, "Enregistrement impossible. Vos saisies sont conservées : réessayez."), "erreur");
    }
  });
})();
