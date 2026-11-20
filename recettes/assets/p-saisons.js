// ARÔMES V&N · les saisons : ingrédients du mois, suggestions (Pour qui ?), « Avec ce que j'ai ».
(async function () {
  const AR = window.AR, { sb, $, $$, esc, errMsg, toast } = AR;
  const ctx = await AR.boot("saisons");
  if (!ctx) return;
  const main = $("#main"), zone = $("#zone");
  const books = ctx.books, me = ctx.user.id;
  main.setAttribute("aria-busy", "false");
  if (!books.length) { zone.innerHTML = `<div class="vide-etat"><p>Vous n'appartenez à aucun carnet pour le moment.</p></div>`; return; }

  const pref = AR.getBookPref();
  const st = { book: books.some((b) => b.id === pref) ? pref : "all", month: new Date().getMonth() + 1, who: new Set([me]), tab: "sugg", have: [] };
  const scope = () => (st.book === "all" ? books.map((b) => b.id) : [st.book]);
  let people = [], profiled = new Set(), profs = [];
  const notes = new Map(); // raison de l'écart, par recette

  zone.innerHTML = `
    <div class="ligne-filtres sa-reglages">
      <label for="sa-book">Carnet<select id="sa-book"><option value="all">Tous mes carnets</option>${books.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("")}</select></label>
      <label for="sa-mois">Mois<select id="sa-mois">${AR.MOIS.map((m, i) => `<option value="${i + 1}">${esc(AR.cap(m))}</option>`).join("")}</select></label>
    </div>
    <h2 class="section" id="sa-titre-saison" style="margin-top:12px"></h2><span class="filet" aria-hidden="true"></span>
    <div id="sa-saison"><p class="chargement">Chargement du catalogue…</p></div>
    <div class="bascules"><div class="onglets" role="group" aria-label="Que cuisiner ?">
      <button type="button" class="onglet" data-tab="sugg" aria-pressed="true">Suggestions</button>
      <button type="button" class="onglet" data-tab="have" aria-pressed="false">Avec ce que j'ai</button></div></div>
    <div id="sa-sugg" class="panneau"></div>
    <div id="sa-have" class="panneau" hidden></div>`;
  $("#sa-book").value = st.book; $("#sa-mois").value = String(st.month);

  // ---- ce qui est de saison
  let cat = [];
  async function renderSaison() {
    const m = st.month;
    $("#sa-titre-saison").textContent = `Ce qui est de saison en ${AR.MOIS[m - 1]}`;
    const box = $("#sa-saison");
    try { cat = await AR.loadCatalog(); } catch (e) { box.innerHTML = `<p class="msg erreur" role="alert">${esc(errMsg(e, "Impossible de lire le catalogue."))}</p>`; return; }
    const now = cat.filter((c) => (c.season_months || []).includes(m));
    if (!now.length) { box.innerHTML = `<p class="muted italique">Aucun ingrédient du catalogue n'est marqué de saison en ${esc(AR.MOIS[m - 1])}.</p>`; return; }
    const short = now.filter((c) => c.short_season), rest = now.filter((c) => !c.short_season);
    box.innerHTML = `${short.length ? `<p class="libelle or" style="margin:0 0 6px">Saison courte : à ne pas manquer</p><ul class="sa-ing sa-courte">${short.map((c) => `<li>${esc(c.name)}</li>`).join("")}</ul>` : ""}
      ${rest.length ? `<p class="libelle" style="margin:18px 0 6px">Aussi au marché</p><ul class="sa-ing">${rest.map((c) => `<li>${esc(c.name)}</li>`).join("")}</ul>` : ""}`;
  }

  // ---- Pour qui ?
  async function loadPeople() {
    const ids = scope();
    const [pp, pr] = await Promise.all([Promise.all(ids.map((b) => sb.rpc("book_people", { b }))), Promise.all(ids.map((b) => sb.rpc("book_people_profiles", { b })))]);
    const m = new Map();
    pp.forEach((r) => (r.data || []).forEach((x) => { if (!m.has(x.user_id)) m.set(x.user_id, x.full_name || x.email || "Membre"); }));
    people = [[me, "Moi"], ...[...m].filter(([id]) => id !== me)];
    profs = pr.flatMap((r) => r.data || []);
    profiled = new Set(profs.map((x) => x.user_id));
    st.who = new Set([...st.who].filter((id) => people.some((p) => p[0] === id)));
    if (!st.who.size) st.who.add(me);
  }
  function renderWho() {
    const box = $("#sa-qui");
    if (!box) return;
    const others = people.length > 1;
    box.innerHTML = `<fieldset class="sa-qui"><legend class="libelle or">Pour qui ?</legend>
      <div class="sa-personnes">${people.map(([id, name]) => `<label class="case pf-case"><input type="checkbox" data-who="${esc(id)}"${st.who.has(id) ? " checked" : ""}> ${esc(name)}${id !== me && !profiled.has(id) ? ` <span class="muted">(pas de profil)</span>` : ""}</label>`).join("")}</div>
      <p class="aide">Les allergies, aversions et régimes des personnes cochées sont respectés. Chacun voit celles des autres membres du carnet, pas ses préférences de difficulté.${others ? "" : " Invitez des membres dans un carnet pour composer un menu à plusieurs."}</p>
      ${[...st.who].some((id) => id !== me && !profiled.has(id)) ? `<p class="aide">Une personne cochée n'a pas rempli son profil : aucune contrainte n'est appliquée pour elle. Invitez-la à le remplir.</p>` : ""}
      ${!profiled.has(me) ? `<p class="aide">Vous n'avez pas encore de profil : <a href="/recettes/profil.html">renseignez vos allergies et aversions</a>.</p>` : ""}</fieldset>`;
  }

  // ---- suggestions
  let seq = 0;
  async function loadSugg() {
    const my = ++seq, box = $("#sa-liste");
    if (!box) return;
    box.setAttribute("aria-busy", "true");
    box.innerHTML = `<p class="chargement">Recherche de suggestions…</p>`;
    try {
      const who = [...st.who];
      const { data, error } = await sb.rpc("recipe_suggestions", { p_book_ids: scope(), p_for_users: who.length === 1 && who[0] === me ? null : who, p_month: st.month, p_limit: 40 });
      if (error) throw error;
      const cards = await AR.fetchCards((data || []).map((x) => x.recipe_id));
      if (my !== seq) return;
      const rows = AR.dedupeVersions((data || []).filter((x) => cards.has(x.recipe_id)), (x) => cards.get(x.recipe_id).version_group).slice(0, 12);
      // Lignes sans ingrédient du catalogue : allergènes non contrôlables (à signaler si une contrainte existe).
      const constraints = profs.some((p) => st.who.has(p.user_id) && ((p.allergens || []).length || (p.aversions || []).length || (p.aversions_texte || []).length || ["vegetarien", "vegan", "pescetarien", "sans_gluten", "sans_lactose"].includes(p.regime)));
      const unc = new Map();
      if (constraints && rows.length) {
        const l = await sb.from("recipe_ingredient_lines").select("recipe_id,catalog_id,optional").in("recipe_id", rows.map((x) => x.recipe_id));
        if (!l.error) (l.data || []).forEach((x) => { if (!x.catalog_id && !x.optional) unc.set(x.recipe_id, (unc.get(x.recipe_id) || 0) + 1); });
      }
      if (my !== seq) return;
      box.setAttribute("aria-busy", "false");
      if (!rows.length) { box.innerHTML = `<div class="vide-etat"><p class="italique">Aucune suggestion pour ce mois et ces personnes. Élargissez le carnet ou retirez une contrainte.</p></div>`; return; }
      box.innerHTML = `<ol class="sa-liste">${rows.map((x, i) => itemHtml(cards.get(x.recipe_id), i + 1, `<ul class="sa-raisons">${(x.raisons || []).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>${unc.get(x.recipe_id) ? `<p class="aide">${unc.get(x.recipe_id)} ingrédient${unc.get(x.recipe_id) > 1 ? "s" : ""} non rattaché${unc.get(x.recipe_id) > 1 ? "s" : ""} au catalogue : allergènes non contrôlables.</p>` : ""}`,
        `<div class="sa-btns"><button type="button" class="btn sec petit" data-fb="pas_cette_fois">Pas cette fois</button><button type="button" class="btn sec petit" data-fb="jamais">Jamais</button></div>`)).join("")}</ol>`;
    } catch (e) {
      if (my !== seq) return;
      box.setAttribute("aria-busy", "false");
      box.innerHTML = `<p class="msg erreur" role="alert">${esc(errMsg(e, "Impossible de calculer les suggestions."))}</p>`;
    }
  }
  function itemHtml(r, num, mid, btns) {
    return `<li class="sa-item" data-id="${esc(r.id)}"><a class="sa-photo" href="/recettes/fiche.html?id=${encodeURIComponent(r.id)}" aria-label="${esc(r.title)}"><div class="passe-partout"><div class="cadre">${r.cover ? `<img src="${esc(r.cover)}" alt="" loading="lazy">` : `<span class="vide">Sans photo</span>`}</div></div></a>
      <div class="sa-texte"><span class="planche-num">Planche ${String(num).padStart(2, "0")}${r.family ? " · De famille" : ""}</span><a class="sa-titre" href="/recettes/fiche.html?id=${encodeURIComponent(r.id)}">${esc(r.title)}</a>${mid || ""}${btns || ""}</div></li>`;
  }

  async function sendFeedback(li, kind) {
    const rid = li.dataset.id, title = $(".sa-titre", li).textContent, html = li.innerHTML;
    $$("button", li).forEach((b) => (b.disabled = true));
    const { error } = await sb.from("recipe_feedback").upsert({ user_id: me, recipe_id: rid, kind, created_at: new Date().toISOString() });
    if (error) { $$("button", li).forEach((b) => (b.disabled = false)); return toast(errMsg(error, "Impossible d'enregistrer votre choix."), "erreur"); }
    li.classList.add("ecartee");
    li.innerHTML = `<div class="sa-ecarte" role="status"><p>« ${esc(title)} » ${kind === "jamais" ? "ne vous sera plus proposée." : "est masquée pendant 14 jours."}</p><button type="button" class="btn sec petit" data-undo>Annuler</button></div>`;
    notes.set(rid, html);
    const u = $("[data-undo]", li); if (u) u.focus();
  }
  async function undoFeedback(li) {
    const rid = li.dataset.id;
    const b = $("[data-undo]", li); b.disabled = true;
    const { error } = await sb.from("recipe_feedback").delete().eq("recipe_id", rid);
    if (error) { b.disabled = false; return toast(errMsg(error, "Impossible d'annuler."), "erreur"); }
    li.classList.remove("ecartee"); li.innerHTML = notes.get(rid) || "";
    const f = $("[data-fb]", li); if (f) f.focus();
  }

  // ---- Avec ce que j'ai
  function renderHave() {
    const box = $("#sa-have");
    if (!$("#sa-have-cat")) {
      box.innerHTML = `<p class="italique muted">Indiquez de 1 à 8 ingrédients que vous avez : les recettes les plus faciles à réaliser passent en tête, avec ce qu'il vous manque.</p>
        <div id="sa-have-cat"></div><ul class="pf-puces" id="sa-have-puces" aria-label="Ingrédients choisis"></ul>
        <div><button type="button" class="btn" id="sa-have-go" disabled>Chercher des recettes</button></div>
        <div id="sa-have-res" class="sa-res" aria-live="polite"></div>`;
      AR.catalogPicker($("#sa-have-cat"), { label: "Un ingrédient que j'ai", placeholder: "Œufs, courge, beurre…", id: "sa-have-in", exclude: () => new Set(st.have.map((c) => c.id)),
        onPick: (c) => { if (st.have.length >= 8) return toast("Huit ingrédients au plus.", "erreur"); st.have.push(c); renderHave(); } });
    }
    $("#sa-have-puces").innerHTML = st.have.map((c) => `<li class="pf-puce"><span>${esc(c.name)}</span><button type="button" class="pf-x" data-rm="${esc(c.id)}" aria-label="Retirer ${esc(c.name)}">×</button></li>`).join("");
    $("#sa-have-go").disabled = !st.have.length;
    const inp = $("#sa-have-in"); if (inp) inp.disabled = st.have.length >= 8;
    const aide = $("#sa-have-cat .ac-etat"); if (aide && st.have.length >= 8) aide.textContent = "Huit ingrédients : c'est le maximum.";
  }
  async function searchHave() {
    const out = $("#sa-have-res"), btn = $("#sa-have-go");
    btn.disabled = true; out.innerHTML = `<p class="chargement">Recherche…</p>`;
    try {
      const { data, error } = await sb.rpc("recipe_with_what_i_have", { p_book_ids: scope(), p_catalog_ids: st.have.map((c) => c.id), p_limit: 20 });
      if (error) throw error;
      const cards = await AR.fetchCards((data || []).map((x) => x.recipe_id));
      const rows = AR.dedupeVersions((data || []).filter((x) => cards.has(x.recipe_id)), (x) => cards.get(x.recipe_id).version_group);
      if (!rows.length) { out.innerHTML = `<div class="vide-etat"><p class="italique">Aucune recette ne se prête à ces ingrédients.</p></div>`; return; }
      out.innerHTML = `<ol class="sa-liste">${rows.map((x, i) => {
        const miss = x.missing_count || 0, names = (x.missing_names || []).filter(Boolean);
        const unc = x.uncatalogued_count || 0;
        return itemHtml(cards.get(x.recipe_id), i + 1, `<p class="sa-manque${miss ? "" : " rien"}">${miss ? `Il vous manque : ${esc(names.join(", "))}` : "Rien à acheter"}</p>
          <p class="aide">${x.needed_count != null ? `${Math.max(0, x.needed_count - miss)} ingrédient${x.needed_count - miss > 1 ? "s" : ""} sur ${x.needed_count} déjà là.` : ""}${unc > 0 ? ` + ${unc} ingrédient${unc > 1 ? "s" : ""} à vérifier.` : ""}</p>`, "");
      }).join("")}</ol>`;
    } catch (e) { out.innerHTML = `<p class="msg erreur" role="alert">${esc(errMsg(e, "La recherche a échoué. Réessayez."))}</p>`; }
    finally { btn.disabled = !st.have.length; }
  }

  // ---- affichage
  function renderSugg() {
    $("#sa-sugg").innerHTML = `<p class="italique muted">Suggestions selon la saison, vos cuissons passées, le temps depuis la dernière fois et la facilité.</p><div id="sa-qui"></div><div id="sa-liste" aria-live="polite"></div>`;
    renderWho(); loadSugg();
  }
  async function refreshAll() {
    $("#sa-sugg").innerHTML = `<p class="chargement">Chargement…</p>`;
    try { await loadPeople(); } catch (e) { console.error(e); people = [[me, "Moi"]]; profiled = new Set(); profs = []; }
    renderSugg();
  }

  const loadSuggDeb = AR.debounce(loadSugg, 250);
  zone.addEventListener("change", (e) => {
    if (e.target.id === "sa-book") { st.book = e.target.value; if (st.book !== "all") AR.setBookPref(st.book); refreshAll(); if (st.have.length && $("#sa-have-res").innerHTML) searchHave(); return; }
    if (e.target.id === "sa-mois") { st.month = +e.target.value; renderSaison(); loadSugg(); return; }
    const w = e.target.closest("[data-who]");
    if (w) {
      if (w.checked) st.who.add(w.dataset.who); else st.who.delete(w.dataset.who);
      if (!st.who.size) { st.who.add(me); w.checked = w.dataset.who === me; toast("Au moins une personne : « Moi » reste cochée."); }
      renderWho(); loadSuggDeb();
    }
  });
  zone.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab]");
    if (t) { st.tab = t.dataset.tab; $$("[data-tab]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === st.tab))); $("#sa-sugg").hidden = st.tab !== "sugg"; $("#sa-have").hidden = st.tab !== "have"; if (st.tab === "have") renderHave(); return; }
    const fb = e.target.closest("[data-fb]"); if (fb) return void sendFeedback(fb.closest(".sa-item"), fb.dataset.fb);
    const u = e.target.closest("[data-undo]"); if (u) return void undoFeedback(u.closest(".sa-item"));
    const rm = e.target.closest("[data-rm]"); if (rm) { st.have = st.have.filter((c) => c.id !== rm.dataset.rm); renderHave(); return; }
    if (e.target.closest("#sa-have-go")) searchHave();
  });

  renderSaison();
  refreshAll();
})();
