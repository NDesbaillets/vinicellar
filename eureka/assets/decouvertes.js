(() => {
  const E = window.Eureka;
  const { sb, el, data, pages } = E;

  function eventKey(item) {
    return [item.titre, item.ville].map((value) => (value || "").toLowerCase()
      .normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, " ").trim()).join("|");
  }

  function sourceKey(value) {
    const href = E.safeUrl(value);
    if (!href) return null;
    const url = new URL(href);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_")) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.href.replace(/\/$/, "");
  }

  function recommendedSources(place) {
    const city = eventKey({ titre: place.ville }).split("|")[0];
    if (city === "nyon") return [
      "https://www.nyon.ch/", "https://www.myvaud.ch/", "https://www.myswitzerland.com/",
      "https://torpille.ch/activites-region-lausanne/"
    ];
    if (city === "zermatt") return ["https://zermatt.swiss/", "https://www.valais.ch/", "https://www.myswitzerland.com/"];
    if (city === "saint andre d olerargues") return ["https://www.gard-tourisme.com/", "https://www.provenceoccitane.com/", "https://www.tourisme-occitanie.com/"];
    return [];
  }

  function customSources(departureKey, place) {
    try {
      const value = JSON.parse(localStorage.getItem(departureKey + ".sources." + place.id) || "[]");
      return Array.isArray(value) ? value.map(sourceKey).filter(Boolean).slice(0, 3) : [];
    } catch { return []; }
  }

  function searchSources(departureKey, place) {
    return [...new Set([...recommendedSources(place).map(sourceKey), ...customSources(departureKey, place)])];
  }

  async function find(scope, request, earlier = []) {
    const existing = await pages(() => sb.from("sorties_idees").select("id,titre,ville,source_url")
      .eq("espace_id", scope.espace).is("fusionnee_dans", null).order("id"));
    const titles = new Set([...existing, ...earlier].map(eventKey));
    const sources = new Set([...existing.map((item) => sourceKey(item.source_url)), ...earlier.map((item) => sourceKey(item.source))].filter(Boolean));
    const result = await data(sb.functions.invoke("sorties-enrich", {
      body: { action: "decouvrir", espace: scope.espace, ...request, deja_vus: earlier.slice(-24).map((item) => item.source) }
    }));
    if (!Array.isArray(result?.sorties)) throw new Error();
    return result.sorties.filter((item) => {
      const source = sourceKey(item.source);
      const key = eventKey(item);
      if (!source || titles.has(key) || sources.has(source)) return false;
      titles.add(key);
      sources.add(source);
      return true;
    });
  }

  function card(item, scope, departure, official) {
    const row = el("li", null, "discovery-card");
    const host = new URL(item.source).hostname.replace(/^www\./, "");
    const source = E.link((official ? "Source officielle · " : "Source · ") + host, item.source, "button");
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    const editor = E.url("editer.html", { ...scope, depart: departure.id }) + "#decouverte=" + encodeURIComponent(JSON.stringify(item));
    const actions = el("div", null, "actions");
    actions.append(source, E.link("Ajouter au recueil", editor, "button"));
    row.append(el("h3", item.titre), el("p", [item.date && E.date(item.date), item.ville].filter(Boolean).join(" · ")),
      el("p", item.description), actions);
    return row;
  }

  window.EurekaDiscoveries = { sourceKey, customSources, searchSources, find, card };
})();
