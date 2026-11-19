(async function () {
  const AR = window.AR, { sb, cfg, $, $$, esc, errMsg, setMsg, toast, fmtDate } = AR;
  const ctx = await AR.boot("ajouter");
  if (!ctx) return;
  const main = $("#main");
  const editable = ctx.books.filter((b) => b.role === "owner" || b.role === "member");
  const MAX_PAGES = 4;

  main.setAttribute("aria-busy", "false");
  if (!editable.length) {
    main.innerHTML = `<h1 class="chapitre">Ajouter</h1><span class="filet" aria-hidden="true"></span>
      <div class="vide-etat"><p role="alert">Vous n'avez aucun carnet où ajouter une recette (il faut y être propriétaire ou membre).</p><a class="btn sec petit" href="/recettes/">Retour au carnet</a></div>`;
    return;
  }

  // ---- paramètres de partage : ?url=…&text=… (raccourci iOS, share_target Android)
  const qs = new URLSearchParams(location.search);
  const shared = AR.safeUrl(qs.get("url") || "") || AR.extractUrl(qs.get("text") || "") || AR.extractUrl(qs.get("title") || "");
  const pref = AR.getBookPref();
  const bookId0 = (editable.find((b) => b.id === pref) || editable[0]).id;

  main.innerHTML = `<h1 class="chapitre">Ajouter</h1><span class="filet" aria-hidden="true"></span>
    <label>Carnet de destination<select id="book">${editable.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("")}</select></label>
    <div class="onglets" role="tablist" aria-label="Source de la recette" style="margin-top:22px">
      <button type="button" class="onglet" role="tab" id="t-lien" aria-controls="p-lien" aria-selected="true">Lien</button>
      <button type="button" class="onglet" role="tab" id="t-photo" aria-controls="p-photo" aria-selected="false" tabindex="-1">Photo de page</button>
      <button type="button" class="onglet" role="tab" id="t-manuel" aria-controls="p-manuel" aria-selected="false" tabindex="-1">Saisie manuelle</button>
    </div>
    <section id="p-lien" role="tabpanel" aria-labelledby="t-lien" class="panneau">
      <form id="f-lien" class="champs" novalidate>
        <label>Lien d'un reel Instagram ou d'un site de recettes<input type="url" name="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://" maxlength="2000"></label>
        <p class="aide" id="lien-type" aria-live="polite">Collez l'adresse : le type de source est reconnu automatiquement.</p>
        <div><button class="btn" type="submit" id="go-lien">Importer la recette</button></div>
        <p class="msg" id="msg-lien" role="status" aria-live="polite"></p>
      </form>
    </section>
    <section id="p-photo" role="tabpanel" aria-labelledby="t-photo" class="panneau" hidden>
      <form id="f-photo" class="champs" novalidate>
        <div>
          <span class="etiquette" id="photo-lib">Photos de la page (1 à ${MAX_PAGES})</span>
          <input type="file" id="pages-input" accept="image/*" multiple aria-labelledby="photo-lib" style="margin-top:6px">
          <p class="aide">Page imprimée ou manuscrite. Les photos sont réduites à 2000 px puis lues dans l'ordre. L'écriture à la main sera à relire avant d'entrer au carnet.</p>
        </div>
        <ul class="vignettes" id="vignettes" aria-label="Photos choisies"></ul>
        <div><button class="btn" type="submit" id="go-photo">Lire la page</button></div>
        <p class="msg" id="msg-photo" role="status" aria-live="polite"></p>
      </form>
    </section>
    <section id="p-manuel" role="tabpanel" aria-labelledby="t-manuel" class="panneau" hidden>
      <p>Écrivez la recette vous-même : titre, ingrédients, étapes et photo.</p>
      <a class="btn" id="go-manuel" href="/recettes/editer.html">Écrire une recette</a>
    </section>
    <h2 class="section">En cours</h2><span class="filet" aria-hidden="true"></span>
    <div id="imports" aria-live="polite"><p class="chargement">Chargement…</p></div>`;

  const bookSel = $("#book");
  bookSel.value = bookId0;
  bookSel.addEventListener("change", () => AR.setBookPref(bookSel.value));
  const bookName = (id) => (ctx.books.find((b) => b.id === id) || {}).name || "";

  // ---- onglets
  const tabs = $$("[role=tab]", main);
  function selectTab(t, focus) {
    tabs.forEach((x) => { const on = x === t; x.setAttribute("aria-selected", String(on)); x.tabIndex = on ? 0 : -1; $("#" + x.getAttribute("aria-controls")).hidden = !on; });
    if (focus) t.focus();
  }
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => selectTab(t));
    t.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (d) { e.preventDefault(); selectTab(tabs[(i + d + tabs.length) % tabs.length], true); }
    });
  });

  // ---- appel de la fonction d'import (le front crée la ligne, la fonction travaille en arrière-plan)
  async function callImport(importId) {
    const { data } = await sb.auth.getSession();
    const token = data.session && data.session.access_token;
    if (!token) throw new Error("Votre session a expiré. Reconnectez-vous.");
    let res;
    try {
      res = await fetch(`${cfg.supabaseUrl}/functions/v1/recipe-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: cfg.supabaseAnonKey },
        body: JSON.stringify({ import_id: importId })
      });
    } catch (e) { throw new Error("Connexion impossible. Vérifiez votre réseau et réessayez."); }
    if (!res.ok) {
      let m = "";
      try { const j = await res.json(); m = j && (j.message || j.error) || ""; } catch { /* corps non JSON */ }
      const fallback = res.status === 429 ? "Limite quotidienne atteinte : 50 imports par 24 heures."
        : res.status === 401 ? "Votre session a expiré. Reconnectez-vous."
        : res.status === 403 ? "Cette action n'est pas permise avec votre rôle dans ce carnet."
        : "L'import n'a pas pu démarrer. Réessayez dans un instant.";
      const e = new Error(m || fallback); e.status = res.status; throw e;
    }
  }

  // ---- lien
  const fl = $("#f-lien"), hint = $("#lien-type");
  function detect(v) {
    const u = AR.safeUrl(v.trim());
    if (!u) return null;
    return /(^|\.)(instagram\.com|instagr\.am)$/i.test(new URL(u).hostname) ? { kind: "instagram", url: u } : { kind: "web", url: u };
  }
  fl.url.addEventListener("input", () => {
    const d = detect(fl.url.value);
    hint.textContent = !fl.url.value.trim() ? "Collez l'adresse : le type de source est reconnu automatiquement."
      : !d ? "Cette adresse ne semble pas valide (elle doit commencer par http:// ou https://)."
      : d.kind === "instagram" ? "Reel Instagram reconnu : légende, parole et texte à l'écran seront lus."
      : `Site web reconnu (${AR.host(d.url)}).`;
  });
  if (shared) { fl.url.value = shared; fl.url.dispatchEvent(new Event("input")); }
  fl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = $("#msg-lien"), d = detect(fl.url.value);
    if (!d) return setMsg(out, "Indiquez une adresse valide, commençant par http:// ou https://.", "erreur");
    const btn = $("#go-lien"); btn.disabled = true; setMsg(out, "Envoi…");
    try {
      const id = AR.uuid();
      const ins = await sb.from("recipe_imports").insert({ id, book_id: bookSel.value, kind: d.kind, source_url: d.url, created_by: ctx.user.id, status: "en_attente" }).select("*").single();
      if (ins.error) throw ins.error;
      upsert(ins.data);
      try { await callImport(id); }
      catch (e2) { setMsg(out, e2.message + " L'import reste dans la liste : vous pourrez le relancer.", "erreur"); btn.disabled = false; poll(); return; }
      fl.url.value = ""; hint.textContent = "Collez l'adresse : le type de source est reconnu automatiquement.";
      setMsg(out, "Import lancé. Vous pouvez quitter cette page : la fiche arrivera dans votre carnet.", "ok");
      poll();
    } catch (err) { setMsg(out, errMsg(err, "Impossible de lancer l'import."), "erreur"); }
    btn.disabled = false;
  });

  // ---- photos de page
  const fp = $("#f-photo"), files = [];
  const thumbs = $("#vignettes");
  function drawThumbs() {
    thumbs.innerHTML = files.map((x, i) => `<li class="vignette"><img src="${esc(x.url)}" alt="Page ${i + 1}"><span class="libelle">Page ${i + 1}</span>
      <button type="button" class="btn danger cible" data-rm-page="${i}" aria-label="Retirer la page ${i + 1}">×</button></li>`).join("");
  }
  $("#pages-input").addEventListener("change", (e) => {
    const out = $("#msg-photo"); setMsg(out, "");
    Array.from(e.target.files || []).forEach((f) => {
      if (!/^image\//.test(f.type)) return setMsg(out, "Seules les images sont acceptées.", "erreur");
      if (files.length >= MAX_PAGES) return setMsg(out, `${MAX_PAGES} photos au plus : les suivantes ont été ignorées.`, "erreur");
      files.push({ file: f, url: URL.createObjectURL(f) });
    });
    e.target.value = ""; drawThumbs();
  });
  thumbs.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rm-page]");
    if (!b) return;
    const [x] = files.splice(Number(b.dataset.rmPage), 1);
    if (x) URL.revokeObjectURL(x.url);
    drawThumbs();
  });
  fp.addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = $("#msg-photo");
    if (!files.length) return setMsg(out, "Choisissez au moins une photo de la page.", "erreur");
    const btn = $("#go-photo"); btn.disabled = true;
    const id = AR.uuid(), book = bookSel.value, paths = [];
    try {
      // Les photos partent avant la ligne d'import : la fonction les trouve toutes à son démarrage.
      for (let i = 0; i < files.length; i++) {
        setMsg(out, `Préparation de la photo ${i + 1} sur ${files.length}…`);
        const blob = await AR.compressImage(files[i].file, 2000, 0.85);
        const path = `${book}/imports/${id}/${i + 1}.jpg`;
        const up = await sb.storage.from("recipes").upload(path, blob, { contentType: "image/jpeg", upsert: false });
        if (up.error) throw up.error;
        paths.push(path);
      }
      setMsg(out, "Envoi…");
      const ins = await sb.from("recipe_imports").insert({ id, book_id: book, kind: "photo_page", page_paths: paths, created_by: ctx.user.id, status: "en_attente" }).select("*").single();
      if (ins.error) { await sb.storage.from("recipes").remove(paths); throw ins.error; }
      upsert(ins.data);
      try { await callImport(id); }
      catch (e2) { setMsg(out, e2.message + " L'import reste dans la liste : vous pourrez le relancer.", "erreur"); btn.disabled = false; files.splice(0).forEach((x) => URL.revokeObjectURL(x.url)); drawThumbs(); poll(); return; }
      files.splice(0).forEach((x) => URL.revokeObjectURL(x.url)); drawThumbs();
      setMsg(out, "Lecture lancée. Vous pouvez quitter cette page : la fiche sera à relire avant d'entrer au carnet.", "ok");
      poll();
    } catch (err) {
      if (paths.length) sb.storage.from("recipes").remove(paths).catch(() => {});
      setMsg(out, errMsg(err, "Impossible d'envoyer les photos. Réessayez."), "erreur");
    }
    btn.disabled = false;
  });

  // ---- liste « En cours »
  const rows = new Map();
  const box = $("#imports");
  const ACTIFS = ["en_attente", "en_cours"];
  const label = (r) => r.kind === "photo_page" ? `Photo de page${(r.page_paths || []).length > 1 ? ` (${r.page_paths.length} photos)` : ""}`
    : (r.kind === "instagram" ? "Reel Instagram" : "Site web") + (AR.host(r.source_url || "") ? " · " + AR.host(r.source_url) : "");
  const fmtHeure = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  function etat(r) {
    if (r.status === "en_attente") return { t: "En attente de démarrage…", c: "" };
    if (r.status === "en_cours") return { t: r.step || "Import en cours…", c: "" };
    if (r.status === "a_relire") return { t: "À relire avant d'entrer au carnet", c: "or" };
    if (r.status === "termine") return { t: "Fiche prête", c: "or" };
    return { t: r.error || "L'import a échoué.", c: "erreur" };
  }
  function draw() {
    const list = [...rows.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    if (!list.length) { box.innerHTML = `<p class="muted italique">Aucun import pour l'instant.</p>`; return; }
    const multi = ctx.books.length > 1;
    box.innerHTML = `<ul class="imports">${list.map((r) => {
      const e = etat(r), actif = ACTIFS.includes(r.status);
      return `<li class="imp" data-id="${esc(r.id)}"><div class="imp-tete"><span class="libelle">${esc(label(r))}</span>
        <span class="meta">${esc(fmtDate(r.created_at))} · ${esc(fmtHeure(r.created_at))}${multi ? " · " + esc(bookName(r.book_id)) : ""}</span></div>
        <p class="imp-etat ${e.c}"${r.status === "echec" ? ' role="alert"' : ""}>${actif ? '<span class="imp-point" aria-hidden="true"></span>' : ""}${esc(e.t)}</p>
        <div class="rangee">
          ${r.recipe_id ? `<a class="btn petit" href="/recettes/fiche.html?id=${encodeURIComponent(r.recipe_id)}">${r.status === "a_relire" ? "Relire la fiche" : "Ouvrir la fiche"}</a>` : ""}
          ${r.status === "en_attente" ? `<button type="button" class="btn sec petit" data-retry="${esc(r.id)}">Relancer</button>` : ""}
          ${r.status === "termine" || r.status === "echec" ? `<button type="button" class="btn sec petit" data-remove="${esc(r.id)}">Retirer de la liste</button>` : ""}
        </div></li>`;
    }).join("")}</ul>`;
  }
  function upsert(r) {
    const old = rows.get(r.id);
    rows.set(r.id, r);
    if (old && ACTIFS.includes(old.status) && r.status === "termine") toast("Une fiche est prête.");
    draw(); poll();
  }
  async function load() {
    const { data, error } = await sb.from("recipe_imports").select("*").eq("created_by", ctx.user.id).order("created_at", { ascending: false }).limit(30);
    if (error) { if (!rows.size) box.innerHTML = `<p class="msg erreur" role="alert">${esc(errMsg(error, "Impossible de lire vos imports."))}</p>`; return; }
    const prev = new Map(rows);
    rows.clear();
    (data || []).forEach((r) => { rows.set(r.id, r); const o = prev.get(r.id); if (o && ACTIFS.includes(o.status) && r.status === "termine") toast("Une fiche est prête."); });
    draw(); poll();
  }
  box.addEventListener("click", async (e) => {
    const rm = e.target.closest("[data-remove]"), rt = e.target.closest("[data-retry]");
    if (rm) {
      rm.disabled = true;
      const { error } = await sb.from("recipe_imports").delete().eq("id", rm.dataset.remove);
      if (error) { rm.disabled = false; return toast(errMsg(error, "Impossible de retirer cet import."), "erreur"); }
      rows.delete(rm.dataset.remove); draw();
    }
    if (rt) {
      rt.disabled = true;
      try { await callImport(rt.dataset.retry); toast("Import relancé."); load(); }
      catch (err) { rt.disabled = false; toast(err.message, "erreur"); }
    }
  });

  // Temps réel, avec sondage toutes les 5 s tant qu'un import est actif ou que le canal n'est pas établi.
  let live = false, timer = null;
  function poll() {
    const need = !live || [...rows.values()].some((r) => ACTIFS.includes(r.status));
    if (need && !timer) timer = setInterval(() => { if (!document.hidden) load(); }, 5000);
    if (!need && timer) { clearInterval(timer); timer = null; }
  }
  try {
    const ch = sb.channel("imports-" + ctx.user.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "recipe_imports", filter: `created_by=eq.${ctx.user.id}` }, (p) => {
        if (p.eventType === "DELETE") { if (p.old && p.old.id) rows.delete(p.old.id); draw(); poll(); }
        else if (p.new && p.new.id) upsert(p.new);
      })
      .subscribe((status) => { live = status === "SUBSCRIBED"; poll(); });
    window.addEventListener("pagehide", () => { sb.removeChannel(ch); });
  } catch (err) { console.error(err); live = false; }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  await load();
  poll();
})();
