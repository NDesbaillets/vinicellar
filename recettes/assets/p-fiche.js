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
    for (const x of [l, s, p]) if (x.error) throw x.error;
    if (n.error) console.error(n.error); // les notes ne bloquent pas l'affichage (hors ligne, par exemple)
    lines = l.data || []; steps = s.data || []; notes = n.error ? [] : n.data || []; photos = p.data || [];
    (pe.data || []).forEach((x) => (people[x.user_id] = x.full_name || x.email || "Membre"));
  } catch (e) { return fail(errMsg(e, "Impossible de charger la recette.")); }

  const book = ctx.books.find((b) => b.id === r.book_id);
  const editor = !!book && (book.role === "owner" || book.role === "member");
  document.title = `${r.title} · ARÔMES V&N`;

  const pagePhotos = () => photos.filter((x) => x.kind === "page").sort((a, b) => a.storage_path.localeCompare(b.storage_path, "fr", { numeric: true }));
  let urls = {};
  async function loadUrls() { Object.assign(urls, await AR.signedUrls(photos.map((x) => x.storage_path).filter(Boolean))); }
  await loadUrls();

  // Phase 3 : journal des cuissons et statut dérivé. Une erreur ici (migration non appliquée, hors ligne) ne bloque jamais la fiche.
  let cooks = [], stat = null, cooksOk = true;
  const byDate = (a, b) => String(b.cooked_on).localeCompare(String(a.cooked_on)) || String(b.created_at).localeCompare(String(a.created_at));
  async function loadStatus() {
    try { const s = await sb.from("recipe_status").select("*").eq("recipe_id", id).maybeSingle(); stat = s.error ? null : s.data; } catch { stat = null; }
  }
  async function loadCooks() {
    try {
      const c = await sb.from("recipe_cooks").select("*").eq("recipe_id", id).order("cooked_on", { ascending: false });
      if (c.error) throw c.error;
      cooks = (c.data || []).slice().sort(byDate); cooksOk = true;
    } catch (e) { console.error(e); cooks = []; cooksOk = false; }
    await loadStatus();
  }
  await loadCooks();
  // Phase 7 : « Cuisiné pour Marie, Paul (12.03.2026) » (vue recipe_served_to, contrat 07). Une erreur ici ne bloque jamais la fiche.
  // Confidentialité : ces mentions restent dans le carnet ; la page publique, le livre et l'export ne les lisent pas.
  let servedTo = [];
  async function loadServed() {
    try {
      const sv = await sb.from("recipe_served_to").select("guest_id,guest_name,day,reception_id").eq("recipe_id", id).order("day", { ascending: false });
      if (sv.error) throw sv.error;
      servedTo = sv.data || [];
    } catch (e) { console.error(e); servedTo = []; }
  }
  await loadServed();
  function servedHtml() {
    if (!servedTo.length) return "";
    const by = new Map();
    servedTo.forEach((x) => { const k = x.reception_id || String(x.day); if (!by.has(k)) by.set(k, { day: String(x.day).slice(0, 10), guests: new Map() }); by.get(k).guests.set(x.guest_id, x.guest_name); });
    const rows = [...by.values()].sort((a, b) => b.day.localeCompare(a.day));
    return `<h3 class="jr-titre">Pour des invités</h3><ul class="jr-invites">${rows.map((r) => `<li>Cuisiné pour ${[...r.guests].map(([gid, n]) => `<a href="/recettes/invite.html?id=${encodeURIComponent(gid)}">${esc(n)}</a>`).join(", ")} <span class="muted">(${esc(AR.fmtDay(r.day))})</span></li>`).join("")}</ul>`;
  }
  // Statut : la vue recipe_status fait foi ; à défaut, on le déduit du journal chargé.
  function statusInfo() {
    if (stat) return { count: stat.cook_count, last: stat.last_cooked_on, avg: stat.avg_rating, cooked: stat.status === "cuisinee" };
    const rated = cooks.filter((c) => c.rating != null);
    return { count: cooks.length, last: cooks.length ? cooks[0].cooked_on : null, avg: rated.length ? Math.round(rated.reduce((a, c) => a + c.rating, 0) / rated.length * 10) / 10 : null, cooked: cooks.length > 0 };
  }

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
  // Recette transmise : lien vers l'original tant que l'on y a accès (sinon rien).
  let origin = null;
  async function loadOrigin() {
    if (!r.transmitted_from) return;
    try { const o = await sb.from("recipes").select("id,title,deleted_at").eq("id", r.transmitted_from).maybeSingle(); if (!o.error && o.data && !o.data.deleted_at) origin = o.data; } catch { /* sans accès : masqué */ }
  }
  await Promise.all([loadDup(), loadVersions(), loadOrigin()]);
  const view = { tab: "fiche", lang: "fr", portions: null };
  const qs = new URLSearchParams(location.search);
  if (+qs.get("p") > 0) view.portions = Math.min(99, Math.round(+qs.get("p")));
  const jr = { open: qs.get("journal") === "1", editing: null, rating: null, busy: false };
  const studioBusy = { on: false };
  const wanted = () => (r.servings != null ? (view.portions || r.servings) : null);
  const factor = () => (r.servings != null ? AR.portionFactor(wanted(), r.servings) : 1);

  const alertText = AR.alertText;
  const alerts = (Array.isArray(r.alerts) ? r.alerts : []).map(alertText).filter(Boolean);
  const hasOrig = !!(r.title_original || steps.some((s) => s.text_original));
  const safeLang = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(r.lang_original || "") ? r.lang_original : "";

  function ingHtml(l) {
    const hasQty = l.quantity != null;
    const sc = AR.scaleQty(l.quantity, l.unit, l.precision, factor());
    const qte = hasQty
      ? `<span class="qte${sc.changed ? " ajustee" : ""}">${esc(sc.text)}</span>`
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


  const cuisineHref = () => `/recettes/cuisine.html?id=${encodeURIComponent(r.id)}${r.servings != null && view.portions ? "&p=" + view.portions : ""}`;
  const KIND = { origine: "Origine", perso: "Personnelle", cuisson: "Cuisson", studio: "Studio", illustration: "Illustration", page: "Page" };
  const who = (uid) => (uid === ctx.user.id ? "Vous" : people[uid] || "Un membre");

  // ---- statut dérivé (À essayer / Cuisinée, plus De famille)
  function statutHtml() {
    const st = statusInfo();
    const bits = cooksOk || stat ? [`<span class="libelle or">${st.cooked ? "Cuisinée" : "À essayer"}</span>`] : []; // sans le journal (hors ligne), on n'affirme rien
    if (!bits.length && !r.family) return "";
    if (r.family) bits.push(`<span class="libelle or">De famille</span>`);
    const det = [];
    if (st.count) det.push(`${st.count} fois`);
    if (st.last) det.push(`dernière le ${fmtDate_(st.last)}`);
    if (st.avg != null) det.push(`note moyenne ${String(st.avg).replace(".", ",")} / 5`);
    return `<p class="statut-ligne">${bits.join('<span aria-hidden="true">&nbsp;·&nbsp;</span>')}${det.length ? `<span class="muted"> — ${esc(det.join(" · "))}</span>` : ""}</p>`;
  }
  const fmtDate_ = (d) => AR.fmtDay(d);

  // ---- portions
  function portionsHtml() {
    if (r.servings == null) {
      return editor && !r.deleted_at
        ? `<form id="po-form" class="po po-vide" novalidate><label for="po-n">Indiquez le nombre de portions</label><div class="po-saisie"><input id="po-n" name="n" type="number" inputmode="numeric" min="1" max="99" step="1" autocomplete="off"><button class="btn" type="submit">Enregistrer</button></div><p class="aide">Les quantités pourront alors être ajustées au nombre de convives.</p><p class="msg" id="po-msg" role="status" aria-live="polite"></p></form>`
        : `<p class="muted italique">Nombre de portions non indiqué : les quantités ne peuvent pas être ajustées.</p>`;
    }
    const w = wanted(), diff = w !== r.servings;
    return `<div class="po"><span class="libelle" id="po-lib">Portions</span><div class="po-ctrl" role="group" aria-labelledby="po-lib">
      <button type="button" class="po-b" data-po="-1" aria-label="Une portion de moins"${w <= 1 ? " disabled" : ""}>−</button>
      <output class="po-val" id="po-val" aria-live="polite">${w}</output>
      <button type="button" class="po-b" data-po="1" aria-label="Une portion de plus"${w >= 99 ? " disabled" : ""}>+</button></div>
      ${diff ? `<p class="po-note">Recette prévue pour ${r.servings}. <button type="button" class="btn lien" data-po="reset">Revenir à ${r.servings}</button></p>` : ""}</div>`;
  }
  const mountOutils = () => { if (window.ARFicheOutils) window.ARFicheOutils.mount({ ctx, r: () => r, lines: () => lines, wanted, editor, member: !!book }); };
  function refreshPortions(focusKey) {
    const pz = $("#po-zone"), iz = $("#ing-zone"); if (!pz || !iz) return;
    pz.innerHTML = portionsHtml();
    iz.innerHTML = ingredients();
    const g = $("#go-cuisine"); if (g) g.href = cuisineHref();
    mountOutils();
    if (focusKey) { const b = $(`[data-po="${focusKey}"]`, main) || $(".po-b:not([disabled])", main); if (b) b.focus(); }
  }

  // ---- galerie
  function galleryHtml() {
    const none = !photos.length;
    const sorted = photos.slice().sort((a, b) => (b.is_cover ? 1 : 0) - (a.is_cover ? 1 : 0) || String(a.created_at).localeCompare(String(b.created_at)));
    let h = "";
    if (none && !editor) return "";
    h += `<h2 class="section">Galerie</h2><span class="filet" aria-hidden="true"></span>`;
    if (studioBusy.on) h += `<p class="ga-attente" role="status"><span class="imp-point" aria-hidden="true"></span>Création en cours, de 10 à 40 secondes. Ne quittez pas la page.</p>`;
    if (none) {
      h += `<p class="muted italique">Cette recette n'a pas encore de photo.</p>`;
      if (!r.deleted_at) h += `<p><button type="button" class="btn sec" data-ga="illustration"${studioBusy.on ? " disabled" : ""}>Créer une illustration</button></p><p class="aide">Une image générée à partir du titre et des ingrédients, signalée comme « illustration ».</p>`;
    } else {
      h += `<ul class="ga-liste">${sorted.map((x) => {
        const u = urls[x.storage_path], k = KIND[x.kind] || x.kind;
        const act = editor && !r.deleted_at ? `<div class="ga-act">
          ${x.is_cover ? "" : `<button type="button" class="btn sec petit" data-ga="cover" data-id="${esc(x.id)}"${studioBusy.on ? " disabled" : ""}>Choisir comme couverture</button>`}
          ${x.kind === "perso" || x.kind === "cuisson" ? `<button type="button" class="btn sec petit" data-ga="studio" data-id="${esc(x.id)}"${studioBusy.on ? " disabled" : ""}>Photo studio</button>` : ""}</div>` : "";
        return `<li class="ga-item"><figure class="ga-fig">${u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer"><div class="passe-partout"><div class="cadre"><img src="${esc(u)}" crossorigin="anonymous" alt="${esc(`Photo (${k.toLowerCase()}) de ${r.title}`)}" loading="lazy"></div></div></a>` : `<div class="passe-partout"><div class="cadre"><span class="vide">Photo indisponible</span></div></div>`}
          <figcaption class="ga-leg"><span class="libelle">${esc(k)}</span>${x.is_cover ? `<span class="libelle or"> · Couverture</span>` : ""}${x.kind === "illustration" ? `<span class="ga-mention">illustration</span>` : ""}</figcaption></figure>${act}</li>`;
      }).join("")}</ul>`;
    }
    return h + `<p class="msg" id="ga-msg" role="alert"></p>`;
  }

  // ---- journal
  function cookForm() {
    const e = jr.editing ? cooks.find((c) => c.id === jr.editing) : null;
    const date = e ? AR.fmtDay(e.cooked_on) : AR.fmtDay(AR.todayIso());
    const conv = e ? (e.servings || "") : (r.servings != null ? wanted() : "");
    return `<form id="cook-form" class="jr-form champs" novalidate>
      <h3 class="jr-titre">${e ? "Modifier la cuisson" : "Je l'ai cuisinée"}</h3>
      <label for="ck-date">Date (JJ.MM.AAAA)<input id="ck-date" name="date" inputmode="numeric" placeholder="JJ.MM.AAAA" autocomplete="off" value="${esc(date)}"></label>
      <fieldset><legend class="etiquette" id="ck-note-l">Note sur 5 (facultative)</legend>
        <div class="jr-notes" role="group" aria-labelledby="ck-note-l">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="jr-n" data-rate="${n}" aria-pressed="${jr.rating === n}" aria-label="${n} sur 5">${n}</button>`).join("")}</div></fieldset>
      <label for="ck-conv">Nombre de convives<input id="ck-conv" name="servings" type="number" inputmode="numeric" min="1" max="99" step="1" value="${esc(conv)}"></label>
      <label for="ck-com">Commentaire<textarea id="ck-com" name="comment" maxlength="2000" rows="3">${esc(e ? e.comment || "" : "")}</textarea></label>
      ${e ? "" : `<label for="ck-photo">Photo (facultative)<input id="ck-photo" name="photo" type="file" accept="image/*"></label>`}
      <div class="rangee"><button class="btn" type="submit">Enregistrer</button><button type="button" class="btn sec" data-cook="cancel">Annuler</button></div>
      <p class="msg" id="ck-msg" role="status" aria-live="polite"></p></form>`;
  }
  function journalHtml() {
    const st = statusInfo();
    const items = cooks.map((c) => {
      const mine = c.cooked_by === ctx.user.id;
      const u = c.photo_path ? urls[c.photo_path] : null;
      return `<li class="jr-item"><div class="jr-tete"><span class="jr-date">${esc(AR.fmtDay(c.cooked_on))}</span><span class="jr-qui">${esc(who(c.cooked_by))}</span></div>
        <p class="jr-meta">${c.rating != null ? `<span class="jr-rate">${c.rating} / 5</span>` : ""}${c.servings ? `<span>pour ${c.servings} convive${c.servings > 1 ? "s" : ""}</span>` : ""}</p>
        ${c.comment ? `<p class="jr-com">${esc(c.comment)}</p>` : ""}
        ${u ? `<a class="jr-photo" href="${esc(u)}" target="_blank" rel="noopener noreferrer"><img src="${esc(u)}" crossorigin="anonymous" alt="Photo de la cuisson du ${esc(AR.fmtDay(c.cooked_on))}" loading="lazy"></a>` : ""}
        ${mine ? `<div class="rangee"><button type="button" class="btn lien" data-cook="edit" data-id="${esc(c.id)}">Modifier</button><button type="button" class="btn lien" data-cook="del" data-id="${esc(c.id)}">Supprimer</button></div>` : ""}</li>`;
    }).join("");
    return `<h2 class="section" id="journal">Journal</h2><span class="filet" aria-hidden="true"></span>
      ${cooksOk ? "" : `<p class="msg erreur" role="alert">Le journal n'est pas disponible pour le moment.</p>`}
      <p class="jr-resume"${cooksOk ? "" : " hidden"}><span class="libelle or">${st.cooked ? "Cuisinée" : "À essayer"}</span>${r.family ? ` <span class="libelle or">· De famille</span>` : ""}${st.count ? `<span class="muted"> · ${st.count} fois${st.avg != null ? `, note moyenne ${esc(String(st.avg).replace(".", ","))} / 5` : ""}</span>` : ""}</p>
      ${jr.open ? cookForm() : (!r.deleted_at && cooksOk ? `<p><button type="button" class="btn" data-cook="open">Je l'ai cuisinée</button></p>` : "")}
      ${cooks.length ? `<ul class="jr-liste">${items}</ul>` : (cooksOk && !servedTo.length ? `<p class="muted italique">Personne n'a encore cuisiné cette recette.</p>` : "")}
      ${servedHtml()}`;
  }
  const renderJournal = () => { const j = $("#journal-zone"), z = $("#statut-zone"); if (j) j.innerHTML = journalHtml(); if (z) z.innerHTML = statutHtml(); };
  const renderGallery = () => { const g = $("#galerie-zone"); if (g) g.innerHTML = galleryHtml(); };

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

    const pp = pagePhotos();
    const cov = photos.find((x) => x.is_cover) || null;
    const photoUrl = cov ? urls[cov.storage_path] : null;
    const pagesHtml = r.source_type === "photo_page" && pp.some((x) => urls[x.storage_path])
      ? `<h2 class="section">Page d'origine</h2><span class="filet" aria-hidden="true"></span>
        <div class="pages-photo">${pp.filter((x) => urls[x.storage_path]).map((x, i) => `<figure><a href="${esc(urls[x.storage_path])}" target="_blank" rel="noopener noreferrer"><div class="passe-partout"><img src="${esc(urls[x.storage_path])}" alt="Photo de la page ${i + 1}" loading="lazy"></div></a><figcaption class="libelle">Page ${i + 1}</figcaption></figure>`).join("")}</div>` : "";

    const stepText = (st) => (orig ? st.text_original || st.text : st.text);
    const corps = view.tab === "versions" ? versionsHtml() : `${pagesHtml}
      <h2 class="section">Ingrédients</h2><span class="filet" aria-hidden="true"></span>
      <div id="po-zone">${portionsHtml()}</div>
      <div id="ing-zone">${ingredients()}</div>
      <h2 class="section">Préparation</h2><span class="filet" aria-hidden="true"></span>
      ${orig ? `<p class="muted italique">Texte d'origine${safeLang ? ` (${esc(safeLang)})` : ""}. Les ingrédients restent en français.</p>` : ""}
      ${steps.length ? `<ol class="etapes">${steps.map((s, i) => `<li class="etape"><span class="num" aria-hidden="true">${i + 1}</span><div><p${orig && safeLang ? ` lang="${esc(safeLang)}"` : ""}><span class="sr-only">Étape ${i + 1}. </span>${esc(stepText(s))}</p>${s.timer_seconds ? `<span class="libelle or minuteur">Minuteur : ${esc(AR.fmtMin(Math.round(s.timer_seconds / 60)))}</span>` : ""}</div></li>`).join("")}</ol>` : `<p class="muted italique">Aucune étape saisie.</p>`}
      <div id="galerie-zone">${galleryHtml()}</div>
      <div id="journal-zone">${journalHtml()}</div>
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
      <div class="fiche-photo"><div class="passe-partout"><div class="cadre">${photoUrl ? `<img src="${esc(photoUrl)}" crossorigin="anonymous" alt="${esc(r.title)}">` : `<span class="vide">Sans photo</span>`}</div></div>${cov && cov.kind === "illustration" ? `<p class="ga-mention">illustration</p>` : ""}</div>
      ${meta ? `<p class="libelle or centre" style="margin:0 0 8px">${esc(meta)}</p>` : ""}
      <h1 class="fiche-titre"${orig && safeLang ? ` lang="${esc(safeLang)}"` : ""}>${esc(titre)}</h1>
      ${r.title_original && !orig ? `<p class="fiche-orig">${esc(r.title_original)}</p>` : ""}
      ${source ? `<p class="fiche-source">${source}</p>` : ""}
      ${origin ? `<p class="fiche-source">Transmise depuis <a href="/recettes/fiche.html?id=${encodeURIComponent(origin.id)}">${esc(origin.title)}</a></p>` : ""}
      <div id="statut-zone">${statutHtml()}</div>
      <span class="filet" style="margin:18px auto 0" aria-hidden="true"></span>
      ${tabsHtml}
      ${chiffres.length ? `<div class="chiffres">${chiffres.map(([l, v, est]) => `<div><span class="libelle">${esc(l)}</span><span class="valeur">${esc(v)}</span>${est ? `<span class="est">estimé</span>` : ""}</div>`).join("")}</div>` : ""}
      <div class="actions">${r.family || editor ? `<button type="button" class="btn sec ${r.family ? "actif" : ""}" id="family" aria-pressed="${r.family}" ${editor ? "" : "disabled"}>De famille</button>` : ""}
        ${steps.length && !r.deleted_at ? `<a class="btn" id="go-cuisine" href="${esc(cuisineHref())}">Mode cuisine</a>` : ""}
        ${!r.deleted_at ? `<button type="button" class="btn sec" data-cook="open">Je l'ai cuisinée</button>` : ""}</div>
      <div id="outils-zone" class="fo-zone"></div>
      ${noteHtml}
      ${corps}
      ${editor ? `<div class="actions-bas">${r.deleted_at ? "" : `<a class="btn" href="/recettes/editer.html?id=${encodeURIComponent(r.id)}">Modifier</a><button type="button" class="btn danger" data-act="trash">Mettre à la corbeille</button>`}</div>` : ""}`;
    mountOutils();
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
    // Seul chemin autorisé : la fonction SQL recipe_dismiss_duplicate (aucun droit d'update direct sur recipe_imports).
    // Le drapeau local ne sert que de repli si l'appel échoue (réseau, fonction absente).
    const { error } = await sb.rpc("recipe_dismiss_duplicate", { p_import: id });
    if (error) {
      console.error(error);
      try { localStorage.setItem(DUP_KEY(id), "1"); } catch { /* stockage indisponible */ }
    }
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

  // ---- phase 3 : portions, galerie, journal
  async function fnMessage(error) {
    try {
      const res = error && error.context;
      if (res && typeof res.json === "function") { const j = await res.json(); if (j && j.message) return String(j.message); }
    } catch { /* corps illisible */ }
    return errMsg(error, "L'image n'a pas pu être créée. Réessayez dans un instant.");
  }
  async function studio(mode, photoId) {
    if (studioBusy.on) return;
    studioBusy.on = true; renderGallery();
    let msg = "";
    try {
      const { data, error } = await sb.functions.invoke("recipe-studio", { body: { recipe_id: r.id, mode, photo_id: photoId || null } });
      if (error) throw error;
      if (!data || !data.photo_id) throw new Error("Réponse inattendue du service.");
      const p = await sb.from("recipe_photos").select("*").eq("recipe_id", r.id);
      if (!p.error) photos = p.data || [];
      await loadUrls();
      toast(mode === "studio" ? "Photo studio ajoutée à la galerie." : "Illustration ajoutée à la galerie.");
    } catch (e) { msg = await fnMessage(e); }
    studioBusy.on = false;
    render();
    if (msg) { const m = $("#ga-msg"); if (m) m.textContent = msg; toast(msg, "erreur"); const g = $("#galerie-zone"); if (g) g.scrollIntoView({ block: "center" }); }
  }
  async function setCover(photoId) {
    const target = photos.find((x) => x.id === photoId); if (!target) return;
    const old = photos.find((x) => x.is_cover);
    if (old) { const u = await sb.from("recipe_photos").update({ is_cover: false }).eq("id", old.id); if (u.error) return toast(errMsg(u.error, "Changement de couverture impossible."), "erreur"); }
    const n = await sb.from("recipe_photos").update({ is_cover: true }).eq("id", photoId);
    if (n.error) {
      if (old) await sb.from("recipe_photos").update({ is_cover: true }).eq("id", old.id);
      return toast(errMsg(n.error, "Changement de couverture impossible."), "erreur");
    }
    photos.forEach((x) => { x.is_cover = x.id === photoId; });
    render(); toast("Couverture modifiée.");
  }

  async function submitCook(f) {
    const out = $("#ck-msg"), btn = f.querySelector("button[type=submit]");
    const day = AR.parseDay(f.date.value);
    if (!day) return AR.setMsg(out, "Date invalide : écrivez-la au format JJ.MM.AAAA.", "erreur");
    if (day > AR.todayIso()) return AR.setMsg(out, "La date ne peut pas être dans le futur.", "erreur");
    const conv = f.servings.value.trim() === "" ? null : Number(f.servings.value);
    if (conv != null && (!Number.isInteger(conv) || conv < 1 || conv > 99)) return AR.setMsg(out, "Le nombre de convives doit être un entier entre 1 et 99.", "erreur");
    const comment = f.comment.value.trim();
    if (comment.length > 2000) return AR.setMsg(out, "Le commentaire est limité à 2000 caractères.", "erreur");
    btn.disabled = true; AR.setMsg(out, "Enregistrement…");
    try {
      if (jr.editing) {
        const u = await sb.from("recipe_cooks").update({ cooked_on: day, rating: jr.rating, comment: comment || null, servings: conv }).eq("id", jr.editing).select("*").single();
        if (u.error) throw u.error;
        cooks = cooks.map((c) => (c.id === jr.editing ? u.data : c)).sort(byDate);
      } else {
        let photo_path = null;
        const file = f.photo && f.photo.files[0];
        if (file) {
          const blob = await AR.compressImage(file, 1600);
          photo_path = `${r.book_id}/${r.id}/cuissons/${Date.now()}-${AR.uuid().slice(0, 8)}.jpg`;
          const up = await sb.storage.from("recipes").upload(photo_path, blob, { contentType: "image/jpeg", upsert: false });
          if (up.error) throw up.error;
          const ph = await sb.from("recipe_photos").insert({ recipe_id: r.id, storage_path: photo_path, kind: "cuisson", is_cover: false, created_by: ctx.user.id }).select("*").single();
          if (ph.error) { sb.storage.from("recipes").remove([photo_path]).catch(() => {}); throw ph.error; }
          photos.push(ph.data); await loadUrls();
        }
        const ins = await sb.from("recipe_cooks").insert({ id: AR.uuid(), recipe_id: r.id, cooked_by: ctx.user.id, cooked_on: day, rating: jr.rating, comment: comment || null, servings: conv, photo_path }).select("*").single();
        if (ins.error) throw ins.error;
        cooks = [ins.data, ...cooks].sort(byDate);
      }
      const wasEdit = !!jr.editing;
      jr.open = false; jr.editing = null; jr.rating = null;
      await loadStatus();
      renderJournal(); renderGallery();
      toast(wasEdit ? "Cuisson modifiée." : "Cuisson ajoutée au journal.");
    } catch (e) { btn.disabled = false; AR.setMsg(out, errMsg(e, "Impossible d'enregistrer la cuisson."), "erreur"); }
  }

  function openForm(editId) {
    if (view.tab !== "fiche") { view.tab = "fiche"; render(); }
    const c = editId ? cooks.find((x) => x.id === editId) : null;
    jr.open = true; jr.editing = c ? c.id : null; jr.rating = c ? c.rating : null; renderJournal();
    const f = $("#cook-form"); if (f) { f.scrollIntoView({ block: "center" }); f.date.focus({ preventScroll: true }); }
  }
  main.addEventListener("click", async (e) => {
    const po = e.target.closest("[data-po]");
    if (po && r.servings != null) {
      const k = po.dataset.po, cur = wanted();
      view.portions = k === "reset" ? null : Math.max(1, Math.min(99, cur + Number(k)));
      return void refreshPortions(k === "reset" ? "1" : k);
    }
    const ga = e.target.closest("[data-ga]");
    if (ga && editor) {
      if (ga.dataset.ga === "cover") return void setCover(ga.dataset.id);
      if (ga.dataset.ga === "studio") return void studio("studio", ga.dataset.id);
      if (ga.dataset.ga === "illustration") return void studio("illustration", null);
    }
    const rt = e.target.closest("[data-rate]");
    if (rt) {
      const n = Number(rt.dataset.rate); jr.rating = jr.rating === n ? null : n;
      $$("[data-rate]", main).forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.rate) === jr.rating)));
      return;
    }
    const ck = e.target.closest("[data-cook]");
    if (!ck) return;
    const act = ck.dataset.cook;
    if (act === "open") openForm(null);
    else if (act === "edit") openForm(ck.dataset.id);
    else if (act === "cancel") { jr.open = false; jr.editing = null; jr.rating = null; renderJournal(); }
    else if (act === "del") {
      if (!confirm("Supprimer cette cuisson du journal ?")) return;
      ck.disabled = true;
      const { error } = await sb.from("recipe_cooks").delete().eq("id", ck.dataset.id);
      if (error) { ck.disabled = false; return toast(errMsg(error, "Suppression impossible."), "erreur"); }
      cooks = cooks.filter((c) => c.id !== ck.dataset.id);
      await loadStatus(); renderJournal(); toast("Cuisson supprimée.");
    }
  });
  main.addEventListener("submit", async (e) => {
    if (e.target.id === "cook-form") { e.preventDefault(); return void submitCook(e.target); }
    if (e.target.id === "po-form") {
      e.preventDefault();
      const f = e.target, n = Number(f.n.value), out = $("#po-msg");
      if (!Number.isInteger(n) || n < 1 || n > 99) return AR.setMsg(out, "Indiquez un nombre entier de portions, de 1 à 99.", "erreur");
      const b = f.querySelector("button[type=submit]"); b.disabled = true;
      const ok = await patch({ servings: n }, "Nombre de portions enregistré.");
      if (!ok) b.disabled = false;
    }
  });
  // Arrivée depuis le mode cuisine (« Terminé ») : le formulaire de cuisson s'ouvre directement.
  if (jr.open) setTimeout(() => { const f = $("#cook-form"); if (f) f.scrollIntoView({ block: "center" }); }, 50);
})();
