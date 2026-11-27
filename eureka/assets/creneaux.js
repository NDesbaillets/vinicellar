(() => {
  const E = window.Eureka;
  const { el, sb, data, pages } = E;
  const zone = "Europe/Zurich";
  const clock = new Intl.DateTimeFormat("fr-CH", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const weekdays = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
  const minutes = 60_000;
  const activityPresets = [
    { id: "flexible", label: "Demi-journée flexible (4 h)", start: "08:00", duration: 240 },
    { id: "journee", label: "Journée complète (9 h–17 h)", start: "09:00", duration: 480 }
  ];
  const dayPlus = (day, delta) => new Date(Date.parse(day + "T00:00Z") + delta * 86400_000).toISOString().slice(0, 10);
  const weekday = (day) => new Date(day + "T00:00Z").getUTCDay() || 7;

  function local(day, hour) {
    const utc = Date.parse(day + "T" + hour + "Z");
    if (!Number.isFinite(utc)) return NaN;
    // En Suisse, PostgreSQL choisit l’heure standard pour une heure répétée.
    for (const offset of [1, 2]) {
      const time = new Date(utc - offset * 60 * minutes);
      if (E.swissDay(time) === day && clock.format(time) === hour) return +time;
    }
    return NaN;
  }

  function slot(settings, day, hour = settings?.heure_activite) {
    if (!/^\d{4}-\d\d-\d\d$/.test(day) || !settings?.jours?.includes(weekday(day)) || (settings.weekend && weekday(day) !== 6)) return null;
    const start = local(day, hour);
    const from = settings.weekend && settings.vendredi_soir
      ? local(dayPlus(day, -1), settings.heure_vendredi) : start - settings.aller_minutes * minutes;
    const activityEnd = start + settings.duree_minutes * minutes;
    const departure = settings.weekend ? local(dayPlus(day, settings.retour_decalage), settings.heure_retour) : activityEnd;
    if (!(from + settings.aller_minutes * minutes <= start && departure >= activityEnd)) return null;
    return { debut: from, fin: departure + settings.retour_minutes * minutes };
  }

  const flexibleHours = Array.from({ length: 17 }, (_, index) =>
    String(8 + Math.floor(index / 2)).padStart(2, "0") + (index % 2 ? ":30" : ":00"));

  function canPlan(settings, day) {
    const last = settings?.demi_journee_flexible ? flexibleHours.at(-1) : settings?.heure_activite;
    return slot(settings, day, last)?.debut > Date.now();
  }

  function candidates(settings, day) {
    const flexible = settings?.demi_journee_flexible;
    return (flexible ? flexibleHours : [settings?.heure_activite]).flatMap((hour) => {
      const range = slot(settings, day, hour);
      return range && range.debut > Date.now() ? [{ ...range, day, heure: flexible ? hour : null, optionId: settings?.optionId }] : [];
    });
  }

  function occurrence(id, range) {
    return { idee_id: id, date_cible: range.day, ...(range.heure ? { heure_activite_planifiee: range.heure } : {}),
      ...(range.optionId ? { option_id: range.optionId } : {}) };
  }

  function forDestination(idea, option) {
    const trip = option?.trajet_google;
    if (!idea.parametres_creneau || !trip || trip.depart !== idea.lieu_depart_id || trip.lieu !== option.lieu
        || !Number.isInteger(trip.aller_minutes) || !Number.isInteger(trip.retour_minutes)) return null;
    return {
      ...idea, destination: option.nom, ville: option.nom, lat: option.lat ?? trip.lat, lng: option.lng ?? trip.lng,
      parametres_creneau: { ...idea.parametres_creneau, aller_minutes: trip.aller_minutes,
        retour_minutes: trip.retour_minutes, optionId: option.id }
    };
  }

  function destinationPicker(space, idea, options, previous, onChange) {
    const wrapper = el("div", null, "destination-choice");
    const label = el("label", "Destination");
    const picker = el("select");
    const feedback = el("p");
    feedback.setAttribute("role", "status");
    E.options(picker, Object.fromEntries(options.map(({ id, nom }) => [id, nom])), "Choisir la destination");
    let selected = previous?.id || "";
    picker.value = selected;
    function showTrip(routed) {
      const { aller_minutes, retour_minutes } = routed.parametres_creneau;
      E.message(feedback, "Voiture · " + aller_minutes + " min à l’aller, " + retour_minutes + " min au retour");
    }
    const initial = forDestination(idea, previous);
    if (initial) showTrip(initial);
    label.append(picker);
    wrapper.append(label, feedback);
    picker.addEventListener("change", async () => {
      if (!picker.value) {
        selected = "";
        E.message(feedback, "");
        onChange(null);
        return;
      }
      picker.disabled = true;
      E.message(feedback, "Calcul des trajets Google Maps…");
      try {
        const { option } = await data(sb.functions.invoke("sorties-enrich", {
          body: { action: "destination_trajet", espace: space, id: idea.id, option_id: picker.value }
        }));
        const routed = forDestination(idea, option);
        if (!routed) throw new E.UserError("Trajet indisponible pour cette destination.");
        showTrip(routed);
        selected = option.id;
        onChange(option);
      } catch (error) {
        const response = await error.context?.json?.().catch(() => null);
        E.message(feedback, response?.message || "Impossible de calculer le trajet de cette destination.", true);
        picker.value = selected;
      } finally {
        picker.disabled = false;
      }
    });
    return wrapper;
  }

  async function findForDate(space, settings, day) {
    const ranges = candidates(settings, day);
    if (!ranges.length) throw new E.UserError("Choisis un jour et un créneau à venir autorisés sur la fiche.");
    const range = { debut: ranges[0].debut, fin: ranges.at(-1).fin };
    if (!settings.demi_journee_flexible) {
      if ((await busy(space, range)).length) throw new E.UserError("Le créneau chevauche une plage occupée dans ton agenda.");
      return ranges[0];
    }
    const first = E.swissDay(new Date(range.debut));
    const last = E.swissDay(new Date(range.fin));
    const from = new Date(range.debut).toISOString(), to = new Date(range.fin).toISOString();
    const [agenda, events] = await Promise.all([
      busy(space, range),
      pages(() => sb.from("sorties_occurrences").select("id,date_cible,debut_planifie,fin_planifie,sorties_idees!inner(espace_id)")
        .eq("sorties_idees.espace_id", space).eq("statut", "prevue")
        .or(`and(debut_planifie.lt.${to},fin_planifie.gt.${from}),and(debut_planifie.is.null,date_cible.gte.${first},date_cible.lte.${last})`)
        .order("id"))
    ]);
    const occupied = [...agenda, ...events.map(eventSlot)];
    const free = ranges.find((candidate) => !occupied.some((item) => overlap(item, candidate)));
    if (!free) throw new E.UserError("Aucune demi-journée libre à cette date, trajets compris.");
    return free;
  }

  function overlap(a, b) {
    return +new Date(a.debut) < +new Date(b.fin) && +new Date(a.fin) > +new Date(b.debut);
  }

  function bounds(day) {
    return { debut: local(day, "00:00"), fin: local(dayPlus(day, 1), "00:00") };
  }

  function eventSlot(event) {
    return event.debut_planifie ? { debut: event.debut_planifie, fin: event.fin_planifie } : bounds(event.date_cible);
  }

  function describe(range) {
    const format = (value) => {
      const date = new Date(value);
      return E.date(E.swissDay(date)) + " à " + clock.format(date);
    };
    return "De " + format(range.debut) + " au " + format(range.fin) + " · trajets compris";
  }

  async function busy(space, range) {
    const enabled = await data(sb.rpc("sorties_agenda_actif", { p_espace: space }));
    if (!enabled) return [];
    return pages(() => sb.from("sorties_occupation").select("debut,fin")
      .lt("debut", new Date(range.fin).toISOString()).gt("fin", new Date(range.debut).toISOString())
      .order("debut").order("fin").order("calendrier_id"));
  }

  function hasProposal(idea) {
    return !idea.parametres_creneau && (idea.brouillon_creneau?.confirmation_requise ?? !!idea.proposition_creneau);
  }

  function fields(idea, departure = "Nyon") {
    const value = idea.brouillon_creneau || idea.parametres_creneau || idea.proposition_creneau || {};
    const box = el("fieldset", null, "wide slot-fields");
    box.append(el("legend", "Créneau à réserver"));
    box.append(el("p", "Tu peux enregistrer la fiche et compléter le créneau plus tard."));
    const proposed = hasProposal(idea);
    if (proposed) box.append(el("p", "Claude a proposé des valeurs. Tu peux les modifier avant d’enregistrer."));
    const controls = {};
    function choice(caption, node) {
      const label = el("label", null, "slot-choice");
      label.append(node, el("span", caption));
      return label;
    }
    function input(name, caption, type, min, max) {
      const label = el("label", caption);
      const node = el("input");
      node.name = name;
      node.type = type;
      if (type === "checkbox") node.checked = value[name] ?? false;
      else {
        node.value = value[name] ?? "";
        if (min != null) node.min = min;
        if (max != null) node.max = max;
      }
      controls[name] = node;
      if (type === "checkbox") return choice(caption, node);
      label.append(node);
      return label;
    }
    const modes = el("div", null, "slot-day-choices");
    modes.setAttribute("role", "group");
    modes.setAttribute("aria-label", "Plage de l’activité");
    const modeControls = new Map();
    for (const [id, caption] of [...activityPresets.map(({ id, label }) => [id, label]),
      ["weekend", "Week-end ou week-end prolongé"], ["", "Horaires personnalisés"]]) {
      const radio = el("input");
      radio.type = "radio";
      radio.name = "plage_activite";
      radio.value = id;
      modeControls.set(id, radio);
      modes.append(choice(caption, radio));
    }
    const selectedMode = () => modes.querySelector("input:checked")?.value ?? "";
    const presetHelp = el("p", "Les trajets sont ajoutés avant et après la plage choisie.");
    const times = el("div", null, "slot-pair");
    times.append(input("duree_minutes", "Durée (min)", "number", 1, 10080),
      input("heure_activite", "Heure de début", "time"));
    const transport = el("fieldset", null, "slot-transport");
    const trips = el("div", null, "slot-pair");
    trips.append(input("aller_minutes", "Aller (min)", "number", 0, 1440),
      input("retour_minutes", "Retour (min)", "number", 0, 1440));
    transport.append(el("legend", "Trajets depuis et vers " + departure), trips);
    box.append(modes, presetHelp, times, transport);
    function showTimes() {
      const flexible = selectedMode() === "flexible";
      times.hidden = flexible;
      presetHelp.textContent = flexible
        ? "L’agenda cherchera 4 heures libres entre 8 h et 20 h. Les trajets s’ajoutent à cette durée."
        : "Les trajets sont ajoutés avant et après la plage choisie.";
    }
    function matchPreset() {
      if (selectedMode() === "weekend") return;
      const matching = activityPresets.find(({ id, start, duration }) =>
        id !== "flexible" && controls.heure_activite.value === start && Number(controls.duree_minutes.value) === duration);
      modeControls.get(matching?.id ?? "").checked = true;
      showTimes();
    }
    modes.addEventListener("change", () => {
      const selected = activityPresets.find(({ id }) => id === selectedMode());
      if (selected) {
        controls.heure_activite.value = selected.start;
        controls.duree_minutes.value = selected.duration;
      }
      toggle();
    });
    controls.heure_activite.addEventListener("input", matchPreset);
    controls.duree_minutes.addEventListener("input", matchPreset);
    matchPreset();
    if (value.weekend ?? idea.format === "week_end") modeControls.get("weekend").checked = true;
    else if (value.demi_journee_flexible) modeControls.get("flexible").checked = true;
    const days = el("fieldset", null, "slot-days");
    const dayChoices = el("div", null, "slot-day-choices");
    days.append(el("legend", "Jours possibles"));
    const choices = weekdays.map((day, index) => {
      const node = el("input");
      node.type = "checkbox";
      node.name = "jours_creneau";
      node.value = index + 1;
      node.checked = value.jours?.includes(index + 1) ?? false;
      dayChoices.append(choice(day, node));
      return node;
    });
    const preset = el("div", null, "slot-day-presets");
    for (const [label, selected] of [["Tous les jours", [1, 2, 3, 4, 5, 6, 7]], ["Samedi et dimanche", [6, 7]], ["Samedi seul", [6]]]) {
      const button = el("button", label);
      button.type = "button";
      button.onclick = () => choices.forEach((node, i) => { node.checked = selected.includes(i + 1); });
      preset.append(button);
    }
    days.append(preset, dayChoices);
    const extra = el("div", null, "slot-weekend");
    const friday = input("heure_vendredi", "Heure de départ le vendredi", "time");
    const returnLabel = el("label", "Jour du retour");
    const returnDay = el("select");
    returnDay.name = "retour_decalage";
    const unspecified = el("option", "À préciser");
    unspecified.value = "";
    returnDay.append(unspecified);
    for (const [index, day] of ["Samedi", "Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"].entries()) {
      const option = el("option", day);
      option.value = index;
      returnDay.append(option);
    }
    returnDay.value = value.retour_decalage ?? "";
    returnLabel.append(returnDay);
    extra.append(el("p", "La date choisie dans le calendrier correspond au samedi."),
      input("vendredi_soir", "Départ le vendredi soir", "checkbox"), friday, returnLabel,
      input("heure_retour", "Heure de départ pour le retour", "time"));
    box.append(days, extra);
    function toggle() {
      const multi = selectedMode() === "weekend";
      extra.hidden = !multi;
      presetHelp.hidden = multi;
      showTimes();
      days.hidden = multi;
      for (const node of extra.querySelectorAll("input,select")) node.disabled = !multi;
      friday.hidden = !controls.vendredi_soir.checked;
      controls.heure_vendredi.disabled = !multi || friday.hidden;
    }
    controls.vendredi_soir.onchange = toggle;
    toggle();
    return box;
  }

  function formValues(values) {
    const mode = values.get("plage_activite");
    const weekend = mode === "weekend";
    const number = (name) => {
      const value = values.get(name);
      return value == null || value === "" ? null : Number(value);
    };
    const result = {
      duree_minutes: number("duree_minutes"), aller_minutes: number("aller_minutes"),
      retour_minutes: number("retour_minutes"), heure_activite: values.get("heure_activite") || null,
      jours: weekend ? [6] : values.getAll("jours_creneau").map(Number), weekend
    };
    if (mode === "flexible") result.demi_journee_flexible = true;
    if (weekend) {
      result.vendredi_soir = values.has("vendredi_soir");
      if (result.vendredi_soir) result.heure_vendredi = values.get("heure_vendredi") || null;
      result.retour_decalage = number("retour_decalage");
      result.heure_retour = values.get("heure_retour") || null;
    }
    return result;
  }

  function read(values, idea) {
    const mode = values.get("plage_activite");
    const result = formValues(values);
    const weekend = result.weekend;
    const enough = result.duree_minutes != null && result.aller_minutes != null && result.retour_minutes != null
      && result.heure_activite && result.jours.length && (!weekend || (result.retour_decalage != null && result.heure_retour
        && (!result.vendredi_soir || result.heure_vendredi) && slot(result, "2024-01-13")));
    if (enough) {
      const previous = idea.parametres_creneau;
      if (Array.isArray(previous?.hypotheses)
          && Object.entries(result).every(([key, value]) => JSON.stringify(value) === JSON.stringify(previous[key]))) {
        result.hypotheses = previous.hypotheses;
      }
      if (previous?.source_trajets === "google_maps" && previous.aller_minutes === result.aller_minutes
          && previous.retour_minutes === result.retour_minutes) result.source_trajets = previous.source_trajets;
      return { parametres_creneau: result, ...(idea.brouillon_creneau ? { brouillon_creneau: null } : {}) };
    }
    const started = mode || result.jours.length || [result.duree_minutes, result.aller_minutes, result.retour_minutes,
      result.heure_activite].some((value) => value != null) || idea.brouillon_creneau || idea.parametres_creneau;
    return started ? { parametres_creneau: null, brouillon_creneau: { ...result, confirmation_requise: hasProposal(idea) } } : {};
  }

  window.EurekaSlots = { forDestination, destinationPicker, slot, canPlan, candidates, occurrence, findForDate, bounds, eventSlot, overlap, describe, fields, formValues, read };
})();
