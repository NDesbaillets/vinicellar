(() => {
  const E = window.Eureka;
  const { sb, $, el, data, pages } = E;
  const timeZone = "Europe/Zurich";
  const weekday = new Intl.DateTimeFormat("fr-CH", { weekday: "short", timeZone: "UTC" });
  const months = new Intl.DateTimeFormat("fr-CH", { month: "long", year: "numeric", timeZone: "UTC" });
  const clock = new Intl.DateTimeFormat("fr-CH", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
  const offset = new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "longOffset" });
  const picker = $("#agenda-date");
  const view = $("#agenda-view");
  const rows = $("#agenda-days");
  const tasks = $("#planning-tasks");
  const taskStatus = $("#planning-tasks-status");
  const draftStatus = $("#draft-status");

  const asUtc = (day) => new Date(day + "T00:00:00Z");
  const iso = (date) => date.toISOString().slice(0, 10);
  const dayPlus = (day, amount) => {
    const date = asUtc(day);
    date.setUTCDate(date.getUTCDate() + amount);
    return iso(date);
  };
  const mondayOffset = (day) => (asUtc(day).getUTCDay() + 6) % 7;
  const monthPlus = (day, amount) => {
    const date = asUtc(day.slice(0, 7) + "-01");
    date.setUTCMonth(date.getUTCMonth() + amount);
    return iso(date);
  };

  function midnight(day) {
    // À minuit UTC, le changement d'heure suisse de la journée n'a pas encore eu lieu.
    const zone = offset.formatToParts(asUtc(day)).find((part) => part.type === "timeZoneName").value.replace("GMT", "");
    return new Date(day + "T00:00:00" + (zone || "Z"));
  }

  function windowFor(day, mode) {
    if (mode === "week") {
      const first = dayPlus(day, -mondayOffset(day));
      return { first, end: dayPlus(first, 7) };
    }
    const first = monthPlus(day, 0);
    return { first, end: monthPlus(first, mode === "month" ? 1 : 3) };
  }

  function suggestionWindow(today, period) {
    const tomorrow = dayPlus(today, 1);
    const distance = mondayOffset(today);
    const saturday = dayPlus(today, distance === 6 ? -1 : 5 - distance);
    if (period === "weekend") return { first: tomorrow > saturday ? tomorrow : saturday, last: dayPlus(saturday, 1), cutoff: dayPlus(today, 5) };
    if (period === "next") return { first: dayPlus(saturday, 7), last: dayPlus(saturday, 8) };
    if (period === "month") return { first: tomorrow, last: dayPlus(today, 30) };
    return { first: dayPlus(today, 31), last: dayPlus(today, 365) };
  }

  function eligible(entry, day, today) {
    const { idea, season } = entry;
    const start = season?.start || idea.date_debut;
    const end = season?.end || idea.date_fin || idea.date_debut;
    return day >= today && (!start || day >= start) && (!end || day <= end);
  }

  function suggestedDays(entry, range, today) {
    const days = [];
    const last = range.cutoff && range.cutoff < range.last ? range.cutoff : range.last;
    for (let day = range.first; day <= last; day = dayPlus(day, 1)) {
      if (eligible(entry, day, today)) days.push(day);
    }
    return days;
  }

  function busyTimes(entry, start, stop) {
    const from = new Date(entry.debut);
    const until = new Date(entry.fin);
    if (from <= start && until >= stop) return "Toute la journée";
    if (from <= start) return "Jusqu’à " + clock.format(until);
    if (until >= stop) return "Dès " + clock.format(from);
    return clock.format(from) + " – " + clock.format(until);
  }

  E.boot("planification", async (ctx) => {
    const today = E.swissDay();
    const scope = { espace: ctx.space.id };
    const canReadICloud = data(sb.rpc("sorties_agenda_actif", { p_espace: ctx.space.id })).catch(() => false);
    const drafts = new Map();
    const draftKey = "eureka.planning." + ctx.user.id + "." + scope.espace;
    let active = null;
    let anchor = today;
    let period = "weekend";
    let entries = [];
    let thumbnails = new Map();
    let signatures = 0;
    let calendar = { events: [], busy: [] };
    const pending = new Set();

    function saveDrafts() {
      try {
        sessionStorage.setItem(draftKey, JSON.stringify([...drafts].map(([id, draft]) => [id, draft.day])));
      } catch { /* Les provisoires restent disponibles tant que la page est ouverte. */ }
    }

    function restoreDrafts() {
      if (!ctx.editor) return;
      try {
        const stored = JSON.parse(sessionStorage.getItem(draftKey) || "[]");
        for (const [id, day] of stored) {
          const entry = entries.find(({ idea }) => idea.id === id);
          if (entry && /^\d{4}-\d\d-\d\d$/.test(day) && eligible(entry, day, today)) {
            drafts.set(id, { entry, day, busy: false });
          }
        }
      } catch { /* Un stockage indisponible ne bloque pas le calendrier. */ }
      active = drafts.keys().next().value ?? null;
      if (active) openDay(drafts.get(active).day);
    }

    function fiche(entry) {
      return E.url("fiche.html", { ...scope, id: entry.idea.id, saison: entry.season?.start });
    }

    async function loadCalendar(first, end) {
      const range = `and(statut.eq.prevue,date_cible.gte.${first},date_cible.lt.${end}),and(statut.eq.faite,date_realisee.gte.${first},date_realisee.lt.${end}),and(statut.eq.faite,date_realisee.is.null,date_cible.gte.${first},date_cible.lt.${end})`;
      const [events, busy] = await Promise.allSettled([
        pages(() => sb.from("sorties_occurrences").select("id,idee_id,date_cible,date_realisee,statut,sorties_idees!inner(titre,espace_id)")
          .eq("sorties_idees.espace_id", scope.espace).or(range).order("id")),
        canReadICloud.then((enabled) => enabled ? pages(() => sb.from("sorties_occupation").select("calendrier_id,debut,fin,titre")
          .gt("fin", midnight(first).toISOString()).lt("debut", midnight(end).toISOString())
          .order("debut").order("fin").order("calendrier_id")) : [])
      ]);
      return {
        events: events.status === "fulfilled" ? events.value : [],
        busy: busy.status === "fulfilled" ? busy.value : [],
        errors: [events.status === "rejected" ? "Sorties indisponibles." : "",
          busy.status === "rejected" ? "Plages iCloud indisponibles." : ""].filter(Boolean)
      };
    }

    function occupied(day, values) {
      const from = midnight(day), to = midnight(dayPlus(day, 1));
      return values.busy.filter((item) => new Date(item.debut) < to && new Date(item.fin) > from);
    }

    function scoreDay(entry, day, availability) {
      const month = Number(day.slice(5, 7));
      const best = entry.idea.meilleure_periode || [];
      return Number(best.length > 0 && !best.includes(month)) * 2 + Number(mondayOffset(day) < 5)
        + occupied(day, availability).length * 3
        + availability.events.filter((event) => event.statut === "prevue" && event.date_cible === day).length * 8
        + [...drafts.values()].filter((draft) => draft.day === day).length * 12;
    }

    async function select(entry, button) {
      if (drafts.has(entry.idea.id) || pending.has(entry.idea.id)) return;
      const days = suggestedDays(entry, suggestionWindow(today, period), today);
      if (!days.length) return;
      pending.add(entry.idea.id);
      button.disabled = true;
      try {
        const availability = await loadCalendar(days[0], dayPlus(days.at(-1), 1));
        const [day] = days.map((candidate) => [candidate, scoreDay(entry, candidate, availability)])
          .sort((a, b) => a[1] - b[1])[0];
        drafts.set(entry.idea.id, { entry, day, busy: false });
        active = entry.idea.id;
        saveDrafts();
        const conflict = occupied(day, availability).length ||
          availability.events.some((event) => event.statut === "prevue" && event.date_cible === day);
        E.message(draftStatus, "Date proposée pour « " + entry.idea.titre + " » le " + E.date(day) +
          (conflict ? ". Ce jour comporte déjà une sortie ou une plage occupée." : "."));
        await openDay(day);
      } finally {
        pending.delete(entry.idea.id);
        renderTasks();
        renderDrafts();
      }
    }

    function renderTasks() {
      const range = suggestionWindow(today, period);
      const candidates = entries.filter((entry) => suggestedDays(entry, range, today).length);
      tasks.replaceChildren(...candidates.map((entry) => {
        const { idea, season } = entry;
        const item = el("li", null, "planning-card");
        const info = el("div");
        info.append(E.link(idea.titre, fiche(entry)));
        const description = idea.accroche || idea.description?.split("\n").find((line) => line.trim()) || idea.ville;
        if (description) info.append(el("p", description.replace(/^Idée\s*:\s*/i, "").slice(0, 130)));
        if (season) info.append(el("p", E.seasonLabel(season), "eyebrow"));
        if (ctx.editor) {
          const selected = drafts.has(idea.id);
          const button = el("button", selected ? "Voir le provisoire" : "Sélectionner");
          button.type = "button";
          button.disabled = pending.has(idea.id);
          button.addEventListener("click", () => {
            if (drafts.has(idea.id)) {
              active = idea.id;
              openDay(drafts.get(idea.id).day);
            } else select(entry, button).catch(() => E.message(draftStatus, "Impossible de proposer une date.", true));
          });
          info.append(button);
        }
        item.append(E.visual(thumbnails.get(idea.image_path) || idea.image_path), info);
        return item;
      }));
      E.message(taskStatus, candidates.length ? "" : "Aucune activité à proposer pour cette période.");
    }

    function renderDrafts() {
      $("#draft-panel").hidden = !drafts.size;
      $("#draft-list").replaceChildren(...[...drafts].map(([id, draft]) => {
        const row = el("li", null, "planning-draft");
        const name = el("button", draft.entry.idea.titre);
        name.type = "button";
        name.setAttribute("aria-pressed", String(active === id));
        name.disabled = draft.busy;
        name.addEventListener("click", () => {
          active = id;
          openDay(draft.day);
        });
        const label = el("label", "Date provisoire");
        const date = el("input");
        date.type = "date";
        date.value = draft.day;
        date.min = today;
        date.disabled = draft.busy;
        date.addEventListener("change", () => {
          if (!moveDraft(id, date.value)) date.value = draft.day;
        });
        label.append(date);
        const actions = el("div", null, "actions");
        for (const [label, action] of [["Confirmer", () => confirm(id)], ["Retirer", () => {
          drafts.delete(id);
          if (active === id) active = drafts.keys().next().value ?? null;
          saveDrafts();
          E.message(draftStatus, "Provisoire retiré.");
          renderTasks();
          renderDrafts();
          renderDays();
        }]]) {
          const button = el("button", label);
          button.type = "button";
          button.disabled = draft.busy;
          button.addEventListener("click", action);
          actions.append(button);
        }
        row.append(name, label, actions);
        return row;
      }));
    }

    function moveDraft(id, day) {
      const draft = drafts.get(id);
      if (!draft || draft.busy) return false;
      if (!/^\d{4}-\d\d-\d\d$/.test(day) || !eligible(draft.entry, day, today)) {
        E.message(draftStatus, "Choisis une date future dans la période de l’activité.", true);
        return false;
      }
      draft.day = day;
      active = id;
      saveDrafts();
      E.message(draftStatus, "Provisoire déplacé au " + E.date(day) + ".");
      openDay(day);
      return true;
    }

    async function confirm(id) {
      const draft = drafts.get(id);
      if (!draft || draft.busy) return;
      draft.busy = true;
      renderDrafts();
      renderDays();
      try {
        const found = await data(sb.from("sorties_occurrences").select("id")
          .eq("idee_id", id).eq("date_cible", draft.day).eq("statut", "prevue").limit(1));
        if (!found.length) {
          await data(sb.from("sorties_occurrences").insert({ idee_id: id, date_cible: draft.day }));
        }
        await E.mustUpdate(sb.from("sorties_idees").update({ statut: "planifiee" }).eq("id", id).eq("espace_id", scope.espace));
        drafts.delete(id);
        saveDrafts();
        entries = entries.filter(({ idea }) => idea.id !== id);
        if (active === id) active = drafts.keys().next().value ?? null;
        E.message(draftStatus, "« " + draft.entry.idea.titre + " » planifiée le " + E.date(draft.day) + ".");
        await openDay(draft.day, true);
      } catch {
        E.message(draftStatus, "La confirmation n’a pas pu se terminer. Réessaie avec cette date.", true);
      } finally {
        draft.busy = false;
        renderTasks();
        renderDrafts();
        renderDays();
      }
    }

    function renderDays() {
      const { first, end } = windowFor(anchor, view.value);
      const output = document.createDocumentFragment();
      for (let groupStart = first; groupStart < end; groupStart = view.value === "week" ? end : monthPlus(groupStart, 1)) {
        const groupEnd = view.value === "week" ? end : monthPlus(groupStart, 1);
        if (view.value !== "week") output.append(el("h3", months.format(asUtc(groupStart)), "agenda-month-name"));
        const grid = el("div", null, "agenda-grid");
        for (let i = 0; i < mondayOffset(groupStart); i++) grid.append(el("div", null, "agenda-pad"));
        for (let day = groupStart; day < groupEnd; day = dayPlus(day, 1)) {
          const currentDay = day;
          const block = el("div", null, "agenda-day");
          const label = weekday.format(asUtc(day)) + " " + E.date(day);
          const dateButton = el("button", label, "agenda-day-date");
          dateButton.type = "button";
          if (day === today) dateButton.setAttribute("aria-current", "date");
          dateButton.disabled = !active || !eligible(drafts.get(active).entry, day, today) || drafts.get(active).busy;
          dateButton.addEventListener("click", () => moveDraft(active, currentDay));
          block.append(dateButton);
          const list = el("ul", null, "list agenda-items");
          for (const event of calendar.events) {
            const date = event.statut === "faite" ? event.date_realisee || event.date_cible : event.date_cible;
            if (date !== day || !event.sorties_idees) continue;
            const li = el("li");
            li.append(E.link(event.sorties_idees.titre, E.url("fiche.html", { ...scope, id: event.idee_id })));
            if (event.statut === "faite") li.append(el("small", "Réalisée"));
            list.append(li);
          }
          for (const entry of occupied(day, calendar)) {
            const li = el("li", entry.titre?.trim() || "Occupé", "agenda-busy");
            li.append(el("small", busyTimes(entry, midnight(day), midnight(dayPlus(day, 1)))));
            list.append(li);
          }
          for (const [id, draft] of drafts) {
            if (draft.day !== day) continue;
            const li = el("li", null, "agenda-provisional");
            const item = el("button", draft.entry.idea.titre);
            item.type = "button";
            item.disabled = draft.busy;
            item.draggable = !draft.busy;
            item.setAttribute("aria-pressed", String(active === id));
            item.addEventListener("click", () => { active = id; renderDrafts(); renderDays(); });
            item.addEventListener("dragstart", (event) => event.dataTransfer.setData("application/x-eureka-draft", id));
            li.append(item, el("small", "Provisoire"));
            list.append(li);
          }
          block.addEventListener("dragover", (event) => {
            if (event.dataTransfer.types.includes("application/x-eureka-draft")) event.preventDefault();
          });
          block.addEventListener("drop", (event) => {
            const id = event.dataTransfer.getData("application/x-eureka-draft");
            if (drafts.has(id)) {
              event.preventDefault();
              moveDraft(id, currentDay);
            }
          });
          block.append(list);
          grid.append(block);
        }
        output.append(grid);
      }
      rows.replaceChildren(output);
    }

    let loadedWindow = "";
    async function openDay(day, reload = false) {
      anchor = day;
      picker.value = day;
      const { first, end } = windowFor(day, view.value);
      const key = first + "/" + end;
      const request = ++signatures;
      $("#agenda-range").textContent = "Du " + E.date(first) + " au " + E.date(dayPlus(end, -1));
      renderDrafts();
      if (key === loadedWindow && !reload) {
        E.message($("#agenda-status"), calendar.errors.join(" "), calendar.errors.length > 0);
        renderDays();
        return;
      }
      E.message($("#agenda-status"), "Chargement du calendrier…");
      rows.replaceChildren();
      const result = await loadCalendar(first, end);
      if (request !== signatures) return;
      calendar = result;
      loadedWindow = key;
      E.message($("#agenda-status"), calendar.errors.join(" "), calendar.errors.length > 0);
      renderDays();
    }

    async function loadTasks() {
      const [annual, ideas, scores] = await Promise.all([
        E.annualPlanningTasks(scope.espace).catch(() => []),
        pages(() => sb.from("sorties_idees").select("id,titre,accroche,description,ville,image_path,meilleure_periode,statut,urgence,date_debut,date_fin,date_limite_reservation,sorties_occurrences(statut)")
          .eq("espace_id", scope.espace).is("fusionnee_dans", null).in("statut", ["envie", "preselection"]).order("id")),
        pages(() => sb.from("sorties_scores_couple").select("idee_id,score").eq("espace_id", scope.espace).order("idee_id"))
      ]);
      const seasonIds = new Set(annual.map(({ idea }) => idea.id));
      const ratings = new Map(scores.map(({ idee_id, score }) => [idee_id, score]));
      const candidates = ideas.filter((idea) => !seasonIds.has(idea.id)
        && !(idea.sorties_occurrences || []).some((item) => item.statut !== "annulee")
        && (!idea.date_limite_reservation || idea.date_limite_reservation >= today));
      candidates.sort((a, b) => Number(b.statut === "preselection") - Number(a.statut === "preselection")
        || b.urgence - a.urgence || (ratings.get(b.id) ?? -1) - (ratings.get(a.id) ?? -1)
        || a.titre.localeCompare(b.titre, "fr"));
      entries = [...annual, ...candidates.map((idea) => ({ idea }))];
      thumbnails = await E.signedPhotos(entries.map(({ idea }) => idea.image_path)).catch(() => new Map());
      restoreDrafts();
      renderTasks();
    }

    $(".planning-horizons").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-period]");
      if (!button) return;
      period = button.dataset.period;
      for (const choice of $(".planning-horizons").querySelectorAll("button")) {
        choice.setAttribute("aria-pressed", String(choice === button));
      }
      renderTasks();
    });
    function step(direction) {
      const { first } = windowFor(anchor, view.value);
      const day = view.value === "week" ? dayPlus(first, 7 * direction) : monthPlus(first, (view.value === "month" ? 1 : 3) * direction);
      openDay(day);
    }
    $("#previous-day").addEventListener("click", () => step(-1));
    $("#next-day").addEventListener("click", () => step(1));
    $("#today").addEventListener("click", () => openDay(E.swissDay()));
    view.addEventListener("change", () => openDay(anchor));
    picker.addEventListener("change", () => {
      if (/^\d{4}-\d\d-\d\d$/.test(picker.value)) openDay(picker.value);
      else picker.value = anchor;
    });
    $("#planned-catalogue").href = E.url("", { ...scope, statut: "planifiee" });
    $("#planning-content").hidden = false;
    await Promise.all([openDay(today), loadTasks().catch(() => E.message(taskStatus, "Les suggestions sont indisponibles.", true))]);
  });
})();
