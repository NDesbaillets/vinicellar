(async function () {
  const AR = window.AR, { sb, cfg, $, $$, esc, errMsg, setMsg, toast, fmtDate } = AR;
  const ctx = await AR.boot("ajouter");
  if (!ctx) return;
  const main = $("#main");
  const editable = ctx.books.filter((b) => b.role === "owner" || b.role === "member");
  const MAX_PAGES = 4, PDF_MAX = 8 * 1024 * 1024;

  main.setAttribute("aria-busy", "false");
  if (!editable.length) {
    main.innerHTML = `<h1 class="chapitre">Ajouter</h1><span class="filet" aria-hidden="true"></span>
      <div class="vide-etat"><p role="alert">Vous n'avez aucun carnet où ajouter une recette (il faut y être propriétaire ou membre).</p><a class="btn sec petit" href="/recettes/">Retour au carnet</a></div>`;
    return;
  }

  // ---- paramètres de partage : ?url=…&text=… (raccourci iOS, share_target Android)
  const qs = new URLSearchParams(location.search);
  const qText = qs.get("text") || "", qTitle = qs.get("title") || "";
  const forceNote = qs.get("onglet") === "note";
  const shared = AR.safeUrl(qs.get("url") || "") || AR.extractUrl(qText) || AR.extractUrl(qTitle);
  // Texte sans aucune adresse (partage d'une note) : onglet Note ; avec adresse : onglet Lien comme avant.
  const noteText = [qTitle.trim(), qText.trim()].filter((x, i, a) => x && !(i === 1 && a[0] && x.startsWith(a[0]))).join("\n\n");
  const toNote = forceNote || (!shared && !!noteText);
  const MAX_NOTE = 20000, MAX_PHOTOS = 6;
  const pref = AR.getBookPref();
  const bookId0 = (editable.find((b) => b.id === pref) || editable[0]).id;

  main.innerHTML = `<h1 class="chapitre">Ajouter</h1><span class="filet" aria-hidden="true"></span>
    <label>Carnet de destination<select id="book">${editable.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("")}</select></label>
    <div class="importer-comme" style="margin-top:22px"><span class="etiquette" id="imp-lib">Importer comme</span>
      <div class="onglets" role="group" aria-labelledby="imp-lib" style="margin-top:6px">
        <button type="button" class="onglet" data-target="auto" aria-pressed="true">Automatique</button>
        <button type="button" class="onglet" data-target="recette" aria-pressed="false">Recette</button>
        <button type="button" class="onglet" data-target="astuce" aria-pressed="false">Astuce</button></div>
      <p class="aide" id="imp-aide">La source est lue puis rangée comme recette ou comme astuce, selon ce qu'elle contient.</p></div>
    <div class="onglets" role="tablist" aria-label="Source de la recette ou de l'astuce" style="margin-top:22px">
      <button type="button" class="onglet" role="tab" id="t-lien" aria-controls="p-lien" aria-selected="true">Lien</button>
      <button type="button" class="onglet" role="tab" id="t-note" aria-controls="p-note" aria-selected="false" tabindex="-1">Note</button>
      <button type="button" class="onglet" role="tab" id="t-photo" aria-controls="p-photo" aria-selected="false" tabindex="-1">Photo ou PDF</button>
      <button type="button" class="onglet" role="tab" id="t-manuel" aria-controls="p-manuel" aria-selected="false" tabindex="-1">Saisie manuelle</button>
    </div>
    <section id="p-lien" role="tabpanel" aria-labelledby="t-lien" class="panneau">
      <form id="f-lien" class="champs" novalidate>
        <label>Lien d'un reel Instagram ou d'un site de recettes<input type="url" name="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://" maxlength="2000"></label>
        <p class="aide" id="lien-type" aria-live="polite">Collez l'adresse : le type de source est reconnu automatiquement.</p>
        <div><button class="btn" type="submit" id="go-lien">Importer la recette</button></div>
        <p class="msg" id="msg-lien" role="status" aria-live="polite"></p>
      </form>
    </section>
    <section id="p-note" role="tabpanel" aria-labelledby="t-note" class="panneau" hidden>
      <form id="f-note" class="champs" novalidate>
        <label>Texte de la note<textarea name="texte" id="note-texte" rows="10" title="Collez le texte de votre note : titre, ingrédients, étapes" placeholder="Collez le texte de votre note : titre, ingrédients, étapes" autocomplete="off" spellcheck="false"></textarea></label>
        <p class="aide compteur" id="note-compteur" aria-live="polite"></p>
        <div>
          <span class="etiquette" id="note-photo-lib">Photos (0 à ${MAX_PHOTOS})</span>
          <input type="file" id="note-input" accept="image/*" multiple aria-labelledby="note-photo-lib" style="margin-top:6px">
          <p class="aide">Depuis votre photothèque. La première devient la couverture ; les flèches changent l'ordre. Photos réduites à 1600 px.</p>
        </div>
        <div class="coller">
          <div id="coller-zone" class="coller-zone" contenteditable="true" inputmode="none" tabindex="0" role="textbox" aria-label="Coller une photo : touchez puis collez" spellcheck="false" autocapitalize="off">
            <span class="libelle">Coller une photo</span>
            <span class="aide">Touchez ici puis « Coller ». Sur iPhone : appui long sur la photo dans la note, Copier.</span>
          </div>
          <button type="button" class="btn sec" id="coller-btn">Coller depuis le presse-papiers</button>
          <p class="msg" id="msg-coller" role="status" aria-live="polite"></p>
        </div>
        <ul class="vignettes" id="note-vignettes" aria-label="Photos de la note"></ul>
        <div><button class="btn" type="submit" id="go-note">Créer la fiche</button></div>
        <p class="msg" id="msg-note" role="status" aria-live="polite"></p>
      </form>
    </section>
    <section id="p-photo" role="tabpanel" aria-labelledby="t-photo" class="panneau" hidden>
      <form id="f-photo" class="champs" novalidate>
        <div>
          <span class="etiquette" id="photo-lib">Photos ou PDF de la recette (1 à ${MAX_PAGES} fichiers)</span>
          <input type="file" id="pages-input" accept="image/*,application/pdf,.pdf" multiple aria-labelledby="photo-lib" style="margin-top:6px">
          <p class="aide">Page imprimée ou manuscrite, ou PDF de 8 Mo au plus. Les photos sont réduites à 2000 px ; tout est lu dans l'ordre. L'écriture à la main sera à relire avant d'entrer au carnet.</p>
        </div>
        <ul class="vignettes" id="vignettes" aria-label="Photos choisies"></ul>
        <div><button class="btn" type="submit" id="go-photo">Lire la page</button></div>
        <p class="msg" id="msg-photo" role="status" aria-live="polite"></p>
      </form>
    </section>
    <section id="p-manuel" role="tabpanel" aria-labelledby="t-manuel" class="panneau" hidden>
      <p>Écrivez vous-même une recette (titre, ingrédients, étapes, photo) ou une astuce (un conseil, une technique).</p>
      <div class="rangee"><a class="btn" id="go-manuel" href="/recettes/editer.html">Nouvelle recette</a><a class="btn sec" id="go-astuce" href="/recettes/editer-astuce.html">Nouvelle astuce</a></div>
    </section>
    <h2 class="section">En cours</h2><span class="filet" aria-hidden="true"></span>
    <div id="imports" aria-live="polite"><p class="chargement">Chargement…</p></div>`;

  const bookSel = $("#book");
  bookSel.value = bookId0;
  bookSel.addEventListener("change", () => AR.setBookPref(bookSel.value));
  const bookName = (id) => (ctx.books.find((b) => b.id === id) || {}).name || "";

  // ---- onglets
  const tabs = $$("[role=tab]", main);
  function selectTab(t, focus) {
    tabs.forEach((x) => { const on = x === t; x.setAttribute("aria-selected", String(on)); x.tabIndex = on ? 0 : -1; $("#" + x.getAttribute("aria-controls")).hidden = !on; });
    if (focus) t.focus();
  }
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => selectTab(t));
    t.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (d) { e.preventDefault(); selectTab(tabs[(i + d + tabs.length) % tabs.length], true); }
    });
  });

  if (toNote) selectTab($("#t-note"));

  // ---- « Importer comme » : envoyé dans la colonne target de recipe_imports (jamais status)
  let target = "auto";
  const AIDE = { auto: "La source est lue puis rangée comme recette ou comme astuce, selon ce qu'elle contient.", recette: "La source est lue comme une recette complète.", astuce: "La source est lue comme un conseil ou une technique, sans ingrédients ni étapes." };
  $$("[data-target]", main).forEach((b) => b.addEventListener("click", () => {
    target = b.dataset.target;
    $$("[data-target]", main).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    $("#imp-aide").textContent = AIDE[target];
  }));

  // ---- appel de la fonction d'import (le front crée la ligne, la fonction travaille en arrière-plan)
  async function callImport(importId) {
    const { data } = await sb.auth.getSession();
    const token = data.session && data.session.access_token;
    if (!token) throw new Error("Votre session a expiré. Reconnectez-vous.");
    let res;
    try {
      res = await fetch(`${cfg.supabaseUrl}/functions/v1/recipe-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: cfg.supabaseAnonKey },
        body: JSON.stringify({ import_id: importId })
      });
    } catch (e) { throw new Error("Connexion impossible. Vérifiez votre réseau et réessayez."); }
    if (!res.ok) {
      let m = "";
      try { const j = await res.json(); m = j && (j.message || j.error) || ""; } catch { /* corps non JSON */ }
      const fallback = res.status === 429 ? "Limite quotidienne atteinte : 50 imports par 24 heures."
        : res.status === 401 ? "Votre session a expiré. Reconnectez-vous."
        : res.status === 403 ? "Cette action n'est pas permise avec votre rôle dans ce carnet."
        : "L'import n'a pas pu démarrer. Réessayez dans un instant.";
      const e = new Error(m || fallback); e.status = res.status; throw e;
    }
  }

  // ---- lien
  const fl = $("#f-lien"), hint = $("#lien-type");
  function detect(v) {
    const u = AR.safeUrl(v.trim());
    if (!u) return null;
    return /(^|\.)(instagram\.com|instagr\.am)$/i.test(new URL(u).hostname) ? { kind: "instagram", url: u } : { kind: "web", url: u };
  }
  fl.url.addEventListener("input", () => {
    const d = detect(fl.url.value);
    hint.textContent = !fl.url.value.trim() ? "Collez l'adresse : le type de source est reconnu automatiquement."
      : !d ? "Cette adresse ne semble pas valide (elle doit commencer par http:// ou https://)."
      : d.kind === "instagram" ? "Reel Instagram reconnu : légende, parole et texte à l'écran seront lus."
      : `Site web reconnu (${AR.host(d.url)}).`;
  });
  if (shared && !forceNote) { fl.url.value = shared; fl.url.dispatchEvent(new Event("input")); }
  fl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = $("#msg-lien"), d = detect(fl.url.value);
    if (!d) return setMsg(out, "Indiquez une adresse valide, commençant par http:// ou https://.", "erreur");
    const btn = $("#go-lien"); btn.disabled = true; setMsg(out, "Envoi…");
    try {
      const id = AR.uuid();
      const ins = await sb.from("recipe_imports").insert({ id, book_id: bookSel.value, kind: d.kind, target, source_url: d.url, created_by: ctx.user.id }).select("*").single();
      if (ins.error) throw ins.error;
      upsert(ins.data);
      try { await callImport(id); }
      catch (e2) { setMsg(out, e2.message + " L'import reste dans la liste : vous pourrez le relancer.", "erreur"); btn.disabled = false; poll(); return; }
      fl.url.value = ""; hint.textContent = "Collez l'adresse : le type de source est reconnu automatiquement.";
      setMsg(out, "Import lancé. Vous pouvez quitter cette page : la fiche arrivera dans votre carnet.", "ok");
      poll();
    } catch (err) { setMsg(out, errMsg(err, "Impossible de lancer l'import."), "erreur"); }
    btn.disabled = false;
  });

  // ---- note (texte collé, photos)
  const fn = $("#f-note"), nt = fn.texte, nthumbs = $("#note-vignettes"), nphotos = [];
  const fmtN = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f");
  function drawCount() {
    const n = nt.value.length, over = n > MAX_NOTE, c = $("#note-compteur");
    c.textContent = `${fmtN(n)} / ${fmtN(MAX_NOTE)} caractères` + (over ? ` : ${fmtN(n - MAX_NOTE)} de trop, raccourcissez le texte.` : "");
    c.classList.toggle("erreur", over);
  }
  nt.addEventListener("input", drawCount);
  if (noteText) nt.value = noteText.slice(0, 200000);
  drawCount();
  function drawNoteThumbs() {
    nthumbs.innerHTML = nphotos.map((x, i) => `<li class="vignette"><img src="${esc(x.url)}" alt="Photo ${i + 1}"><span class="libelle">Photo ${i + 1}${i === 0 ? " · couverture" : ""}</span>
      <button type="button" class="btn danger cible" data-rm-np="${i}" aria-label="Retirer la photo ${i + 1}">×</button>
      <span class="ordre"><button type="button" class="btn sec ordre-btn" data-mv-np="${i}" data-d="-1" aria-label="Avancer la photo ${i + 1}"${i === 0 ? " disabled" : ""}>‹</button><button type="button" class="btn sec ordre-btn" data-mv-np="${i}" data-d="1" aria-label="Reculer la photo ${i + 1}"${i === nphotos.length - 1 ? " disabled" : ""}>›</button></span></li>`).join("");
  }
  function addNotePhoto(blob, done) {
    if (nphotos.length >= MAX_PHOTOS) return false;
    nphotos.push({ file: blob, done: !!done, url: URL.createObjectURL(blob) });
    return true;
  }
  $("#note-input").addEventListener("change", (e) => {
    const out = $("#msg-note"); setMsg(out, "");
    Array.from(e.target.files || []).forEach((f) => {
      if (!/^image\//.test(f.type)) return setMsg(out, "Seules les images sont acceptées.", "erreur");
      if (!addNotePhoto(f)) setMsg(out, `${MAX_PHOTOS} photos au plus : les suivantes ont été ignorées.`, "erreur");
    });
    e.target.value = ""; drawNoteThumbs();
  });
  // ---- collage de photos (zone dédiée, bouton presse-papiers, collage dans le texte)
  const cmsg = $("#msg-coller");
  function addPasted(blobs) {
    let n = 0, full = false;
    blobs.forEach((b) => { if (addNotePhoto(b)) n++; else full = true; });
    drawNoteThumbs();
    setMsg(cmsg, n ? `${n} photo${n > 1 ? "s" : ""} ajoutée${n > 1 ? "s" : ""}.` + (full ? ` ${MAX_PHOTOS} photos au plus : les suivantes ont été ignorées.` : "")
      : full ? `${MAX_PHOTOS} photos au plus : retirez-en une avant d'en coller une autre.` : "Aucune photo dans ce qui a été collé.", n ? "ok" : "erreur");
    return n;
  }
  const dataUrlBlob = (u) => { const m = /^data:(image\/[\w.+-]+)(;base64)?,(.*)$/is.exec(u); if (!m) return null;
    try { const bin = m[2] ? atob(decodeURIComponent(m[3])) : decodeURIComponent(m[3]); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: m[1] }); } catch { return null; } };
  // Images d'un collage : fichiers image, sinon <img src="data:…"> du HTML collé.
  function pastedImages(dt) {
    const out = [];
    Array.from(dt.files || []).forEach((f) => { if (/^image\//.test(f.type)) out.push(f); });
    if (!out.length) Array.from(dt.items || []).forEach((it) => { if (it.kind === "file" && /^image\//.test(it.type)) { const f = it.getAsFile(); if (f) out.push(f); } });
    if (!out.length) {
      const html = dt.getData ? dt.getData("text/html") : "";
      if (html) new DOMParser().parseFromString(html, "text/html").querySelectorAll("img").forEach((im) => { const b = dataUrlBlob(im.getAttribute("src") || ""); if (b) out.push(b); });
    }
    return out;
  }
  const zone = $("#coller-zone");
  zone.addEventListener("paste", (e) => { e.preventDefault(); if (e.clipboardData) addPasted(pastedImages(e.clipboardData)); });
  zone.addEventListener("beforeinput", (e) => e.preventDefault());
  zone.addEventListener("drop", (e) => e.preventDefault());
  nt.addEventListener("paste", (e) => {
    if (!e.clipboardData) return;
    const imgs = pastedImages(e.clipboardData);
    if (!imgs.length) return;
    if (!e.clipboardData.getData("text/plain")) e.preventDefault(); // image seule : rien à mettre dans le texte
    addPasted(imgs);
  });
  $("#coller-btn").addEventListener("click", async () => {
    if (!navigator.clipboard || !navigator.clipboard.read) return setMsg(cmsg, "Ce navigateur ne permet pas le collage direct : touchez la zone « Coller une photo » puis choisissez Coller.", "erreur");
    try {
      const items = await navigator.clipboard.read(), blobs = [];
      for (const it of items) { const t = it.types.find((x) => /^image\//.test(x)); if (t) blobs.push(await it.getType(t)); }
      if (!blobs.length) return setMsg(cmsg, "Le presse-papiers ne contient pas de photo. Copiez d'abord une photo (appui long, Copier).", "erreur");
      addPasted(blobs);
    } catch (err) {
      setMsg(cmsg, err && err.name === "NotAllowedError" ? "Accès au presse-papiers refusé : touchez plutôt la zone « Coller une photo »." : "Impossible de lire le presse-papiers : touchez la zone « Coller une photo ».", "erreur");
    }
  });
  nthumbs.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm-np]"), mv = e.target.closest("[data-mv-np]");
    if (rm) { const [x] = nphotos.splice(Number(rm.dataset.rmNp), 1); if (x && x.url) URL.revokeObjectURL(x.url); drawNoteThumbs(); }
    if (mv) {
      const i = Number(mv.dataset.mvNp), j = i + Number(mv.dataset.d);
      if (j >= 0 && j < nphotos.length) { [nphotos[i], nphotos[j]] = [nphotos[j], nphotos[i]]; drawNoteThumbs(); const b = $(`[data-mv-np="${j}"][data-d="${mv.dataset.d}"]`, nthumbs) || $(`[data-mv-np="${j}"]`, nthumbs); if (b && !b.disabled) b.focus(); }
    }
  });

  fn.addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = $("#msg-note"), text = nt.value.trim();
    if (!text) return setMsg(out, "Collez le texte de votre note : titre, ingrédients, étapes.", "erreur");
    if (nt.value.length > MAX_NOTE) return setMsg(out, `Le texte dépasse ${fmtN(MAX_NOTE)} caractères (${fmtN(nt.value.length - MAX_NOTE)} de trop) : raccourcissez-le.`, "erreur");
    if (nphotos.length > MAX_PHOTOS) return setMsg(out, `${MAX_PHOTOS} photos au plus.`, "erreur");
    const btn = $("#go-note"); btn.disabled = true;
    const id = AR.uuid(), book = bookSel.value, paths = [];
    const clear = () => { nphotos.splice(0).forEach((x) => URL.revokeObjectURL(x.url)); drawNoteThumbs(); };
    try {
      // Les photos partent avant la ligne d'import : la fonction les trouve toutes à son démarrage.
      for (let i = 0; i < nphotos.length; i++) {
        setMsg(out, `Préparation de la photo ${i + 1} sur ${nphotos.length}…`);
        const blob = nphotos[i].done ? nphotos[i].file : await AR.compressImage(nphotos[i].file, 1600, 0.85);
        const path = `${book}/imports/${id}/photo-${i + 1}.jpg`;
        const up = await sb.storage.from("recipes").upload(path, blob, { contentType: "image/jpeg", upsert: false });
        if (up.error) throw up.error;
        paths.push(path);
      }
      setMsg(out, "Envoi…");
      const ins = await sb.from("recipe_imports").insert({ id, book_id: book, kind: "texte", target, source_url: null, source_text: text, photo_paths: paths, created_by: ctx.user.id }).select("*").single();
      if (ins.error) { if (paths.length) await sb.storage.from("recipes").remove(paths); throw ins.error; }
      upsert(ins.data);
      nt.value = ""; drawCount(); clear();
      try { await callImport(id); }
      catch (e2) { setMsg(out, e2.message + " L'import reste dans la liste : vous pourrez le relancer.", "erreur"); btn.disabled = false; poll(); return; }
      setMsg(out, "Lecture lancée. Vous pouvez quitter cette page : la fiche arrivera dans votre carnet, à relire.", "ok");
      poll();
    } catch (err) {
      if (paths.length) sb.storage.from("recipes").remove(paths).catch(() => {});
      setMsg(out, errMsg(err, "Impossible d'envoyer la note. Réessayez."), "erreur");
    }
    btn.disabled = false;
  });

  // ---- photos de page
  const fp = $("#f-photo"), files = [];
  const thumbs = $("#vignettes");
  function drawThumbs() {
    thumbs.innerHTML = files.map((x, i) => `<li class="vignette">${x.pdf ? `<span class="vignette-pdf" aria-hidden="true">PDF</span>` : `<img src="${esc(x.url)}" alt="Page ${i + 1}">`}<span class="libelle">${x.pdf ? esc(x.file.name) : `Page ${i + 1}`}</span>
      <button type="button" class="btn danger cible" data-rm-page="${i}" aria-label="Retirer la page ${i + 1}">×</button></li>`).join("");
  }
  $("#pages-input").addEventListener("change", (e) => {
    const out = $("#msg-photo"); setMsg(out, "");
    Array.from(e.target.files || []).forEach((f) => {
      const pdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      if (!pdf && !/^image\//.test(f.type)) return setMsg(out, "Seules les images et les PDF sont acceptés.", "erreur");
      if (pdf && f.size > PDF_MAX) return setMsg(out, `« ${f.name} » dépasse 8 Mo : exportez-le en plus léger ou photographiez les pages.`, "erreur");
      if (files.length >= MAX_PAGES) return setMsg(out, `${MAX_PAGES} fichiers au plus : les suivants ont été ignorés.`, "erreur");
      files.push({ file: f, pdf, url: pdf ? "" : URL.createObjectURL(f) });
    });
    e.target.value = ""; drawThumbs();
  });
  thumbs.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rm-page]");
    if (!b) return;
    const [x] = files.splice(Number(b.dataset.rmPage), 1);
    if (x && x.url) URL.revokeObjectURL(x.url);
    drawThumbs();
  });
  fp.addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = $("#msg-photo");
    if (!files.length) return setMsg(out, "Choisissez au moins une photo ou un PDF.", "erreur");
    const btn = $("#go-photo"); btn.disabled = true;
    const id = AR.uuid(), book = bookSel.value, paths = [];
    try {
      // Les photos partent avant la ligne d'import : la fonction les trouve toutes à son démarrage.
      for (let i = 0; i < files.length; i++) {
        setMsg(out, `Préparation du fichier ${i + 1} sur ${files.length}…`);
        const pdf = files[i].pdf;
        const blob = pdf ? files[i].file : await AR.compressImage(files[i].file, 2000, 0.85);
        const path = `${book}/imports/${id}/${i + 1}.${pdf ? "pdf" : "jpg"}`;
        const up = await sb.storage.from("recipes").upload(path, blob, { contentType: pdf ? "application/pdf" : "image/jpeg", upsert: false });
        if (up.error) throw up.error;
        paths.push(path);
      }
      setMsg(out, "Envoi…");
      const ins = await sb.from("recipe_imports").insert({ id, book_id: book, kind: "photo_page", target, page_paths: paths, created_by: ctx.user.id }).select("*").single();
      if (ins.error) { await sb.storage.from("recipes").remove(paths); throw ins.error; }
      upsert(ins.data);
      try { await callImport(id); }
      catch (e2) { setMsg(out, e2.message + " L'import reste dans la liste : vous pourrez le relancer.", "erreur"); btn.disabled = false; files.splice(0).forEach((x) => x.url && URL.revokeObjectURL(x.url)); drawThumbs(); poll(); return; }
      files.splice(0).forEach((x) => x.url && URL.revokeObjectURL(x.url)); drawThumbs();
      setMsg(out, "Lecture lancée. Vous pouvez quitter cette page : la fiche sera à relire avant d'entrer au carnet.", "ok");
      poll();
    } catch (err) {
      if (paths.length) sb.storage.from("recipes").remove(paths).catch(() => {});
      setMsg(out, errMsg(err, "Impossible d'envoyer les photos. Réessayez."), "erreur");
    }
    btn.disabled = false;
  });

  // ---- liste « En cours »
  const rows = new Map();
  const box = $("#imports");
  const ACTIFS = ["en_attente", "en_cours"];
  const label = (r) => r.kind === "texte" ? "Note" : r.kind === "photo_page" ? `${(r.page_paths || []).some((p) => /\.pdf$/i.test(p)) ? "PDF" : "Photo de page"}${(r.page_paths || []).length > 1 ? ` (${r.page_paths.length} fichiers)` : ""}`
    : (r.kind === "instagram" ? "Reel Instagram" : "Site web") + (AR.host(r.source_url || "") ? " · " + AR.host(r.source_url) : "");
  const fmtHeure = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  function etat(r) {
    if (r.status === "en_attente") return { t: "En attente de démarrage…", c: "" };
    if (r.status === "en_cours") return { t: r.step || "Import en cours…", c: "" };
    if (r.status === "a_relire") return { t: "À relire avant d'entrer au carnet", c: "or" };
    if (r.status === "termine") return { t: r.tip_id && !r.recipe_id ? "Astuce prête" : "Fiche prête", c: "or" };
    return { t: r.error || "L'import a échoué.", c: "erreur" };
  }
  function draw() {
    const list = [...rows.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    if (!list.length) { box.innerHTML = `<p class="muted italique">Aucun import pour l'instant.</p>`; return; }
    const multi = ctx.books.length > 1;
    box.innerHTML = `<ul class="imports">${list.map((r) => {
      const e = etat(r), actif = ACTIFS.includes(r.status);
      return `<li class="imp" data-id="${esc(r.id)}"><div class="imp-tete"><span class="libelle">${esc(label(r))}</span>
        <span class="meta">${esc(fmtDate(r.created_at))} · ${esc(fmtHeure(r.created_at))}${multi ? " · " + esc(bookName(r.book_id)) : ""}</span></div>
        <p class="imp-etat ${e.c}"${r.status === "echec" ? ' role="alert"' : ""}>${actif ? '<span class="imp-point" aria-hidden="true"></span>' : ""}${esc(e.t)}</p>
        <div class="rangee">
          ${r.recipe_id ? `<a class="btn petit" href="/recettes/fiche.html?id=${encodeURIComponent(r.recipe_id)}">${r.status === "a_relire" ? "Relire la fiche" : "Ouvrir la fiche"}</a>`
            : r.tip_id ? `<a class="btn petit" href="/recettes/astuce.html?id=${encodeURIComponent(r.tip_id)}">Ouvrir l'astuce</a>` : ""}
          ${r.status === "en_attente" ? `<button type="button" class="btn sec petit" data-retry="${esc(r.id)}">Relancer</button>` : ""}
          ${r.status === "termine" || r.status === "echec" ? `<button type="button" class="btn sec petit" data-remove="${esc(r.id)}">Retirer de la liste</button>` : ""}
        </div></li>`;
    }).join("")}</ul>`;
  }
  function upsert(r) {
    const old = rows.get(r.id);
    rows.set(r.id, r);
    if (old && ACTIFS.includes(old.status) && r.status === "termine") toast(r.tip_id && !r.recipe_id ? "Une astuce est prête." : "Une fiche est prête.");
    draw(); poll();
  }
  async function load() {
    const { data, error } = await sb.from("recipe_imports").select("*").eq("created_by", ctx.user.id).order("created_at", { ascending: false }).limit(30);
    if (error) { if (!rows.size) box.innerHTML = `<p class="msg erreur" role="alert">${esc(errMsg(error, "Impossible de lire vos imports."))}</p>`; return; }
    const prev = new Map(rows);
    rows.clear();
    (data || []).forEach((r) => { rows.set(r.id, r); const o = prev.get(r.id); if (o && ACTIFS.includes(o.status) && r.status === "termine") toast("Une fiche est prête."); });
    draw(); poll();
  }
  box.addEventListener("click", async (e) => {
    const rm = e.target.closest("[data-remove]"), rt = e.target.closest("[data-retry]");
    if (rm) {
      rm.disabled = true;
      const { error } = await sb.from("recipe_imports").delete().eq("id", rm.dataset.remove);
      if (error) { rm.disabled = false; return toast(errMsg(error, "Impossible de retirer cet import."), "erreur"); }
      rows.delete(rm.dataset.remove); draw();
    }
    if (rt) {
      rt.disabled = true;
      try { await callImport(rt.dataset.retry); toast("Import relancé."); load(); }
      catch (err) { rt.disabled = false; toast(err.message, "erreur"); }
    }
  });

  // Temps réel, avec sondage toutes les 5 s tant qu'un import est actif ou que le canal n'est pas établi.
  let live = false, timer = null;
  function poll() {
    const need = !live || [...rows.values()].some((r) => ACTIFS.includes(r.status));
    if (need && !timer) timer = setInterval(() => { if (!document.hidden) load(); }, 5000);
    if (!need && timer) { clearInterval(timer); timer = null; }
  }
  try {
    const ch = sb.channel("imports-" + ctx.user.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "recipe_imports", filter: `created_by=eq.${ctx.user.id}` }, (p) => {
        if (p.eventType === "DELETE") { if (p.old && p.old.id) rows.delete(p.old.id); draw(); poll(); }
        else if (p.new && p.new.id) upsert(p.new);
      })
      .subscribe((status) => { live = status === "SUBSCRIBED"; poll(); });
    window.addEventListener("pagehide", () => { sb.removeChannel(ch); });
  } catch (err) { console.error(err); live = false; }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  await load();
  poll();
})();
