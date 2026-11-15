// Cave, accueil de l'app (refonte, lot 3 · C1) : sélecteur de cave, invitations et fiches prêtes, rangée « À ouvrir en priorité »,
// « Sortir par photo », puis toute la cave en grille (ou liste), rangée par statut de garde, avec recherche et filtres.
(async function () {
  const VC = window.VC;
  const { sb, $, esc, I, CATEGORY_SHORT, STYLE, money, windowStatus, bottleSvg, signed, mainImagePath, toast, fail } = VC;
  const ctx = await VC.boot("cellar");
  const main = $("#main");
  main.classList.add("cellar-page");
  const params = new URLSearchParams(location.search);
  let loc = params.get("loc") || VC.getLoc() || "all";
  if (loc === "all") loc = "";

  let items = [], allItems = [], places = [], stock = [], byItem = new Map(), getUrl = () => null, invites = [];
  let state = { win: "", cat: "", grape: "", country: "", region: "", price: "", q: "", sort: "urgent", empty: false };
  try { Object.assign(state, JSON.parse(localStorage.getItem("vc.cave.filters") || "{}"), { q: "", grape: "", country: "", region: "" }); } catch { /* stockage indisponible */ }
  const save = () => { try { localStorage.setItem("vc.cave.filters", JSON.stringify({ win: state.win, cat: state.cat, sort: state.sort })); } catch { /* idem */ } };
  let view = "grid";
  try { if (localStorage.getItem("vc.cave.view") === "list") view = "list"; } catch { /* grille par défaut */ }

  async function load() {
    const [p, a, b] = await Promise.all([
      VC.loadPlaces(),
      sb.from("items").select("*").order("created_at", { ascending: false }),
      sb.from("stock").select("item_id, location_id, quantity, bin")
    ]);
    if (a.error) throw a.error;
    places = p; allItems = items = a.data || []; stock = b.data || [];
    if (loc && !places.some((x) => x.id === loc)) loc = "";
    VC.setLoc(loc || "all");
    // En vue d'une cave : seulement les fiches de sa collection.
    const coll = loc ? places.find((x) => x.id === loc).collection_id : null;
    if (coll) items = items.filter((it) => it.collection_id === coll);
    byItem = new Map();
    for (const s of stock) { if (!byItem.has(s.item_id)) byItem.set(s.item_id, []); byItem.get(s.item_id).push(s); }
    getUrl = await signed(items.map(mainImagePath));
  }
  const qty = (it) => (byItem.get(it.id) || []).filter((s) => !loc || s.location_id === loc).reduce((a, s) => a + s.quantity, 0);
  const placeName = () => (loc ? (places.find((x) => x.id === loc) || {}).name : "") || "Toutes les caves";

  // ---------------------------------------------------------------- tableau de bord
  const KINDS = [
    { k: "red", label: "Rouges", one: "Rouge", test: (it) => it.category === "wine" && it.style === "red" },
    { k: "white", label: "Blancs", one: "Blanc", test: (it) => it.category === "wine" && it.style === "white" },
    { k: "rose", label: "Rosés", one: "Rosé", test: (it) => it.category === "wine" && it.style === "rose" },
    { k: "sparkling", label: "Mousseux", one: "Mousseux", test: (it) => it.category === "wine" && it.style === "sparkling" },
    { k: "otherwine", label: "Autres vins", one: "Autres vins", test: (it) => it.category === "wine" && !["red", "white", "rose", "sparkling"].includes(it.style) },
    { k: "spirits", label: "Spiritueux", one: "Spiritueux, sakés", test: (it) => it.category !== "wine" }
  ];
  const color = (k) => `var(--k-${k})`;
  const grapeName = (g) => g.replace(/\(.*?\)/g, "").replace(/\d+\s*%/g, "").replace(/\s+/g, " ").trim();
  const canEditHere = () => (loc ? VC.canEdit((places.find((x) => x.id === loc) || {}).collection_id) : places.some((x) => VC.canEdit(x.collection_id)));

  // ---------------------------------------------------------------- filtres (feuille) et liste
  const WIN = { drink: "À boire maintenant", urgent: "À ouvrir vite", young: "À garder" };
  const priceLabel = (k) => { const b = VC.PRICE_BANDS.find((x) => x[0] === k); return b ? `${b[1]} ${ctx.profile.currency || "CHF"}` : k; };
  // Filtres actifs, chacun avec de quoi le retirer.
  function active() {
    const kind = KINDS.find((k) => "kind:" + k.k === state.cat);
    return [
      state.cat && ["cat", kind ? kind.one : (CATEGORY_SHORT[state.cat] || state.cat)],
      state.win && ["win", WIN[state.win]],
      state.grape && ["grape", state.grape],
      state.country && ["country", state.country],
      state.region && ["region", state.region],
      state.price && ["price", priceLabel(state.price)],
      state.empty && ["empty", "Sorties / à racheter"]
    ].filter(Boolean);
  }
  function findBar() {
    const n = active().length;
    return `<div class="find">
        <label class="search"><span class="sr">Rechercher</span>${I.search}<input type="search" id="q" placeholder="Rechercher" autocomplete="off" value="${esc(state.q)}"></label>
        <button class="icon-btn c-tool" id="open-filters" aria-haspopup="dialog" aria-label="Filtres${n ? ` (${n} actifs)` : ""}">${I.filter}${n ? `<span class="count">${n}</span>` : ""}</button>
        <button class="icon-btn c-tool" data-view="${view === "grid" ? "list" : "grid"}" aria-label="${view === "grid" ? "Afficher en liste" : "Afficher en grille"}">${view === "grid" ? I.list : I.grid}</button>
      </div>
      ${n ? `<div class="active-filters">${active().map(([g, l]) => `<button class="chip" data-clear="${g}" aria-label="Retirer le filtre ${esc(l)}">${esc(l)}${I.x}</button>`).join("")}</div>` : ""}`;
  }

  function filterSheetHtml() {
    const chip = (g, v, l) => `<button type="button" class="chip" data-group="${g}" data-val="${esc(v)}" aria-pressed="${state[g] === v}">${esc(l)}</button>`;
    const present = KINDS.filter((k) => items.some((it) => qty(it) > 0 && k.test(it)));
    const countries = new Map(), regions = new Map(), grapes = new Map();
    for (const it of items) {
      const n = qty(it); if (!n) continue;
      for (const g of it.grapes || []) { const k = grapeName(g); if (k) grapes.set(k, (grapes.get(k) || 0) + n); }
      const c = VC.countryOf(it); if (!c) continue;
      countries.set(c, (countries.get(c) || 0) + n);
      if (c === state.country) { const r = VC.regionOf(it); if (r) regions.set(r, (regions.get(r) || 0) + n); }
    }
    const opt = (m, sel) => [...m].sort((x, y) => y[1] - x[1]).map(([k, n]) => `<option value="${esc(k)}"${k === sel ? " selected" : ""}>${esc(k)} (${n})</option>`).join("");
    const bandN = (k) => { const b = VC.PRICE_BANDS.find((x) => x[0] === k); return items.filter((it) => { const p = VC.priceOf(it); return qty(it) > 0 && p != null && p >= b[2] && p < b[3]; }).reduce((a, it) => a + qty(it), 0); };
    return `<div class="fsheet"><h2 id="vc-filter-title">Filtres</h2>
      ${present.length > 1 ? `<div class="fgroup"><div class="field-label">Type</div><div class="chips">${chip("cat", "", "Tous")}${present.map((k) => chip("cat", "kind:" + k.k, k.one)).join("")}</div></div>` : ""}
      <div class="fgroup"><div class="field-label">Garde</div><div class="chips">${chip("win", "", "Tout")}${Object.entries(WIN).map(([k, l]) => chip("win", k, l)).join("")}</div></div>
      <div class="fgroup"><div class="geo">
        <label>Pays<select id="f-country"><option value="">Tous</option>${opt(countries, state.country)}</select></label>
        <label>Cépage<select id="f-grape"><option value="">Tous</option>${[...grapes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr")).map(([k, n]) => `<option value="${esc(k)}"${k === state.grape ? " selected" : ""}>${esc(k)} (${n})</option>`).join("")}</select></label>
        <label>Prix<select id="f-price"><option value="">Tous</option>${VC.PRICE_BANDS.map(([k, l]) => { const n = bandN(k); return `<option value="${k}"${k === state.price ? " selected" : ""}>${l} ${esc(ctx.profile.currency || "CHF")}${n ? ` (${n})` : ""}</option>`; }).join("")}</select></label>
      </div></div>
      <div class="fgroup region-filter" role="group" aria-label="Région viticole"><div class="field-label">Région</div>
        ${state.country ? `<div class="region-seals"><button type="button" class="region-all" data-region="" aria-pressed="${!state.region}">Toutes les régions</button>
          ${[...regions].sort((a, b) => a[0].localeCompare(b[0], "fr")).map(([name, count], index) => VC.regionSeal(name, state.country, count, index, state.region === name)).join("")}</div>` : `<p class="region-hint">Choisir un pays pour voir ses régions.</p>`}
      </div>
      <div class="fgroup"><label>Trier par<select id="sort"><option value="urgent">À boire en priorité</option><option value="name">Nom</option><option value="vintage">Millésime</option><option value="qty">Quantité</option><option value="recent">Ajout récent</option></select></label></div>
      <div class="fgroup"><div class="chips"><button type="button" class="chip" data-group="empty" aria-pressed="${state.empty}">Sorties / à racheter</button></div></div>
      <div class="row end" style="margin-top:18px"><button type="button" class="btn quiet" id="f-reset">Tout effacer</button><button type="button" class="btn" data-close id="f-done">Voir ${filtered().length} vin${filtered().length > 1 ? "s" : ""}</button></div></div>`;
  }

  function openFilters() {
    const d = VC.sheet(filterSheetHtml());
    const redraw = () => {
      const focus = document.activeElement, id = focus?.id, group = focus?.dataset.group, value = focus?.dataset.val, region = focus?.dataset.region;
      d.querySelector(".dlg").innerHTML = filterSheetHtml();
      d.querySelector("#sort").value = state.sort;
      refresh();
      const next = id ? d.querySelector(`#${CSS.escape(id)}`) : region !== undefined
        ? [...d.querySelectorAll("[data-region]")].find((b) => b.dataset.region === region)
        : [...d.querySelectorAll("[data-group]")].find((b) => b.dataset.group === group && b.dataset.val === value);
      next?.focus();
    };
    d.querySelector("#sort").value = state.sort;
    d.addEventListener("click", (e) => {
      const region = e.target.closest("[data-region]");
      if (region) { state.region = region.dataset.region; save(); return redraw(); }
      const c = e.target.closest("[data-group]");
      if (c) {
        const grp = c.dataset.group;
        if (grp === "empty") state.empty = !state.empty;
        else state[grp] = state[grp] === c.dataset.val ? "" : c.dataset.val;
        save(); return redraw();
      }
      if (e.target.closest("#f-reset")) { Object.assign(state, { win: "", cat: "", grape: "", country: "", region: "", price: "", empty: false }); save(); redraw(); }
    });
    d.addEventListener("change", (e) => {
      const id = e.target.id, v = e.target.value;
      if (id === "sort") { state.sort = v; save(); }
      if (id === "f-country") { state.country = v; state.region = ""; }
      if (id === "f-price") state.price = v;
      if (id === "f-grape") state.grape = v;
      redraw();
    });
  }

  function filtered() {
    const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    const terms = norm(state.q).split(/\s+/).filter(Boolean);
    const kind = state.cat.startsWith("kind:") ? KINDS.find((k) => "kind:" + k.k === state.cat) : null;
    return items.filter((it) => {
      const n = qty(it);
      const here = (byItem.get(it.id) || []).some((s) => !loc || s.location_id === loc);
      if (state.empty ? n > 0 || !here : n === 0) return false;
      if (kind && !kind.test(it)) return false;
      if (state.cat && !kind && it.category !== state.cat) return false;
      if (state.grape && !(it.grapes || []).some((g) => grapeName(g) === state.grape)) return false;
      if (state.country && VC.countryOf(it) !== state.country) return false;
      if (state.region && VC.regionOf(it) !== state.region) return false;
      if (state.price) {
        const band = VC.PRICE_BANDS.find((b) => b[0] === state.price), p = VC.priceOf(it);
        if (!band || p == null || p < band[2] || p >= band[3]) return false;
      }
      const w = windowStatus(it);
      if (state.win === "drink" && !(w && w.rank <= 3)) return false;
      if (state.win === "urgent" && !(w && w.rank <= 1)) return false;
      if (state.win === "young" && !(w && w.key === "young")) return false;
      if (terms.length) {
        const hay = norm([it.name, it.producer, it.region, it.appellation, it.country, it.vintage, ...(it.grapes || [])].join(" "));
        if (!terms.every((t) => hay.includes(t))) return false;
      }
      return true;
    }).sort({
      urgent: (a, b) => ((windowStatus(a)?.rank ?? 5) - (windowStatus(b)?.rank ?? 5)) || ((a.drink_to || 9999) - (b.drink_to || 9999)),
      name: (a, b) => VC.title(a).localeCompare(VC.title(b), "fr"),
      vintage: (a, b) => (a.vintage || 9999) - (b.vintage || 9999),
      recent: (a, b) => b.created_at.localeCompare(a.created_at),
      qty: (a, b) => qty(b) - qty(a)
    }[state.sort] || (() => 0));
  }

  // Carte de grille : vignette et drapeau, nom sur 2 lignes, millésime et producteur, statut, quantité et « Sortir ».
  function card(it) {
    const n = qty(it), w = windowStatus(it);
    const sub = [it.vintage, it.producer].filter(Boolean).join(" · ");
    const out = n && VC.canEdit(it.collection_id) ? `<button class="c-out" data-out="${it.id}" aria-label="Sortir une bouteille : ${esc(it.name)}">Sortir</button>` : "";
    if (view === "list") return `<div class="c-row"><a href="/app/fiche.html?id=${it.id}" class="c-row-link">
        <div class="c-thumb">${VC.itemVisual(it, getUrl)}${VC.flag(it)}</div>
        <div class="c-row-b"><h3>${esc(it.name)}</h3><span class="c-sub">${esc(sub)}</span>${w ? `<span class="tag ${w.key}">${w.label}</span>` : ""}</div>
        <span class="c-q${n ? "" : " zero"}">${n}</span></a>${out}</div>`;
    return `<div class="c-card"><a href="/app/fiche.html?id=${it.id}" class="c-link" aria-label="${esc([it.name, it.vintage, it.producer].filter(Boolean).join(", "))}"></a>
      <div class="c-thumb">${VC.itemVisual(it, getUrl)}${VC.flag(it)}</div>
      <div class="c-b"><h3>${esc(it.name)}</h3>
        <div class="c-meta">${it.vintage ? `<span>${it.vintage}</span>` : ""}${w ? `<span class="tag ${w.key}">${w.label}</span>` : ""}</div>
        <div class="c-foot"><span class="c-q${n ? "" : " zero"}">${n} <small>bt.</small></span>${out}</div></div></div>`;
  }

  // À ouvrir en priorité : « à boire vite » puis « à l'apogée », dans la cave affichée.
  function priority() {
    const rank = { past: 0, soon: 1, peak: 2 };
    const list = items.filter((it) => qty(it) > 0 && rank[windowStatus(it)?.key] != null)
      .sort((a, b) => rank[windowStatus(a).key] - rank[windowStatus(b).key] || (a.drink_to || 9999) - (b.drink_to || 9999)).slice(0, 12);
    if (!list.length) return "";
    return `<section class="c-pri" aria-labelledby="pri-h"><div class="c-sec-h"><h2 id="pri-h">À ouvrir en priorité</h2><span>${list.length}</span></div>
      <div class="c-hrow">${list.map((it) => { const w = windowStatus(it);
        return `<a class="c-mini" href="/app/fiche.html?id=${it.id}"><div class="c-thumb">${VC.itemVisual(it, getUrl)}${VC.flag(it)}</div>
          <div class="c-mini-b"><h3>${esc(it.name)}</h3><span class="c-sub">${esc([it.vintage, qty(it) + " bt."].filter(Boolean).join(" · "))}</span><span class="tag ${w.key}">${w.label}</span></div></a>`; }).join("")}</div></section>`;
  }

  function switcher() {
    if (places.length < 2) return "";
    return `<div class="seg c-switch" role="group" aria-label="Cave affichée"><button type="button" data-loc="" aria-pressed="${!loc}">Toutes</button>${places.map((p) => `<button type="button" data-loc="${p.id}" aria-pressed="${loc === p.id}">${esc(p.name)}</button>`).join("")}</div>`;
  }

  function drawList() {
    const list = filtered();
    $("#list").className = view === "list" ? "c-list" : "c-grid";
    $("#count").textContent = `${list.length} vin${list.length > 1 ? "s" : ""}`;
    $("#list").innerHTML = list.length ? list.map(card).join("") : `<div class="empty" style="grid-column:1/-1"><p class="muted">Aucune bouteille ne correspond.</p></div>`;
  }
  // Après un changement de filtre : barre de recherche (pastilles actives) et liste.
  function refresh() {
    const q = $("#q"), focused = document.activeElement === q;
    $("#findbar").innerHTML = findBar();
    if (focused) { const n = $("#q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    drawList();
  }

  const totalHere = () => items.reduce((a, it) => a + qty(it), 0);
  function draw() {
    const top = `${head()}<div class="c-page">${switcher()}<div id="invites"></div>`;
    if (!items.some((it) => (byItem.get(it.id) || []).some((s) => !loc || s.location_id === loc))) {
      main.innerHTML = `${top}<div class="empty cellar-empty">${I.glass}<h2>${loc ? "Cette cave est vide" : "Votre cave est vide"}</h2><p class="muted">${canEditHere() ? "Photographiez une étiquette : la fiche se remplit toute seule." : "Les bouteilles ajoutées par les membres apparaîtront ici."}</p>
        ${canEditHere() ? `<a class="btn big" href="/app/ajouter.html">${I.camera}Ajouter une bouteille</a>` : ""}</div></div>`;
      return banners();
    }
    main.innerHTML = `${top}${priority()}
      ${canEditHere() ? `<a class="btn ghost c-photo" href="/app/sortir.html?loc=${encodeURIComponent(loc || "all")}">${I.camera}Sortir par photo</a>` : ""}
      <section class="c-all" aria-labelledby="all-h"><div class="c-sec-h"><h2 id="all-h">Toute la cave</h2><span>${totalHere()} bouteille${totalHere() > 1 ? "s" : ""}</span></div>
      <div id="findbar">${findBar()}</div><p class="c-count" id="count" role="status" aria-live="polite"></p><div id="list"></div></section></div>`;
    drawList();
    banners();
  }
  // Bandeau Lavaux court : le lieu habille l'accueil, sans rien cacher à lire.
  const head = () => `<section class="c-band" aria-label="Vignes en terrasses d'Épesses, Lavaux"><img src="/assets/img/lavaux/terrasses-epesses.jpg" alt="" width="1600" height="1069" fetchpriority="high">
    <div class="c-band-in"><p>Bonjour${ctx.profile.first_name ? ` ${esc(ctx.profile.first_name)}` : ""}</p><h1>${esc(placeName())}</h1></div></section>`;

  // Invitations, demandes à valider, fiches prêtes, conseil d'installation (anciennement sur « Quelle cave ? »).
  async function banners() {
    const box = $("#invites"); if (!box) return;
    box.innerHTML = (invites || []).map((i) => `<div class="invite" data-id="${i.id}">
      <div><b>${esc(i.invited_by_name || "Quelqu'un")}</b> vous invite à partager « ${esc(i.collection_name)} »${i.role === "viewer" ? " en lecture seule" : ""}.<br><small class="muted">${i.role === "viewer" ? "Vous pourrez consulter ses caves et ses bouteilles, sans les modifier." : "Vous verrez et gérerez ensemble les mêmes caves et bouteilles."}</small></div>
      <div class="row"><button class="btn" data-acc>${I.check}Accepter</button><button class="btn ghost" data-dec>Refuser</button></div></div>`).join("");
    VC.installHint(box);
    if (ctx.profile.is_admin) {
      const { count } = await sb.from("access_requests").select("id", { count: "exact", head: true }).eq("status", "pending");
      if (count) box.insertAdjacentHTML("afterbegin", `<a class="invite" href="/app/admin.html"><div><b>${count} demande${count > 1 ? "s" : ""} d'invitation</b> à valider.</div></a>`);
    }
    const { count: ready } = await sb.from("drafts").select("id", { count: "exact", head: true }).eq("status", "ready");
    if (ready) box.insertAdjacentHTML("beforeend", `<a class="invite" href="/app/ajouter.html"><div><b>${ready} fiche${ready > 1 ? "s" : ""} prête${ready > 1 ? "s" : ""}</b> à vérifier avant d'entrer en cave.</div></a>`);
  }

  main.addEventListener("click", async (e) => {
    const sw = e.target.closest("[data-loc]");
    if (sw) {
      loc = sw.dataset.loc; VC.setLoc(loc || "all");
      history.replaceState(null, "", loc ? `/app/?loc=${loc}` : "/app/");
      const coll = loc ? places.find((x) => x.id === loc).collection_id : null;
      items = coll ? allItems.filter((it) => it.collection_id === coll) : allItems;
      return draw();
    }
    const toggle = e.target.closest("button[data-view]");
    if (toggle) {
      view = toggle.dataset.view;
      try { localStorage.setItem("vc.cave.view", view); } catch { /* préférence de session */ }
      return refresh();
    }
    const out = e.target.closest("[data-out]");
    if (out) {
      e.preventDefault();
      const it = items.find((x) => x.id === out.dataset.out), path = mainImagePath(it);
      VC.takeOut({ item: it, stock: byItem.get(it.id) || [], places, loc, url: path && getUrl(path), onDone: async () => { await load(); draw(); } });
      return;
    }
    const x = e.target.closest("[data-clear]");
    if (x) { const g = x.dataset.clear; state[g] = g === "empty" ? false : ""; if (g === "country") state.region = ""; save(); return refresh(); }
    if (e.target.closest("#open-filters")) return openFilters();
    const inv = e.target.closest(".invite[data-id]");
    if (inv && e.target.closest("[data-acc]")) {
      const { error } = await sb.rpc("accept_invite", { p_invite: inv.dataset.id });
      if (error) return fail(error);
      toast("Partage accepté."); setTimeout(() => location.reload(), 600);
    } else if (inv && e.target.closest("[data-dec]")) {
      const { error } = await sb.rpc("decline_invite", { p_invite: inv.dataset.id });
      if (error) return fail(error);
      invites = invites.filter((i) => i.id !== inv.dataset.id); inv.remove();
    }
  });
  main.addEventListener("input", (e) => { if (e.target.id === "q") { state.q = e.target.value; drawList(); } });

  sb.rpc("my_invites").then(({ data }) => { invites = data || []; if (invites.length) banners(); });
  try { await load(); draw(); } catch (e) { VC.fail(e, "Impossible de charger la cave."); }
})();
