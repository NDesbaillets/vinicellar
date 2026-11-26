(() => {
  const E = window.Eureka;
  const { el, sb, data, pages } = E;
  const zone = "Europe/Zurich";
  const clock = new Intl.DateTimeFormat("fr-CH", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const weekdays = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
  const minutes = 60_000;
  const activityPresets = [
    { id: "matin", label: "Demi-journée le matin (8 h–12 h)", start: "08:00", duration: 240 },
    { id: "apres-midi", label: "Demi-journée l’après-midi (13 h–17 h)", start: "13:00", duration: 240 },
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

  function slot(settings, day) {
    if (!/^\d{4}-\d\d-\d\d$/.test(day) || !settings?.jours?.includes(weekday(day)) || (settings.weekend && weekday(day) !== 6)) return null;
    const start = local(day, settings.heure_activite);
    const from = settings.weekend && settings.vendredi_soir
      ? local(dayPlus(day, -1), settings.heure_vendredi) : start - settings.aller_minutes * minutes;
    const activityEnd = start + settings.duree_minutes * minutes;
    const departure = settings.weekend ? local(dayPlus(day, settings.retour_decalage), settings.heure_retour) : activityEnd;
    if (!(from + settings.aller_minutes * minutes <= start && departure >= activityEnd)) return null;
    return { debut: from, fin: departure + settings.retour_minutes * minutes };
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
    const box = el("fieldset");
    box.append(el("legend", "Créneau à réserver"));
    const proposed = !idea.parametres_creneau && !!idea.proposition_creneau;
    if (proposed) box.append(el("p", "Claude propose ces valeurs. Vérifie-les, notamment les horaires et les trajets depuis Nyon."));
    const controls = {};
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
      label.append(node);
      controls[name] = node;
      return label;
    }
    const presetLabel = el("label", "Plage de l’activité");
    const presetSelect = el("select");
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
    box.append(presetLabel, presetHelp,
      input("duree_minutes", "Durée de l’activité (minutes)", "number", 1, 10080),
      input("heure_activite", "Heure de début de l’activité", "time"),
      input("aller_minutes", "Aller depuis Nyon (minutes)", "number", 0, 1440),
      input("retour_minutes", "Retour vers Nyon (minutes)", "number", 0, 1440));
    function matchPreset() {
      const matching = activityPresets.find(({ start, duration }) =>
        controls.heure_activite.value === start && Number(controls.duree_minutes.value) === duration);
      presetSelect.value = matching?.id ?? "";
    }
    presetSelect.addEventListener("change", () => {
      const selected = activityPresets.find(({ id }) => id === presetSelect.value);
      if (selected) {
        controls.heure_activite.value = selected.start;
        controls.duree_minutes.value = selected.duration;
      } else {
        controls.heure_activite.focus();
      }
    });
    controls.heure_activite.addEventListener("input", matchPreset);
    controls.duree_minutes.addEventListener("input", matchPreset);
    matchPreset();
    const days = el("fieldset");
    days.append(el("legend", "Jours possibles"));
    const choices = weekdays.map((day, index) => {
      const label = el("label", day);
      const node = el("input");
      node.type = "checkbox";
      node.name = "jours_creneau";
      node.value = index + 1;
      node.checked = value.jours?.includes(index + 1) ?? false;
      label.prepend(node);
      days.append(label);
      return node;
    });
    const preset = el("div", null, "actions");
    for (const [label, selected] of [["Tous les jours", [1, 2, 3, 4, 5, 6, 7]], ["Samedi et dimanche", [6, 7]], ["Samedi seul", [6]]]) {
      const button = el("button", label);
      button.type = "button";
      button.onclick = () => choices.forEach((node, i) => { node.checked = selected.includes(i + 1); });
      preset.append(button);
    }
    days.append(preset);
    const extra = el("div");
    const friday = input("heure_vendredi", "Heure de départ de Nyon le vendredi", "time");
    const returnLabel = el("label", "Jour de départ du lieu pour le retour");
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
      input("heure_retour", "Heure de départ du lieu pour le retour", "time"));
    box.append(days, input("weekend", "Week-end ou week-end prolongé", "checkbox"), extra);
    function toggle() {
      const multi = controls.weekend.checked;
      extra.hidden = !multi;
      presetLabel.hidden = multi;
      presetHelp.hidden = multi;
      presetSelect.disabled = multi;
      days.hidden = multi;
      for (const node of extra.querySelectorAll("input,select")) node.disabled = !multi;
      returnDay.required = multi;
      friday.hidden = !controls.vendredi_soir.checked;
      controls.heure_vendredi.disabled = !multi || friday.hidden;
    }
    controls.weekend.onchange = controls.vendredi_soir.onchange = toggle;
    toggle();
    if (proposed) {
      const label = el("label", "Je confirme les durées, les jours et les horaires de planification.");
      const confirm = el("input");
      confirm.type = "checkbox";
      confirm.required = true;
      label.prepend(confirm);
      box.append(label);
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

  window.EurekaSlots = { slot, bounds, eventSlot, overlap, describe, busy, fields, read };
})();
