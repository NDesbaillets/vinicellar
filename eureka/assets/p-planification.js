(() => {
  const E = window.Eureka;
  const { sb, $, el, data, pages } = E;
  const DAYS = 7;
  const millisecondsPerDay = 86_400_000;
  const timeZone = "Europe/Zurich";
  const weekday = new Intl.DateTimeFormat("fr-CH", { weekday: "long", timeZone: "UTC" });
  const clock = new Intl.DateTimeFormat("fr-CH", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
  const offset = new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "longOffset" });
  const picker = $("#agenda-date");
  const rows = $("#agenda-days");

  function dayPlus(day, count) {
    return new Date(Date.parse(day + "T00:00:00Z") + count * millisecondsPerDay).toISOString().slice(0, 10);
  }

  function midnight(day) {
    const utc = new Date(day + "T00:00:00Z");
    const zone = offset.formatToParts(utc).find((part) => part.type === "timeZoneName").value.replace("GMT", "");
    // À minuit UTC, les changements d'heure suisses de la journée n'ont pas encore eu lieu.
    return new Date(day + "T00:00:00" + (zone || "Z"));
  }

  function displayBusy(entry, start, stop) {
    const from = new Date(entry.debut);
    const until = new Date(entry.fin);
    if (from <= start && until >= stop) return "Toute la journée";
    if (from <= start) return "Jusqu’à " + clock.format(until);
    if (until >= stop) return "Dès " + clock.format(from);
    return clock.format(from) + " – " + clock.format(until);
  }

  function ideaLink(ctx, idea, id, extra = {}, anchor = "") {
    return E.link(idea.titre, E.url("fiche.html", { espace: ctx.space.id, id, ...extra }) + anchor);
  }

  async function drawPlanningIdeas(ctx) {
    const taskStatus = $("#planning-tasks-status");
    const suggestionStatus = $("#planning-suggestions-status");
    const space = ctx.space.id;
    const getTasks = E.annualPlanningTasks(space).then((tasks) => {
      const entries = tasks.map(({ idea, season }) => {
        const item = el("li");
        item.append(ideaLink(ctx, idea, idea.id, { saison: season.start }, ctx.editor ? "#plan-form" : "#annual-season"),
          el("p", E.seasonLabel(season)));
        return item;
      });
      $("#planning-tasks").replaceChildren(...entries);
      E.message(taskStatus, tasks.length ? "" : "Aucune activité annuelle à planifier.");
      return new Set(tasks.map(({ idea }) => idea.id));
    }).catch(() => {
      E.message(taskStatus, "Les activités annuelles sont indisponibles.", true);
      return new Set();
    });
    try {
      const [ideas, scores, annualIds] = await Promise.all([
        pages(() => sb.from("sorties_idees").select("id,titre,statut,urgence,ville,date_debut,date_fin,date_limite_reservation,sorties_occurrences(statut)")
          .eq("espace_id", space).is("fusionnee_dans", null).in("statut", ["envie", "preselection"]).order("id")),
        pages(() => sb.from("sorties_scores_couple").select("idee_id,score").eq("espace_id", space).order("idee_id")),
        getTasks
      ]);
      const score = new Map(scores.map((entry) => [entry.idee_id, entry.score ?? -1]));
      const today = E.swissDay();
      const suggestions = ideas.filter((idea) => !annualIds.has(idea.id)
        && !(idea.sorties_occurrences || []).some((item) => item.statut !== "annulee")
        && (!idea.date_limite_reservation || idea.date_limite_reservation >= today)
        && (!(idea.date_fin || idea.date_debut) || (idea.date_fin || idea.date_debut) >= today));
      suggestions.sort((a, b) => Number(b.statut === "preselection") - Number(a.statut === "preselection")
        || b.urgence - a.urgence || (score.get(b.id) ?? -1) - (score.get(a.id) ?? -1)
        || a.titre.localeCompare(b.titre, "fr"));
      const entries = suggestions.slice(0, 5).map((idea) => {
        const item = el("li");
        const facts = [idea.statut === "preselection" ? "Présélectionnée" : "Envie", idea.ville,
          idea.date_limite_reservation ? "Réserver avant le " + E.date(idea.date_limite_reservation) : null].filter(Boolean);
        item.append(ideaLink(ctx, idea, idea.id, {}, ctx.editor ? "#plan-form" : ""), el("p", facts.join(" · ")));
        return item;
      });
      $("#planning-suggestions").replaceChildren(...entries);
      E.message(suggestionStatus, entries.length ? "" : "Aucune suggestion à planifier.");
    } catch {
      E.message(suggestionStatus, "Les suggestions sont indisponibles.", true);
    }
  }

  E.boot("planification", async (ctx) => {
    const status = $("#agenda-status");
    const range = $("#agenda-range");
    let first = E.swissDay();
    let generation = 0;
    const calendarAccess = data(sb.rpc("sorties_agenda_actif", { p_espace: ctx.space.id })).catch(() => false);
    $("#planned-catalogue").href = E.url("", { espace: ctx.space.id, statut: "planifiee" });

    async function render() {
      const current = ++generation;
      const start = first;
      const limit = dayPlus(start, DAYS);
      picker.value = start;
      range.textContent = "Du " + E.date(start) + " au " + E.date(dayPlus(start, DAYS - 1));
      E.message(status, "Chargement de l’agenda…");
      rows.replaceChildren();
      const occurrenceRange = `and(statut.eq.prevue,date_cible.gte.${start},date_cible.lt.${limit}),and(statut.eq.faite,date_realisee.gte.${start},date_realisee.lt.${limit}),and(statut.eq.faite,date_realisee.is.null,date_cible.gte.${start},date_cible.lt.${limit})`;
      const [planned, busy] = await Promise.allSettled([
        pages(() => sb.from("sorties_occurrences").select("id,idee_id,date_cible,date_realisee,statut,sorties_idees!inner(titre,espace_id)")
          .eq("sorties_idees.espace_id", ctx.space.id).or(occurrenceRange).order("id")),
        calendarAccess.then((enabled) => enabled
          ? pages(() => sb.from("sorties_occupation").select("calendrier_id,debut,fin,titre")
            .gt("fin", midnight(start).toISOString()).lt("debut", midnight(limit).toISOString())
            .order("debut").order("fin").order("calendrier_id"))
          : [])
      ]);
      if (current !== generation) return;
      const events = planned.status === "fulfilled" ? planned.value : [];
      const occupations = busy.status === "fulfilled" ? busy.value : [];
      const days = Array.from({ length: DAYS }, (_, index) => {
        const day = dayPlus(start, index);
        const dayStart = midnight(day);
        const dayEnd = midnight(dayPlus(day, 1));
        const block = el("div", null, "agenda-day");
        const marker = day === E.swissDay() ? " · Aujourd’hui" : "";
        block.append(el("h3", weekday.format(new Date(day + "T12:00:00Z")) + " " + E.date(day) + marker));
        const list = el("ul", null, "list");
        for (const event of events) {
          const actual = event.statut === "faite" ? event.date_realisee || event.date_cible : event.date_cible;
          if (day !== actual || !event.sorties_idees) continue;
          const item = el("li");
          item.append(ideaLink(ctx, event.sorties_idees, event.idee_id),
            el("span", event.statut === "faite" ? "Réalisée" : "Prévue", "eyebrow"));
          list.append(item);
        }
        for (const entry of occupations) {
          if (new Date(entry.debut) >= dayEnd || new Date(entry.fin) <= dayStart) continue;
          const item = el("li");
          item.append(el("span", entry.titre?.trim() || "Occupé"), el("span", displayBusy(entry, dayStart, dayEnd), "eyebrow"));
          list.append(item);
        }
        if (!list.children.length) list.append(el("li", "Aucune activité affichée.", "agenda-empty"));
        block.append(list);
        return block;
      });
      rows.replaceChildren(...days);
      const errors = [];
      if (planned.status === "rejected") errors.push("Les activités ne sont pas disponibles.");
      if (busy.status === "rejected") errors.push("Les plages iCloud ne sont pas disponibles.");
      E.message(status, errors.join(" "), errors.length > 0);
    }

    function move(day) {
      if (!/^\d{4}-\d\d-\d\d$/.test(day)) { picker.value = first; return; }
      first = day;
      render();
    }
    $("#previous-day").addEventListener("click", () => move(dayPlus(first, -1)));
    $("#next-day").addEventListener("click", () => move(dayPlus(first, 1)));
    $("#today").addEventListener("click", () => move(E.swissDay()));
    picker.addEventListener("change", () => move(picker.value));
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) {
        render();
        drawPlanningIdeas(ctx);
      }
    });
    $("#planning-content").hidden = false;
    await Promise.all([render(), drawPlanningIdeas(ctx)]);
  });
})();
