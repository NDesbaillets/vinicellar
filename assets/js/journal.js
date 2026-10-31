// Journal : toutes les dégustations, de la plus récente à la plus ancienne, avec recherche.
(async function () {
  const VC = window.VC;
  const { sb, $, esc, I, date, stars } = VC;
  await VC.boot("journal");
  const main = $("#main");

  const [{ data: rows, error }, { data: places }] = await Promise.all([
    sb.from("tastings").select("*, items(id, name, producer, vintage, category, style)").order("tasted_on", { ascending: false }).order("created_at", { ascending: false }).limit(1000),
    sb.from("locations").select("id, name")
  ]);
  if (error) return VC.fail(error, "Impossible de charger le journal.");
  const place = (id) => (places || []).find((p) => p.id === id)?.name || "";
  const thisYear = (rows || []).filter((r) => r.tasted_on.startsWith(String(VC.year))).length;

  main.innerHTML = `<div class="page-head"><div><span class="eyebrow">Carnet de dégustation</span><h1>Journal</h1></div></div>
    <div class="stats"><div class="stat"><b>${(rows || []).length}</b><span>dégustations</span></div><div class="stat"><b>${thisYear}</b><span>en ${VC.year}</span></div></div>
    <div class="toolbar" style="grid-template-columns:1fr"><label class="search"><span class="sr">Rechercher</span>${I.search}<input type="search" id="q" placeholder="Vin, plat, occasion, commentaire…"></label></div>
    <div class="card" id="list"></div>`;

  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  function draw(q = "") {
    const terms = norm(q).split(/\s+/).filter(Boolean);
    const list = (rows || []).filter((r) => {
      if (!terms.length) return true;
      const hay = norm([r.items?.name, r.items?.producer, r.items?.vintage, r.pairing, r.occasion, r.notes].join(" "));
      return terms.every((t) => hay.includes(t));
    });
    $("#list").innerHTML = list.length ? list.map((r) => `<div class="tasting">
      <div class="tasting-head"><b>${date(r.tasted_on)}</b><a href="/app/fiche.html?id=${r.item_id}">${esc([r.items?.producer, r.items?.name].filter(Boolean).join(" · "))}${r.items?.vintage ? " " + r.items.vintage : ""}</a>
      <span class="stars-slot" data-r="${r.rating ?? ""}"></span><span class="faint">${esc([place(r.location_id), r.occasion].filter(Boolean).join(" · "))}</span></div>
      ${r.pairing ? `<p class="pair">Avec : ${esc(r.pairing)}</p>` : ""}${r.notes ? `<p>${esc(r.notes)}</p>` : ""}</div>`).join("")
      : `<p class="muted" style="margin:0">${terms.length ? "Aucun résultat." : "Aucune dégustation pour l'instant. Ouvrez une bouteille depuis sa fiche pour commencer votre carnet."}</p>`;
    document.querySelectorAll(".stars-slot").forEach((s) => s.dataset.r && s.append(stars(+s.dataset.r, null, { read: true })));
  }
  draw();
  $("#q").addEventListener("input", (e) => draw(e.target.value));
})();
