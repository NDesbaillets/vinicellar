// ARÔMES V&N · sommaire d'un PDF à plusieurs recettes (contrat 09-menus-pdf-contrat.md §3) :
// choix des recettes, rangement (menu ou séparées), lancement des imports « pdf_extrait » (3 appels simultanés au plus), suivi.
(async function () {
  const AR = window.AR, { sb, $, $$, esc, norm, toast, setMsg, fmtDate } = AR;
  const ctx = await AR.boot("ajouter");
  AR.swipeBack("/recettes/ajouter.html");
  if (!ctx) return;
  const main = $("#main");
  const jobId = new URLSearchParams(location.search).get("job");
  const fail = (t) => { main.setAttribute("aria-busy", "false"); main.innerHTML = `<div class="vide-etat"><p role="alert">${esc(t)}</p><a class="btn sec petit" href="/recettes/ajouter.html">Retour à Ajouter</a></div>`; };
  if (!jobId) return fail("Aucune analyse indiquée.");

  const DOCS = { menu: "Menu", recueil: "Recueil", recette: "Recette" };
  const MAX_PARALLEL = 3, ACTIFS = ["en_attente", "en_cours"];
  const RUBS = new Set(AR.MENU_RUBRIQUES.map((x) => x[0]));
  let job = null, menu = null;
  const imports = new Map(); // pdf_idx -> ligne recipe_imports retenue pour l'entrée
  const st = { init: false, checked: new Set(), filter: "", mode: "menu", menuName: "", target: "auto", busy: false, msg: "", msgKind: "" };

  try {
    const j = await sb.from("recipe_pdf_jobs").select("*").eq("id", jobId).maybeSingle();
    if (j.error) throw j.error;
    if (!j.data) return fail("Analyse introuvable, ou vous n'avez pas accès à son carnet.");
    job = j.data;
  } catch (e) { return fail(AR.menuErr(e, "Impossible de charger l'analyse du PDF.")); }
  const book = ctx.books.find((b) => b.id === job.book_id);
  const editor = !!book && (book.role === "owner" || book.role === "member");
  document.title = `${job.menu_title || "Sommaire du PDF"} · ARÔMES V&N`;
  main.setAttribute("aria-busy", "false");

  // ---- données de suivi
  const rank = (r) => (r.status === "termine" || r.status === "a_relire" ? 3 : ACTIFS.includes(r.status) ? 2 : 1);
  async function loadImports() {
    const { data, error } = await sb.from("recipe_imports").select("id,status,step,error,recipe_id,tip_id,pdf_idx,menu_id,created_at").eq("pdf_job_id", jobId);
    if (error) { console.error(error); return; }
    imports.clear();
    (data || []).forEach((r) => {
      const cur = imports.get(r.pdf_idx);
      if (!cur || rank(r) > rank(cur) || (rank(r) === rank(cur) && String(r.created_at) > String(cur.created_at))) imports.set(r.pdf_idx, r);
    });
  }
  async function loadMenu() {
    const { data, error } = await sb.from("recipe_menus").select("id,title").eq("pdf_job_id", jobId).is("deleted_at", null).order("created_at").limit(1);
    if (error) { console.error(error); return; }
    menu = data && data[0] ? data[0] : null;
  }
  async function reloadJob() {
    const { data, error } = await sb.from("recipe_pdf_jobs").select("*").eq("id", jobId).maybeSingle();
    if (error || !data) return;
    job = data;
  }

  // ---- affichage
  const toc = () => (Array.isArray(job.toc) ? job.toc : []).slice().sort((a, b) => a.idx - b.idx);
  const blocked = (e) => { const r = imports.get(e.idx); return !!r && r.status !== "echec"; };
  const selectable = () => toc().filter((e) => !blocked(e));
  const nb = () => selectable().filter((e) => st.checked.has(e.idx)).length;
  function defaultName() {
    let n = job.menu_title || "";
    if (!n) { try { n = sessionStorage.getItem("ar.pdf." + jobId) || ""; } catch { /* stockage indisponible */ } }
    return n || `Menu du ${AR.fmtDay(AR.todayIso())}`;
  }

  const doneCount = () => toc().filter((e) => { const r = imports.get(e.idx); return r && (r.status === "termine" || r.status === "a_relire"); }).length;
  function entryHtml(e) {
    const r = imports.get(e.idx), tip = e.nature === "astuce";
    const meta = [AR.COURSES[e.type_plat] || "", AR.fmtPages(e.pages)].filter(Boolean).map(esc).join(" · ");
    const txt = `<span class="pdf-txt"><span class="pdf-t">${esc(e.titre || "Sans titre")}</span><span class="pdf-m">${meta}${tip ? `${meta ? " · " : ""}<span class="libelle or">Astuce</span>` : ""}</span></span>`;
    if (r && r.status !== "echec") {
      let etat, lien = "";
      if (r.status === "termine" || r.status === "a_relire") {
        etat = r.tip_id && !r.recipe_id ? "Importée comme astuce" : "Importée";
        lien = r.recipe_id ? `<a class="btn sec petit" href="/recettes/fiche.html?id=${encodeURIComponent(r.recipe_id)}" aria-label="Ouvrir la fiche : ${esc(e.titre)}">Ouvrir la fiche</a>`
          : r.tip_id ? `<a class="btn sec petit" href="/recettes/astuce.html?id=${encodeURIComponent(r.tip_id)}" aria-label="Ouvrir l'astuce : ${esc(e.titre)}">Ouvrir l'astuce</a>` : "";
      } else etat = r.status === "en_attente" ? "En attente de démarrage…" : (r.step || "Import en cours…");
      const actif = ACTIFS.includes(r.status);
      return `<li class="pdf-ent pdf-fait" data-idx="${e.idx}"><div class="pdf-case">${txt}</div>
        <div class="pdf-etat"><span class="libelle or">${actif ? '<span class="imp-point" aria-hidden="true"></span>' : ""}${esc(etat)}</span>
        ${lien}${r.status === "en_attente" && editor ? `<button type="button" class="btn sec petit" data-retry="${esc(r.id)}">Relancer</button>` : ""}</div></li>`;
    }
    const echec = r && r.status === "echec" ? `<span class="pdf-err" role="note">${esc(r.error || "L'import a échoué.")} Vous pouvez le relancer.</span>` : "";
    return `<li class="pdf-ent" data-idx="${e.idx}"><label class="case pdf-case"><input type="checkbox" data-idx="${e.idx}"${st.checked.has(e.idx) ? " checked" : ""}${editor ? "" : " disabled"}> ${txt}</label>${echec}</li>`;
  }
  function drawList() {
    const f = norm(st.filter), list = toc().filter((e) => !f || norm(e.titre).includes(f));
    $("#pdf-liste").innerHTML = list.length ? list.map(entryHtml).join("") : `<li class="muted italique pdf-vide">Aucune entrée ne correspond.</li>`;
    drawGo();
  }
  function drawGo() {
    const go = $("#pdf-go"); if (!go) return;
    const n = nb();
    go.textContent = n ? `Importer ${n} recette${n > 1 ? "s" : ""}` : "Importer les recettes cochées";
    go.disabled = st.busy || !n;
    const out = $("#pdf-msg"); if (out && !st.busy) setMsg(out, st.msg, st.msgKind);
  }
  function drawMenuField() {
    const f = $("#pdf-menu-champ"); if (!f) return;
    f.innerHTML = st.mode !== "menu" ? "" : menu
      ? `<p class="aide">Les recettes seront ajoutées au menu « ${esc(menu.title)} » créé lors d'un import précédent de ce PDF.</p>`
      : `<label for="pdf-menu-nom">Nom du menu<input id="pdf-menu-nom" maxlength="200" autocomplete="off" value="${esc(st.menuName)}"></label>`;
  }

  function render() {
    const entries = toc(), pret = job.status === "pret";
    const head = `<p><a class="btn lien" href="/recettes/ajouter.html">← Ajouter</a></p>
      <h1 class="chapitre">${esc(job.menu_title || "Sommaire du PDF")}</h1><span class="filet" aria-hidden="true"></span>`;
    if (job.status === "en_attente" || job.status === "en_cours") {
      main.innerHTML = `${head}<p class="imp-etat"><span class="imp-point" aria-hidden="true"></span>${job.status === "en_cours" ? "Analyse du PDF en cours : le sommaire arrive dans un instant. Vous pouvez quitter cette page." : "L'analyse n'a pas encore démarré."}</p>
        ${job.status === "en_attente" && editor ? `<div><button type="button" class="btn" id="pdf-relance">Lancer l'analyse</button></div>` : ""}<p class="msg" id="pdf-msg" role="status" aria-live="polite"></p>`;
      return;
    }
    if (!pret) {
      main.innerHTML = `${head}<div class="vide-etat"><p class="msg erreur" role="alert">${esc(job.error || "L'analyse du PDF a échoué.")}</p><a class="btn sec petit" href="/recettes/ajouter.html">Ajouter un autre PDF</a></div>`;
      return;
    }
    if (!st.init) {
      st.init = true;
      if (job.document !== "recueil") entries.forEach((e) => { if (!blocked(e)) st.checked.add(e.idx); });
      st.menuName = defaultName();
    }
    const done = doneCount();
    const meta = [DOCS[job.document] || "", job.page_count ? `${job.page_count} page${job.page_count > 1 ? "s" : ""}` : "", `${entries.length} entrée${entries.length > 1 ? "s" : ""}`, fmtDate(job.created_at)].filter(Boolean).join(" · ");
    main.innerHTML = `${head}<p class="libelle or" style="margin:0 0 10px">${esc(meta)}</p>
      ${menu ? `<p><a class="btn sec" href="/recettes/menu.html?id=${encodeURIComponent(menu.id)}">Ouvrir le menu « ${esc(menu.title)} »</a></p>` : ""}
      ${done ? `<p class="aide" id="pdf-prog">${done} sur ${entries.length} importée${done > 1 ? "s" : ""}.</p>` : ""}
      ${!entries.length ? `<div class="vide-etat"><p>Aucune recette n'a été trouvée dans ce PDF.</p><a class="btn sec petit" href="/recettes/ajouter.html">Retour à Ajouter</a></div>` : `
      ${!editor ? `<p class="muted italique">Vous consultez ce sommaire en lecture seule.</p>` : ""}
      ${entries.length > 12 ? `<label class="sr-only" for="pdf-filtre">Filtrer les entrées</label><input id="pdf-filtre" type="search" placeholder="Filtrer par titre…" autocomplete="off" value="${esc(st.filter)}" style="margin-bottom:12px">` : ""}
      ${editor ? `<div class="rangee pdf-outils"><button type="button" class="btn sec petit" data-all="1">Tout cocher</button><button type="button" class="btn sec petit" data-all="0">Tout décocher</button></div>` : ""}
      <ul class="pdf-liste" id="pdf-liste" aria-label="Recettes du PDF"></ul>
      ${editor ? `<div class="champs pdf-regl">
        <fieldset class="pf-groupe"><legend class="libelle or">Rangement</legend>
          <label class="case"><input type="radio" name="pdf-mode" value="menu"${st.mode === "menu" ? " checked" : ""}> <span>Séparées et réunies dans un menu</span></label>
          <label class="case"><input type="radio" name="pdf-mode" value="separe"${st.mode === "separe" ? " checked" : ""}> <span>Séparées</span></label></fieldset>
        <div id="pdf-menu-champ"></div>
        <div class="importer-comme"><span class="etiquette" id="pdf-imp-lib">Importer comme</span>
          <div class="onglets" role="group" aria-labelledby="pdf-imp-lib" style="margin-top:6px">
            ${[["auto", "Automatique"], ["recette", "Recette"], ["astuce", "Astuce"]].map(([k, l]) => `<button type="button" class="onglet" data-target="${k}" aria-pressed="${st.target === k}">${l}</button>`).join("")}</div></div>
        <div><button type="button" class="btn" id="pdf-go">Importer les recettes cochées</button></div>
        <p class="msg" id="pdf-msg" role="status" aria-live="polite"></p></div>` : ""}`}`;
    if (entries.length) { drawList(); drawMenuField(); }
  }

  // ---- interactions
  main.addEventListener("input", (e) => {
    if (e.target.id === "pdf-filtre") { st.filter = e.target.value; drawList(); }
    if (e.target.id === "pdf-menu-nom") st.menuName = e.target.value;
  });
  main.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches("input[type=checkbox][data-idx]")) { if (t.checked) st.checked.add(+t.dataset.idx); else st.checked.delete(+t.dataset.idx); st.msg = ""; drawGo(); }
    if (t.name === "pdf-mode") { st.mode = t.value; drawMenuField(); }
  });
  main.addEventListener("click", async (e) => {
    const t = e.target;
    const all = t.closest("[data-all]");
    if (all) {
      const f = norm(st.filter);
      selectable().filter((x) => !f || norm(x.titre).includes(f)).forEach((x) => { if (all.dataset.all === "1") st.checked.add(x.idx); else st.checked.delete(x.idx); });
      st.msg = ""; return void drawList();
    }
    const tg = t.closest("[data-target]");
    if (tg) { st.target = tg.dataset.target; $$("[data-target]", main).forEach((b) => b.setAttribute("aria-pressed", String(b === tg))); return; }
    if (t.closest("#pdf-go")) return void launch();
    if (t.closest("#pdf-relance")) {
      const b = t.closest("#pdf-relance"); b.disabled = true;
      try { await AR.callPdfJob(jobId); await reloadJob(); render(); poll(); }
      catch (err) { b.disabled = false; setMsg($("#pdf-msg"), err.message, "erreur"); }
      return;
    }
    const rt = t.closest("[data-retry]");
    if (rt) {
      rt.disabled = true;
      try { await AR.callImport(rt.dataset.retry); toast("Import relancé."); await loadImports(); drawList(); poll(); }
      catch (err) { rt.disabled = false; toast(err.message, "erreur"); }
    }
  });

  // ---- lancement : un menu (si demandé), puis une ligne recipe_imports par recette cochée ; 3 appels simultanés au plus
  async function launch() {
    if (st.busy) return;
    const chosen = selectable().filter((e) => st.checked.has(e.idx));
    const out = $("#pdf-msg");
    if (!chosen.length) { st.msg = "Cochez au moins une recette."; st.msgKind = "erreur"; return drawGo(); }
    let menuId = null;
    st.busy = true; drawGo();
    try {
      if (st.mode === "menu") {
        if (menu) menuId = menu.id;
        else {
          const title = ($("#pdf-menu-nom") ? $("#pdf-menu-nom").value : st.menuName).replace(/\s+/g, " ").trim().slice(0, 200);
          if (!title) { st.busy = false; setMsg(out, "Donnez un nom au menu.", "erreur"); $("#pdf-menu-nom").focus(); return void drawGo(); }
          st.menuName = title;
          const id = AR.uuid();
          const ins = await sb.from("recipe_menus").insert({ id, book_id: job.book_id, title, source_type: "pdf", pdf_job_id: jobId, created_by: ctx.user.id });
          if (ins.error) throw ins.error;
          menu = { id, title }; menuId = id;
        }
      }
    } catch (err) { st.busy = false; setMsg(out, AR.menuErr(err, "Le menu n'a pas pu être créé."), "erreur"); return void drawGo(); }

    const queue = chosen.slice();
    let started = 0, quota = false, failed = 0, firstErr = "";
    const one = async (e) => {
      const old = imports.get(e.idx);
      if (old && old.status === "echec") await sb.from("recipe_imports").delete().eq("id", old.id); // l'ancienne tentative est écartée
      const id = AR.uuid();
      const row = { id, book_id: job.book_id, kind: "pdf_extrait", target: st.target, pdf_job_id: jobId, pdf_idx: e.idx, created_by: ctx.user.id };
      if (menuId && st.target !== "astuce" && (e.nature !== "astuce" || st.target === "recette")) {
        row.menu_id = menuId; row.menu_position = e.idx; row.menu_rubrique = RUBS.has(e.rubrique) ? e.rubrique : "autre";
      }
      const ins = await sb.from("recipe_imports").insert(row).select("id,status,step,error,recipe_id,tip_id,pdf_idx,menu_id,created_at").single();
      if (ins.error) { failed++; firstErr = firstErr || AR.menuErr(ins.error, "Un import n'a pas pu être créé."); return; }
      imports.set(e.idx, ins.data); st.checked.delete(e.idx);
      try { await AR.callImport(id); started++; }
      catch (err) {
        if (err.status === 429) { quota = true; imports.delete(e.idx); st.checked.add(e.idx); await sb.from("recipe_imports").delete().eq("id", id); }
        else { failed++; firstErr = firstErr || err.message; }
      }
      drawList();
    };
    const worker = async () => { while (queue.length && !quota) await one(queue.shift()); };
    await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, queue.length) }, worker));

    st.busy = false;
    const left = chosen.length - started - failed;
    const parts = [];
    if (started) parts.push(`${started} import${started > 1 ? "s lancés" : " lancé"}. Vous pouvez quitter cette page : les fiches arriveront dans votre carnet, à vérifier.`);
    if (quota) parts.push(`Limite quotidienne atteinte (50 imports par 24 heures) : ${left} recette${left > 1 ? "s restent" : " reste"} cochée${left > 1 ? "s" : ""}, vous pourrez les importer plus tard.`);
    if (failed) parts.push(`${failed} import${failed > 1 ? "s" : ""} non démarré${failed > 1 ? "s" : ""} : ${firstErr} Ils restent dans la liste : relancez-les.`);
    st.msg = parts.join(" "); st.msgKind = quota || failed ? "erreur" : "ok";
    await loadImports(); await loadMenu();
    render(); poll();
  }

  // ---- suivi : temps réel, avec sondage toutes les 5 s tant qu'une analyse ou un import est actif (ou le canal absent)
  let live = false, timer = null, busyLoad = false;
  const active = () => ACTIFS.includes(job.status) || [...imports.values()].some((r) => ACTIFS.includes(r.status));
  async function refresh() {
    if (busyLoad || st.busy) return;
    busyLoad = true;
    const before = job.status;
    try {
      await reloadJob(); await loadImports(); if (job.status === "pret") await loadMenu();
      if (job.status !== before || job.status !== "pret") render();
      else {
        const n = doneCount(), p = $("#pdf-prog");
        if (n && !p) render();
        else { if (p) p.textContent = `${n} sur ${toc().length} importée${n > 1 ? "s" : ""}.`; drawList(); }
      }
    } finally { busyLoad = false; }
    poll();
  }
  function poll() {
    const need = !live || active();
    if (need && !timer) timer = setInterval(() => { if (!document.hidden) refresh(); }, 5000);
    if (!need && timer) { clearInterval(timer); timer = null; }
  }
  try {
    const ch = sb.channel("pdf-" + jobId)
      .on("postgres_changes", { event: "*", schema: "public", table: "recipe_pdf_jobs", filter: `id=eq.${jobId}` }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "recipe_imports", filter: `pdf_job_id=eq.${jobId}` }, () => refresh())
      .subscribe((s) => { live = s === "SUBSCRIBED"; poll(); });
    window.addEventListener("pagehide", () => { sb.removeChannel(ch); });
  } catch (err) { console.error(err); live = false; }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });

  await Promise.all([loadImports(), loadMenu()]);
  render(); poll();
})();
