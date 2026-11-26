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
      return range && range.debut > Date.now() ? [{ ...range, day, heure: flexible ? hour : null }] : [];
    });
  }

  function occurrence(id, range) {
    return { idee_id: id, date_cible: range.day, ...(range.heure ? { heure_activite_planifiee: range.heure } : {}) };
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

  function fields(idea) {
    const value = idea.parametres_creneau || idea.proposition_creneau || {};
    const box = el("fieldset", null, "wide slot-fields");
    box.append(el("legend", "Créneau à réserver"));
    const proposed = !idea.parametres_creneau && !!idea.proposition_creneau;
    if (proposed) box.append(el("p", "Claude propose ces valeurs. Vérifie-les, notamment les horaires et les trajets depuis Nyon."));
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
      if (type === "checkbox") node.checked = value[name] ?? (name === "weekend" && idea.format === "week_end");
      else {
        node.value = value[name] ?? "";
        node.required = true;
        if (min != null) node.min = min;
        if (max != null) node.max = max;
      }
      controls[name] = node;
      if (type === "checkbox") return choice(caption, node);
      label.append(node);
      return label;
    }
    const presetLabel = el("label", "Plage de l’activité");
    const presetSelect = el("select");
    presetSelect.name = "plage_activite";
    const custom = el("option", "Horaires personnalisés");
    custom.value = "";
    presetSelect.append(custom);
    for (const preset of activityPresets) {
      const option = el("option", preset.label);
      option.value = preset.id;
      presetSelect.append(option);
    }
    presetLabel.append(presetSelect);
    const presetHelp = el("p", "Les trajets sont ajoutés avant et après la plage choisie.");
    const times = el("div", null, "slot-pair");
    times.append(input("duree_minutes", "Durée (min)", "number", 1, 10080),
      input("heure_activite", "Heure de début", "time"));
    const transport = el("fieldset", null, "slot-transport");
    const trips = el("div", null, "slot-pair");
    trips.append(input("aller_minutes", "Aller (min)", "number", 0, 1440),
      input("retour_minutes", "Retour (min)", "number", 0, 1440));
    transport.append(el("legend", "Trajets depuis et vers Nyon"), trips);
    box.append(presetLabel, presetHelp, times, transport);
    function showTimes() {
      const flexible = presetSelect.value === "flexible" && !presetSelect.disabled;
      times.hidden = flexible;
      presetHelp.textContent = flexible
        ? "L’agenda cherchera 4 heures libres entre 8 h et 20 h. Les trajets s’ajoutent à cette durée."
        : "Les trajets sont ajoutés avant et après la plage choisie.";
    }
    function matchPreset() {
      const matching = activityPresets.find(({ id, start, duration }) =>
        id !== "flexible" && controls.heure_activite.value === start && Number(controls.duree_minutes.value) === duration);
      presetSelect.value = matching?.id ?? "";
      showTimes();
    }
    presetSelect.addEventListener("change", () => {
      const selected = activityPresets.find(({ id }) => id === presetSelect.value);
      if (selected) {
        controls.heure_activite.value = selected.start;
        controls.duree_minutes.value = selected.duration;
      }
      showTimes();
      if (!selected) controls.heure_activite.focus();
    });
    controls.heure_activite.addEventListener("input", matchPreset);
    controls.duree_minutes.addEventListener("input", matchPreset);
    matchPreset();
    if (value.demi_journee_flexible) presetSelect.value = "flexible";
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
    const friday = input("heure_vendredi", "Heure de départ de Nyon le vendredi", "time");
    const returnLabel = el("label", "Jour du retour");
    const returnDay = el("select");
    returnDay.name = "retour_decalage";
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
    const weekend = input("weekend", "Week-end ou week-end prolongé", "checkbox");
    box.insertBefore(weekend, presetLabel);
    box.append(days, extra);
    function toggle() {
      const multi = controls.weekend.checked;
      extra.hidden = !multi;
      presetLabel.hidden = multi;
      presetHelp.hidden = multi;
      presetSelect.disabled = multi;
      showTimes();
      days.hidden = multi;
      for (const node of extra.querySelectorAll("input,select")) node.disabled = !multi;
      returnDay.required = multi;
      friday.hidden = !controls.vendredi_soir.checked;
      controls.heure_vendredi.disabled = !multi || friday.hidden;
    }
    controls.weekend.onchange = controls.vendredi_soir.onchange = toggle;
    toggle();
    if (proposed) {
      const confirm = el("input");
      confirm.type = "checkbox";
      confirm.required = true;
      box.append(choice("Je confirme les durées, les jours et les horaires.", confirm));
    }
    return box;
  }

  function read(values) {
    const weekend = values.has("weekend");
    const result = {
      duree_minutes: Number(values.get("duree_minutes")), aller_minutes: Number(values.get("aller_minutes")),
      retour_minutes: Number(values.get("retour_minutes")), heure_activite: values.get("heure_activite"),
      jours: weekend ? [6] : values.getAll("jours_creneau").map(Number), weekend
    };
    if (!weekend && values.get("plage_activite") === "flexible") result.demi_journee_flexible = true;
    if (!result.jours.length) throw new E.UserError("Choisis au moins un jour possible.");
    if (weekend) {
      result.vendredi_soir = values.has("vendredi_soir");
      if (result.vendredi_soir) result.heure_vendredi = values.get("heure_vendredi");
      result.retour_decalage = Number(values.get("retour_decalage"));
      result.heure_retour = values.get("heure_retour");
      if (!slot(result, "2024-01-13")) throw new E.UserError("Vérifie que l’aller se termine avant l’activité et que le retour commence après.");
    }
    return result;
  }

  window.EurekaSlots = { slot, canPlan, candidates, occurrence, findForDate, bounds, eventSlot, overlap, describe, fields, read };
})();
