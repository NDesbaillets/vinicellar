// ARÔMES V&N · la semaine : planning par carnet (midi / soir), suggestions du jour, remplissage guidé, courses.
(async function () {
  const AR = window.AR, { sb, $, $$, esc, errMsg, toast } = AR;
  const ctx = await AR.boot("semaine");
  if (!ctx) return;
  const main = $("#main"), zone = $("#zone"), me = ctx.user.id;
  main.setAttribute("aria-busy", "false");
  const books = ctx.books;
  if (!books.length) { zone.innerHTML = `<div class="vide-etat"><p>Vous n'appartenez à aucun carnet pour le moment.</p></div>`; return; }

  const SLOTS = [["midi", "Midi"], ["soir", "Soir"]];
  const ETATS = { prevu: "Repas prévu", dehors: "Dehors", travail: "Au travail", invites: "Invités" };
  const st = { book: AR.pickBook(books), week: AR.mondayOf(AR.todayIso()) };
  const plan = new Map(); // « jour|créneau » -> ligne
  const recipes = new Map(); // id -> { title, servings, deleted }
  const menus = new Map(); // id -> { title, n, deleted } (contrat 09 : une case peut porter un menu)
  let channel = null, pollT = null, lastSig = "", opener = null;
  const book = () => books.find((b) => b.id === st.book);
  const editor = () => !!book() && book().role !== "reader";
  const key = (d, s) => d + "|" + s;
  const days = () => Array.from({ length: 7 }, (_, i) => AR.addDays(st.week, i));

  zone.innerHTML = `
    <div class="ligne-filtres" style="grid-template-columns:1fr"><label for="se-book">Carnet<select id="se-book">${books.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}${b.role === "reader" ? " (lecture)" : ""}</option>`).join("")}</select></label></div>
    <div class="se-nav" role="group" aria-label="Changer de semaine">
      <button type="button" class="btn sec petit" id="se-prev" aria-label="Semaine précédente">←<span class="sr-only"> Semaine précédente</span></button>
      <div class="se-sem"><span class="libelle" id="se-lib"></span><button type="button" class="btn lien" id="se-today">Cette semaine</button></div>
      <button type="button" class="btn sec petit" id="se-next" aria-label="Semaine suivante">→<span class="sr-only"> Semaine suivante</span></button></div>
    <div id="se-outils" class="se-outils"></div>
    <p class="msg" id="se-msg" role="status" aria-live="polite"></p>
    <div id="se-grille" aria-busy="true"><p class="chargement">Chargement de la semaine…</p></div>`;
  $("#se-book").value = st.book;

  // ---- chargement
  async function fetchWeek() {
    const to = AR.addDays(st.week, 6);
    const { data, error } = await sb.from("recipe_meal_plan").select("*").eq("book_id", st.book).gte("day", st.week).lte("day", to);
    if (error) throw error;
    const rows = data || [];
    const need = [...new Set(rows.map((r) => r.recipe_id).filter((x) => x && !recipes.has(x)))];
    if (need.length) {
      const rr = await sb.from("recipes").select("id,title,servings,deleted_at").in("id", need);
      if (rr.error) throw rr.error;
      (rr.data || []).forEach((r) => recipes.set(r.id, { title: r.title, servings: r.servings, deleted: !!r.deleted_at }));
    }
    const needM = [...new Set(rows.map((r) => r.menu_id).filter((x) => x && !menus.has(x)))];
    if (needM.length) {
      const mm = await sb.from("recipe_menus").select("id,title,deleted_at,recipe_menu_items(recipe_id)").in("id", needM);
      if (mm.error) console.error(mm.error);
      else (mm.data || []).forEach((m) => menus.set(m.id, { title: m.title, n: (m.recipe_menu_items || []).length, deleted: !!m.deleted_at }));
    }
    return rows;
  }
  async function load(silent) {
    const g = $("#se-grille");
    if (!silent) { g.setAttribute("aria-busy", "true"); g.innerHTML = `<p class="chargement">Chargement de la semaine…</p>`; }
    try {
      const rows = await fetchWeek();
      const sig = JSON.stringify(rows.map((r) => [r.id, r.day, r.slot, r.state, r.recipe_id, r.menu_id, r.servings, r.note, r.reception_id]).sort()) + st.week + st.book;
      if (silent && sig === lastSig) return;
      lastSig = sig;
      plan.clear(); rows.forEach((r) => plan.set(key(String(r.day).slice(0, 10), r.slot), r));
      render();
    } catch (e) { if (!silent) g.innerHTML = `<p class="msg erreur" role="alert">${esc(errMsg(e, "Impossible de charger la semaine."))}</p>`; else console.error(e); }
  }

  // ---- affichage
  function cellHtml(day, slot, label) {
    const r = plan.get(key(day, slot)), ed = editor();
    const dl = `${AR.cap(AR.JOURS[AR.weekdayOf(day)])} ${slot === "midi" ? "midi" : "soir"}`;
    const data = `data-day="${day}" data-slot="${slot}"`;
    if (!r) {
      return `<div class="se-case se-vide" ${data}><span class="libelle">${label}</span>${ed ? `<button type="button" class="btn sec petit" data-act="on" aria-label="Prévoir le repas : ${esc(dl)}">Prévoir ce repas</button>` : `<span class="muted italique">Rien de prévu</span>`}</div>`;
    }
    const rec = r.recipe_id ? recipes.get(r.recipe_id) : null;
    const withRecipe = r.state === "prevu" || r.state === "invites";
    let corps = "";
    if (!withRecipe) corps = `<p class="muted italique se-txt">Pas de repas à préparer.</p>`;
    else if (r.recipe_id) corps = `<p class="se-recette">${rec && !rec.deleted ? `<a href="/recettes/fiche.html?id=${encodeURIComponent(r.recipe_id)}">${esc(rec.title)}</a>` : `<span class="muted italique">${rec ? "Recette dans la corbeille" : "Recette indisponible"}</span>`}</p>
      ${ed ? `<div class="rangee"><button type="button" class="btn sec petit" data-act="pick" aria-label="Changer la recette : ${esc(dl)}">Changer</button><button type="button" class="btn lien" data-act="norecipe" aria-label="Retirer la recette : ${esc(dl)}">Retirer la recette</button></div>` : ""}`;
    else if (r.menu_id) {
      const mn = menus.get(r.menu_id), ok = mn && !mn.deleted;
      corps = `<p class="se-recette">${ok ? `<a href="/recettes/menu.html?id=${encodeURIComponent(r.menu_id)}">${esc(mn.title)}</a>` : `<span class="muted italique">${mn ? "Menu dans la corbeille" : "Menu indisponible"}</span>`}</p>
        ${ok ? `<p class="se-txt muted">Menu · ${mn.n} plat${mn.n > 1 ? "s" : ""}</p>` : ""}
        ${ed ? `<div class="rangee"><button type="button" class="btn sec petit" data-act="pick" aria-label="Changer le menu : ${esc(dl)}">Changer</button><button type="button" class="btn lien" data-act="nomenu" aria-label="Retirer le menu : ${esc(dl)}">Retirer le menu</button></div>` : ""}`;
    }
    else corps = ed ? `<div class="rangee"><button type="button" class="btn petit" data-act="pick" aria-label="Choisir une recette ou un menu : ${esc(dl)}">Choisir une recette</button></div>` : `<p class="muted italique se-txt">Pas encore de recette.</p>`;
    const inv = r.state === "invites" && (ed || r.reception_id)
      ? `<div class="rangee se-inv">${ed ? `<button type="button" class="btn sec petit" data-act="invites" aria-label="Choisir les invités : ${esc(dl)}">Invités…</button>` : ""}${r.reception_id ? `<a class="btn lien" href="/recettes/reception.html?id=${encodeURIComponent(r.reception_id)}">Voir la réception</a>` : ""}</div>` : "";
    const ctrl = ed
      ? `<div class="se-ctrl"><select data-f="state" aria-label="État du repas : ${esc(dl)}">${Object.entries(ETATS).map(([k, l]) => `<option value="${k}"${r.state === k ? " selected" : ""}>${l}</option>`).join("")}</select>
        ${withRecipe ? `<label class="se-conv">Convives<input type="number" inputmode="numeric" min="1" max="99" step="1" data-f="servings" value="${r.servings == null ? "" : esc(r.servings)}" aria-label="Convives : ${esc(dl)}"></label>` : ""}</div>`
      : `<p class="se-etat"><span class="libelle or">${ETATS[r.state]}</span>${withRecipe && r.servings ? ` <span class="muted">· ${r.servings} convive${r.servings > 1 ? "s" : ""}</span>` : ""}</p>`;
    return `<div class="se-case" ${data}><div class="se-case-tete"><span class="libelle">${label}</span>${ed ? `<button type="button" class="btn lien" data-act="off" aria-label="Retirer ce repas du planning : ${esc(dl)}">Retirer le repas</button>` : ""}</div>${ctrl}${corps}${inv}</div>`;
  }
  function render() {
    const g = $("#se-grille"), today = AR.todayIso(), ds = days();
    $("#se-lib").textContent = `Du ${AR.fmtDay(ds[0])} au ${AR.fmtDay(ds[6])}`;
    $("#se-today").hidden = st.week === AR.mondayOf(today);
    $("#se-outils").innerHTML = editor()
      ? `<button type="button" class="btn sec" data-top="rythme">Reprendre le rythme de la semaine dernière</button>
         <button type="button" class="btn sec" data-top="remplir">Remplir ma semaine</button>
         <button type="button" class="btn" data-top="courses">Ajouter la semaine aux courses</button>
         <a class="btn lien" href="/recettes/invites.html?book=${encodeURIComponent(st.book)}">Invités et réceptions</a>`
      : `<p class="muted italique">Vous consultez ce planning en lecture seule.</p><a class="btn lien" href="/recettes/invites.html?book=${encodeURIComponent(st.book)}">Invités et réceptions</a>`;
    g.setAttribute("aria-busy", "false");
    g.innerHTML = ds.map((d) => `<section class="se-jour${d === today ? " se-auj" : ""}" aria-label="${esc(AR.dayLabel(d))}"><h2 class="se-jour-t">${esc(AR.cap(AR.JOURS[AR.weekdayOf(d)]))} <span>${esc(AR.fmtDay(d))}</span>${d === today ? ` <span class="se-badge">Aujourd'hui</span>` : ""}</h2>
      ${SLOTS.map(([s, l]) => cellHtml(d, s, l)).join("")}</section>`).join("");
  }

  // ---- écriture d'une case : insert si la case n'existe pas, update sinon (created_by n'est pas modifiable)
  async function saveCell(day, slot, patch) {
    const ex = plan.get(key(day, slot));
    let res;
    if (ex) res = await sb.from("recipe_meal_plan").update(patch).eq("id", ex.id).select("*").single();
    else {
      res = await sb.from("recipe_meal_plan").insert({ id: AR.uuid(), book_id: st.book, day, slot, state: "prevu", recipe_id: null, servings: null, created_by: me, ...patch }).select("*").single();
      if (res.error && res.error.code === "23505") { await load(true); return saveCell(day, slot, patch); }
    }
    if (res.error) { toast(errMsg(res.error, "Le planning n'a pas pu être modifié."), "erreur"); return null; }
    plan.set(key(day, slot), res.data);
    lastSig = "";
    return res.data;
  }
  async function removeCell(day, slot) {
    const ex = plan.get(key(day, slot)); if (!ex) return true;
    const { error } = await sb.from("recipe_meal_plan").delete().eq("id", ex.id);
    if (error) { toast(errMsg(error, "Impossible de retirer ce repas."), "erreur"); return false; }
    plan.delete(key(day, slot)); lastSig = ""; return true;
  }

  // ---- feuille de choix (recette du carnet, suggestion du jour, remplissage guidé)
  let sheet = null;
  function openSheet(titre, sous) {
    closeSheet();
    sheet = document.createElement("div");
    sheet.className = "se-fond";
    sheet.innerHTML = `<section class="se-feuille" role="dialog" aria-modal="true" aria-labelledby="se-f-t"><div class="se-f-tete"><div><h2 id="se-f-t">${esc(titre)}</h2><p class="libelle or" style="margin:2px 0 0">${esc(sous || "")}</p></div><button type="button" class="btn sec petit" data-close>Fermer</button></div><div class="se-f-corps" id="se-f-corps"></div></section>`;
    document.body.append(sheet);
    document.body.classList.add("se-ouvert");
    sheet.addEventListener("click", (e) => { if (e.target === sheet || e.target.closest("[data-close]")) closeSheet(); });
    sheet.addEventListener("keydown", (e) => {
      if (e.key === "Escape") return closeSheet();
      if (e.key !== "Tab") return;
      const f = $$("button:not([disabled]), input, select, a[href]", sheet).filter((x) => !x.hidden && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    return $("#se-f-corps", sheet);
  }
  function closeSheet() {
    if (!sheet) return;
    sheet.remove(); sheet = null; document.body.classList.remove("se-ouvert");
    if (opener && document.contains(opener)) opener.focus(); else if ($("#se-grille")) $("#se-grille").focus?.();
    opener = null;
  }

  let bookRecipes = null;
  async function loadBookRecipes() {
    if (bookRecipes && bookRecipes.book === st.book) return bookRecipes.rows;
    const { data, error } = await sb.from("recipes").select("id,title,course,servings,time_total_min,review_state").eq("book_id", st.book).is("deleted_at", null).is("archived_at", null).order("title").limit(500);
    if (error) throw error;
    bookRecipes = { book: st.book, rows: data || [] };
    return bookRecipes.rows;
  }
  async function choose(day, slot, rid, servings) {
    const ex = plan.get(key(day, slot));
    const patch = { recipe_id: rid, state: ex && ex.state === "invites" ? "invites" : "prevu" };
    if (ex && ex.menu_id) patch.menu_id = null; // une case a une recette ou un menu, pas les deux
    if (!(ex && ex.servings) && servings) patch.servings = servings;
    const row = await saveCell(day, slot, patch);
    if (row) { const rr = bookRecipes && bookRecipes.rows.find((x) => x.id === rid); if (rr) recipes.set(rid, { title: rr.title, servings: rr.servings, deleted: false }); }
    return row;
  }
  function pickSheet(day, slot) {
    const lab = `${AR.dayLabel(day)} · ${slot === "midi" ? "midi" : "soir"}`;
    const body = openSheet("Choisir une recette ou un menu", lab);
    body.innerHTML = `<div class="onglets" role="group" aria-label="Origine du choix"><button type="button" class="onglet" data-t="carnet" aria-pressed="true">Dans le carnet</button><button type="button" class="onglet" data-t="sugg" aria-pressed="false">Suggestions</button><button type="button" class="onglet" data-t="menus" aria-pressed="false">Menus</button></div><div id="se-pick" class="panneau"></div>`;
    const zonePick = $("#se-pick", body);
    async function tabCarnet() {
      zonePick.innerHTML = `<label for="se-rech" class="sr-only">Chercher dans le carnet</label><input id="se-rech" type="search" placeholder="Chercher dans le carnet…" autocomplete="off"><div id="se-res" class="se-res"><p class="chargement">Chargement…</p></div>`;
      let rows = [];
      try { rows = await loadBookRecipes(); } catch (e) { $("#se-res").innerHTML = `<p class="msg erreur" role="alert">${esc(errMsg(e, "Impossible de lire le carnet."))}</p>`; return; }
      const show = () => {
        const n = AR.norm($("#se-rech").value), f = rows.filter((r) => !n || AR.norm(r.title).includes(n)).slice(0, 80);
        $("#se-res").innerHTML = f.length ? `<ul class="se-choix">${f.map((r) => `<li><button type="button" class="se-choix-b" data-rid="${esc(r.id)}"><span class="se-ch-t">${esc(r.title)}</span><span class="se-ch-m">${esc([AR.COURSES[r.course] || "", r.time_total_min ? AR.fmtMin(r.time_total_min) : "", r.review_state === "a_verifier" ? "À vérifier" : ""].filter(Boolean).join(" · "))}</span></button></li>`).join("")}</ul>` : `<p class="muted italique">Aucune recette ne correspond.</p>`;
      };
      $("#se-rech").addEventListener("input", show); show(); $("#se-rech").focus();
    }
    async function tabSugg() {
      zonePick.innerHTML = `<p class="chargement">Recherche de suggestions…</p>`;
      try {
        const m = +day.slice(5, 7), wd = AR.weekdayOf(day) < 5;
        const { data, error } = await sb.rpc("recipe_suggestions", { p_book_ids: [st.book], p_for_users: null, p_month: m, p_limit: 12, p_weekday: wd });
        if (error) throw error;
        const cards = await AR.fetchCards((data || []).map((x) => x.recipe_id));
        const rows = AR.dedupeVersions((data || []).filter((x) => cards.has(x.recipe_id)), (x) => cards.get(x.recipe_id).version_group);
        zonePick.innerHTML = rows.length ? `<ul class="se-choix">${rows.map((x) => { const c = cards.get(x.recipe_id); return `<li class="se-sug"><button type="button" class="se-choix-b" data-rid="${esc(c.id)}"><span class="se-ch-t">${esc(c.title)}</span></button><ul class="sa-raisons">${(x.raisons || []).map((t) => `<li>${esc(t)}</li>`).join("")}</ul></li>`; }).join("")}</ul>` : `<p class="muted italique">Aucune suggestion pour ce jour.</p>`;
        rows.forEach((x) => { const c = cards.get(x.recipe_id); bookRecipes = bookRecipes && bookRecipes.book === st.book ? bookRecipes : { book: st.book, rows: [] }; if (!bookRecipes.rows.some((y) => y.id === c.id)) bookRecipes.rows.push({ id: c.id, title: c.title, servings: c.servings, course: c.course }); });
      } catch (e) { zonePick.innerHTML = `<p class="msg erreur" role="alert">${esc(errMsg(e, "Impossible de calculer les suggestions."))}</p>`; }
    }
    // Menus du carnet : la case reçoit le menu (menu_id) à la place d'une recette.
    async function tabMenus() {
      zonePick.innerHTML = `<p class="chargement">Chargement des menus…</p>`;
      try {
        const { data, error } = await sb.from("recipe_menus").select("id,title,recipe_menu_items(recipe_id)").eq("book_id", st.book).is("deleted_at", null).order("title").limit(200);
        if (error) throw error;
        const rows = data || [];
        rows.forEach((m) => menus.set(m.id, { title: m.title, n: (m.recipe_menu_items || []).length, deleted: false }));
        zonePick.innerHTML = rows.length ? `<ul class="se-choix">${rows.map((m) => `<li><button type="button" class="se-choix-b" data-mid="${esc(m.id)}"><span class="se-ch-t">${esc(m.title)}</span><span class="se-ch-m">${(m.recipe_menu_items || []).length} plat${(m.recipe_menu_items || []).length > 1 ? "s" : ""}</span></button></li>`).join("")}</ul>` : `<p class="muted italique">Aucun menu dans ce carnet. <a href="/recettes/?type=menus">Voir les menus</a></p>`;
      } catch (e) { zonePick.innerHTML = `<p class="msg erreur" role="alert">${esc(AR.menuErr(e, "Impossible de lire les menus."))}</p>`; }
    }
    body.addEventListener("click", async (e) => {
      const t = e.target.closest("[data-t]");
      if (t) { $$("[data-t]", body).forEach((b) => b.setAttribute("aria-pressed", String(b === t))); return void (t.dataset.t === "carnet" ? tabCarnet() : t.dataset.t === "menus" ? tabMenus() : tabSugg()); }
      const mb = e.target.closest("[data-mid]");
      if (mb) {
        mb.disabled = true;
        const row = await saveCell(day, slot, { menu_id: mb.dataset.mid, recipe_id: null, state: (plan.get(key(day, slot)) || {}).state === "invites" ? "invites" : "prevu" });
        if (!row) { mb.disabled = false; return; }
        closeSheet(); render(); toast("Menu ajouté au planning."); return;
      }
      const b = e.target.closest("[data-rid]"); if (!b) return;
      b.disabled = true;
      const rr = bookRecipes && bookRecipes.rows.find((x) => x.id === b.dataset.rid);
      const row = await choose(day, slot, b.dataset.rid, rr && rr.servings);
      if (!row) { b.disabled = false; return; }
      closeSheet(); render(); toast("Recette ajoutée au planning.");
    });
    tabCarnet();
  }

  // ---- « Invités… » : choix des invités d'une case « invités », puis création ou mise à jour de la réception (recipe_plan_to_reception)
  async function invitesSheet(day, slot) {
    const row = plan.get(key(day, slot)); if (!row) return;
    const lab = `${AR.dayLabel(day)} · ${slot === "midi" ? "midi" : "soir"}`;
    const body = openSheet("Invités", lab);
    body.innerHTML = `<p class="chargement">Chargement des invités…</p>`;
    let guests, chosen = new Set();
    try {
      const g = await sb.from("recipe_guests").select("id,name,household,archived_at").eq("book_id", st.book).order("name");
      if (g.error) throw g.error;
      if (row.reception_id) {
        const c = await sb.from("recipe_reception_guests").select("guest_id").eq("reception_id", row.reception_id);
        if (c.error) throw c.error;
        chosen = new Set((c.data || []).map((x) => x.guest_id));
      }
      guests = (g.data || []).filter((x) => !x.archived_at || chosen.has(x.id));
    } catch (e) { body.innerHTML = `<p class="msg erreur" role="alert">${esc(errMsg(e, "Impossible de lire les invités."))}</p>`; return; }
    const upd = !!row.reception_id;
    body.innerHTML = `<form id="se-inv-form" class="champs" novalidate>
      ${guests.length ? `<fieldset class="pf-groupe"><legend class="libelle or">Qui est invité ?</legend><div class="se-inv-liste">${guests.map((x) => `<label class="case pf-case"><input type="checkbox" name="inv" value="${esc(x.id)}"${chosen.has(x.id) ? " checked" : ""}> <span>${esc(x.name)}${x.household ? ` <span class="muted">· ${esc(x.household)}</span>` : ""}${x.archived_at ? ` <span class="muted">(archivé)</span>` : ""}</span></label>`).join("")}</div></fieldset>`
        : `<p class="muted italique">Aucun invité dans ce carnet pour l'instant. Vous pouvez créer la réception sans invités, ou <a href="/recettes/invite.html?book=${encodeURIComponent(st.book)}&amp;nouveau=1">ajouter un invité</a> d'abord.</p>`}
      <p class="aide">${upd ? "La réception existe déjà : sa liste d'invités sera remplacée par ce choix. Le menu, le titre, la note et la photo sont conservés." : "La réception reprend le jour, le créneau, la note, le nombre de convives et la recette de cette case."}</p>
      <div class="rangee"><button type="submit" class="btn">${upd ? "Mettre à jour la réception" : "Créer la réception"}</button></div>
      <p class="msg" id="se-inv-msg" role="status" aria-live="polite"></p></form>`;
    const first = $("input[name=inv]", body) || $("button[type=submit]", body); if (first) first.focus();
    $("#se-inv-form", body).addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("button[type=submit]", body), out = $("#se-inv-msg", body);
      btn.disabled = true; out.textContent = "Enregistrement…"; out.className = "msg";
      const ids = $$("input[name=inv]:checked", body).map((x) => x.value);
      const { data, error } = await sb.rpc("recipe_plan_to_reception", { p_plan: row.id, p_guest_ids: ids });
      if (error) { btn.disabled = false; out.className = "msg erreur"; out.textContent = errMsg(error, "La réception n'a pas pu être créée."); return; }
      row.reception_id = data || row.reception_id; lastSig = "";
      closeSheet();
      toast(upd ? "Réception mise à jour." : "Réception créée : elle apparaît dans la case.");
      await load(true); render();
      const lk = $(`[data-day="${day}"][data-slot="${slot}"] a[href*="reception.html"]`); if (lk) lk.focus();
    });
  }

  // ---- « Remplir ma semaine » : une proposition par case vide, validée une par une
  async function remplir() {
    const empty = days().flatMap((d) => SLOTS.map(([s]) => [d, s])).filter(([d, s]) => { const r = plan.get(key(d, s)); return r && r.state === "prevu" && !r.recipe_id && !r.menu_id; });
    if (!empty.length) return void toast("Aucune case vide à remplir : prévoyez d'abord vos repas, ou reprenez le rythme de la semaine dernière.", "erreur");
    opener = $('[data-top="remplir"]');
    const body = openSheet("Remplir ma semaine", "Rien n'est enregistré sans votre accord");
    body.innerHTML = `<p class="chargement">Recherche de suggestions…</p>`;
    let pools;
    try {
      const get = async (wd) => { const { data, error } = await sb.rpc("recipe_suggestions", { p_book_ids: [st.book], p_for_users: null, p_month: +st.week.slice(5, 7), p_limit: 40, p_weekday: wd }); if (error) throw error; return data || []; };
      const [a, b] = await Promise.all([get(true), get(false)]);
      const cards = await AR.fetchCards([...new Set([...a, ...b].map((x) => x.recipe_id))]);
      const clean = (l) => AR.dedupeVersions(l.filter((x) => cards.has(x.recipe_id)), (x) => cards.get(x.recipe_id).version_group).map((x) => ({ ...x, card: cards.get(x.recipe_id) }));
      pools = { wd: clean(a), we: clean(b) };
    } catch (e) { body.innerHTML = `<p class="msg erreur" role="alert">${esc(errMsg(e, "Impossible de calculer les suggestions."))}</p>`; return; }
    const used = new Set([...plan.values()].map((r) => r.recipe_id).filter(Boolean));
    const tried = new Set();
    let i = 0, ok = 0;
    const poolFor = (d) => (AR.weekdayOf(d) < 5 ? pools.wd : pools.we);
    const nextFor = (d) => poolFor(d).find((x) => !used.has(x.recipe_id) && !tried.has(x.recipe_id));
    function step() {
      if (!sheet) return;
      if (i >= empty.length) { body.innerHTML = `<p class="se-fin">${ok ? `${ok} repas ajouté${ok > 1 ? "s" : ""} au planning.` : "Aucun repas ajouté."}</p><button type="button" class="btn" data-close>Terminé</button>`; render(); $("[data-close]", body).focus(); return; }
      const [d, s] = empty[i], p = nextFor(d);
      const lab = `${AR.dayLabel(d)} · ${s === "midi" ? "midi" : "soir"}`;
      if (!p) { body.innerHTML = `<p class="libelle or">Case ${i + 1} sur ${empty.length} · ${esc(lab)}</p><p class="muted italique">Plus de suggestion disponible pour cette case.</p><div class="rangee"><button type="button" class="btn sec" data-w="skip">Passer</button></div>`; $("[data-w=skip]", body).focus(); return; }
      const c = p.card;
      body.innerHTML = `<p class="libelle or" aria-live="polite">Case ${i + 1} sur ${empty.length} · ${esc(lab)}</p>
        <div class="se-prop"><div class="se-prop-photo"><div class="passe-partout"><div class="cadre">${c.cover ? `<img src="${esc(c.cover)}" alt="">` : `<span class="vide">Sans photo</span>`}</div></div></div>
        <div><p class="se-prop-t">${esc(c.title)}</p><ul class="sa-raisons">${(p.raisons || []).map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div></div>
        <div class="rangee se-prop-b"><button type="button" class="btn" data-w="ok">Valider</button><button type="button" class="btn sec" data-w="other">Une autre</button><button type="button" class="btn sec" data-w="skip">Passer</button></div>`;
      $("[data-w=ok]", body).focus();
    }
    body.addEventListener("click", async (e) => {
      const w = e.target.closest("[data-w]"); if (!w) return;
      const [d, s] = empty[i], p = nextFor(d);
      if (w.dataset.w === "other") { if (p) tried.add(p.recipe_id); return step(); }
      if (w.dataset.w === "skip") { i++; return step(); }
      if (w.dataset.w === "ok" && p) {
        $$("button", body).forEach((b) => (b.disabled = true));
        const ex = plan.get(key(d, s));
        const row = await saveCell(d, s, { recipe_id: p.recipe_id, servings: ex && ex.servings ? ex.servings : p.card.servings || null });
        if (!row) { $$("button", body).forEach((b) => (b.disabled = false)); return; }
        recipes.set(p.recipe_id, { title: p.card.title, servings: p.card.servings, deleted: false });
        used.add(p.recipe_id); ok++; i++; step();
      }
    });
    step();
  }

  // ---- actions de la page
  async function topAction(a, btn) {
    btn.disabled = true;
    try {
      if (a === "rythme") {
        const { data, error } = await sb.rpc("recipe_plan_copy_rhythm", { p_book: st.book, p_from_week: AR.addDays(st.week, -7), p_to_week: st.week });
        if (error) throw error;
        toast(data > 0 ? `${data} repas repris de la semaine précédente.` : "Rien à reprendre : la semaine précédente est vide, ou la semaine est déjà remplie.");
        await load(true);
      } else if (a === "courses") {
        const { data, error } = await sb.rpc("recipe_shopping_add_plan", { p_book: st.book, p_from: st.week, p_to: AR.addDays(st.week, 6) });
        if (error) throw error;
        const n = (data && data.recipes) || 0;
        $("#se-msg").className = "msg ok";
        $("#se-msg").innerHTML = n ? `${n} recette${n > 1 ? "s" : ""} : ${data.added || 0} article${data.added > 1 ? "s" : ""} ajouté${data.added > 1 ? "s" : ""}, ${data.merged || 0} fusionné${data.merged > 1 ? "s" : ""}. <a href="/recettes/courses.html">Voir la liste de courses</a>` : "Aucune recette planifiée cette semaine : rien à ajouter.";
      } else if (a === "remplir") await remplir();
    } catch (e) { toast(errMsg(e, "Action impossible. Réessayez."), "erreur"); }
    btn.disabled = false;
  }

  zone.addEventListener("click", async (e) => {
    const top = e.target.closest("[data-top]"); if (top) { opener = top; return void topAction(top.dataset.top, top); }
    if (e.target.closest("#se-prev")) { st.week = AR.addDays(st.week, -7); lastSig = ""; return void load(); }
    if (e.target.closest("#se-next")) { st.week = AR.addDays(st.week, 7); lastSig = ""; return void load(); }
    if (e.target.closest("#se-today")) { st.week = AR.mondayOf(AR.todayIso()); lastSig = ""; return void load(); }
    const b = e.target.closest("[data-act]"); if (!b) return;
    const cell = b.closest(".se-case"), day = cell.dataset.day, slot = cell.dataset.slot;
    if (b.dataset.act === "pick") { opener = b; return void pickSheet(day, slot); }
    if (b.dataset.act === "invites") { opener = b; return void invitesSheet(day, slot); }
    b.disabled = true;
    let ok = true;
    if (b.dataset.act === "on") ok = !!(await saveCell(day, slot, { state: "prevu" }));
    else if (b.dataset.act === "off") { if ((plan.get(key(day, slot)).recipe_id || plan.get(key(day, slot)).menu_id) && !confirm("Retirer ce repas du planning ?")) { b.disabled = false; return; } ok = await removeCell(day, slot); }
    else if (b.dataset.act === "norecipe") ok = !!(await saveCell(day, slot, { recipe_id: null }));
    else if (b.dataset.act === "nomenu") ok = !!(await saveCell(day, slot, { menu_id: null }));
    render();
    if (!ok) return;
    const nb = $(`[data-day="${day}"][data-slot="${slot}"] button, [data-day="${day}"][data-slot="${slot}"] select`); if (nb) nb.focus();
  });
  zone.addEventListener("change", async (e) => {
    if (e.target.id === "se-book") { st.book = e.target.value; AR.setBookPref(st.book); bookRecipes = null; lastSig = ""; subscribe(); return void load(); }
    const f = e.target.dataset.f; if (!f) return;
    const cell = e.target.closest(".se-case"), day = cell.dataset.day, slot = cell.dataset.slot;
    let patch;
    if (f === "state") { patch = { state: e.target.value }; if (e.target.value === "dehors" || e.target.value === "travail") { patch.recipe_id = null; const cur = plan.get(key(day, slot)); if (cur && cur.menu_id) patch.menu_id = null; } }
    else {
      const v = e.target.value.trim() === "" ? null : Number(e.target.value);
      if (v != null && (!Number.isInteger(v) || v < 1 || v > 99)) { toast("Le nombre de convives doit être un entier entre 1 et 99.", "erreur"); return render(); }
      patch = { servings: v };
    }
    await saveCell(day, slot, patch); render();
    const nb = $(`[data-day="${day}"][data-slot="${slot}"] [data-f="${f}"]`); if (nb) nb.focus();
  });

  // ---- temps réel (repli : sondage toutes les 20 s)
  const onChange = AR.debounce(() => load(true), 400);
  function startPoll() { if (!pollT) pollT = setInterval(() => { if (!document.hidden) load(true); }, 20000); }
  function stopPoll() { clearInterval(pollT); pollT = null; }
  function subscribe() {
    if (channel) { sb.removeChannel(channel); channel = null; }
    stopPoll();
    try {
      channel = sb.channel("semaine-" + st.book).on("postgres_changes", { event: "*", schema: "public", table: "recipe_meal_plan", filter: `book_id=eq.${st.book}` }, onChange)
        .subscribe((s) => { if (s === "SUBSCRIBED") stopPoll(); else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") startPoll(); });
    } catch (e) { console.error(e); startPoll(); }
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(true); });
  window.addEventListener("pagehide", () => { if (channel) sb.removeChannel(channel); stopPoll(); });

  await load();
  subscribe();
})();
