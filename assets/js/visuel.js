// Aperçu d'une bouteille : la vraie bouteille, détourée par IA (Bria RMBG 2.0 via fal.ai, fonction « cutout »),
// enregistrée en PNG transparent 900 × 1200. Le fond est posé par l'affichage (réglage « Fond des aperçus »).
// Source : la photo de la bouteille entière (fichier « full-… »), prise à l'ajout ou depuis la fiche.
(function () {
  const VC = window.VC;
  const { sb, esc, I, toast, fail } = VC;
  const W = 900, H = 1200;

  // ---------------------------------------------------------------- photo source
  async function loadSource(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Photo inaccessible.");
    const bmp = await createImageBitmap(await res.blob(), { imageOrientation: "from-image" });
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return c;
  }

  // ---------------------------------------------------------------- détourage (fal.ai)
  async function falCutout(src) {
    const { data, error } = await sb.functions.invoke("cutout", { body: { image: src.toDataURL("image/jpeg", .92).split(",")[1] } });
    if (error || !data?.png) {
      let msg = "Détourage indisponible. Réessayez dans un instant.";
      try { const j = await error.context.json(); if (j?.message) msg = j.message; } catch { /* réseau */ }
      throw new Error(msg);
    }
    const img = new Image(); img.src = "data:image/png;base64," + data.png; await img.decode();
    return img;
  }

  // Nettoyage du masque : on ne garde que la plus grande forme (la bouteille ; pas un verre ou un objet voisin),
  // puis on retire en haut les parties bien plus étroites qu'elle (fil de lampe, câble qui touche la capsule).
  // Retourne la bouteille recadrée et l'indication qu'elle touche le bord de la photo (bouteille coupée).
  function clean(png) {
    const w = png.width, h = png.height, c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d"); x.drawImage(png, 0, 0);
    const D = x.getImageData(0, 0, w, h), a = D.data, n = w * h;
    const on = new Uint8Array(n); for (let p = 0; p < n; p++) on[p] = a[p * 4 + 3] > 40 ? 1 : 0;
    const lab = new Int32Array(n).fill(-1), stack = []; let best = -1, bestN = 0, id = 0;
    for (let p = 0; p < n; p++) {
      if (!on[p] || lab[p] >= 0) continue;
      let cnt = 0; stack.push(p); lab[p] = id;
      while (stack.length) { const q = stack.pop(), qx = q % w; cnt++; for (const r of [qx > 0 ? q - 1 : -1, qx < w - 1 ? q + 1 : -1, q - w, q + w]) if (r >= 0 && r < n && on[r] && lab[r] < 0) { lab[r] = id; stack.push(r); } }
      if (cnt > bestN) { bestN = cnt; best = id; } id++;
    }
    if (best < 0) throw new Error("Aucune bouteille détectée sur cette photo.");
    // Hors de la bouteille : tout est effacé, y compris les traces presque transparentes d'objets voisins.
    for (let p = 0; p < n; p++) if (lab[p] !== best) a[p * 4 + 3] = 0;
    const rowW = new Int32Array(h); let maxW = 0;
    for (let y = 0; y < h; y++) { let k = 0; for (let xx = 0; xx < w; xx++) if (a[(y * w + xx) * 4 + 3] > 128) k++; rowW[y] = k; if (k > maxW) maxW = k; }
    let top = 0; while (top < h && rowW[top] < maxW * .12) top++;
    for (let i = 0; i < top * w * 4; i += 4) a[i + 3] = 0;
    x.putImageData(D, 0, 0);
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) if (a[(y * w + xx) * 4 + 3] > 24) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 <= x0 || y1 <= y0) throw new Error("Aucune bouteille détectée sur cette photo.");
    const cut = x0 <= 1 || y0 <= 1 || x1 >= w - 2 || y1 >= h - 2;
    const out = document.createElement("canvas"); out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext("2d").drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return { img: out, cut };
  }

  // Cadrage commun à toutes les bouteilles : centrée, pied à 5 % du bas, au plus 88 % de la hauteur et 72 % de la largeur.
  function frame(img) {
    const c = document.createElement("canvas"); c.width = W; c.height = H; const ctx = c.getContext("2d");
    const k = Math.min(H * .88 / img.height, W * .72 / img.width), bw = img.width * k, bh = img.height * k;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (W - bw) / 2, H * .95 - bh, bw, bh);
    return c;
  }

  async function build(url) {
    const { img, cut } = clean(await falCutout(await loadSource(url)));
    return { canvas: frame(img), cut };
  }

  // ---------------------------------------------------------------- enregistrement
  // Le visuel rejoint la galerie et devient la vignette ; un visuel précédent sort de la galerie (son fichier reste
  // dans le stockage privé). Les chemins sont relus pour ne pas écraser un ajout récent.
  async function uploadVisual(canvas) {
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    const { data: { user } } = await sb.auth.getUser();
    const path = `${user.id}/visual-${crypto.randomUUID()}.png`;
    const up = await sb.storage.from("labels").upload(path, blob, { contentType: "image/png" });
    if (up.error) throw up.error;
    return path;
  }
  // Aperçu préparé avant que la fiche existe (ajout d'un vin) : photo de la bouteille entière → chemin du visuel.
  async function prepare(photoPath) {
    const url = (await VC.signed([photoPath]))(photoPath);
    if (!url) throw new Error("Photo inaccessible.");
    const { canvas, cut } = await build(url);
    if (cut) throw new Error("La bouteille semble coupée sur la photo.");
    return uploadVisual(canvas);
  }
  async function saveVisual(itemId, canvas) {
    const path = await uploadVisual(canvas);
    const { data: cur } = await sb.from("items").select("photo_paths").eq("id", itemId).single();
    const list = [...((cur && cur.photo_paths) || []).filter((p) => !p.includes("/visual-")), path];
    const { error } = await sb.from("items").update({ photo_paths: list, cover_path: path }).eq("id", itemId);
    if (error) throw error;
    return path;
  }

  // Sans interface, juste après l'ajout d'un vin : photo de la bouteille entière → aperçu enregistré.
  async function auto(it, path) {
    const url = (await VC.signed([path]))(path);
    if (!url) throw new Error("Photo inaccessible.");
    const { canvas, cut } = await build(url);
    if (cut) throw new Error("La bouteille semble coupée sur la photo : aperçu non créé.");
    return saveVisual(it.id, canvas);
  }

  // ---------------------------------------------------------------- feuille « Aperçu de la bouteille »
  // sources : [{ p, u, l }] photos de la fiche ; prefer : chemin à utiliser d'abord.
  async function open(it, sources, onSaved, prefer) {
    const photos = sources.filter((x) => !isVisual(x.p));
    if (!photos.length) return toast("Ajoutez d'abord une photo de la bouteille entière.");
    let pick = photos.find((x) => x.p === prefer) || photos.find((x) => isFull(x.p)) || photos[0];
    const cache = new Map();
    const d = VC.sheet(`<div class="vis-sheet"><h2>Aperçu de la bouteille</h2>
      <p class="muted vis-intro">Votre bouteille, détourée par IA et posée sur un fond neutre.</p>
      ${photos.length > 1 ? `<label>Photo<select id="vis-src">${photos.map((x, i) => `<option value="${i}"${x === pick ? " selected" : ""}>${esc(isFull(x.p) ? "Bouteille entière" : x.l || "Photo")} ${i + 1}</option>`).join("")}</select></label>` : ""}
      <div class="vis-grid">
        <div><div class="field-label">Photo</div><div class="vis-edit" id="vis-edit"></div></div>
        <div><div class="field-label">Aperçu</div><div class="vis-out" id="vis-out"></div><p class="hint" id="vis-note"></p></div>
      </div>
      <p class="hint">Pour un bon résultat : la bouteille entière, de la capsule au pied, de face. Détourage par fal.ai, environ 0,02 $ par photo. Vos photos d'origine restent dans la galerie.</p>
      <div class="row end vis-actions"><button type="button" class="btn quiet" data-close>Annuler</button><button type="button" class="btn" id="vis-save" disabled>${I.check}Utiliser comme vignette</button></div></div>`);
    const q = (s) => d.querySelector(s);
    async function run() {
      q("#vis-save").disabled = true; q("#vis-note").textContent = "";
      q("#vis-edit").innerHTML = `<img class="vis-src" alt="Photo source" src="${esc(pick.u)}">`;
      q("#vis-out").innerHTML = `<div class="vis-wait"><span class="spin"></span>Détourage de la bouteille…</div>`;
      try {
        if (!cache.has(pick.p)) cache.set(pick.p, await build(pick.u));
        const { canvas, cut } = cache.get(pick.p);
        canvas.className = "vis-canvas"; q("#vis-out").replaceChildren(canvas);
        q("#vis-note").textContent = cut ? "La bouteille semble coupée par le bord de la photo : reprenez-la entière pour un meilleur aperçu." : "";
        q("#vis-save").disabled = false;
      } catch (e) {
        q("#vis-out").innerHTML = `<p class="notice" style="margin:12px">${esc(e.message || "Détourage impossible.")}</p>`;
      }
    }
    q("#vis-src")?.addEventListener("change", (e) => { pick = photos[+e.target.value]; run(); });
    q("#vis-save").addEventListener("click", async () => {
      const btn = q("#vis-save"); btn.disabled = true; btn.textContent = "Enregistrement…";
      try { await saveVisual(it.id, cache.get(pick.p).canvas); }
      catch (err) { btn.disabled = false; btn.textContent = "Utiliser comme vignette"; return fail(err); }
      d.close(); toast("Aperçu enregistré et utilisé comme vignette."); onSaved && onSaved();
    });
    run();
  }

  const isVisual = (p) => String(p || "").includes("/visual-");
  const isFull = (p) => String(p || "").includes("/full-");
  VC.Visual = { open, auto, prepare, isVisual, isFull };
})();
