// Mon compte : identité, devise, mot de passe, export de la cave, déconnexion.
(async function () {
  const VC = window.VC;
  const { sb, $, esc, I, toast, fail, CURRENCIES, CATEGORY, STYLE } = VC;
  const ctx = await VC.boot("account");
  const main = $("#main");
  const p = ctx.profile;
  const msg = (f, text, kind) => { const o = f.querySelector(".form-msg"); o.textContent = text; o.className = "form-msg" + (kind ? " " + kind : ""); };

  main.innerHTML = `<div class="page-head"><div><span class="eyebrow">${esc(ctx.user.email)}</span><h1>Mon compte</h1></div></div>
    <form class="card" id="profile" novalidate><h3>Profil</h3>
      <div class="grid2"><label>Prénom<input name="first_name" value="${esc(p.first_name || "")}" maxlength="80"></label><label>Nom<input name="last_name" value="${esc(p.last_name || "")}" maxlength="80"></label>
      <label>Devise par défaut<select name="currency">${CURRENCIES.map((c) => `<option${c === p.currency ? " selected" : ""}>${c}</option>`).join("")}</select></label></div>
      <div class="row" style="margin-top:16px"><button class="btn" type="submit">Enregistrer</button></div><p class="form-msg" role="status"></p></form>
    <form class="card" id="password" novalidate><h3>Mot de passe</h3>
      <div class="grid2"><label>Mot de passe actuel<input type="password" name="current" autocomplete="current-password"></label><span></span>
      <label>Nouveau mot de passe (10 caractères minimum)<input type="password" name="password" autocomplete="new-password" minlength="10"></label>
      <label>Confirmer<input type="password" name="confirm" autocomplete="new-password"></label></div>
      <div class="row" style="margin-top:16px"><button class="btn" type="submit">Changer le mot de passe</button></div><p class="form-msg" role="status"></p></form>
    <div class="card"><h3>Mes données</h3>
      <p class="muted">Export de toute la cave au format du modèle d'import (une ligne par vin et par cave), lisible dans Excel ou Numbers et réimportable tel quel.</p>
      <div class="row"><button class="btn ghost" id="export">${I.download}Exporter la cave (.xlsx)</button><a class="btn ghost" href="/app/importer.html">Importer un tableau</a><button class="btn ghost" id="export-j">${I.download}Exporter le journal (.csv)</button></div>
      <p class="faint" style="margin:14px 0 0;font-size:.85rem">Analyses d'étiquettes ces dernières 24 h : <span id="quota">…</span></p></div>
    <div class="card"><h3>Caves et partage</h3><p class="muted">Créer, renommer ou supprimer une cave ; inviter votre conjoint ou votre famille.</p><a class="btn ghost" href="/app/caves.html">${I.share}Gérer les caves et le partage</a></div>
    ${p.is_admin ? `<div class="card"><h3>Administration</h3><p class="muted">Valider les demandes d'invitation.</p><a class="btn ghost" href="/app/admin.html">Demandes d'invitation<span id="req-n"></span></a></div>` : ""}
    <div class="card"><h3>Session</h3><div class="row"><button class="btn ghost" id="logout">${I.out}Se déconnecter</button><button class="btn ghost" id="logout-all">Se déconnecter de tous les appareils</button></div></div>`;

  if (p.is_admin) sb.from("access_requests").select("id", { count: "exact", head: true }).eq("status", "pending")
    .then(({ count }) => { if (count) $("#req-n").textContent = ` (${count})`; });
  sb.from("ai_calls").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 864e5).toISOString())
    .then(({ count }) => ($("#quota").textContent = count ?? 0));

  $("#profile").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const first = f.first_name.value.trim(), last = f.last_name.value.trim();
    const { error } = await sb.from("profiles").update({ first_name: first || null, last_name: last || null, full_name: [first, last].filter(Boolean).join(" ") || null, currency: f.currency.value }).eq("id", ctx.user.id);
    error ? msg(f, "Enregistrement impossible.", "error") : msg(f, "Profil enregistré.", "ok");
  });

  $("#password").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.password.value.length < 10) return msg(f, "Au moins 10 caractères.", "error");
    if (f.password.value !== f.confirm.value) return msg(f, "Les mots de passe ne correspondent pas.", "error");
    const { error: authErr } = await sb.auth.signInWithPassword({ email: ctx.user.email, password: f.current.value });
    if (authErr) return msg(f, "Mot de passe actuel incorrect.", "error");
    const { error } = await sb.auth.updateUser({ password: f.password.value });
    if (error) return msg(f, error.message || "Modification impossible.", "error");
    f.reset(); msg(f, "Mot de passe modifié.", "ok");
  });

  const csv = (rows) => "﻿" + rows.map((r) => r.map((v) => {
    const s = v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(";")).join("\n");
  const download = (name, text) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  $("#export").addEventListener("click", async () => {
    const [{ data: items, error }, { data: stock }, { data: places }] = await Promise.all([
      sb.from("items").select("*"), sb.from("stock").select("*"), sb.from("locations").select("*")
    ]);
    if (error) return fail(error);
    // Même format que le modèle d'import : le fichier exporté peut être réimporté tel quel.
    const place = (id) => (places || []).find((x) => x.id === id)?.name || "";
    const T = VC.table;
    const rows = [T.COLUMNS.map((c) => c.h)];
    for (const it of items || []) {
      const st = (stock || []).filter((s) => s.item_id === it.id && s.quantity > 0);
      for (const s of st.length ? st : [{ quantity: 0 }]) rows.push(T.COLUMNS.map((c) => T.cell(c, it, { cave: place(s.location_id), bin: s.bin, qty: s.quantity })));
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Vins");
    XLSX.writeFile(wb, `vinicellar-cave-${VC.today()}.xlsx`);
  });

  $("#export-j").addEventListener("click", async () => {
    const { data, error } = await sb.from("tastings").select("*, items(name, producer, vintage)").order("tasted_on", { ascending: false });
    if (error) return fail(error);
    download(`vinicellar-journal-${VC.today()}.csv`, csv([["Date", "Producteur", "Cuvée", "Millésime", "Note", "Accord", "Occasion", "Commentaire"],
      ...(data || []).map((t) => [t.tasted_on, t.items?.producer, t.items?.name, t.items?.vintage, t.rating, t.pairing, t.occasion, t.notes])]));
  });

  $("#logout").addEventListener("click", async () => { await sb.auth.signOut(); location.href = "/"; });
  $("#logout-all").addEventListener("click", async () => { await sb.auth.signOut({ scope: "global" }); toast("Déconnecté partout."); location.href = "/"; });
})();
