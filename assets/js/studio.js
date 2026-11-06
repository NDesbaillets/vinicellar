// Studio : le navigateur propose, suit et présente. Aucun traitement ni secret IA ici.
(function () {
  const VC = window.VC;
  const { sb, $, esc, I } = VC;
  const active = new Map();
  const enabled = () => VC.cfg.studioEnabled === true;
  const ref = (a) => a && a.decision === "approved" && a.active && a.approved_path ? `studio-approved:${a.approved_path}` : null;
  const asset = (it, kind) => active.get(`${it.id}/${kind}`) || null;
  async function loadActive(items) {
    if (!enabled() || !items.length) return;
    for (const it of items) for (const k of ["bottle", "label"]) active.delete(`${it.id}/${k}`);
    // Une requête groupée, sans modification des fiches et sans N+1.
    for (let n = 0; n < items.length; n += 100) {
      const { data, error } = await sb.from("studio_assets").select("id,item_id,kind,approved_path,provenance,decision,active").in("item_id", items.slice(n,n+100).map(it => it.id)).eq("decision", "approved").eq("active", true);
      if (error) continue; // Migration absente ou accès retiré : repli sur les photos originales.
      for (const a of data || []) if (ref(a)) active.set(`${a.item_id}/${a.kind}`, a);
    }
  }
  function offer(id) {
    if (!enabled()) return;
    const d = VC.sheet(`<span class="eyebrow">Votre vin est enregistré</span><h2>Créer les visuels Studio Vinicellar ?</h2><p class="muted">Préparez une étiquette restaurée et une bouteille studio. Vous choisirez les photos et validerez chaque résultat séparément.</p><p class="hint">Vos photographies originales sont conservées. Aucun traitement ne démarre à cette étape.</p><div class="row end"><button type="button" class="btn quiet" data-close>Plus tard</button><a class="btn" href="/app/studio.html?id=${encodeURIComponent(id)}">${I.sparkle}Créer les visuels</a></div>`);
    return d;
  }
  async function invoke(name, body) {
    const { data, error } = await sb.functions.invoke(name, { body });
    if (error) {
      let message = "Studio est indisponible. Votre vin et vos photos sont conservés.";
      try { message = (await error.context.json()).message || message; } catch { /* réseau */ }
      throw new Error(message);
    }
    return data;
  }
  async function original(file) {
    if (!["image/jpeg","image/png","image/webp"].includes(file.type) || file.size > 8*1024*1024) throw new Error("Pour conserver l'original, utilisez JPEG, PNG ou WebP, jusqu'à 8 Mo.");
    return {blob:file,preview:URL.createObjectURL(file)};
  }
  async function page() {
    const ctx = await VC.boot("cellar"), main = $("#main");
    if (!enabled()) { main.innerHTML = `<div class="empty"><h1>Studio Vinicellar</h1><p>Studio attend son activation sur cet environnement.</p><a class="btn ghost" href="/app/">Retour à mes caves</a></div>`; return; }
    const params = new URLSearchParams(location.search), id = params.get("id");
    const { data: it, error } = await sb.from("items").select("*").eq("id", id).single();
    if (error || !it) { main.innerHTML = `<p class="notice">Fiche introuvable.</p>`; return; }
    if (!VC.canEdit(it.collection_id)) { main.innerHTML = `<p class="notice info">Cette cave est partagée en lecture seule.</p>`; return; }
    let urls = () => null, timer, stopped = false, busy = false, snapshot = "", currentJob = null, requestKey = null;
    const points = { corners: [], outline: [] };
    let formState = null;
    const selection = { label: it.label_path || "", bottle: "" };
    const paths = () => [...new Set([it.label_path,it.label_back_path,it.bottle_path,...(it.photo_paths || [])].filter(Boolean))];
    const base = () => `<div class="page-head"><div><a class="back-link" href="/app/fiche.html?id=${encodeURIComponent(id)}">${I.back}Retour à la fiche</a><span class="eyebrow">Studio Vinicellar</span><h1>${esc(it.name)}</h1><p class="muted">Deux visuels indépendants. Vous gardez le dernier mot.</p></div></div>`;
    const labelFor = (path) => path === it.label_path ? "Étiquette originale" : path === it.label_back_path ? "Contre-étiquette" : path === it.bottle_path ? "Image de bouteille existante · provenance à vérifier" : `Photo originale ${paths().indexOf(path)+1}`;
    const options = (chosen) => `<option value="">Choisir une photo</option>${paths().map(p=>`<option value="${esc(p)}"${chosen===p?" selected":""}>${esc(labelFor(p))}</option>`).join("")}`;
    function pointEditor(key) {
      return `<div class="studio-editor-wrap"><button type="button" class="studio-point-editor" data-points="${key}" aria-label="${key === "corners" ? "Indiquer les quatre coins : haut gauche, haut droite, bas droite, bas gauche" : "Dessiner le contour de la bouteille"}"><img alt="Photo source à délimiter" data-source-image="${key}"><svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true"></svg></button></div><div class="row"><button type="button" class="btn quiet" data-undo="${key}">Annuler le dernier point</button><button type="button" class="btn quiet" data-clear="${key}">Effacer le contour</button><span class="hint" data-point-count="${key}"></span></div><details><summary>Coordonnées au clavier</summary><label>Points normalisés [x, y], entre 0 et 1<textarea data-coordinates="${key}" rows="2" placeholder="[[0.1,0.1],[0.9,0.1],[0.9,0.9],[0.1,0.9]]"></textarea></label></details>`;
    }
    async function setup(force = false) {
      clearTimeout(timer); currentJob = null; snapshot = ""; requestKey = crypto.randomUUID();
      urls = await VC.signed(paths());
      main.innerHTML = `${base()}<form id="studio-form" novalidate><div class="studio-setup-grid"><section class="card"><h2>1. Étiquette restaurée</h2><label class="studio-check"><input name="make_label" type="checkbox" checked>Créer l'étiquette restaurée</label><label>Photo source<select name="label">${options(selection.label)}</select></label><label class="btn ghost studio-upload">${I.camera}Ajouter l'original<input type="file" accept="image/jpeg,image/png,image/webp" data-upload="label" hidden></label><p class="hint">Indiquez les quatre coins dans l'ordre : haut gauche, haut droite, bas droite, bas gauche. Les textes et logos ne seront pas réécrits.</p>${pointEditor("corners")}<label class="studio-check"><input type="checkbox" name="label_is_crop">La photo contient déjà uniquement l'étiquette, sans correction de perspective nécessaire.</label></section>
        <section class="card"><h2>2. Bouteille studio</h2><label class="studio-check"><input name="make_bottle" type="checkbox" checked>Créer la bouteille studio</label><label>Méthode<select name="mode"><option value="cutout">Détourer une vraie photo complète</option><option value="reconstructed">Reconstituer à partir de l'étiquette</option></select></label><div id="cutout-fields"><label>Photo de la bouteille entière<select name="bottle">${options(selection.bottle)}</select></label><label class="btn ghost studio-upload">${I.camera}Ajouter la photo complète<input type="file" accept="image/jpeg,image/png,image/webp" data-upload="bottle" hidden></label><p class="hint">Fond uni : détourage automatique. Fond complexe : cliquez tout autour de la bouteille, puis fermez le contour en lançant le traitement.</p>${pointEditor("outline")}<label class="studio-check"><input name="full_bottle" type="checkbox">Je confirme que la bouteille est entière, de la capsule au fond.</label></div>
        <div id="reconstruction-fields" hidden><p class="notice info">Reconstitution indicative : la forme du verre et une capsule neutre seront composées. Aucun élément distinctif manquant ne sera inventé.</p><label>Forme confirmée<select name="template"><option value="">Choisir</option><option value="bordeaux">Bordelaise</option><option value="burgundy">Bourguignonne</option><option value="champagne">Champenoise</option></select></label><label>Verre confirmé<select name="glass"><option value="">Choisir</option><option value="green">Vert</option><option value="brown">Brun</option><option value="clear">Clair</option></select></label><label class="studio-check"><input name="confirmed_shape" type="checkbox">Je confirme ces caractéristiques et j'accepte une reconstitution identifiée comme telle.</label></div></section></div>
        <div class="studio-submit card"><p>Les résultats resteront privés et inactifs jusqu'à votre validation séparée.</p><div class="row"><a class="btn ghost" href="/app/fiche.html?id=${encodeURIComponent(id)}">Plus tard</a><button type="submit" class="btn">${I.sparkle}Lancer la création</button></div><p class="form-msg" role="status" aria-live="polite"></p></div></form>`;
      const f = $("#studio-form");
      if (formState) for (const [name,value] of Object.entries(formState)) { const input = f.elements[name]; if (input.type === "checkbox") input.checked = value; else input.value = value; }
      $("#cutout-fields").hidden = f.mode.value !== "cutout"; $("#reconstruction-fields").hidden = f.mode.value !== "reconstructed";
      const drawPoints = (key) => {
        const editor = f.querySelector(`[data-points="${key}"]`), source = key === "corners" ? selection.label : selection.bottle;
        const image = editor.querySelector("img"), url = urls(source);
        if (url) image.src = url; else image.removeAttribute("src");
        editor.hidden = !url;
        editor.querySelector("svg").innerHTML = `<polyline points="${points[key].map(p=>p.join(",")).join(" ")}" fill="none" stroke="#e8a745" stroke-width=".008"/>${points[key].map(p=>`<circle cx="${p[0]}" cy="${p[1]}" r=".012" fill="#e8a745" stroke="#fff" stroke-width=".003"/>`).join("")}`;
        f.querySelector(`[data-point-count="${key}"]`).textContent = `${points[key].length} point(s)`;
        f.querySelector(`[data-coordinates="${key}"]`).value = JSON.stringify(points[key]);
      };
      drawPoints("corners"); drawPoints("outline");
      f.addEventListener("click", e => {
        const editor = e.target.closest("[data-points]"), undo = e.target.closest("[data-undo]"), clear = e.target.closest("[data-clear]");
        if (editor && !editor.hidden) {
          const key = editor.dataset.points;
          if (points[key].length >= (key === "corners" ? 4 : 64)) return;
          const r = editor.querySelector("img").getBoundingClientRect();
          points[key].push([Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))]); drawPoints(key);
        }
        if (undo) { points[undo.dataset.undo].pop(); drawPoints(undo.dataset.undo); }
        if (clear) { points[clear.dataset.clear] = []; drawPoints(clear.dataset.clear); }
      });
      f.addEventListener("change", async e => {
        const key = e.target.dataset.coordinates;
        if (key) { try { const p = JSON.parse(e.target.value); if (!Array.isArray(p) || p.some(x=>!Array.isArray(x)||x.length!==2||x.some(n=>typeof n!=="number"||!Number.isFinite(n)||n<0||n>1))) throw Error(); points[key] = p; drawPoints(key); } catch { VC.toast("Coordonnées invalides."); } }
        if (e.target.name === "mode") { $("#cutout-fields").hidden = f.mode.value !== "cutout"; $("#reconstruction-fields").hidden = f.mode.value !== "reconstructed"; }
        if (["label","bottle"].includes(e.target.name)) { selection[e.target.name] = e.target.value; const k = e.target.name === "label" ? "corners" : "outline"; points[k] = []; drawPoints(k); }
        if (e.target.dataset.upload && e.target.files?.[0]) {
          const input = e.target, file = input.files[0], target = input.dataset.upload;
          input.disabled = true;
          try {
            if (!["image/jpeg","image/png","image/webp"].includes(file.type) || file.size > 8*1024*1024) throw Error("Photo JPEG, PNG ou WebP de moins de 8 Mo requise.");
            const path = `${ctx.user.id}/studio-source-${crypto.randomUUID()}.${file.type.split("/")[1]}`;
            const { error: ue } = await sb.storage.from("labels").upload(path,file,{contentType:file.type,upsert:false});
            if (ue) throw ue;
            const { error: ae } = await sb.rpc("studio_attach_source",{p_item:id,p_path:path});
            if (ae) throw ae;
            it.photo_paths = [...(it.photo_paths || []),path]; selection[target] = path; points[target === "label" ? "corners" : "outline"] = [];
            formState = Object.fromEntries(["mode","make_label","make_bottle","template","glass","confirmed_shape","full_bottle","label_is_crop"].map(name=>[name,f.elements[name].type === "checkbox" ? f.elements[name].checked : f.elements[name].value]));
            formState[target === "label" ? "label_is_crop" : "full_bottle"] = false;
            await setup(force);
          } catch (err) { VC.fail(err,err.message || "Photo non enregistrée."); }
          finally { input.disabled = false; }
        }
      });
      f.addEventListener("submit", async e => {
        e.preventDefault(); const message = f.querySelector(".form-msg"), button = f.querySelector('[type="submit"]');
        const outputs = [f.make_label.checked && "label",f.make_bottle.checked && "bottle"].filter(Boolean);
        if (!outputs.length) { message.textContent = "Choisissez au moins un visuel."; return; }
        if ((outputs.includes("label") || f.mode.value === "reconstructed") && (!selection.label || points.corners.length !== 4 && !f.label_is_crop.checked)) { message.textContent = "Choisissez une étiquette et indiquez ses quatre coins, ou confirmez son recadrage."; return; }
        if (outputs.includes("bottle") && f.mode.value === "cutout" && (!selection.bottle || !f.full_bottle.checked)) { message.textContent = "Choisissez une photo et confirmez que la bouteille est entière."; return; }
        if (outputs.includes("bottle") && f.mode.value === "reconstructed" && (!f.template.value || !f.glass.value || !f.confirmed_shape.checked)) { message.textContent = "Confirmez la forme et le verre de la reconstitution."; return; }
        button.disabled = true; message.textContent = "Préparation de la demande…";
        try {
          const result = await invoke("studio-start",{confirmed:true,item_id:id,request_key:requestKey,outputs,sources:{...selection},force,settings:{mode:f.mode.value,template:f.template.value,glass:f.glass.value,confirmed_shape:f.confirmed_shape.checked,full_bottle:f.full_bottle.checked,label_is_crop:f.label_is_crop.checked,corners:points.corners,outline:points.outline}});
          currentJob = result.job.id; params.set("job",currentJob); history.replaceState(null,"",`${location.pathname}?${params}`); await poll();
        } catch (err) { message.textContent = err.message; button.disabled = false; }
      });
    }
    async function poll() {
      clearTimeout(timer);
      if (stopped || busy || document.hidden || !currentJob) return;
      try {
        const [{ data: job, error: je },{ data: assets, error: ae }] = await Promise.all([
          sb.from("studio_jobs").select("*").eq("id",currentJob).eq("item_id",id).single(),
          sb.from("studio_assets").select("*").eq("job_id",currentJob).eq("item_id",id)
        ]);
        if (je || ae || !job) throw Error("Traitement inaccessible. Vérifiez votre connexion ou vos droits.");
        const next = JSON.stringify([job,assets]);
        if (next !== snapshot) { snapshot = next; await show(job,assets || []); }
        if (["queued","processing"].includes(job.status)) timer = setTimeout(poll,4000);
      } catch (err) {
        main.innerHTML = `${base()}<div class="card"><p role="status">${esc(err.message)}</p><button class="btn" id="studio-reconnect">Réessayer</button></div>`;
        $("#studio-reconnect").onclick = () => { snapshot = ""; poll(); };
      }
    }
    async function show(job, assets) {
      const stages = [["queued","En attente"],["preparing","Préparation des originaux"],["label","Étiquette"],["bottle","Bouteille"],["checks","Contrôles"]];
      const signed = await VC.signed([...Object.values(job.sources),...assets.map(a=>`studio-candidates:${a.candidate_path}`)]);
      const cards = assets.map(a => {
        const reconstructed = a.provenance === "bottle_reconstructed", source = job.sources[a.kind] || job.sources.label;
        return `<article class="card studio-result" data-asset="${a.id}"><div class="row"><h2>${a.kind === "label" ? "Étiquette restaurée" : "Bouteille studio"}</h2>${reconstructed ? `<span class="tag soon">Reconstitution indicative</span>` : ""}</div><div class="studio-comparison"><figure><div class="studio-stage"><img src="${esc(signed(source))}" alt="Photographie originale"></div><figcaption>Original conservé</figcaption></figure><figure><div class="studio-stage checker"><img src="${esc(signed(`studio-candidates:${a.candidate_path}`))}" alt="Candidat ${a.kind === "label" ? "étiquette" : "bouteille"}"></div><figcaption>Candidat · ${a.width} × ${a.height} px</figcaption></figure></div><ul class="studio-warnings">${(a.warnings || []).map(w=>`<li>${esc(w)}</li>`).join("")}</ul><div class="row studio-backgrounds" role="group" aria-label="Fond de prévisualisation"><button class="btn quiet" type="button" data-background="light">Clair</button><button class="btn quiet" type="button" data-background="dark">Sombre</button><button class="btn quiet" type="button" data-background="checker">Damier</button></div>
        ${a.decision === "pending" ? `<div class="row"><button type="button" class="btn" data-decision="approved">${I.check}Valider ${a.kind === "label" ? "l'étiquette" : "la bouteille"}</button><button type="button" class="btn ghost" data-decision="rejected">Rejeter</button></div>` : `<p class="notice ${a.decision === "approved" ? "info" : ""}" role="status">${a.decision === "approved" ? "Visuel approuvé. Il est disponible dans l'application." : "Visuel rejeté. Le visuel actif précédent est conservé."}</p>`}<p class="form-msg" role="status"></p></article>`;
      }).join("");
      main.innerHTML = `${base()}<section class="card studio-progress" aria-live="polite"><h2>${job.status === "ready" ? "À vous de choisir" : job.status === "failed" ? "La création n'a pas abouti" : "Création en cours"}</h2><ol>${stages.filter(([k])=>!OUTPUTS_MISSING(job,k)).map(([k,label])=>`<li${job.stage===k?' aria-current="step"':""}>${esc(label)}</li>`).join("")}</ol><p class="hint">Vous pouvez quitter cette page et retrouver ce traitement depuis la fiche.</p>${Object.values(job.errors || {}).map(e=>`<p class="notice">${esc(e)}</p>`).join("")}</section><div class="studio-results">${cards}</div><div class="row studio-footer"><a class="btn ghost" href="/app/fiche.html?id=${encodeURIComponent(id)}">Retour à la fiche</a>${["ready","failed"].includes(job.status) ? `<button type="button" class="btn quiet" id="studio-new">Préparer une nouvelle version</button>` : ""}</div>`;
      $("#studio-new")?.addEventListener("click",()=>setup(true));
      main.querySelectorAll("[data-background]").forEach(b=>b.onclick=()=>{ b.closest("article").querySelectorAll(".studio-stage").forEach(s=>{ s.className=`studio-stage ${b.dataset.background}`; }); });
      main.querySelectorAll("[data-decision]").forEach(b=>b.onclick=async()=>{
        if (busy) return; busy = true; clearTimeout(timer);
        const article = b.closest("article"), message = article.querySelector(".form-msg");
        main.querySelectorAll("[data-decision]").forEach(x=>x.disabled=true);
        try { await invoke("studio-review",{asset_id:article.dataset.asset,decision:b.dataset.decision}); snapshot = ""; }
        catch (err) { message.textContent=err.message; }
        finally { busy = false; main.querySelectorAll("[data-decision]").forEach(x=>x.disabled=false); await poll(); }
      });
    }
    function OUTPUTS_MISSING(job, stage) { return ["label","bottle"].includes(stage) && !job.outputs.includes(stage); }
    window.addEventListener("pagehide",()=>{ stopped = true; clearTimeout(timer); },{once:true});
    document.addEventListener("visibilitychange",()=>{ if (document.hidden) clearTimeout(timer); else poll(); });
    try {
      const chosen = params.get("job");
      const { data: jobs, error: jerror } = await sb.from("studio_jobs").select("id").eq("item_id",id).order("created_at",{ascending:false}).limit(1);
      if (jerror) throw Error("Studio attend l'activation de son schéma sur cet environnement.");
      currentJob = chosen || jobs?.[0]?.id;
      if (currentJob) await poll(); else await setup();
    } catch (err) { main.innerHTML = `${base()}<p class="notice">${esc(err.message)}</p>`; }
  }
  VC.Studio = { enabled, asset, ref, loadActive, offer, page, original };
})();
