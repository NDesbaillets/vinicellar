(async function () {
  const AR = window.AR, { sb, $, $$, esc, errMsg, toast, fmtDate } = AR;
  const ctx = await AR.boot("carnet");
  if (!ctx) return;
  const main = $("#main");
  const id = new URLSearchParams(location.search).get("id");
  const fail = (t) => { main.setAttribute("aria-busy", "false"); main.innerHTML = `<div class="vide-etat"><p role="alert">${esc(t)}</p><a class="btn sec petit" href="/recettes/">Retour au carnet</a></div>`; };
  if (!id) return fail("Aucune recette indiquée.");

  let r, lines = [], steps = [], notes = [], photos = [], people = {};
  try {
    const rr = await sb.from("recipes").select("*").eq("id", id).maybeSingle();
    if (rr.error) throw rr.error;
    if (!rr.data) return fail("Recette introuvable, ou vous n'avez pas accès à son carnet.");
    r = rr.data;
    const [l, s, n, p, pe] = await Promise.all([
      sb.from("recipe_ingredient_lines").select("*").eq("recipe_id", id).order("position"),
      sb.from("recipe_steps").select("*").eq("recipe_id", id).order("position"),
      sb.from("recipe_notes").select("*").eq("recipe_id", id).order("created_at"),
      sb.from("recipe_photos").select("*").eq("recipe_id", id),
      sb.rpc("book_people", { b: rr.data.book_id })
    ]);
    for (const x of [l, s, n, p]) if (x.error) throw x.error;
    lines = l.data || []; steps = s.data || []; notes = n.data || []; photos = p.data || [];
    (pe.data || []).forEach((x) => (people[x.user_id] = x.full_name || x.email || "Membre"));
  } catch (e) { return fail(errMsg(e, "Impossible de charger la recette.")); }

  const book = ctx.books.find((b) => b.id === r.book_id);
  const editor = !!book && (book.role === "owner" || book.role === "member");
  document.title = `${r.title} · ARÔMES V&N`;

  const cov = photos.find((x) => x.is_cover) || null;
  const pagePhotos = photos.filter((x) => x.kind === "page").sort((a, b) => a.storage_path.localeCompare(b.storage_path, "fr", { numeric: true }));
  const urls = await AR.signedUrls([cov && cov.storage_path, ...pagePhotos.map((x) => x.storage_path)].filter(Boolean));
  const photoUrl = cov ? urls[cov.storage_path] : null;

  // Phase 2 : doublon proposé par l'import et versions. Une erreur ici ne bloque jamais la fiche.
  const DUP_KEY = (id) => "ar.doublon." + id;
  const dismissed = (id) => { try { return localStorage.getItem(DUP_KEY(id)) === "1"; } catch { return false; } };
  let dup = null, versions = [];
  async function loadDup() {
    dup = null;
    if (!editor || r.deleted_at) return;
    try {
      const im = await sb.from("recipe_imports").select("id,duplicate_of,status,created_by").eq("recipe_id", r.id).not("duplicate_of", "is", null);
      if (im.error) throw im.error;
      const imp = (im.data || []).find((x) => x.duplicate_of && x.duplicate_of !== r.id && !dismissed(x.id));
      if (!imp) return;
      const ex = await sb.from("recipes").select("id,book_id,title,version_group,deleted_at,archived_at").eq("id", imp.duplicate_of).maybeSingle();
      if (ex.error) throw ex.error;
      if (ex.data && !ex.data.deleted_at) dup = { imp, other: ex.data };
    } catch (e) { console.error(e); }
  }
  async function loadVersions() {
    versions = [];
    if (!r.version_group) return;
    try {
      const v = await sb.from("recipes").select("id,book_id,title,source_author,source_url,archived_at,created_at,review_state")
        .eq("version_group", r.version_group).neq("id", r.id).is("deleted_at", null).order("created_at");
      if (v.error) throw v.error;
      const ids = (v.data || []).map((x) => x.id);
      let vl = [];
      if (ids.length) {
        const l = await sb.from("recipe_ingredient_lines").select("recipe_id,catalog_id,label_original,quantity,unit,precision,position").in("recipe_id", ids).order("position");
        if (l.error) throw l.error;
        vl = l.data || [];
      }
      versions = (v.data || []).map((x) => ({ ...x, lines: vl.filter((y) => y.recipe_id === x.id) }));
    } catch (e) { console.error(e); }
  }
  await Promise.all([loadDup(), loadVersions()]);
  const view = { tab: "fiche", lang: "fr" };

  const alertText = AR.alertText;
  const alerts = (Array.isArray(r.alerts) ? r.alerts : []).map(alertText).filter(Boolean);
  const hasOrig = !!(r.title_original || steps.some((s) => s.text_original));
  const safeLang = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(r.lang_original || "") ? r.lang_original : "";

  function ingHtml(l) {
    const hasQty = l.quantity != null;
    const unit = AR.fmtUnit(l.unit, l.quantity);
    const qte = hasQty
      ? `<span class="qte">${esc(AR.fmtQty(l.quantity))}${unit ? " " + esc(unit) : ""}</span>`
      : `<span class="qte inconnue">${esc(l.precision || "q.b.")}</span>`;
    const prec = hasQty && l.precision ? ` <span class="prec">(${esc(l.precision)})</span>` : "";
    const opt = l.optional ? ` <span class="prec">(facultatif)</span>` : "";
    return `<li class="ing"><span class="nom">${esc(l.label_original)}${prec}${opt}</span><span class="guide" aria-hidden="true"></span>${qte}</li>`;
  }
  function ingredients() {
    if (!lines.length) return `<p class="muted italique">Aucun ingrédient saisi.</p>`;
    const groups = [];
    lines.forEach((l) => {
      const g = (l.group_label || "").trim();
      let grp = groups[groups.length - 1];
      if (!grp || grp.g !== g) { grp = { g, items: [] }; groups.push(grp); }
      grp.items.push(l);
    });
    return groups.map((g) => `${g.g ? `<h3 class="groupe">${esc(g.g)}</h3>` : ""}<ul class="ingredients">${g.items.map(ingHtml).join("")}</ul>`).join("");
  }

  function render() {
    const me = ctx.user.id;
    const chiffres = [];
    if (r.servings != null) chiffres.push(["Portions", String(r.servings), r.servings_estimated]);
    if (r.time_active_min != null) chiffres.push(["Préparation", AR.fmtMin(r.time_active_min), r.time_active_estimated]);
    if (r.time_total_min != null) chiffres.push(["Temps total", AR.fmtMin(r.time_total_min), r.time_total_estimated]);
    if (r.difficulty) chiffres.push(["Difficulté", AR.DIFFICULTES[r.difficulty] || "", false]);
    const meta = [r.course ? AR.COURSES[r.course] : "", r.cuisine || ""].filter(Boolean).join(" · ");
    const srcUrl = AR.safeUrl(r.source_url || "");
    const source = [r.source_author ? esc(r.source_author) : "", srcUrl ? `<a href="${esc(srcUrl)}" target="_blank" rel="noopener noreferrer">${esc(AR.host(srcUrl))}</a>` : ""].filter(Boolean).join(" · ");
    const trash = r.deleted_at
      ? `<div class="bandeau" role="status"><p>Cette recette est dans la corbeille depuis le ${esc(fmtDate(r.deleted_at))}.</p>${editor ? `<button type="button" class="btn petit" data-act="restore">Restaurer</button>` : ""}</div>` : "";
    const visibles = notes;

    const orig = view.lang === "orig" && hasOrig;
    const titre = orig ? (r.title_original || r.title) : r.title;
    const verif = r.review_state === "a_verifier";
    const noteHtml = verif
      ? `<aside class="note-avant" aria-labelledby="nav-t"><h2 id="nav-t">Note avant de cuisiner</h2>
        ${alerts.length ? `<ul>${alerts.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
        <p>${r.source_type === "photo_page" ? "Comparez le texte avec la photo de la page, puis validez : la fiche n'entre au carnet qu'après relecture." : "Cette fiche a été importée : relisez-la avant de cuisiner."}</p>
        ${editor ? `<button type="button" class="btn" data-act="verify">C'est bon</button>` : ""}</aside>`
      : alerts.length ? `<details class="note-avant repliee"><summary>Note avant de cuisiner <span class="muted">(${alerts.length})</span></summary><ul>${alerts.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></details>` : "";
    const dupHtml = dup ? `<aside class="doublon" aria-labelledby="dup-t"><h2 id="dup-t">Doublon probable</h2>
      <p>Cette fiche ressemble à <a href="/recettes/fiche.html?id=${encodeURIComponent(dup.other.id)}">${esc(dup.other.title)}</a>${dup.other.archived_at ? " (archivée)" : ""}. Que faire ?</p>
      <div class="rangee"><button type="button" class="btn petit" data-act="as-version">Ranger comme version</button>
      <button type="button" class="btn sec petit" data-act="keep-apart">Garder séparée</button>
      <a class="btn sec petit" href="/recettes/fusion.html?a=${encodeURIComponent(dup.other.id)}&amp;b=${encodeURIComponent(r.id)}">Fusionner</a></div></aside>` : "";
    const tabsHtml = (versions.length || hasOrig) ? `<div class="bascules">
      ${versions.length ? `<div class="onglets" role="group" aria-label="Affichage de la fiche"><button type="button" class="onglet" data-view="fiche" aria-pressed="${view.tab === "fiche"}">Fiche</button><button type="button" class="onglet" data-view="versions" aria-pressed="${view.tab === "versions"}">Versions (${versions.length + 1})</button></div>` : ""}
      ${hasOrig && view.tab === "fiche" ? `<div class="onglets" role="group" aria-label="Langue du texte"><button type="button" class="onglet" data-lang="fr" aria-pressed="${!orig}">Traduction</button><button type="button" class="onglet" data-lang="orig" aria-pressed="${orig}">Version originale</button></div>` : ""}</div>` : "";

    const pagesHtml = r.source_type === "photo_page" && pagePhotos.some((x) => urls[x.storage_path])
      ? `<h2 class="section">Page d'origine</h2><span class="filet" aria-hidden="true"></span>
        <div class="pages-photo">${pagePhotos.filter((x) => urls[x.storage_path]).map((x, i) => `<figure><a href="${esc(urls[x.storage_path])}" target="_blank" rel="noopener noreferrer"><div class="passe-partout"><img src="${esc(urls[x.storage_path])}" alt="Photo de la page ${i + 1}" loading="lazy"></div></a><figcaption class="libelle">Page ${i + 1}</figcaption></figure>`).join("")}</div>` : "";

    const stepText = (st) => (orig ? st.text_original || st.text : st.text);
    const corps = view.tab === "versions" ? versionsHtml() : `${pagesHtml}
      <h2 class="section">Ingrédients</h2><span class="filet" aria-hidden="true"></span>
      ${ingredients()}
      <h2 class="section">Préparation</h2><span class="filet" aria-hidden="true"></span>
      ${orig ? `<p class="muted italique">Texte d'origine${safeLang ? ` (${esc(safeLang)})` : ""}. Les ingrédients restent en français.</p>` : ""}
      ${steps.length ? `<ol class="etapes">${steps.map((s, i) => `<li class="etape"><span class="num" aria-hidden="true">${i + 1}</span><div><p${orig && safeLang ? ` lang="${esc(safeLang)}"` : ""}><span class="sr-only">Étape ${i + 1}. </span>${esc(stepText(s))}</p>${s.timer_seconds ? `<span class="libelle or minuteur">Minuteur : ${esc(AR.fmtMin(Math.round(s.timer_seconds / 60)))}</span>` : ""}</div></li>`).join("")}</ol>` : `<p class="muted italique">Aucune étape saisie.</p>`}
      <h2 class="section">En marge</h2><span class="filet" aria-hidden="true"></span>
      ${visibles.length ? visibles.map((n) => `<div class="marge"><p>${esc(n.body)}</p><span class="meta">${esc(n.author_id === me ? "Vous" : people[n.author_id] || "Un membre")} · ${esc(fmtDate(n.created_at))}${n.private ? " · Privée" : ""}</span>
        ${n.author_id === me ? ` <button type="button" class="btn lien" data-del-note="${esc(n.id)}" aria-label="Supprimer cette note">Supprimer</button>` : ""}</div>`).join("") : `<p class="muted italique">Aucune note pour l'instant.</p>`}
      <form id="note-form" class="champs" novalidate style="margin-top:18px">
        <label>Ajouter une note<textarea name="body" maxlength="5000" rows="3"></textarea></label>
        <label class="case"><input type="checkbox" name="private"> Note privée (visible de vous seul)</label>
        <div><button class="btn sec" type="submit">Ajouter la note</button></div>
        <p class="msg" id="note-msg" role="status" aria-live="polite"></p>
      </form>`;

    main.setAttribute("aria-busy", "false");
    main.innerHTML = `${trash}${dupHtml}
      <p><a href="/recettes/">← Le carnet</a></p>
      <div class="fiche-photo"><div class="passe-partout"><div class="cadre">${photoUrl ? `<img src="${esc(photoUrl)}" alt="${esc(r.title)}">` : `<span class="vide">Sans photo</span>`}</div></div></div>
      ${meta ? `<p class="libelle or centre" style="margin:0 0 8px">${esc(meta)}</p>` : ""}
      <h1 class="fiche-titre"${orig && safeLang ? ` lang="${esc(safeLang)}"` : ""}>${esc(titre)}</h1>
      ${r.title_original && !orig ? `<p class="fiche-orig">${esc(r.title_original)}</p>` : ""}
      ${source ? `<p class="fiche-source">${source}</p>` : ""}
      <span class="filet" style="margin:18px auto 0" aria-hidden="true"></span>
      ${tabsHtml}
      ${chiffres.length ? `<div class="chiffres">${chiffres.map(([l, v, est]) => `<div><span class="libelle">${esc(l)}</span><span class="valeur">${esc(v)}</span>${est ? `<span class="est">estimé</span>` : ""}</div>`).join("")}</div>` : ""}
      ${r.family || editor ? `<div class="actions"><button type="button" class="btn sec ${r.family ? "actif" : ""}" id="family" aria-pressed="${r.family}" ${editor ? "" : "disabled"}>De famille</button></div>` : ""}
      ${noteHtml}
      ${corps}
      ${editor ? `<div class="actions-bas">${r.deleted_at ? "" : `<a class="btn" href="/recettes/editer.html?id=${encodeURIComponent(r.id)}">Modifier</a><button type="button" class="btn danger" data-act="trash">Mettre à la corbeille</button>`}</div>` : ""}`;
  }

  // Onglet « Versions » : les autres recettes du même groupe et leurs écarts avec cette fiche.
  function versionsHtml() {
    const item = (v) => {
      const d = AR.diffLines(lines, v.lines);
      const parts = [];
      if (d.onlyA.length) parts.push(`<li><span class="libelle">Seulement ici</span> ${d.onlyA.map((l) => esc(l.label_original)).join(", ")}</li>`);
      if (d.onlyB.length) parts.push(`<li><span class="libelle">Seulement dans cette version</span> ${d.onlyB.map((l) => esc(l.label_original)).join(", ")}</li>`);
      if (d.qty.length) parts.push(`<li><span class="libelle">Quantités différentes</span> ${d.qty.map((q) => `${esc(q.a.label_original)} : ${esc(AR.fmtLine(q.a))} ici, ${esc(AR.fmtLine(q.b))} là`).join(" ; ")}</li>`);
      const n = d.onlyA.length + d.onlyB.length + d.qty.length;
      const canMerge = editor && !v.archived_at && ctx.books.some((b) => b.id === v.book_id && (b.role === "owner" || b.role === "member"));
      const src = [v.source_author, AR.host(v.source_url || "")].filter(Boolean).join(" · ");
      return `<li class="version"><a class="version-titre" href="/recettes/fiche.html?id=${encodeURIComponent(v.id)}">${esc(v.title)}</a>
        <p class="muted italique" style="margin:0">${esc([src, fmtDate(v.created_at), v.archived_at ? "Archivée (absorbée par une fusion)" : "", v.review_state === "a_verifier" ? "À vérifier" : ""].filter(Boolean).join(" · "))}</p>
        ${n ? `<p class="libelle or" style="margin:10px 0 4px">${n} écart${n > 1 ? "s" : ""} d'ingrédients</p><ul class="ecarts">${parts.join("")}</ul>` : `<p class="muted" style="margin:10px 0 4px">Mêmes ingrédients, mêmes quantités.</p>`}
        ${canMerge ? `<a class="btn sec petit" href="/recettes/fusion.html?a=${encodeURIComponent(r.id)}&amp;b=${encodeURIComponent(v.id)}">Fusionner avec cette version</a>` : ""}</li>`;
    };
    return `<h2 class="section">Versions</h2><span class="filet" aria-hidden="true"></span>
      <p class="muted italique">Cette fiche : « ${esc(r.title)} ». Les écarts sont relevés ingrédient par ingrédient.</p>
      <ul class="versions">${versions.map(item).join("")}</ul>`;
  }
  render();

  async function patch(fields, okText) {
    const { data, error } = await sb.from("recipes").update(fields).eq("id", r.id).select("*").single();
    if (error) { toast(errMsg(error, "Modification impossible."), "erreur"); return false; }
    r = data; if (okText) toast(okText); render(); return true;
  }

  // Doublon : « Ranger comme version » réunit les deux fiches sous un même version_group ; dans les deux cas la suggestion est écartée.
  async function dismissDup() {
    const id = dup.imp.id;
    try { localStorage.setItem(DUP_KEY(id), "1"); } catch { /* stockage indisponible */ }
    // Le back-end ne laisse en principe pas le client modifier l'import : on essaie, sans en dépendre.
    const u = await sb.from("recipe_imports").update({ duplicate_of: null }).eq("id", id);
    if (u.error) await sb.from("recipe_imports").delete().eq("id", id).in("status", ["termine", "echec"]);
    dup = null;
  }
  async function resolveDup(btn) {
    const other = dup.other;
    $$("[data-act]", main).forEach((x) => { x.disabled = true; });
    try {
      if (btn.dataset.act === "as-version") {
        const g = other.version_group || r.version_group || AR.uuid();
        if (r.version_group && r.version_group !== g) {
          const m = await sb.from("recipes").update({ version_group: g }).eq("version_group", r.version_group);
          if (m.error) throw m.error;
        }
        if (other.version_group !== g) { const u = await sb.from("recipes").update({ version_group: g }).eq("id", other.id); if (u.error) throw u.error; }
        if (r.version_group !== g) { const u = await sb.from("recipes").update({ version_group: g }).eq("id", r.id); if (u.error) throw u.error; }
        r.version_group = g;
        await dismissDup(); await loadVersions();
        toast("Rangée comme version de « " + other.title + " ».");
      } else { await dismissDup(); toast("Les deux fiches restent séparées."); }
    } catch (err) { toast(errMsg(err, "Action impossible."), "erreur"); }
    render();
  }

  main.addEventListener("click", async (e) => {
    const fam = e.target.closest("#family");
    if (fam && editor) return void patch({ family: !r.family }, r.family ? "Retirée de « De famille »." : "Ajoutée à « De famille ».");
    const del = e.target.closest("[data-del-note]");
    if (del) {
      del.disabled = true;
      const { error } = await sb.from("recipe_notes").delete().eq("id", del.dataset.delNote);
      if (error) { del.disabled = false; return toast(errMsg(error, "Suppression impossible."), "erreur"); }
      notes = notes.filter((n) => n.id !== del.dataset.delNote); render(); return toast("Note supprimée.");
    }
    const vw = e.target.closest("[data-view]");
    if (vw) { view.tab = vw.dataset.view; render(); const n = $(`[data-view="${view.tab}"]`); if (n) n.focus(); return; }
    const lg = e.target.closest("[data-lang]");
    if (lg) { view.lang = lg.dataset.lang; render(); const n = $(`[data-lang="${view.lang}"]`); if (n) n.focus(); return; }
    const b = e.target.closest("button[data-act]");
    if (!b || !editor) return;
    if (b.dataset.act === "as-version" || b.dataset.act === "keep-apart") return void resolveDup(b);
    if (b.dataset.act === "verify") return void patch({ review_state: "valide" }, "Fiche validée. Les alertes restent consultables.");
    if (b.dataset.act === "restore") return void patch({ deleted_at: null }, "Recette restaurée.");
    if (b.dataset.act === "trash") {
      if (!confirm("Mettre cette recette à la corbeille ? Vous pourrez la restaurer pendant 30 jours.")) return;
      b.disabled = true;
      const ok = await patch({ deleted_at: new Date().toISOString() });
      if (ok) { toast("Recette mise à la corbeille."); setTimeout(() => location.assign("/recettes/"), 700); } else b.disabled = false;
    }
  });

  main.addEventListener("submit", async (e) => {
    if (e.target.id !== "note-form") return;
    e.preventDefault();
    const f = e.target, out = $("#note-msg"), body = f.body.value.trim();
    if (!body) return AR.setMsg(out, "Écrivez une note avant de l'ajouter.", "erreur");
    const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
    const { data, error } = await sb.from("recipe_notes").insert({ recipe_id: r.id, body, private: f.private.checked }).select("*").single();
    if (error) { btn.disabled = false; return AR.setMsg(out, errMsg(error, "Impossible d'ajouter la note."), "erreur"); }
    notes.push(data); render(); toast("Note ajoutée.");
  });
})();
