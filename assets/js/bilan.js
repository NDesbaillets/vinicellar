// Bilan de consommation : bouteilles bues et offertes, rythme mensuel, prix moyen du cadeau, ce que l'on boit.
(async function () {
  const VC = window.VC;
  const { sb, $, esc, money, priceOf } = VC;
  const ctx = await VC.boot("carnet");
  const main = $("#main");
  const cur = ctx.profile.currency || "CHF";

  const { data: rows, error } = await sb.from("tastings")
    .select("tasted_on, reason, rating, recipient, item_id, items(name, producer, vintage, category, style, country, region, appellation, grapes, market_price, market_currency, purchase_price, purchase_currency)")
    .order("tasted_on", { ascending: false }).limit(5000);
  if (error) return VC.fail(error, "Impossible de charger le bilan.");

  const today = new Date();
  const PERIODS = { "12m": "12 derniers mois", year: `En ${VC.year}`, all: "Depuis le début" };
  let period = "12m";
  const start = () => period === "year" ? `${VC.year}-01-01`
    : period === "12m" ? new Date(today.getFullYear(), today.getMonth() - 11, 1).toISOString().slice(0, 10) : "0000";
  const price = (r) => { const it = r.items || {}; const p = priceOf(it); const c = it.market_price != null ? it.market_currency : it.purchase_currency; return p != null && (c || "CHF") === cur ? p : null; };
  const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const TYPE = { red: "Rouge", white: "Blanc", rose: "Rosé", sparkling: "Mousseux", sweet: "Liquoreux", fortified: "Muté", orange: "Orange" };
  const typeOf = (it) => it.category === "wine" ? TYPE[it.style] || "Vin" : VC.CATEGORY_SHORT[it.category] || "Autre";
  const grapeName = (g) => g.replace(/\(.*?\)/g, "").replace(/\d+\s*%/g, "").replace(/\s+/g, " ").trim();

  function months() {
    // 12 mois glissants, du plus ancien au plus récent.
    const out = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      out.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleDateString("fr-CH", { month: "short" }).replace(".", ""), full: d.toLocaleDateString("fr-CH", { month: "long", year: "numeric" }), n: 0 });
    }
    for (const r of rows || []) if (r.reason === "drunk") { const m = out.find((x) => x.key === r.tasted_on.slice(0, 7)); if (m) m.n++; }
    return out;
  }

  function top(list, keyFn, n = 6) {
    const m = new Map();
    for (const r of list) for (const k of [].concat(keyFn(r) || [])) if (k) m.set(k, (m.get(k) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
  }
  const topList = (title, arr) => `<div class="card"><h3>${title}</h3>${arr.length ? `<ol class="rank">${arr.map(([k, n]) => `<li><span>${esc(k)}</span><b>${n}</b></li>`).join("")}</ol>` : `<p class="muted" style="margin:0">Pas encore de données.</p>`}</div>`;

  function draw() {
    const from = start();
    const inP = (rows || []).filter((r) => r.tasted_on >= from);
    const drunk = inP.filter((r) => r.reason === "drunk"), gifted = inP.filter((r) => r.reason === "gifted");
    const nMonths = period === "year" ? today.getMonth() + 1 : period === "12m" ? 12
      : Math.max(1, (() => { const first = (rows || []).at(-1); if (!first) return 1; const d = new Date(first.tasted_on); return (today.getFullYear() - d.getFullYear()) * 12 + today.getMonth() - d.getMonth() + 1; })());
    const giftPrices = gifted.map(price).filter((x) => x != null);
    const drunkValue = drunk.map(price).filter((x) => x != null).reduce((a, b) => a + b, 0);
    const ratings = drunk.map((r) => Number(r.rating)).filter((x) => x > 0);
    const ms = months();
    const max = Math.max(1, ...ms.map((m) => m.n));
    const peak = ms.reduce((a, m) => (m.n > a.n ? m : a), ms[0]);

    main.innerHTML = `<div class="page-head"><div><span class="eyebrow">Consommation</span><h1>Carnet</h1></div></div>${VC.carnetNav("bilan")}
      <div class="chips" id="period">${Object.entries(PERIODS).map(([k, l]) => `<button class="chip" data-p="${k}" aria-pressed="${k === period}">${l}</button>`).join("")}</div>
      <div class="stats">
        <div class="stat"><b>${drunk.length}</b><span>bouteille${drunk.length > 1 ? "s" : ""} bue${drunk.length > 1 ? "s" : ""}</span></div>
        <div class="stat"><b>${(drunk.length / nMonths).toFixed(1).replace(".", ",")}</b><span>par mois en moyenne</span></div>
        <div class="stat"><b>${gifted.length}</b><span>offerte${gifted.length > 1 ? "s" : ""}</span></div>
        <div class="stat"><b>${giftPrices.length ? money(Math.round(avg(giftPrices)), cur) : "—"}</b><span>prix moyen d'un cadeau${giftPrices.length && giftPrices.length < gifted.length ? ` (${giftPrices.length} prix connus)` : ""}</span></div>
        <div class="stat"><b>${drunkValue ? money(Math.round(drunkValue), cur) : "—"}</b><span>valeur bue</span></div>
        <div class="stat"><b>${ratings.length ? avg(ratings).toFixed(1).replace(".", ",") : "—"}</b><span>note moyenne /5</span></div>
        <div class="stat"><b>${inP.filter((r) => r.reason === "other").length}</b><span>autres sorties</span></div>
        <div class="stat"><b>${new Set(drunk.map((r) => r.item_id)).size}</b><span>vins différents bus</span></div>
      </div>
      <div class="card"><h3>Bouteilles bues par mois</h3><p class="muted" style="margin:-4px 0 12px;font-size:var(--fs-s)">12 derniers mois${peak.n ? ` · au plus ${max} bouteille${max > 1 ? "s" : ""} en un mois` : ""}</p>
        <div class="months" role="img" aria-label="Bouteilles bues par mois sur les 12 derniers mois">
          ${ms.map((m) => `<div class="mcol" tabindex="0" data-tip="${esc(m.full)} : ${m.n} bouteille${m.n > 1 ? "s" : ""}">
            <span class="mval">${m.n === max && m.n && ms.filter((x) => x.n === max).length === 1 ? m.n : ""}</span>
            <span class="mbar" style="height:${m.n ? Math.max(4, (m.n / max) * 100) : 0}%"></span>
            <span class="mlab">${esc(m.label)}</span></div>`).join("")}
        </div>
        <table class="sr"><caption>Bouteilles bues par mois</caption><tbody>${ms.map((m) => `<tr><th>${esc(m.full)}</th><td>${m.n}</td></tr>`).join("")}</tbody></table>
        <div class="tip" id="tip" hidden></div>
      </div>
      <div class="rank-grid">
        ${topList("Par type", top(drunk, (r) => typeOf(r.items || {})))}
        ${topList("Par région", top(drunk, (r) => VC.regionOf(r.items || {}) || VC.countryOf(r.items || {})))}
        ${topList("Par cépage", top(drunk, (r) => (r.items?.grapes || []).map(grapeName)))}
        ${topList("Les plus bus", top(drunk, (r) => [r.items?.producer, r.items?.name, r.items?.vintage].filter(Boolean).join(" · "), 5))}
        ${topList("Offertes à", top(gifted, (r) => r.recipient, 5))}
      </div>`;
  }

  main.addEventListener("click", (e) => { const b = e.target.closest("[data-p]"); if (b) { period = b.dataset.p; draw(); } });
  // Infobulle au survol, au toucher et au clavier.
  const show = (e) => {
    const c = e.target.closest(".mcol"); const tip = $("#tip");
    if (!c || !tip) { if (tip) tip.hidden = true; return; }
    const card = c.closest(".card").getBoundingClientRect(), r = c.getBoundingClientRect();
    tip.textContent = c.dataset.tip; tip.hidden = false;
    tip.style.left = `${Math.min(card.width - 160, Math.max(10, r.left - card.left + r.width / 2 - 75))}px`;
    tip.style.top = `${c.parentElement.offsetTop - 6}px`;
  };
  main.addEventListener("pointerover", show);
  main.addEventListener("focusin", show);
  main.addEventListener("pointerleave", () => { const t = $("#tip"); if (t) t.hidden = true; });
  draw();
})();
