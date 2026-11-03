// Accueil connecté : choisir la cave à regarder (principale, résidence secondaire, dépôt…) et répondre aux invitations.
(async function () {
  const VC = window.VC;
  const { sb, $, esc, I, KIND, toast, fail } = VC;
  const ctx = await VC.boot("cellar");
  const main = $("#main");

  const [places, { data: stock }, { data: invites }] = await Promise.all([
    VC.loadPlaces().catch((e) => { fail(e, "Impossible de charger les caves."); return []; }),
    sb.from("stock").select("location_id, quantity"),
    sb.rpc("my_invites")
  ]);
  const count = new Map();
  (stock || []).forEach((s) => count.set(s.location_id, (count.get(s.location_id) || 0) + s.quantity));
  const total = [...count.values()].reduce((a, b) => a + b, 0);

  // Une seule cave et rien à accepter : on y va directement.
  if (places.length === 1 && !(invites || []).length) {
    VC.setLoc(places[0].id);
    return location.replace(`/app/cave.html?loc=${places[0].id}`);
  }

  const kindIcon = (k) => (k === "home" ? I.cellar : k === "storage" ? I.journal : I.places);
  const shared = new Set(places.map((p) => p.collection_id)).size > 1;
  const card = (p) => `<a class="cellar-card" href="/app/cave.html?loc=${p.id}" data-loc="${p.id}">
      <span class="ico">${kindIcon(p.kind)}</span>
      <span><h3>${esc(p.name)}</h3><small>${esc([KIND[p.kind], shared && p.collections ? p.collections.name : null].filter(Boolean).join(" · "))}</small></span>
      <span><b class="n">${count.get(p.id) || 0}</b> <small>bt.</small></span></a>`;

  main.innerHTML = `<div class="page-head"><div><span class="eyebrow">Bonjour ${esc(ctx.profile.first_name || "")}</span><h1>Quelle cave ?</h1></div></div>
    <div id="invites"></div>
    ${places.length ? `<div class="cellars">${places.map(card).join("")}
      ${places.length > 1 ? `<a class="cellar-card all" href="/app/cave.html?loc=all" data-loc="all"><span class="ico">${I.search}</span><span><h3>Toutes les caves</h3><small>Vue d'ensemble</small></span><span><b class="n">${total}</b> <small>bt.</small></span></a>` : ""}
      </div>` : `<div class="empty">${I.places}<h2>Aucune cave</h2><p class="muted">Créez votre première cave pour commencer.</p></div>`}
    <div class="cta-row" style="margin-top:20px"><a class="btn big" href="/app/sommelier.html">${I.plate}Que boire ce soir ?</a><a class="btn big ghost" href="/app/envies.html" id="wish-link">Listes d'envies</a></div>
    <p style="margin-top:12px"><a class="btn quiet" href="/app/caves.html">${I.share}Gérer les caves et le partage</a></p>`;
  sb.from("wishlist_items").select("id", { count: "exact", head: true }).then(({ count }) => { if (count && $("#wish-link")) $("#wish-link").textContent = `Listes d'envies (${count})`; });

  main.addEventListener("click", (e) => { const a = e.target.closest("[data-loc]"); if (a) VC.setLoc(a.dataset.loc); });

  function drawInvites(list) {
    $("#invites").innerHTML = (list || []).map((i) => `<div class="invite" data-id="${i.id}">
      <div><b>${esc(i.invited_by_name || "Quelqu'un")}</b> vous invite à partager « ${esc(i.collection_name)} »${i.role === "viewer" ? " en lecture seule" : ""}.<br><small class="muted">${i.role === "viewer" ? "Vous pourrez consulter ses caves et ses bouteilles, sans les modifier." : "Vous verrez et gérerez ensemble les mêmes caves et bouteilles."}</small></div>
      <div class="row"><button class="btn" data-acc>${I.check}Accepter</button><button class="btn ghost" data-dec>Refuser</button></div></div>`).join("");
  }
  drawInvites(invites);
  VC.installHint($("#invites"));
  $("#invites").addEventListener("click", async (e) => {
    const box = e.target.closest(".invite");
    if (!box) return;
    if (e.target.closest("[data-acc]")) {
      const { error } = await sb.rpc("accept_invite", { p_invite: box.dataset.id });
      if (error) return fail(error);
      toast("Partage accepté."); setTimeout(() => location.reload(), 600);
    } else if (e.target.closest("[data-dec]")) {
      const { error } = await sb.rpc("decline_invite", { p_invite: box.dataset.id });
      if (error) return fail(error);
      box.remove();
    }
  });
  if (ctx.profile.is_admin) {
    const { count } = await sb.from("access_requests").select("id", { count: "exact", head: true }).eq("status", "pending");
    if (count) $("#invites").insertAdjacentHTML("afterbegin", `<a class="invite" href="/app/admin.html" style="text-decoration:none;color:inherit"><div><b>${count} demande${count > 1 ? "s" : ""} d'invitation</b> à valider.</div></a>`);
  }
  const { count: ready } = await sb.from("drafts").select("id", { count: "exact", head: true }).eq("status", "ready");
  if (ready) $("#invites").insertAdjacentHTML("beforeend", `<a class="invite" href="/app/ajouter.html" style="text-decoration:none;color:inherit"><div><b>${ready} fiche${ready > 1 ? "s" : ""} prête${ready > 1 ? "s" : ""}</b> à vérifier avant d'entrer en cave.</div></a>`);
})();
