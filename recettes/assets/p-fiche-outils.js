// ARÔMES V&N · fiche : outils des phases 5 et 6 (courses, planning, lien public, transmettre, accord Vinicellar).
// Chargé avant p-fiche.js, qui appelle ARFicheOutils.mount(api) après chaque affichage de la fiche.
(function () {
  const AR = window.AR, { sb, $, $$, esc, errMsg, toast } = AR;
  const S = { open: null, link: undefined, linkMsg: "", courses: "", plan: "", transmit: "", accord: null, busy: false };
  let api = null;

  const PANELS = [["courses", "Ajouter aux courses", "editor"], ["plan", "Planifier", "editor"], ["share", "Partager", "editor"], ["transmit", "Transmettre", "member"], ["accord", "Accord Vinicellar", "all"]];
  const targets = () => api.ctx.books.filter((b) => b.id !== api.r().book_id && b.role !== "reader");

  function visible() {
    if (api.r().deleted_at) return [];
    return PANELS.filter(([, , need]) => (need === "editor" ? api.editor : need === "member" ? api.member : true));
  }

  // ---- panneaux
  function panelHtml(k) {
    const r = api.r();
    if (k === "courses") {
      const w = api.wanted();
      return `<p>${w != null ? `Les ingrédients seront ajoutés pour <strong>${w} convive${w > 1 ? "s" : ""}</strong> (les portions affichées).` : "Les ingrédients seront ajoutés pour les portions de la recette (nombre non indiqué)."} Les quantités identiques sont additionnées ; sel, poivre et eau sont ignorés.</p>
        <button type="button" class="btn" data-o="courses-go">Ajouter à la liste de courses</button><p class="msg ${S.courses.startsWith("!") ? "erreur" : "ok"}" role="status" aria-live="polite">${S.courses.startsWith("!") ? esc(S.courses.slice(1)) : S.courses}</p>`;
    }
    if (k === "plan") {
      const today = AR.todayIso();
      const opts = Array.from({ length: 28 }, (_, i) => AR.addDays(today, i)).map((d, i) => `<option value="${d}"${i === 1 ? " selected" : ""}>${esc(AR.dayLabel(d))}${i === 0 ? " (aujourd'hui)" : ""}</option>`).join("");
      return `<div class="champs"><label for="fo-day">Jour<select id="fo-day">${opts}</select></label>
        <label for="fo-slot">Repas<select id="fo-slot"><option value="midi">Midi</option><option value="soir" selected>Soir</option></select></label>
        <div><button type="button" class="btn" data-o="plan-go">Planifier cette recette</button></div></div>
        <p class="msg ${S.plan.startsWith("!") ? "erreur" : "ok"}" role="status" aria-live="polite">${S.plan.startsWith("!") ? esc(S.plan.slice(1)) : S.plan}</p>`;
    }
    if (k === "share") {
      if (S.link === undefined) return `<p class="chargement">Chargement…</p>`;
      if (S.link === false) return `<p class="msg erreur" role="alert">${esc(S.linkMsg)}</p>`;
      if (!S.link) return `<p>Un lien public permet de lire cette recette sans compte. Vous pourrez le révoquer à tout moment.</p><p class="aide">Toute personne ayant le lien peut lire cette recette. Les notes, les cuissons et les membres du carnet ne sont jamais montrés.</p>
        <button type="button" class="btn" data-o="share-create">Créer le lien public</button><p class="msg erreur" role="alert">${esc(S.linkMsg)}</p>`;
      const url = `${location.origin}/recettes/partage.html?t=${encodeURIComponent(S.link.token)}`;
      return `<p class="libelle or">Lien public actif</p><label for="fo-url" class="sr-only">Adresse du lien public</label><input id="fo-url" type="text" readonly value="${esc(url)}" class="fo-url">
        <p class="aide"><strong>Toute personne ayant le lien peut lire cette recette.</strong> Créé le ${esc(AR.fmtDate(S.link.created_at))}.</p>
        <div class="rangee"><button type="button" class="btn" data-o="share-copy">Copier le lien</button><button type="button" class="btn danger" data-o="share-revoke">Révoquer le lien</button></div><p class="msg ${S.linkMsg.startsWith("!") ? "erreur" : "ok"}" role="status" aria-live="polite">${esc(S.linkMsg.replace(/^!/, ""))}</p>`;
    }
    if (k === "transmit") {
      const t = targets();
      if (!t.length) return `<p class="muted italique">Vous n'avez pas d'autre carnet dans lequel vous pouvez écrire. Une copie ne peut être transmise que vers un carnet où vous êtes propriétaire ou membre.</p>`;
      return `<p>Une copie de la recette (ingrédients, étapes, photos) est créée dans l'autre carnet. Les notes et le journal des cuissons ne sont pas copiés.</p>
        <div class="champs"><label for="fo-target">Transmettre vers<select id="fo-target">${t.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("")}</select></label>
        <div><button type="button" class="btn" data-o="transmit-go">Transmettre une copie</button></div></div><p class="msg ${S.transmit.startsWith("!") ? "erreur" : "ok"}" role="status" aria-live="polite">${S.transmit.startsWith("!") ? esc(S.transmit.slice(1)) : S.transmit}</p>`;
    }
    if (k === "accord") {
      const a = S.accord;
      return `<p>Les bouteilles de votre cave qui s'accordent avec « ${esc(r.title)} », proposées par le sommelier de Vinicellar.</p>
        <button type="button" class="btn" data-o="accord-go"${S.busy ? " disabled" : ""}>${a ? "Relancer" : "Chercher dans ma cave"}</button>
        <div class="fo-accord" aria-live="polite">${S.busy ? `<p class="chargement">Le sommelier descend à la cave…</p>` : a ? accordHtml(a) : ""}</div>`;
    }
    return "";
  }

  const STATUT = { "à l'apogée": "À l'apogée", prête: "Prête à boire", "à boire vite": "À boire vite", "trop jeune": "Trop jeune", "fenêtre dépassée": "Fenêtre dépassée", "garde inconnue": "Garde inconnue", spiritueux: "Spiritueux" };
  function accordHtml(a) {
    if (a.error) return `<p class="msg erreur" role="alert">${esc(a.error)}</p>`;
    if (a.nocave) return `<p class="muted italique">Vous n'avez pas de bouteille en cave pour le moment : aucun accord ne peut être proposé.</p>${a.conseil ? `<p class="fo-conseil"><span class="libelle or">Conseil général</span><br>${esc(a.conseil)}</p>` : ""}`;
    if (!a.cards.length) return `<p class="muted italique">Rien de convaincant dans votre cave pour cette recette.</p>${a.conseil ? `<p class="fo-conseil"><span class="libelle or">Conseil général</span><br>${esc(a.conseil)}</p>` : ""}`;
    return `${a.intro ? `<p class="italique">${esc(a.intro)}</p>` : ""}<ul class="fo-bouteilles">${a.cards.map((c) => `<li class="fo-bt">
      <p class="fo-bt-nom">${esc(c.name)}${c.vintage ? ` <span class="muted">${esc(c.vintage)}</span>` : ""}</p>
      ${c.sub ? `<p class="muted fo-bt-sub">${esc(c.sub)}</p>` : ""}
      <p class="fo-bt-tags">${c.status ? `<span class="libelle or">${esc(STATUT[c.status] || c.status)}</span>` : ""}${c.price != null ? `<span class="libelle"> · ${esc(c.price)} ${esc(c.currency || "CHF")}</span>` : ""}</p>
      ${c.why ? `<p>${esc(c.why)}</p>` : ""}${c.serve ? `<p class="muted italique">${esc(c.serve)}</p>` : ""}
      ${c.id ? `<a class="btn sec petit" href="/app/fiche.html?id=${encodeURIComponent(c.id)}" target="_blank" rel="noopener">Ouvrir dans Vinicellar</a>` : ""}</li>`).join("")}</ul>
      ${a.conseil ? `<p class="fo-conseil"><span class="libelle or">Conseil général</span><br>${esc(a.conseil)}</p>` : ""}`;
  }

  function render() {
    const z = $("#outils-zone");
    if (!z || !api) return;
    const vis = visible();
    if (!vis.length) { z.innerHTML = ""; return; }
    z.innerHTML = `<div class="fo-barre" role="group" aria-label="Autres actions">${vis.map(([k, l]) => `<button type="button" class="btn sec petit fo-b" data-o="open" data-k="${k}" aria-expanded="${S.open === k}" aria-controls="fo-panneau">${esc(l)}</button>`).join("")}</div>
      ${S.open && vis.some((v) => v[0] === S.open) ? `<section class="fo-panneau" id="fo-panneau" aria-label="${esc(vis.find((v) => v[0] === S.open)[1])}">${panelHtml(S.open)}</section>` : ""}`;
  }
  function refresh(focus) { render(); if (focus) { const f = $(focus); if (f) f.focus(); } }

  // ---- lien public
  async function loadLink() {
    S.link = undefined; S.linkMsg = ""; refresh();
    const { data, error } = await sb.from("recipe_public_links").select("id, token, created_at").eq("recipe_id", api.r().id).is("revoked_at", null).maybeSingle();
    if (error) { S.link = false; S.linkMsg = errMsg(error, "Impossible de lire l'état du partage."); } else S.link = data || null;
    if (S.open === "share") refresh();
  }
  async function createLink(btn) {
    btn.disabled = true; S.linkMsg = "";
    const { data, error } = await sb.from("recipe_public_links").insert({ recipe_id: api.r().id }).select("id, token, created_at").single();
    if (error) {
      if (error.code === "23505") return void loadLink();
      S.linkMsg = /42501|row-level|permission/i.test(String(error.code) + error.message) ? "Seuls les propriétaires et membres peuvent partager." : errMsg(error, "Le lien n'a pas pu être créé.");
      return refresh("[data-o=share-create]");
    }
    S.link = data; S.linkMsg = "Lien créé."; refresh("[data-o=share-copy]");
  }
  async function copyLink() {
    const inp = $("#fo-url"); if (!inp) return;
    let ok = false;
    try { await navigator.clipboard.writeText(inp.value); ok = true; } catch { /* repli ci-dessous */ }
    if (!ok) { inp.focus(); inp.select(); try { ok = document.execCommand("copy"); } catch { ok = false; } }
    S.linkMsg = ok ? "Lien copié dans le presse-papiers." : "!Copie impossible : sélectionnez le lien et copiez-le à la main.";
    refresh("[data-o=share-copy]");
  }
  async function revokeLink(btn) {
    if (!confirm("Révoquer ce lien ? Les personnes qui l'ont reçu ne pourront plus lire la recette.")) return;
    btn.disabled = true;
    const { error } = await sb.from("recipe_public_links").update({ revoked_at: new Date().toISOString() }).eq("id", S.link.id);
    if (error) { S.linkMsg = "!" + errMsg(error, "Le lien n'a pas pu être révoqué."); return refresh("[data-o=share-revoke]"); }
    S.link = null; S.linkMsg = ""; toast("Lien révoqué."); refresh("[data-o=share-create]");
  }

  // ---- courses, planning
  async function addCourses(btn) {
    const r = api.r(), w = api.wanted();
    btn.disabled = true;
    const { data, error } = await sb.rpc("recipe_shopping_add_recipe", { p_book: r.book_id, p_recipe: r.id, p_servings: w });
    if (error) { S.courses = "!" + errMsg(error, "Les ingrédients n'ont pas pu être ajoutés."); return refresh("[data-o=courses-go]"); }
    AR.setBookPref(r.book_id);
    const d = data || {};
    S.courses = `${d.added || 0} article${d.added > 1 ? "s" : ""} ajouté${d.added > 1 ? "s" : ""}, ${d.merged || 0} fusionné${d.merged > 1 ? "s" : ""}${d.skipped ? `, ${d.skipped} ignoré${d.skipped > 1 ? "s" : ""}` : ""}. <a href="/recettes/courses.html">Voir la liste de courses</a>`;
    refresh("[data-o=courses-go]");
  }
  async function planify(btn) {
    const r = api.r(), day = $("#fo-day").value, slot = $("#fo-slot").value, w = api.wanted();
    btn.disabled = true;
    try {
      const ex = await sb.from("recipe_meal_plan").select("id,recipe_id,state,servings").eq("book_id", r.book_id).eq("day", day).eq("slot", slot).maybeSingle();
      if (ex.error) throw ex.error;
      if (ex.data && ex.data.recipe_id && ex.data.recipe_id !== r.id && !confirm("Ce repas a déjà une recette. La remplacer ?")) { btn.disabled = false; return; }
      const patch = { recipe_id: r.id, state: ex.data && ex.data.state === "invites" ? "invites" : "prevu", servings: w || (ex.data && ex.data.servings) || r.servings || null };
      const res = ex.data ? await sb.from("recipe_meal_plan").update(patch).eq("id", ex.data.id) : await sb.from("recipe_meal_plan").insert({ id: AR.uuid(), book_id: r.book_id, day, slot, created_by: api.ctx.user.id, ...patch });
      if (res.error) throw res.error;
      AR.setBookPref(r.book_id);
      S.plan = `Planifiée : ${esc(AR.dayLabel(day))}, ${slot === "midi" ? "midi" : "soir"}. <a href="/recettes/semaine.html">Voir la semaine</a>`;
    } catch (e) { S.plan = "!" + errMsg(e, "La recette n'a pas pu être planifiée."); }
    refresh("[data-o=plan-go]");
  }

  // ---- transmettre
  async function transmit(btn) {
    const target = $("#fo-target").value, r = api.r();
    const nom = (api.ctx.books.find((b) => b.id === target) || {}).name || "l'autre carnet";
    if (!confirm(`Transmettre une copie de « ${r.title} » vers « ${nom} » ?`)) return;
    btn.disabled = true; S.transmit = "";
    try {
      const { data, error } = await sb.functions.invoke("recipe-transmit", { body: { recipe_id: r.id, target_book_id: target } });
      if (error) throw error;
      S.transmit = `Copie créée dans « ${esc(nom)} ». <a href="/recettes/fiche.html?id=${encodeURIComponent(data.recipe_id)}">Ouvrir la copie</a>${data.photos_skipped ? ` (${data.photos_skipped} photo${data.photos_skipped > 1 ? "s" : ""} non copiée${data.photos_skipped > 1 ? "s" : ""})` : ""}`;
    } catch (e) { S.transmit = "!" + await AR.fnMessage(e, "La recette n'a pas pu être transmise. Réessayez dans un instant."); }
    refresh("[data-o=transmit-go]");
  }

  // ---- accord Vinicellar : fonction « sommelier » du site (corps { menu }), noms des bouteilles lus dans la cave de l'utilisateur
  const SANS = /^(sel|fleur de sel|poivre|eau|huile|vinaigre|sucre|farine)\b/;
  function menuText() {
    const r = api.r();
    const main = api.lines().filter((l) => !l.optional && l.label_original && !SANS.test(AR.norm(l.label_original))).slice(0, 6).map((l) => l.label_original.trim());
    return `${r.title}${main.length ? `. Ingrédients principaux : ${main.join(", ")}.` : ""}`.slice(0, 1900);
  }
  async function accord() {
    S.busy = true; S.accord = null; refresh();
    let out;
    try {
      const { data, error } = await sb.functions.invoke("sommelier", { body: { menu: menuText() } });
      if (error) {
        const st = error.context && error.context.status;
        let m = "";
        try { const j = await error.context.json(); m = (j && j.message) || ""; } catch { /* corps vide */ }
        out = { error: m ? m : st === 401 ? "Connectez-vous à Vinicellar pour consulter votre cave." : "Le sommelier ne répond pas pour le moment. Réessayez dans un instant." };
      } else {
        const picks = (data.courses && data.courses.length ? data.courses.flatMap((c) => c.picks || []) : data.picks) || [];
        const seen = new Set(), uniq = picks.filter((p) => p && p.item_id && !seen.has(p.item_id) && seen.add(p.item_id)).slice(0, 8);
        const conseil = data.missing || null;
        if (!uniq.length) out = { cards: [], nocave: /aucune bouteille/i.test(data.message || ""), conseil, intro: data.intro || null };
        else {
          let names = new Map();
          const q = await sb.from("items").select("id,name,producer,vintage,appellation,region").in("id", uniq.map((p) => p.item_id));
          if (!q.error) names = new Map((q.data || []).map((x) => [x.id, x]));
          out = { intro: data.intro || null, conseil, cards: uniq.map((p) => { const it = names.get(p.item_id) || {}; return { id: p.item_id, name: it.name || "Bouteille de votre cave", vintage: it.vintage || null, sub: [it.producer, it.appellation || it.region].filter(Boolean).join(" · "), status: p.status, price: p.price, currency: p.currency, why: p.why, serve: p.serve }; }) };
        }
      }
    } catch (e) { out = { error: await AR.fnMessage(e, "Le sommelier ne répond pas pour le moment. Réessayez dans un instant.") }; }
    S.busy = false; S.accord = out; refresh("[data-o=accord-go]");
  }

  document.addEventListener("click", (e) => {
    if (!api) return;
    const b = e.target.closest("[data-o]"); if (!b || !b.closest("#outils-zone")) return;
    const o = b.dataset.o;
    if (o === "open") {
      S.open = S.open === b.dataset.k ? null : b.dataset.k;
      refresh(`[data-k="${b.dataset.k}"]`);
      if (S.open === "share") loadLink();
      return;
    }
    if (o === "courses-go") return void addCourses(b);
    if (o === "plan-go") return void planify(b);
    if (o === "share-create") return void createLink(b);
    if (o === "share-copy") return void copyLink();
    if (o === "share-revoke") return void revokeLink(b);
    if (o === "transmit-go") return void transmit(b);
    if (o === "accord-go") return void accord();
  });

  window.ARFicheOutils = {
    // api : { ctx, r(), lines(), wanted(), editor, member }
    mount(a) { api = a; render(); }
  };
})();
