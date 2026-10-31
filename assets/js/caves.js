// Mes caves : créer, renommer, ordonner et supprimer les lieux de stockage.
(async function () {
  const VC = window.VC;
  const { sb, $, esc, I, KIND, toast, fail } = VC;
  await VC.boot("places");
  const main = $("#main");
  let places = [], counts = new Map();

  async function load() {
    const [{ data: p }, { data: s }] = await Promise.all([
      sb.from("locations").select("*").order("position").order("created_at"),
      sb.from("stock").select("location_id, quantity")
    ]);
    places = p || [];
    counts = new Map();
    (s || []).forEach((r) => counts.set(r.location_id, (counts.get(r.location_id) || 0) + r.quantity));
    draw();
  }

  const kindOptions = (sel) => Object.entries(KIND).map(([k, l]) => `<option value="${k}"${k === sel ? " selected" : ""}>${l}</option>`).join("");

  function draw() {
    main.innerHTML = `<div class="page-head"><div><span class="eyebrow">Lieux de stockage</span><h1>Mes caves</h1></div></div>
      <p class="muted">Domicile, résidence secondaire, dépôt, cave louée chez un caviste : chaque bouteille est rattachée à un lieu.</p>
      <div class="places">${places.map((p, i) => `<div class="place" data-id="${p.id}">
        <div><h3>${esc(p.name)}</h3><small class="muted">${esc(KIND[p.kind] || "")} · ${counts.get(p.id) || 0} bouteille${(counts.get(p.id) || 0) > 1 ? "s" : ""}${p.notes ? " · " + esc(p.notes) : ""}</small></div>
        <div class="acts">
          <button class="icon-btn" data-act="up" aria-label="Monter"${i === 0 ? " disabled" : ""}>↑</button>
          <button class="icon-btn" data-act="edit" aria-label="Modifier">${I.edit}</button>
          <button class="icon-btn" data-act="del" aria-label="Supprimer">${I.trash}</button>
        </div></div>`).join("") || `<div class="empty"><p class="muted">Aucune cave pour l'instant.</p></div>`}</div>
      <form class="card" id="new" style="margin-top:20px" novalidate><h3>Nouvelle cave</h3>
        <div class="grid2"><label>Nom<input name="title" maxlength="80" required placeholder="ex. Chalet de Zermatt"></label><label>Type<select name="kind">${kindOptions("secondary")}</select></label></div>
        <label style="margin-top:14px">Remarque (adresse, code, conditions)<input name="notes" maxlength="200"></label>
        <div class="row" style="margin-top:16px"><button class="btn" type="submit">${I.plus}Créer</button></div></form>`;
  }

  main.addEventListener("submit", async (e) => {
    if (e.target.id !== "new") return;
    e.preventDefault();
    const f = e.target;
    const name = f.title.value.trim();
    if (!name) return f.title.focus();
    const { error } = await sb.from("locations").insert({ name, kind: f.kind.value, notes: f.notes.value.trim() || null, position: places.length });
    if (error) return fail(error);
    toast("Cave créée."); load();
  });

  main.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const id = b.closest(".place").dataset.id;
    const i = places.findIndex((p) => p.id === id);
    const p = places[i];
    if (b.dataset.act === "up" && i > 0) {
      const prev = places[i - 1];
      await Promise.all([
        sb.from("locations").update({ position: i - 1 }).eq("id", p.id),
        sb.from("locations").update({ position: i }).eq("id", prev.id)
      ]);
      return load();
    }
    if (b.dataset.act === "edit") {
      const d = document.createElement("dialog");
      d.innerHTML = `<form method="dialog" novalidate><h2>Modifier la cave</h2>
        <label>Nom<input name="title" maxlength="80" value="${esc(p.name)}" required></label>
        <label style="margin-top:14px">Type<select name="kind">${kindOptions(p.kind)}</select></label>
        <label style="margin-top:14px">Remarque<input name="notes" maxlength="200" value="${esc(p.notes || "")}"></label>
        <div class="row end" style="margin-top:18px"><button class="btn ghost" value="cancel" formnovalidate>Annuler</button><button class="btn" value="ok">Enregistrer</button></div></form>`;
      document.body.append(d);
      d.addEventListener("close", async () => {
        const f = d.querySelector("form");
        if (d.returnValue === "ok" && f.title.value.trim()) {
          const { error } = await sb.from("locations").update({ name: f.title.value.trim(), kind: f.kind.value, notes: f.notes.value.trim() || null }).eq("id", id);
          if (error) fail(error); else { toast("Cave modifiée."); load(); }
        }
        d.remove();
      });
      return d.showModal();
    }
    if (b.dataset.act === "del") {
      if (counts.get(id)) return toast("Cette cave contient encore des bouteilles : déplacez-les d'abord depuis leur fiche.");
      if (!confirm(`Supprimer la cave « ${p.name} » ?`)) return;
      await sb.from("stock").delete().eq("location_id", id).eq("quantity", 0);
      const { error } = await sb.from("locations").delete().eq("id", id);
      if (error) return fail(error, "Suppression impossible.");
      toast("Cave supprimée."); load();
    }
  });

  load();
})();
