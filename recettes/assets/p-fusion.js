(async function () {
  const AR = window.AR, { sb, $, $$, esc, norm, errMsg, setMsg, toast } = AR;
  const ctx = await AR.boot("carnet");
  if (!ctx) return;
  const main = $("#main");
  const qs = new URLSearchParams(location.search);
  const ida = qs.get("a"), idb = qs.get("b");
  const stop = (t, back) => { main.setAttribute("aria-busy", "false"); main.innerHTML = `<div class="vide-etat"><p role="alert">${esc(t)}</p><a class="btn sec petit" href="${back || "/recettes/"}">${back ? "Retour à la fiche" : "Retour au carnet"}</a></div>`; };
  if (!ida || !idb || ida === idb) return stop("Indiquez deux fiches différentes à fusionner.");

  async function loadOne(id) {
    const [r, l, s] = await Promise.all([
      sb.from("recipes").select("*").eq("id", id).maybeSingle(),
      sb.from("recipe_ingredient_lines").select("*").eq("recipe_id", id).order("position"),
      sb.from("recipe_steps").select("*").eq("recipe_id", id).order("position")
    ]);
    for (const x of [r, l, s]) if (x.error) throw x.error;
    return { r: r.data, lines: l.data || [], steps: s.data || [] };
  }
  let A, B;
  try { [A, B] = await Promise.all([loadOne(ida), loadOne(idb)]); }
  catch (e) { return stop(errMsg(e, "Impossible de charger les deux fiches.")); }
  if (!A.r || !B.r) return stop("Une des deux fiches est introuvable, ou vous n'avez pas accès à son carnet.");
  const isEditor = (bid) => ctx.books.some((b) => b.id === bid && (b.role === "owner" || b.role === "member"));
  const back = "/recettes/fiche.html?id=" + encodeURIComponent(A.r.id);
  if (!isEditor(A.r.book_id) || !isEditor(B.r.book_id)) return stop("Seuls les propriétaires et les membres d'un carnet peuvent fusionner ses fiches.", back);
  if (A.r.deleted_at || B.r.deleted_at) return stop("Une des deux fiches est dans la corbeille : restaurez-la d'abord.", back);
  if (A.r.archived_at) return stop("La fiche A est déjà archivée : elle ne peut pas recevoir la fusion.", back);
  document.title = "Fusionner · ARÔMES V&N";

  // ---- analyse : points communs, conflits
  const ra = A.r, rb = B.r;
  const FIELDS = [
    ["title", "Titre", (v) => v, null],
    ["servings", "Portions", (v) => String(v), "servings_estimated"],
    ["time_active_min", "Préparation", (v) => AR.fmtMin(v), "time_active_estimated"],
    ["time_total_min", "Temps total", (v) => AR.fmtMin(v), "time_total_estimated"],
    ["difficulty", "Difficulté", (v) => AR.DIFFICULTES[v] || String(v), null],
    ["course", "Type de plat", (v) => AR.COURSES[v] || String(v), null],
    ["cuisine", "Cuisine", (v) => v, null]
  ];
  const empty = (v) => v == null || v === "";
  const common = [];      // phrases « repris d'office »
  const fieldConf = [];   // conflits de champs
  const fieldAuto = {};   // champ -> "a" | "b" (sans conflit)
  FIELDS.forEach(([k, lab, f]) => {
    const va = ra[k], vb = rb[k];
    if (empty(va) && empty(vb)) return;
    if (empty(vb) || String(va) === String(vb)) { fieldAuto[k] = "a"; common.push(`${lab} : ${f(va)}`); }
    else if (empty(va)) { fieldAuto[k] = "b"; common.push(`${lab} : ${f(vb)} (complété depuis B)`); }
    else fieldConf.push({ k, lab, a: f(va), b: f(vb) });
  });

  // Ingrédients : appariés par ingrédient du catalogue (ou libellé), dans l'ordre d'apparition.
  const occ = (ls) => { const n = new Map(); return ls.map((l) => { const k = AR.lineKey(l); const i = n.get(k) || 0; n.set(k, i + 1); return { l, id: k + "#" + i }; }); };
  const oa = occ(A.lines), ob = occ(B.lines);
  const mapB = new Map(ob.map((x) => [x.id, x.l]));
  const mapA = new Map(oa.map((x) => [x.id, x.l]));
  const ingConf = [], ingSolo = [];
  let ingCommon = 0;
  oa.forEach(({ l, id }) => {
    const b = mapB.get(id);
    if (!b) return ingSolo.push({ id, side: "a", l });
    if (AR.diffLines([l], [b]).qty.length) ingConf.push({ id, a: l, b });
    else ingCommon++;
  });
  ob.forEach(({ l, id }) => { if (!mapA.has(id)) ingSolo.push({ id, side: "b", l }); });
  if (ingCommon) common.push(`${ingCommon} ingrédient${ingCommon > 1 ? "s" : ""} identique${ingCommon > 1 ? "s" : ""} (même quantité)`);

  // Étapes : comparées par rang.
  const stepConf = [];
  let stepCommon = 0;
  for (let i = 0; i < Math.max(A.steps.length, B.steps.length); i++) {
    const a = A.steps[i], b = B.steps[i];
    if (a && b && norm(a.text) === norm(b.text)) stepCommon++;
    else stepConf.push({ i, a, b });
  }
  if (stepCommon) common.push(`${stepCommon} étape${stepCommon > 1 ? "s" : ""} identique${stepCommon > 1 ? "s" : ""}`);
  const nConf = fieldConf.length + ingConf.length + ingSolo.length + stepConf.length;

  // ---- affichage
  const val = (t) => `<span class="choix-val">${esc(t)}</span>`;
  const radio = (name, v, on) => `<input type="radio" name="${esc(name)}" value="${v}"${on ? " checked" : ""}>`;
  const duo = (name, legend, ca, cb, def, vide) => `<fieldset class="choix"${vide ? ` data-vide="${vide}"` : ""}><legend class="libelle">${legend}</legend><div class="choix-duo">
    <label class="choix-cote">${radio(name, "a", def !== "b")}<span><span class="libelle or">Fiche A</span>${ca}</span></label>
    <label class="choix-cote">${radio(name, "b", def === "b")}<span><span class="libelle or">Fiche B</span>${cb}</span></label></div></fieldset>`;
  const qty = (l) => `<span class="choix-val qte">${esc(AR.fmtLine(l))}</span>${l.precision && l.quantity != null ? `<span class="prec">${esc(l.precision)}</span>` : ""}`;
  const none = `<span class="choix-val italique muted">Aucune</span>`;

  const fieldsHtml = fieldConf.map((c) => duo("f:" + c.k, esc(c.lab), val(c.a), val(c.b))).join("");
  const ingHtml = ingConf.map((c) => duo("i:" + c.id, esc(c.a.label_original), qty(c.a), qty(c.b))).join("");
  const soloHtml = ingSolo.map((c) => `<fieldset class="choix" data-side="${c.side}"><legend class="libelle">${esc(c.l.label_original)} <span class="muted">· seulement dans la fiche ${c.side === "a" ? "A" : "B"}</span></legend><div class="choix-duo">
    <label class="choix-cote">${radio("s:" + c.id, "keep", true)}<span><span class="libelle or">Garder</span>${qty(c.l)}</span></label>
    <label class="choix-cote">${radio("s:" + c.id, "ecarte", false)}<span><span class="libelle or">Écarter</span><span class="choix-val italique muted">Sans cet ingrédient</span></span></label></div></fieldset>`).join("");
  const stepHtml = stepConf.map((c) => duo("e:" + c.i, `Étape ${c.i + 1}`,
    c.a ? `<span class="choix-texte">${esc(c.a.text)}</span>` : none, c.b ? `<span class="choix-texte">${esc(c.b.text)}</span>` : none, c.a ? "a" : "b", !c.a ? "a" : !c.b ? "b" : "")).join("");
  const sect = (t, h) => h ? `<h2 class="section">${t}</h2><span class="filet" aria-hidden="true"></span>${h}` : "";

  main.setAttribute("aria-busy", "false");
  main.innerHTML = `<p><a href="${back}">← Retour à la fiche</a></p>
    <h1 class="chapitre">Fusionner</h1><span class="filet" aria-hidden="true"></span>
    <p>Le résultat est écrit dans la fiche A. La fiche B est archivée et rangée comme version de A.</p>
    <div class="fusion-duo">
      <p><span class="libelle or">Fiche A · reçoit le résultat</span><br><a href="/recettes/fiche.html?id=${encodeURIComponent(ra.id)}">${esc(ra.title)}</a></p>
      <p><span class="libelle or">Fiche B · sera archivée</span><br><a href="/recettes/fiche.html?id=${encodeURIComponent(rb.id)}">${esc(rb.title)}</a></p>
    </div>
    <h2 class="section">Points communs</h2><span class="filet" aria-hidden="true"></span>
    ${common.length ? `<ul class="communs">${common.map((c) => `<li>${esc(c)}</li>`).join("")}</ul><p class="aide">Repris d'office.</p>` : `<p class="muted italique">Aucun point commun relevé.</p>`}
    <form id="form" novalidate>
      ${nConf ? `<h2 class="section">À arbitrer (${nConf})</h2><span class="filet" aria-hidden="true"></span>
        <div class="rangee" style="margin-bottom:8px"><button type="button" class="btn sec petit" data-all="a">Tout prendre de A</button><button type="button" class="btn sec petit" data-all="b">Tout prendre de B</button></div>`
        : `<p class="muted italique" style="margin-top:24px">Aucun conflit : les deux fiches se recoupent sans écart.</p>`}
      ${sect("Fiche", fieldsHtml)}${sect("Ingrédients", ingHtml + soloHtml)}${sect("Préparation", stepHtml)}
      <div class="rangee" style="margin-top:32px"><button class="btn" type="submit" id="go">Fusionner les deux fiches</button><a class="btn sec" href="${back}">Annuler</a></div>
      <p class="msg" id="msg" role="status" aria-live="polite"></p>
    </form>`;
  const f = $("#form"), out = $("#msg");

  f.addEventListener("click", (e) => {
    const b = e.target.closest("[data-all]");
    if (!b) return;
    const side = b.dataset.all;
    $$(".choix", f).forEach((fs) => {
      const radios = $$("input[type=radio]", fs), pick = (v) => { const x = radios.find((r) => r.value === v); if (x) x.checked = true; };
      if (fs.dataset.side) return pick(fs.dataset.side === side ? "keep" : "ecarte");
      if (fs.dataset.vide === side) return; // ce côté n'a pas d'étape : on garde le choix actuel
      pick(side);
    });
  });

  // ---- écriture
  const checked = (name) => { const x = f.querySelector(`input[name="${CSS.escape(name)}"]:checked`); return x ? x.value : null; };
  function build() {
    const fields = {};
    FIELDS.forEach(([k, , , est]) => {
      const side = fieldAuto[k] || checked("f:" + k) || "a";
      if (!(k in fieldAuto) && !fieldConf.some((c) => c.k === k)) return;
      const src = side === "b" ? rb : ra;
      fields[k] = src[k];
      if (est) fields[est] = !!src[est];
    });
    const solo = new Map(ingSolo.map((c) => [c.id, c]));
    const keepSolo = (id) => checked("s:" + id) !== "ecarte";
    const chosen = [];
    oa.forEach(({ l, id }) => {
      if (solo.has(id)) { if (keepSolo(id)) chosen.push(l); return; }
      const c = ingConf.find((x) => x.id === id);
      chosen.push(c && checked("i:" + id) === "b" ? c.b : l);
    });
    ob.forEach(({ l, id }) => { if (solo.has(id) && keepSolo(id)) chosen.push(l); });
    const lines = chosen.map((l, i) => ({ recipe_id: ra.id, position: i, group_label: l.group_label, catalog_id: l.catalog_id, label_original: l.label_original, quantity: l.quantity, unit: l.unit, precision: l.precision, optional: l.optional }));
    const conf = new Map(stepConf.map((c) => [c.i, c]));
    const steps = [];
    for (let i = 0; i < Math.max(A.steps.length, B.steps.length); i++) {
      const c = conf.get(i);
      const s = c ? (checked("e:" + i) === "b" ? c.b : c.a) : A.steps[i];
      if (s) steps.push({ recipe_id: ra.id, position: steps.length, text: s.text, text_original: s.text_original, timer_seconds: s.timer_seconds });
    }
    return { fields, lines, steps };
  }
  const old = { lineIds: A.lines.map((x) => x.id), stepIds: A.steps.map((x) => x.id) };
  async function swap(key, table, newIds) {
    const oldIds = old[key];
    old[key] = oldIds.concat(newIds);
    if (oldIds.length) { const { error } = await sb.from(table).delete().in("id", oldIds); if (error) throw error; }
    old[key] = newIds;
  }
  let done = null; // étapes déjà écrites en cas de nouvel essai
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { fields, lines, steps } = build();
    if (!confirm(`Fusionner ?\n\n« ${ra.title} » sera mise à jour avec vos choix et « ${rb.title} » sera archivée (rangée comme version). Les photos et les notes de chaque fiche restent sur leur fiche.`)) return;
    const btn = $("#go"); btn.disabled = true; setMsg(out, "Fusion en cours…");
    try {
      const group = ra.version_group || rb.version_group || AR.uuid();
      if (!done) done = {};
      if (!done.lines) {
        if (lines.length) { const ins = await sb.from("recipe_ingredient_lines").insert(lines).select("id"); if (ins.error) throw ins.error; await swap("lineIds", "recipe_ingredient_lines", ins.data.map((x) => x.id)); }
        else await swap("lineIds", "recipe_ingredient_lines", []);
        done.lines = true;
      }
      if (!done.steps) {
        if (steps.length) { const ins = await sb.from("recipe_steps").insert(steps).select("id"); if (ins.error) throw ins.error; await swap("stepIds", "recipe_steps", ins.data.map((x) => x.id)); }
        else await swap("stepIds", "recipe_steps", []);
        done.steps = true;
      }
      const ua = await sb.from("recipes").update({ ...fields, version_group: group }).eq("id", ra.id);
      if (ua.error) throw ua.error;
      if (rb.version_group && rb.version_group !== group) {
        const m = await sb.from("recipes").update({ version_group: group }).eq("version_group", rb.version_group);
        if (m.error) throw m.error;
      }
      const ub = await sb.from("recipes").update({ archived_at: new Date().toISOString(), version_group: group }).eq("id", rb.id);
      if (ub.error) throw ub.error;
      toast("Fiches fusionnées. L'ancienne version est archivée.");
      location.assign(back);
    } catch (err) {
      btn.disabled = false;
      setMsg(out, errMsg(err, "La fusion a été interrompue. Vérifiez la fiche A puis réessayez."), "erreur");
    }
  });
})();
