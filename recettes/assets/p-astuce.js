// ARÔMES V&N · fiche d'une astuce (contrat 08-astuces-contrat.md §3).
(async function () {
  const AR = window.AR, { sb, $, $$, esc, toast, fmtDate } = AR;
  const ctx = await AR.boot("carnet");
  AR.swipeBack("./");
  if (!ctx) return;
  const main = $("#main");
  const id = new URLSearchParams(location.search).get("id");
  const fail = (t) => { main.setAttribute("aria-busy", "false"); main.innerHTML = `<div class="vide-etat"><p role="alert">${esc(t)}</p><a class="btn sec petit" href="/recettes/">Retour au carnet</a></div>`; };
  if (!id) return fail("Aucune astuce indiquée.");

  let t, ings = [], recs = [], photos = [];
  try {
    const tt = await sb.from("recipe_tips").select("*").eq("id", id).maybeSingle();
    if (tt.error) throw tt.error;
    if (!tt.data) return fail("Astuce introuvable, ou vous n'avez pas accès à son carnet.");
    t = tt.data;
  } catch (e) { return fail(AR.tipErr(e, "Impossible de charger l'astuce.")); }
  // Liens et photos : une erreur ici ne bloque jamais la fiche (hors ligne, par exemple).
  try {
    const [i, r, p] = await Promise.all([
      sb.from("recipe_tip_ingredients").select("catalog_id,recipe_ingredients_catalog(name)").eq("tip_id", id),
      sb.from("recipe_tip_recipes").select("recipe_id,recipes(id,title,deleted_at)").eq("tip_id", id),
      sb.from("recipe_tip_photos").select("*").eq("tip_id", id)
    ]);
    if (i.error) console.error(i.error); else ings = (i.data || []).map((x) => x.recipe_ingredients_catalog && x.recipe_ingredients_catalog.name).filter(Boolean).sort((a, b) => a.localeCompare(b, "fr"));
    if (r.error) console.error(r.error); else recs = (r.data || []).map((x) => x.recipes).filter((x) => x && !x.deleted_at);
    if (p.error) console.error(p.error); else photos = p.data || [];
  } catch (e) { console.error(e); }

  const book = ctx.books.find((b) => b.id === t.book_id);
  const editor = !!book && (book.role === "owner" || book.role === "member");
  document.title = `${t.title} · ARÔMES V&N`;
  const isPdf = (x) => /\.pdf$/i.test(x.storage_path || "");
  const pages = photos.filter((x) => x.kind === "page").sort((a, b) => a.storage_path.localeCompare(b.storage_path, "fr", { numeric: true }));
  const cover = photos.find((x) => x.is_cover && !isPdf(x)) || null;
  const autres = photos.filter((x) => x.kind !== "page" && !isPdf(x) && x !== cover);
  const urls = await AR.signedUrls(photos.map((x) => x.storage_path).filter(Boolean));
  const alerts = (Array.isArray(t.alerts) ? t.alerts : []).map(AR.alertText).filter(Boolean);
  const hasOrig = !!(t.title_original || t.body_original);
  const safeLang = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(t.lang_original || "") ? t.lang_original : "";
  const view = { lang: "fr" };
  let busy = false;

  function render() {
    const orig = view.lang === "orig" && hasOrig;
    const titre = orig ? (t.title_original || t.title) : t.title;
    const corps = orig ? (t.body_original || t.body) : t.body;
    const srcUrl = AR.safeUrl(t.source_url || "");
    const source = [t.source_type === "note" ? "Importée d'une note" : "", t.source_author ? esc(t.source_author) : "", srcUrl ? `<a href="${esc(srcUrl)}" target="_blank" rel="noopener noreferrer">${esc(AR.host(srcUrl))}</a>` : ""].filter(Boolean).join(" · ");
    const trash = t.deleted_at
      ? `<div class="bandeau" role="status"><p>Cette astuce est dans la corbeille depuis le ${esc(fmtDate(t.deleted_at))}.</p>${editor ? `<button type="button" class="btn petit" data-act="restore">Restaurer</button>` : ""}</div>` : "";
    const verif = t.review_state === "a_verifier";
    const noteHtml = verif
      ? `<aside class="note-avant" aria-labelledby="nav-t"><h2 id="nav-t">À vérifier</h2>
        ${alerts.length ? `<ul>${alerts.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
        <p>Cette astuce a été importée : relisez-la avant de vous y fier.</p>
        ${editor ? `<button type="button" class="btn" data-act="verify">C'est bon</button>` : ""}</aside>`
      : alerts.length ? `<details class="note-avant repliee"><summary>Remarques <span class="muted">(${alerts.length})</span></summary><ul>${alerts.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></details>` : "";
    const bascule = hasOrig ? `<div class="bascules"><div class="onglets" role="group" aria-label="Langue du texte"><button type="button" class="onglet" data-lang="fr" aria-pressed="${!orig}">Traduction</button><button type="button" class="onglet" data-lang="orig" aria-pressed="${orig}">Version originale</button></div></div>` : "";
    const lg = orig && safeLang ? ` lang="${esc(safeLang)}"` : "";
    const imgFig = (x, i, lib) => urls[x.storage_path] ? `<figure><a href="${esc(urls[x.storage_path])}" target="_blank" rel="noopener noreferrer"><div class="passe-partout"><img src="${esc(urls[x.storage_path])}" alt="${esc(lib)} ${i + 1}" loading="lazy"></div></a><figcaption class="libelle">${esc(lib)} ${i + 1}</figcaption></figure>` : "";
    const pagesVisibles = pages.filter((x) => urls[x.storage_path]);
    const pagesHtml = pagesVisibles.length
      ? `<details class="pages-orig"><summary>${pagesVisibles.length > 1 ? "Pages d'origine" : "Page d'origine"} <span class="muted">(${pagesVisibles.length})</span></summary>
        <div class="pages-photo">${pagesVisibles.map((x, i) => isPdf(x) ? `<p><a class="btn sec petit" href="${esc(urls[x.storage_path])}" target="_blank" rel="noopener noreferrer">Ouvrir le PDF${pagesVisibles.length > 1 ? ` (${i + 1})` : ""}</a></p>` : imgFig(x, i, "Page")).join("")}</div></details>` : "";
    const autresHtml = autres.some((x) => urls[x.storage_path]) ? `<div class="pages-photo">${autres.map((x, i) => imgFig(x, i, "Photo")).join("")}</div>` : "";
    main.setAttribute("aria-busy", "false");
    main.innerHTML = `${trash}
      <p><a href="/recettes/">← Le carnet</a></p>
      ${cover && urls[cover.storage_path] ? `<div class="fiche-photo"><div class="passe-partout"><div class="cadre"><img src="${esc(urls[cover.storage_path])}" crossorigin="anonymous" alt="${esc(t.title)}"></div></div></div>` : ""}
      <p class="libelle or centre" style="margin:0 0 8px">Astuce${t.category ? " · " + esc(AR.TIP_CATS[t.category] || t.category) : ""}</p>
      <h1 class="fiche-titre"${lg}>${esc(titre)}</h1>
      ${t.title_original && !orig ? `<p class="fiche-orig">${esc(t.title_original)}</p>` : ""}
      ${source ? `<p class="fiche-source">${source}</p>` : ""}
      <span class="filet" style="margin:18px auto 0" aria-hidden="true"></span>
      ${bascule}
      ${noteHtml}
      <div class="astuce-corps"${lg}>${esc(corps)}</div>
      ${autresHtml}
      ${ings.length ? `<h2 class="section">Ingrédients liés</h2><span class="filet" aria-hidden="true"></span><ul class="tip-puces">${ings.map((n) => `<li class="tip-puce">${esc(n)}</li>`).join("")}</ul>` : ""}
      ${recs.length ? `<h2 class="section">Recettes liées</h2><span class="filet" aria-hidden="true"></span><ul class="tip-recettes">${recs.map((r) => `<li><a href="/recettes/fiche.html?id=${encodeURIComponent(r.id)}">${esc(r.title)}</a></li>`).join("")}</ul>` : ""}
      ${pagesHtml}
      <p class="muted italique" style="margin-top:24px">Ajoutée le ${esc(fmtDate(t.created_at))}${t.updated_at && fmtDate(t.updated_at) !== fmtDate(t.created_at) ? `, modifiée le ${esc(fmtDate(t.updated_at))}` : ""}.</p>
      ${editor && !t.deleted_at ? `<div class="actions-bas"><a class="btn" href="/recettes/editer-astuce.html?id=${encodeURIComponent(t.id)}">Modifier</a><button type="button" class="btn danger" data-act="trash">Mettre à la corbeille</button>
        ${t.import_id ? `<button type="button" class="btn sec" data-act="retype">C'est plutôt une recette</button>` : ""}</div><p class="msg" id="msg" role="status" aria-live="polite"></p>` : ""}`;
  }
  render();

  async function patch(fields, okText) {
    const { data, error } = await sb.from("recipe_tips").update(fields).eq("id", t.id).select("*").single();
    if (error) { toast(AR.tipErr(error, "Modification impossible."), "erreur"); return false; }
    t = data; if (okText) toast(okText); render(); return true;
  }
  main.addEventListener("click", async (e) => {
    const lg = e.target.closest("[data-lang]");
    if (lg) { view.lang = lg.dataset.lang; render(); const n = $(`[data-lang="${view.lang}"]`); if (n) n.focus(); return; }
    const b = e.target.closest("button[data-act]");
    if (!b || !editor || busy) return;
    const act = b.dataset.act;
    if (act === "verify") return void patch({ review_state: "valide" }, "Astuce validée.");
    if (act === "restore") return void patch({ deleted_at: null }, "Astuce restaurée.");
    if (act === "trash") {
      if (!confirm("Mettre cette astuce à la corbeille ? Vous pourrez la restaurer pendant 30 jours.")) return;
      b.disabled = true;
      const ok = await patch({ deleted_at: new Date().toISOString() });
      if (ok) { toast("Astuce mise à la corbeille."); setTimeout(() => location.assign("/recettes/"), 700); } else b.disabled = false;
    }
    if (act === "retype") {
      if (!confirm("Relire la source comme une recette ? L'astuce ira à la corbeille et une fiche recette sera créée.")) return;
      busy = true; $$(".actions-bas .btn", main).forEach((x) => { x.disabled = true; x.setAttribute("aria-disabled", "true"); });
      const out = $("#msg"); AR.setMsg(out, "Nouvelle lecture en cours, de 10 à 60 secondes. Ne quittez pas la page.");
      try {
        const href = await AR.retype(t.import_id, "recette", null, (s) => AR.setMsg(out, s));
        toast("Fiche recette créée."); location.assign(href);
      } catch (err) {
        busy = false; $$(".actions-bas .btn", main).forEach((x) => { x.disabled = false; x.removeAttribute("aria-disabled"); });
        AR.setMsg(out, err.message || "Le changement de type a échoué.", "erreur");
      }
    }
  });
})();
