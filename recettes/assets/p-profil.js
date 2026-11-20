// ARÔMES V&N · mon profil : allergies, aversions, régime, difficulté en semaine, notifications, « Jamais ».
(async function () {
  const AR = window.AR, { sb, $, $$, esc, errMsg, toast, setMsg } = AR;
  const ctx = await AR.boot("profil");
  if (!ctx) return;
  const main = $("#main"), zone = $("#zone");
  main.setAttribute("aria-busy", "false");

  let prof = { allergens: [], aversions: [], aversions_texte: [], regime: null, difficulte_semaine: null };
  try {
    const { data, error } = await sb.from("recipe_profiles").select("*").maybeSingle();
    if (error) throw error;
    if (data) prof = { ...prof, ...data, allergens: data.allergens || [], aversions: data.aversions || [], aversions_texte: data.aversions_texte || [] };
  } catch (e) { zone.innerHTML = `<p class="msg erreur" role="alert">${esc(errMsg(e, "Impossible de charger votre profil."))}</p>`; return; }

  let cat = [];
  try { cat = await AR.loadCatalog(); } catch (e) { console.error(e); }
  const nameOf = (id) => { const c = cat.find((x) => x.id === id); return c ? c.name : "Ingrédient inconnu"; };
  const st = { allergens: new Set(prof.allergens), aversions: [...prof.aversions], texte: [...prof.aversions_texte] };

  zone.innerHTML = `
    <p class="italique muted">Ce profil reste le vôtre. Les autres membres de vos carnets voient vos allergies, aversions et régime pour composer des menus, jamais votre préférence de difficulté.</p>
    <form id="pf-form" class="champs" novalidate>
      <fieldset class="pf-groupe"><legend class="libelle or">Allergies</legend>
        <p class="aide">Toute recette contenant un de ces allergènes est écartée de vos suggestions.</p>
        <div class="pf-allergenes">${Object.entries(AR.ALLERGENES).map(([k, l]) => `<label class="case pf-case"><input type="checkbox" name="al" value="${k}"${st.allergens.has(k) ? " checked" : ""}> ${esc(l)}</label>`).join("")}</div></fieldset>
      <fieldset class="pf-groupe"><legend class="libelle or">Régime</legend>
        <label for="pf-regime" class="sr-only">Régime</label>
        <select id="pf-regime" name="regime"><option value="">Aucun régime particulier</option>${Object.entries(AR.REGIMES).map(([k, l]) => `<option value="${k}"${prof.regime === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></fieldset>
      <fieldset class="pf-groupe"><legend class="libelle or">Aversions</legend>
        <p class="aide">Ce que vous ne mangez pas, par goût. Choisissez dans le catalogue, ou écrivez un mot libre (3 lettres au moins).</p>
        <div id="pf-cat"></div>
        <ul class="pf-puces" id="pf-av" aria-label="Aversions choisies dans le catalogue"></ul>
        <div class="pf-libre"><label for="pf-txt">Autre aversion (texte libre)</label>
          <div class="po-saisie"><input id="pf-txt" maxlength="60" autocomplete="off" enterkeyhint="done"><button type="button" class="btn sec" id="pf-txt-add">Ajouter</button></div></div>
        <ul class="pf-puces" id="pf-tx" aria-label="Aversions en texte libre"></ul></fieldset>
      <fieldset class="pf-groupe"><legend class="libelle or">Difficulté en semaine</legend>
        <label for="pf-diff" class="sr-only">Difficulté acceptée en semaine</label>
        <select id="pf-diff" name="diff"><option value="">Aucune limite</option>${[1, 2, 3].map((n) => `<option value="${n}"${prof.difficulte_semaine === n ? " selected" : ""}>${n === 3 ? "Jusqu'à « Difficile »" : n === 2 ? "Jusqu'à « Moyen »" : "Seulement « Facile »"}</option>`).join("")}</select>
        <p class="aide">Du lundi au vendredi, les suggestions plus difficiles sont écartées de votre côté.</p></fieldset>
      <div><button type="submit" class="btn">Enregistrer mon profil</button></div>
      <p class="msg" id="pf-msg" role="status" aria-live="polite"></p>
    </form>
    <h2 class="section">Notifications</h2><span class="filet" aria-hidden="true"></span>
    <div id="pf-notif"></div>
    <h2 class="section">Recettes écartées</h2><span class="filet" aria-hidden="true"></span>
    <div id="pf-jamais"><p class="chargement">Chargement…</p></div>`;

  // ---- aversions
  function renderPuces() {
    $("#pf-av").innerHTML = st.aversions.map((id) => `<li class="pf-puce"><span>${esc(nameOf(id))}</span><button type="button" class="pf-x" data-av="${esc(id)}" aria-label="Retirer ${esc(nameOf(id))}">×</button></li>`).join("");
    $("#pf-tx").innerHTML = st.texte.map((t, i) => `<li class="pf-puce"><span>${esc(t)}</span><button type="button" class="pf-x" data-tx="${i}" aria-label="Retirer ${esc(t)}">×</button></li>`).join("");
  }
  AR.catalogPicker($("#pf-cat"), { label: "Chercher dans le catalogue", placeholder: "Coriandre, anchois…", id: "pf-ac", exclude: () => new Set(st.aversions),
    onPick: (c) => { if (!st.aversions.includes(c.id)) st.aversions.push(c.id); renderPuces(); } });
  function addTexte() {
    const inp = $("#pf-txt"), v = inp.value.replace(/\s+/g, " ").trim();
    if (v.length < 3) return setMsg($("#pf-msg"), "Une aversion en texte libre compte 3 lettres au moins.", "erreur");
    if (!st.texte.some((t) => AR.norm(t) === AR.norm(v))) st.texte.push(v);
    inp.value = ""; setMsg($("#pf-msg"), ""); renderPuces(); inp.focus();
  }
  $("#pf-txt-add").addEventListener("click", addTexte);
  $("#pf-txt").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addTexte(); } });
  zone.addEventListener("click", (e) => {
    const a = e.target.closest("[data-av]"); if (a) { st.aversions = st.aversions.filter((x) => x !== a.dataset.av); renderPuces(); return; }
    const t = e.target.closest("[data-tx]"); if (t) { st.texte.splice(+t.dataset.tx, 1); renderPuces(); }
  });
  renderPuces();

  $("#pf-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, out = $("#pf-msg"), btn = f.querySelector("button[type=submit]");
    const d = f.diff.value === "" ? null : Number(f.diff.value);
    const row = { user_id: ctx.user.id, allergens: $$("input[name=al]:checked", f).map((x) => x.value), aversions: st.aversions, aversions_texte: st.texte, regime: f.regime.value || null, difficulte_semaine: d };
    btn.disabled = true; setMsg(out, "Enregistrement…");
    const { error } = await sb.from("recipe_profiles").upsert(row);
    btn.disabled = false;
    if (error) return setMsg(out, errMsg(error, "Votre profil n'a pas pu être enregistré."), "erreur");
    setMsg(out, "Profil enregistré.", "ok");
  });

  // ---- notifications
  async function renderNotif() {
    const box = $("#pf-notif");
    if (!AR.push.available()) { box.innerHTML = `<p class="muted italique">Notifications : bientôt disponible.</p>`; return; }
    if (!AR.push.supported()) { box.innerHTML = `<p class="muted italique">Les notifications ne sont pas prises en charge sur cet appareil. Sur iPhone, ajoutez d'abord l'application à l'écran d'accueil (iOS 16.4 ou plus).</p>`; return; }
    const denied = Notification.permission === "denied";
    const on = !denied && Notification.permission === "granted" && !!(await AR.push.current());
    box.innerHTML = `<div class="pf-interrupteur"><span class="pf-int-lib" id="pf-int-l">Notifications</span>
      <button type="button" class="pf-switch" id="pf-switch" role="switch" aria-checked="${on}" aria-labelledby="pf-int-l"${denied ? " disabled" : ""}><span class="pf-curseur" aria-hidden="true"></span><span class="sr-only">${on ? "Activées" : "Désactivées"}</span></button></div>
      <p class="aide">Import terminé, recette ajoutée par un autre membre, invitation reçue. Aucune notification par article coché.</p>
      ${denied ? `<p class="msg erreur">Les notifications sont bloquées dans les réglages de votre navigateur.</p>` : ""}<p class="msg" id="pf-nmsg" role="status" aria-live="polite"></p>`;
  }
  $("#pf-notif").addEventListener("click", async (e) => {
    const sw = e.target.closest("#pf-switch"); if (!sw) return;
    const out = $("#pf-nmsg"), turnOn = sw.getAttribute("aria-checked") !== "true";
    sw.disabled = true; setMsg(out, "…");
    const r = turnOn ? await AR.push.enable() : await AR.push.disable();
    const T = { ok: turnOn ? "Notifications activées." : "Notifications désactivées.", refuse: "Autorisation refusée : activez-la dans les réglages du navigateur.", non_supporte: "Cet appareil ne prend pas en charge les notifications.", erreur: "Impossible de modifier les notifications. Réessayez." };
    await renderNotif();
    setMsg($("#pf-nmsg"), T[r] || "", r === "ok" ? "ok" : "erreur");
  });
  renderNotif();

  // ---- « Jamais » annulables
  async function renderJamais() {
    const box = $("#pf-jamais");
    try {
      const fb = await sb.from("recipe_feedback").select("recipe_id,created_at").eq("kind", "jamais").order("created_at", { ascending: false });
      if (fb.error) throw fb.error;
      const ids = (fb.data || []).map((x) => x.recipe_id);
      if (!ids.length) { box.innerHTML = `<p class="muted italique">Aucune recette écartée pour toujours. Le bouton « Jamais » des suggestions les range ici ; vous pouvez revenir dessus.</p>`; return; }
      const rr = await sb.from("recipes").select("id,title").in("id", ids);
      if (rr.error) throw rr.error;
      const t = new Map((rr.data || []).map((r) => [r.id, r.title]));
      box.innerHTML = `<ul class="membres">${(fb.data || []).map((x) => `<li data-r="${esc(x.recipe_id)}"><div class="qui">${esc(t.get(x.recipe_id) || "Recette indisponible")}<small>Écartée le ${esc(AR.fmtDate(x.created_at))}</small></div><div><button type="button" class="btn sec petit" data-annule="${esc(x.recipe_id)}">Annuler</button></div></li>`).join("")}</ul>`;
    } catch (e) { box.innerHTML = `<p class="msg erreur" role="alert">${esc(errMsg(e, "Impossible de lire les recettes écartées."))}</p>`; }
  }
  $("#pf-jamais").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-annule]"); if (!b) return;
    b.disabled = true;
    const { error } = await sb.from("recipe_feedback").delete().eq("recipe_id", b.dataset.annule);
    if (error) { b.disabled = false; return toast(errMsg(error, "Impossible d'annuler."), "erreur"); }
    toast("La recette reviendra dans vos suggestions."); renderJamais();
  });
  renderJamais();
})();
