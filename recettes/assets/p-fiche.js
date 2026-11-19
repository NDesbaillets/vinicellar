(async function () {
  const AR = window.AR, { sb, $, $$, esc, errMsg, toast, fmtDate } = AR;
  const ctx = await AR.boot("carnet");
  if (!ctx) return;
  const main = $("#main");
  const id = new URLSearchParams(location.search).get("id");
  const fail = (t) => { main.setAttribute("aria-busy", "false"); main.innerHTML = `<div class="vide-etat"><p role="alert">${esc(t)}</p><a class="btn sec petit" href="/recettes/">Retour au carnet</a></div>`; };
  if (!id) return fail("Aucune recette indiquée.");

  let r, lines = [], steps = [], notes = [], photos = [], people = {};
  try {
    const rr = await sb.from("recipes").select("*").eq("id", id).maybeSingle();
    if (rr.error) throw rr.error;
    if (!rr.data) return fail("Recette introuvable, ou vous n'avez pas accès à son carnet.");
    r = rr.data;
    const [l, s, n, p, pe] = await Promise.all([
      sb.from("recipe_ingredient_lines").select("*").eq("recipe_id", id).order("position"),
      sb.from("recipe_steps").select("*").eq("recipe_id", id).order("position"),
      sb.from("recipe_notes").select("*").eq("recipe_id", id).order("created_at"),
      sb.from("recipe_photos").select("*").eq("recipe_id", id),
      sb.rpc("book_people", { b: rr.data.book_id })
    ]);
    for (const x of [l, s, n, p]) if (x.error) throw x.error;
    lines = l.data || []; steps = s.data || []; notes = n.data || []; photos = p.data || [];
    (pe.data || []).forEach((x) => (people[x.user_id] = x.full_name || x.email || "Membre"));
  } catch (e) { return fail(errMsg(e, "Impossible de charger la recette.")); }

  const book = ctx.books.find((b) => b.id === r.book_id);
  const editor = !!book && (book.role === "owner" || book.role === "member");
  document.title = `${r.title} · ARÔMES V&N`;

  const cov = photos.find((x) => x.is_cover) || null;
  const urls = cov ? await AR.signedUrls([cov.storage_path]) : {};
  const photoUrl = cov ? urls[cov.storage_path] : null;

  function alertText(a) {
    if (a == null) return "";
    if (typeof a === "string") return a;
    return a.message || a.text || a.detail || a.label || a.type || "";
  }
  const alerts = (Array.isArray(r.alerts) ? r.alerts : []).map(alertText).filter(Boolean);
  const showNote = alerts.length > 0 || r.review_state === "a_verifier";

  function ingHtml(l) {
    const hasQty = l.quantity != null;
    const unit = AR.fmtUnit(l.unit, l.quantity);
    const qte = hasQty
      ? `<span class="qte">${esc(AR.fmtQty(l.quantity))}${unit ? " " + esc(unit) : ""}</span>`
      : `<span class="qte inconnue">${esc(l.precision || "q.b.")}</span>`;
    const prec = hasQty && l.precision ? ` <span class="prec">(${esc(l.precision)})</span>` : "";
    const opt = l.optional ? ` <span class="prec">(facultatif)</span>` : "";
    return `<li class="ing"><span class="nom">${esc(l.label_original)}${prec}${opt}</span><span class="guide" aria-hidden="true"></span>${qte}</li>`;
  }
  function ingredients() {
    if (!lines.length) return `<p class="muted italique">Aucun ingrédient saisi.</p>`;
    const groups = [];
    lines.forEach((l) => {
      const g = (l.group_label || "").trim();
      let grp = groups[groups.length - 1];
      if (!grp || grp.g !== g) { grp = { g, items: [] }; groups.push(grp); }
      grp.items.push(l);
    });
    return groups.map((g) => `${g.g ? `<h3 class="groupe">${esc(g.g)}</h3>` : ""}<ul class="ingredients">${g.items.map(ingHtml).join("")}</ul>`).join("");
  }

  function render() {
    const me = ctx.user.id;
    const chiffres = [];
    if (r.servings != null) chiffres.push(["Portions", String(r.servings), r.servings_estimated]);
    if (r.time_active_min != null) chiffres.push(["Préparation", AR.fmtMin(r.time_active_min), r.time_active_estimated]);
    if (r.time_total_min != null) chiffres.push(["Temps total", AR.fmtMin(r.time_total_min), r.time_total_estimated]);
    if (r.difficulty) chiffres.push(["Difficulté", AR.DIFFICULTES[r.difficulty] || "", false]);
    const meta = [r.course ? AR.COURSES[r.course] : "", r.cuisine || ""].filter(Boolean).join(" · ");
    const srcUrl = AR.safeUrl(r.source_url || "");
    const source = [r.source_author ? esc(r.source_author) : "", srcUrl ? `<a href="${esc(srcUrl)}" target="_blank" rel="noopener noreferrer">${esc(AR.host(srcUrl))}</a>` : ""].filter(Boolean).join(" · ");
    const trash = r.deleted_at
      ? `<div class="bandeau" role="status"><p>Cette recette est dans la corbeille depuis le ${esc(fmtDate(r.deleted_at))}.</p>${editor ? `<button type="button" class="btn petit" data-act="restore">Restaurer</button>` : ""}</div>` : "";
    const visibles = notes;

    main.setAttribute("aria-busy", "false");
    main.innerHTML = `${trash}
      <p><a href="/recettes/">← Le carnet</a></p>
      <div class="fiche-photo"><div class="passe-partout"><div class="cadre">${photoUrl ? `<img src="${esc(photoUrl)}" alt="${esc(r.title)}">` : `<span class="vide">Sans photo</span>`}</div></div></div>
      ${meta ? `<p class="libelle or centre" style="margin:0 0 8px">${esc(meta)}</p>` : ""}
      <h1 class="fiche-titre">${esc(r.title)}</h1>
      ${r.title_original ? `<p class="fiche-orig">${esc(r.title_original)}</p>` : ""}
      ${source ? `<p class="fiche-source">${source}</p>` : ""}
      <span class="filet" style="margin:18px auto 0" aria-hidden="true"></span>
      ${chiffres.length ? `<div class="chiffres">${chiffres.map(([l, v, est]) => `<div><span class="libelle">${esc(l)}</span><span class="valeur">${esc(v)}</span>${est ? `<span class="est">estimé</span>` : ""}</div>`).join("")}</div>` : ""}
      ${r.family || editor ? `<div class="actions"><button type="button" class="btn sec ${r.family ? "actif" : ""}" id="family" aria-pressed="${r.family}" ${editor ? "" : "disabled"}>De famille</button></div>` : ""}
      ${showNote ? `<aside class="note-avant" aria-labelledby="nav-t"><h2 id="nav-t">Note avant de cuisiner</h2>
        ${alerts.length ? `<ul>${alerts.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
        ${r.review_state === "a_verifier" ? `<p>Cette fiche est à vérifier avant d'être considérée comme sûre.</p>${editor ? `<button type="button" class="btn petit" data-act="verify">Marquer comme vérifiée</button>` : ""}` : ""}</aside>` : ""}
      <h2 class="section">Ingrédients</h2><span class="filet" aria-hidden="true"></span>
      ${ingredients()}
      <h2 class="section">Préparation</h2><span class="filet" aria-hidden="true"></span>
      ${steps.length ? `<ol class="etapes">${steps.map((s, i) => `<li class="etape"><span class="num" aria-hidden="true">${i + 1}</span><div><p><span class="sr-only">Étape ${i + 1}. </span>${esc(s.text)}</p>${s.timer_seconds ? `<span class="libelle or minuteur">Minuteur : ${esc(AR.fmtMin(Math.round(s.timer_seconds / 60)))}</span>` : ""}</div></li>`).join("")}</ol>` : `<p class="muted italique">Aucune étape saisie.</p>`}
      <h2 class="section">En marge</h2><span class="filet" aria-hidden="true"></span>
      ${visibles.length ? visibles.map((n) => `<div class="marge"><p>${esc(n.body)}</p><span class="meta">${esc(n.author_id === me ? "Vous" : people[n.author_id] || "Un membre")} · ${esc(fmtDate(n.created_at))}${n.private ? " · Privée" : ""}</span>
        ${n.author_id === me ? ` <button type="button" class="btn lien" data-del-note="${esc(n.id)}" aria-label="Supprimer cette note">Supprimer</button>` : ""}</div>`).join("") : `<p class="muted italique">Aucune note pour l'instant.</p>`}
      <form id="note-form" class="champs" novalidate style="margin-top:18px">
        <label>Ajouter une note<textarea name="body" maxlength="5000" rows="3"></textarea></label>
        <label class="case"><input type="checkbox" name="private"> Note privée (visible de vous seul)</label>
        <div><button class="btn sec" type="submit">Ajouter la note</button></div>
        <p class="msg" id="note-msg" role="status" aria-live="polite"></p>
      </form>
      ${editor ? `<div class="actions-bas">${r.deleted_at ? "" : `<a class="btn" href="/recettes/editer.html?id=${encodeURIComponent(r.id)}">Modifier</a><button type="button" class="btn danger" data-act="trash">Mettre à la corbeille</button>`}</div>` : ""}`;
  }
  render();

  async function patch(fields, okText) {
    const { data, error } = await sb.from("recipes").update(fields).eq("id", r.id).select("*").single();
    if (error) { toast(errMsg(error, "Modification impossible."), "erreur"); return false; }
    r = data; if (okText) toast(okText); render(); return true;
  }

  main.addEventListener("click", async (e) => {
    const fam = e.target.closest("#family");
    if (fam && editor) return void patch({ family: !r.family }, r.family ? "Retirée de « De famille »." : "Ajoutée à « De famille ».");
    const del = e.target.closest("[data-del-note]");
    if (del) {
      del.disabled = true;
      const { error } = await sb.from("recipe_notes").delete().eq("id", del.dataset.delNote);
      if (error) { del.disabled = false; return toast(errMsg(error, "Suppression impossible."), "erreur"); }
      notes = notes.filter((n) => n.id !== del.dataset.delNote); render(); return toast("Note supprimée.");
    }
    const b = e.target.closest("button[data-act]");
    if (!b || !editor) return;
    if (b.dataset.act === "verify") return void patch({ review_state: "valide" }, "Recette marquée comme vérifiée.");
    if (b.dataset.act === "restore") return void patch({ deleted_at: null }, "Recette restaurée.");
    if (b.dataset.act === "trash") {
      if (!confirm("Mettre cette recette à la corbeille ? Vous pourrez la restaurer pendant 30 jours.")) return;
      b.disabled = true;
      const ok = await patch({ deleted_at: new Date().toISOString() });
      if (ok) { toast("Recette mise à la corbeille."); setTimeout(() => location.assign("/recettes/"), 700); } else b.disabled = false;
    }
  });

  main.addEventListener("submit", async (e) => {
    if (e.target.id !== "note-form") return;
    e.preventDefault();
    const f = e.target, out = $("#note-msg"), body = f.body.value.trim();
    if (!body) return AR.setMsg(out, "Écrivez une note avant de l'ajouter.", "erreur");
    const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
    const { data, error } = await sb.from("recipe_notes").insert({ recipe_id: r.id, body, private: f.private.checked }).select("*").single();
    if (error) { btn.disabled = false; return AR.setMsg(out, errMsg(error, "Impossible d'ajouter la note."), "erreur"); }
    notes.push(data); render(); toast("Note ajoutée.");
  });
})();
