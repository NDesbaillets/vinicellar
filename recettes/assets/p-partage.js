// ARÔMES V&N · page publique d'une recette partagée (sans compte). Lit ?t=<jeton>, appelle la fonction recipe-public.
(async function () {
  const AR = window.AR, { $, esc } = AR;
  const main = $("#main");
  const fail = (t) => { main.setAttribute("aria-busy", "false"); main.innerHTML = `<div class="vide-etat"><p role="alert">${esc(t)}</p></div>`; };
  const token = new URLSearchParams(location.search).get("t") || "";
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return fail("Ce lien est incomplet ou invalide.");
  const cfg = AR.cfg;
  if (!cfg.supabaseUrl) return fail("Le service n'est pas disponible pour le moment.");

  let d;
  try {
    // Requête simple (sans en-tête personnalisé, donc sans préalable CORS) : la clé publique passe en paramètre.
    const res = await fetch(`${cfg.supabaseUrl}/functions/v1/recipe-public?t=${encodeURIComponent(token)}&apikey=${encodeURIComponent(cfg.supabaseAnonKey || "")}`, { headers: { Accept: "application/json" }, referrerPolicy: "no-referrer", credentials: "omit" });
    if (res.status === 404) return fail("Ce lien n'est plus valide : la recette a été retirée, ou son partage a été interrompu.");
    if (res.status === 429) return fail("Trop de demandes en peu de temps. Réessayez dans une minute.");
    if (!res.ok) return fail("La recette n'a pas pu être chargée. Réessayez dans un instant.");
    d = await res.json();
  } catch (e) { console.error(e); return fail("Connexion impossible. Vérifiez votre réseau et réessayez."); }
  if (!d || !d.title) return fail("La recette n'a pas pu être lue.");

  document.title = `${d.title} · ARÔMES V&N`;
  const photos = (d.photos || []).filter((p) => AR.safeUrl(p.url));
  const cover = photos.find((p) => p.cover) || photos[0] || null;
  const others = photos.filter((p) => p !== cover);
  const meta = [d.course ? AR.COURSES[d.course] || "" : "", d.cuisine || ""].filter(Boolean).join(" · ");
  const chiffres = [];
  if (d.servings != null) chiffres.push(["Portions", String(d.servings), d.servings_estimated]);
  if (d.time_active_min != null) chiffres.push(["Préparation", AR.fmtMin(d.time_active_min), d.time_active_estimated]);
  if (d.time_total_min != null) chiffres.push(["Temps total", AR.fmtMin(d.time_total_min), d.time_total_estimated]);
  if (d.difficulty) chiffres.push(["Difficulté", AR.DIFFICULTES[d.difficulty] || "", false]);

  // Crédit : le créateur est toujours cité, avec un lien vers la source quand elle existe.
  const c = d.credit || {}, curl = AR.safeUrl(c.url || "");
  const who = c.author || (curl ? AR.host(curl) : "");
  const credit = who ? `<p class="fiche-source">${c.author ? "Recette de " : "Source : "}${curl ? `<a href="${esc(curl)}" target="_blank" rel="noopener noreferrer nofollow">${esc(who)}</a>` : esc(who)}${c.author && curl ? ` · <a href="${esc(curl)}" target="_blank" rel="noopener noreferrer nofollow">${esc(AR.host(curl))}</a>` : ""}</p>` : "";

  const groups = [];
  (d.ingredients || []).forEach((l) => {
    const g = (l.group_label || "").trim();
    let grp = groups[groups.length - 1];
    if (!grp || grp.g !== g) { grp = { g, items: [] }; groups.push(grp); }
    grp.items.push(l);
  });
  const ing = (l) => {
    const has = l.quantity != null;
    const prec = has && l.precision ? ` <span class="prec">(${esc(l.precision)})</span>` : "";
    return `<li class="ing"><span class="nom">${esc(l.label_original)}${prec}${l.optional ? ` <span class="prec">(facultatif)</span>` : ""}</span><span class="guide" aria-hidden="true"></span>${has ? `<span class="qte">${esc(AR.fmtLine(l))}</span>` : `<span class="qte inconnue">${esc(l.precision || "q.b.")}</span>`}</li>`;
  };

  main.setAttribute("aria-busy", "false");
  main.innerHTML = `
    <div class="fiche-photo"><div class="passe-partout"><div class="cadre">${cover ? `<img src="${esc(cover.url)}" alt="${esc(d.title)}" referrerpolicy="no-referrer">` : `<span class="vide">Sans photo</span>`}</div></div>${cover && cover.kind === "illustration" ? `<p class="ga-mention">illustration</p>` : ""}</div>
    ${meta ? `<p class="libelle or centre" style="margin:0 0 8px">${esc(meta)}</p>` : ""}
    <h1 class="fiche-titre">${esc(d.title)}</h1>
    ${d.title_original ? `<p class="fiche-orig">${esc(d.title_original)}</p>` : ""}
    ${credit}
    <span class="filet" style="margin:18px auto 0" aria-hidden="true"></span>
    ${d.summary ? `<p class="fiche-orig" style="margin-top:16px">${esc(d.summary)}</p>` : ""}
    ${chiffres.length ? `<div class="chiffres">${chiffres.map(([l, v, est]) => `<div><span class="libelle">${esc(l)}</span><span class="valeur">${esc(v)}</span>${est ? `<span class="est">estimé</span>` : ""}</div>`).join("")}</div>` : ""}
    <h2 class="section">Ingrédients</h2><span class="filet" aria-hidden="true"></span>
    ${groups.length ? groups.map((g) => `${g.g ? `<h3 class="groupe">${esc(g.g)}</h3>` : ""}<ul class="ingredients">${g.items.map(ing).join("")}</ul>`).join("") : `<p class="muted italique">Aucun ingrédient indiqué.</p>`}
    <h2 class="section">Préparation</h2><span class="filet" aria-hidden="true"></span>
    ${(d.steps || []).length ? `<ol class="etapes">${d.steps.map((s, i) => `<li class="etape"><span class="num" aria-hidden="true">${i + 1}</span><div><p><span class="sr-only">Étape ${i + 1}. </span>${esc(s.text)}</p>${s.timer_seconds ? `<span class="libelle or minuteur">Minuteur : ${esc((s.timer_seconds < 60 ? s.timer_seconds + " s" : AR.fmtMin(Math.round(s.timer_seconds / 60))))}</span>` : ""}</div></li>`).join("")}</ol>` : `<p class="muted italique">Aucune étape indiquée.</p>`}
    ${others.length ? `<h2 class="section">Photos</h2><span class="filet" aria-hidden="true"></span><ul class="ga-liste">${others.map((p) => `<li class="ga-item"><figure class="ga-fig"><div class="passe-partout"><div class="cadre"><img src="${esc(p.url)}" alt="Photo de ${esc(d.title)}" loading="lazy" referrerpolicy="no-referrer"></div></div>${p.kind === "illustration" ? `<figcaption class="ga-leg"><span class="ga-mention">illustration</span></figcaption>` : ""}</figure></li>`).join("")}</ul>` : ""}`;
})();
