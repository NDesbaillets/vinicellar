// Abeille de la marque : à l'ouverture, elle arrive par la gauche, fait le tour du pied du verre, souligne « Vinicellar »
// d'un trait pointillé, puis traverse tout le bandeau en vague avec deux loopings, en passant derrière le menu et le
// bouton Ajouter. Sortie à droite, elle réapparaît aussitôt posée au bout du mot, avec trois étincelles.
// Une fois par session ; au survol de la marque sur ordinateur, elle repart.
// Mouvements réduits : l'abeille est posée d'emblée, sans trajet.
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const BEE_VB = "580 366 328 284".split(" ").map(Number);
  const BEE_PATHS = ["M719.925,512.586C720.19,507.13 720.826,501.7 721.408,496.268C723.395,477.764 727.868,461.674 733.837,444.44C737.696,433.3 743.297,422.852 749.096,412.588C749.867,411.223 750.682,409.876 751.668,408.658C757.558,401.38 761.371,395.677 768.683,389.098C780.357,378.594 792.556,371.949 808.013,372.135C820.951,372.29 831.537,377.682 838.694,388.631C847.218,401.671 843.937,421.55 836.565,434.361C839.045,433.489 841.497,432.54 844.005,431.75C854.103,428.574 866.63,427.808 876.715,431.402C885.997,434.709 890.898,438.812 896.427,446.742C903.526,456.922 903.716,469.001 899.925,480.472C898.112,485.96 892.41,494.808 888.268,498.687C885.158,501.6 881.08,505.644 877.728,508.164C870.456,513.634 855.804,522.116 846.483,525.455C829.831,531.419 815.146,536.015 797.399,538.156C792.532,538.743 784.302,538.013 793.415,542.188C799.547,546.487 802.165,547.702 808.738,554.262C823.551,569.048 830.271,583.972 833.36,604.5C834.346,611.054 838.843,618.606 843.481,623.258C844.817,624.598 846.197,625.894 847.515,627.252C853.397,633.314 839.519,632.912 836.743,632.716C833.4,632.48 830.091,631.884 826.749,631.639C819.157,631.083 818.856,632.598 811.212,636.242C795.075,643.933 772.888,644.195 755.873,639.211C732.539,632.376 710.443,615.199 700.887,592.504C700.528,591.653 698.828,586.759 697.915,585.518C696.942,585.658 695.973,585.819 695,585.952C677.86,588.295 661.973,580.37 652.768,565.907C642.594,549.922 644.329,527.126 658.067,513.748C651.593,506.387 649.633,500.983 639.864,495.281C628.068,488.397 619.054,486.862 605.635,488.361C603.968,492.014 602.387,495.718 598.004,496.484C591.246,497.666 586.097,493.914 585.951,487C585.802,479.917 593.309,475.342 599.715,478.139C600.561,478.508 602.805,480.367 603.262,480.405C613.43,479.546 623.888,479.564 633.499,482.992C642.131,486.071 656.294,496.075 661.441,503.5C662.431,504.928 663.444,506.34 664.449,507.757C667.857,505.722 671.458,504.025 675.172,502.626C672.308,491.701 670.459,483.338 661.878,474.114C660.031,472.128 658.227,470.102 656.348,468.147C650.792,462.364 643.249,458.907 635.708,456.181C635.092,456.536 634.738,456.881 634.187,457.371C629.076,461.915 619.949,459.824 618.214,452.92C614.848,439.521 634.44,435.65 637.404,447.268C637.701,448.43 637.421,449.062 638.716,449.305C648.636,451.167 656.073,457.258 663.55,463.416C664.877,464.509 666.155,465.676 667.242,467.013C674.704,476.198 681.629,488.7 683.134,500.598C696.148,499.898 711.627,506.248 719.925,512.586ZM770.971,531.644C784.157,531.601 799.383,530.048 812.589,526.372C818.52,524.722 824.379,522.838 830.283,521.094C835.287,519.615 840.598,516.769 845.462,514.736C858.337,509.356 873.255,499.732 881.653,488.88C889.596,478.616 894.068,465.819 886.945,453.779C881.45,444.491 871.363,440.184 860.869,440.15C850.066,440.115 839.332,443.42 829.862,448.53C824.738,451.294 819.814,454.659 814.88,457.757C806.283,463.157 798.457,469.662 790.441,475.892C788.746,477.208 787.314,478.771 785.683,480.148C781.522,483.661 777.245,486.884 773.427,490.8C769.593,494.733 765.074,498.003 761.344,502.026C758.033,505.598 754.881,509.286 751.418,512.726C748.518,515.606 748.842,518.406 745.687,522.324C744.297,524.051 745.257,524.922 746.939,526.109C754.179,531.22 763.773,531.668 770.971,531.644ZM795.111,557.026C794.168,560.616 793.279,564.22 792.259,567.789C788.36,581.438 779.223,596.963 770.235,607.933C766.994,611.887 764.194,615.899 760.475,619.463C757.943,621.89 755.422,624.335 752.716,626.567C761.932,629.53 765.674,630.565 775.753,631.84C788.256,621.237 801.42,603.469 807.728,587.336C809.28,583.365 810.715,579.349 812.128,575.325C807.92,569.829 804.277,563.697 798.717,559.574C797.534,558.697 796.306,557.886 795.111,557.026ZM735.25,518.8C736.005,518.938 737.915,517.152 738.312,516.688C740.066,514.64 739.746,514.81 741.222,513.107C744.272,509.589 748.363,504.127 751.716,500.724C758.393,493.948 764.877,486.978 772.014,480.672C773.929,478.98 775.641,477.067 777.581,475.404C787.751,466.685 798.325,458.453 809.102,450.494C813.404,447.317 816.714,446.463 819.951,441.97C825.546,434.206 828.58,429.297 831.293,419.993C835.751,404.707 829.311,387.162 812.591,383.582C810.816,383.202 808.992,383.074 807.18,383.076C795.389,383.086 786.535,388.525 777.501,395.562C775.326,397.256 772.529,400.265 770.513,402.28C769.028,403.764 767.479,405.316 766.018,406.934C764.77,408.316 763.585,409.746 762.558,411.222C757.418,418.612 752.465,426.162 748.506,434.246C746.391,438.565 744.535,443.005 742.478,447.353C740.433,451.677 739.257,456.417 737.531,460.882C734.272,469.315 732.7,478.284 730.7,487.101C729.661,491.684 729.165,496.373 728.625,501.041C728.184,504.858 726.725,510.347 729.563,514.493C730.442,515.777 733.74,518.525 735.25,518.8ZM750.117,537.981C747.088,563.328 734.761,581.606 715.914,597.292C719.661,603.029 724.211,608.205 729.3,612.793C731.685,610.95 734.103,609.149 736.426,607.229C744.735,600.362 750.889,592.067 756.785,583.156C764.12,572.069 769.608,555.293 771.304,543.392L750.117,537.981ZM688.75,510.592C670.605,510.703 655.993,525.517 656.131,543.662C656.27,561.806 671.106,576.396 689.25,576.23C707.356,576.064 721.907,561.267 721.769,543.161C721.631,525.055 706.856,510.482 688.75,510.592Z","M674.249,531.494C676.592,531.511 678.739,532.802 679.854,534.862C680.968,536.922 680.872,539.426 679.604,541.396C678.336,543.365 676.096,544.488 673.759,544.326C670.297,544.086 667.652,541.14 667.784,537.673C667.917,534.205 670.779,531.469 674.249,531.494Z"];
  const GOLD = "#D99A1E";
  // Couleur de la marque, lue dans la feuille de style (--logo, le bordeaux du bouton Ajouter).
  const ink = () => getComputedStyle(document.documentElement).getPropertyValue("--logo").trim() || "#713D47";
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const seen = () => { try { return sessionStorage.getItem("vc.bee") === "1"; } catch { return false; } };
  const mark = () => { try { sessionStorage.setItem("vc.bee", "1"); } catch { /* stockage indisponible */ } };
  const el = (tag, attrs = {}, parent) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); parent && parent.append(n); return n; };
  const ease = (t) => -(Math.cos(Math.PI * t) - 1) / 2;   // départ et arrivée en douceur, sans long temps mort

  function attach(brand) {
    if (!brand || brand.dataset.bee) return;
    const glass = brand.querySelector("svg.logo"), word = brand.querySelector("span");
    if (!glass || !word) return;
    brand.dataset.bee = "1";
    const bar = brand.closest(".topbar") || brand.parentElement;
    if (getComputedStyle(bar).position === "static") bar.style.position = "relative";
    const layer = el("svg", { class: "bee-layer", "aria-hidden": "true" });
    bar.append(layer);
    let running = false;

    // Géométrie dans le repère de la marque.
    function geometry() {
      const b = bar.getBoundingClientRect(), g = glass.getBoundingClientRect(), t = word.getBoundingClientRect();
      const G = { x: g.left - b.left, y: g.top - b.top, w: g.width, h: g.height };
      const T = { x: t.left - b.left, y: t.top - b.top, w: t.width, h: t.height };
      const s = Math.max(14, G.h * .62);                       // taille de l'abeille
      const rest = { x: T.x + T.w + s * .75, y: T.y + T.h * .2 };
      const cy = G.y + G.h * .7, cx = G.x + G.w / 2, rx = G.w * 1.25, ry = G.h * .16;
      const base = T.y + T.h * .98, W = b.width, H = b.height, mid = G.y + G.h / 2;
      const hi = Math.max(5, T.y - 2), lo = Math.min(H - 5, base + 6);           // bandes haute et basse de la vague
      const r = Math.max(5, Math.min(9, (lo - hi) * .28));                       // rayon des loopings
      const loop = (x, y) => `L ${x} ${y} a ${r} ${r} 0 1 0 0 ${-2 * r} a ${r} ${r} 0 1 0 0 ${2 * r}`;   // tour complet vers le haut
      // Les deux loopings se font dans l'espace libre avant le menu (ou l'icône du compte) ; ensuite, elle passe derrière.
      const E = T.x + T.w, free = [...bar.querySelectorAll(".nav, .me")].map((n) => n.getBoundingClientRect()).filter((n) => n.width)
        .reduce((m, n) => Math.min(m, n.left - b.left), W);
      const room = Math.max(90, free - E - 12), span = Math.max(80, W - E), x1 = E + room * .36, x2 = E + room * .8;
      const d = [
        `M ${-s} ${mid - G.h * .1}`,                                                                       // arrivée par la gauche
        `C ${cx - rx - 30} ${mid - G.h * .3}, ${cx - rx - 14} ${cy - 10}, ${cx - rx - 6} ${cy - 4}`,
        `C ${cx - rx + 2} ${cy + ry * 1.6}, ${cx + rx} ${cy + ry * 1.8}, ${cx + rx + 2} ${cy}`,               // devant le pied du verre
        `C ${cx + rx + 4} ${cy - ry * 1.4}, ${cx - rx * .4} ${cy - ry * 1.6}, ${cx - rx * .2} ${cy - ry * .2}`, // derrière, petite boucle
        `C ${cx} ${cy + ry * 2.2}, ${T.x + T.w * .1} ${base + 3}, ${T.x + T.w * .3} ${base + 2}`,             // vers le dessous du mot
        `S ${T.x + T.w * .75} ${base + 7}, ${E} ${base}`,                                                     // soulignement en vague
        `C ${E + room * .12} ${base - 4}, ${x1 - room * .2} ${hi}, ${x1 - room * .05} ${lo - 2}`,            // vague vers le premier looping
        loop(x1, lo - 1),
        `C ${x1 + room * .12} ${lo}, ${(x1 + x2) / 2 - room * .1} ${hi}, ${(x1 + x2) / 2} ${hi}`,                    // vague haute
        `S ${x2 - room * .12} ${lo}, ${x2} ${lo - 1}`,
        loop(x2, lo - 1),
        `C ${x2 + span * .12} ${lo}, ${x2 + span * .2} ${hi}, ${W - span * .04} ${mid}`,                     // derrière le menu, puis sortie à droite
        `S ${W + s * .6} ${hi + 2}, ${W + s * 1.5} ${mid - 2}`,
      ].join(" ");
      return { G, T, s, rest, d, w: W, h: H };
    }

    function sparks(parent, x, y, k, rot = 0) {
      const g = el("g", { class: "bee-spark", transform: `translate(${x} ${y}) rotate(${rot}) scale(${k})` }, parent);
      for (const [x1, y1, x2, y2] of [[0, -2, 1.5, -7], [3, 0, 7, -4], [4, 3, 9, 2.5]]) el("line", { x1, y1, x2, y2, stroke: GOLD, "stroke-width": 1.4, "stroke-linecap": "round" }, g);
      return g;
    }

    function beeNode(parent, s) {
      const [vx, vy, vw, vh] = BEE_VB, k = s / vw;
      const outer = el("g", { class: "bee" }, parent), inner = el("g", {}, outer);
      const art = el("g", { transform: `scale(${k}) translate(${-vx - vw / 2} ${-vy - vh / 2})`, fill: ink() }, inner);
      BEE_PATHS.forEach((d) => el("path", { d }, art));
      return { outer, inner };
    }

    function frame(geo) {
      layer.setAttribute("width", Math.ceil(geo.w)); layer.setAttribute("height", Math.ceil(geo.h));
      layer.setAttribute("viewBox", `0 0 ${Math.ceil(geo.w)} ${Math.ceil(geo.h)}`);
      layer.innerHTML = "";
    }

    function still() {
      const geo = geometry(); frame(geo);
      const b = beeNode(layer, geo.s);
      b.outer.setAttribute("transform", `translate(${geo.rest.x} ${geo.rest.y})`);
    }

    function fly() {
      if (running) return; running = true;
      const geo = geometry(); frame(geo);
      const id = "bee-m-" + Math.random().toString(36).slice(2, 7);
      const defs = el("defs", {}, layer), mask = el("mask", { id, maskUnits: "userSpaceOnUse" }, defs);
      const reveal = el("path", { d: geo.d, fill: "none", stroke: "#fff", "stroke-width": 6, "stroke-linecap": "round" }, mask);
      const trail = el("path", { d: geo.d, fill: "none", stroke: ink(), "stroke-width": 1.3, "stroke-dasharray": "3.5 3.5", "stroke-linecap": "round", opacity: .55, mask: `url(#${id})`, class: "bee-trail" }, layer);
      const L = trail.getTotalLength();
      // Longueur parcourue quand l'abeille arrive au verre (pour les étincelles dorées).
      const probe = el("path", { d: geo.d.split(" C ").slice(0, 3).join(" C "), fill: "none" }, defs), L0 = probe.getTotalLength() || L * .2;
      reveal.setAttribute("stroke-dasharray", `${L} ${L}`); reveal.setAttribute("stroke-dashoffset", L);
      const s1 = sparks(layer, geo.G.x + geo.G.w * .95, geo.G.y + 1, geo.s / 16, 0);
      const bee = beeNode(layer, geo.s);
      const T = Math.min(8500, 2800 + L * 6.5), t0 = performance.now();
      let last = trail.getPointAtLength(0), face = 1;
      function step(now) {
        const u = Math.min(1, (now - t0) / T), e = ease(u), p = trail.getPointAtLength(e * L);
        reveal.setAttribute("stroke-dashoffset", L * (1 - e));
        const dx = p.x - last.x, dy = p.y - last.y;
        if (Math.abs(dx) > .15) face = dx > 0 ? 1 : -1;               // l'abeille regarde à gauche au repos : on la retourne vers la droite
        const tilt = Math.max(-25, Math.min(25, Math.atan2(dy, Math.abs(dx) || .01) * 57 * (face > 0 ? 1 : -1)));
        const bob = Math.sin(now / 70) * .8;
        bee.outer.setAttribute("transform", `translate(${p.x} ${p.y + bob})`);
        bee.inner.setAttribute("transform", `scale(${face > 0 ? -1 : 1} 1) rotate(${face > 0 ? -tilt : tilt})`);
        const k = e * L / L0; s1.style.opacity = k > .9 && k < 1.12 ? String(Math.sin((k - .9) / .22 * Math.PI)) : "0";
        last = p;
        if (u < 1) return requestAnimationFrame(step);
        // Sortie à droite : elle réapparaît aussitôt posée au bout du mot, face à lui, avec trois étincelles ; le trait s'efface.
        bee.outer.setAttribute("transform", `translate(${geo.rest.x} ${geo.rest.y})`);
        bee.inner.setAttribute("transform", "scale(1 1)");
        bee.outer.classList.add("arrive");
        const s2 = sparks(layer, geo.rest.x - geo.s * .55, geo.rest.y - geo.s * .45, geo.s / 18, -10);
        s2.classList.add("pop");
        trail.classList.add("fade");
        setTimeout(() => { running = false; }, 1800);
      }
      requestAnimationFrame(step);
    }

    const start = () => (reduce() ? still() : fly());
    if (reduce() || seen()) still(); else { mark(); document.fonts ? document.fonts.ready.then(() => setTimeout(start, 250)) : setTimeout(start, 400); }
    brand.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse" && !reduce()) fly(); });
    // Le mot change de largeur quand la police manuscrite arrive : l'abeille posée suit.
    if ("ResizeObserver" in window) { const ro = new ResizeObserver(() => { if (!running) still(); }); ro.observe(word); ro.observe(bar); }
    else addEventListener("resize", () => { if (!running) still(); });
  }

  function scan() { document.querySelectorAll(".brand").forEach(attach); }
  const top = document.getElementById("topbar");
  if (top) new MutationObserver(scan).observe(top, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan); else scan();
})();
