// Visuel propre d'une bouteille, en un geste.
// L'IA (fonction « visual ») repère les quatre coins de l'étiquette et décrit la bouteille (forme, couleurs).
// Le navigateur redresse la vraie étiquette, la pose sur une bouteille dessinée et enregistre un PNG transparent.
// Rien n'est inventé sur l'étiquette : c'est la photo, redressée. La bouteille autour est une composition.
(function () {
  const VC = window.VC;
  const { sb, $, esc, I, toast, fail } = VC;
  const W = 1000, H = 1800, U = 10;   // image finale ; formes décrites sur 100 × 180 unités

  // Profils : [y, demi-largeur] du haut du goulot au pied ; lèvre, col, épaules, corps.
  const SHAPES = {
    bordeaux: { label: "Bordelaise", cap: 40, pts: [[4, 7.2], [8, 7.2], [9, 6.3], [50, 6.6], [60, 15.5], [68, 19.5], [176, 19.5], [180, 18.2]] },
    burgundy: { label: "Bourguignonne", cap: 40, pts: [[4, 7.4], [8, 7.4], [9, 6.5], [38, 7], [66, 17], [86, 21], [176, 21], [180, 19.8]] },
    champagne: { label: "Champenoise", cap: 62, pts: [[4, 8.2], [9, 8.2], [10, 7.2], [36, 7.8], [66, 18], [88, 22.5], [176, 22.5], [180, 21]] },
    alsace: { label: "Flûte", cap: 44, pts: [[2, 6.4], [6, 6.4], [7, 5.6], [44, 6], [96, 15.5], [112, 16], [176, 16], [180, 15]] },
    spirit: { label: "Spiritueux", cap: 18, pts: [[6, 9], [18, 9], [19, 7.4], [32, 7.4], [40, 20], [46, 22.5], [176, 22.5], [180, 21.5]] }
  };
  const GLASS = [["#1d2e1c", "Vert foncé"], ["#3d3d1c", "Feuille-morte"], ["#3b2414", "Brun"], ["#141414", "Noir"]];
  const LIQ = { red: "#3a0f19", white: "#d9c27a", rose: "#e7a29c", sparkling: "#cdb866", sweet: "#c27e2a", orange: "#cf8538" };
  const guessShape = (it) => {
    const t = VC.fold([it.appellation, it.region, it.name, it.country].join(" "));
    if (it.category && it.category !== "wine") return "spirit";
    if (it.style === "sparkling" || /champagne|cremant|franciacorta|cava|prosecco/.test(t)) return "champagne";
    if (/alsace|riesling|mosel|gewurz|pfalz|wachau/.test(t)) return "alsace";
    if (/bordeaux|medoc|pauillac|margaux|saint-emilion|pessac|rioja|toscan|bolgheri|chianti/.test(t)) return "bordeaux";
    return "burgundy";
  };
  const guessBody = (it) => it.category === "wine" && ["white", "rose", "sparkling", "sweet", "orange"].includes(it.style) ? LIQ[it.style] : "#1d2e1c";

  // ---------------------------------------------------------------- géométrie et pixels
  const hw = (pts, y) => {
    if (y <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const [y0, a] = pts[i - 1], [y1, b] = pts[i];
      if (y <= y1) { const t = (y - y0) / (y1 - y0 || 1); return a + (b - a) * (1 - Math.cos(Math.PI * t)) / 2; }
    }
    return pts[pts.length - 1][1];
  };
  function outline(ctx, shape) {
    const p = SHAPES[shape].pts, top = p[0][0], bot = p[p.length - 1][0];
    ctx.beginPath();
    for (let y = top; y <= bot; y += .5) ctx.lineTo((50 - hw(p, y)) * U, y * U);
    for (let y = bot; y >= top; y -= .5) ctx.lineTo((50 + hw(p, y)) * U, y * U);
    ctx.closePath();
  }
  // Homographie : rectangle de sortie (dw × dh) → quadrilatère source (coins en pixels).
  function homography(q, dw, dh) {
    const d = [[0, 0], [dw, 0], [dw, dh], [0, dh]], A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = d[i], [u, v] = q[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    for (let c = 0; c < 8; c++) {                     // élimination de Gauss
      let m = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[m][c])) m = r;
      [A[c], A[m]] = [A[m], A[c]]; [b[c], b[m]] = [b[m], b[c]];
      for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
    }
    return b.map((v, i) => v / A[i][i]);
  }
  function rectify(src, corners) {
    const q = corners.map(([x, y]) => [x * src.width, y * src.height]);
    const dist = (a, c) => Math.hypot(a[0] - c[0], a[1] - c[1]);
    let dw = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), dh = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
    const k = Math.min(1, 1400 / Math.max(dw, dh)); dw = Math.max(40, Math.round(dw * k)); dh = Math.max(40, Math.round(dh * k));
    const [a, b, c, d, e, f, g, h] = homography(q, dw, dh);
    const s = src.getContext("2d").getImageData(0, 0, src.width, src.height), sd = s.data, sw = src.width, sh = src.height;
    const out = new ImageData(dw, dh), od = out.data;
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      const z = g * x + h * y + 1, u = (a * x + b * y + c) / z, v = (d * x + e * y + f) / z;
      const x0 = Math.max(0, Math.min(sw - 2, u | 0)), y0 = Math.max(0, Math.min(sh - 2, v | 0)), fx = Math.min(1, Math.max(0, u - x0)), fy = Math.min(1, Math.max(0, v - y0));
      const i = (y0 * sw + x0) * 4, o = (y * dw + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const t = sd[i + ch] * (1 - fx) + sd[i + 4 + ch] * fx, B = sd[i + sw * 4 + ch] * (1 - fx) + sd[i + sw * 4 + 4 + ch] * fx;
        od[o + ch] = t * (1 - fy) + B * fy;
      }
      od[o + 3] = 255;
    }
    levels(od);
    const c2 = document.createElement("canvas"); c2.width = dw; c2.height = dh; c2.getContext("2d").putImageData(out, 0, 0);
    return c2;
  }
  // Niveaux automatiques doux (1 % – 99 %), mélangés à 45 % : plus net, sans dénaturer le papier.
  function levels(d) {
    const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)], n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) hist[c][d[i + c] | 0]++;
    const lut = hist.map((hh) => {
      let lo = 0, hi = 255, acc = 0;
      while (lo < 255 && (acc += hh[lo]) < n * .01) lo++;
      acc = 0; while (hi > 0 && (acc += hh[hi]) < n * .01) hi--;
      const span = Math.max(30, hi - lo);
      return Uint8ClampedArray.from({ length: 256 }, (_, v) => v * .55 + Math.min(255, Math.max(0, (v - lo) * 255 / span)) * .45);
    });
    for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = lut[c][d[i + c]];
  }
  const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16), f = (v) => Math.round(Math.min(255, Math.max(0, k < 0 ? v * (1 + k) : v + (255 - v) * k))); return `rgb(${f(n >> 16)},${f(n >> 8 & 255)},${f(n & 255)})`; };

  // ---------------------------------------------------------------- composition
  function compose(o) {
    const s = SHAPES[o.shape], p = s.pts, c = document.createElement("canvas"); c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    const bodyTop = p[p.length - 3][0], half = p[p.length - 2][1];
    // ombre au sol
    const sh = ctx.createRadialGradient(500, 1786, 10, 500, 1786, half * U * 1.3);
    sh.addColorStop(0, "rgba(0,0,0,.22)"); sh.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sh; ctx.beginPath(); ctx.ellipse(500, 1786, half * U * 1.3, 16, 0, 0, Math.PI * 2); ctx.fill();
    // verre : teinte, volume (bords sombres), reflet
    ctx.save(); outline(ctx, o.shape); ctx.clip();
    const x0 = (50 - half) * U, x1 = (50 + half) * U, g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, shade(o.body, -.6)); g.addColorStop(.22, shade(o.body, .1)); g.addColorStop(.5, o.body); g.addColorStop(.85, shade(o.body, -.45)); g.addColorStop(1, shade(o.body, -.7));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // capsule
    const capG = ctx.createLinearGradient(x0, 0, x1, 0);
    capG.addColorStop(0, shade(o.capsule, -.55)); capG.addColorStop(.3, shade(o.capsule, .25)); capG.addColorStop(.6, o.capsule); capG.addColorStop(1, shade(o.capsule, -.6));
    ctx.fillStyle = capG; ctx.fillRect(0, 0, W, s.cap * U);
    ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.fillRect(0, s.cap * U - 3, W, 3);
    // étiquette : vraie photo redressée, enroulée sur le cylindre (bords comprimés et ombrés)
    if (o.label) {
      const maxW = half * 2 * U * .9, maxH = (176 - bodyTop) * U * .8;
      let lw = maxW, lh = lw * o.label.height / o.label.width;
      if (lh > maxH) { lh = maxH; lw = lh * o.label.width / o.label.height; }
      const cy = (bodyTop + (176 - bodyTop) * .5) * U, top = cy - lh / 2, R = half * U, strips = 160;
      for (let i = 0; i < strips; i++) {
        // position sur l'étiquette → angle autour du cylindre → abscisse vue de face
        const t0 = i / strips, t1 = (i + 1) / strips, X = (t) => 500 + R * Math.sin((t - .5) * lw / R);
        ctx.drawImage(o.label, t0 * o.label.width, 0, (t1 - t0) * o.label.width + .5, o.label.height, X(t0), top, X(t1) - X(t0) + .6, lh);
      }
      const xl = 500 - R * Math.sin(lw / 2 / R), xr = 1000 - xl, lg = ctx.createLinearGradient(xl, 0, xr, 0);
      lg.addColorStop(0, "rgba(0,0,0,.30)"); lg.addColorStop(.25, "rgba(0,0,0,0)"); lg.addColorStop(.7, "rgba(0,0,0,0)"); lg.addColorStop(1, "rgba(0,0,0,.34)");
      ctx.fillStyle = lg; ctx.fillRect(xl, top, xr - xl, lh);
    }
    // reflet vertical et liseré de lumière
    const hl = ctx.createLinearGradient(x0, 0, x1, 0);
    hl.addColorStop(.16, "rgba(255,255,255,0)"); hl.addColorStop(.24, "rgba(255,255,255,.28)"); hl.addColorStop(.31, "rgba(255,255,255,0)");
    hl.addColorStop(.86, "rgba(255,255,255,0)"); hl.addColorStop(.9, "rgba(255,255,255,.1)"); hl.addColorStop(.93, "rgba(255,255,255,0)");
    ctx.fillStyle = hl; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    ctx.lineWidth = 2; ctx.strokeStyle = "rgba(0,0,0,.35)"; outline(ctx, o.shape); ctx.stroke();
    return c;
  }

  // ---------------------------------------------------------------- chargement de la photo source
  async function loadSource(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Photo inaccessible.");
    const bmp = await createImageBitmap(await res.blob(), { imageOrientation: "from-image" });
    const k = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return c;
  }
  function forAi(src) {
    const k = Math.min(1, 1100 / Math.max(src.width, src.height)), c = document.createElement("canvas");
    c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    return { image: c.toDataURL("image/jpeg", .85).split(",")[1], width: c.width, height: c.height };
  }

  // ---------------------------------------------------------------- feuille « Visuel propre »
  // it : la fiche ; sources : [{p, u, l}] photos de la fiche ; onSaved() après enregistrement.
  async function open(it, sources, onSaved) {
    const labels = sources.filter((x) => !String(x.p).includes("/visual-"));
    if (!labels.length) return toast("Ajoutez d'abord une photo de l'étiquette.");
    let pick = labels.find((x) => x.p === it.label_path) || labels[0];
    const st = { shape: guessShape(it), body: guessBody(it), capsule: it.category === "wine" && it.style === "red" ? "#5a1525" : "#c9b48a", corners: null, src: null, label: null };
    const d = VC.sheet(`<div class="vis-sheet"><h2>Visuel propre</h2>
      <p class="muted vis-intro">L'IA repère l'étiquette et la bouteille. Vous ajustez si besoin, puis vous l'utilisez comme vignette.</p>
      ${labels.length > 1 ? `<label>Photo de l'étiquette<select id="vis-src">${labels.map((x, i) => `<option value="${i}"${x === pick ? " selected" : ""}>${esc(x.l)}</option>`).join("")}</select></label>` : ""}
      <div class="vis-grid">
        <div><div class="field-label">Étiquette · glissez les coins</div><div class="vis-edit" id="vis-edit"><p class="muted">Chargement…</p></div></div>
        <div><div class="field-label">Résultat</div><div class="vis-out" id="vis-out"><div class="vis-wait"><span class="spin"></span>Analyse de la photo…</div></div></div>
      </div>
      <div class="fgroup"><div class="field-label">Forme</div><div class="chips" id="vis-shape">${Object.entries(SHAPES).map(([k, v]) => `<button type="button" class="chip" data-shape="${k}">${v.label}</button>`).join("")}</div></div>
      <div class="fgroup vis-colors"><div><div class="field-label">Verre</div><div class="chips" id="vis-body"></div></div>
        <label class="vis-cap">Capsule<input type="color" id="vis-capsule"></label></div>
      <p class="hint">L'étiquette est votre photo, redressée ; la bouteille est dessinée. Vos photos d'origine restent dans la galerie.</p>
      <div class="row end vis-actions"><button type="button" class="btn quiet" data-close>Annuler</button><button type="button" class="btn" id="vis-save" disabled>${I.check}Utiliser comme vignette</button></div></div>`);
    const q = (s) => d.querySelector(s);

    const bodies = () => [[st.ai || st.body, "Détecté"], ...GLASS, ...(it.category === "wine" && LIQ[it.style] && it.style !== "red" ? [[LIQ[it.style], "Extra-blanc"]] : [])]
      .filter((x, i, a) => a.findIndex((y) => y[0] === x[0]) === i);
    function controls() {
      q("#vis-shape").querySelectorAll("[data-shape]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.shape === st.shape)));
      q("#vis-body").innerHTML = bodies().map(([c, l]) => `<button type="button" class="chip vis-swatch" data-body="${c}" aria-pressed="${c === st.body}"><i style="background:${c}"></i>${l}</button>`).join("");
      q("#vis-capsule").value = st.capsule;
    }
    let raf = 0;
    function render() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!st.src) return;
        try { st.label = st.corners ? rectify(st.src, st.corners) : null; } catch { st.label = null; }
        const out = compose({ shape: st.shape, body: st.body, capsule: st.capsule, label: st.label });
        out.className = "vis-canvas"; q("#vis-out").replaceChildren(out);
        q("#vis-save").disabled = !st.label;
      });
    }
    // Poignées : quatre coins déplaçables au doigt (pointer events), polygone en SVG.
    function editor() {
      const box = q("#vis-edit");
      box.innerHTML = `<div class="vis-stage"><img alt="Photo source" src="${esc(pick.u)}"><svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true"><polygon/></svg>
        ${[0, 1, 2, 3].map((i) => `<button type="button" class="vis-h" data-h="${i}" aria-label="${["Coin haut gauche", "Coin haut droite", "Coin bas droite", "Coin bas gauche"][i]}"></button>`).join("")}</div>`;
      const stage = box.querySelector(".vis-stage"), poly = box.querySelector("polygon");
      const place = () => {
        const c = st.corners || [[.15, .15], [.85, .15], [.85, .85], [.15, .85]];
        box.querySelectorAll(".vis-h").forEach((h, i) => { h.style.left = `${c[i][0] * 100}%`; h.style.top = `${c[i][1] * 100}%`; });
        poly.setAttribute("points", c.map((p) => p.join(",")).join(" "));
      };
      place();
      box.querySelectorAll(".vis-h").forEach((h) => {
        h.addEventListener("pointerdown", (e) => {
          e.preventDefault(); h.setPointerCapture(e.pointerId);
          if (!st.corners) st.corners = [[.15, .15], [.85, .15], [.85, .85], [.15, .85]];
          const move = (ev) => {
            const r = stage.getBoundingClientRect(), i = +h.dataset.h;
            st.corners[i] = [Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))];
            place();
          };
          const up = () => { h.removeEventListener("pointermove", move); render(); };
          h.addEventListener("pointermove", move); h.addEventListener("pointerup", up, { once: true }); h.addEventListener("pointercancel", up, { once: true });
        });
        // Clavier : flèches pour affiner un coin.
        h.addEventListener("keydown", (e) => {
          const dx = { ArrowLeft: -1, ArrowRight: 1 }[e.key] || 0, dy = { ArrowUp: -1, ArrowDown: 1 }[e.key] || 0;
          if (!dx && !dy) return;
          e.preventDefault(); if (!st.corners) st.corners = [[.15, .15], [.85, .15], [.85, .85], [.15, .85]];
          const c = st.corners[+h.dataset.h], k = e.shiftKey ? .02 : .005;
          c[0] = Math.min(1, Math.max(0, c[0] + dx * k)); c[1] = Math.min(1, Math.max(0, c[1] + dy * k)); place(); render();
        });
      });
      return place;
    }

    async function analyse() {
      q("#vis-save").disabled = true;
      q("#vis-out").innerHTML = `<div class="vis-wait"><span class="spin"></span>Analyse de la photo…</div>`;
      try { st.src = await loadSource(pick.u); } catch (e) { q("#vis-out").innerHTML = `<p class="notice">${esc(e.message)}</p>`; return; }
      st.corners = null;
      const place = editor();
      const { data, error } = await sb.functions.invoke("visual", { body: { ...forAi(st.src), wine: { category: it.category, style: it.style, name: it.name, producer: it.producer, appellation: it.appellation, region: it.region, country: it.country } } });
      if (error || !data) {
        let msg = "Analyse indisponible : placez les quatre coins à la main.";
        try { const j = await error.context.json(); if (j && j.message) msg = j.message; } catch { /* réseau */ }
        toast(msg);
      } else {
        if (data.corners) st.corners = data.corners;
        if (data.shape) st.shape = data.shape;
        if (data.body) { st.ai = data.body; st.body = data.body; }
        if (data.capsule) st.capsule = data.capsule;
        if (!data.corners) toast("Étiquette non repérée : placez les quatre coins.");
      }
      if (!st.corners) st.corners = [[.15, .15], [.85, .15], [.85, .85], [.15, .85]];
      place(); controls(); render();
    }

    d.addEventListener("click", (e) => {
      const s = e.target.closest("[data-shape]"); if (s) { st.shape = s.dataset.shape; controls(); return render(); }
      const b = e.target.closest("[data-body]"); if (b) { st.body = b.dataset.body; controls(); return render(); }
    });
    q("#vis-capsule").addEventListener("input", (e) => { st.capsule = e.target.value; render(); });
    q("#vis-src")?.addEventListener("change", (e) => { pick = labels[+e.target.value]; analyse(); });
    q("#vis-save").addEventListener("click", async () => {
      const btn = q("#vis-save"); btn.disabled = true; btn.textContent = "Enregistrement…";
      const canvas = q("#vis-out canvas");
      // 750 × 1350 : net sur la fiche en écran Retina, deux fois plus léger que l'original de travail.
      const small = document.createElement("canvas"); small.width = 750; small.height = 1350;
      const sctx = small.getContext("2d"); sctx.imageSmoothingQuality = "high"; sctx.drawImage(canvas, 0, 0, 750, 1350);
      const blob = await new Promise((r) => small.toBlob(r, "image/png"));
      const { data: { user } } = await sb.auth.getUser();
      const path = `${user.id}/visual-${crypto.randomUUID()}.png`;
      const up = await sb.storage.from("labels").upload(path, blob, { contentType: "image/png" });
      if (up.error) { btn.disabled = false; btn.textContent = "Utiliser comme vignette"; return fail(up.error); }
      // Un seul visuel dans la galerie : le précédent en sort (le fichier reste dans le stockage privé).
      const photos = [...(it.photo_paths || []).filter((p) => !p.includes("/visual-")), path];
      const { error } = await sb.from("items").update({ photo_paths: photos, cover_path: path }).eq("id", it.id);
      if (error) { btn.disabled = false; return fail(error); }
      d.close(); toast("Visuel enregistré et utilisé comme vignette."); onSaved && onSaved();
    });
    controls(); analyse();
  }

  VC.Visual = { open, compose, rectify, SHAPES, isVisual: (p) => String(p || "").includes("/visual-") };
})();
