// ARÔMES V&N · une réception : date, invités, menu par service, vins, note, photo, inscription au journal. Contrat : docs/recettes/07-invites-contrat.md.
// Confidentialité : invités, allergies et réceptions ne sortent jamais du carnet (ni lien public, ni livre, ni export).
(async function () {
  const AR = window.AR, { sb, $, $$, esc, errMsg, toast, setMsg } = AR;
  const ctx = await AR.boot("invites");
  if (!ctx) return;
  const main = $("#main"), zone = $("#zone");
  const qs = new URLSearchParams(location.search);
  const rid = qs.get("id");
  const fail = (m) => { main.setAttribute("aria-busy", "false"); zone.innerHTML = `<div class="vide-etat"><p role="alert">${esc(m)}</p><a class="btn sec petit" href="/recettes/invites.html">Retour aux invités</a></div>`; };

  let rec = null, bookId = qs.get("book");
  if (rid) {
    try {
      const r = await sb.from("recipe_receptions").select("*, recipe_reception_guests(guest_id), recipe_reception_dishes(*), recipe_reception_wines(*)").eq("id", rid).maybeSingle();
      if (r.error) throw r.error;
      rec = r.data;
    } catch (e) { return fail(errMsg(e, "Impossible de charger cette réception.")); }
    if (!rec) return fail("Réception introuvable, ou vous n'avez pas accès à son carnet.");
    bookId = rec.book_id;
  }
  const book = ctx.books.find((b) => b.id === bookId);
  if (!book) return fail("Carnet introuvable, ou vous n'y avez pas accès.");
  const editor = book.role !== "reader";
  if (!rec && !editor) return fail("Votre rôle de lecteur ne permet pas de créer une réception.");
  main.setAttribute("aria-busy", "false");
  $("#page-titre").textContent = rec ? "Réception" : "Nouvelle réception";

  // ---- pré-remplissage depuis un menu : reception.html?book=…&menu=… (contrat 09 §3). Rien n'est créé avant « Créer la réception ».
  let fromMenu = null;
  const menuQ = !rec && editor ? qs.get("menu") : null;
  if (menuQ) {
    try {
      const [m, it] = await Promise.all([
        sb.from("recipe_menus").select("id,title,book_id,deleted_at").eq("id", menuQ).maybeSingle(),
        sb.from("recipe_menu_items").select("position,rubrique,recipes(id,title,deleted_at)").eq("menu_id", menuQ).order("position")]);
      if (m.error) throw m.error;
      if (it.error) throw it.error;
      if (m.data && m.data.book_id === bookId && !m.data.deleted_at) {
        const order = new Map(AR.MENU_RUBRIQUES.map(([k], i) => [k, i]));
        const rows = (it.data || []).filter((x) => x.recipes && !x.recipes.deleted_at).sort((a, b) => (order.get(a.rubrique) ?? 99) - (order.get(b.rubrique) ?? 99) || a.position - b.position);
        fromMenu = { id: m.data.id, title: m.data.title, rows };
      } else toast("Ce menu est introuvable dans ce carnet : la réception est créée vide.", "erreur");
    } catch (e) { toast(AR.menuErr(e, "Le menu n'a pas pu être lu : la réception est créée vide."), "erreur"); }
  }

  // ---- état du formulaire
  const dateQs = /^\d{4}-\d{2}-\d{2}$/.test(qs.get("date") || "") ? qs.get("date") : AR.todayIso();
  const dishOf = (d) => ({ k: AR.uuid(), id: d.id || null, recipe_id: d.recipe_id || null, label: d.label || "", course: d.course || "plat", position: d.position || 0 });
  const wineOf = (w) => ({ k: AR.uuid(), id: w.id || null, label: w.label || "", note: w.note || "" });
  const st = { day: rec ? String(rec.day).slice(0, 10) : dateQs, slot: rec ? rec.slot : null, title: rec ? rec.title || "" : "", members: rec ? rec.members_count : null, note: rec ? rec.note || "" : "",
    photo: rec ? rec.photo_path : null, file: null, photoUrl: null, guests: new Set(rec ? (rec.recipe_reception_guests || []).map((x) => x.guest_id) : []),
    dishes: rec ? (rec.recipe_reception_dishes || []).slice().sort((a, b) => a.position - b.position).map(dishOf) : [], wines: rec ? (rec.recipe_reception_wines || []).map(wineOf) : [] };
  if (fromMenu) {
    st.title = fromMenu.title.slice(0, 120);
    st.dishes = fromMenu.rows.map((x) => dishOf({ recipe_id: x.recipes.id, label: x.recipes.title, course: AR.rubriqueReception(x.rubrique) }));
  }
  // Instantané des lignes enregistrées, pour n'écrire que les différences.
  let saved = snapshot();
  function snapshot() { return { guests: new Set(st.guests), dishes: new Map(st.dishes.filter((d) => d.id).map((d) => [d.id, `${d.recipe_id}|${d.label}|${d.course}|${st.dishes.indexOf(d)}`])), wines: new Map(st.wines.filter((w) => w.id).map((w) => [w.id, `${w.label}|${w.note}`])) }; }

  // ---- données du carnet
  let guests = [];
  try { const g = await sb.from("recipe_guests").select("*").eq("book_id", bookId).order("name"); if (g.error) throw g.error; guests = g.data || []; }
  catch (e) { return fail(errMsg(e, "Impossible de charger les invités du carnet.")); }
  const guestById = (id) => guests.find((g) => g.id === id);
  let profiles = new Map();
  try { const p = await sb.rpc("book_people_profiles", { b: bookId }); if (!p.error) profiles = new Map((p.data || []).map((x) => [x.user_id, x])); } catch (e) { console.error(e); }
  let cat = [];
  try { cat = await AR.loadCatalog(); } catch (e) { console.error(e); }
  const catById = new Map(cat.map((c) => [c.id, c]));
  let bookRecipes = null;
  const recipeTitles = new Map();
  async function loadRecipes() {
    if (bookRecipes) return bookRecipes;
    const { data, error } = await sb.from("recipes").select("id,title,course").eq("book_id", bookId).is("deleted_at", null).is("archived_at", null).order("title").limit(500);
    if (error) throw error;
    bookRecipes = data || [];
    bookRecipes.forEach((r) => recipeTitles.set(r.id, r.title));
    return bookRecipes;
  }
  async function loadPhotoUrl() {
    st.photoUrl = null;
    if (st.photo) { const u = await AR.signedUrls([st.photo]); st.photoUrl = u[st.photo] || null; }
  }
  await loadPhotoUrl();
  document.title = `${st.title || "Réception"} · ARÔMES V&N`;

  // ---- affichage
  const guestLabel = (id) => { const g = guestById(id); return g ? g.name : "Invité"; };
  function guestsEditHtml() {
    const list = guests.filter((g) => !g.archived_at || st.guests.has(g.id));
    return `<fieldset class="pf-groupe"><legend class="libelle or">Invités</legend>
      ${list.length ? `<div class="sa-personnes re-invites">${list.map((g) => `<label class="case pf-case"><input type="checkbox" data-guest="${esc(g.id)}"${st.guests.has(g.id) ? " checked" : ""}> <span>${esc(g.name)}${g.archived_at ? ` <span class="muted">(archivé)</span>` : ""}</span></label>`).join("")}</div>` : `<p class="muted italique">Aucun invité dans ce carnet pour l'instant : ajoutez-en un ci-dessous.</p>`}
      <div class="pf-libre"><label for="re-newg">Nouvel invité (création rapide)</label>
        <div class="po-saisie"><input id="re-newg" maxlength="80" autocomplete="off" enterkeyhint="done" placeholder="Nom de l'invité"><button type="button" class="btn sec" id="re-newg-add">Ajouter</button></div>
        <p class="aide">Complétez ses allergies et préférences ensuite, depuis sa fiche.</p></div></fieldset>`;
  }
  function guestsReadHtml() {
    const ids = [...st.guests];
    if (!ids.length) return `<p class="muted italique">Aucun invité enregistré.</p>`;
    return `<ul class="re-noms">${ids.map((id) => `<li><a href="/recettes/invite.html?id=${encodeURIComponent(id)}">${esc(guestLabel(id))}</a></li>`).join("")}</ul>`;
  }
  function dishTitle(d) { return d.recipe_id ? `<a class="re-plat-t" href="/recettes/fiche.html?id=${encodeURIComponent(d.recipe_id)}">${esc(d.label)}</a>` : `<span class="re-plat-t">${esc(d.label)}</span>`; }
  function menuHtml() {
    const groups = AR.RUBRIQUES.map(([k, l]) => [k, l, st.dishes.filter((d) => d.course === k)]).filter((x) => x[2].length);
    if (!groups.length) return `<p class="muted italique">Aucun plat au menu.</p>`;
    return groups.map(([k, l, ds]) => `<h3 class="libelle or re-rubrique">${esc(l)}</h3><ul class="re-plats">${ds.map((d) => `<li class="re-plat" data-k="${esc(d.k)}">${dishTitle(d)}${d.recipe_id ? "" : ` <span class="muted italique">(hors carnet)</span>`}
      ${editor ? `<div class="rangee"><label class="sr-only" for="re-c-${esc(d.k)}">Rubrique de ${esc(d.label)}</label><select id="re-c-${esc(d.k)}" data-f="course">${AR.RUBRIQUES.map(([c, cl]) => `<option value="${c}"${d.course === c ? " selected" : ""}>${esc(cl)}</option>`).join("")}</select><button type="button" class="btn lien" data-act="plat-rm" aria-label="Retirer ${esc(d.label)} du menu">Retirer</button></div>` : ""}
      <div class="re-alertes" data-w="${esc(d.k)}">${warnHtml(d.k)}</div></li>`).join("")}</ul>`).join("");
  }
  function winesHtml() {
    if (!editor) return st.wines.length ? `<ul class="re-vins">${st.wines.map((w) => `<li><span class="re-vin-l">${esc(w.label)}</span>${w.note ? `<span class="aide" style="display:block">${esc(w.note)}</span>` : ""}</li>`).join("")}</ul>` : `<p class="muted italique">Aucun vin enregistré.</p>`;
    return `${st.wines.length ? `<ul class="re-vins">${st.wines.map((w) => `<li class="re-vin" data-k="${esc(w.k)}"><label for="re-vl-${esc(w.k)}">Vin<input id="re-vl-${esc(w.k)}" data-f="wlabel" maxlength="200" autocomplete="off" value="${esc(w.label)}"></label>
      <label for="re-vn-${esc(w.k)}">Note<input id="re-vn-${esc(w.k)}" data-f="wnote" maxlength="1000" autocomplete="off" value="${esc(w.note)}"></label>
      <button type="button" class="btn lien" data-act="vin-rm" aria-label="Retirer ce vin">Retirer</button></li>`).join("")}</ul>` : `<p class="muted italique">Aucun vin pour l'instant.</p>`}
      <p><button type="button" class="btn sec" data-act="vin-add">Ajouter un vin</button></p>`;
  }
  function photoHtml() {
    const img = st.file ? `<p class="aide">Nouvelle photo choisie : « ${esc(st.file.name)} », enregistrée avec la réception.</p>` : st.photoUrl ? `<div class="re-photo"><div class="passe-partout"><div class="cadre"><img src="${esc(st.photoUrl)}" alt="Photo de la réception" loading="lazy"></div></div></div>` : "";
    if (!editor) return img || `<p class="muted italique">Aucune photo.</p>`;
    return `${img}<label for="re-photo-in">${st.photo || st.file ? "Remplacer la photo" : "Photo (facultative)"}<input id="re-photo-in" type="file" accept="image/*"></label>
      ${st.photo || st.file ? `<p><button type="button" class="btn lien" data-act="photo-rm">Retirer la photo</button></p>` : ""}`;
  }
  const repaint = () => { const m = $("#re-menu"); if (m) m.innerHTML = menuHtml(); };

  function render() {
    const slotTxt = st.slot ? AR.CRENEAUX[st.slot] : "";
    if (!editor) {
      zone.innerHTML = `<p><a class="btn lien" href="/recettes/invites.html?book=${encodeURIComponent(bookId)}">← Invités et réceptions</a></p>
        <p class="muted italique">Vous consultez cette réception en lecture seule.</p>
        <h2 class="re-titre">${esc(st.title || "Réception")}</h2>
        <p class="libelle or">${esc(AR.fmtDay(st.day))}${slotTxt ? ` · ${esc(slotTxt)}` : ""}${st.members != null ? ` · ${esc(st.members)} membre${st.members > 1 ? "s" : ""} du carnet` : ""}</p>
        <h2 class="section">Invités</h2><span class="filet" aria-hidden="true"></span>${guestsReadHtml()}
        <h2 class="section">Menu</h2><span class="filet" aria-hidden="true"></span><div id="re-menu">${menuHtml()}</div>
        <h2 class="section">Vins servis</h2><span class="filet" aria-hidden="true"></span>${winesHtml()}
        ${st.note ? `<h2 class="section">Note</h2><span class="filet" aria-hidden="true"></span><p class="re-note">${esc(st.note)}</p>` : ""}
        <h2 class="section">Photo</h2><span class="filet" aria-hidden="true"></span>${photoHtml()}`;
      return;
    }
    zone.innerHTML = `<p><a class="btn lien" href="/recettes/invites.html?book=${encodeURIComponent(bookId)}">← Invités et réceptions</a></p>
      <form id="re-form" class="champs" novalidate>
        <div class="grille2"><label for="re-day">Date (JJ.MM.AAAA)<input id="re-day" name="day" inputmode="numeric" placeholder="JJ.MM.AAAA" autocomplete="off" value="${esc(AR.fmtDay(st.day))}"></label>
          <label for="re-slot">Créneau<select id="re-slot" name="slot"><option value="">Non précisé</option>${Object.entries(AR.CRENEAUX).map(([k, l]) => `<option value="${k}"${st.slot === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label></div>
        <label for="re-title">Titre<input id="re-title" name="title" maxlength="120" autocomplete="off" placeholder="Anniversaire de Marie" value="${esc(st.title)}"></label>
        <label for="re-members">Membres présents (hors invités)<input id="re-members" name="members" type="number" inputmode="numeric" min="0" max="99" step="1" value="${st.members == null ? "" : esc(st.members)}">
          <span class="aide" style="display:block;text-transform:none;letter-spacing:0;font-family:var(--texte);font-weight:400">Facultatif : sert au nombre de convives inscrit au journal.</span></label>
        <div id="re-guests">${guestsEditHtml()}</div>
        <section><h2 class="section" style="margin-top:12px">Menu</h2><span class="filet" aria-hidden="true"></span>
          <p class="aide">Les plats déjà servis à un invité, et ceux qui contiennent un de ses allergènes ou une de ses aversions, sont signalés.</p>
          <div id="re-menu">${menuHtml()}</div><p><button type="button" class="btn sec" data-act="plat-add">Ajouter un plat</button></p></section>
        <section><h2 class="section" style="margin-top:12px">Vins servis</h2><span class="filet" aria-hidden="true"></span><div id="re-vins">${winesHtml()}</div></section>
        <label for="re-note">Note<textarea id="re-note" name="note" maxlength="2000" rows="3">${esc(st.note)}</textarea></label>
        <div id="re-photo">${photoHtml()}</div>
        <div><button type="submit" class="btn">${rec ? "Enregistrer la réception" : "Créer la réception"}</button></div>
        <p class="msg" id="re-msg" role="status" aria-live="polite"></p>
      </form>
      ${rec ? `<section><h2 class="section">Journal</h2><span class="filet" aria-hidden="true"></span>
        <p class="aide">Inscrit une cuisson dans le journal de chaque recette du menu, à la date de la réception, avec le nombre de convives.</p>
        <p><button type="button" class="btn" id="re-log">Inscrire au journal</button></p><p class="msg" id="re-logmsg" role="status" aria-live="polite"></p></section>
        <div id="re-suppr" class="rangee iv-actions"><button type="button" class="btn danger" data-act="rec-del">Supprimer la réception…</button></div>` : ""}`;
  }

  // ---- avertissements (invité déjà servi, allergène, aversion)
  let warn = new Map(), wseq = 0;
  const lineCache = new Map();
  function warnHtml(k) {
    const w = warn.get(k);
    if (!w || !w.length) return "";
    return `<ul class="re-alertes-l">${w.map((x) => `<li class="re-alerte ${x.kind}" role="note"><span class="libelle">${x.kind === "danger" ? "Attention" : "À savoir"}</span> ${esc(x.text)}</li>`).join("")}</ul>`;
  }
  function constraintsOf(g) {
    const p = g.linked_user_id ? profiles.get(g.linked_user_id) : null;
    return { allergens: new Set([...(g.allergens || []), ...((p && p.allergens) || [])]), aversions: new Set([...(g.aversions || []), ...((p && p.aversions) || [])]),
      texte: [...(g.aversions_texte || []), ...((p && p.aversions_texte) || [])].map(AR.norm).filter((t) => t.length >= 3) };
  }
  async function refreshWarnings() {
    const my = ++wseq;
    const sel = [...st.guests].filter((id) => guestById(id)), rids = [...new Set(st.dishes.map((d) => d.recipe_id).filter(Boolean))];
    const next = new Map();
    if (sel.length && rids.length) {
      try {
        const need = rids.filter((x) => !lineCache.has(x));
        const [ln, sv] = await Promise.all([
          need.length ? sb.from("recipe_ingredient_lines").select("recipe_id,catalog_id,label_original,optional").in("recipe_id", need) : Promise.resolve({ data: [] }),
          sb.from("recipe_served_to").select("recipe_id,guest_id,day,reception_id").in("guest_id", sel).in("recipe_id", rids)]);
        if (ln.error) console.error(ln.error); else { need.forEach((x) => lineCache.set(x, [])); (ln.data || []).forEach((l) => lineCache.get(l.recipe_id).push(l)); }
        if (sv.error) console.error(sv.error);
        if (my !== wseq) return;
        const served = (sv.error ? [] : sv.data || []).filter((x) => !rec || x.reception_id !== rec.id);
        st.dishes.forEach((d) => {
          if (!d.recipe_id) return;
          const out = [], lines = lineCache.get(d.recipe_id) || [];
          let constrained = false;
          sel.forEach((gid) => {
            const g = guestById(gid), c = constraintsOf(g);
            if (c.allergens.size || c.aversions.size || c.texte.length) constrained = true;
            const al = new Map(), av = new Set();
            lines.forEach((l) => {
              const ci = l.catalog_id ? catById.get(l.catalog_id) : null;
              ((ci && ci.allergens) || []).filter((a) => c.allergens.has(a)).forEach((a) => { if (!al.has(a)) al.set(a, new Set()); al.get(a).add(l.label_original); });
              if (l.catalog_id && c.aversions.has(l.catalog_id)) av.add(ci ? ci.name : l.label_original);
              else if (c.texte.some((t) => AR.norm(l.label_original).includes(t))) av.add(l.label_original);
            });
            if (al.size) out.push({ kind: "danger", text: `Allergène pour ${g.name} : ${[...al].map(([a, ls]) => `${AR.ALLERGENES[a] || a} (${[...ls].join(", ")})`).join(" ; ")}.` });
            if (av.size) out.push({ kind: "danger", text: `Aversion de ${g.name} : ${[...av].join(", ")}.` });
          });
          if (constrained) { const n = lines.filter((l) => !l.catalog_id && !l.optional).length; if (n) out.push({ kind: "note", text: `${n} ingrédient${n > 1 ? "s" : ""} non rattaché${n > 1 ? "s" : ""} au catalogue : allergènes non contrôlables.` }); }
          const last = new Map();
          served.filter((x) => x.recipe_id === d.recipe_id).forEach((x) => { const cur = last.get(x.guest_id); if (!cur || String(x.day) > cur) last.set(x.guest_id, String(x.day).slice(0, 10)); });
          if (last.size) out.push({ kind: "note", text: `Déjà servi à ${[...last].sort((a, b) => b[1].localeCompare(a[1])).map(([gid, day]) => `${guestLabel(gid)} le ${AR.fmtDay(day)}`).join(", ")}.` });
          if (out.length) next.set(d.k, out);
        });
      } catch (e) { console.error(e); }
    }
    if (my !== wseq) return;
    warn = next;
    $$("[data-w]").forEach((el) => { el.innerHTML = warnHtml(el.dataset.w); });
  }
  const refreshWarningsDeb = AR.debounce(refreshWarnings, 150);

  // ---- feuille « Ajouter un plat »
  let sheet = null, opener = null;
  function closeSheet() { if (!sheet) return; sheet.remove(); sheet = null; document.body.classList.remove("se-ouvert"); if (opener && document.contains(opener)) opener.focus(); opener = null; }
  function openSheet() {
    closeSheet();
    sheet = document.createElement("div");
    sheet.className = "re-fond";
    sheet.innerHTML = `<section class="re-feuille" role="dialog" aria-modal="true" aria-labelledby="re-f-t"><div class="re-f-tete"><h2 id="re-f-t">Ajouter un plat</h2><button type="button" class="btn sec petit" data-close>Fermer</button></div>
      <label for="re-rech">Une recette du carnet</label><input id="re-rech" type="search" placeholder="Chercher dans le carnet…" autocomplete="off"><div id="re-res" class="re-res"><p class="chargement">Chargement…</p></div>
      <div class="re-libre"><p class="libelle or">Ou un plat hors carnet</p>
        <label for="re-lib-l">Libellé<input id="re-lib-l" maxlength="200" autocomplete="off" placeholder="Fromages du marché"></label>
        <label for="re-lib-c">Rubrique<select id="re-lib-c">${AR.RUBRIQUES.map(([k, l]) => `<option value="${k}"${k === "plat" ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
        <div><button type="button" class="btn sec" id="re-lib-add">Ajouter ce plat</button></div></div></section>`;
    document.body.append(sheet); document.body.classList.add("se-ouvert");
    sheet.addEventListener("click", (e) => { if (e.target === sheet || e.target.closest("[data-close]")) closeSheet(); });
    sheet.addEventListener("keydown", (e) => {
      if (e.key === "Escape") return closeSheet();
      if (e.key !== "Tab") return;
      const f = $$("button:not([disabled]), input, select, a[href]", sheet).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    const addDish = (d) => { st.dishes.push(dishOf(d)); repaint(); refreshWarnings(); closeSheet(); toast("Plat ajouté au menu."); };
    $("#re-lib-add", sheet).addEventListener("click", () => {
      const l = $("#re-lib-l", sheet).value.replace(/\s+/g, " ").trim();
      if (!l) { $("#re-lib-l", sheet).focus(); return toast("Indiquez le libellé du plat.", "erreur"); }
      addDish({ label: l, course: $("#re-lib-c", sheet).value });
    });
    loadRecipes().then((rows) => {
      const show = () => {
        const n = AR.norm($("#re-rech", sheet).value), f = rows.filter((r) => !n || AR.norm(r.title).includes(n)).slice(0, 80);
        $("#re-res", sheet).innerHTML = f.length ? `<ul class="se-choix">${f.map((r) => `<li><button type="button" class="se-choix-b" data-rid="${esc(r.id)}"><span class="se-ch-t">${esc(r.title)}</span><span class="se-ch-m">${esc(AR.COURSES[r.course] || "")}</span></button></li>`).join("")}</ul>` : `<p class="muted italique">Aucune recette ne correspond.</p>`;
      };
      $("#re-rech", sheet).addEventListener("input", show); show();
    }).catch((e) => { $("#re-res", sheet).innerHTML = `<p class="msg erreur" role="alert">${esc(errMsg(e, "Impossible de lire le carnet."))}</p>`; });
    $("#re-res", sheet).addEventListener("click", (e) => {
      const b = e.target.closest("[data-rid]"); if (!b) return;
      const r = bookRecipes.find((x) => x.id === b.dataset.rid); if (!r) return;
      addDish({ recipe_id: r.id, label: r.title, course: AR.rubriqueDe(r.course) });
    });
    $("#re-rech", sheet).focus();
  }

  // ---- enregistrement
  let busy = false;
  function readForm() {
    st.title = $("#re-title").value.replace(/\s+/g, " ").trim();
    st.note = $("#re-note").value.trim();
    st.slot = $("#re-slot").value || null;
  }
  async function save() {
    if (busy) return false;
    const out = $("#re-msg");
    readForm();
    const dayEl = $("#re-day"), memEl = $("#re-members");
    const day = AR.parseDay(dayEl.value);
    if (!day) { setMsg(out, "Date invalide : écrivez-la sous la forme JJ.MM.AAAA.", "erreur"); dayEl.focus(); return false; }
    st.day = day;
    let members = null;
    if (memEl.value.trim() !== "") {
      members = Number(memEl.value);
      if (!Number.isInteger(members) || members < 0 || members > 99) { setMsg(out, "Le nombre de membres présents est un entier entre 0 et 99.", "erreur"); memEl.focus(); return false; }
    }
    st.members = members;
    busy = true; $$("#re-form button, #re-log").forEach((b) => (b.disabled = true)); setMsg(out, "Enregistrement…");
    let uploaded = null, oldPhoto = null;
    try {
      let photo_path = st.photo;
      if (st.file) {
        const blob = await AR.compressImage(st.file, 1600);
        uploaded = `${bookId}/receptions/${Date.now()}-${AR.uuid().slice(0, 8)}.jpg`;
        const up = await sb.storage.from("recipes").upload(uploaded, blob, { contentType: "image/jpeg", upsert: false });
        if (up.error) { uploaded = null; throw up.error; }
        oldPhoto = st.photo; photo_path = uploaded;
      }
      const row = { day: st.day, slot: st.slot, title: st.title || null, note: st.note || null, photo_path, members_count: st.members };
      let id = rec && rec.id;
      if (!rec) {
        id = AR.uuid();
        const ins = await sb.from("recipe_receptions").insert({ id, book_id: bookId, created_by: ctx.user.id, ...row }).select("*").single();
        if (ins.error) throw ins.error;
        rec = ins.data || { id, book_id: bookId, ...row };
      } else {
        const up = await sb.from("recipe_receptions").update(row).eq("id", id).select("*").single();
        if (up.error) throw up.error;
        Object.assign(rec, up.data || row);
      }
      // invités : on retire ceux décochés, on ajoute les nouveaux
      const rm = [...saved.guests].filter((x) => !st.guests.has(x)), add = [...st.guests].filter((x) => !saved.guests.has(x));
      if (rm.length) { const r = await sb.from("recipe_reception_guests").delete().eq("reception_id", id).in("guest_id", rm); if (r.error) throw r.error; }
      if (add.length) { const r = await sb.from("recipe_reception_guests").insert(add.map((g) => ({ reception_id: id, guest_id: g }))); if (r.error) throw r.error; }
      // plats : retirés, modifiés, ajoutés
      const keepD = new Set(st.dishes.map((d) => d.id).filter(Boolean));
      const gone = [...saved.dishes.keys()].filter((x) => !keepD.has(x));
      if (gone.length) { const r = await sb.from("recipe_reception_dishes").delete().in("id", gone); if (r.error) throw r.error; }
      for (const [i, d] of st.dishes.entries()) {
        const sig = `${d.recipe_id}|${d.label}|${d.course}|${i}`;
        if (d.id) { if (saved.dishes.get(d.id) !== sig) { const r = await sb.from("recipe_reception_dishes").update({ recipe_id: d.recipe_id, label: d.label, course: d.course, position: i }).eq("id", d.id); if (r.error) throw r.error; } }
        else { d.id = AR.uuid(); const r = await sb.from("recipe_reception_dishes").insert({ id: d.id, reception_id: id, recipe_id: d.recipe_id, label: d.label, course: d.course, position: i }); if (r.error) { d.id = null; throw r.error; } }
      }
      // vins (les lignes sans libellé sont ignorées)
      st.wines = st.wines.filter((w) => w.label.trim() || w.id);
      const keepW = new Set(st.wines.map((w) => w.id).filter(Boolean));
      const goneW = [...saved.wines.keys()].filter((x) => !keepW.has(x));
      if (goneW.length) { const r = await sb.from("recipe_reception_wines").delete().in("id", goneW); if (r.error) throw r.error; }
      for (const w of st.wines) {
        const label = w.label.replace(/\s+/g, " ").trim();
        if (!label) continue;
        if (w.id) { if (saved.wines.get(w.id) !== `${w.label}|${w.note}`) { const r = await sb.from("recipe_reception_wines").update({ label, note: w.note.trim() || null }).eq("id", w.id); if (r.error) throw r.error; } }
        else { w.id = AR.uuid(); const r = await sb.from("recipe_reception_wines").insert({ id: w.id, reception_id: id, label, note: w.note.trim() || null }); if (r.error) { w.id = null; throw r.error; } }
      }
      st.photo = photo_path; st.file = null; uploaded = null;
      if (oldPhoto) sb.storage.from("recipes").remove([oldPhoto]).catch(() => {});
      saved = snapshot();
      await loadPhotoUrl();
      document.title = `${st.title || "Réception"} · ARÔMES V&N`;
      const wasNew = !rid;
      if (wasNew) history.replaceState(null, "", `/recettes/reception.html?id=${encodeURIComponent(id)}`);
      busy = false;
      render(); refreshWarnings();
      setMsg($("#re-msg"), "Réception enregistrée.", "ok");
      return true;
    } catch (e) {
      busy = false;
      if (uploaded) sb.storage.from("recipes").remove([uploaded]).catch(() => {});
      $$("#re-form button, #re-log").forEach((b) => (b.disabled = false));
      setMsg($("#re-msg"), errMsg(e, "La réception n'a pas pu être enregistrée."), "erreur");
      return false;
    }
  }

  render();
  refreshWarnings();
  if (fromMenu) setMsg($("#re-msg"), `Pré-rempli avec les ${fromMenu.rows.length} plat${fromMenu.rows.length > 1 ? "s" : ""} du menu « ${fromMenu.title} ». Choisissez la date et les invités, puis créez la réception.`);

  // ---- interactions
  zone.addEventListener("submit", (e) => { if (e.target.id === "re-form") { e.preventDefault(); save(); } });
  zone.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.guest) { if (t.checked) st.guests.add(t.dataset.guest); else st.guests.delete(t.dataset.guest); refreshWarningsDeb(); return; }
    if (t.dataset.f === "course") { const li = t.closest("[data-k]"), d = st.dishes.find((x) => x.k === li.dataset.k); if (d) { d.course = t.value; repaint(); const s = $(`[data-k="${d.k}"] select`); if (s) s.focus(); refreshWarnings(); } return; }
    if (t.id === "re-photo-in") {
      const file = t.files && t.files[0]; if (!file) return;
      if (!/^image\//.test(file.type)) { toast("Choisissez un fichier image.", "erreur"); t.value = ""; return; }
      st.file = file; $("#re-photo").innerHTML = photoHtml();
    }
  });
  zone.addEventListener("input", (e) => {
    const t = e.target, li = t.closest(".re-vin");
    if (li && t.dataset.f) { const w = st.wines.find((x) => x.k === li.dataset.k); if (w) w[t.dataset.f === "wlabel" ? "label" : "note"] = t.value; }
  });
  async function addQuickGuest() {
    const inp = $("#re-newg"), name = inp.value.replace(/\s+/g, " ").trim(), btn = $("#re-newg-add");
    if (!name) { inp.focus(); return toast("Indiquez le nom de l'invité.", "erreur"); }
    btn.disabled = true;
    const { data, error } = await sb.from("recipe_guests").insert({ id: AR.uuid(), book_id: bookId, name, created_by: ctx.user.id }).select("*").single();
    btn.disabled = false;
    if (error) return toast(errMsg(error, "L'invité n'a pas pu être ajouté."), "erreur");
    guests.push(data); guests.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    st.guests.add(data.id);
    readForm();
    $("#re-guests").innerHTML = guestsEditHtml(); refreshWarnings();
    toast(`« ${data.name} » ajouté aux invités.`);
    $("#re-newg").focus();
  }
  zone.addEventListener("keydown", (e) => { if (e.target.id === "re-newg" && e.key === "Enter") { e.preventDefault(); addQuickGuest(); } });
  zone.addEventListener("click", async (e) => {
    if (e.target.closest("#re-newg-add")) return void addQuickGuest();
    if (e.target.closest("#re-log")) return void logJournal(e.target.closest("#re-log"));
    const b = e.target.closest("[data-act]"); if (!b) return;
    const a = b.dataset.act;
    if (a === "plat-add") { opener = b; return openSheet(); }
    if (a === "plat-rm") { const li = b.closest("[data-k]"); st.dishes = st.dishes.filter((x) => x.k !== li.dataset.k); repaint(); refreshWarnings(); const n = $("[data-act=plat-add]"); if (n) n.focus(); return; }
    if (a === "vin-add") { st.wines.push(wineOf({})); $("#re-vins").innerHTML = winesHtml(); const l = $$("[data-f=wlabel]").pop(); if (l) l.focus(); return; }
    if (a === "vin-rm") { const li = b.closest("[data-k]"); st.wines = st.wines.filter((x) => x.k !== li.dataset.k); $("#re-vins").innerHTML = winesHtml(); const n = $("[data-act=vin-add]"); if (n) n.focus(); return; }
    if (a === "photo-rm") { st.file = null; st.photo = null; st.photoUrl = null; $("#re-photo").innerHTML = photoHtml(); return; }
    if (a === "rec-del") return confirmDelete();
    if (a === "rec-del-no") { $("#re-suppr").innerHTML = `<button type="button" class="btn danger" data-act="rec-del">Supprimer la réception…</button>`; $("[data-act=rec-del]").focus(); return; }
    if (a === "rec-del-ok") {
      b.disabled = true;
      const { error } = await sb.from("recipe_receptions").delete().eq("id", rec.id);
      if (error) { b.disabled = false; return setMsg($("#re-logmsg"), errMsg(error, "La réception n'a pas pu être supprimée."), "erreur"); }
      if (st.photo) sb.storage.from("recipes").remove([st.photo]).catch(() => {});
      location.replace(`/recettes/invites.html?book=${encodeURIComponent(bookId)}`);
    }
  });
  function confirmDelete() {
    $("#re-suppr").innerHTML = `<div class="iv-confirm" role="alertdialog" aria-labelledby="re-d-t"><p id="re-d-t"><strong>Supprimer cette réception ?</strong></p>
      <p>Le menu, la liste des invités et les vins de cette réception seront effacés. Les cuissons déjà inscrites au journal restent, sans mention des invités. Cette action est irréversible.</p>
      <div class="rangee"><button type="button" class="btn danger" data-act="rec-del-ok">Supprimer définitivement</button><button type="button" class="btn sec" data-act="rec-del-no">Annuler</button></div></div>`;
    $("[data-act=rec-del-no]").focus();
  }
  async function logJournal(btn) {
    const out = $("#re-logmsg");
    if (!st.dishes.some((d) => d.recipe_id)) return setMsg(out, "Aucun plat de votre carnet dans ce menu : rien à inscrire au journal.", "erreur");
    if (!(await save())) return;
    const b2 = $("#re-log"); if (b2) b2.disabled = true;
    setMsg($("#re-logmsg"), "Inscription…");
    const { data, error } = await sb.rpc("recipe_reception_log", { p_reception: rec.id });
    if ($("#re-log")) $("#re-log").disabled = false;
    if (error) return setMsg($("#re-logmsg"), errMsg(error, "L'inscription au journal a échoué."), "erreur");
    const n = Number(data) || 0;
    const msg = n === 0 ? "Déjà inscrit au journal." : `${n} plat${n > 1 ? "s" : ""} inscrit${n > 1 ? "s" : ""} au journal.`;
    setMsg($("#re-logmsg"), msg, "ok"); toast(msg);
    refreshWarnings();
  }
})();
