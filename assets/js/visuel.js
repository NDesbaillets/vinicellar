// Visuel propre d'une bouteille.
// 1. L'IA (fonction « visual ») repère l'étiquette (six points qui suivent sa courbure), la collerette éventuelle,
//    la forme de bouteille, le verre, le vin et la capsule.
// 2. Le navigateur déroule l'étiquette (cylindre → plan), la détoure selon sa vraie forme (contraste avec le verre
//    ou le fond), puis la pose sur une photo de bouteille vierge rendue en studio (assets/img/bottles, voir
//    scripts/render-bottles.py), avec l'éclairage du rendu. La capsule est teintée à la couleur relevée.
// L'étiquette reste la photo de l'utilisateur : rien n'y est redessiné.
(function () {
  const VC = window.VC;
  const { sb, $, esc, I, toast, fail } = VC;
  const BASE = "/assets/img/bottles/";
  const SHAPE_LABEL = { bordeaux: "Bordelaise", burgundy: "Bourguignonne", champagne: "Champenoise", alsace: "Flûte", spirit: "Spiritueux" };
  const VARIANT_LABEL = { "green-red": "Vert · rouge", "flint-white": "Blanc · vin blanc", "flint-rose": "Blanc · rosé", "olive-red": "Feuille-morte · rouge",
    "olive-white": "Feuille-morte · blanc", "darkgreen-white": "Vert foncé", "green-white": "Vert · blanc", "flint-amber": "Ambré", "flint-clear": "Incolore" };
  const CAP_LABEL = { foil: "Capsule", screwcap: "Capsule à vis", champagne: "Coiffe", stopper: "Bouchon", none: "Aucune" };
  const DEFAULT_GRID = [[.2, .2], [.5, .2], [.8, .2], [.8, .8], [.5, .8], [.2, .8]];
  const NAMES = ["haut gauche", "milieu haut", "haut droite", "bas droite", "milieu bas", "bas gauche"];

  // ---------------------------------------------------------------- ressources (bouteilles rendues)
  let meta = null;
  const imgs = new Map();
  const loadImg = (src) => {
    if (!imgs.has(src)) imgs.set(src, new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; }));
    return imgs.get(src);
  };
  async function loadMeta() {
    if (!meta) meta = await (await fetch(BASE + "bottles.json?v=20261106b")).json();
    return meta;
  }
  const pixels = (img) => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const x = c.getContext("2d"); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height); };
  const lum = (d, i) => .2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2];

  // ---------------------------------------------------------------- choix par défaut
  function guessShape(it) {
    const t = VC.fold([it.appellation, it.region, it.name, it.country].join(" "));
    if (it.category && it.category !== "wine") return "spirit";
    if (it.style === "sparkling" || /champagne|cremant|franciacorta|cava|prosecco/.test(t)) return "champagne";
    if (/alsace|riesling|mosel|gewurz|pfalz|wachau/.test(t)) return "alsace";
    if (/bordeaux|medoc|pauillac|margaux|saint-emilion|pessac|rioja|toscan|bolgheri|chianti/.test(t)) return "bordeaux";
    return "burgundy";
  }
  const liquidOf = (it) => it.category !== "wine" ? (["gin", "sake"].includes(it.category) ? "clear" : "amber") : ({ white: "white", rose: "rose", sparkling: "white", sweet: "white", orange: "white" }[it.style] || "red");
  function variantFor(shape, glass, liquid) {
    const list = meta.shapes[shape].variants;
    return list.find((v) => v === `${glass}-${liquid}`) || list.find((v) => v.endsWith("-" + liquid) && (glass === "flint") === v.startsWith("flint"))
      || list.find((v) => v.endsWith("-" + liquid)) || list.find((v) => (glass === "flint") === v.startsWith("flint")) || list[0];
  }
  function capFor(shape, type) {
    const caps = meta.shapes[shape].caps;
    if (type === "none") return "none";
    if (caps.includes(type)) return type;
    return type === "wax" && caps.includes("foil") ? "foil" : caps[0];
  }

  // ---------------------------------------------------------------- déroulage de l'étiquette
  // Six points (normalisés) : TL, TM, TR, BR, BM, BL. Bords haut et bas quadratiques ; si l'étiquette est sur la
  // bouteille, l'abscisse suit un cylindre (demi-angle visible PHI), sinon elle est linéaire.
  const PHI = 50 * Math.PI / 180, MARGIN = .07;
  const quad = (a, m, b, t) => [a[0] * (2 * t * t - 3 * t + 1) + m[0] * (4 * t - 4 * t * t) + b[0] * (2 * t * t - t), a[1] * (2 * t * t - 3 * t + 1) + m[1] * (4 * t - 4 * t * t) + b[1] * (2 * t * t - t)];
  function unwrap(src, grid, onBottle, outline) {
    const sw = src.width, sh = src.height, P = grid.map(([x, y]) => [x * sw, y * sh]);
    const [TL, TM, TR, BR, BM, BL] = P;
    const len = (a, m, b) => { let L = 0, p = a; for (let i = 1; i <= 20; i++) { const q = quad(a, m, b, i / 20); L += Math.hypot(q[0] - p[0], q[1] - p[1]); p = q; } return L; };
    let w = (len(TL, TM, TR) + len(BL, BM, BR)) / 2 * (onBottle ? PHI / Math.sin(PHI) : 1);
    let h = (Math.hypot(TL[0] - BL[0], TL[1] - BL[1]) + Math.hypot(TR[0] - BR[0], TR[1] - BR[1])) / 2;
    const k = Math.min(1, 1300 / Math.max(w, h)); w = Math.max(40, Math.round(w * k)); h = Math.max(40, Math.round(h * k));
    const mx = Math.round(w * MARGIN), my = Math.round(h * MARGIN), W = w + 2 * mx, H = h + 2 * my;
    const sd = src.getContext("2d").getImageData(0, 0, sw, sh).data, out = new ImageData(W, H), od = out.data;
    // Contour tracé par l'IA : rempli dans l'espace de la photo, puis déroulé comme les pixels.
    let pm = null, poly = null;
    if (outline && outline.length >= 8) {
      const c = document.createElement("canvas"); c.width = sw; c.height = sh; const x = c.getContext("2d");
      x.beginPath(); outline.forEach(([a, b], i) => i ? x.lineTo(a * sw, b * sh) : x.moveTo(a * sw, b * sh)); x.closePath(); x.fill();
      pm = x.getImageData(0, 0, sw, sh).data; poly = new Uint8Array(W * H);
    }
    for (let X = 0; X < W; X++) {
      const u = (X - mx) / w;
      const t = onBottle ? .5 + Math.sin(Math.max(-1.45, Math.min(1.45, (u - .5) * 2 * PHI))) / (2 * Math.sin(PHI)) : u;
      const top = quad(TL, TM, TR, t), bot = quad(BL, BM, BR, t);
      for (let Y = 0; Y < H; Y++) {
        const v = (Y - my) / h, x = top[0] + (bot[0] - top[0]) * v, y = top[1] + (bot[1] - top[1]) * v;
        if (x < 0 || y < 0 || x >= sw - 1 || y >= sh - 1) continue;
        const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = (y0 * sw + x0) * 4, o = (Y * W + X) * 4;
        for (let c = 0; c < 3; c++) {
          const a = sd[i + c] + (sd[i + 4 + c] - sd[i + c]) * fx, b = sd[i + sw * 4 + c] + (sd[i + sw * 4 + 4 + c] - sd[i + sw * 4 + c]) * fx;
          od[o + c] = a + (b - a) * fy;
        }
        od[o + 3] = 255;
        if (pm) poly[Y * W + X] = pm[(Math.round(y) * sw + Math.round(x)) * 4 + 3] > 127 ? 1 : 0;
      }
    }
    return { data: out, w: W, h: H, mx, my, cw: w, ch: h, poly };
  }

  // ---------------------------------------------------------------- détourage selon la forme réelle
  // Deux modèles de couleur : le papier (relevé au centre de l'étiquette) et le fond (relevé dans la marge :
  // verre, reflets, table). Le fond est propagé depuis le bord du cadre à travers les pixels plus proches du fond
  // que du papier ; ce qui reste est l'étiquette, avec sa vraie silhouette (arc, ovale, coins coupés).
  function kmeans(d, idx, k) {
    let C = Array.from({ length: k }, (_, i) => { const j = idx[Math.floor((i + .5) * idx.length / k)]; return [d[j], d[j + 1], d[j + 2]]; });
    for (let it = 0; it < 8; it++) {
      const acc = C.map(() => [0, 0, 0, 0]);
      for (const j of idx) { let b = 0, bd = 1e9; for (let c = 0; c < k; c++) { const q = (d[j] - C[c][0]) ** 2 + (d[j + 1] - C[c][1]) ** 2 + (d[j + 2] - C[c][2]) ** 2; if (q < bd) { bd = q; b = c; } } const a = acc[b]; a[0] += d[j]; a[1] += d[j + 1]; a[2] += d[j + 2]; a[3]++; }
      C = C.map((c, i) => acc[i][3] ? [acc[i][0] / acc[i][3], acc[i][1] / acc[i][3], acc[i][2] / acc[i][3]] : c);
    }
    return C;
  }
  const near = (d, j, C) => { let bd = 1e9; for (const c of C) { const q = (d[j] - c[0]) ** 2 + (d[j + 1] - c[1]) ** 2 + (d[j + 2] - c[2]) ** 2; if (q < bd) bd = q; } return Math.sqrt(bd); };
  // Morphologie binaire carrée (érosion si keep = 1, dilatation si keep = 0).
  function morph(src, W, H, rad, keep) {
    const n = W * H, tmp = new Uint8Array(n), out = new Uint8Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {           // passe horizontale
      let v = keep; for (let dx = -rad; dx <= rad; dx++) { const X = x + dx, s = X < 0 || X >= W ? 0 : src[y * W + X]; if (s !== keep) { v = 1 - keep; break; } }
      tmp[y * W + x] = v;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {           // passe verticale
      let v = keep; for (let dy = -rad; dy <= rad; dy++) { const Y = y + dy, s = Y < 0 || Y >= H ? 0 : tmp[Y * W + x]; if (s !== keep) { v = 1 - keep; break; } }
      out[y * W + x] = v;
    }
    return out;
  }
  // Contour de l'IA affiné au pixel : dans une bande de ±3 % autour du tracé, chaque pixel va au papier ou au fond
  // selon sa couleur (modèles relevés de part et d'autre de la bande). Hors bande, le tracé fait foi.
  function refine(u) {
    const { data, w: W, h: H, cw, ch, poly } = u, d = data.data, n = W * H;
    const rad = Math.max(2, Math.round(Math.min(cw, ch) * .025));
    const core = morph(poly, W, H, Math.max(1, rad >> 2), 1), inner = morph(poly, W, H, rad, 1), outer = morph(poly, W, H, rad, 0), far = morph(poly, W, H, rad * 2, 0);
    const fgIdx = [], bgIdx = [];
    for (let p = 0; p < n; p += 2) { if (!d[p * 4 + 3]) continue; if (core[p]) fgIdx.push(p * 4); else if (!far[p]) bgIdx.push(p * 4); }
    if (fgIdx.length < 40 || bgIdx.length < 40) return null;
    const BG = kmeans(d, bgIdx, 5), dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    // Papier, liseré compris (échantillonné jusqu'au bord du tracé) ; sans les couleurs foncées proches du verre.
    const FG = kmeans(d, fgIdx, 8).filter((c) => { const m = Math.min(...BG.map((b) => dist(b, c))); return m > 30 && !(m < 90 && .2126 * c[0] + .7152 * c[1] + .0722 * c[2] < 85); });
    if (!FG.length) return null;
    // Dans la bande : couleur, avec une préférence pour le côté où le tracé place le pixel.
    const f = new Float32Array(n);
    for (let p = 0; p < n; p++) {
      const j = p * 4;
      if (inner[p]) f[p] = 1;
      else if (!outer[p] || !d[j + 3]) f[p] = 0;
      else f[p] = near(d, j, FG) * (poly[p] ? .8 : 1.2) <= near(d, j, BG) ? 1 : 0;
    }
    // Lissage du contour : flou séparable puis seuil à 0,5 (bord net, sans dents ni grains).
    const blur = (src, r) => {
      const t = new Float32Array(n), o = new Float32Array(n), k = 2 * r + 1;
      for (let y = 0; y < H; y++) { let acc = 0; for (let x = -r; x <= r; x++) acc += src[y * W + Math.min(W - 1, Math.max(0, x))]; for (let x = 0; x < W; x++) { t[y * W + x] = acc / k; acc += src[y * W + Math.min(W - 1, x + r + 1)] - src[y * W + Math.max(0, x - r)]; } }
      for (let x = 0; x < W; x++) { let acc = 0; for (let y = -r; y <= r; y++) acc += t[Math.min(H - 1, Math.max(0, y)) * W + x]; for (let y = 0; y < H; y++) { o[y * W + x] = acc / k; acc += t[Math.min(H - 1, y + r + 1) * W + x] - t[Math.max(0, y - r) * W + x]; } }
      return o;
    };
    const sm = blur(blur(f, Math.max(1, rad >> 1)), Math.max(1, rad >> 1));
    const m = Uint8Array.from(sm, (v) => v >= .5 ? 1 : 0);
    let agree = 0; for (let p = 0; p < n; p++) if (m[p] === poly[p]) agree++;
    // Garde-fou : un affinage qui s'écarte trop du tracé (fond trop proche du papier) est abandonné pour le tracé.
    return agree / n > .9 ? m : poly;
  }
  function cutout(u, mode) {
    const { data, w: W, h: H, mx, my, cw, ch } = u, d = data.data, n = W * H;
    // Cadre de travail : le rectangle de l'IA élargi de 3 % (ses points peuvent être un peu courts).
    const ex = Math.round(cw * .03), ey = Math.round(ch * .03), fx0 = mx - ex, fy0 = my - ey, fx1 = mx + cw + ex, fy1 = my + ch + ey;
    const inFrame = (x, y) => x >= fx0 && x < fx1 && y >= fy0 && y < fy1;
    let mask = new Uint8Array(n), shaped = false;
    if (mode !== "rect" && u.poly) {
      const r = refine(u);
      if (r) { mask = r; shaped = true; }
    }
    if (mode !== "rect" && !shaped) {
      const bgIdx = [], labIdx = []; let BG = [], LAB = [];
      for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
        const j = (y * W + x) * 4; if (!d[j + 3]) continue;
        if (!inFrame(x, y)) bgIdx.push(j);
        else if (x > mx + cw * .2 && x < mx + cw * .8 && y > my + ch * .2 && y < my + ch * .8) labIdx.push(j);
      }
      if (bgIdx.length > 40 && labIdx.length > 40) {
        BG = kmeans(d, bgIdx, 5); const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        // Papier seulement : les couleurs de l'étiquette proches du fond (texte foncé sur verre sombre) sont écartées.
        LAB = kmeans(d, labIdx, 6).filter((c) => { const m = Math.min(...BG.map((b) => dist(b, c))); return m > 30 && !(m < 90 && .2126 * c[0] + .7152 * c[1] + .0722 * c[2] < 85); });
      }
      if (bgIdx.length > 40 && labIdx.length > 40 && LAB.length) {
        const isBg = new Uint8Array(n);
        // Seuil de ressemblance au fond, calé sur la dispersion des couleurs de la marge elle-même.
        const spread = bgIdx.map((j) => near(d, j, BG)).sort((a, b) => a - b), tol = Math.max(18, Math.min(45, spread[Math.floor(spread.length * .92)] * 1.2));
        for (let p = 0; p < n; p++) { const j = p * 4, b = near(d, j, BG); isBg[p] = !d[j + 3] || (b < tol && b * 1.15 < near(d, j, LAB)) ? 1 : 0; }
        const bg = new Uint8Array(n), stack = [];
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!inFrame(x, y)) { const p = y * W + x; bg[p] = 1; }
        // Germes : le pourtour intérieur du cadre, là où il touche du fond.
        for (let y = fy0; y < fy1; y++) for (let x = fx0; x < fx1; x++) {
          if (x !== fx0 && x !== fx1 - 1 && y !== fy0 && y !== fy1 - 1) continue;
          const p = y * W + x; if (p >= 0 && p < n && isBg[p] && !bg[p]) { bg[p] = 1; stack.push(p); }
        }
        while (stack.length) {
          const p = stack.pop(), x = p % W;
          for (const r of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W]) if (r >= 0 && r < n && !bg[r] && isBg[r]) { bg[r] = 1; stack.push(r); }
        }
        // Ouverture (érosion puis dilatation) : retire les filaments laissés par les reflets du verre.
        const rad = Math.max(1, Math.round(Math.min(cw, ch) * .012));
        let m = Uint8Array.from(bg, (v) => 1 - v);
        m = morph(morph(m, W, H, rad, 1), W, H, rad, 0);
        // Plus grande zone ; contrôle : elle doit couvrir l'essentiel du cadre de l'IA.
        const lab = new Int32Array(n).fill(-1); let best = -1, bestN = 0, id = 0;
        for (let p = 0; p < n; p++) {
          if (!m[p] || lab[p] >= 0) continue;
          let cnt = 0; stack.push(p); lab[p] = id;
          while (stack.length) { const q = stack.pop(), x = q % W; cnt++; for (const r of [x > 0 ? q - 1 : -1, x < W - 1 ? q + 1 : -1, q - W, q + W]) if (r >= 0 && r < n && m[r] && lab[r] < 0) { lab[r] = id; stack.push(r); } }
          if (cnt > bestN) { bestN = cnt; best = id; } id++;
        }
        let core = 0;
        for (let p = 0; p < n; p++) if (lab[p] === best) { mask[p] = 1; const x = p % W, y = (p / W) | 0; if (x >= mx && x < mx + cw && y >= my && y < my + ch) core++; }
        shaped = core / (cw * ch) > .6 && bestN / (cw * ch) < 1.12;
      }
    }
    if (!shaped) {                         // rectangle aux coins légèrement arrondis
      const r = Math.min(cw, ch) * .02;
      mask = new Uint8Array(n);
      for (let y = my; y < my + ch; y++) for (let x = mx; x < mx + cw; x++) {
        const dx = Math.max(mx + r - x, x - (mx + cw - 1 - r), 0), dy = Math.max(my + r - y, y - (my + ch - 1 - r), 0);
        if (dx * dx + dy * dy <= r * r) mask[y * W + x] = 1;
      }
    }
    // Bord adouci (flou 3 × 3 deux fois), recadrage sur la silhouette.
    let a = Float32Array.from(mask, (v) => v * 255);
    for (let pass = 0; pass < 2; pass++) {
      const b = new Float32Array(n);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const p = y * W + x; b[p] = (a[p - W - 1] + a[p - W] + a[p - W + 1] + a[p - 1] + a[p] + a[p + 1] + a[p + W - 1] + a[p + W] + a[p + W + 1]) / 9; }
      a = b;
    }
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let p = 0; p < n; p++) if (a[p] > 8) { const x = p % W, y = (p / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    for (let p = 0; p < n; p++) d[p * 4 + 3] = Math.min(d[p * 4 + 3], a[p]);
    levels(d);
    const c = document.createElement("canvas"); c.width = W; c.height = H; c.getContext("2d").putImageData(data, 0, 0);
    const cut = document.createElement("canvas"); cut.width = Math.max(1, x1 - x0 + 1); cut.height = Math.max(1, y1 - y0 + 1);
    cut.getContext("2d").drawImage(c, x0, y0, cut.width, cut.height, 0, 0, cut.width, cut.height);
    cut.shaped = shaped;
    return cut;
  }
  // Niveaux automatiques doux (1 % – 99 %), mélangés à 40 %, sur les seuls pixels de l'étiquette.
  function levels(d) {
    const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { n++; for (let c = 0; c < 3; c++) hist[c][d[i + c] | 0]++; }
    if (!n) return;
    const lut = hist.map((hh) => {
      let lo = 0, hi = 255, acc = 0;
      while (lo < 255 && (acc += hh[lo]) < n * .01) lo++;
      acc = 0; while (hi > 0 && (acc += hh[hi]) < n * .01) hi--;
      const span = Math.max(40, hi - lo);
      return Uint8ClampedArray.from({ length: 256 }, (_, v) => v * .6 + Math.min(255, Math.max(0, (v - lo) * 255 / span)) * .4);
    });
    for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = lut[c][d[i + c]];
  }

  // ---------------------------------------------------------------- composition
  // Étiquette enroulée sur le cylindre (zone du rendu), éclairée par la passe « papier blanc » du rendu.
  function wrap(ctx, label, zone, sleeve, maxArcR, fill) {
    const R = zone.r, zh = zone.bottom - zone.top, a = label.height / label.width;
    let arc = Math.min(maxArcR * R, zh * fill / a), lh = arc * a;
    const top = zone.top + (zh - lh) / 2, layer = document.createElement("canvas"); layer.width = ctx.canvas.width; layer.height = ctx.canvas.height;
    const lx = layer.getContext("2d"), strips = 260;
    for (let i = 0; i < strips; i++) {
      const u0 = i / strips, u1 = (i + 1) / strips, X = (u) => zone.cx + R * Math.sin((u - .5) * arc / R);
      lx.drawImage(label, u0 * label.width, 0, (u1 - u0) * label.width + .5, label.height, X(u0), top, X(u1) - X(u0) + .6, lh);
    }
    const x0 = Math.floor(zone.cx - R), x1 = Math.ceil(zone.cx + R), y0 = Math.floor(top), y1 = Math.ceil(top + lh);
    const L = lx.getImageData(x0, y0, x1 - x0, y1 - y0), ld = L.data, S = sleeve.data, sw = sleeve.width;
    for (let y = 0; y < L.height; y++) for (let x = 0; x < L.width; x++) {
      const i = (y * L.width + x) * 4; if (!ld[i + 3]) continue;
      const j = ((y + y0) * sw + (x + x0)) * 4, k = S[j + 3] ? Math.min(1.12, lum(S, j) / sleeve.ref) : 1;
      ld[i] = Math.min(255, ld[i] * k); ld[i + 1] = Math.min(255, ld[i + 1] * k); ld[i + 2] = Math.min(255, ld[i + 2] * k);
    }
    lx.putImageData(L, x0, y0);
    ctx.drawImage(layer, 0, 0);
  }
  function tint(img, hex) {
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const x = c.getContext("2d"); x.drawImage(img, 0, 0);
    const D = x.getImageData(0, 0, c.width, c.height), d = D.data, n = parseInt(hex.slice(1), 16), col = [n >> 16, n >> 8 & 255, n & 255];
    let sum = 0, cnt = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { sum += lum(d, i); cnt++; }
    const ref = cnt ? sum / cnt : 180;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const l = lum(d, i), k = l / ref, hi = Math.max(0, (l - ref) / (255 - ref)) * .75;
      for (let ch = 0; ch < 3; ch++) d[i + ch] = Math.min(255, col[ch] * k) * (1 - hi) + 255 * hi;
    }
    x.putImageData(D, 0, 0);
    return c;
  }
  async function compose(o) {
    const s = meta.shapes[o.shape], [W, H] = meta.size;
    const [bottleImg, sleeveImg, capImg] = await Promise.all([
      loadImg(`${BASE}${o.shape}-${o.variant}.webp`), loadImg(`${BASE}${o.shape}-sleeve.webp`), o.cap !== "none" ? loadImg(`${BASE}${o.shape}-cap-${o.cap}.webp`) : null
    ]);
    if (!sleeveImg.px) {                   // passe d'éclairage : niveau de référence du papier (90e centile)
      const p = pixels(sleeveImg), v = []; for (let i = 0; i < p.data.length; i += 16) if (p.data[i + 3] > 200) v.push(lum(p.data, i));
      v.sort((a, b) => a - b); p.ref = v[Math.floor(v.length * .9)] || 200; sleeveImg.px = p;
    }
    const c = document.createElement("canvas"); c.width = W; c.height = H; const ctx = c.getContext("2d");
    const sh = ctx.createRadialGradient(W / 2, s.foot, 4, W / 2, s.foot, s.body.r * 1.5);
    sh.addColorStop(0, "rgba(0,0,0,.25)"); sh.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sh; ctx.beginPath(); ctx.ellipse(W / 2, s.foot, s.body.r * 1.5, 18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(bottleImg, 0, 0, W, H);
    if (o.label) wrap(ctx, o.label, s.body, sleeveImg.px, 2.1, .94);
    if (o.neck) wrap(ctx, o.neck, s.neck, sleeveImg.px, 2.6, .96);
    if (capImg) ctx.drawImage(tint(capImg, o.capColor), 0, 0, W, H);
    return c;
  }

  // ---------------------------------------------------------------- photo source
  async function loadSource(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Photo inaccessible.");
    const bmp = await createImageBitmap(await res.blob(), { imageOrientation: "from-image" });
    const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return c;
  }
  function forAi(src) {
    const k = Math.min(1, 1200 / Math.max(src.width, src.height)), c = document.createElement("canvas");
    c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    return { image: c.toDataURL("image/jpeg", .88).split(",")[1], width: c.width, height: c.height };
  }

  // ---------------------------------------------------------------- feuille « Visuel propre »
  async function open(it, sources, onSaved) {
    const photos = sources.filter((x) => !String(x.p).includes("/visual-"));
    if (!photos.length) return toast("Ajoutez d'abord une photo de l'étiquette.");
    try { await loadMeta(); } catch { return toast("Bouteilles vierges indisponibles. Réessayez."); }
    let pick = photos.find((x) => x.p === it.label_path) || photos[0];
    const shape0 = guessShape(it);
    const st = { shape: shape0, variant: null, cap: null, capColor: it.category === "wine" && it.style === "red" ? "#5a1525" : "#c9b48a",
      label: { pts: DEFAULT_GRID.map((p) => [...p]), on: true }, neck: null, useNeck: false, edit: "label", mode: "auto", src: null, ai: {} };
    st.variant = variantFor(st.shape, liquidOf(it) === "red" ? "green" : "flint", liquidOf(it));
    st.cap = capFor(st.shape, "foil");
    const d = VC.sheet(`<div class="vis-sheet"><h2>Visuel propre</h2>
      <p class="muted vis-intro">L'IA repère l'étiquette et les détails de la bouteille. Ajustez si besoin, puis utilisez le visuel comme vignette.</p>
      ${photos.length > 1 ? `<label>Photo source<select id="vis-src">${photos.map((x, i) => `<option value="${i}"${x === pick ? " selected" : ""}>${esc(x.l)} ${i + 1}</option>`).join("")}</select></label>` : ""}
      <div class="vis-grid">
        <div><div class="field-label">Photo · glissez les points</div><div class="chips vis-which" id="vis-which"></div><div class="vis-edit" id="vis-edit"><p class="muted">Chargement…</p></div></div>
        <div><div class="field-label">Résultat</div><div class="vis-out" id="vis-out"><div class="vis-wait"><span class="spin"></span>Analyse de la photo…</div></div><p class="hint" id="vis-note"></p></div>
      </div>
      <div class="fgroup"><div class="chips" id="vis-opts"></div></div>
      <div class="fgroup"><div class="field-label">Forme</div><div class="chips" id="vis-shape"></div></div>
      <div class="fgroup"><div class="field-label">Verre et vin</div><div class="chips" id="vis-variant"></div></div>
      <div class="fgroup vis-colors"><div><div class="field-label">Fermeture</div><div class="chips" id="vis-cap"></div></div>
        <label class="vis-cap">Couleur<input type="color" id="vis-capcolor"></label></div>
      <p class="hint">L'étiquette est votre photo, détourée ; la bouteille est une photo de studio vierge. Vos photos d'origine restent dans la galerie.</p>
      <div class="row end vis-actions"><button type="button" class="btn quiet" data-close>Annuler</button><button type="button" class="btn" id="vis-save" disabled>${I.check}Utiliser comme vignette</button></div></div>`);
    const q = (s) => d.querySelector(s);

    function controls() {
      const s = meta.shapes[st.shape];
      const chip = (attr, v, l, on) => `<button type="button" class="chip" data-${attr}="${v}" aria-pressed="${on}">${esc(l)}</button>`;
      q("#vis-shape").innerHTML = Object.keys(meta.shapes).map((k) => chip("shape", k, SHAPE_LABEL[k] || k, k === st.shape)).join("");
      q("#vis-variant").innerHTML = s.variants.map((v) => chip("variant", v, VARIANT_LABEL[v] || v, v === st.variant)).join("");
      q("#vis-cap").innerHTML = [...s.caps, "none"].map((k) => chip("cap", k, CAP_LABEL[k], k === st.cap)).join("");
      q("#vis-capcolor").value = st.capColor; q("#vis-capcolor").disabled = st.cap === "none";
      q("#vis-opts").innerHTML = `${chip("toggle", "on", "Étiquette courbée (sur la bouteille)", st.label.on)}${chip("toggle", "mode", "Contour rectangulaire", st.mode === "rect")}${st.neck ? chip("toggle", "neck", "Collerette", st.useNeck) : chip("toggle", "addneck", "Ajouter une collerette", false)}`;
      q("#vis-which").innerHTML = st.neck && st.useNeck ? `<span class="hint">Ajuster :</span>${chip("edit", "label", "Étiquette", st.edit !== "neck")}${chip("edit", "neck", "Collerette", st.edit === "neck")}` : "";
    }
    let busy = false, again = false;
    async function render() {
      if (!st.src) return;
      if (busy) { again = true; return; }
      busy = true;
      try {
        const label = cutout(unwrap(st.src, st.label.pts, st.label.on, st.label.outline), st.mode);
        const neck = st.neck && st.useNeck ? cutout(unwrap(st.src, st.neck.pts, st.neck.on, st.neck.outline), st.mode) : null;
        const out = await compose({ shape: st.shape, variant: st.variant, cap: st.cap, capColor: st.capColor, label, neck });
        out.className = "vis-canvas"; q("#vis-out").replaceChildren(out);
        q("#vis-note").textContent = st.mode === "rect" ? "" : label.shaped ? "Contour de l'étiquette détecté." : "Contour peu contrasté : forme rectangulaire utilisée.";
        q("#vis-save").disabled = false;
      } catch (e) { console.error(e); q("#vis-note").textContent = "Composition impossible avec ces points."; }
      busy = false;
      if (again) { again = false; render(); }
    }
    // Points déplaçables au doigt ou au clavier ; contour courbe dessiné en SVG.
    function editor() {
      if (st.edit === "neck" && !(st.neck && st.useNeck)) st.edit = "label";
      const box = q("#vis-edit"), sets = st.edit === "neck" ? [["neck", st.neck]] : [["label", st.label]];
      // Cadrage : la photo est zoomée sur la zone des points (avec une marge), pour que chaque point soit attrapable.
      const all = sets.flatMap(([, g]) => g.pts), xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
      const aspect = st.src.width / st.src.height, pad = .35;
      let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      let w = (x1 - x0) * (1 + 2 * pad), h = (y1 - y0) * (1 + 2 * pad);
      if (w * aspect < h * .75) w = h * .75 / aspect; else h = w * aspect / .75;      // cadre 3:4
      w = Math.min(1, Math.max(w, .3)); h = Math.min(1, Math.max(h, .3));
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, vx = Math.min(1 - w, Math.max(0, cx - w / 2)), vy = Math.min(1 - h, Math.max(0, cy - h / 2));
      const V = (p) => [(p[0] - vx) / w, (p[1] - vy) / h];
      box.innerHTML = `<div class="vis-stage" style="aspect-ratio:${(w * st.src.width / (h * st.src.height)).toFixed(4)}"><img alt="Photo source" src="${esc(pick.u)}" style="width:${100 / w}%;left:${-vx / w * 100}%;top:${-vy / h * 100}%"><svg viewBox="${vx} ${vy} ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${sets.map(([k]) => `<path data-path="${k}"/>`).join("")}</svg>
        ${sets.map(([k]) => [0, 1, 2, 3, 4, 5].map((i) => `<button type="button" class="vis-h${k === "neck" ? " neck" : ""}${i === 1 || i === 4 ? " mid" : ""}" data-set="${k}" data-h="${i}" aria-label="${k === "neck" ? "Collerette" : "Étiquette"}, point ${NAMES[i]}"></button>`).join("")).join("")}</div>`;
      const stage = box.querySelector(".vis-stage");
      const place = () => sets.forEach(([k, g]) => {
        box.querySelectorAll(`.vis-h[data-set="${k}"]`).forEach((hd, i) => { const [px, py] = V(g.pts[i]); hd.style.left = `${px * 100}%`; hd.style.top = `${py * 100}%`; });
        const [a, m, b, c, n, e] = g.pts, ctl = (p, mid, r) => [2 * mid[0] - (p[0] + r[0]) / 2, 2 * mid[1] - (p[1] + r[1]) / 2];
        box.querySelector(`[data-path="${k}"]`).setAttribute("d", `M${a} Q${ctl(a, m, b)} ${b} L${c} Q${ctl(c, n, e)} ${e} Z`);
      });
      place();
      box.querySelectorAll(".vis-h").forEach((hd) => {
        const g = hd.dataset.set === "neck" ? st.neck : st.label, i = +hd.dataset.h;
        // Le contour tracé par l'IA reste valable pour une retouche fine ; une vraie correction (> 1,5 %) l'annule.
        let start = null; const moved = () => { if (start && Math.hypot(g.pts[i][0] - start[0], g.pts[i][1] - start[1]) > .015) g.outline = null; };
        hd.addEventListener("pointerdown", (e) => {
          e.preventDefault(); hd.setPointerCapture(e.pointerId); start = [...g.pts[i]];
          const move = (ev) => { const r = stage.getBoundingClientRect(); g.pts[i] = [Math.min(1, Math.max(0, vx + (ev.clientX - r.left) / r.width * w)), Math.min(1, Math.max(0, vy + (ev.clientY - r.top) / r.height * h))]; place(); };
          const up = () => { hd.removeEventListener("pointermove", move); moved(); render(); };
          hd.addEventListener("pointermove", move); hd.addEventListener("pointerup", up, { once: true }); hd.addEventListener("pointercancel", up, { once: true });
        });
        hd.addEventListener("keydown", (e) => {
          const dx = { ArrowLeft: -1, ArrowRight: 1 }[e.key] || 0, dy = { ArrowUp: -1, ArrowDown: 1 }[e.key] || 0;
          if (!dx && !dy) return;
          e.preventDefault(); start = start || [...g.pts[i]]; const k = (e.shiftKey ? .02 : .004) * Math.max(w, h);
          g.pts[i] = [Math.min(1, Math.max(0, g.pts[i][0] + dx * k)), Math.min(1, Math.max(0, g.pts[i][1] + dy * k))]; moved(); place(); render();
        });
      });
    }

    async function analyse() {
      q("#vis-save").disabled = true;
      q("#vis-out").innerHTML = `<div class="vis-wait"><span class="spin"></span>Analyse de la photo…</div>`;
      try { st.src = await loadSource(pick.u); } catch (e) { q("#vis-out").innerHTML = `<p class="notice">${esc(e.message)}</p>`; return; }
      const { data, error } = await sb.functions.invoke("visual", { body: { ...forAi(st.src), wine: { category: it.category, style: it.style, name: it.name, producer: it.producer, appellation: it.appellation, region: it.region, country: it.country } } });
      if (error || !data) {
        let msg = "Analyse indisponible : placez les points à la main.";
        try { const j = await error.context.json(); if (j && j.message) msg = j.message; } catch { /* réseau */ }
        toast(msg);
      } else {
        st.ai = data;
        if (data.label) st.label = { pts: data.label.pts, on: data.label.on_bottle, outline: data.label.outline };
        else toast("Étiquette non repérée : placez les six points.");
        if (data.neck_label) { st.neck = { pts: data.neck_label.pts, on: true, outline: data.neck_label.outline }; st.useNeck = true; }
        if (data.shape && meta.shapes[data.shape]) st.shape = data.shape;
        st.variant = variantFor(st.shape, data.glass || (liquidOf(it) === "red" ? "green" : "flint"), data.liquid || liquidOf(it));
        st.cap = capFor(st.shape, data.closure?.type || "foil");
        if (data.closure?.color) st.capColor = data.closure.color;
      }
      editor(); controls(); render();
    }

    d.addEventListener("click", (e) => {
      const b = e.target.closest("[data-shape],[data-variant],[data-cap],[data-toggle],[data-edit]"); if (!b) return;
      if (b.dataset.edit) { st.edit = b.dataset.edit; editor(); return controls(); }
      if (b.dataset.toggle === "addneck") {                 // collerette posée à la main, juste sous la capsule supposée
        const [l] = st.label.pts, r = st.label.pts[2], cx = (l[0] + r[0]) / 2, hw = Math.max(.03, (r[0] - l[0]) * .22), y = Math.max(.04, l[1] - (st.label.pts[5][1] - l[1]) * .9);
        st.neck = { pts: [[cx - hw, y], [cx, y - .004], [cx + hw, y], [cx + hw, y + .03], [cx, y + .034], [cx - hw, y + .03]], on: true, outline: null };
        st.useNeck = true; st.edit = "neck"; editor(); controls(); return render();
      }
      if (b.dataset.shape) { st.shape = b.dataset.shape; st.variant = variantFor(st.shape, st.ai.glass || st.variant.split("-")[0], st.ai.liquid || st.variant.split("-")[1]); st.cap = capFor(st.shape, st.ai.closure?.type || st.cap); }
      if (b.dataset.variant) st.variant = b.dataset.variant;
      if (b.dataset.cap) st.cap = b.dataset.cap;
      if (b.dataset.toggle === "on") st.label.on = !st.label.on;
      if (b.dataset.toggle === "mode") st.mode = st.mode === "rect" ? "auto" : "rect";
      if (b.dataset.toggle === "neck") { st.useNeck = !st.useNeck; st.edit = st.useNeck ? st.edit : "label"; editor(); }
      controls(); render();
    });
    q("#vis-capcolor").addEventListener("input", (e) => { st.capColor = e.target.value; render(); });
    q("#vis-src")?.addEventListener("change", (e) => { pick = photos[+e.target.value]; st.neck = null; st.useNeck = false; analyse(); });
    q("#vis-save").addEventListener("click", async () => {
      const btn = q("#vis-save"); btn.disabled = true; btn.textContent = "Enregistrement…";
      const canvas = q("#vis-out canvas");
      // 750 × 1350 : net sur la fiche en écran Retina, deux fois plus léger que le rendu de travail.
      const small = document.createElement("canvas"); small.width = 750; small.height = 1350;
      const sx = small.getContext("2d"); sx.imageSmoothingQuality = "high"; sx.drawImage(canvas, 0, 0, 750, 1350);
      const blob = await new Promise((r) => small.toBlob(r, "image/png"));
      const { data: { user } } = await sb.auth.getUser();
      const path = `${user.id}/visual-${crypto.randomUUID()}.png`;
      const up = await sb.storage.from("labels").upload(path, blob, { contentType: "image/png" });
      if (up.error) { btn.disabled = false; btn.textContent = "Utiliser comme vignette"; return fail(up.error); }
      // Un seul visuel dans la galerie : le précédent en sort (le fichier reste dans le stockage privé).
      const list = [...(it.photo_paths || []).filter((p) => !p.includes("/visual-")), path];
      const { error } = await sb.from("items").update({ photo_paths: list, cover_path: path }).eq("id", it.id);
      if (error) { btn.disabled = false; return fail(error); }
      d.close(); toast("Visuel enregistré et utilisé comme vignette."); onSaved && onSaved();
    });
    controls(); analyse();
  }

  VC.Visual = { open, unwrap, cutout, compose, loadMeta, isVisual: (p) => String(p || "").includes("/visual-") };
})();
