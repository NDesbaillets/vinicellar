(async function () {
  const AR = window.AR, { sb, $, $$, esc, norm, errMsg, setMsg, toast } = AR;
  const ctx = await AR.boot("ajouter");
  if (!ctx) return;
  const main = $("#main");
  const qid = new URLSearchParams(location.search).get("id");
  const editable = ctx.books.filter((b) => b.role === "owner" || b.role === "member");
  const stop = (t) => { main.setAttribute("aria-busy", "false"); main.innerHTML = `<div class="vide-etat"><p role="alert">${esc(t)}</p><a class="btn sec petit" href="/recettes/">Retour au carnet</a></div>`; };

  const state = { id: qid || null, bookId: null, lineIds: [], stepIds: [], orig: {}, cover: null, file: null };
  let rec = null, lines = [], steps = [];

  if (qid) {
    try {
      const rr = await sb.from("recipes").select("*").eq("id", qid).maybeSingle();
      if (rr.error) throw rr.error;
      if (!rr.data) return stop("Recette introuvable, ou vous n'avez pas accès à son carnet.");
      rec = rr.data;
      const [l, s, p] = await Promise.all([
        sb.from("recipe_ingredient_lines").select("*").eq("recipe_id", qid).order("position"),
        sb.from("recipe_steps").select("*").eq("recipe_id", qid).order("position"),
        sb.from("recipe_photos").select("*").eq("recipe_id", qid).eq("is_cover", true)
      ]);
      for (const x of [l, s, p]) if (x.error) throw x.error;
      lines = l.data || []; steps = s.data || [];
      state.cover = (p.data || [])[0] || null;
    } catch (e) { return stop(errMsg(e, "Impossible de charger la recette.")); }
    if (!editable.some((b) => b.id === rec.book_id)) return stop("Votre rôle dans ce carnet ne permet pas de modifier cette recette.");
    state.bookId = rec.book_id;
    state.lineIds = lines.map((x) => x.id); state.stepIds = steps.map((x) => x.id);
  } else {
    if (!editable.length) return stop("Vous n'avez aucun carnet où ajouter une recette (il faut y être propriétaire ou membre).");
    const pref = AR.getBookPref();
    state.bookId = (editable.find((b) => b.id === pref) || editable[0]).id;
  }
  document.title = (rec ? "Modifier la recette" : "Écrire une recette") + " · ARÔMES V&N";
  const v = (x) => (x == null ? "" : x);

  main.setAttribute("aria-busy", "false");
  main.innerHTML = `<h1 class="chapitre">${rec ? "Modifier la recette" : "Écrire une recette"}</h1><span class="filet" aria-hidden="true"></span>
    <form id="form" class="champs" novalidate>
      <label>Carnet de destination<select name="book" ${rec ? "disabled" : ""}>${editable.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("")}</select></label>
      <label>Titre<input name="title" maxlength="200" required value="${esc(v(rec && rec.title))}"></label>
      <label>Titre d'origine (facultatif)<input name="title_original" maxlength="200" value="${esc(v(rec && rec.title_original))}"></label>
      <div class="grille2">
        <label>Type de plat<select name="course"><option value="">—</option>${Object.entries(AR.COURSES).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select></label>
        <label>Cuisine<input name="cuisine" maxlength="80" placeholder="ex. italienne" value="${esc(v(rec && rec.cuisine))}"></label>
        <label>Portions<input name="servings" type="number" inputmode="numeric" min="1" max="999" value="${esc(v(rec && rec.servings))}"></label>
        <label>Difficulté<select name="difficulty"><option value="">—</option>${Object.entries(AR.DIFFICULTES).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select></label>
        <label>Temps actif (min)<input name="time_active_min" type="number" inputmode="numeric" min="0" max="9999" value="${esc(v(rec && rec.time_active_min))}"></label>
        <label>Temps total (min)<input name="time_total_min" type="number" inputmode="numeric" min="0" max="99999" value="${esc(v(rec && rec.time_total_min))}"></label>
      </div>
      <fieldset class="source-bloc">
        <legend class="etiquette">Source</legend>
        <label>Créateur ou auteur<input name="source_author" maxlength="120" placeholder="ex. @chef, Mamie" value="${esc(v(rec && rec.source_author))}"></label>
        <label>Lien<input name="source_url" type="url" inputmode="url" maxlength="500" placeholder="https://" value="${esc(v(rec && rec.source_url))}"></label>
        <button type="button" class="btn lien" id="src-clear">Retirer la source</button>
      </fieldset>
      <div>
        <span class="etiquette">Photo de couverture</span>
        <div id="photo-prev" class="apercu-photo" style="margin-top:8px" hidden><div class="passe-partout"><div class="cadre"><img id="photo-img" alt="Aperçu de la couverture"></div></div></div>
        <input type="file" name="photo" accept="image/*" aria-label="Choisir une photo de couverture">
        <p class="aide">Redimensionnée à 1600 px au plus et enregistrée en JPEG.</p>
      </div>
      <h2 class="section">Ingrédients</h2>
      <div id="lines"></div>
      <div><button type="button" class="btn sec petit" id="add-line">Ajouter un ingrédient</button></div>
      <h2 class="section">Préparation</h2>
      <div id="steps"></div>
      <div><button type="button" class="btn sec petit" id="add-step">Ajouter une étape</button></div>
      <div class="rangee" style="margin-top:28px"><button class="btn" type="submit" id="save">Enregistrer la recette</button><a class="btn sec" href="${rec ? "/recettes/fiche.html?id=" + encodeURIComponent(rec.id) : "/recettes/"}">Annuler</a></div>
      <p class="msg" id="msg" role="status" aria-live="polite"></p>
    </form>`;
  const f = $("#form"), out = $("#msg");
  f.book.value = state.bookId;
  if (rec) { f.course.value = rec.course || ""; f.difficulty.value = rec.difficulty || ""; }
  state.orig = rec ? { servings: rec.servings, time_active_min: rec.time_active_min, time_total_min: rec.time_total_min } : {};

  // ---- photo
  async function showCover() {
    if (!state.cover) return;
    const u = await AR.signedUrls([state.cover.storage_path]);
    const url = u[state.cover.storage_path];
    if (url) { $("#photo-img").src = url; $("#photo-prev").hidden = false; }
  }
  showCover();
  let blobUrl = null;
  f.photo.addEventListener("change", () => {
    const file = f.photo.files && f.photo.files[0];
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    state.file = file || null;
    if (file) { blobUrl = URL.createObjectURL(file); $("#photo-img").src = blobUrl; $("#photo-prev").hidden = false; }
  });

  // ---- lignes d'ingrédients et étapes
  const unitOpts = `<option value="">—</option>` + Object.keys(AR.UNITES).map((k) => `<option value="${k}">${esc(AR.UNITES[k])}</option>`).join("");
  function lineRow(l) {
    const d = document.createElement("div");
    d.className = "bloc"; d.dataset.kind = "line";
    d.innerHTML = `<div class="bloc-tete"><span class="libelle">Ingrédient</span><span class="rangee" style="gap:4px">${ctl("cet ingrédient")}</span></div>
      <div class="champs">
        <label>Groupe (facultatif)<input name="group_label" maxlength="80" placeholder="ex. Pour la pâte" value="${esc(v(l && l.group_label))}"></label>
        <div class="grille2"><label>Quantité<input name="quantity" inputmode="decimal" placeholder="ex. 250" value="${esc(l && l.quantity != null ? AR.fmtQty(l.quantity) : "")}"></label>
        <label>Unité<select name="unit">${unitOpts}</select></label></div>
        <label>Libellé<input name="label" maxlength="300" value="${esc(v(l && l.label_original))}"></label>
        <label>Précision (facultatif)<input name="precision" maxlength="200" placeholder="ex. à température ambiante" value="${esc(v(l && l.precision))}"></label>
        <label class="case"><input type="checkbox" name="optional"${l && l.optional ? " checked" : ""}> Facultatif</label>
      </div>`;
    d.querySelector("[name=unit]").value = (l && l.unit) || "";
    return d;
  }
  function stepRow(s) {
    const d = document.createElement("div");
    d.className = "bloc"; d.dataset.kind = "step";
    d.innerHTML = `<div class="bloc-tete"><span class="libelle" data-num>Étape</span><span class="rangee" style="gap:4px">${ctl("cette étape")}</span></div>
      <div class="champs"><label>Texte<textarea name="text" rows="3">${esc(v(s && s.text))}</textarea></label>
      <label>Minuteur en minutes (facultatif)<input name="timer" type="number" inputmode="numeric" min="0" max="9999" value="${s && s.timer_seconds ? Math.round(s.timer_seconds / 60) : ""}"></label></div>`;
    return d;
  }
  function ctl(what) {
    return `<button type="button" class="btn sec cible" data-mv="-1" aria-label="Monter ${what}">↑</button>
      <button type="button" class="btn sec cible" data-mv="1" aria-label="Descendre ${what}">↓</button>
      <button type="button" class="btn danger cible" data-rm aria-label="Supprimer ${what}">×</button>`;
  }
  function numberSteps() { $$("#steps [data-num]").forEach((e, i) => (e.textContent = `Étape ${i + 1}`)); }
  (lines.length ? lines : [null]).forEach((l) => $("#lines").append(lineRow(l)));
  (steps.length ? steps : [null]).forEach((s) => $("#steps").append(stepRow(s)));
  numberSteps();
  $("#add-line").addEventListener("click", () => { const r = lineRow(); $("#lines").append(r); r.querySelector("[name=quantity]").focus(); });
  $("#add-step").addEventListener("click", () => { const r = stepRow(); $("#steps").append(r); numberSteps(); r.querySelector("textarea").focus(); });
  f.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mv],button[data-rm]");
    if (!b) return;
    const row = b.closest(".bloc"), parent = row.parentElement;
    if (b.hasAttribute("data-rm")) { row.remove(); }
    else if (b.dataset.mv === "-1" && row.previousElementSibling) parent.insertBefore(row, row.previousElementSibling);
    else if (b.dataset.mv === "1" && row.nextElementSibling) parent.insertBefore(row.nextElementSibling, row);
    numberSteps();
    if (!b.hasAttribute("data-rm")) b.focus();
  });

  // ---- catalogue : correspondance par nom ou alias (sans casse ni accents)
  async function catalogIndex() {
    const idx = new Map();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("recipe_ingredients_catalog").select("id,name,aliases").range(from, from + 999);
      if (error) throw error;
      (data || []).forEach((c) => { idx.set(norm(c.name), c.id); (c.aliases || []).forEach((a) => { if (!idx.has(norm(a))) idx.set(norm(a), c.id); }); });
      if (!data || data.length < 1000) break;
    }
    return idx;
  }
  const lookup = (idx, label) => {
    const n = norm(label);
    return idx.get(n) || idx.get(n.replace(/s$/, "")) || idx.get(n + "s") || null;
  };

  // ---- lecture du formulaire
  const num = (x) => (x === "" || x == null ? null : Number(x));
  function read() {
    const err = [];
    const title = f.title.value.trim();
    if (!title) err.push("Indiquez le titre de la recette.");
    const ls = [];
    $$("#lines [data-kind=line]").forEach((d) => {
      const g = (n) => d.querySelector(`[name=${n}]`);
      const label = g("label").value.trim(), qraw = g("quantity").value.trim().replace(",", ".");
      const any = label || qraw || g("precision").value.trim();
      if (!any) return;
      if (!label) return err.push("Chaque ingrédient doit avoir un libellé.");
      let quantity = null;
      if (qraw) { quantity = Number(qraw); if (!isFinite(quantity) || quantity < 0) return err.push(`Quantité invalide pour « ${label} ».`); }
      ls.push({ group_label: g("group_label").value.trim() || null, quantity, unit: g("unit").value || null, label_original: label, precision: g("precision").value.trim() || null, optional: g("optional").checked });
    });
    const ss = [];
    $$("#steps [data-kind=step]").forEach((d) => {
      const text = d.querySelector("[name=text]").value.trim(), t = num(d.querySelector("[name=timer]").value);
      if (!text) return;
      ss.push({ text, timer_seconds: t ? Math.round(t * 60) : null });
    });
    ["servings", "time_active_min", "time_total_min"].forEach((k) => { const n = num(f[k].value); if (n != null && (!Number.isInteger(n) || n < (k === "servings" ? 1 : 0))) err.push("Vérifiez les portions et les temps (nombres entiers)."); });
    return { err: [...new Set(err)], title, ls, ss };
  }

  // ---- enregistrement
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { err, title, ls, ss } = read();
    if (f.source_url.value.trim() && !AR.safeUrl(f.source_url.value.trim())) err.push("Le lien de la source doit commencer par https://.");
    if (err.length) return setMsg(out, err.join(" "), "erreur");
    const btn = $("#save"); btn.disabled = true; setMsg(out, "Enregistrement…");
    try {
      const servings = num(f.servings.value), ta = num(f.time_active_min.value), tt = num(f.time_total_min.value);
      const fields = {
        title, title_original: f.title_original.value.trim() || null, course: f.course.value || null, cuisine: f.cuisine.value.trim() || null,
        servings, time_active_min: ta, time_total_min: tt, difficulty: num(f.difficulty.value),
        ...AR.sourceFields(f)
      };
      // Une valeur modifiée à la main n'est plus « estimée ».
      if (rec) {
        if (servings !== state.orig.servings) fields.servings_estimated = false;
        if (ta !== state.orig.time_active_min) fields.time_active_estimated = false;
        if (tt !== state.orig.time_total_min) fields.time_total_estimated = false;
      }
      if (!state.id) {
        state.bookId = f.book.value;
        const { data, error } = await sb.from("recipes").insert({ ...fields, book_id: state.bookId, created_by: ctx.user.id }).select("id").single();
        if (error) throw error;
        state.id = data.id;
        state.orig = { servings, time_active_min: ta, time_total_min: tt };
      } else {
        const { error } = await sb.from("recipes").update(fields).eq("id", state.id);
        if (error) throw error;
      }
      // Lignes et étapes : on insère les nouvelles avant de retirer les anciennes (aucune perte si l'insertion échoue).
      const idx = ls.length ? await catalogIndex().catch((e2) => { console.error(e2); return new Map(); }) : new Map();
      if (ls.length) {
        const { data, error } = await sb.from("recipe_ingredient_lines").insert(ls.map((l, i) => ({ ...l, recipe_id: state.id, position: i, catalog_id: lookup(idx, l.label_original) }))).select("id");
        if (error) throw error;
        await swap("lineIds", "recipe_ingredient_lines", data.map((x) => x.id));
      } else await swap("lineIds", "recipe_ingredient_lines", []);
      if (ss.length) {
        const { data, error } = await sb.from("recipe_steps").insert(ss.map((s, i) => ({ ...s, recipe_id: state.id, position: i }))).select("id");
        if (error) throw error;
        await swap("stepIds", "recipe_steps", data.map((x) => x.id));
      } else await swap("stepIds", "recipe_steps", []);
      // Photo de couverture
      if (state.file) {
        const blob = await AR.compressImage(state.file);
        const path = `${state.bookId}/${state.id}/${Date.now()}.jpg`;
        const up = await sb.storage.from("recipes").upload(path, blob, { contentType: "image/jpeg", upsert: false });
        if (up.error) throw up.error;
        const old = state.cover;
        if (old) { const u = await sb.from("recipe_photos").update({ is_cover: false }).eq("id", old.id); if (u.error) { await sb.storage.from("recipes").remove([path]); throw u.error; } }
        const ins = await sb.from("recipe_photos").insert({ recipe_id: state.id, storage_path: path, kind: "perso", is_cover: true, created_by: ctx.user.id }).select("*").single();
        if (ins.error) {
          await sb.storage.from("recipes").remove([path]);
          if (old) await sb.from("recipe_photos").update({ is_cover: true }).eq("id", old.id);
          throw ins.error;
        }
        state.cover = ins.data; state.file = null;
      }
      toast("Recette enregistrée.");
      location.assign("/recettes/fiche.html?id=" + encodeURIComponent(state.id));
    } catch (e2) {
      btn.disabled = false;
      setMsg(out, errMsg(e2, "Enregistrement impossible. Vos saisies sont conservées : réessayez."), "erreur");
    }
  });
  // Retire les anciennes lignes une fois les nouvelles insérées ; en cas d'échec, tout reste suivi pour un nouvel essai.
  async function swap(key, table, newIds) {
    const oldIds = state[key];
    state[key] = oldIds.concat(newIds);
    if (oldIds.length) {
      const { error } = await sb.from(table).delete().in("id", oldIds);
      if (error) throw error;
    }
    state[key] = newIds;
  }
})();
