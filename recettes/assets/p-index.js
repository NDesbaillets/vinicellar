(async function () {
  const AR = window.AR, { sb, $, $$, esc, norm, errMsg, setMsg, toast } = AR;
  const ctx = await AR.boot("carnet");
  if (!ctx) return;
  let books = ctx.books;
  const TYPE_KEY = "ar.type";
  const st = { statut: "toutes", course: "", cat: "", q: "", book: AR.getBookPref(), mode: "mots", type: (() => { const q = new URLSearchParams(location.search).get("type"); try { const v = ["recettes", "astuces", "menus"].includes(q) ? q : localStorage.getItem(TYPE_KEY); return v === "astuces" || v === "menus" ? v : "recettes"; } catch { return "recettes"; } })() };
  const msg = $("#msg"), liste = $("#liste");

  // ---- sélecteurs
  $("#course").insertAdjacentHTML("beforeend", Object.entries(AR.COURSES).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join(""));
  $("#cat").insertAdjacentHTML("beforeend", Object.entries(AR.TIP_CATS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join(""));
  function fillBooks() {
    if (st.book !== "all" && !books.some((b) => b.id === st.book)) st.book = "all";
    $("#book").innerHTML = `<option value="all">Tous</option>` + books.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("");
    $("#book").value = st.book;
  }
  fillBooks();

  // ---- invitations en attente
  async function loadInvites() {
    const box = $("#invites");
    const { data, error } = await sb.rpc("my_book_invites");
    if (error) { box.innerHTML = ""; toast(errMsg(error, "Impossible de lire vos invitations."), "erreur"); return; }
    box.innerHTML = (data || []).map((i) => `<div class="bandeau" data-id="${esc(i.id)}" role="group" aria-label="Invitation">
      <p><strong>${esc(i.invited_by_name || "Quelqu'un")}</strong> vous invite dans le carnet « ${esc(i.book_name)} »${i.role === "reader" ? " (lecture seule)" : ""}.</p>
      <div class="rangee"><button type="button" class="btn petit" data-act="accept">Accepter</button><button type="button" class="btn sec petit" data-act="decline">Refuser</button></div></div>`).join("");
  }
  $("#invites").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const id = b.closest("[data-id]").dataset.id;
    $$("#invites button").forEach((x) => (x.disabled = true));
    try {
      if (b.dataset.act === "accept") {
        const { error } = await sb.rpc("accept_book_invite", { p_invite: id });
        if (error) throw error;
        toast("Invitation acceptée. Le carnet est ajouté.");
        books = await AR.loadBooks(ctx.user.id); fillBooks();
      } else {
        const { error } = await sb.rpc("decline_book_invite", { p_invite: id });
        if (error) throw error;
        toast("Invitation refusée.");
      }
    } catch (err) { toast(errMsg(err, "Impossible de traiter l'invitation."), "erreur"); }
    await loadInvites(); load();
  });

  // ---- recettes
  const cover = (r) => { const p = (r.recipe_photos || []).find((x) => x.is_cover); return p ? p.storage_path : null; };
  const sourceOf = (r) => r.source_author || AR.host(r.source_url || "") || "";
  let seq = 0;
  function load() { return st.type === "astuces" ? loadTips() : st.type === "menus" ? loadMenus() : loadRecipes(); }
  async function loadRecipes() {
    const my = ++seq;
    liste.setAttribute("aria-busy", "true");
    setMsg(msg, "");
    if (!books.length) { liste.innerHTML = `<div class="vide-etat"><p>Vous n'appartenez à aucun carnet pour le moment.</p></div>`; liste.setAttribute("aria-busy", "false"); return; }
    const ids = st.book === "all" ? books.map((b) => b.id) : [st.book];
    const base = () => {
      let q = sb.from("recipes").select("id,book_id,title,source_author,source_url,source_type,family,review_state,course,recipe_photos(storage_path,is_cover)")
        .in("book_id", ids).is("deleted_at", null).is("archived_at", null);
      if (st.statut === "a_verifier") q = q.eq("review_state", "a_verifier");
      // Une photo de page à relire n'entre au carnet qu'après validation : visible seulement sous « À vérifier ».
      else q = q.or("source_type.neq.photo_page,review_state.neq.a_verifier");
      if (st.statut === "famille") q = q.eq("family", true);
      if (st.course) q = q.eq("course", st.course);
      return q.order("created_at", { ascending: false }).limit(300);
    };
    let res, titleOnly = false;
    if (st.q) {
      // La recherche plein texte est calculée sur du texte sans accent (f_unaccent) : on retire les accents de la requête.
      res = await base().textSearch("search", norm(st.q), { config: "french", type: "websearch" });
      if (!res.error && !(res.data || []).length) {
        const like = st.q.replace(/[%_\\,()]/g, " ").trim();
        res = await base().ilike("title", `%${like}%`);
        titleOnly = true;
      }
    } else res = await base();
    if (my !== seq) return;
    liste.setAttribute("aria-busy", "false");
    if (res.error) { liste.innerHTML = ""; setMsg(msg, errMsg(res.error, "Impossible de charger les recettes."), "erreur"); return; }
    const rows = res.data || [];
    if (!rows.length) {
      const filtre = st.q || st.course || st.statut !== "toutes";
      liste.innerHTML = filtre
        ? `<div class="vide-etat"><p>Aucune recette ne correspond à votre recherche.</p><button type="button" class="btn sec petit" id="reset">Effacer les filtres</button></div>`
        : `<div class="vide-etat"><p class="italique">Ce carnet attend sa première recette.</p><a class="btn" href="/recettes/ajouter.html">Ajouter une recette</a></div>`;
      const r = $("#reset"); if (r) r.addEventListener("click", resetFilters);
      return;
    }
    const urls = await AR.signedUrls(rows.map(cover).filter(Boolean));
    if (my !== seq) return;
    if (titleOnly) setMsg(msg, "Aucun résultat exact : recettes dont le titre contient votre recherche.");
    renderPlanches(rows.map((r) => ({ ...r, cover: urls[cover(r)] || null })));
  }
  function renderPlanches(rows) {
    const multi = books.length > 1 && st.book === "all";
    const bookName = (id) => (books.find((b) => b.id === id) || {}).name || "";
    liste.innerHTML = `<ol class="grille-planches">${rows.map((r, i) => {
      const u = r.cover;
      const src = [sourceOf(r), multi ? bookName(r.book_id) : ""].filter(Boolean).join(" · ");
      const flags = r.family ? "De famille" : "";
      return `<li><a class="planche" href="/recettes/fiche.html?id=${encodeURIComponent(r.id)}">
        <div class="passe-partout"><div class="cadre">${u ? `<img src="${esc(u)}" alt="" loading="lazy">` : `<span class="vide">Sans photo</span>`}</div></div>
        <div class="legende">${flags ? `<span class="planche-num">${esc(flags)}</span>` : ""}
        <span class="planche-titre">${esc(r.title)}</span>${src ? `<span class="planche-source">${esc(src)}</span>` : ""}</div></a></li>`;
    }).join("")}</ol>`;
  }

  function resetFilters() {
    st.q = ""; st.course = ""; st.cat = ""; st.statut = "toutes"; $("#q").value = ""; $("#course").value = ""; $("#cat").value = ""; syncStatut(); load();
  }

  // ---- astuces (contrat 08 §3) : liste compacte, recherche via recipe_tip_search
  async function loadTips() {
    const my = ++seq;
    liste.setAttribute("aria-busy", "true");
    setMsg(msg, "");
    if (!books.length) { liste.innerHTML = `<div class="vide-etat"><p>Vous n'appartenez à aucun carnet pour le moment.</p></div>`; liste.setAttribute("aria-busy", "false"); return; }
    const ids = st.book === "all" ? books.map((b) => b.id) : [st.book];
    let q = sb.rpc("recipe_tip_search", { p_book_ids: ids, p_texte: st.q || null, p_category: st.cat || null, p_limit: 60 });
    if (st.statut === "a_verifier") q = q.eq("review_state", "a_verifier");
    const res = await q;
    if (my !== seq) return;
    if (res.error) { liste.innerHTML = ""; liste.setAttribute("aria-busy", "false"); setMsg(msg, AR.tipErr(res.error, "Impossible de charger les astuces."), "erreur"); return; }
    const rows = res.data || [];
    if (!rows.length) {
      liste.setAttribute("aria-busy", "false");
      const filtre = st.q || st.cat || st.statut !== "toutes";
      liste.innerHTML = filtre
        ? `<div class="vide-etat"><p>Aucune astuce ne correspond à votre recherche.</p><button type="button" class="btn sec petit" id="reset">Effacer les filtres</button></div>`
        : `<div class="vide-etat"><p class="italique">Ce carnet attend sa première astuce.</p><a class="btn" href="/recettes/editer-astuce.html">Écrire une astuce</a></div>`;
      const r = $("#reset"); if (r) r.addEventListener("click", resetFilters);
      return;
    }
    // Vignettes : couvertures des astuces affichées (une erreur ici ne bloque pas la liste).
    let covers = {};
    try {
      const ph = await sb.from("recipe_tip_photos").select("tip_id,storage_path").in("tip_id", rows.map((t) => t.id)).eq("is_cover", true);
      if (ph.error) throw ph.error;
      const urls = await AR.signedUrls((ph.data || []).map((p) => p.storage_path));
      (ph.data || []).forEach((p) => { if (urls[p.storage_path]) covers[p.tip_id] = urls[p.storage_path]; });
    } catch (e) { console.error(e); }
    if (my !== seq) return;
    liste.setAttribute("aria-busy", "false");
    const multi = books.length > 1 && st.book === "all";
    const bookName = (id) => (books.find((b) => b.id === id) || {}).name || "";
    liste.innerHTML = `<ul class="liste-astuces">${rows.map((t) => {
      const src = [AR.TIP_CATS[t.category] || "", t.source_author || AR.host(t.source_url || ""), multi ? bookName(t.book_id) : ""].filter(Boolean).join(" · ");
      return `<li><a class="astuce-carte" href="/recettes/astuce.html?id=${encodeURIComponent(t.id)}">
        ${covers[t.id] ? `<img class="astuce-vignette" src="${esc(covers[t.id])}" alt="" loading="lazy">` : ""}
        <span class="astuce-bloc">${t.review_state === "a_verifier" ? `<span class="planche-num">À vérifier</span>` : ""}
        <span class="astuce-titre">${esc(t.title)}</span>${src ? `<span class="planche-source">${esc(src)}</span>` : ""}
        <span class="astuce-extrait">${esc(t.body)}</span></span></a></li>`;
    }).join("")}</ul>`;
  }
  // ---- menus (contrat 09 §3) : titre, nombre de recettes, vignette de la première recette avec photo
  async function loadMenus() {
    const my = ++seq;
    liste.setAttribute("aria-busy", "true");
    setMsg(msg, "");
    if (!books.length) { liste.innerHTML = `<div class="vide-etat"><p>Vous n'appartenez à aucun carnet pour le moment.</p></div>`; liste.setAttribute("aria-busy", "false"); return; }
    const ids = st.book === "all" ? books.map((b) => b.id) : [st.book];
    let q = sb.from("recipe_menus").select("id,book_id,title,note,created_at,recipe_menu_items(position,recipes(id,deleted_at,recipe_photos(storage_path,is_cover)))").in("book_id", ids).is("deleted_at", null);
    if (st.q) q = q.ilike("title", `%${st.q.replace(/[%_\\,()]/g, " ").trim()}%`);
    const res = await q.order("created_at", { ascending: false }).limit(100);
    if (my !== seq) return;
    liste.setAttribute("aria-busy", "false");
    if (res.error) { liste.innerHTML = ""; setMsg(msg, AR.menuErr(res.error, "Impossible de charger les menus."), "erreur"); return; }
    const rows = (res.data || []).map((m) => {
      const its = (m.recipe_menu_items || []).filter((x) => x.recipes && !x.recipes.deleted_at).sort((a, b) => a.position - b.position);
      const withPhoto = its.map((x) => (x.recipes.recipe_photos || []).find((p) => p.is_cover)).find(Boolean);
      return { ...m, n: its.length, path: withPhoto ? withPhoto.storage_path : null };
    });
    const nouveau = (() => { const ed = books.filter((b) => b.role !== "reader"); const b = ed.find((x) => x.id === st.book) || ed.find((x) => x.id === AR.getBookPref()) || ed[0]; return b ? `<a class="btn" href="/recettes/menu.html?nouveau=1&amp;book=${encodeURIComponent(b.id)}">Nouveau menu</a>` : ""; })();
    if (!rows.length) {
      liste.innerHTML = st.q
        ? `<div class="vide-etat"><p>Aucun menu ne correspond à votre recherche.</p><button type="button" class="btn sec petit" id="reset">Effacer la recherche</button></div>`
        : `<div class="vide-etat"><p class="italique">Aucun menu dans ce carnet pour l'instant. Importez un PDF de menu, ou composez-en un à la main.</p><div class="rangee" style="justify-content:center">${nouveau}<a class="btn sec" href="/recettes/ajouter.html">Importer un PDF</a></div></div>`;
      const r = $("#reset"); if (r) r.addEventListener("click", resetFilters);
      return;
    }
    let urls = {};
    try { urls = await AR.signedUrls(rows.map((m) => m.path).filter(Boolean)); } catch (e) { console.error(e); }
    if (my !== seq) return;
    const multi = books.length > 1 && st.book === "all";
    const bookName = (id) => (books.find((b) => b.id === id) || {}).name || "";
    liste.innerHTML = `${nouveau ? `<p style="margin:0 0 16px">${nouveau}</p>` : ""}<ul class="liste-astuces">${rows.map((m) => {
      const sub = [`${m.n} recette${m.n > 1 ? "s" : ""}`, multi ? bookName(m.book_id) : ""].filter(Boolean).join(" · ");
      return `<li><a class="astuce-carte" href="/recettes/menu.html?id=${encodeURIComponent(m.id)}">
        ${m.path && urls[m.path] ? `<img class="astuce-vignette" src="${esc(urls[m.path])}" alt="" loading="lazy">` : `<span class="astuce-vignette menu-sans" aria-hidden="true"></span>`}
        <span class="astuce-bloc"><span class="astuce-titre">${esc(m.title)}</span><span class="planche-source">${esc(sub)}</span></span></a></li>`;
    }).join("")}</ul>`;
  }
  // Bascule Recettes / Astuces / Menus : mémorisée par appareil.
  function syncType(reload) {
    const tips = st.type === "astuces", menus = st.type === "menus";
    $$("[data-type]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.type === st.type)));
    if ((tips || menus) && st.mode === "question") setMode("mots");
    $("#nl-mode").hidden = tips || menus;
    $(".filtres").hidden = menus;
    $("[data-statut=famille]").hidden = tips;
    if (tips && st.statut === "famille") { st.statut = "toutes"; syncStatut(); }
    if (menus && st.statut !== "toutes") { st.statut = "toutes"; syncStatut(); }
    $("#course-l").hidden = tips || menus; $("#cat-l").hidden = !tips;
    $("#ligne-filtres").classList.toggle("seul", menus);
    $("#q").placeholder = tips ? "Une astuce, un ingrédient…" : menus ? "Un menu…" : "Une recette, un ingrédient…";
    $("label[for=q]").textContent = tips ? "Rechercher une astuce" : menus ? "Rechercher un menu" : "Rechercher une recette";
    if (reload) { clearTimeout(load.t); setMsg(msg, ""); load(); }
  }
  $$("[data-type]").forEach((b) => b.addEventListener("click", () => {
    if (st.type === b.dataset.type) return;
    st.type = b.dataset.type;
    try { localStorage.setItem(TYPE_KEY, st.type); } catch { /* stockage indisponible */ }
    syncType(true);
  }));
  function syncStatut() { $$("[data-statut]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.statut === st.statut))); }


  // ---- mode « question » (phase 4) : Claude traduit la phrase en filtres, affichés en pastilles retirables.
  // Retirer une pastille relance recipe_search en RPC, sans repasser par Claude.
  const nl = { f: null, nonRec: [], degrade: false, q: "" };
  const MAX_DIFF = { 1: "Facile", 2: "Moyen au plus", 3: "Difficile au plus" };
  const bookIds = () => (st.book === "all" ? books.map((b) => b.id) : [st.book]);
  function pastilles() {
    const f = nl.f || {}, out = [];
    if (f.texte) out.push(["texte", null, `« ${f.texte} »`]);
    if (f.type_plat) out.push(["type_plat", null, AR.COURSES[f.type_plat] || f.type_plat]);
    if (f.cuisine) out.push(["cuisine", null, f.cuisine]);
    if (f.temps_total_max) out.push(["temps_total_max", null, `${f.temps_total_max} min max`]);
    if (f.difficulte_max) out.push(["difficulte_max", null, MAX_DIFF[f.difficulte_max] || `Difficulté ${f.difficulte_max} au plus`]);
    (f.ingredients_inclus || []).forEach((n, i) => out.push(["ingredients_inclus", i, `Avec ${n}`]));
    (f.ingredients_exclus || []).forEach((n, i) => out.push(["ingredients_exclus", i, `Sans ${n}`]));
    if (f.saison_mois) out.push(["saison_mois", null, AR.cap(AR.MOIS[f.saison_mois - 1] || String(f.saison_mois))]);
    if (f.regime) out.push(["regime", null, AR.REGIMES[f.regime] || f.regime]);
    return out;
  }
  function renderPastilles() {
    const box = $("#nl-pastilles");
    if (st.mode !== "question" || !nl.f) { box.innerHTML = ""; return; }
    const ps = pastilles();
    box.innerHTML = `<p class="libelle or" id="nl-compris">Ce qui a été compris</p>
      ${ps.length ? `<ul class="nl-liste" aria-labelledby="nl-compris">${ps.map(([k, i, t]) => `<li><span class="nl-pastille">${esc(t)}<button type="button" class="nl-x" data-k="${k}" data-i="${i == null ? "" : i}" aria-label="Retirer le filtre : ${esc(t)}">×</button></span></li>`).join("")}</ul>`
        : `<p class="muted italique">Aucun filtre reconnu dans la question.</p>`}
      ${nl.nonRec.length ? `<p class="aide">Hors catalogue, cherchés dans les lignes des recettes : ${esc(nl.nonRec.join(", "))}.</p>` : ""}`;
  }
  async function runFilters() {
    const my = ++seq, f = nl.f;
    liste.setAttribute("aria-busy", "true");
    let cat = [];
    try { cat = await AR.loadCatalog(); } catch (e) { console.error(e); }
    const split = (names) => {
      const ids = [], txt = [];
      (names || []).forEach((n) => { const c = nl.nonRec.includes(n) ? null : AR.catalogByName(cat, n); if (c) ids.push(c.id); else txt.push(n); });
      return [ids, txt];
    };
    const [inc, incT] = split(f.ingredients_inclus), [exc, excT] = split(f.ingredients_exclus);
    const { data, error } = await sb.rpc("recipe_search", { p_book_ids: bookIds(), p_texte: f.texte || null, p_course: f.type_plat || null, p_cuisine: f.cuisine || null, p_time_max: f.temps_total_max || null,
      p_diff_max: f.difficulte_max || null, p_inc: inc.length ? inc : null, p_exc: exc.length ? exc : null, p_inc_txt: incT.length ? incT : null, p_exc_txt: excT.length ? excT : null,
      p_month: f.saison_mois || null, p_regime: f.regime || null, p_limit: 60 });
    if (my !== seq) return;
    liste.setAttribute("aria-busy", "false");
    if (error) { liste.innerHTML = ""; return setMsg(msg, errMsg(error, "Impossible de relancer la recherche."), "erreur"); }
    const ids = (data || []).map((x) => x.recipe_id);
    let cards = new Map();
    try { cards = await AR.fetchCards(ids); } catch (e) { console.error(e); }
    if (my !== seq) return;
    const rows = (data || []).map((x) => cards.get(x.recipe_id) || { id: x.recipe_id, book_id: x.book_id, title: x.title, family: x.family, review_state: x.review_state, cover: null });
    if (!rows.length) { liste.innerHTML = `<div class="vide-etat"><p>Aucune recette ne correspond à ces filtres.</p><p class="aide">Retirez une pastille pour élargir.</p></div>`; return; }
    renderPlanches(rows);
  }
  async function askClaude() {
    const q = $("#q").value.trim();
    if (q.length < 2) return setMsg(msg, "Écrivez une question de 2 caractères au moins.", "erreur");
    if (!books.length) return;
    nl.q = q; nl.f = null; nl.nonRec = []; nl.degrade = false; renderPastilles();
    setMsg(msg, "Lecture de votre question…");
    liste.setAttribute("aria-busy", "true");
    const my = ++seq;
    const btn = $("#search-form button[type=submit]"); btn.disabled = true;
    try {
      const { data, error } = await sb.functions.invoke("recipe-search", { body: { q, book_ids: st.book === "all" ? [] : [st.book] } });
      if (error) throw error;
      if (my !== seq) return;
      nl.f = { ...(data.filtres || {}) }; nl.degrade = !!data.degrade; nl.nonRec = (data.ingredients && data.ingredients.non_reconnus) || [];
      setMsg(msg, nl.degrade ? "Recherche simplifiée : le langage naturel est indisponible." : "");
      renderPastilles();
      const ids = (data.recettes || []).map((r) => r.id);
      const cards = await AR.fetchCards(ids).catch(() => new Map());
      if (my !== seq) return;
      liste.setAttribute("aria-busy", "false");
      const rows = (data.recettes || []).map((r) => cards.get(r.id) || { ...r, cover: null });
      if (!rows.length) liste.innerHTML = `<div class="vide-etat"><p>Aucune recette ne correspond à votre question.</p>${pastilles().length ? `<p class="aide">Retirez une pastille pour élargir.</p>` : ""}</div>`;
      else renderPlanches(rows);
    } catch (e) {
      if (my !== seq) return;
      // Repli : la phrase est cherchée comme texte simple, avec le message du serveur (limite, service indisponible…).
      const m = await AR.fnMessage(e, "Le langage naturel est indisponible pour le moment.");
      st.q = q; nl.f = null; renderPastilles();
      await load();
      setMsg(msg, `${m} Recherche simplifiée par mots.`, "erreur");
    } finally { btn.disabled = false; }
  }
  function setMode(m) {
    st.mode = m; clearTimeout(load.t);
    $$("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
    const q = m === "question";
    $("#nl-aide").hidden = !q; $(".filtres").hidden = q; $("#course").closest("label").hidden = q;
    $("#q").placeholder = q ? "Un dessert rapide sans crème pour cet automne…" : "Une recette, un ingrédient…";
    $("#search-form button[type=submit]").textContent = q ? "Demander" : "Chercher";
    nl.f = null; renderPastilles(); setMsg(msg, "");
    if (!q) load();
    else if (nl.q === "" && !$("#q").value) liste.innerHTML = `<div class="vide-etat"><p class="italique">Posez une question : les recettes correspondantes s'afficheront ici.</p></div>`;
  }
  $$("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  $("#nl-pastilles").addEventListener("click", (e) => {
    const b = e.target.closest(".nl-x"); if (!b || !nl.f) return;
    const k = b.dataset.k;
    if (b.dataset.i !== "") nl.f[k] = (nl.f[k] || []).filter((_, i) => i !== +b.dataset.i); else nl.f[k] = null;
    renderPastilles(); runFilters();
    const n = $(".nl-x", $("#nl-pastilles")); if (n) n.focus(); else $("#q").focus();
  });

  // ---- événements
  $("#search-form").addEventListener("submit", (e) => { e.preventDefault(); if (st.mode === "question") return void askClaude(); st.q = $("#q").value.trim(); load(); });
  $("#q").addEventListener("input", () => { if (st.mode === "question") return; clearTimeout(load.t); load.t = setTimeout(() => { const v = $("#q").value.trim(); if (v !== st.q) { st.q = v; load(); } }, 350); });
  $$("[data-statut]").forEach((b) => b.addEventListener("click", () => { st.statut = b.dataset.statut; syncStatut(); load(); }));
  $("#course").addEventListener("change", (e) => { st.course = e.target.value; load(); });
  $("#cat").addEventListener("change", (e) => { st.cat = e.target.value; load(); });
  $("#book").addEventListener("change", (e) => { st.book = e.target.value; AR.setBookPref(st.book); if (st.mode === "question") { if (nl.f) runFilters(); return; } load(); });

  loadInvites();
  syncType(false);
  load();
})();
