// Ma cave : chiffres clés, filtres par lieu, par type et par fenêtre de dégustation, recherche, liste.
(async function () {
  const VC = window.VC;
  const { sb, $, esc, I, CATEGORY_SHORT, STYLE, money, windowStatus, bottleSvg, signed, mainImagePath } = VC;
  const ctx = await VC.boot("cellar");
  const main = $("#main");
  const KEY = "vc.cellar.filters";

  const [{ data: items, error }, { data: places }, { data: stock }] = await Promise.all([
    sb.from("items").select("*").order("created_at", { ascending: false }),
    sb.from("locations").select("*").order("position").order("created_at"),
    sb.from("stock").select("item_id, location_id, quantity, bin")
  ]);
  if (error) return VC.fail(error, "Impossible de charger la cave.");

  const byItem = new Map();
  for (const s of stock || []) {
    if (!byItem.has(s.item_id)) byItem.set(s.item_id, []);
    byItem.get(s.item_id).push(s);
  }
  const qty = (it, loc) => (byItem.get(it.id) || []).filter((s) => !loc || s.location_id === loc).reduce((a, s) => a + s.quantity, 0);

  let state = { loc: "", cat: "", win: "", q: "", sort: "urgent", empty: false };
  try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || "{}"), { q: "" }); } catch { /* stockage indisponible */ }
  if (state.loc && !(places || []).some((p) => p.id === state.loc)) state.loc = "";
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ ...state, q: "" })); } catch { /* idem */ } };

  if (!(items || []).length) {
    main.innerHTML = `<div class="page-head"><div><span class="eyebrow">Bonjour ${esc(ctx.profile.first_name || "")}</span><h1>Ma cave</h1></div></div>
      <div class="empty">${I.glass}<h2>Votre cave est vide</h2><p class="muted">Photographiez une étiquette : la fiche se remplit toute seule.</p>
      <a class="btn big" href="/app/ajouter.html">${I.camera}Ajouter une première bouteille</a></div>`;
    return;
  }

  const getUrl = await signed(items.map(mainImagePath));

  function stats() {
    const inLoc = items.filter((it) => qty(it, state.loc) > 0);
    const bottles = inLoc.reduce((a, it) => a + qty(it, state.loc), 0);
    const cur = ctx.profile.currency || "CHF";
    const value = inLoc.reduce((a, it) => a + (it.market_currency === cur && it.market_price ? it.market_price * qty(it, state.loc) : 0), 0);
    const ready = inLoc.filter((it) => { const w = windowStatus(it); return w && w.rank <= 3; }).reduce((a, it) => a + qty(it, state.loc), 0);
    const urgent = inLoc.filter((it) => { const w = windowStatus(it); return w && w.rank <= 1; }).length;
    return `<div class="stats">
      <div class="stat"><b>${bottles}</b><span>bouteille${bottles > 1 ? "s" : ""}</span></div>
      <div class="stat"><b>${inLoc.length}</b><span>référence${inLoc.length > 1 ? "s" : ""}</span></div>
      <div class="stat"><b>${ready}</b><span>prêtes à boire${urgent ? ` · ${urgent} à ouvrir vite` : ""}</span></div>
      <div class="stat"><b>${value ? money(Math.round(value), cur) : "—"}</b><span>valeur estimée</span></div></div>`;
  }

  function chips() {
    const locs = [{ id: "", name: "Toutes les caves" }, ...(places || [])];
    const cats = [...new Set(items.map((i) => i.category))];
    const chip = (group, val, label, n) => `<button class="chip" data-group="${group}" data-val="${esc(val)}" aria-pressed="${state[group] === val}">${esc(label)}${n != null ? `<span class="n">${n}</span>` : ""}</button>`;
    return `<div class="chips" role="toolbar" aria-label="Lieux">${locs.map((l) => chip("loc", l.id, l.name, items.reduce((a, it) => a + qty(it, l.id), 0))).join("")}</div>
      <div class="chips" role="toolbar" aria-label="Filtres">
        ${chip("win", "", "Tout")}${chip("win", "drink", "À boire maintenant")}${chip("win", "urgent", "À ouvrir vite")}${chip("win", "young", "À garder")}
        ${cats.length > 1 ? cats.map((c) => chip("cat", c, CATEGORY_SHORT[c] || c)).join("") : ""}
        ${chip("empty", true, "Bues / à racheter")}
      </div>`;
  }

  function filtered() {
    const q = state.q.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    const list = items.filter((it) => {
      const n = qty(it, state.loc);
      if (state.empty ? n > 0 || (state.loc && !(byItem.get(it.id) || []).some((s) => s.location_id === state.loc)) : n === 0) return false;
      if (state.cat && it.category !== state.cat) return false;
      const w = windowStatus(it);
      if (state.win === "drink" && !(w && w.rank <= 3)) return false;
      if (state.win === "urgent" && !(w && w.rank <= 1)) return false;
      if (state.win === "young" && !(w && w.key === "young")) return false;
      if (q) {
        const hay = [it.name, it.producer, it.region, it.appellation, it.country, it.vintage, ...(it.grapes || [])].join(" ").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
        if (!q.split(/\s+/).every((t) => hay.includes(t))) return false;
      }
      return true;
    });
    const cmp = {
      urgent: (a, b) => ((windowStatus(a)?.rank ?? 5) - (windowStatus(b)?.rank ?? 5)) || ((a.drink_to || 9999) - (b.drink_to || 9999)),
      name: (a, b) => VC.title(a).localeCompare(VC.title(b), "fr"),
      vintage: (a, b) => (a.vintage || 9999) - (b.vintage || 9999),
      recent: (a, b) => b.created_at.localeCompare(a.created_at),
      qty: (a, b) => qty(b, state.loc) - qty(a, state.loc)
    }[state.sort] || (() => 0);
    return list.sort(cmp);
  }

  function card(it) {
    const n = qty(it, state.loc);
    const w = windowStatus(it);
    const url = getUrl(mainImagePath(it));
    const sub = [it.vintage, it.appellation || it.region, it.country].filter(Boolean).join(" · ");
    const kind = it.category === "wine" ? (STYLE[it.style] || "Vin").split(" ")[0] : CATEGORY_SHORT[it.category];
    return `<a class="bottle" href="/app/fiche.html?id=${it.id}">
      <div class="thumb">${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : bottleSvg(it)}</div>
      <div><h3>${esc(it.name)}</h3><p class="sub">${esc([it.producer, sub].filter(Boolean).join(" · "))}</p>
      <div class="tags"><span class="tag ${n ? "qty" : "zero"}">${n} bt.</span><span class="tag">${esc(kind)}</span>${w ? `<span class="tag ${w.key}">${w.label}</span>` : ""}</div></div></a>`;
  }

  main.innerHTML = `<div class="page-head"><div><span class="eyebrow">Bonjour ${esc(ctx.profile.first_name || "")}</span><h1>Ma cave</h1></div></div>
    <div id="stats"></div><div id="chips"></div>
    <div class="toolbar">
      <label class="search"><span class="sr">Rechercher</span>${I.search}<input type="search" id="q" placeholder="Domaine, cuvée, cépage, millésime…" autocomplete="off"></label>
      <select id="sort" aria-label="Trier"><option value="urgent">À boire en priorité</option><option value="name">Nom</option><option value="vintage">Millésime</option><option value="qty">Quantité</option><option value="recent">Ajout récent</option></select>
      <a class="btn ghost sort" href="/app/ajouter.html">${I.plus}Ajouter</a>
    </div>
    <div class="list" id="list"></div>`;
  $("#sort").value = state.sort;

  function draw() {
    $("#stats").innerHTML = stats();
    $("#chips").innerHTML = chips();
    const list = filtered();
    $("#list").innerHTML = list.length ? list.map(card).join("") : `<div class="empty" style="grid-column:1/-1"><p class="muted">Aucune bouteille ne correspond.</p></div>`;
  }
  draw();

  main.addEventListener("click", (e) => {
    const c = e.target.closest(".chip");
    if (!c) return;
    const g = c.dataset.group;
    if (g === "empty") state.empty = !state.empty;
    else state[g] = state[g] === c.dataset.val && g !== "loc" ? "" : c.dataset.val;
    save(); draw();
  });
  $("#q").addEventListener("input", (e) => { state.q = e.target.value; $("#list").innerHTML = filtered().map(card).join("") || `<div class="empty"><p class="muted">Aucune bouteille ne correspond.</p></div>`; });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; save(); draw(); });
})();
