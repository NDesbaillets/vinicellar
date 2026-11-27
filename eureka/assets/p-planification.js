(() => {
  const E = window.Eureka;
  const { sb, $, el, data, pages } = E;
  const slots = window.EurekaSlots;
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
    const saturday = dayPlus(today, 5 - mondayOffset(today));
    const sunday = dayPlus(saturday, 1);
    const nextSaturday = dayPlus(saturday, 7), nextSunday = dayPlus(saturday, 8);
    if (period === "weekend") return { first: today > saturday ? today : saturday, last: sunday };
    if (period === "next") return { first: nextSaturday, last: nextSunday };
    if (period === "month") return { first: today, last: dayPlus(today, 30), exclude: [saturday, sunday, nextSaturday, nextSunday] };
    return { first: dayPlus(today, 31), last: dayPlus(today, 365) };
  }

  function booking(idea, departure) {
    const lead = idea.delai_reservation_jours;
    const relative = lead == null ? null : dayPlus(departure, -lead);
    const fixed = idea.date_limite_reservation;
    return {
      deadline: fixed && (!relative || fixed < relative) ? fixed : relative,
      unknown: lead == null && !fixed
    };
  }

  function withinTravelLimit(idea) {
    const settings = idea.parametres_creneau;
    if (!settings || settings.weekend) return true;
    const halfDay = idea.format === "demi_journee" || settings.demi_journee_flexible
      || (!idea.format && settings.duree_minutes <= 240);
    return !halfDay || settings.aller_minutes <= 60;
  }

  function eligible(entry, day, today) {
    const { idea, season } = entry;
    const start = season?.start || idea.date_debut;
    const end = season?.end || idea.date_fin || idea.date_debut;
    if (day < today || (start && day < start) || (end && day > end)) return false;
    return !idea.parametres_creneau || slots.canPlan(idea.parametres_creneau, day);
  }

  function* candidateRanges(entry, range, today) {
    for (let day = range.first; day <= range.last; day = dayPlus(day, 1)) {
      if (range.exclude?.includes(day) || !eligible(entry, day, today)) continue;
      for (const slot of slots.candidates(entry.idea.parametres_creneau, day)) {
        const reservation = booking(entry.idea, E.swissDay(new Date(slot.debut)));
        if (!reservation.deadline || reservation.deadline >= today) yield { ...slot, reservation };
      }
    }
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
    const canReadICloud = data(sb.rpc("sorties_agenda_actif", { p_espace: ctx.space.id }));
    const sharedCoverage = canReadICloud.then(async (enabled) => {
      if (!enabled) return null;
      const calendars = await pages(() => sb.from("sorties_calendriers").select("id,synchro_le")
        .eq("actif", true).eq("disponible", true).order("id"));
      if (!calendars.length || calendars.some((item) => !item.synchro_le)) return null;
      const oldest = new Date(Math.min(...calendars.map((item) => Date.parse(item.synchro_le))));
      if (!Number.isFinite(+oldest) || Date.now() - oldest > 3_600_000) return null;
      return dayPlus(E.swissDay(oldest), 91);
    }).catch(() => null);
    const ratings = new Map();
    const drafts = new Map();
    const draftKey = "eureka.planning." + ctx.user.id + "." + scope.espace;
    let active = null;
    let anchor = today;
    let period = "weekend";
    let entries = [];
    let thumbnails = new Map();
    let signatures = 0;
    let suggestionRequest = 0;
    let calendar = { events: [], busy: [] };
    const pending = new Set();

    function saveDrafts() {
      try {
        sessionStorage.setItem(draftKey, JSON.stringify([...drafts].map(([id, draft]) => [id, draft.day, draft.range.heure])));
      } catch { /* Les provisoires restent disponibles tant que la page est ouverte. */ }
    }

    function restoreDrafts() {
      if (!ctx.editor) return;
      try {
        const stored = JSON.parse(sessionStorage.getItem(draftKey) || "[]");
        for (const [id, day, hour] of stored) {
          const entry = entries.find(({ idea }) => idea.id === id);
          if (entry?.idea.parametres_creneau && /^\d{4}-\d\d-\d\d$/.test(day) && eligible(entry, day, today)) {
            const range = slots.candidates(entry.idea.parametres_creneau, day).find((candidate) => candidate.heure === (hour ?? null));
            if (range) drafts.set(id, { entry, day, range, busy: false });
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
      const range = `and(statut.eq.prevue,debut_planifie.lt.${midnight(end).toISOString()},fin_planifie.gt.${midnight(first).toISOString()}),and(statut.eq.prevue,debut_planifie.is.null,date_cible.gte.${first},date_cible.lt.${end}),and(statut.eq.faite,date_realisee.gte.${first},date_realisee.lt.${end}),and(statut.eq.faite,date_realisee.is.null,date_cible.gte.${first},date_cible.lt.${end})`;
      const [events, busy] = await Promise.allSettled([
        pages(() => sb.from("sorties_occurrences").select("id,idee_id,date_cible,date_realisee,statut,debut_planifie,fin_planifie,sorties_idees!inner(titre,espace_id)")
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

    function conflict(range, availability, id) {
      return availability.busy.some((item) => slots.overlap(item, range))
        || availability.events.some((event) => event.statut === "prevue" && event.idee_id !== id
          && slots.overlap(slots.eventSlot(event), range))
        || [...drafts].some(([other, draft]) => other !== id && slots.overlap(draft.range, range));
    }

    function checkedAvailability(availability) {
      if (availability.errors.length) throw new E.UserError(availability.errors.join(" "));
      return availability;
    }

    async function availabilityFor(ranges) {
      const first = E.swissDay(new Date(ranges[0].debut));
      const end = dayPlus(E.swissDay(new Date(ranges.at(-1).fin)), 1);
      return checkedAvailability(await loadCalendar(first, end));
    }

    function bestSlot(entry, range, availability, horizon) {
      const months = entry.idea.meilleure_periode || [];
      const preferSeason = months.length && (horizon === "month" || horizon === "later");
      let fallback;
      for (const candidate of candidateRanges(entry, range, today)) {
        if (conflict(candidate, availability, entry.idea.id)) continue;
        if (!preferSeason || months.includes(Number(candidate.day.slice(5, 7)))) return candidate;
        fallback ??= candidate;
      }
      return fallback;
    }

    function priority(entry, choice, horizon) {
      const { idea, season } = entry;
      const bookingDay = idea.date_limite_reservation
        || (idea.delai_reservation_jours > 0 ? choice.reservation.deadline : null);
      const reminder = bookingDay && dayPlus(bookingDay, -Math.min(idea.preavis_semaines || 0, 5200) * 7);
      const approaching = bookingDay && bookingDay <= dayPlus(today, horizon === "weekend" ? 2 : 7);
      const seasonal = idea.meilleure_periode?.includes(Number(choice.day.slice(5, 7)));
      const dated = !!(season || idea.date_debut || idea.date_fin);
      const score = ratings.get(idea.id) ?? 0;
      const temporal = horizon === "weekend"
        ? Number(!!approaching) * 6 + Number(!choice.reservation.unknown) * 3 + Number(dated) * 2
          + Math.max(0, 3 - idea.parametres_creneau.aller_minutes / 20)
        : Number(!!approaching) * 6 + Number(dated) * 5 + Number(!!seasonal) * 3
          + Number(!!reminder && reminder <= today) * 2 + Number(idea.delai_reservation_jours > 0);
      return temporal + score / 2 + (idea.urgence ?? 0) / 2 + Number(idea.statut === "preselection") * 2;
    }

    async function select(entry, button, suggested, horizon) {
      if (drafts.has(entry.idea.id) || pending.has(entry.idea.id)) return;
      pending.add(entry.idea.id);
      button.disabled = true;
      try {
        const availability = await availabilityFor([suggested]);
        if (suggested.debut <= Date.now() || conflict(suggested, availability, entry.idea.id)) {
          await renderTasks();
          E.message(taskStatus, "Ce créneau n’est plus libre. Les propositions ont été actualisées.", true);
          return;
        }
        const { day } = suggested;
        drafts.set(entry.idea.id, { entry, day, range: suggested, busy: false });
        active = entry.idea.id;
        saveDrafts();
        E.message(draftStatus, "Date proposée pour « " + entry.idea.titre + " » le " + E.date(day) + ".");
        await openDay(day);
        if (horizon === period) await renderTasks();
      } catch (error) {
        E.message(taskStatus, error instanceof E.UserError ? error.message : "Impossible de proposer cette date.", true);
      } finally {
        pending.delete(entry.idea.id);
        button.disabled = false;
        renderDrafts();
      }
    }

    async function renderTasks() {
      const request = ++suggestionRequest;
      const horizon = period;
      const range = suggestionWindow(today, horizon);
      const possible = entries.filter(({ idea }) => idea.parametres_creneau && withinTravelLimit(idea));
      tasks.replaceChildren();
      if (!possible.length) {
        E.message(taskStatus, "Aucun créneau à proposer dans cette période.");
        return;
      }
      E.message(taskStatus, "Vérification des créneaux…");
      try {
        const [availability, coverage] = await Promise.all([
          loadCalendar(dayPlus(range.first, -2), dayPlus(range.last, 10)).then(checkedAvailability),
          sharedCoverage
        ]);
        if (request !== suggestionRequest) return;
        const candidates = possible.flatMap((entry) => {
          const draft = drafts.get(entry.idea.id);
          const inWindow = draft && draft.day >= range.first && draft.day <= range.last && !range.exclude?.includes(draft.day);
          const choice = inWindow
            ? { ...draft.range, reservation: booking(entry.idea, E.swissDay(new Date(draft.range.debut))) }
            : bestSlot(entry, range, availability, horizon);
          return choice ? [{ entry, choice, score: priority(entry, choice, horizon) }] : [];
        }).sort((a, b) => b.score - a.score || a.choice.debut - b.choice.debut
          || a.entry.idea.titre.localeCompare(b.entry.idea.titre, "fr"));
        tasks.replaceChildren(...candidates.map(({ entry, choice }) => {
          const { idea, season } = entry;
          const item = el("li", null, "planning-card");
          const info = el("div");
          info.append(E.link(idea.titre, fiche(entry)));
          const description = idea.accroche || idea.description?.split("\n").find((line) => line.trim()) || idea.ville;
          if (description) info.append(el("p", description.replace(/^Idée\s*:\s*/i, "").slice(0, 130)));
          const seasonName = E.saisons[idea.saison_activite];
          if (seasonName) info.append(el("span", seasonName, "season-badge"));
          if (idea.conditions_activite) info.append(el("p", E.withoutVerificationLabels(idea.conditions_activite), "planning-reason"));
          if (season) info.append(el("p", E.seasonLabel(season)));
          const checked = coverage && E.swissDay(new Date(choice.fin)) < coverage;
          info.append(el("p", (checked ? "Créneau libre dans les agendas synchronisés" : "Disponibilité des agendas inconnue")
            + " · " + slots.describe(choice), "planning-reason"));
          const deadline = choice.reservation.deadline;
          if (deadline && (idea.date_limite_reservation || idea.delai_reservation_jours > 0)) {
            info.append(el("p", "Réserver au plus tard le " + E.date(deadline), "planning-reason"));
          } else if (choice.reservation.unknown) {
            info.append(el("p", "Réservation non renseignée", "planning-reason"));
          }
          if (ctx.editor) {
            const selected = drafts.has(idea.id);
            const button = el("button", selected ? "Voir le provisoire" : "Sélectionner");
            button.type = "button";
            button.disabled = !selected && pending.has(idea.id);
            button.addEventListener("click", () => {
              if (drafts.has(idea.id)) {
                active = idea.id;
                openDay(drafts.get(idea.id).day);
              } else select(entry, button, choice, horizon);
            });
            info.append(button);
          }
          item.append(E.visual(thumbnails.get(idea.image_path) || idea.image_path), info);
          return item;
        }));
        E.message(taskStatus, candidates.length ? "" : "Aucun créneau libre dans cette période, trajets compris.");
      } catch (error) {
        if (request === suggestionRequest) E.message(taskStatus, error instanceof E.UserError ? error.message
          : "Impossible de vérifier les créneaux.", true);
      }
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
        date.addEventListener("change", async () => {
          if (!await moveDraft(id, date.value)) date.value = draft.day;
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
        row.append(name, el("small", slots.describe(draft.range)), label, actions);
        return row;
      }));
    }

    async function moveDraft(id, day) {
      const draft = drafts.get(id);
      if (!draft || draft.busy) return false;
      if (!/^\d{4}-\d\d-\d\d$/.test(day) || !eligible(draft.entry, day, today)) {
        E.message(draftStatus, "Choisis un jour autorisé et un créneau à venir dans la période de l’activité.", true);
        return false;
      }
      draft.busy = true;
      renderDrafts();
      try {
        const ranges = slots.candidates(draft.entry.idea.parametres_creneau, day);
        if (!ranges.length) throw new E.UserError("Aucun créneau à venir à cette date.");
        const availability = await availabilityFor(ranges);
        const free = ranges.find((range) => !conflict(range, availability, id));
        if (!free) throw new E.UserError("Aucun créneau libre à cette date, trajets compris.");
        draft.range = free;
        draft.day = day;
        active = id;
        saveDrafts();
        E.message(draftStatus, "Provisoire déplacé au " + E.date(day) + ".");
        await openDay(day);
        return true;
      } catch (error) {
        E.message(draftStatus, error instanceof E.UserError ? error.message : "Impossible de vérifier ce créneau.", true);
        return false;
      } finally {
        draft.busy = false;
        renderTasks();
        renderDrafts();
        renderDays();
      }
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
          if (draft.range.debut <= Date.now() || !eligible(draft.entry, draft.day, today)) throw new E.UserError("Ce créneau doit être à venir.");
          const availability = await availabilityFor([draft.range]);
          if (conflict(draft.range, availability, id)) throw new E.UserError("Ce créneau est déjà occupé, trajets compris.");
          await data(sb.from("sorties_occurrences").insert(slots.occurrence(id, draft.range)));
        }
        await E.mustUpdate(sb.from("sorties_idees").update({ statut: "planifiee" }).eq("id", id).eq("espace_id", scope.espace));
        drafts.delete(id);
        saveDrafts();
        entries = entries.filter(({ idea }) => idea.id !== id);
        if (active === id) active = drafts.keys().next().value ?? null;
        E.message(draftStatus, "« " + draft.entry.idea.titre + " » planifiée le " + E.date(draft.day) + ".");
        await openDay(draft.day, true);
      } catch (error) {
        const message = error.code === "23P01" ? "Une autre sortie occupe déjà ce créneau."
          : "La confirmation n’a pas pu se terminer. Réessaie avec cette date.";
        E.message(draftStatus, error instanceof E.UserError ? error.message : message, true);
      } finally {
        draft.busy = false;
        renderTasks();
        renderDrafts();
        renderDays();
      }
    }

    function renderDays() {
      const selection = drafts.get(active);
      window.EurekaWeather(selection?.entry.idea, selection?.day);
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
            const visible = event.statut === "prevue" ? slots.overlap(slots.eventSlot(event), slots.bounds(day)) : date === day;
            if (!visible || !event.sorties_idees) continue;
            const li = el("li");
            li.append(E.link(event.sorties_idees.titre, E.url("fiche.html", { ...scope, id: event.idee_id })));
            if (event.statut === "faite") li.append(el("small", "Réalisée"));
            else if (event.debut_planifie) li.append(el("small", busyTimes(slots.eventSlot(event), midnight(day), midnight(dayPlus(day, 1)))));
            list.append(li);
          }
          for (const entry of occupied(day, calendar)) {
            const li = el("li", entry.titre?.trim() || "Occupé", "agenda-busy");
            li.append(el("small", busyTimes(entry, midnight(day), midnight(dayPlus(day, 1)))));
            list.append(li);
          }
          for (const [id, draft] of drafts) {
            const range = draft.range;
            if (!slots.overlap(range, slots.bounds(day))) continue;
            const li = el("li", null, "agenda-provisional");
            const item = el("button", draft.entry.idea.titre);
            item.type = "button";
            item.disabled = draft.busy;
            item.draggable = !draft.busy;
            item.setAttribute("aria-pressed", String(active === id));
            item.addEventListener("click", () => { active = id; renderDrafts(); renderDays(); });
            item.addEventListener("dragstart", (event) => event.dataTransfer.setData("application/x-eureka-draft", id));
            li.append(item, el("small", "Provisoire · " + busyTimes(range, midnight(day), midnight(dayPlus(day, 1)))));
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
        E.annualPlanningTasks(scope.espace, true).catch(() => []),
        pages(() => sb.from("sorties_idees").select("id,titre,accroche,description,ville,image_path,meilleure_periode,statut,urgence,date_debut,date_fin,date_limite_reservation,preavis_semaines,delai_reservation_jours,format,saison_activite,conditions_activite,parametres_creneau,lat,lng,sorties_occurrences(statut)")
          .eq("espace_id", scope.espace).is("fusionnee_dans", null).in("statut", ["envie", "preselection"]).order("id")),
        pages(() => sb.from("sorties_scores_couple").select("idee_id,score").eq("espace_id", scope.espace).order("idee_id"))
      ]);
      const seasonIds = new Set(annual.map(({ idea }) => idea.id));
      for (const { idee_id, score } of scores) ratings.set(idee_id, score);
      const candidates = ideas.filter((idea) => !seasonIds.has(idea.id)
        && !(idea.sorties_occurrences || []).some((item) => item.statut !== "annulee")
        && (!idea.date_limite_reservation || idea.date_limite_reservation >= today));
      entries = [...annual, ...candidates.map((idea) => ({ idea }))];
      const incomplete = $("#planning-incomplete");
      const toComplete = ctx.editor ? entries.filter(({ idea }) => !idea.parametres_creneau) : [];
      incomplete.hidden = !toComplete.length;
      $("#planning-incomplete-list").replaceChildren(...toComplete.map(({ idea }) => {
        const item = el("li");
        item.append(E.link(idea.titre, E.url("editer.html", { ...scope, id: idea.id })));
        return item;
      }));
      thumbnails = await E.signedPhotos(entries.map(({ idea }) => idea.image_path)).catch(() => new Map());
      restoreDrafts();
      await renderTasks();
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
