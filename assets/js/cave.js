// Une cave : tableau de bord (bouteilles, rouges, blancs…, cépages), filtres, liste, sortie d'une bouteille en un geste.
(async function () {
  const VC = window.VC;
  const { sb, $, esc, I, CATEGORY_SHORT, STYLE, money, windowStatus, bottleSvg, signed, mainImagePath } = VC;
  const ctx = await VC.boot("cellar");
  const main = $("#main");
  const params = new URLSearchParams(location.search);
  let loc = params.get("loc") || VC.getLoc() || "all";
  if (loc === "all") loc = "";

  let items = [], places = [], stock = [], byItem = new Map(), getUrl = () => null;
  let state = { win: "", cat: "", grape: "", country: "", region: "", price: "", q: "", sort: "urgent", empty: false };
  try { Object.assign(state, JSON.parse(localStorage.getItem("vc.cave.filters") || "{}"), { q: "", grape: "", country: "", region: "" }); } catch { /* stockage indisponible */ }
  const save = () => { try { localStorage.setItem("vc.cave.filters", JSON.stringify({ win: state.win, cat: state.cat, sort: state.sort })); } catch { /* idem */ } };

  async function load() {
    const [p, a, b] = await Promise.all([
      VC.loadPlaces(),
      sb.from("items").select("*").order("created_at", { ascending: false }),
      sb.from("stock").select("item_id, location_id, quantity, bin")
    ]);
    if (a.error) throw a.error;
    places = p; items = a.data || []; stock = b.data || [];
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

  // Bandeau de chiffres sur une ligne (défilante) ; toucher un type filtre la liste.
  function dashboard() {
    const inStock = items.filter((it) => qty(it) > 0);
    const total = inStock.reduce((a, it) => a + qty(it), 0);
    const counts = KINDS.map((k) => ({ ...k, n: inStock.filter(k.test).reduce((a, it) => a + qty(it), 0) }));
    const cur = ctx.profile.currency || "CHF";
    const value = inStock.reduce((a, it) => a + (it.market_currency === cur && it.market_price ? it.market_price * qty(it) : 0), 0);
    const ready = inStock.filter((it) => { const w = windowStatus(it); return w && w.rank <= 3; }).reduce((a, it) => a + qty(it), 0);
    const urgent = inStock.filter((it) => { const w = windowStatus(it); return w && w.rank <= 1; }).reduce((a, it) => a + qty(it), 0);
    const shown = counts.filter((c) => c.n > 0);
    const sum = [ready && `${ready} prête${ready > 1 ? "s" : ""} à boire`, urgent && `<b style="color:var(--warn)">${urgent} à ouvrir vite</b>`, value && `valeur ${money(Math.round(value), cur)}`].filter(Boolean).join(" · ");
    return `<div class="kstrip" role="toolbar" aria-label="Types">
        <div class="kstat total"><b>${total}</b><span>bouteille${total > 1 ? "s" : ""}</span></div>
        ${shown.map((c) => `<button class="kstat" data-kind="${c.k}" aria-pressed="${state.cat === "kind:" + c.k}"><b>${c.n}</b><span><i style="background:${color(c.k)}"></i>${c.label}</span></button>`).join("")}
      </div>
      ${total ? `<div class="mix" aria-hidden="true">${counts.filter((c) => c.n).map((c) => `<span style="width:${(c.n / total) * 100}%;background:${color(c.k)}"></span>`).join("")}</div>` : ""}
      ${sum ? `<p class="dash-sum">${sum}</p>` : ""}
      ${canEditHere() ? `<div class="cta-row slim"><a class="btn" href="/app/sortir.html?loc=${loc || "all"}">${I.camera}Sortir</a><a class="btn ghost" href="/app/ajouter.html">${I.plus}Ajouter</a></div>` : `<p class="notice info" style="margin-top:12px">Cave partagée en lecture seule.</p>`}`;
  }

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
        <button class="btn ghost filter-btn" id="open-filters" aria-haspopup="dialog">${I.filter}Filtres${n ? ` <span class="count">${n}</span>` : ""}</button>
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
    return `<div class="fsheet"><h2>Filtres</h2>
      ${present.length > 1 ? `<div class="fgroup"><div class="field-label">Type</div><div class="chips">${chip("cat", "", "Tous")}${present.map((k) => chip("cat", "kind:" + k.k, k.one)).join("")}</div></div>` : ""}
      <div class="fgroup"><div class="field-label">Garde</div><div class="chips">${chip("win", "", "Tout")}${Object.entries(WIN).map(([k, l]) => chip("win", k, l)).join("")}</div></div>
      <div class="fgroup"><div class="geo">
        <label>Pays<select id="f-country"><option value="">Tous</option>${opt(countries, state.country)}</select></label>
        <label>Région<select id="f-region"${state.country ? "" : " disabled"}><option value="">${state.country ? "Toutes" : "Choisir un pays"}</option>${opt(regions, state.region)}</select></label>
        <label>Cépage<select id="f-grape"><option value="">Tous</option>${[...grapes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr")).map(([k, n]) => `<option value="${esc(k)}"${k === state.grape ? " selected" : ""}>${esc(k)} (${n})</option>`).join("")}</select></label>
        <label>Prix<select id="f-price"><option value="">Tous</option>${VC.PRICE_BANDS.map(([k, l]) => { const n = bandN(k); return `<option value="${k}"${k === state.price ? " selected" : ""}>${l} ${esc(ctx.profile.currency || "CHF")}${n ? ` (${n})` : ""}</option>`; }).join("")}</select></label>
      </div></div>
      <div class="fgroup"><label>Trier par<select id="sort"><option value="urgent">À boire en priorité</option><option value="name">Nom</option><option value="vintage">Millésime</option><option value="qty">Quantité</option><option value="recent">Ajout récent</option></select></label></div>
      <div class="fgroup"><div class="chips"><button type="button" class="chip" data-group="empty" aria-pressed="${state.empty}">Sorties / à racheter</button></div></div>
      <div class="row end" style="margin-top:18px"><button type="button" class="btn quiet" id="f-reset">Tout effacer</button><button type="button" class="btn" data-close id="f-done">Voir ${filtered().length} vin${filtered().length > 1 ? "s" : ""}</button></div></div>`;
  }

  function openFilters() {
    const d = VC.sheet(filterSheetHtml());
    const redraw = () => { d.querySelector(".dlg").innerHTML = filterSheetHtml(); d.querySelector("#sort").value = state.sort; refresh(); };
    d.querySelector("#sort").value = state.sort;
    d.addEventListener("click", (e) => {
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
      if (id === "f-region") state.region = v;
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

  function card(it) {
    const n = qty(it);
    const w = windowStatus(it);
    const url = getUrl(mainImagePath(it));
    const sub = [it.vintage, it.appellation || it.region, it.country].filter(Boolean).join(" · ");
    const kind = it.category === "wine" ? (STYLE[it.style] || "Vin").split(" ")[0] : CATEGORY_SHORT[it.category];
    return `<div class="bottle-wrap"><a class="bottle" href="/app/fiche.html?id=${it.id}">
      <div class="thumb">${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : bottleSvg(it)}</div>
      <div><h3>${esc(it.name)}</h3><p class="sub">${esc([it.producer, sub].filter(Boolean).join(" · "))}</p>
      <div class="tags"><span class="tag ${n ? "qty" : "zero"}">${n} bt.</span><span class="tag">${esc(kind)}</span>${w ? `<span class="tag ${w.key}">${w.label}</span>` : ""}</div></div></a>
      ${n && VC.canEdit(it.collection_id) ? `<button class="out-btn" data-out="${it.id}" aria-label="Sortir une bouteille : ${esc(it.name)}" title="Sortir une bouteille">${I.glass}</button>` : ""}</div>`;
  }

  function drawList() {
    const list = filtered();
    $("#count").textContent = `${list.length} vin${list.length > 1 ? "s" : ""}`;
    $("#list").innerHTML = list.length ? list.map(card).join("") : `<div class="empty" style="grid-column:1/-1"><p class="muted">Aucune bouteille ne correspond.</p></div>`;
  }
  // Après un changement de filtre : bandeau (type sélectionné), barre de recherche (pastilles actives) et liste.
  function refresh() {
    $("#dash").innerHTML = dashboard();
    const q = $("#q"), focused = document.activeElement === q;
    $("#findbar").innerHTML = findBar();
    if (focused) { const n = $("#q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    drawList();
  }

  function draw() {
    if (!items.length) {
      main.innerHTML = `${head()}<div class="empty">${I.glass}<h2>Cette cave est vide</h2><p class="muted">Photographiez une étiquette : la fiche se remplit toute seule.</p>
        <a class="btn big" href="/app/ajouter.html">${I.camera}Ajouter une bouteille</a></div>`;
      return;
    }
    main.innerHTML = `${head()}<div id="dash">${dashboard()}</div><div id="findbar">${findBar()}</div>
      <div class="list-head"><span id="count"></span></div><div class="list" id="list"></div>`;
    drawList();
  }
  const head = () => `<div class="page-head tight"><div><a class="back-link" href="/app/">${I.back}Caves</a><h1>${esc(placeName())}</h1></div></div>`;

  main.addEventListener("click", (e) => {
    const out = e.target.closest("[data-out]");
    if (out) {
      e.preventDefault();
      const it = items.find((x) => x.id === out.dataset.out);
      VC.takeOut({ item: it, stock: byItem.get(it.id) || [], places, loc, onDone: async () => { await load(); draw(); } });
      return;
    }
    const k = e.target.closest("[data-kind]");
    if (k) { state.cat = state.cat === "kind:" + k.dataset.kind ? "" : "kind:" + k.dataset.kind; save(); return refresh(); }
    const x = e.target.closest("[data-clear]");
    if (x) { const g = x.dataset.clear; state[g] = g === "empty" ? false : ""; if (g === "country") state.region = ""; save(); return refresh(); }
    if (e.target.closest("#open-filters")) openFilters();
  });
  main.addEventListener("input", (e) => { if (e.target.id === "q") { state.q = e.target.value; drawList(); } });

  try { await load(); draw(); } catch (e) { VC.fail(e, "Impossible de charger la cave."); }
})();
