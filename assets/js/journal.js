// Journal : toutes les dégustations, de la plus récente à la plus ancienne, avec recherche.
(async function () {
  const VC = window.VC;
  const { sb, $, esc, I, date, stars } = VC;
  await VC.boot("carnet");
  const main = $("#main");

  const [{ data: rows, error }, { data: places }] = await Promise.all([
    sb.from("tastings").select("*, items(id, name, producer, vintage, category, style)").order("tasted_on", { ascending: false }).order("created_at", { ascending: false }).limit(1000),
    sb.from("locations").select("id, name")
  ]);
  if (error) return VC.fail(error, "Impossible de charger le journal.");
  const place = (id) => (places || []).find((p) => p.id === id)?.name || "";

  main.innerHTML = `<div class="page-head"><div><span class="eyebrow">Sorties et dégustations</span><h1>Carnet</h1></div></div>${VC.carnetNav("journal")}
    <div class="chips" id="reasons"><button class="chip" data-r="" aria-pressed="true">Toutes</button><button class="chip" data-r="drunk" aria-pressed="false">Bues</button><button class="chip" data-r="gifted" aria-pressed="false">Offertes</button><button class="chip" data-r="other" aria-pressed="false">Autres</button></div>
    <div class="toolbar" style="grid-template-columns:1fr"><label class="search"><span class="sr">Rechercher</span>${I.search}<input type="search" id="q" placeholder="Vin, plat, occasion, commentaire…"></label></div>
    <div class="card" id="list"></div>`;

  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  let reason = "";
  function draw(q = $("#q") ? $("#q").value : "") {
    const terms = norm(q).split(/\s+/).filter(Boolean);
    const list = (rows || []).filter((r) => {
      if (reason && r.reason !== reason) return false;
      if (!terms.length) return true;
      const hay = norm([r.items?.name, r.items?.producer, r.items?.vintage, r.pairing, r.occasion, r.notes].join(" "));
      return terms.every((t) => hay.includes(t));
    });
    $("#list").innerHTML = list.length ? list.map((r) => `<div class="tasting">
      <div class="tasting-head"><b>${date(r.tasted_on)}</b><a href="/app/fiche.html?id=${r.item_id}">${esc([r.items?.producer, r.items?.name].filter(Boolean).join(" · "))}${r.items?.vintage ? " " + r.items.vintage : ""}</a>
      <span class="tag ${r.reason === "drunk" ? "ready" : r.reason === "gifted" ? "peak" : ""}">${VC.REASON[r.reason] || "Bue"}${r.recipient ? " à " + esc(r.recipient) : ""}</span><span class="stars-slot" data-r="${r.rating ?? ""}"></span><span class="faint">${esc([place(r.location_id), r.occasion].filter(Boolean).join(" · "))}</span></div>
      ${r.pairing ? `<p class="pair">Avec : ${esc(r.pairing)}</p>` : ""}${r.notes ? `<p>${esc(r.notes)}</p>` : ""}</div>`).join("")
      : `<p class="muted" style="margin:0">${terms.length ? "Aucun résultat." : "Aucune dégustation pour l'instant. Ouvrez une bouteille depuis sa fiche pour commencer votre carnet."}</p>`;
    document.querySelectorAll(".stars-slot").forEach((s) => s.dataset.r && s.append(stars(+s.dataset.r, null, { read: true })));
  }
  draw();
  $("#q").addEventListener("input", (e) => draw(e.target.value));
  $("#reasons").addEventListener("click", (e) => {
    const b = e.target.closest("[data-r]");
    if (!b) return;
    reason = b.dataset.r;
    document.querySelectorAll("#reasons .chip").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    draw();
  });
})();
