// ARÔMES V&N · fiche d'un menu (contrat 09-menus-pdf-contrat.md §3) : recettes par rubrique, modification, courses, planning, réception, corbeille.
(async function () {
  const AR = window.AR, { sb, $, $$, esc, toast, setMsg, fmtDate } = AR;
  const ctx = await AR.boot("carnet");
  AR.swipeBack("./");
  if (!ctx) return;
  const main = $("#main");
  const qs = new URLSearchParams(location.search);
  const menuId = qs.get("id"), creating = !menuId && qs.get("nouveau") === "1";
  const fail = (t) => { main.setAttribute("aria-busy", "false"); main.innerHTML = `<div class="vide-etat"><p role="alert">${esc(t)}</p><a class="btn sec petit" href="/recettes/?type=menus">Retour aux menus</a></div>`; };
  const RUB_IDX = new Map(AR.MENU_RUBRIQUES.map(([k], i) => [k, i]));
  const RUB_LAB = Object.fromEntries(AR.MENU_RUBRIQUES);
  // ---- composer un menu (contrat 10 §3) : trois rangs (entrée, plat, dessert) à remplir par choix ou par suggestion
  async function composer() {
    const editable = ctx.books.filter((b) => b.role !== "reader");
    if (!editable.length) return fail("Votre rôle de lecteur ne permet pas de créer un menu.");
    const qb = qs.get("book"), me = ctx.user.id;
    const S = { book: editable.some((b) => b.id === qb) ? qb : AR.pickBook(editable), rungs: ["entree", "plat", "dessert"].map((k) => ({ k, rid: null, title: "", course: null })), busy: false };
    const jq = qs.get("jour"), cq = qs.get("creneau");
    const jour = /^\d{4}-\d{2}-\d{2}$/.test(jq || "") && !isNaN(Date.parse(jq)) ? jq : null, creneau = cq === "midi" || cq === "soir" ? cq : null;
    const slot = jour && creneau ? { day: jour, slot: creneau } : null;
    S.title = `Menu du ${AR.fmtDay(jour || AR.todayIso())}`;
    const COURSES_OF = { entree: ["entree"], plat: ["plat"], dessert: ["dessert"], accompagnement: ["accompagnement"], aperitif: ["entree", "autre"], fromage: ["autre"] };
    const OPTIONAL = ["aperitif", "accompagnement", "fromage"];
    const order = (k) => RUB_IDX.get(k);
    const lab = (k) => RUB_LAB[k] || k;
    document.title = "Composer un menu · ARÔMES V&N";
    main.setAttribute("aria-busy", "false");

    function draw() {
      const have = new Set(S.rungs.map((r) => r.k)), more = OPTIONAL.filter((k) => !have.has(k));
      main.innerHTML = `<p><a class="btn lien" href="/recettes/?type=menus">← Le carnet</a></p>
        <h1 class="chapitre">Composer un menu</h1><span class="filet" aria-hidden="true"></span>
        <form id="cp-form" class="champs" novalidate>
          ${editable.length > 1 ? `<label for="cp-book">Carnet<select id="cp-book">${editable.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("")}</select></label>` : ""}
          <label for="cp-titre">Nom du menu<input id="cp-titre" maxlength="200" autocomplete="off" value="${esc(S.title)}"></label>
          ${slot ? `<p class="libelle or" style="margin:0">Pour ${esc(AR.dayLabel(slot.day))} · ${slot.slot === "midi" ? "midi" : "soir"}</p>` : ""}
          <div id="cp-rangs">${S.rungs.map(rungHtml).join("")}</div>
          ${more.length ? `<div class="cp-ajout" role="group" aria-label="Ajouter un rang">${more.map((k) => `<button type="button" class="btn sec petit" data-add="${k}">+ ${esc(lab(k))}</button>`).join("")}</div>` : ""}
          <div class="rangee"><button type="submit" class="btn" id="cp-save">Enregistrer le menu</button><a class="btn sec" href="/recettes/?type=menus">Annuler</a></div>
          <p class="msg" id="cp-msg" role="status" aria-live="polite"></p></form>`;
      const sel = $("#cp-book"); if (sel) sel.value = S.book;
    }
    function rungHtml(r) {
      return `<section class="cp-rang" data-k="${r.k}" aria-label="${esc(lab(r.k))}"><div class="cp-tete"><h2 class="menu-rub">${esc(lab(r.k))}</h2><button type="button" class="btn lien" data-rm="${r.k}" aria-label="Retirer le rang ${esc(lab(r.k))}">Retirer ce rang</button></div>
        ${r.rid ? `<p class="cp-choix"><a href="/recettes/fiche.html?id=${encodeURIComponent(r.rid)}">${esc(r.title)}</a></p>
          <div class="rangee"><button type="button" class="btn sec petit" data-pick="${r.k}" data-tab="carnet">Changer</button><button type="button" class="btn lien" data-clear="${r.k}" aria-label="Retirer le choix : ${esc(r.title)}">Retirer le choix</button></div>`
        : `<div class="rangee"><button type="button" class="btn sec" data-pick="${r.k}" data-tab="carnet">Choisir</button><button type="button" class="btn sec" data-pick="${r.k}" data-tab="idees">Suggérer</button></div>`}</section>`;
    }
    const redrawRung = (k, focus) => {
      const r = S.rungs.find((x) => x.k === k), el = $(`.cp-rang[data-k="${k}"]`); if (!r || !el) return;
      el.outerHTML = rungHtml(r);
      if (focus) { const b = $(`.cp-rang[data-k="${k}"] [data-pick], .cp-rang[data-k="${k}"] [data-clear]`); if (b) b.focus(); }
    };

    // ---- feuille de choix d'une recette pour un rang
    let sheet = null, opener = null, recipes = null;
    const used = (k) => new Set(S.rungs.filter((r) => r.rid && r.k !== k).map((r) => r.rid));
    const onEsc = (e) => { if (e.key === "Escape" && sheet) closeSheet(); };
    function closeSheet() { if (!sheet) return; document.removeEventListener("keydown", onEsc); sheet.remove(); sheet = null; document.body.classList.remove("se-ouvert"); if (opener && document.contains(opener)) opener.focus(); opener = null; }
    async function loadRecipes() {
      if (recipes && recipes.book === S.book) return recipes.rows;
      let r = await sb.from("recipes").select("id,title,course,courses_alt,servings").eq("book_id", S.book).is("deleted_at", null).is("archived_at", null).order("title").limit(500);
      if (r.error && /courses_alt/.test(String(r.error.message || ""))) r = await sb.from("recipes").select("id,title,course,servings").eq("book_id", S.book).is("deleted_at", null).is("archived_at", null).order("title").limit(500);
      if (r.error) throw r.error;
      recipes = { book: S.book, rows: r.data || [] };
      return recipes.rows;
    }
    function openSheet(k, tab, from) {
      closeSheet(); opener = from;
      const wide = COURSES_OF[k] ? OPTIONAL.includes(k) : true, my = { shown: new Set(), cards: new Map(), all: wide, seq: 0 };
      sheet = document.createElement("div");
      sheet.className = "se-fond";
      sheet.innerHTML = `<section class="se-feuille" role="dialog" aria-modal="true" aria-labelledby="cp-f-t"><div class="se-f-tete"><div><h2 id="cp-f-t">${esc(lab(k))}</h2><p class="libelle or" style="margin:2px 0 0">Choisir une recette</p></div><button type="button" class="btn sec petit" data-close>Fermer</button></div>
        <div class="onglets" role="group" aria-label="Origine du choix"><button type="button" class="onglet" data-t="carnet" aria-pressed="${tab === "carnet"}">Dans le carnet</button><button type="button" class="onglet" data-t="idees" aria-pressed="${tab === "idees"}">Idées</button></div><div id="cp-pick" class="panneau"></div></section>`;
      document.body.append(sheet); document.body.classList.add("se-ouvert"); document.addEventListener("keydown", onEsc);
      const zone = $("#cp-pick", sheet);
      const choose = (id, title, course) => { const r = S.rungs.find((x) => x.k === k); r.rid = id; r.title = title; r.course = course || null; closeSheet(); redrawRung(k, true); };
      async function tabCarnet() {
        zone.innerHTML = `<label for="cp-rech" class="sr-only">Chercher dans le carnet</label><input id="cp-rech" type="search" placeholder="Chercher dans le carnet…" autocomplete="off">
          <label class="case pf-case"><input type="checkbox" id="cp-tout"${my.all ? " checked" : ""}> Toutes les recettes du carnet</label><div id="cp-res" class="se-res"><p class="chargement">Chargement…</p></div>`;
        let rows;
        try { rows = await loadRecipes(); } catch (e) { if ($("#cp-res", sheet)) $("#cp-res", sheet).innerHTML = `<p class="msg erreur" role="alert">${esc(AR.errMsg(e, "Impossible de lire le carnet."))}</p>`; return; }
        if (!sheet || !$("#cp-rech", sheet)) return;
        const want = COURSES_OF[k] || [], u = used(k);
        const show = () => {
          const n = AR.norm($("#cp-rech", sheet).value), all = $("#cp-tout", sheet).checked; my.all = all;
          const f = rows.filter((r) => !u.has(r.id) && (all || want.includes(r.course) || (r.courses_alt || []).some((c) => want.includes(c))) && (!n || AR.norm(r.title).includes(n))).slice(0, 80);
          $("#cp-res", sheet).innerHTML = f.length ? `<ul class="se-choix">${f.map((r) => `<li><button type="button" class="se-choix-b" data-rid="${esc(r.id)}"><span class="se-ch-t">${esc(r.title)}</span><span class="se-ch-m">${esc([AR.COURSES[r.course] || "", (r.courses_alt || []).length ? "aussi en " + r.courses_alt.map((c) => (AR.COURSES[c] || c).toLowerCase()).join(", ") : ""].filter(Boolean).join(" · "))}</span></button></li>`).join("")}</ul>` : `<p class="muted italique">Aucune recette ne correspond${all ? "" : " : cochez « Toutes les recettes du carnet » pour élargir"}.</p>`;
        };
        $("#cp-rech", sheet).addEventListener("input", show); $("#cp-tout", sheet).addEventListener("change", show); show(); $("#cp-rech", sheet).focus();
      }
      async function tabIdees(more) {
        const id = ++my.seq;
        zone.innerHTML = `<p class="chargement">Recherche d'idées…</p>`;
        try {
          const u = used(k);
          if (!more) my.shown = new Set();
          const data = await AR.suggestCourses({ p_book_ids: [S.book], p_for_users: null, p_month: +(jour || AR.todayIso()).slice(5, 7), p_limit: my.shown.size + u.size + 3 }, COURSES_OF[k] || ["plat"]);
          const fresh = (data || []).filter((x) => !my.shown.has(x.recipe_id) && !u.has(x.recipe_id));
          const cards = await AR.fetchCards(fresh.map((x) => x.recipe_id));
          if (!sheet || id !== my.seq) return;
          const rows = AR.dedupeVersions(fresh.filter((x) => cards.has(x.recipe_id)), (x) => cards.get(x.recipe_id).version_group).slice(0, 3);
          rows.forEach((x) => { my.shown.add(x.recipe_id); my.cards.set(x.recipe_id, cards.get(x.recipe_id)); });
          const pied = `<div class="rangee se-prop-b">${my.shown.size ? `<button type="button" class="btn sec" data-more>Autres idées</button>` : ""}</div>`;
          zone.innerHTML = rows.length ? `<ul class="se-choix">${rows.map((x) => { const c = cards.get(x.recipe_id); return `<li class="se-sug"><button type="button" class="se-choix-b" data-rid="${esc(c.id)}"><span class="se-ch-t">${esc(c.title)}</span></button><ul class="sa-raisons">${(x.raisons || []).map((t) => `<li>${esc(t)}</li>`).join("")}</ul></li>`; }).join("")}</ul>${pied}`
            : `<p class="muted italique">${more ? "Plus d'idées pour l'instant." : "Aucune idée pour ce rang."}</p>${pied}`;
        } catch (e) { if (sheet) zone.innerHTML = `<p class="msg erreur" role="alert">${esc(AR.errMsg(e, "Impossible de calculer les suggestions."))}</p>`; }
      }
      sheet.addEventListener("click", (e) => {
        if (e.target === sheet || e.target.closest("[data-close]")) return closeSheet();
        const t = e.target.closest("[data-t]");
        if (t) { $$("[data-t]", sheet).forEach((b) => b.setAttribute("aria-pressed", String(b === t))); return void (t.dataset.t === "carnet" ? tabCarnet() : tabIdees(false)); }
        if (e.target.closest("[data-more]")) return void tabIdees(true);
        const b = e.target.closest("[data-rid]"); if (!b) return;
        const c = my.cards.get(b.dataset.rid) || (recipes && recipes.rows.find((x) => x.id === b.dataset.rid));
        if (c) choose(c.id, c.title, c.course);
      });
      sheet.addEventListener("keydown", (e) => {
        if (e.key === "Escape") return closeSheet();
        if (e.key !== "Tab") return;
        const f = $$("button:not([disabled]), input, a[href]", sheet).filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
      tab === "idees" ? tabIdees(false) : tabCarnet();
    }

    // ---- enregistrement : menu, plats par rang, puis case du planning si jour et créneau sont donnés
    async function save() {
      if (S.busy) return;
      const out = $("#cp-msg"), title = $("#cp-titre").value.replace(/\s+/g, " ").trim(), chosen = S.rungs.filter((r) => r.rid);
      S.title = title;
      if (!title) { setMsg(out, "Donnez un nom au menu.", "erreur"); return void $("#cp-titre").focus(); }
      if (!chosen.length) return setMsg(out, "Choisissez au moins une recette avant d'enregistrer.", "erreur");
      S.busy = true; $$("#cp-form button").forEach((b) => (b.disabled = true)); setMsg(out, "Enregistrement…");
      let id = null;
      try {
        id = AR.uuid();
        const ins = await sb.from("recipe_menus").insert({ id, book_id: S.book, title, note: null, source_type: "manuel", created_by: me }).select("*").single();
        if (ins.error) { id = null; throw ins.error; }
        const it = await sb.from("recipe_menu_items").insert(chosen.map((r, i) => ({ menu_id: id, recipe_id: r.rid, position: i, rubrique: r.k })));
        if (it.error) { await sb.from("recipe_menus").update({ deleted_at: new Date().toISOString() }).eq("id", id); throw it.error; }
      } catch (e) {
        S.busy = false; $$("#cp-form button").forEach((b) => (b.disabled = false));
        return setMsg(out, AR.menuErr(e, "Le menu n'a pas pu être enregistré."), "erreur");
      }
      const go = `/recettes/menu.html?id=${encodeURIComponent(id)}`;
      if (slot) {
        try {
          const ex = await sb.from("recipe_meal_plan").select("*").eq("book_id", S.book).eq("day", slot.day).eq("slot", slot.slot).maybeSingle();
          if (ex.error) throw ex.error;
          if (ex.data && (ex.data.recipe_id || ex.data.menu_id) && !confirm("Ce repas a déjà une recette ou un menu. Le remplacer ?")) { location.assign(go); return; }
          const patch = { menu_id: id, recipe_id: null, state: ex.data && ex.data.state === "invites" ? "invites" : "prevu" };
          const res = ex.data ? await sb.from("recipe_meal_plan").update(patch).eq("id", ex.data.id) : await sb.from("recipe_meal_plan").insert({ id: AR.uuid(), book_id: S.book, day: slot.day, slot: slot.slot, created_by: me, ...patch });
          if (res.error) throw res.error;
          AR.setBookPref(S.book);
        } catch (e) {
          S.busy = false;
          out.className = "msg erreur"; out.innerHTML = `Menu enregistré, mais le repas n'a pas pu être placé au planning : ${esc(AR.menuErr(e, "erreur du planning"))} <a href="${go}">Ouvrir le menu</a>`;
          return;
        }
      }
      location.assign(go);
    }

    main.addEventListener("input", (e) => { if (e.target.id === "cp-titre") S.title = e.target.value; });
    main.addEventListener("change", (e) => { if (e.target.id === "cp-book") { S.book = e.target.value; recipes = null; S.rungs.forEach((r) => { r.rid = null; r.title = ""; }); draw(); } });
    main.addEventListener("submit", (e) => { if (e.target.id === "cp-form") { e.preventDefault(); save(); } });
    main.addEventListener("click", (e) => {
      const p = e.target.closest("[data-pick]"); if (p) return void openSheet(p.dataset.pick, p.dataset.tab, p);
      const c = e.target.closest("[data-clear]"); if (c) { const r = S.rungs.find((x) => x.k === c.dataset.clear); r.rid = null; r.title = ""; return void redrawRung(r.k, true); }
      const rm = e.target.closest("[data-rm]"); if (rm) { S.rungs = S.rungs.filter((x) => x.k !== rm.dataset.rm); draw(); const f = $("[data-pick]"); if (f) f.focus(); return; }
      const a = e.target.closest("[data-add]"); if (a) { S.rungs.push({ k: a.dataset.add, rid: null, title: "", course: null }); S.rungs.sort((x, y) => order(x.k) - order(y.k)); draw(); const f = $(`.cp-rang[data-k="${a.dataset.add}"] [data-pick]`); if (f) f.focus(); }
    });
    draw();
  }

  if (qs.get("composer") === "1" && !menuId) return composer();
  if (!menuId && !creating) return fail("Aucun menu indiqué.");

  const rubOf = (course) => (RUB_IDX.has(course) ? course : "autre");
  let menu = null, bookId = null, items = [], saved = new Map();
  const itemOf = (row, urls) => {
    const r = row.recipes, p = (r.recipe_photos || []).find((x) => x.is_cover);
    return { rid: r.id, title: r.title, course: r.course, servings: r.servings, rubrique: RUB_IDX.has(row.rubrique) ? row.rubrique : "autre", position: row.position, cover: p ? (urls || {})[p.storage_path] || null : null, path: p ? p.storage_path : null };
  };

  if (menuId) {
    try {
      const m = await sb.from("recipe_menus").select("*").eq("id", menuId).maybeSingle();
      if (m.error) throw m.error;
      if (!m.data) return fail("Menu introuvable, ou vous n'avez pas accès à son carnet.");
      menu = m.data; bookId = menu.book_id;
      const it = await sb.from("recipe_menu_items").select("recipe_id,position,rubrique,recipes(id,title,course,servings,deleted_at,recipe_photos(storage_path,is_cover))").eq("menu_id", menuId).order("position");
      if (it.error) throw it.error;
      const rows = (it.data || []).filter((x) => x.recipes && !x.recipes.deleted_at);
      const urls = await AR.signedUrls(rows.map((x) => { const p = (x.recipes.recipe_photos || []).find((y) => y.is_cover); return p && p.storage_path; }).filter(Boolean));
      items = rows.map((x) => itemOf(x, urls));
    } catch (e) { return fail(AR.menuErr(e, "Impossible de charger ce menu.")); }
  } else bookId = qs.get("book");
  const book = ctx.books.find((b) => b.id === bookId);
  if (!book) return fail("Carnet introuvable, ou vous n'y avez pas accès.");
  const editor = book.role === "owner" || book.role === "member";
  if (creating && !editor) return fail("Votre rôle de lecteur ne permet pas de créer un menu.");
  main.setAttribute("aria-busy", "false");
  const snapshot = () => { saved = new Map(items.map((x, i) => [x.rid, `${x.rubrique}|${i}`])); };
  snapshot();

  const st = { edit: creating, title: menu ? menu.title : "", note: menu ? menu.note || "" : "", open: null, courses: "", plan: "" };
  const sorted = () => items.map((x, i) => [x, i]).sort((a, b) => RUB_IDX.get(a[0].rubrique) - RUB_IDX.get(b[0].rubrique) || a[1] - b[1]).map((x) => x[0]);
  const nbTxt = (n) => `${n} recette${n > 1 ? "s" : ""}`;
  document.title = `${st.title || "Nouveau menu"} · ARÔMES V&N`;

  // ---- lecture
  function itemHtml(x) {
    const meta = [AR.COURSES[x.course] || "", x.servings ? `${x.servings} portion${x.servings > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ");
    return `<li><a class="planche reduite" href="/recettes/fiche.html?id=${encodeURIComponent(x.rid)}"><div class="passe-partout"><div class="cadre">${x.cover ? `<img src="${esc(x.cover)}" alt="" loading="lazy">` : `<span class="vide">Sans photo</span>`}</div></div>
      <div class="legende"><span class="planche-titre">${esc(x.title)}</span>${meta ? `<span class="planche-source">${esc(meta)}</span>` : ""}</div></a></li>`;
  }
  function groupsHtml() {
    const list = sorted();
    if (!list.length) return `<div class="vide-etat"><p class="italique">Ce menu ne contient encore aucune recette.</p>${editor && !menu.deleted_at ? `<button type="button" class="btn" data-act="edit">Modifier le menu</button>` : ""}</div>`;
    return AR.MENU_RUBRIQUES.map(([k, l]) => [k, l, list.filter((x) => x.rubrique === k)]).filter((g) => g[2].length)
      .map(([k, l, g]) => `<section class="menu-groupe" aria-label="${esc(l)}"><h2 class="menu-rub">${esc(l)}</h2><ul class="menu-plats">${g.map(itemHtml).join("")}</ul></section>`).join("");
  }
  function panelHtml() {
    if (st.open === "courses") {
      return `<section class="fo-panneau" id="mn-panneau" aria-label="Ajouter aux courses"><p>Les ingrédients de <strong>toutes les recettes du menu</strong> sont ajoutés à la liste de courses. Les quantités identiques sont additionnées ; sel, poivre et eau sont ignorés.</p>
        <label for="mn-conv">Convives<input id="mn-conv" type="number" inputmode="numeric" min="1" max="99" step="1" placeholder="Portions de chaque recette"></label>
        <p class="aide">Laissez vide pour garder les portions prévues par chaque recette.</p>
        <div><button type="button" class="btn" data-act="courses-go">Ajouter à la liste de courses</button></div>
        <p class="msg ${st.courses.startsWith("!") ? "erreur" : "ok"}" role="status" aria-live="polite">${st.courses.startsWith("!") ? esc(st.courses.slice(1)) : st.courses}</p></section>`;
    }
    if (st.open === "plan") {
      const today = AR.todayIso();
      const opts = Array.from({ length: 28 }, (_, i) => AR.addDays(today, i)).map((d, i) => `<option value="${d}"${i === 1 ? " selected" : ""}>${esc(AR.dayLabel(d))}${i === 0 ? " (aujourd'hui)" : ""}</option>`).join("");
      return `<section class="fo-panneau" id="mn-panneau" aria-label="Mettre au planning"><div class="champs"><label for="mn-day">Jour<select id="mn-day">${opts}</select></label>
        <label for="mn-slot">Repas<select id="mn-slot"><option value="midi">Midi</option><option value="soir" selected>Soir</option></select></label>
        <label for="mn-pconv">Convives (facultatif)<input id="mn-pconv" type="number" inputmode="numeric" min="1" max="99" step="1"></label>
        <div><button type="button" class="btn" data-act="plan-go">Mettre ce menu au planning</button></div></div>
        <p class="msg ${st.plan.startsWith("!") ? "erreur" : "ok"}" role="status" aria-live="polite">${st.plan.startsWith("!") ? esc(st.plan.slice(1)) : st.plan}</p></section>`;
    }
    return "";
  }
  function renderView() {
    const trashed = !!menu.deleted_at, n = items.length;
    const meta = [nbTxt(n), menu.source_type === "pdf" ? "Importé d'un PDF" : "", fmtDate(menu.created_at)].filter(Boolean).join(" · ");
    main.innerHTML = `<p><a class="btn lien" href="/recettes/?type=menus">← Le carnet</a></p>
      ${trashed ? `<div class="bandeau" role="status"><p>Ce menu est dans la corbeille depuis le ${esc(fmtDate(menu.deleted_at))}.</p>${editor ? `<button type="button" class="btn petit" data-act="restore">Restaurer</button>` : ""}</div>` : ""}
      <h1 class="fiche-titre">${esc(menu.title)}</h1>
      <p class="libelle or centre" style="margin:10px 0 0">${esc(meta)}</p>
      <span class="filet" style="margin:18px auto 0" aria-hidden="true"></span>
      ${menu.note ? `<p class="menu-note">${esc(menu.note).replace(/\n/g, "<br>")}</p>` : ""}
      ${editor && !trashed ? `<div class="actions" role="group" aria-label="Actions du menu"><button type="button" class="btn" data-act="edit">Modifier</button>
        <button type="button" class="btn sec" data-act="open" data-k="courses" aria-expanded="${st.open === "courses"}"${n ? "" : " disabled"}>Ajouter aux courses</button>
        <button type="button" class="btn sec" data-act="open" data-k="plan" aria-expanded="${st.open === "plan"}">Mettre au planning</button>
        <a class="btn sec" href="/recettes/reception.html?book=${encodeURIComponent(bookId)}&amp;menu=${encodeURIComponent(menu.id)}">Créer une réception</a></div>
        <div id="mn-outils">${panelHtml()}</div>` : ""}
      ${groupsHtml()}
      ${editor && !trashed ? `<div class="actions-bas"><button type="button" class="btn danger" data-act="trash">Mettre à la corbeille</button></div>` : ""}`;
  }

  // ---- modification
  function editRowHtml(x) {
    return `<li class="mn-ed" data-rid="${esc(x.rid)}"><p class="mn-ed-t">${esc(x.title)}</p>
      <div class="rangee"><label class="sr-only" for="mn-r-${esc(x.rid)}">Rubrique de ${esc(x.title)}</label><select id="mn-r-${esc(x.rid)}" data-f="rub">${AR.MENU_RUBRIQUES.map(([k, l]) => `<option value="${k}"${x.rubrique === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <button type="button" class="btn sec cible" data-mv="-1" aria-label="Monter ${esc(x.title)}">↑</button><button type="button" class="btn sec cible" data-mv="1" aria-label="Descendre ${esc(x.title)}">↓</button>
        <button type="button" class="btn lien" data-act="rm" aria-label="Retirer ${esc(x.title)} du menu">Retirer</button></div></li>`;
  }
  function drawEditList() {
    const box = $("#mn-ed-liste"); if (!box) return;
    const list = sorted();
    box.innerHTML = list.length ? `<ul class="mn-ed-liste">${list.map(editRowHtml).join("")}</ul>` : `<p class="muted italique">Aucune recette pour l'instant.</p>`;
  }
  function renderEdit() {
    main.innerHTML = `<p><a class="btn lien" href="${creating && !menu ? "/recettes/?type=menus" : "#"}" data-act="cancel">← ${menu ? "Annuler les modifications" : "Le carnet"}</a></p>
      <h1 class="chapitre">${menu ? "Modifier le menu" : "Nouveau menu"}</h1><span class="filet" aria-hidden="true"></span>
      <form id="mn-form" class="champs" novalidate>
        <label for="mn-titre">Titre<input id="mn-titre" maxlength="200" autocomplete="off" value="${esc(st.title)}" placeholder="Dîner de Noël"></label>
        <label for="mn-note">Note (facultative)<textarea id="mn-note" maxlength="2000" rows="3">${esc(st.note)}</textarea></label>
        <section><h2 class="section" style="margin-top:12px">Recettes</h2><span class="filet" aria-hidden="true"></span>
          <div id="mn-ed-liste"></div>
          <p><button type="button" class="btn sec" data-act="add">Ajouter une recette du carnet</button></p></section>
        <div class="rangee"><button type="submit" class="btn" id="mn-save">Enregistrer</button><button type="button" class="btn sec" data-act="cancel">Annuler</button></div>
        <p class="msg" id="mn-msg" role="status" aria-live="polite"></p></form>`;
    drawEditList();
  }
  const render = () => (st.edit ? renderEdit() : renderView());

  // ---- feuille « Ajouter une recette du carnet »
  let sheet = null, opener = null, bookRecipes = null;
  function closeSheet() { if (!sheet) return; sheet.remove(); sheet = null; document.body.classList.remove("se-ouvert"); if (opener && document.contains(opener)) opener.focus(); opener = null; }
  async function openSheet() {
    closeSheet();
    sheet = document.createElement("div");
    sheet.className = "se-fond";
    sheet.innerHTML = `<section class="se-feuille" role="dialog" aria-modal="true" aria-labelledby="mn-f-t"><div class="se-f-tete"><h2 id="mn-f-t">Ajouter une recette</h2><button type="button" class="btn sec petit" data-close>Fermer</button></div>
      <label for="mn-rech" class="sr-only">Chercher dans le carnet</label><input id="mn-rech" type="search" placeholder="Chercher dans le carnet…" autocomplete="off"><div id="mn-res" class="se-res"><p class="chargement">Chargement…</p></div></section>`;
    document.body.append(sheet); document.body.classList.add("se-ouvert");
    sheet.addEventListener("click", (e) => { if (e.target === sheet || e.target.closest("[data-close]")) closeSheet(); });
    sheet.addEventListener("keydown", (e) => {
      if (e.key === "Escape") return closeSheet();
      if (e.key !== "Tab") return;
      const f = $$("button:not([disabled]), input, a[href]", sheet).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    $("#mn-rech", sheet).focus();
    try {
      if (!bookRecipes) {
        const { data, error } = await sb.from("recipes").select("id,title,course,servings").eq("book_id", bookId).is("deleted_at", null).is("archived_at", null).order("title").limit(500);
        if (error) throw error;
        bookRecipes = data || [];
      }
    } catch (e) { if (sheet) $("#mn-res", sheet).innerHTML = `<p class="msg erreur" role="alert">${esc(AR.errMsg(e, "Impossible de lire le carnet."))}</p>`; return; }
    if (!sheet) return;
    const show = () => {
      const n = AR.norm($("#mn-rech", sheet).value), have = new Set(items.map((x) => x.rid));
      const f = bookRecipes.filter((r) => !have.has(r.id) && (!n || AR.norm(r.title).includes(n))).slice(0, 80);
      $("#mn-res", sheet).innerHTML = f.length ? `<ul class="se-choix">${f.map((r) => `<li><button type="button" class="se-choix-b" data-rid="${esc(r.id)}"><span class="se-ch-t">${esc(r.title)}</span><span class="se-ch-m">${esc(AR.COURSES[r.course] || "")}</span></button></li>`).join("")}</ul>` : `<p class="muted italique">Aucune recette à ajouter.</p>`;
    };
    $("#mn-rech", sheet).addEventListener("input", show); show();
    $("#mn-res", sheet).addEventListener("click", (e) => {
      const b = e.target.closest("[data-rid]"); if (!b) return;
      const r = bookRecipes.find((x) => x.id === b.dataset.rid); if (!r) return;
      items.push({ rid: r.id, title: r.title, course: r.course, servings: r.servings, rubrique: rubOf(r.course), cover: null });
      closeSheet(); drawEditList(); toast("Recette ajoutée au menu.");
    });
  }

  // ---- enregistrement
  let busy = false;
  async function save() {
    if (busy) return;
    const out = $("#mn-msg"), title = $("#mn-titre").value.replace(/\s+/g, " ").trim(), note = $("#mn-note").value.trim();
    st.title = title; st.note = note;
    if (!title) { setMsg(out, "Donnez un titre au menu.", "erreur"); return void $("#mn-titre").focus(); }
    busy = true; $$("#mn-form button").forEach((b) => (b.disabled = true)); setMsg(out, "Enregistrement…");
    try {
      if (!menu) {
        const id = AR.uuid();
        const ins = await sb.from("recipe_menus").insert({ id, book_id: bookId, title, note: note || null, source_type: "manuel", created_by: ctx.user.id }).select("*").single();
        if (ins.error) throw ins.error;
        menu = ins.data || { id, book_id: bookId, title, note: note || null, source_type: "manuel", created_at: new Date().toISOString() };
        history.replaceState(null, "", `/recettes/menu.html?id=${encodeURIComponent(id)}`);
      } else {
        const up = await sb.from("recipe_menus").update({ title, note: note || null }).eq("id", menu.id).select("*").single();
        if (up.error) throw up.error;
        Object.assign(menu, up.data || { title, note: note || null });
      }
      const keep = new Set(items.map((x) => x.rid)), gone = [...saved.keys()].filter((r) => !keep.has(r));
      if (gone.length) { const r = await sb.from("recipe_menu_items").delete().eq("menu_id", menu.id).in("recipe_id", gone); if (r.error) throw r.error; }
      const adds = [];
      for (const [i, x] of items.entries()) {
        const sig = `${x.rubrique}|${i}`;
        if (!saved.has(x.rid)) adds.push({ menu_id: menu.id, recipe_id: x.rid, position: i, rubrique: x.rubrique });
        else if (saved.get(x.rid) !== sig) { const r = await sb.from("recipe_menu_items").update({ position: i, rubrique: x.rubrique }).eq("menu_id", menu.id).eq("recipe_id", x.rid); if (r.error) throw r.error; }
      }
      if (adds.length) { const r = await sb.from("recipe_menu_items").insert(adds); if (r.error) throw r.error; }
      snapshot();
      // photos des recettes ajoutées : relues pour l'affichage
      const miss = items.filter((x) => x.path === undefined);
      if (miss.length) {
        const rr = await sb.from("recipe_photos").select("recipe_id,storage_path,is_cover").in("recipe_id", miss.map((x) => x.rid)).eq("is_cover", true);
        const urls = await AR.signedUrls((rr.data || []).map((p) => p.storage_path));
        miss.forEach((x) => { const p = (rr.data || []).find((q) => q.recipe_id === x.rid); x.path = p ? p.storage_path : null; x.cover = p ? urls[p.storage_path] || null : null; });
      }
      busy = false; st.edit = false; document.title = `${menu.title} · ARÔMES V&N`;
      render(); toast("Menu enregistré.");
      const h = $("h1"); if (h) { h.setAttribute("tabindex", "-1"); h.focus(); }
    } catch (e) {
      busy = false; $$("#mn-form button").forEach((b) => (b.disabled = false));
      setMsg(out, AR.menuErr(e, "Le menu n'a pas pu être enregistré."), "erreur");
    }
  }

  // ---- actions
  async function addCourses(btn) {
    const v = $("#mn-conv").value.trim(), servings = v === "" ? null : Number(v);
    if (servings != null && (!Number.isInteger(servings) || servings < 1 || servings > 99)) { st.courses = "!Le nombre de convives est un entier entre 1 et 99."; return void refreshPanel("#mn-conv"); }
    btn.disabled = true;
    let added = 0, merged = 0, skipped = 0, done = 0;
    for (const x of items) {
      const { data, error } = await sb.rpc("recipe_shopping_add_recipe", { p_book: bookId, p_recipe: x.rid, p_servings: servings });
      if (error) { st.courses = "!" + AR.errMsg(error, "Les ingrédients n'ont pas pu être ajoutés.") + (done ? ` ${done} recette${done > 1 ? "s" : ""} sur ${items.length} déjà ajoutée${done > 1 ? "s" : ""}.` : ""); return void refreshPanel("[data-act=courses-go]"); }
      const d = data || {}; added += d.added || 0; merged += d.merged || 0; skipped += d.skipped || 0; done++;
    }
    AR.setBookPref(bookId);
    st.courses = `${nbTxt(done)} : ${added} article${added > 1 ? "s" : ""} ajouté${added > 1 ? "s" : ""}, ${merged} fusionné${merged > 1 ? "s" : ""}${skipped ? `, ${skipped} ignoré${skipped > 1 ? "s" : ""}` : ""}. <a href="/recettes/courses.html">Voir la liste de courses</a>`;
    refreshPanel("[data-act=courses-go]");
  }
  async function planify(btn) {
    const day = $("#mn-day").value, slot = $("#mn-slot").value, v = $("#mn-pconv").value.trim(), servings = v === "" ? null : Number(v);
    if (servings != null && (!Number.isInteger(servings) || servings < 1 || servings > 99)) { st.plan = "!Le nombre de convives est un entier entre 1 et 99."; return void refreshPanel("#mn-pconv"); }
    btn.disabled = true;
    try {
      const ex = await sb.from("recipe_meal_plan").select("*").eq("book_id", bookId).eq("day", day).eq("slot", slot).maybeSingle();
      if (ex.error) throw ex.error;
      if (ex.data && (ex.data.recipe_id || (ex.data.menu_id && ex.data.menu_id !== menu.id)) && !confirm("Ce repas a déjà une recette ou un menu. Le remplacer ?")) { btn.disabled = false; return; }
      const patch = { menu_id: menu.id, recipe_id: null, state: ex.data && ex.data.state === "invites" ? "invites" : "prevu" };
      if (servings) patch.servings = servings;
      const res = ex.data ? await sb.from("recipe_meal_plan").update(patch).eq("id", ex.data.id) : await sb.from("recipe_meal_plan").insert({ id: AR.uuid(), book_id: bookId, day, slot, created_by: ctx.user.id, ...patch });
      if (res.error) throw res.error;
      AR.setBookPref(bookId);
      st.plan = `Au planning : ${esc(AR.dayLabel(day))}, ${slot === "midi" ? "midi" : "soir"}. <a href="/recettes/semaine.html">Voir la semaine</a>`;
    } catch (e) { st.plan = "!" + AR.menuErr(e, "Le menu n'a pas pu être mis au planning."); }
    refreshPanel("[data-act=plan-go]");
  }
  function refreshPanel(focus) { const z = $("#mn-outils"); if (z) z.innerHTML = panelHtml(); if (focus) { const f = $(focus); if (f) f.focus(); } }
  async function setTrash(value) {
    const { error } = await sb.from("recipe_menus").update({ deleted_at: value }).eq("id", menu.id);
    if (error) return toast(AR.menuErr(error, "Action impossible. Réessayez."), "erreur");
    menu.deleted_at = value; st.open = null;
    render(); toast(value ? "Menu mis à la corbeille." : "Menu restauré.");
  }

  main.addEventListener("input", (e) => {
    if (e.target.id === "mn-titre") st.title = e.target.value;
    if (e.target.id === "mn-note") st.note = e.target.value;
  });
  main.addEventListener("change", (e) => {
    if (e.target.dataset.f === "rub") {
      const li = e.target.closest("[data-rid]"), x = items.find((y) => y.rid === li.dataset.rid);
      if (x) { x.rubrique = e.target.value; drawEditList(); const s = $(`[data-rid="${CSS.escape(x.rid)}"] select`); if (s) s.focus(); }
    }
  });
  main.addEventListener("submit", (e) => { if (e.target.id === "mn-form") { e.preventDefault(); save(); } });
  main.addEventListener("click", async (e) => {
    const mv = e.target.closest("[data-mv]");
    if (mv) {
      const li = mv.closest("[data-rid]"), i = items.findIndex((y) => y.rid === li.dataset.rid), d = Number(mv.dataset.mv);
      // voisin de la même rubrique dans l'ordre de la liste
      let j = i + d; while (j >= 0 && j < items.length && items[j].rubrique !== items[i].rubrique) j += d;
      if (j >= 0 && j < items.length) { [items[i], items[j]] = [items[j], items[i]]; drawEditList(); const b = $(`[data-rid="${CSS.escape(items[j].rid)}"] [data-mv="${d}"]`) || $(`[data-rid="${CSS.escape(items[j].rid)}"] [data-mv]`); if (b) b.focus(); }
      return;
    }
    const b = e.target.closest("[data-act]"); if (!b) return;
    const a = b.dataset.act;
    if (a === "edit") { st.edit = true; st.open = null; render(); const t = $("#mn-titre"); if (t) t.focus(); return; }
    if (a === "cancel") {
      e.preventDefault();
      if (!menu) return void (location.href = "/recettes/?type=menus");
      st.edit = false; st.title = menu.title; st.note = menu.note || "";
      items = items.filter((x) => saved.has(x.rid)); // les ajouts non enregistrés sont écartés ; l'ordre d'origine est rétabli
      items.sort((x, y) => parseInt(saved.get(x.rid).split("|")[1], 10) - parseInt(saved.get(y.rid).split("|")[1], 10));
      items.forEach((x) => { x.rubrique = saved.get(x.rid).split("|")[0]; });
      return void render();
    }
    if (a === "add") { opener = b; return void openSheet(); }
    if (a === "rm") { const li = b.closest("[data-rid]"); items = items.filter((x) => x.rid !== li.dataset.rid); drawEditList(); const n = $("[data-act=add]"); if (n) n.focus(); return; }
    if (a === "open") { st.open = st.open === b.dataset.k ? null : b.dataset.k; renderView(); const f = $(`[data-act=open][data-k="${b.dataset.k}"]`); if (f) f.focus(); return; }
    if (a === "courses-go") return void addCourses(b);
    if (a === "plan-go") return void planify(b);
    if (a === "trash") { if (!confirm("Mettre ce menu à la corbeille ? Les recettes qu'il contient ne sont pas supprimées.")) return; return void setTrash(new Date().toISOString()); }
    if (a === "restore") return void setTrash(null);
  });

  render();
  if (creating) { const t = $("#mn-titre"); if (t) t.focus(); }
})();
