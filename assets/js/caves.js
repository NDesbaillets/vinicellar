// Caves et partage : créer, renommer, ordonner, supprimer les caves ; inviter son conjoint ou sa famille.
(async function () {
  const VC = window.VC;
  const { sb, $, esc, I, KIND, toast, fail } = VC;
  const ctx = await VC.boot("cellar");
  const main = $("#main");
  let places = [], counts = new Map(), colls = [], people = new Map(), invites = [];

  async function load() {
    const [p, { data: s }, { data: c }, { data: inv }] = await Promise.all([
      VC.loadPlaces(),
      sb.from("stock").select("location_id, quantity"),
      sb.from("collections").select("*").order("created_at"),
      sb.from("collection_invites").select("*").is("accepted_at", null).order("created_at")
    ]);
    places = p; colls = c || []; invites = inv || [];
    counts = new Map();
    (s || []).forEach((r) => counts.set(r.location_id, (counts.get(r.location_id) || 0) + r.quantity));
    const res = await Promise.all(colls.map((x) => sb.rpc("collection_people", { c: x.id })));
    people = new Map(colls.map((x, i) => [x.id, res[i].data || []]));
    draw();
  }

  const kindOptions = (sel) => Object.entries(KIND).map(([k, l]) => `<option value="${k}"${k === sel ? " selected" : ""}>${l}</option>`).join("");
  const isOwner = (c) => c.owner_id === ctx.user.id;

  function collBlock(c) {
    const ps = places.filter((p) => p.collection_id === c.id);
    const members = people.get(c.id) || [];
    const pend = invites.filter((i) => i.collection_id === c.id);
    const owner = isOwner(c);
    const me = members.find((m) => m.user_id === ctx.user.id);
    const editor = owner || (me && me.role === "member");
    const ROLE = { owner: "propriétaire", member: "accès complet", viewer: "lecture seule" };
    return `<section class="card" data-coll="${c.id}" style="margin-top:16px">
      <div class="row"><h2 style="margin:0">${esc(c.name)}</h2>${owner ? `<button class="icon-btn" data-act="rename-coll" aria-label="Renommer">${I.edit}</button>` : `<span class="tag">Partagée avec moi${editor ? "" : " · lecture seule"}</span>`}</div>
      <h3 style="margin-top:18px">Caves</h3>
      <div class="places">${ps.map((p, i) => `<div class="place" data-id="${p.id}">
        <div><h3>${esc(p.name)}</h3><small class="muted">${esc(KIND[p.kind] || "")} · ${counts.get(p.id) || 0} bouteille${(counts.get(p.id) || 0) > 1 ? "s" : ""}${p.notes ? " · " + esc(p.notes) : ""}</small></div>
        ${editor ? `<div class="acts"><button class="icon-btn" data-act="edit" aria-label="Modifier">${I.edit}</button>
          <button class="icon-btn" data-act="del" aria-label="Supprimer">${I.trash}</button></div>` : ""}</div>`).join("") || `<p class="muted">Aucune cave.</p>`}</div>
      ${editor ? `<form class="new-place" novalidate style="margin-top:14px"><div class="form-line">
        <label>Nouvelle cave<input name="title" maxlength="80" placeholder="ex. Chalet de Zermatt"></label>
        <label>Type<select name="kind">${kindOptions(ps.length ? "secondary" : "home")}</select></label>
        <button class="btn" type="submit">${I.plus}Créer</button></div></form>` : ""}

      <h3 style="margin-top:24px">${I.share.replace("<svg", '<svg width="18" height="18" style="vertical-align:-3px;margin-right:6px"')}Partage</h3>
      <p class="muted" style="margin-top:0"><b>Accès complet</b> : la personne voit et gère les mêmes caves (ajouts, sorties, notes). <b>Lecture seule</b> : elle consulte tout, sans rien pouvoir modifier.</p>
      <div>${members.map((m) => `<div class="member"><div style="flex:1"><b>${esc(m.full_name || m.email)}</b><br><small class="muted">${esc(m.email)} · ${ROLE[m.role] || ""}${m.user_id === ctx.user.id ? " · vous" : ""}</small></div>
        ${owner && m.role !== "owner" ? `<select class="role-sel" data-user="${m.user_id}" aria-label="Niveau d'accès"><option value="member"${m.role === "member" ? " selected" : ""}>Accès complet</option><option value="viewer"${m.role === "viewer" ? " selected" : ""}>Lecture seule</option></select>` : ""}
        ${m.role !== "owner" && (owner || m.user_id === ctx.user.id) ? `<button class="btn quiet" data-act="${m.user_id === ctx.user.id ? "leave" : "remove"}" data-user="${m.user_id}">${m.user_id === ctx.user.id ? "Quitter" : "Retirer"}</button>` : ""}</div>`).join("")}
        ${pend.map((i) => `<div class="member"><div style="flex:1"><b>${esc(i.email)}</b><br><small class="muted">Invitation en attente · ${ROLE[i.role] || "accès complet"}</small></div>${owner ? `<button class="btn quiet" data-act="share-link" data-email="${esc(i.email)}">Prévenir</button><button class="btn quiet" data-act="cancel-invite" data-inv="${i.id}">Annuler</button>` : ""}</div>`).join("")}</div>
      ${owner ? `<form class="invite-form" novalidate style="margin-top:14px"><div class="form-line">
        <label>Inviter par e-mail<input type="email" name="email" placeholder="ex. viviane@exemple.ch" autocomplete="off"></label>
        <label>Accès<select name="role"><option value="member">Accès complet</option><option value="viewer">Lecture seule</option></select></label>
        <button class="btn" type="submit">${I.plus}Inviter</button></div></form>` : ""}
    </section>`;
  }

  function draw() {
    main.innerHTML = `<div class="page-head"><div><span class="eyebrow">Réglages</span><h1>Caves et partage</h1></div></div>
      <p class="muted">Domicile, résidence secondaire, dépôt : chaque bouteille est rattachée à une cave. Partagez l'ensemble avec votre conjoint ou votre famille.</p>
      ${colls.map(collBlock).join("")}`;
  }

  async function shareLink(email) {
    const text = `Je t'ai invité·e à gérer notre cave sur Vinicellar. Ouvre l'e-mail d'activation reçu sur ${email}, ou connecte-toi sur https://vinicellar.ch : l'invitation s'affichera.`;
    if (navigator.share) { try { await navigator.share({ title: "Vinicellar", text }); return; } catch { /* partage annulé */ } }
    try { await navigator.clipboard.writeText(text); toast("Message copié : envoyez-le par WhatsApp ou e-mail."); }
    catch { prompt("Copiez ce message :", text); }
  }

  main.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const coll = f.closest("[data-coll]").dataset.coll;
    if (f.classList.contains("new-place")) {
      const name = f.title.value.trim();
      if (!name) return f.title.focus();
      const { error } = await sb.from("locations").insert({ name, kind: f.kind.value, collection_id: coll, position: places.filter((p) => p.collection_id === coll).length });
      if (error) return fail(error);
      toast("Cave créée."); return load();
    }
    if (f.classList.contains("invite-form")) {
      const email = f.email.value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast("Adresse e-mail invalide."); return f.email.focus(); }
      if (email === (ctx.user.email || "").toLowerCase()) return toast("C'est votre propre adresse.");
      const btn = f.querySelector("button[type=submit]");
      btn.disabled = true;
      const { data, error } = await sb.functions.invoke("invite-member", { body: { collection_id: coll, email, role: f.role.value } });
      btn.disabled = false;
      if (error) {
        let m = "Invitation impossible.";
        try { const j = await error.context.json(); if (j && j.message) m = j.message; } catch { /* réponse vide */ }
        await load(); return toast(m);
      }
      f.reset();
      await load();
      toast(data && data.existing ? "Invitation enregistrée : elle s'affichera à sa prochaine connexion." : "Invitation envoyée par e-mail.");
    }
  });

  main.addEventListener("change", async (e) => {
    const sel = e.target.closest(".role-sel");
    if (!sel) return;
    const coll = sel.closest("[data-coll]").dataset.coll;
    const { error } = await sb.from("collection_members").update({ role: sel.value }).eq("collection_id", coll).eq("user_id", sel.dataset.user);
    if (error) { fail(error); return load(); }
    toast(sel.value === "viewer" ? "Accès passé en lecture seule." : "Accès complet accordé.");
  });

  main.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const collEl = b.closest("[data-coll]");
    const coll = colls.find((c) => c.id === collEl.dataset.coll);
    const act = b.dataset.act;

    if (act === "rename-coll") {
      const name = prompt("Nom de la collection (ex. Cave Desbaillets)", coll.name);
      if (!name || !name.trim()) return;
      const { error } = await sb.from("collections").update({ name: name.trim().slice(0, 80) }).eq("id", coll.id);
      if (error) return fail(error);
      return load();
    }
    if (act === "share-link") return shareLink(b.dataset.email);
    if (act === "cancel-invite") {
      const { error } = await sb.from("collection_invites").delete().eq("id", b.dataset.inv);
      if (error) return fail(error);
      return load();
    }
    if (act === "remove" || act === "leave") {
      const msg = act === "leave" ? `Quitter « ${coll.name} » ? Vous n'aurez plus accès à ces caves.` : "Retirer cette personne du partage ?";
      if (!confirm(msg)) return;
      const { error } = await sb.from("collection_members").delete().eq("collection_id", coll.id).eq("user_id", b.dataset.user);
      if (error) return fail(error);
      if (act === "leave") VC.setLoc("all");
      toast(act === "leave" ? "Partage quitté." : "Personne retirée."); return load();
    }

    const placeEl = b.closest(".place");
    if (!placeEl) return;
    const id = placeEl.dataset.id;
    const list = places.filter((p) => p.collection_id === coll.id);
    const i = list.findIndex((p) => p.id === id);
    const p = list[i];
    if (act === "edit") {
      const d = VC.sheet(`<form novalidate><h2>Modifier la cave</h2>
        <label>Nom<input name="title" maxlength="80" value="${esc(p.name)}" required></label>
        <label style="margin-top:14px">Type<select name="kind">${kindOptions(p.kind)}</select></label>
        <label style="margin-top:14px">Remarque (adresse, code, conditions)<input name="notes" maxlength="200" value="${esc(p.notes || "")}"></label>
        <div class="row end" style="margin-top:18px"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn" type="submit">Enregistrer</button></div></form>`);
      d.querySelector("form").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const f = ev.target;
        if (!f.title.value.trim()) return;
        const { error } = await sb.from("locations").update({ name: f.title.value.trim(), kind: f.kind.value, notes: f.notes.value.trim() || null }).eq("id", id);
        d.close();
        if (error) fail(error); else { toast("Cave modifiée."); load(); }
      });
      return;
    }
    if (act === "del") {
      if (counts.get(id)) return toast("Cette cave contient encore des bouteilles : déplacez-les d'abord depuis leur fiche.");
      if (!confirm(`Supprimer la cave « ${p.name} » ?`)) return;
      await sb.from("stock").delete().eq("location_id", id).eq("quantity", 0);
      const { error } = await sb.from("locations").delete().eq("id", id);
      if (error) return fail(error, "Suppression impossible.");
      toast("Cave supprimée."); load();
    }
  });

  try { await load(); } catch (e) { fail(e, "Impossible de charger les caves."); }
})();
