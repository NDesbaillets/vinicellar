// Historique : les vins qu'on a eus en cave et qui n'y sont plus, avec leurs sorties et sa note ; racheter en un geste.
(async function () {
  const VC = window.VC;
  const { sb, $, esc, I, date, stars, toast, fail, bottleSvg, signed, mainImagePath } = VC;
  await VC.boot("carnet");
  const main = $("#main");

  const [{ data: items, error }, { data: stock }, { data: outs }, { data: lists }, { data: wl }] = await Promise.all([
    sb.from("items").select("*"),
    sb.from("stock").select("item_id, quantity"),
    sb.from("tastings").select("item_id, tasted_on, reason, rating"),
    sb.from("wishlists").select("*").order("position").order("created_at"),
    sb.from("wishlist_items").select("item_id")
  ]);
  if (error) return fail(error, "Impossible de charger l'historique.");

  const qty = new Map(), hadStock = new Set();
  for (const s of stock || []) { hadStock.add(s.item_id); qty.set(s.item_id, (qty.get(s.item_id) || 0) + s.quantity); }
  const ex = new Map();
  for (const t of outs || []) { if (!ex.has(t.item_id)) ex.set(t.item_id, []); ex.get(t.item_id).push(t); }
  const wished = new Set((wl || []).map((w) => w.item_id));
  // Un vin « passé » : plus aucune bouteille, mais il a été en cave ou a été sorti.
  const past = (items || []).filter((it) => !(qty.get(it.id) > 0) && (hadStock.has(it.id) || ex.has(it.id)))
    .map((it) => { const o = (ex.get(it.id) || []).sort((a, b) => b.tasted_on.localeCompare(a.tasted_on)); return { it, o, last: o[0] ? o[0].tasted_on : it.updated_at.slice(0, 10) }; })
    .sort((a, b) => b.last.localeCompare(a.last));
  const getUrl = await signed(past.map((p) => mainImagePath(p.it)));

  function card({ it, o, last }) {
    const drunk = o.filter((t) => t.reason === "drunk").length, gifted = o.filter((t) => t.reason === "gifted").length;
    const url = getUrl(mainImagePath(it));
    return `<div class="bottle-wrap" data-id="${it.id}"><a class="bottle" href="/app/fiche.html?id=${it.id}">
      <div class="thumb">${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : bottleSvg(it)}</div>
      <div><h3>${esc(it.name)}${it.vintage ? ` <span class="faint">${it.vintage}</span>` : ""}</h3><p class="sub">${esc([it.producer, it.appellation || it.region].filter(Boolean).join(" · "))}</p>
      <p class="sub" style="margin:0 0 6px">${esc([`dernière sortie ${date(last)}`, drunk && `${drunk} bue${drunk > 1 ? "s" : ""}`, gifted && `${gifted} offerte${gifted > 1 ? "s" : ""}`].filter(Boolean).join(" · "))}</p>
      <span class="stars-slot" data-r="${it.my_rating ?? ""}"></span></div></a>
      ${!VC.canEdit(it.collection_id) ? "" : wished.has(it.id) ? `<span class="out-btn" title="Déjà dans une liste d'envies" style="color:var(--ok)">${I.check}<small>En liste</small></span>` : `<button class="out-btn" data-rebuy aria-label="Ajouter à la liste d'envies" title="Racheter">${I.plus}<small aria-hidden="true">Racheter</small></button>`}</div>`;
  }

  function draw(q = "") {
    const terms = VC.fold(q).split(/\s+/).filter(Boolean);
    const list = past.filter(({ it }) => !terms.length || terms.every((t) => VC.fold([it.name, it.producer, it.vintage, it.region, it.appellation, it.country, ...(it.grapes || [])].join(" ")).includes(t)));
    $("#list").innerHTML = list.length ? list.map(card).join("") : `<div class="empty" style="grid-column:1/-1"><p class="muted">${past.length ? "Aucun résultat." : "Les vins dont la dernière bouteille est sortie apparaîtront ici."}</p></div>`;
    document.querySelectorAll(".stars-slot").forEach((s) => s.dataset.r && s.append(stars(+s.dataset.r, null, { read: true })));
  }

  main.innerHTML = `<div class="page-head"><div><span class="eyebrow">Vins passés par la cave</span><h1>Carnet</h1></div></div>${VC.carnetNav("historique")}
    <p class="muted">${past.length} vin${past.length > 1 ? "s" : ""} sans bouteille en stock. « Racheter » les ajoute à votre liste d'envies.</p>
    <div class="toolbar" style="grid-template-columns:1fr"><label class="search"><span class="sr">Rechercher</span>${I.search}<input type="search" id="q" placeholder="Domaine, cuvée, cépage…"></label></div>
    <div class="list" id="list"></div>`;
  draw();
  $("#q").addEventListener("input", (e) => draw(e.target.value));

  main.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-rebuy]");
    if (!b) return;
    e.preventDefault();
    const it = (items || []).find((x) => x.id === b.closest("[data-id]").dataset.id);
    const own = await VC.wishlistsFor(it.collection_id);
    if (!own.length) return toast("Liste d'envies indisponible.");
    const { error: we } = await sb.from("wishlist_items").insert({ wishlist_id: own[0].id, item_id: it.id });
    if (we && !/duplicate|unique/.test(we.message)) return fail(we);
    wished.add(it.id);
    toast(`Ajouté à « ${own[0].name} ».`, { label: "Voir", run: () => (location.href = "/app/envies.html") });
    draw($("#q").value);
  });
})();
