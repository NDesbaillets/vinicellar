// ARÔMES V&N · fiche d'un invité : profil, réceptions, plats déjà servis. Contrat : docs/recettes/07-invites-contrat.md.
// Confidentialité : allergies, régime et remarques sur un tiers ; visibles des membres du carnet (lecteurs compris), modifiables par les éditeurs.
(async function () {
  const AR = window.AR, { sb, $, $$, esc, errMsg, toast, setMsg } = AR;
  const ctx = await AR.boot("invites");
  if (!ctx) return;
  const main = $("#main"), zone = $("#zone");
  const qs = new URLSearchParams(location.search);
  const gid = qs.get("id"), creating = !gid && qs.get("nouveau") === "1";
  const fail = (m) => { main.setAttribute("aria-busy", "false"); zone.innerHTML = `<div class="vide-etat"><p role="alert">${esc(m)}</p><a class="btn sec petit" href="/recettes/invites.html">Retour aux invités</a></div>`; };

  let g = null, bookId = qs.get("book");
  if (gid) {
    try {
      const r = await sb.from("recipe_guests").select("*").eq("id", gid).maybeSingle();
      if (r.error) throw r.error;
      g = r.data;
    } catch (e) { return fail(errMsg(e, "Impossible de charger cet invité.")); }
    if (!g) return fail("Invité introuvable, ou vous n'avez pas accès à son carnet.");
    bookId = g.book_id;
  }
  const book = ctx.books.find((b) => b.id === bookId);
  if (!book) return fail(creating || gid ? "Carnet introuvable, ou vous n'y avez pas accès." : "Aucun invité à afficher.");
  if (!gid && !creating) return fail("Aucun invité à afficher.");
  const editor = book.role !== "reader";
  if (creating && !editor) return fail("Votre rôle de lecteur ne permet pas d'ajouter un invité.");
  main.setAttribute("aria-busy", "false");
  $("#page-titre").textContent = creating ? "Nouvel invité" : "Invité";
  if (g) document.title = `${g.name} · Invités · ARÔMES V&N`;

  const msgOf = (e, fb) => (/compte li/i.test(String((e && e.message) || "")) ? "Le compte lié doit être membre du carnet." : errMsg(e, fb));
  let cat = [];
  try { cat = await AR.loadCatalog(); } catch (e) { console.error(e); }
  const nameOf = (id) => { const c = cat.find((x) => x.id === id); return c ? c.name : "Ingrédient inconnu"; };
  let members = [];
  try { const r = await sb.rpc("book_people", { b: bookId }); if (!r.error) members = r.data || []; else console.error(r.error); } catch (e) { console.error(e); }
  const memberName = (id) => { const m = members.find((x) => x.user_id === id); return m ? m.full_name || m.email || "Membre" : "Compte du carnet"; };

  const cur = g || { name: "", household: "", allergens: [], regime: null, aversions: [], aversions_texte: [], likes: "", notes: "", linked_user_id: null, archived_at: null };
  const st = { allergens: new Set(cur.allergens || []), aversions: [...(cur.aversions || [])], texte: [...(cur.aversions_texte || [])] };

  // ---- lecture seule
  function lectureHtml() {
    const liste = (a) => (a.length ? esc(a.join(", ")) : `<span class="muted italique">Aucune</span>`);
    return `<dl class="iv-fiche">
      <div><dt class="libelle">Nom</dt><dd class="iv-nom-g">${esc(cur.name)}</dd></div>
      ${cur.household ? `<div><dt class="libelle">Foyer</dt><dd>${esc(cur.household)}</dd></div>` : ""}
      <div><dt class="libelle">Allergies</dt><dd>${liste([...st.allergens].map((k) => AR.ALLERGENES[k] || k))}</dd></div>
      <div><dt class="libelle">Régime</dt><dd>${cur.regime ? esc(AR.REGIMES[cur.regime] || cur.regime) : `<span class="muted italique">Aucun régime particulier</span>`}</dd></div>
      <div><dt class="libelle">Aversions</dt><dd>${liste([...st.aversions.map(nameOf), ...st.texte])}</dd></div>
      ${cur.likes ? `<div><dt class="libelle">Ce qu'il ou elle aime</dt><dd class="iv-texte">${esc(cur.likes)}</dd></div>` : ""}
      ${cur.notes ? `<div><dt class="libelle">Remarques</dt><dd class="iv-texte">${esc(cur.notes)}</dd></div>` : ""}
      ${cur.linked_user_id ? `<div><dt class="libelle">Compte lié</dt><dd>${esc(memberName(cur.linked_user_id))}</dd></div>` : ""}</dl>`;
  }
  // ---- formulaire
  function formHtml() {
    return `<form id="iv-form" class="champs" novalidate>
      <label for="iv-name">Nom<input id="iv-name" name="name" maxlength="80" required autocomplete="off" value="${esc(cur.name)}"></label>
      <label for="iv-household">Foyer (facultatif)<input id="iv-household" name="household" maxlength="80" autocomplete="off" placeholder="Les Dupont" value="${esc(cur.household || "")}"></label>
      <fieldset class="pf-groupe"><legend class="libelle or">Allergies</legend>
        <p class="aide">Toute recette contenant un de ces allergènes est écartée des suggestions pour cet invité.</p>
        <div class="pf-allergenes">${Object.entries(AR.ALLERGENES).map(([k, l]) => `<label class="case pf-case"><input type="checkbox" name="al" value="${k}"${st.allergens.has(k) ? " checked" : ""}> ${esc(l)}</label>`).join("")}</div></fieldset>
      <fieldset class="pf-groupe"><legend class="libelle or">Régime</legend>
        <label for="iv-regime" class="sr-only">Régime</label>
        <select id="iv-regime" name="regime"><option value="">Aucun régime particulier</option>${Object.entries(AR.REGIMES).map(([k, l]) => `<option value="${k}"${cur.regime === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></fieldset>
      <fieldset class="pf-groupe"><legend class="libelle or">Aversions</legend>
        <p class="aide">Ce qu'il ou elle ne mange pas, par goût. Choisissez dans le catalogue, ou écrivez un mot libre (3 lettres au moins).</p>
        <div id="iv-cat"></div>
        <ul class="pf-puces" id="iv-av" aria-label="Aversions choisies dans le catalogue"></ul>
        <div class="pf-libre"><label for="iv-txt">Autre aversion (texte libre)</label>
          <div class="po-saisie"><input id="iv-txt" maxlength="60" autocomplete="off" enterkeyhint="done"><button type="button" class="btn sec" id="iv-txt-add">Ajouter</button></div></div>
        <ul class="pf-puces" id="iv-tx" aria-label="Aversions en texte libre"></ul></fieldset>
      <label for="iv-likes">Ce qu'il ou elle aime<textarea id="iv-likes" name="likes" maxlength="2000" rows="3">${esc(cur.likes || "")}</textarea></label>
      <label for="iv-notes">Remarques<textarea id="iv-notes" name="notes" maxlength="4000" rows="3">${esc(cur.notes || "")}</textarea></label>
      <label for="iv-linked">Compte lié (facultatif)<select id="iv-linked" name="linked"><option value="">Aucun compte</option>${members.map((m) => `<option value="${esc(m.user_id)}"${cur.linked_user_id === m.user_id ? " selected" : ""}>${esc(m.full_name || m.email || "Membre")}</option>`).join("")}${cur.linked_user_id && !members.some((m) => m.user_id === cur.linked_user_id) ? `<option value="${esc(cur.linked_user_id)}" selected>Compte du carnet</option>` : ""}</select>
        <span class="aide" style="display:block;text-transform:none;letter-spacing:0;font-family:var(--texte);font-weight:400">Ses allergies et préférences de profil s'ajoutent à cette fiche.</span></label>
      <div><button type="submit" class="btn">${creating ? "Ajouter l'invité" : "Enregistrer"}</button></div>
      <p class="msg" id="iv-msg" role="status" aria-live="polite"></p></form>`;
  }

  zone.innerHTML = `<p><a class="btn lien" href="/recettes/invites.html">← Tous les invités</a></p>
    ${cur.archived_at ? `<p class="iv-bandeau" role="status">Invité archivé : absent des listes et du « Pour qui ? », conservé dans l'historique.</p>` : ""}
    <div id="iv-profil">${editor ? formHtml() : lectureHtml()}</div>
    <div id="iv-actions"></div>
    ${creating ? "" : `<div id="iv-suggere"></div>
    <h2 class="section">Réceptions</h2><span class="filet" aria-hidden="true"></span><div id="iv-recs"><p class="chargement">Chargement…</p></div>
    <h2 class="section">Plats déjà servis</h2><span class="filet" aria-hidden="true"></span><div id="iv-servis"><p class="chargement">Chargement…</p></div>`}`;

  // ---- aversions (éditeurs)
  if (editor) {
    const renderPuces = () => {
      $("#iv-av").innerHTML = st.aversions.map((id) => `<li class="pf-puce"><span>${esc(nameOf(id))}</span><button type="button" class="pf-x" data-av="${esc(id)}" aria-label="Retirer ${esc(nameOf(id))}">×</button></li>`).join("");
      $("#iv-tx").innerHTML = st.texte.map((t, i) => `<li class="pf-puce"><span>${esc(t)}</span><button type="button" class="pf-x" data-tx="${i}" aria-label="Retirer ${esc(t)}">×</button></li>`).join("");
    };
    AR.catalogPicker($("#iv-cat"), { label: "Chercher dans le catalogue", placeholder: "Coriandre, anchois…", id: "iv-ac", exclude: () => new Set(st.aversions),
      onPick: (c) => { if (!st.aversions.includes(c.id)) st.aversions.push(c.id); renderPuces(); } });
    const addTexte = () => {
      const inp = $("#iv-txt"), v = inp.value.replace(/\s+/g, " ").trim();
      if (v.length < 3) return setMsg($("#iv-msg"), "Une aversion en texte libre compte 3 lettres au moins.", "erreur");
      if (!st.texte.some((t) => AR.norm(t) === AR.norm(v))) st.texte.push(v);
      inp.value = ""; setMsg($("#iv-msg"), ""); renderPuces(); inp.focus();
    };
    $("#iv-txt-add").addEventListener("click", addTexte);
    $("#iv-txt").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addTexte(); } });
    $("#iv-profil").addEventListener("click", (e) => {
      const a = e.target.closest("[data-av]"); if (a) { st.aversions = st.aversions.filter((x) => x !== a.dataset.av); renderPuces(); return; }
      const t = e.target.closest("[data-tx]"); if (t) { st.texte.splice(+t.dataset.tx, 1); renderPuces(); }
    });
    renderPuces();

    $("#iv-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target, out = $("#iv-msg"), btn = f.querySelector("button[type=submit]");
      const name = $("#iv-name").value.replace(/\s+/g, " ").trim();
      if (!name) return setMsg(out, "Le nom est obligatoire.", "erreur");
      const row = { name, household: $("#iv-household").value.replace(/\s+/g, " ").trim() || null, allergens: $$("input[name=al]:checked", f).map((x) => x.value), regime: $("#iv-regime").value || null,
        aversions: st.aversions, aversions_texte: st.texte, likes: $("#iv-likes").value.trim() || null, notes: $("#iv-notes").value.trim() || null, linked_user_id: $("#iv-linked").value || null };
      btn.disabled = true; setMsg(out, "Enregistrement…");
      if (creating) {
        const id = AR.uuid();
        const { error } = await sb.from("recipe_guests").insert({ id, book_id: bookId, created_by: ctx.user.id, ...row });
        btn.disabled = false;
        if (error) return setMsg(out, msgOf(error, "L'invité n'a pas pu être ajouté."), "erreur");
        location.replace(`/recettes/invite.html?id=${encodeURIComponent(id)}`);
        return;
      }
      const { data, error } = await sb.from("recipe_guests").update(row).eq("id", g.id).select("*").single();
      btn.disabled = false;
      if (error) return setMsg(out, msgOf(error, "La fiche n'a pas pu être enregistrée."), "erreur");
      Object.assign(g, data || row);
      document.title = `${g.name} · Invités · ARÔMES V&N`;
      setMsg(out, "Fiche enregistrée.", "ok");
      renderSuggere();
    });
  }
  if (creating) return;

  // ---- actions : archiver, supprimer
  function renderActions(confirmer) {
    const box = $("#iv-actions");
    if (!editor) { box.innerHTML = ""; return; }
    if (confirmer) {
      box.innerHTML = `<div class="iv-confirm" role="alertdialog" aria-labelledby="iv-c-t"><p id="iv-c-t"><strong>Supprimer définitivement « ${esc(g.name)} » ?</strong></p>
        <p>Son historique sera effacé : elle ou il sera retiré de toutes ses réceptions, et les mentions « Cuisiné pour ${esc(AR.prenom(g.name))} » disparaîtront des fiches de recettes. Cette action est irréversible. Pour conserver l'historique, archivez plutôt cet invité.</p>
        <div class="rangee"><button type="button" class="btn danger" data-act="del-ok">Supprimer définitivement</button><button type="button" class="btn sec" data-act="del-no">Annuler</button></div></div>`;
      $("[data-act=del-no]", box).focus();
      return;
    }
    box.innerHTML = `<div class="rangee iv-actions"><button type="button" class="btn sec" data-act="archive">${g.archived_at ? "Désarchiver" : "Archiver"}</button><button type="button" class="btn danger" data-act="del">Supprimer…</button></div><p class="msg" id="iv-amsg" role="status" aria-live="polite"></p>`;
  }
  renderActions(false);
  $("#iv-actions").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const a = b.dataset.act;
    if (a === "del") return renderActions(true);
    if (a === "del-no") { renderActions(false); const d = $("[data-act=del]"); if (d) d.focus(); return; }
    b.disabled = true;
    if (a === "archive") {
      const archived_at = g.archived_at ? null : new Date().toISOString();
      const { error } = await sb.from("recipe_guests").update({ archived_at }).eq("id", g.id);
      if (error) { b.disabled = false; return setMsg($("#iv-amsg"), errMsg(error, "Impossible de modifier l'archivage."), "erreur"); }
      location.reload();
    } else if (a === "del-ok") {
      const { error } = await sb.from("recipe_guests").delete().eq("id", g.id);
      if (error) { b.disabled = false; renderActions(false); return setMsg($("#iv-amsg"), errMsg(error, "L'invité n'a pas pu être supprimé."), "erreur"); }
      location.replace("/recettes/invites.html");
    }
  });

  // ---- « Suggérer un menu pour … »
  function renderSuggere() {
    const box = $("#iv-suggere");
    if (g.archived_at) { box.innerHTML = ""; return; }
    box.innerHTML = `<p><a class="btn" id="iv-sugg" href="/recettes/saisons.html?book=${encodeURIComponent(bookId)}&amp;invites=${encodeURIComponent(g.id)}">Suggérer un menu pour ${esc(AR.prenom(g.name))}</a></p>`;
  }
  renderSuggere();

  // ---- réceptions
  (async function () {
    const box = $("#iv-recs");
    try {
      const l = await sb.from("recipe_reception_guests").select("reception_id").eq("guest_id", g.id);
      if (l.error) throw l.error;
      const ids = (l.data || []).map((x) => x.reception_id);
      if (!ids.length) { box.innerHTML = `<p class="muted italique">Aucune réception avec cet invité pour l'instant.</p>`; return; }
      const r = await sb.from("recipe_receptions").select("id,day,slot,title,recipe_reception_guests(guest_id,recipe_guests(id,name)),recipe_reception_dishes(id,recipe_id,label,course,position)").in("id", ids).order("day", { ascending: false });
      if (r.error) throw r.error;
      box.innerHTML = `<ul class="iv-hist">${(r.data || []).map((x) => {
        const autres = (x.recipe_reception_guests || []).filter((y) => y.guest_id !== g.id).map((y) => y.recipe_guests && y.recipe_guests.name).filter(Boolean);
        const plats = (x.recipe_reception_dishes || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
        const menu = AR.RUBRIQUES.map(([k, l]) => { const p = plats.filter((d) => d.course === k); return p.length ? `<li><span class="libelle">${esc(l)}</span> ${p.map((d) => d.recipe_id ? `<a href="/recettes/fiche.html?id=${encodeURIComponent(d.recipe_id)}">${esc(d.label)}</a>` : esc(d.label)).join(", ")}</li>` : ""; }).join("");
        return `<li class="iv-h-item"><div class="iv-h-tete"><span class="iv-date">${esc(AR.fmtDay(x.day))}${x.slot ? ` · ${esc(AR.CRENEAUX[x.slot] || "")}` : ""}</span><a class="iv-h-titre" href="/recettes/reception.html?id=${encodeURIComponent(x.id)}">${esc(x.title || "Réception")}</a></div>
          ${menu ? `<ul class="iv-menu">${menu}</ul>` : `<p class="muted italique">Menu non renseigné.</p>`}
          ${autres.length ? `<p class="aide">Avec ${esc(autres.join(", "))}</p>` : ""}</li>`;
      }).join("")}</ul>`;
    } catch (e) { box.innerHTML = `<p class="msg erreur" role="alert">${esc(errMsg(e, "Impossible de charger les réceptions."))}</p>`; }
  })();

  // ---- plats déjà servis (vue recipe_served_to : réceptions passées et cuissons journalisées)
  (async function () {
    const box = $("#iv-servis");
    try {
      const s = await sb.from("recipe_served_to").select("recipe_id,day,reception_id").eq("guest_id", g.id).order("day", { ascending: false });
      if (s.error) throw s.error;
      const rows = s.data || [];
      if (!rows.length) { box.innerHTML = `<p class="muted italique">Aucun plat servi à cet invité pour l'instant. Les plats d'une réception comptent une fois sa date passée.</p>`; return; }
      const ids = [...new Set(rows.map((x) => x.recipe_id))];
      const rr = await sb.from("recipes").select("id,title").in("id", ids);
      if (rr.error) throw rr.error;
      const titre = new Map((rr.data || []).map((x) => [x.id, x.title]));
      const by = new Map();
      rows.forEach((x) => { if (!by.has(x.recipe_id)) by.set(x.recipe_id, new Set()); by.get(x.recipe_id).add(x.day); });
      box.innerHTML = `<ul class="iv-servis">${[...by].map(([rid, days]) => `<li><a class="iv-s-titre" href="/recettes/fiche.html?id=${encodeURIComponent(rid)}">${esc(titre.get(rid) || "Recette indisponible")}</a><span class="iv-s-dates">${[...days].sort().reverse().map((d) => esc(AR.fmtDay(d))).join(", ")}</span></li>`).join("")}</ul>`;
    } catch (e) { box.innerHTML = `<p class="msg erreur" role="alert">${esc(errMsg(e, "Impossible de charger les plats déjà servis."))}</p>`; }
  })();
})();
