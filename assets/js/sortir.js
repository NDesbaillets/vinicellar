// Sortir une bouteille : photo → reconnue parmi les bouteilles de la cave → « Bue » ou « Offerte » en un geste.
// Sans photo : recherche dans la liste.
(async function () {
  const VC = window.VC;
  const { sb, $, esc, I, bottleSvg, signed, mainImagePath, windowStatus, toast } = VC;
  await VC.boot("out");
  const main = $("#main");
  let loc = new URLSearchParams(location.search).get("loc") || VC.getLoc() || "all";
  if (loc === "all") loc = "";

  let places = [], items = [], stock = [], getUrl = () => null;
  async function load() {
    const [p, a, b] = await Promise.all([VC.loadPlaces(), sb.from("items").select("*"), sb.from("stock").select("*").gt("quantity", 0)]);
    places = p.filter((x) => VC.canEdit(x.collection_id)); items = (a.data || []).filter((it) => VC.canEdit(it.collection_id)); stock = b.data || [];
    if (loc && !places.some((x) => x.id === loc)) loc = "";
    await VC.Studio?.loadActive(items);
    getUrl = await signed(items.map(mainImagePath));
  }
  const rowsOf = (id) => stock.filter((s) => s.item_id === id);
  const qty = (id) => rowsOf(id).filter((s) => !loc || s.location_id === loc).reduce((a, s) => a + s.quantity, 0);
  const available = () => items.filter((it) => qty(it.id) > 0)
    .sort((a, b) => ((windowStatus(a)?.rank ?? 5) - (windowStatus(b)?.rank ?? 5)) || VC.title(a).localeCompare(VC.title(b), "fr"));

  const open = (it) => VC.takeOut({ item: it, stock: rowsOf(it.id), places, loc, onDone: async () => { await load(); drawList($("#q") ? $("#q").value : ""); } });

  function pickRow(it) {
    return `<button class="pick" data-id="${it.id}"><span><b>${esc(it.name)}</b>${it.vintage ? ` ${it.vintage}` : ""}<small>${esc([it.producer, it.appellation || it.region].filter(Boolean).join(" · "))}</small></span><span class="tag qty">${qty(it.id)}</span></button>`;
  }
  function drawList(q = "") {
    const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    const terms = norm(q).split(/\s+/).filter(Boolean);
    const list = available().filter((it) => !terms.length || terms.every((t) => norm([it.name, it.producer, it.vintage, it.region, it.appellation, it.country, ...(it.grapes || [])].join(" ")).includes(t)));
    $("#picks").innerHTML = list.length ? list.map(pickRow).join("") : `<p class="muted">Aucune bouteille${q ? " ne correspond" : " en stock ici"}.</p>`;
  }

  function render() {
    main.innerHTML = `<div class="page-head"><div><span class="eyebrow">Sortie de cave</span><h1>Sortir une bouteille</h1></div></div>
      <label style="max-width:420px">Cave<select id="loc"><option value="">Toutes les caves</option>${places.map((p) => `<option value="${p.id}"${p.id === loc ? " selected" : ""}>${esc(VC.placeLabel(p, places))}</option>`).join("")}</select></label>
      <div class="capture" style="margin-top:16px">
        <label class="capture-btn">${I.camera}<span>Photographier la bouteille</span><small class="muted">Elle est reconnue parmi vos bouteilles</small><input type="file" accept="image/*" capture="environment" data-photo></label>
        <label class="capture-btn">${I.image}<span>Choisir une photo</span><small class="muted">Depuis l'album</small><input type="file" accept="image/*" data-photo></label>
      </div>
      <div id="result"></div>
      <div class="divider">ou dans la liste</div>
      <label class="search"><span class="sr">Rechercher</span>${I.search}<input type="search" id="q" placeholder="Domaine, cuvée, cépage…" autocomplete="off"></label>
      <div class="pick-list" id="picks"></div>`;
    drawList();
    $("#loc").addEventListener("change", (e) => { loc = e.target.value; VC.setLoc(loc || "all"); drawList($("#q").value); });
    $("#q").addEventListener("input", (e) => drawList(e.target.value));
    main.querySelectorAll("[data-photo]").forEach((inp) => inp.addEventListener("change", () => { if (inp.files[0]) onPhoto(inp.files[0]); inp.value = ""; }));
    main.addEventListener("click", (e) => { const b = e.target.closest(".pick[data-id]"); if (b) open(items.find((x) => x.id === b.dataset.id)); });
  }

  async function onPhoto(file) {
    const res = $("#result");
    let img;
    try { img = await VC.shrink(file, 1200, .8); } catch (e) { return VC.fail(e, "Image illisible."); }
    res.innerHTML = `<div class="card" style="margin-top:16px"><div class="preview"><img src="${img.preview}" alt="">
      <div class="progress"><b>Je cherche dans votre cave…</b><div class="bar"><span></span></div><small class="muted">Quelques secondes.</small></div></div></div>`;
    const { data, error } = await sb.functions.invoke("match", { body: { image: img.b64, media_type: "image/jpeg", location_id: loc || null } });
    if (error) {
      let msg = "La reconnaissance a échoué. Choisissez dans la liste.";
      try { const j = await error.context.json(); if (j && j.message) msg = j.message; } catch { /* réponse vide */ }
      res.innerHTML = `<p class="notice" style="margin-top:16px">${esc(msg)}</p>`;
      return;
    }
    const it = items.find((x) => x.id === data.item_id);
    const alts = (data.alternatives || []).map((id) => items.find((x) => x.id === id)).filter((x) => x && x !== it);
    if (!it) {
      const read = data.read || {};
      res.innerHTML = `<div class="notice" style="margin-top:16px">Cette bouteille n'est pas dans ${loc ? "cette cave" : "vos caves"}${read.name || read.producer ? ` (lu : ${esc([read.producer, read.name, read.vintage].filter(Boolean).join(" · "))})` : ""}.
        ${alts.length ? "Peut-être :" : "Choisissez-la dans la liste ci-dessous."}</div>${alts.length ? `<div class="pick-list">${alts.map(pickRow).join("")}</div>` : ""}`;
      if (read.producer || read.name) { $("#q").value = read.producer || read.name; drawList($("#q").value); }
      return;
    }
    const url = getUrl(mainImagePath(it));
    res.innerHTML = `<div class="card" style="margin-top:16px"><div class="match">${VC.itemVisual(it, () => url)}
      <div><span class="eyebrow">Reconnue${data.confidence != null ? ` · ${Math.round(data.confidence * 100)} %` : ""}</span><h2 style="margin:0">${esc(it.name)}${it.vintage ? ` <span class="faint">${it.vintage}</span>` : ""}</h2><p class="muted" style="margin:4px 0 12px">${esc(it.producer || "")}</p>
      <button class="btn big" id="go">${I.glass}Sortir cette bouteille</button></div></div>
      ${alts.length ? `<p class="muted" style="margin:14px 0 0">Pas la bonne ? Peut-être :</p><div class="pick-list">${alts.map(pickRow).join("")}</div>` : ""}</div>`;
    $("#go").addEventListener("click", () => open(it));
    open(it);   // la feuille « Bue / Offerte » s'ouvre directement
  }

  try { await load(); render(); } catch (e) { VC.fail(e, "Impossible de charger la cave."); }
  if (!available().length && !items.length) toast("Votre cave est vide.");
})();
