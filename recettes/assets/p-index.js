(async function () {
  const AR = window.AR, { sb, $, $$, esc, norm, errMsg, setMsg, toast } = AR;
  const ctx = await AR.boot("carnet");
  if (!ctx) return;
  let books = ctx.books;
  const st = { statut: "toutes", course: "", q: "", book: AR.getBookPref() };
  const msg = $("#msg"), liste = $("#liste");

  // ---- sélecteurs
  $("#course").insertAdjacentHTML("beforeend", Object.entries(AR.COURSES).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join(""));
  function fillBooks() {
    if (st.book !== "all" && !books.some((b) => b.id === st.book)) st.book = "all";
    $("#book").innerHTML = `<option value="all">Tous</option>` + books.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("");
    $("#book").value = st.book;
  }
  fillBooks();

  // ---- invitations en attente
  async function loadInvites() {
    const box = $("#invites");
    const { data, error } = await sb.rpc("my_book_invites");
    if (error) { box.innerHTML = ""; toast(errMsg(error, "Impossible de lire vos invitations."), "erreur"); return; }
    box.innerHTML = (data || []).map((i) => `<div class="bandeau" data-id="${esc(i.id)}" role="group" aria-label="Invitation">
      <p><strong>${esc(i.invited_by_name || "Quelqu'un")}</strong> vous invite dans le carnet « ${esc(i.book_name)} »${i.role === "reader" ? " (lecture seule)" : ""}.</p>
      <div class="rangee"><button type="button" class="btn petit" data-act="accept">Accepter</button><button type="button" class="btn sec petit" data-act="decline">Refuser</button></div></div>`).join("");
  }
  $("#invites").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const id = b.closest("[data-id]").dataset.id;
    $$("#invites button").forEach((x) => (x.disabled = true));
    try {
      if (b.dataset.act === "accept") {
        const { error } = await sb.rpc("accept_book_invite", { p_invite: id });
        if (error) throw error;
        toast("Invitation acceptée. Le carnet est ajouté.");
        books = await AR.loadBooks(ctx.user.id); fillBooks();
      } else {
        const { error } = await sb.rpc("decline_book_invite", { p_invite: id });
        if (error) throw error;
        toast("Invitation refusée.");
      }
    } catch (err) { toast(errMsg(err, "Impossible de traiter l'invitation."), "erreur"); }
    await loadInvites(); load();
  });

  // ---- recettes
  const cover = (r) => { const p = (r.recipe_photos || []).find((x) => x.is_cover); return p ? p.storage_path : null; };
  const sourceOf = (r) => r.source_author || AR.host(r.source_url || "") || "";
  let seq = 0;
  async function load() {
    const my = ++seq;
    liste.setAttribute("aria-busy", "true");
    setMsg(msg, "");
    if (!books.length) { liste.innerHTML = `<div class="vide-etat"><p>Vous n'appartenez à aucun carnet pour le moment.</p></div>`; liste.setAttribute("aria-busy", "false"); return; }
    const ids = st.book === "all" ? books.map((b) => b.id) : [st.book];
    const base = () => {
      let q = sb.from("recipes").select("id,book_id,title,source_author,source_url,family,review_state,course,recipe_photos(storage_path,is_cover)")
        .in("book_id", ids).is("deleted_at", null).is("archived_at", null);
      if (st.statut === "a_verifier") q = q.eq("review_state", "a_verifier");
      if (st.statut === "famille") q = q.eq("family", true);
      if (st.course) q = q.eq("course", st.course);
      return q.order("created_at", { ascending: false }).limit(300);
    };
    let res, titleOnly = false;
    if (st.q) {
      // La recherche plein texte est calculée sur du texte sans accent (f_unaccent) : on retire les accents de la requête.
      res = await base().textSearch("search", norm(st.q), { config: "french", type: "websearch" });
      if (!res.error && !(res.data || []).length) {
        const like = st.q.replace(/[%_\\,()]/g, " ").trim();
        res = await base().ilike("title", `%${like}%`);
        titleOnly = true;
      }
    } else res = await base();
    if (my !== seq) return;
    liste.setAttribute("aria-busy", "false");
    if (res.error) { liste.innerHTML = ""; setMsg(msg, errMsg(res.error, "Impossible de charger les recettes."), "erreur"); return; }
    const rows = res.data || [];
    if (!rows.length) {
      const filtre = st.q || st.course || st.statut !== "toutes";
      liste.innerHTML = filtre
        ? `<div class="vide-etat"><p>Aucune recette ne correspond à votre recherche.</p><button type="button" class="btn sec petit" id="reset">Effacer les filtres</button></div>`
        : `<div class="vide-etat"><p class="italique">Ce carnet attend sa première recette.</p><a class="btn" href="/recettes/editer.html">Écrire une recette</a></div>`;
      const r = $("#reset"); if (r) r.addEventListener("click", resetFilters);
      return;
    }
    const urls = await AR.signedUrls(rows.map(cover).filter(Boolean));
    if (my !== seq) return;
    if (titleOnly) setMsg(msg, "Aucun résultat exact : recettes dont le titre contient votre recherche.");
    const multi = books.length > 1 && st.book === "all";
    const bookName = (id) => (books.find((b) => b.id === id) || {}).name || "";
    liste.innerHTML = `<ol class="grille-planches">${rows.map((r, i) => {
      const u = urls[cover(r)];
      const src = [sourceOf(r), multi ? bookName(r.book_id) : ""].filter(Boolean).join(" · ");
      const flags = [r.family ? "De famille" : "", r.review_state === "a_verifier" ? "À vérifier" : ""].filter(Boolean).join(" · ");
      return `<li><a class="planche" href="/recettes/fiche.html?id=${encodeURIComponent(r.id)}">
        <div class="passe-partout"><div class="cadre">${u ? `<img src="${esc(u)}" alt="" loading="lazy">` : `<span class="vide">Sans photo</span>`}</div></div>
        <div class="legende"><span class="planche-num">Planche ${String(i + 1).padStart(2, "0")}${flags ? " · " + esc(flags) : ""}</span>
        <span class="planche-titre">${esc(r.title)}</span>${src ? `<span class="planche-source">${esc(src)}</span>` : ""}</div></a></li>`;
    }).join("")}</ol>`;
  }

  function resetFilters() {
    st.q = ""; st.course = ""; st.statut = "toutes"; $("#q").value = ""; $("#course").value = ""; syncStatut(); load();
  }
  function syncStatut() { $$("[data-statut]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.statut === st.statut))); }

  // ---- événements
  $("#search-form").addEventListener("submit", (e) => { e.preventDefault(); st.q = $("#q").value.trim(); load(); });
  $("#q").addEventListener("input", () => { clearTimeout(load.t); load.t = setTimeout(() => { const v = $("#q").value.trim(); if (v !== st.q) { st.q = v; load(); } }, 350); });
  $$("[data-statut]").forEach((b) => b.addEventListener("click", () => { st.statut = b.dataset.statut; syncStatut(); load(); }));
  $("#course").addEventListener("change", (e) => { st.course = e.target.value; load(); });
  $("#book").addEventListener("change", (e) => { st.book = e.target.value; AR.setBookPref(st.book); load(); });

  loadInvites();
  load();
})();
