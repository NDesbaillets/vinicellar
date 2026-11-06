// Sommelier : on décrit son menu, l'app propose les bouteilles de la cave à ouvrir, en priorité celles à leur apogée.
(async function () {
  const VC = window.VC;
  const { sb, $, esc, I, toast, fail, bottleSvg, signed, mainImagePath } = VC;
  await VC.boot("sommelier");
  const main = $("#main");
  let loc = VC.getLoc(); if (loc === "all") loc = "";
  let places = [], items = [], stock = [];

  async function load() {
    const [p, a, b] = await Promise.all([VC.loadPlaces(), sb.from("items").select("*"), sb.from("stock").select("*").gt("quantity", 0)]);
    places = p; items = a.data || []; stock = b.data || [];
    if (loc && !places.some((x) => x.id === loc)) loc = "";
  }
  const EXAMPLES = ["Filets de perche, sauce au beurre", "Fondue moitié-moitié", "Côte de bœuf au feu de bois", "Sushis et sashimis", "Risotto aux truffes", "Plateau de fromages d'alpage", "Canard laqué", "Tarte Tatin"];
  const STATUS = { "à l'apogée": "peak", "prête": "ready", "à boire vite": "soon", "trop jeune": "young", "fenêtre dépassée": "past" };

  function render() {
    main.innerHTML = `<div class="page-head"><div><span class="eyebrow">Accords mets et vins</span><h1>Sommelier</h1></div></div>
      <form class="card" id="ask" novalidate>
        <label>Qu'est-ce qu'on mange ?<textarea name="menu" rows="4" maxlength="2000" placeholder="ex. Entrée : tartare de féra. Plat : carré d'agneau, jus au thym, gratin dauphinois. Dessert : tarte au citron."></textarea></label>
        <div class="chips" style="margin-top:8px">${EXAMPLES.map((x) => `<button type="button" class="chip" data-ex="${esc(x)}">${esc(x)}</button>`).join("")}</div>
        <div class="form-line two" style="margin-top:10px">
          <label>Dans quelle cave<select name="loc"><option value="">Toutes les caves</option>${places.map((p) => `<option value="${p.id}"${p.id === loc ? " selected" : ""}>${esc(VC.placeLabel(p, places))}</option>`).join("")}</select></label>
          <button class="btn big" type="submit">${I.sparkle}Proposer</button></div>
      </form>
      <div id="answer"></div>`;
  }

  async function ask(f) {
    const menu = f.menu.value.trim();
    if (menu.length < 3) { f.menu.focus(); return toast("Décrivez le plat ou le menu."); }
    loc = f.loc.value; VC.setLoc(loc || "all");
    const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
    $("#answer").innerHTML = `<div class="card"><div class="progress"><b>Le sommelier descend à la cave…</b><div class="bar"><span></span></div><small class="muted">Quelques secondes.</small></div></div>`;
    const { data, error } = await sb.functions.invoke("sommelier", { body: { menu, location_id: loc || null } });
    btn.disabled = false;
    if (error) {
      let m = "Le sommelier ne répond pas. Réessayez.";
      try { const j = await error.context.json(); if (j && j.message) m = j.message; } catch { /* réponse vide */ }
      $("#answer").innerHTML = `<p class="notice">${esc(m)}</p>`; return;
    }
    if (!data.picks || !data.picks.length) {
      $("#answer").innerHTML = `<p class="notice">${esc(data.message || data.missing || "Rien de convaincant dans cette cave pour ce menu.")}</p>`; return;
    }
    await VC.Studio?.loadActive(items);
    const getUrl = await signed(data.picks.map((p) => { const it = items.find((x) => x.id === p.item_id); return it && mainImagePath(it); }).filter(Boolean));
    $("#answer").innerHTML = `${data.intro ? `<p class="lead-s">${esc(data.intro)}</p>` : ""}
      <div class="picks">${data.picks.map((p, i) => {
        const it = items.find((x) => x.id === p.item_id);
        if (!it) return "";
        const url = getUrl(mainImagePath(it));
        const n = stock.filter((s) => s.item_id === it.id && (!loc || s.location_id === loc)).reduce((a, s) => a + s.quantity, 0);
        return `<div class="card pick-card">
          <div class="match">${VC.itemVisual(it, () => url)}
          <div><span class="eyebrow">${i === 0 ? "Notre choix" : "Autre option"}${p.course ? ` · ${esc(p.course)}` : ""}</span>
            <h3 style="margin:0">${esc(it.name)}${it.vintage ? ` <span class="faint">${it.vintage}</span>` : ""}</h3>
            <p class="muted" style="margin:2px 0 8px">${esc([it.producer, it.appellation || it.region].filter(Boolean).join(" · "))}</p>
            <div class="tags"><span class="tag ${STATUS[p.status] || ""}">${esc(p.status === "prête" ? "Prête à boire" : p.status.charAt(0).toUpperCase() + p.status.slice(1))}</span><span class="tag qty">${n} bt.</span></div></div></div>
          <p style="margin:12px 0 4px">${esc(p.why || "")}</p>
          ${p.serve ? `<p class="muted" style="margin:0 0 12px">${I.thermo.replace("<svg", '<svg width="15" height="15" style="vertical-align:-2px;margin-right:4px"')}${esc(p.serve)}</p>` : ""}
          <div class="row">${VC.canEdit(it.collection_id) ? `<button class="btn" data-out="${it.id}">${I.glass}Sortir cette bouteille</button>` : ""}<a class="btn quiet" href="/app/fiche.html?id=${it.id}">Voir la fiche</a></div></div>`;
      }).join("")}</div>
      ${data.missing ? `<p class="notice info" style="margin-top:12px">${esc(data.missing)}</p>` : ""}`;
  }

  try { await load(); render(); } catch (e) { return fail(e, "Impossible de charger la cave."); }
  main.addEventListener("submit", (e) => { if (e.target.id === "ask") { e.preventDefault(); ask(e.target); } });
  main.addEventListener("click", (e) => {
    const ex = e.target.closest("[data-ex]");
    if (ex) { const t = $("#ask").menu; t.value = t.value ? `${t.value.trim()}\n${ex.dataset.ex}` : ex.dataset.ex; return; }
    const out = e.target.closest("[data-out]");
    if (out) {
      const it = items.find((x) => x.id === out.dataset.out);
      VC.takeOut({ item: it, stock: stock.filter((s) => s.item_id === it.id), places, loc, onDone: load });
    }
  });
})();
