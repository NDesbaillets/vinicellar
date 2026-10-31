// Admin : valider ou refuser les demandes d'invitation.
(async function () {
  const VC = window.VC;
  const { sb, $, esc, I, date, toast, fail } = VC;
  const ctx = await VC.boot("account");
  const main = $("#main");
  if (!ctx.profile.is_admin) { main.innerHTML = `<div class="empty"><p>Page réservée à l'administrateur.</p></div>`; return; }

  async function load() {
    const { data, error } = await sb.from("access_requests").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) return fail(error);
    const pending = data.filter((r) => r.status === "pending"), done = data.filter((r) => r.status !== "pending");
    const row = (r) => `<div class="member" data-id="${r.id}"><div style="flex:1"><b>${esc(r.name)}</b><br><small class="muted">${esc(r.email)} · ${date(r.created_at.slice(0, 10))}</small>
        ${r.message ? `<p style="margin:6px 0 0;white-space:pre-line">${esc(r.message)}</p>` : ""}</div>
      ${r.status === "pending" ? `<div class="row"><button class="btn" data-a="approve">${I.check}Inviter</button><button class="btn ghost" data-a="decline">Refuser</button></div>`
        : `<span class="tag ${r.status === "approved" ? "ready" : ""}">${r.status === "approved" ? "Invité" : "Refusé"}</span>`}</div>`;
    main.innerHTML = `<div class="page-head"><div><span class="eyebrow">Administration</span><h1>Demandes d'invitation</h1></div></div>
      <div class="card"><h3>En attente (${pending.length})</h3>${pending.map(row).join("") || `<p class="muted" style="margin:0">Aucune demande en attente.</p>`}</div>
      ${done.length ? `<div class="card"><h3>Traitées</h3>${done.map(row).join("")}</div>` : ""}`;
  }

  main.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-a]");
    if (!b) return;
    const id = b.closest("[data-id]").dataset.id;
    if (b.dataset.a === "decline" && !confirm("Refuser cette demande ?")) return;
    b.disabled = true;
    const { data, error } = await sb.functions.invoke("admin-review", { body: { id, action: b.dataset.a } });
    if (error) { b.disabled = false; return fail(error, "Action impossible."); }
    toast(b.dataset.a === "approve" ? (data && data.existing ? "Cette personne avait déjà un compte." : "Invitation envoyée par e-mail.") : "Demande refusée.");
    load();
  });
  load();
})();
