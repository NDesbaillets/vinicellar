(() => {
  const E = window.Eureka;
  const { $, sb, data, el, message, pages } = E;
  const slotForm = $("#slot-settings");
  const sync = $("#sync-status");
  const local = new Intl.DateTimeFormat("fr-CH", {
    timeZone: "Europe/Zurich", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });

  function checkbox(label, name, checked) {
    const control = el("input");
    control.type = "checkbox";
    control.name = name;
    control.checked = checked;
    const line = el("label", null, "calendar-choice");
    line.append(control, label);
    return line;
  }

  function calendarRow(ctx, item, refresh) {
    const line = el("div");
    line.append(el("h3", item.nom));
    if (!item.disponible) {
      line.append(el("p", "Ce calendrier n’est plus disponible dans iCloud."));
      return line;
    }
    const form = el("form", null, "calendar-form");
    const active = checkbox("Synchroniser ce calendrier", "actif", item.actif);
    const work = checkbox("Calendrier professionnel", "professionnel", item.professionnel);
    const titles = checkbox("Autoriser les titres des événements", "titres", item.mode === "titres");
    const feedback = el("p");
    feedback.setAttribute("role", "status");
    function toggleTitles() {
      const disabled = !form.elements.actif.checked || form.elements.professionnel.checked;
      form.elements.titres.disabled = disabled;
      if (disabled) form.elements.titres.checked = false;
    }
    const footer = el("div", null, "actions");
    footer.append(el("button", "Enregistrer ce calendrier"), feedback);
    form.append(active, work, titles, footer);
    form.addEventListener("change", toggleTitles);
    toggleTitles();
    E.bind(form, feedback, async (values) => {
      await data(sb.rpc("sorties_configurer_calendrier", {
        p_espace: ctx.space.id, p_id: item.id, p_actif: values.has("actif"),
        p_titres: values.has("titres"), p_professionnel: values.has("professionnel")
      }));
      await refresh();
      message(sync, "Préférences du calendrier enregistrées.");
    });
    line.append(el("p", item.actif ? item.synchro_le ? "Dernière synchronisation le " +
      local.format(new Date(item.synchro_le)) : "Activé, en attente de synchronisation." : "Synchronisation désactivée."), form);
    return line;
  }

  E.boot("rappels", async (ctx) => {
    const ids = { espace: ctx.space.id };
    $("#back-reminders").href = E.url("rappels.html", ids);
    const configured = await data(sb.rpc("sorties_agenda_actif", { p_espace: ctx.space.id }));
    if (!configured) throw new E.UserError("L’agenda iCloud n’est pas configuré pour votre compte dans cet espace.");

    async function refresh() {
      const now = new Date();
      const nextWeek = new Date(now.getTime() + 7 * 86400000);
      const [calendars, settings, busy, slots] = await Promise.all([
        pages(() => sb.from("sorties_calendriers").select("id,nom,actif,mode,ecriture,professionnel,disponible,modifiable,synchro_le")
          .eq("user_id", ctx.user.id).order("nom").order("id")),
        data(sb.from("sorties_reglages").select("calendrier_ecriture_id,heure_creneau,duree_creneau_minutes")
          .eq("espace_id", ctx.space.id).eq("user_id", ctx.user.id).maybeSingle()),
        data(sb.from("sorties_occupation").select("calendrier_id,debut,fin,titre")
          .gt("fin", now.toISOString()).lt("debut", nextWeek.toISOString()).order("debut").order("fin").limit(80)),
        data(sb.from("sorties_creneaux_provisoires").select("debut,fin,statut").eq("espace_id", ctx.space.id)
          .gt("fin", now.toISOString()).neq("statut", "retire").order("debut").limit(30))
      ]);
      const names = new Map(calendars.map((item) => [item.id, item.nom]));
      const entries = calendars.map((item) => calendarRow(ctx, item, refresh));
      $("#calendars").replaceChildren(...(entries.length ? entries : [el("p", "Aucun calendrier découvert pour le moment.")]));
      const occupations = busy.map((item) => {
        const row = el("li");
        row.append(el("p", item.titre || "Occupé"),
          el("span", local.formatRange(new Date(item.debut), new Date(item.fin)) + " · " +
            (names.get(item.calendrier_id) || "Calendrier iCloud"), "eyebrow"));
        return row;
      });
      $("#busy-list").replaceChildren(...(occupations.length ? occupations : [el("li", "Aucune plage occupée synchronisée.")]));
      const allowed = calendars.filter((item) => item.nom === "Eurêka" && item.actif && item.disponible && item.modifiable && !item.professionnel);
      E.options(slotForm.elements.calendrier, Object.fromEntries(allowed.map((item) => [item.id, item.nom])),
        "Créneaux automatiques désactivés");
      if (allowed.some((item) => item.id === settings?.calendrier_ecriture_id)) {
        slotForm.elements.calendrier.value = settings.calendrier_ecriture_id;
      }
      slotForm.elements.heure.value = settings?.heure_creneau?.slice(0, 5) || "";
      slotForm.elements.duree.value = settings?.duree_creneau_minutes ?? "";
      updateSlotFields();
      const labels = { prepare: "Préparation", ecrit: "Dans iCloud", conflit: "Créneau à vérifier dans iCloud" };
      $("#slots").replaceChildren(...slots.map((item) => el("li", labels[item.statut] + " · " +
        local.formatRange(new Date(item.debut), new Date(item.fin)))));
    }

    function updateSlotFields() {
      const enabled = Boolean(slotForm.elements.calendrier.value);
      for (const field of [slotForm.elements.heure, slotForm.elements.duree]) {
        field.disabled = !enabled;
        field.required = enabled;
      }
    }

    slotForm.elements.calendrier.addEventListener("change", updateSlotFields);
    E.bind(slotForm, $("#slot-status"), async (values) => {
      const id = values.get("calendrier");
      await data(sb.rpc("sorties_configurer_creneau", {
        p_espace: ctx.space.id, p_calendrier: id || null,
        p_heure: id ? values.get("heure") : null,
        p_duree: id ? Number(values.get("duree")) : null
      }));
      await refresh();
      return "Préférences de créneau enregistrées.";
    });

    const buttons = [$("#discover"), $("#synchronize")];
    async function execute(action) {
      buttons.forEach((button) => { button.disabled = true; });
      message(sync, "Connexion à iCloud…");
      try {
        const result = await data(sb.functions.invoke("sorties-calendrier?action=" + action, { body: {} }));
        await refresh();
        if (result.en_cours) message(sync, "Une opération est déjà en cours. Réessayez dans quelques instants.");
        else if (result.lecture_incomplete) message(sync, "Certaines plages sont indisponibles. Vérifiez les calendriers puis réessayez.", true);
        else message(sync, action === "decouvrir" ? "Calendriers découverts. Choisissez ceux à synchroniser." : "Plages actualisées.");
      } catch (error) {
        let reason;
        try { reason = (await error.context?.json())?.message; } catch { /* Erreur locale ou réseau. */ }
        message(sync, reason || "L’action iCloud est indisponible. Réessayez.", true);
      } finally {
        buttons.forEach((button) => { button.disabled = false; });
      }
    }
    buttons[0].addEventListener("click", () => execute("decouvrir"));
    buttons[1].addEventListener("click", () => execute("synchroniser"));
    await refresh();
    $("#agenda-page").hidden = false;
  });
})();
