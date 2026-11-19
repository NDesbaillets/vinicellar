(async function () {
  const AR = window.AR, { sb, $, $$, esc, errMsg, toast, fmtDate } = AR;
  const ctx = await AR.boot("carnets");
  if (!ctx) return;
  let books = ctx.books;
  const liste = $("#liste");
  $("#main").setAttribute("aria-busy", "false");

  // ---- invitations reçues
  async function loadInvites() {
    const { data, error } = await sb.rpc("my_book_invites");
    if (error) { $("#invites").innerHTML = ""; return toast(errMsg(error, "Impossible de lire vos invitations."), "erreur"); }
    $("#invites").innerHTML = (data || []).map((i) => `<div class="bandeau" data-id="${esc(i.id)}" role="group" aria-label="Invitation">
      <p><strong>${esc(i.invited_by_name || "Quelqu'un")}</strong> vous invite dans le carnet « ${esc(i.book_name)} »${i.role === "reader" ? " (lecture seule)" : ""}.</p>
      <div class="rangee"><button type="button" class="btn petit" data-iact="accept">Accepter</button><button type="button" class="btn sec petit" data-iact="decline">Refuser</button></div></div>`).join("");
  }
  $("#invites").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-iact]");
    if (!b) return;
    const id = b.closest("[data-id]").dataset.id;
    $$("#invites button").forEach((x) => (x.disabled = true));
    try {
      const { error } = await sb.rpc(b.dataset.iact === "accept" ? "accept_book_invite" : "decline_book_invite", { p_invite: id });
      if (error) throw error;
      toast(b.dataset.iact === "accept" ? "Invitation acceptée." : "Invitation refusée.");
      books = await AR.loadBooks(ctx.user.id);
    } catch (err) { toast(errMsg(err, "Impossible de traiter l'invitation."), "erreur"); }
    await loadInvites(); renderAll();
  });

  // ---- un carnet
  const sec = (b) => $(`section[data-book="${CSS.escape(b.id)}"]`);
  async function renderBook(b) {
    const owner = b.role === "owner", editor = b.role !== "reader";
    const root = sec(b);
    root.innerHTML = `<h2>${esc(b.name)}</h2><p class="libelle or" style="margin:4px 0 14px">${esc(AR.ROLES[b.role])}</p><div data-zone="body"><p class="chargement">Chargement…</p></div>`;
    const calls = [sb.rpc("book_people", { b: b.id }), editor ? sb.from("recipes").select("id,title,deleted_at").eq("book_id", b.id).not("deleted_at", "is", null).gte("deleted_at", new Date(Date.now() - 30 * 864e5).toISOString()).order("deleted_at", { ascending: false }) : Promise.resolve({ data: [] })];
    if (owner) calls.push(sb.from("recipe_book_invites").select("id,email,role,created_at").eq("book_id", b.id).is("accepted_at", null).order("created_at"));
    const [pp, tr, iv] = await Promise.all(calls);
    const zone = $("[data-zone=body]", root);
    const errs = [pp, tr, iv].filter((x) => x && x.error).map((x) => errMsg(x.error, "Chargement incomplet."));
    const people = pp.data || [], trash = tr.data || [], invites = (iv && iv.data) || [];

    zone.innerHTML = `${errs.length ? `<p class="msg erreur" role="alert">${esc(errs[0])}</p>` : ""}
      ${owner ? `<form data-form="rename" class="champs" novalidate style="margin-bottom:8px"><label>Nom du carnet<input name="name" maxlength="80" value="${esc(b.name)}"></label><div><button class="btn sec petit" type="submit">Renommer</button></div></form>` : ""}
      <h3 class="libelle" style="margin:24px 0 4px">Membres</h3>
      <ul class="membres">${people.map((m) => `<li data-user="${esc(m.user_id)}"><div class="qui">${esc(m.full_name || m.email || "Membre")}${m.user_id === ctx.user.id ? " (vous)" : ""}<small>${esc(m.email || "")}</small></div>
        <div class="rangee">${owner && m.role !== "owner"
          ? `<select data-role aria-label="Rôle de ${esc(m.full_name || m.email || "ce membre")}"><option value="member"${m.role === "member" ? " selected" : ""}>Membre</option><option value="reader"${m.role === "reader" ? " selected" : ""}>Lecteur</option></select><button type="button" class="btn danger petit" data-act="remove">Retirer</button>`
          : `<span class="libelle or">${esc(AR.ROLES[m.role] || m.role)}</span>`}</div></li>`).join("") || `<li class="muted italique">Aucun membre visible.</li>`}</ul>
      ${owner ? `<h3 class="libelle" style="margin:24px 0 4px">Invitations en attente</h3>
        ${invites.length ? `<ul class="membres">${invites.map((i) => `<li data-invite="${esc(i.id)}"><div class="qui">${esc(i.email)}<small>${esc(AR.ROLES[i.role])} · envoyée le ${esc(fmtDate(i.created_at))}</small></div><div><button type="button" class="btn sec petit" data-act="cancel-invite">Annuler l'invitation</button></div></li>`).join("")}</ul>` : `<p class="muted italique">Aucune invitation en attente.</p>`}
        <form data-form="invite" class="champs" novalidate style="margin-top:12px"><h3 class="libelle" style="margin:8px 0 0">Inviter quelqu'un</h3>
          <label>Adresse e-mail<input type="email" name="email" autocomplete="off" required></label>
          <label>Rôle<select name="role"><option value="member">Membre (peut écrire)</option><option value="reader">Lecteur (consulte et annote)</option></select></label>
          <div><button class="btn petit" type="submit">Envoyer l'invitation</button></div><p class="msg" data-msg role="status" aria-live="polite"></p></form>` : ""}
      ${editor ? `<h3 class="libelle" style="margin:28px 0 4px">Corbeille</h3>
        ${trash.length ? `<ul class="membres">${trash.map((t) => { const left = Math.max(0, 30 - Math.floor((Date.now() - new Date(t.deleted_at)) / 864e5)); return `<li data-recipe="${esc(t.id)}"><div class="qui">${esc(t.title)}<small>Supprimée le ${esc(fmtDate(t.deleted_at))} · encore ${left} jour${left > 1 ? "s" : ""}</small></div>
          <div class="rangee"><button type="button" class="btn sec petit" data-act="restore">Restaurer</button><button type="button" class="btn danger petit" data-act="purge">Supprimer définitivement</button></div></li>`; }).join("")}</ul>` : `<p class="muted italique">La corbeille est vide. Les recettes supprimées y restent 30 jours.</p>`}` : ""}
      ${!owner ? `<div style="margin-top:24px"><button type="button" class="btn danger petit" data-act="leave">Quitter ce carnet</button></div>` : ""}`;
  }

  function renderAll() {
    if (!books.length) { liste.innerHTML = `<div class="vide-etat"><p>Vous n'appartenez à aucun carnet pour le moment.</p></div>`; return; }
    liste.innerHTML = books.map((b) => `<section class="carnet" data-book="${esc(b.id)}" aria-label="Carnet ${esc(b.name)}"></section>`).join("");
    books.forEach(renderBook);
  }

  // ---- actions (délégation)
  liste.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const root = btn.closest("section[data-book]");
    const b = books.find((x) => x.id === root.dataset.book);
    const act = btn.dataset.act;
    const li = btn.closest("li");
    btn.disabled = true;
    try {
      if (act === "remove") {
        if (!confirm("Retirer ce membre du carnet ?")) { btn.disabled = false; return; }
        const { error } = await sb.from("recipe_book_members").delete().eq("book_id", b.id).eq("user_id", li.dataset.user);
        if (error) throw error;
        toast("Membre retiré.");
      } else if (act === "cancel-invite") {
        const { error } = await sb.from("recipe_book_invites").delete().eq("id", li.dataset.invite);
        if (error) throw error;
        toast("Invitation annulée.");
      } else if (act === "leave") {
        if (!confirm(`Quitter le carnet « ${b.name} » ? Vous n'y aurez plus accès.`)) { btn.disabled = false; return; }
        const { error } = await sb.from("recipe_book_members").delete().eq("book_id", b.id).eq("user_id", ctx.user.id);
        if (error) throw error;
        toast("Vous avez quitté le carnet.");
        books = await AR.loadBooks(ctx.user.id);
        if (AR.getBookPref() === b.id) AR.setBookPref("all");
        return renderAll();
      } else if (act === "restore") {
        const { error } = await sb.from("recipes").update({ deleted_at: null }).eq("id", li.dataset.recipe);
        if (error) throw error;
        toast("Recette restaurée.");
      } else if (act === "purge") {
        if (!confirm("Supprimer définitivement cette recette ? Cette action est irréversible.")) { btn.disabled = false; return; }
        const rid = li.dataset.recipe;
        const ph = await sb.from("recipe_photos").select("storage_path").eq("recipe_id", rid);
        const { error } = await sb.from("recipes").delete().eq("id", rid).not("deleted_at", "is", null);
        if (error) throw error;
        const paths = (ph.data || []).map((x) => x.storage_path);
        if (paths.length) { const rm = await sb.storage.from("recipes").remove(paths); if (rm.error) console.error(rm.error); }
        toast("Recette supprimée définitivement.");
      }
      await renderBook(b);
    } catch (err) { btn.disabled = false; toast(errMsg(err, "Action impossible. Réessayez."), "erreur"); }
  });

  liste.addEventListener("change", async (e) => {
    const sel = e.target.closest("select[data-role]");
    if (!sel) return;
    const root = sel.closest("section[data-book]"), li = sel.closest("li");
    sel.disabled = true;
    const { error } = await sb.from("recipe_book_members").update({ role: sel.value }).eq("book_id", root.dataset.book).eq("user_id", li.dataset.user);
    if (error) { toast(errMsg(error, "Changement de rôle impossible."), "erreur"); return renderBook(books.find((x) => x.id === root.dataset.book)); }
    toast("Rôle modifié."); sel.disabled = false;
  });

  liste.addEventListener("submit", async (e) => {
    const form = e.target.closest("form[data-form]");
    if (!form) return;
    e.preventDefault();
    const root = form.closest("section[data-book]");
    const b = books.find((x) => x.id === root.dataset.book);
    const btn = form.querySelector("button[type=submit]");
    if (form.dataset.form === "rename") {
      const name = form.name.value.trim();
      if (!name || name.length > 80) return toast("Le nom doit compter de 1 à 80 caractères.", "erreur");
      btn.disabled = true;
      const { error } = await sb.from("recipe_books").update({ name }).eq("id", b.id);
      if (error) { btn.disabled = false; return toast(errMsg(error, "Renommage impossible."), "erreur"); }
      b.name = name; toast("Carnet renommé."); return renderBook(b);
    }
    // Invitation : fonction edge « invite-book-member »
    const msg = $("[data-msg]", form);
    const email = form.email.value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return AR.setMsg(msg, "Indiquez une adresse e-mail valide.", "erreur");
    btn.disabled = true; AR.setMsg(msg, "Envoi…");
    try {
      const { data: s } = await sb.auth.getSession();
      if (!s.session) throw new Error("not authenticated");
      const res = await fetch(`${AR.cfg.supabaseUrl}/functions/v1/invite-book-member`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session.access_token}`, apikey: AR.cfg.supabaseAnonKey },
        body: JSON.stringify({ book_id: b.id, email, role: form.role.value })
      });
      let j = null;
      try { j = await res.json(); } catch { /* corps vide */ }
      if (!res.ok || !j || j.error) { btn.disabled = false; return AR.setMsg(msg, (j && j.message) || "L'invitation n'a pas pu être envoyée. Réessayez dans un instant.", "erreur"); }
      const T = { invited_new: "Invitation envoyée par e-mail.", pending: "Invitation envoyée : elle apparaîtra à sa prochaine connexion.", already_member: "Cette personne fait déjà partie du carnet." };
      toast(T[j.result] || "Invitation envoyée.");
      await renderBook(b);
    } catch (err) { btn.disabled = false; AR.setMsg(msg, errMsg(err, "L'invitation n'a pas pu être envoyée."), "erreur"); }
  });

  loadInvites();
  renderAll();
})();
