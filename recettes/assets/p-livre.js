// ARÔMES V&N · livre du carnet : page imprimable (A4), couverture, sommaire, une recette par page.
// Données : contrat 06-transmettre §4. Notes partagées uniquement (jamais les notes privées, même les siennes).
// CONFIDENTIALITÉ (docs/recettes/07-invites-contrat.md §5, cadrage §9) : Le livre ne lit AUCUNE table d'invités ni de réceptions (recipe_guests, recipe_receptions*, recipe_served_to) : allergies et régimes de tiers sont des données de santé, jamais exposées ici.
(async function () {
  const AR = window.AR, { sb, $, esc, errMsg } = AR;
  const ctx = await AR.boot("carnets");
  if (!ctx) return;
  const main = $("#main"), etat = $("#lv-etat"), out = $("#lv-livre"), btn = $("#lv-print");
  const bookId = new URLSearchParams(location.search).get("book");
  const book = ctx.books.find((b) => b.id === bookId);
  main.setAttribute("aria-busy", "false");
  if (!book) { etat.textContent = ""; out.innerHTML = `<div class="vide-etat"><p role="alert">Carnet introuvable, ou vous n'y avez pas accès.</p><a class="btn sec petit" href="/recettes/carnets.html">Retour aux carnets</a></div>`; return; }
  document.title = `Livre · ${book.name} · ARÔMES V&N`;

  const ORDRE = ["entree", "plat", "dessert", "accompagnement", "boisson", "autre"];
  const chunk = async (table, ids, select, extra) => {
    const res = [];
    for (let i = 0; i < ids.length; i += 100) {
      let q = sb.from(table).select(select).in("recipe_id", ids.slice(i, i + 100));
      if (extra) q = extra(q);
      const { data, error } = await q;
      if (error) throw error;
      res.push(...(data || []));
    }
    return res;
  };

  let recs, lines, steps, photos, notes, people = new Map(), skipped = 0;
  try {
    const rr = await sb.from("recipes").select("*").eq("book_id", book.id).is("deleted_at", null).is("archived_at", null);
    if (rr.error) throw rr.error;
    const all = rr.data || [];
    // Une fiche « à vérifier » n'a pas été relue : elle n'entre pas dans un livre destiné à être donné.
    recs = all.filter((r) => r.review_state !== "a_verifier");
    skipped = all.length - recs.length;
    const ci = (c) => { const i = ORDRE.indexOf(c || "autre"); return i < 0 ? 5 : i; };
    recs.sort((a, b) => ci(a.course) - ci(b.course) || a.title.localeCompare(b.title, "fr"));
    const ids = recs.map((r) => r.id);
    [lines, steps, photos, notes] = await Promise.all([
      chunk("recipe_ingredient_lines", ids, "*"), chunk("recipe_steps", ids, "*"),
      chunk("recipe_photos", ids, "recipe_id,kind,is_cover,storage_path,created_at", (q) => q.neq("kind", "cuisson").neq("kind", "page")),
      chunk("recipe_notes", ids, "*", (q) => q.eq("private", false).order("created_at"))]);
    const pe = await sb.rpc("book_people", { b: book.id });
    (pe.data || []).forEach((x) => people.set(x.user_id, x.full_name || ""));
  } catch (e) { etat.textContent = ""; out.innerHTML = `<p class="msg erreur" role="alert">${esc(errMsg(e, "Impossible de charger le carnet."))}</p>`; return; }

  const by = (arr, id) => arr.filter((x) => x.recipe_id === id);
  const coverOf = (id) => { const p = by(photos, id); return p.find((x) => x.is_cover) || p.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0] || null; };
  const urls = {};
  for (let i = 0, ps = recs.map((r) => (coverOf(r.id) || {}).storage_path).filter(Boolean); i < ps.length; i += 100) Object.assign(urls, await AR.signedUrls(ps.slice(i, i + 100)));

  const dd = AR.fmtDay(AR.todayIso());
  const num = (i) => String(i + 1).padStart(2, "0");
  const chapitre = (r) => AR.COURSES[ORDRE.includes(r.course) ? r.course : "autre"] || "Autre";

  function recetteHtml(r, i) {
    const l = by(lines, r.id).sort((a, b) => a.position - b.position), s = by(steps, r.id).sort((a, b) => a.position - b.position), n = by(notes, r.id);
    const cov = coverOf(r.id), u = cov && urls[cov.storage_path];
    const curl = AR.safeUrl(r.source_url || ""), cred = [r.source_author ? "Recette de " + r.source_author : "", curl ? AR.host(curl) : ""].filter(Boolean).join(" · ");
    const ch = [];
    if (r.servings != null) ch.push(`${r.servings} portion${r.servings > 1 ? "s" : ""}`);
    if (r.time_active_min != null) ch.push(`préparation ${AR.fmtMin(r.time_active_min)}`);
    if (r.time_total_min != null) ch.push(`total ${AR.fmtMin(r.time_total_min)}`);
    if (r.difficulty) ch.push((AR.DIFFICULTES[r.difficulty] || "").toLowerCase());
    const groups = [];
    l.forEach((x) => { const g = (x.group_label || "").trim(); let grp = groups[groups.length - 1]; if (!grp || grp.g !== g) { grp = { g, items: [] }; groups.push(grp); } grp.items.push(x); });
    const ing = (x) => `<li class="lv-ing"><span class="lv-nom">${esc(x.label_original)}${x.quantity != null && x.precision ? ` <i>(${esc(x.precision)})</i>` : ""}${x.optional ? " <i>(facultatif)</i>" : ""}</span><span class="lv-qte${x.quantity == null ? " inconnue" : ""}">${esc(x.quantity != null ? AR.fmtLine(x) : x.precision || "q.b.")}</span></li>`;
    return `<article class="lv-page lv-recette" id="r-${esc(r.id)}">
      <header class="lv-rt"><p class="lv-surtitre">Planche ${num(i)} · ${esc(chapitre(r))}${r.family ? " · De famille" : ""}</p><h2 class="lv-titre">${esc(r.title)}</h2>
        ${cred ? `<p class="lv-credit">${esc(cred)}</p>` : ""}${ch.length ? `<p class="lv-chiffres">${esc(ch.join(" · "))}</p>` : ""}<span class="lv-filet" aria-hidden="true"></span></header>
      <div class="lv-corps"><div class="lv-gauche">
        <figure class="lv-photo"><div class="passe-partout"><div class="cadre">${u ? `<img src="${esc(u)}" alt="${esc(r.title)}" data-lv>` : `<span class="vide">Sans photo</span>`}</div></div>${cov && cov.kind === "illustration" ? `<figcaption>illustration</figcaption>` : ""}</figure>
        <h3 class="lv-h">Ingrédients</h3>${groups.length ? groups.map((g) => `${g.g ? `<p class="lv-groupe">${esc(g.g)}</p>` : ""}<ul class="lv-ings">${g.items.map(ing).join("")}</ul>`).join("") : `<p class="lv-vide">Aucun ingrédient saisi.</p>`}
        ${n.length ? `<h3 class="lv-h">En marge</h3>${n.map((x) => `<div class="lv-marge"><p>${esc(x.body)}</p>${people.get(x.author_id) ? `<span class="lv-meta">${esc(people.get(x.author_id))}</span>` : ""}</div>`).join("")}` : ""}
      </div><div class="lv-droite"><h3 class="lv-h">Préparation</h3>${s.length ? `<ol class="lv-etapes">${s.map((x, k) => `<li class="lv-etape"><span class="lv-num" aria-hidden="true">${k + 1}</span><p><span class="sr-only">Étape ${k + 1}. </span>${esc(x.text)}</p></li>`).join("")}</ol>` : `<p class="lv-vide">Aucune étape saisie.</p>`}</div></div></article>`;
  }

  // Sommaire : numéros de planche (les numéros de page dépendent de l'impression).
  let sommaire = "";
  let cur = null;
  recs.forEach((r, i) => {
    const c = chapitre(r);
    if (c !== cur) { sommaire += `${cur ? "</ol>" : ""}<h3 class="lv-chap">${esc(c)}</h3><ol class="lv-som">`; cur = c; }
    sommaire += `<li><a href="#r-${esc(r.id)}"><span class="lv-som-n">${num(i)}</span><span class="lv-som-t">${esc(r.title)}</span></a></li>`;
  });
  if (cur) sommaire += "</ol>";

  out.innerHTML = `<section class="lv-page lv-couverture" aria-label="Couverture">
      <img class="lv-logo" src="/recettes/assets/logo-aromes-vn-recadre.svg" alt="ARÔMES V&amp;N" width="260" height="140">
      <span class="lv-filet lv-filet-c" aria-hidden="true"></span>
      <h1 class="lv-nom-carnet">${esc(book.name)}</h1>
      <p class="lv-sous">${recs.length} recette${recs.length > 1 ? "s" : ""}</p><p class="lv-sous">${esc(dd)}</p></section>
    <section class="lv-page lv-sommaire" aria-label="Sommaire"><h2 class="chapitre">Sommaire</h2><span class="filet" aria-hidden="true"></span>${recs.length ? sommaire : `<p class="muted italique">Ce carnet ne contient encore aucune recette relue.</p>`}</section>
    ${recs.map(recetteHtml).join("")}`;

  // Attendre les images avant d'autoriser l'impression.
  const imgs = [...document.querySelectorAll("img[data-lv]")];
  etat.textContent = imgs.length ? `Chargement de ${imgs.length} photo${imgs.length > 1 ? "s" : ""}…` : "";
  await Promise.all(imgs.map((im) => Promise.race([im.decode().catch(() => {}), new Promise((ok) => setTimeout(ok, 10000))])));
  const failed = imgs.filter((im) => !im.complete || im.naturalWidth === 0).length;
  etat.className = "msg" + (failed ? " erreur" : "");
  etat.textContent = `${recs.length} recette${recs.length > 1 ? "s" : ""} prête${recs.length > 1 ? "s" : ""} à imprimer${skipped ? ` (${skipped} fiche${skipped > 1 ? "s" : ""} à vérifier laissée${skipped > 1 ? "s" : ""} de côté)` : ""}.${failed ? ` ${failed} photo${failed > 1 ? "s" : ""} n'${failed > 1 ? "ont" : "a"} pas pu être chargée${failed > 1 ? "s" : ""}.` : ""} Choisissez « Enregistrer au format PDF » dans la fenêtre d'impression.`;
  btn.disabled = !recs.length;
  btn.addEventListener("click", () => window.print());
})();
