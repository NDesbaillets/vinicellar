(() => {
  const E = window.Eureka;
  const { sb, $, el, params, data, pages } = E;
  const state = $("#results-status");
  const form = $("#filters");
  const list = $("#ideas");
  const surprise = $("#surprise");
  const navStatus = params.get("statut");
  const page = ["planifiee", "faite"].includes(navStatus) ? navStatus : "idees";

  function trigrams(value) {
    const tokens = new Set();
    for (const word of value.toLocaleLowerCase("fr").match(/[\p{L}\p{N}]+/gu) || []) {
      const padded = "  " + word + " ";
      for (let i = 0; i < padded.length - 2; i++) tokens.add(padded.slice(i, i + 3));
    }
    return tokens;
  }

  function similarity(query, title) {
    const candidate = trigrams(title);
    const shared = [...query].filter((item) => candidate.has(item)).length;
    return shared / (query.size + candidate.size - shared || 1);
  }

  function card(idea, score, space) {
    const target = E.url("fiche.html", { id: idea.id, espace: space });
    const article = E.link(null, target, "card");
    const image = el("div", null, "card-image");
    image.append(E.visual(idea.image_path));
    if (idea.urgence >= 4) image.append(el("span", "Urgent", "badge"));
    const content = el("div");
    const metrics = el("p", null, "metrics");
    metrics.append(
      el("span", "Couple " + (score == null ? "—" : E.number.format(score) + "/10"), "couple"),
      el("span", "Urgence " + idea.urgence + "/5", idea.urgence >= 4 ? "accent" : "")
    );
    content.append(el("p", E.meta(idea), "eyebrow"), el("h2", idea.titre));
    if (idea.accroche) content.append(el("p", idea.accroche, "pitch"));
    content.append(metrics);
    article.append(image, content);
    return article;
  }

  E.boot(page, async ({ space, spaces }) => {
    const entries = (fields = "id,titre,accroche,categorie,format,type_lieu,ville,distance_nyon_km,image_path,urgence,statut,meilleure_periode,modalite") =>
      sb.from("sorties_idees").select(fields).eq("espace_id", space.id).is("fusionnee_dans", null).order("id");
    const [ideas, scores] = await Promise.all([
      pages(entries),
      pages(() => sb.from("sorties_scores_couple").select("idee_id,score").eq("espace_id", space.id).order("idee_id"))
    ]);
    const byId = new Map(scores.map((row) => [row.idee_id, row.score]));
    const categories = [...new Set(ideas.map((idea) => idea.categorie).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
    E.options(form.elements.format, E.formats, "Tous");
    E.options(form.elements.statut, E.statuts, "Tous");
    E.options(form.elements.periode, E.mois, "Toutes");
    E.options(form.elements.urgence, { 1: "1", 2: "2", 3: "3", 4: "4", 5: "5" }, "Toutes");
    E.options(form.elements.categorie, Object.fromEntries(categories.map((value) => [value, value])), "Toutes");
    E.options(form.elements.modalite, E.modalites, "Toutes");
    form.elements.statut.value = Object.hasOwn(E.statuts, navStatus) ? navStatus : "";
    if (spaces.length > 1) {
      const select = $("#space");
      E.options(select, Object.fromEntries(spaces.map((item) => [item.id, item.nom])));
      select.value = space.id;
      select.addEventListener("change", () => location.assign(E.url("", { espace: select.value })));
      $("#space-picker").hidden = false;
    }
    $("#catalogue").hidden = false;

    let request = 0;
    let visible = [];
    async function render() {
      const current = ++request;
      const filters = Object.fromEntries(new FormData(form));
      const q = filters.q.trim();
      visible = [];
      list.replaceChildren();
      surprise.hidden = true;
      E.message(state, "Recherche…");
      try {
        let matches = ideas.filter((idea) =>
          (!filters.format || idea.format === filters.format)
          && (!filters.statut || idea.statut === filters.statut)
          && (!filters.periode || idea.meilleure_periode.includes(Number(filters.periode)))
          && (!filters.urgence || idea.urgence === Number(filters.urgence))
          && (!filters.categorie || idea.categorie === filters.categorie)
          && (!filters.modalite || idea.modalite === filters.modalite)
          && (!filters.distance || (idea.distance_nyon_km != null && idea.distance_nyon_km <= Number(filters.distance))));
        const closeness = new Map();
        if (q && matches.length) {
          const normalized = await data(sb.rpc("sorties_unaccent", { texte: q }));
          // Le paramètre PostgREST accepte un nom simple. PostgreSQL résout french dans pg_catalog.
          const found = await pages(() => entries("id").textSearch("tsv", normalized, { config: "french", type: "websearch" }));
          const matchingIds = new Set(found.map((idea) => idea.id));
          const fullText = matches.filter((idea) => matchingIds.has(idea.id));
          if (fullText.length) matches = fullText;
          else {
            const query = trigrams(normalized);
            for (const idea of matches) {
              const title = idea.titre.normalize("NFD").replace(/\p{M}/gu, "").replaceAll("œ", "oe").replaceAll("Œ", "OE");
              closeness.set(idea.id, similarity(query, title));
            }
            matches = matches.filter((idea) => closeness.get(idea.id) >= 0.3);
          }
        }
        if (current !== request) return;
        const score = (idea) => byId.get(idea.id) ?? -1;
        matches.sort((a, b) => {
          const difference = filters.tri === "urgence" ? b.urgence - a.urgence : score(b) - score(a);
          return difference || (closeness.get(b.id) || 0) - (closeness.get(a.id) || 0) || a.titre.localeCompare(b.titre, "fr");
        });
        visible = matches;
        list.append(...matches.map((idea) => card(idea, byId.get(idea.id), space.id)));
        surprise.hidden = !visible.length;
        E.message(state, matches.length ? "" : ideas.length ? "Aucune idée ne correspond à ces critères." : "Cet espace ne contient encore aucune idée.");
      } catch {
        if (current === request) E.message(state, "La recherche est indisponible. Réessayez.", true);
      }
    }

    form.addEventListener("submit", (event) => { event.preventDefault(); render(); });
    form.addEventListener("change", (event) => { if (event.target.name !== "q") render(); });
    surprise.addEventListener("click", () => {
      const idea = visible[Math.floor(Math.random() * visible.length)];
      if (idea) location.assign(E.url("fiche.html", { id: idea.id, espace: space.id }));
    });
    await render();
  });
})();
