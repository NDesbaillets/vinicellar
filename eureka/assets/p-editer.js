(() => {
  const E = window.Eureka;
  const { sb, $, el, params, data } = E;
  const form = $("#idea-form");
  const id = params.get("id");

  const fields = [
    ["titre", "Titre", { required: true, wide: true }],
    ["accroche", "Accroche", { wide: true }],
    ["description", "Description", { type: "textarea", wide: true }],
    ["saison_activite", "Saison", { options: E.saisons }],
    ["conditions_activite", "Conditions nécessaires", { wide: true }],
    ["categorie", "Catégorie"], ["format", "Format", { options: E.formats }],
    ["type_lieu", "Type de lieu", { options: { generique: "Sans lieu fixe", lieu: "Lieu précis" }, default: "generique" }],
    ["modalite", "Sortie", { options: E.modalites }],
    ["adresse", "Adresse"], ["ville", "Ville"],
    ["lat", "Latitude", { type: "number", min: -90, max: 90, step: "any" }],
    ["lng", "Longitude", { type: "number", min: -180, max: 180, step: "any" }],
    ["distance_nyon_km", "Distance depuis Nyon (km)", { type: "number", min: 0, step: "0.01" }],
    ["telephone", "Téléphone", { type: "tel" }], ["site_reservation", "Site de réservation", { type: "url", wide: true }],
    ["budget_min", "Budget min. (CHF)", { type: "number", min: 0, step: "0.01" }],
    ["budget_max", "Budget max. (CHF)", { type: "number", min: 0, step: "0.01" }],
    ["date_debut", "Date de début", { type: "date" }], ["date_fin", "Date de fin", { type: "date" }],
    ["date_limite_reservation", "Réserver avant", { type: "date" }],
    ["delai_reservation_jours", "Délai minimal pour réserver (jours)", { type: "number", min: 0, max: 365 }],
    ["preavis_semaines", "Préavis (semaines)", { type: "number", min: 0 }],
    ["urgence", "Urgence", { options: { 1: "1", 2: "2", 3: "3", 4: "4", 5: "5" }, default: 1, numeric: true }],
    ["statut", "Statut", { options: E.statuts, default: "envie" }],
    ["score_couple_manuel", "Score couple (vide = moyenne)", { type: "number", min: 0, max: 10, step: "0.1" }],
    ["tags", "Mots-clés (séparés par des virgules)", { wide: true }],
    ["image_path", "URL HTTPS du visuel", { wide: true }],
    ["source_url", "URL de la source", { type: "url", wide: true }],
    ["notes", "Notes", { type: "textarea", wide: true }]
  ];

  function field([name, caption, config = {}], value) {
    const label = el("label", caption, config.wide ? "wide" : "");
    const control = el(config.options ? "select" : config.type === "textarea" ? "textarea" : "input");
    control.name = name;
    if (config.options) E.options(control, config.options, config.default == null ? "Non précisé" : null);
    else if (control.tagName === "INPUT") control.type = config.type || "text";
    for (const key of ["min", "max", "step"]) {
      if (config[key] != null) control[key] = config[key];
    }
    control.required = Boolean(config.required);
    if (name === "conditions_activite") control.maxLength = 240;
    control.value = Array.isArray(value) ? value.join(", ") : value ?? config.default ?? "";
    label.append(control);
    return label;
  }

  function period(selected) {
    const group = el("fieldset", null, "wide periods");
    group.append(el("legend", "Meilleure période"));
    for (const [value, label] of Object.entries(E.mois)) {
      const option = el("label");
      const input = el("input");
      input.type = "checkbox";
      input.name = "mois";
      input.value = value;
      input.checked = selected.includes(Number(value));
      option.append(input, label);
      group.append(option);
    }
    return group;
  }

  function recurrenceFields(idea) {
    const group = el("fieldset", null, "wide recurrence-fields");
    group.append(el("legend", "Récurrence"));
    group.append(
      field(["repetition", "Répéter", { options: { unique: "Une seule fois", mois: "Tous les X mois", annee: "Chaque année" }, default: "unique" }],
        idea.saison_debut_mois ? "annee" : idea.recurrence_mois ? "mois" : "unique"),
      field(["recurrence_mois", "Nombre de mois", { type: "number", min: 1 }], idea.recurrence_mois),
      field(["saison_debut_mois", "Premier mois de la saison", { options: E.mois }], idea.saison_debut_mois),
      field(["saison_fin_mois", "Dernier mois de la saison", { options: E.mois }], idea.saison_fin_mois)
    );
    const hint = el("p", "Planifie au moins une occurrence dans cette période chaque année.", "wide");
    group.append(hint);
    const mode = $("select[name=repetition]", group);
    function toggle() {
      for (const [name, visible] of [["recurrence_mois", mode.value === "mois"],
        ["saison_debut_mois", mode.value === "annee"], ["saison_fin_mois", mode.value === "annee"]]) {
        const control = $("[name=" + name + "]", group);
        control.closest("label").hidden = !visible;
        control.disabled = !visible;
        control.required = visible;
      }
      hint.hidden = mode.value !== "annee";
    }
    mode.addEventListener("change", toggle);
    toggle();
    return group;
  }

  function descriptionPreview(input) {
    const panel = el("div", null, "wide description-preview");
    const preview = el("div", null, "prose");
    const caption = el("h2", "Aperçu de la description");
    panel.append(caption, preview);
    function update() {
      const empty = !input.value.trim();
      caption.hidden = preview.hidden = empty;
      panel.hidden = empty;
      E.renderDescription(preview, input.value);
    }
    input.addEventListener("input", update);
    update();
    return panel;
  }

  function payload(values, idea) {
    const result = {};
    for (const [name, , config = {}] of fields) {
      const value = values.get(name).trim();
      result[name] = value && (config.type === "number" || config.numeric) ? Number(value) : value || null;
    }
    for (const name of ["delai_reservation_jours", "saison_activite", "conditions_activite"]) {
      if (result[name] == null && idea[name] == null) delete result[name];
    }
    const mode = values.get("repetition");
    result.recurrence_mois = mode === "mois" ? Number(values.get("recurrence_mois")) : null;
    if (mode === "annee" || idea.saison_debut_mois != null) {
      result.saison_debut_mois = mode === "annee" ? Number(values.get("saison_debut_mois")) : null;
      result.saison_fin_mois = mode === "annee" ? Number(values.get("saison_fin_mois")) : null;
    }
    result.tags = (result.tags || "").split(",").map((item) => item.trim()).filter(Boolean);
    result.meilleure_periode = values.getAll("mois").map(Number);
    if (!result.titre) throw new E.UserError("Saisissez un titre.");
    if ((result.lat == null) !== (result.lng == null)) throw new E.UserError("Indiquez les deux coordonnées ou laissez-les vides.");
    if (result.date_debut && result.date_fin && result.date_fin < result.date_debut) throw new E.UserError("La fin doit suivre le début.");
    if (result.budget_min != null && result.budget_max != null && result.budget_max < result.budget_min) {
      throw new E.UserError("Le budget maximal doit être supérieur ou égal au minimum.");
    }
    for (const [key, label] of [["site_reservation", "de réservation"], ["source_url", "de la source"]]) {
      if (result[key] && !E.safeUrl(result[key])) throw new E.UserError("Utilisez une URL HTTPS " + label + ".");
    }
    return { ...result, ...window.EurekaSlots.read(values, idea) };
  }

  E.boot("ajout", async (ctx) => {
    if (!ctx.editor) throw new E.UserError("Cet espace est en lecture seule pour votre compte.");
    const idea = id ? await E.ideaById(ctx, id) : {};
    if (!idea) return E.ideaGone(ctx);
    if (id) $("#editor-title").textContent = "Modifier l’idée";
    const back = E.url(id ? "fiche.html" : "", { id, espace: ctx.space.id });
    $("#cancel-top").href = back;
    $("#cancel").href = back;
    $("#idea-fields").append(...fields.map((definition) => field(definition, idea[definition[0]])),
      period(idea.meilleure_periode || []));
    const slots = window.EurekaSlots;
    let slotIdea = idea;
    let slotFields = slots.fields(idea);
    form.elements.titre.closest("label").after(slotFields);
    form.elements.statut.closest("label").after(recurrenceFields(idea));
    const description = form.elements.description;
    description.value = E.withoutVerificationLabels(description.value);
    description.closest("label").after(descriptionPreview(description));
    E.bind(form, $("#form-status"), async (values) => {
      const body = payload(values, slotIdea);
      const table = sb.from("sorties_idees");
      const request = id
        ? table.update(body).eq("id", id).eq("espace_id", ctx.space.id)
        : table.insert({ ...body, espace_id: ctx.space.id });
      const saved = await data(request.select("id").single()).catch((error) => {
        if (Object.hasOwn(body, "brouillon_creneau") && ["PGRST204", "42703"].includes(error.code)
            && error.message?.includes("brouillon_creneau")) {
          throw new E.UserError("L’enregistrement des créneaux partiels sera disponible après la mise à jour de la base.");
        }
        if (values.get("repetition") === "annee" && ["PGRST204", "42703"].includes(error.code)) {
          throw new E.UserError("La récurrence annuelle sera disponible après la mise à jour de la base.");
        }
        throw error;
      });
      location.assign(E.url("fiche.html", { id: saved.id, espace: ctx.space.id }));
      return "Idée enregistrée.";
    });
    form.hidden = false;
    if (id) {
      const button = $("#completer-ia");
      const status = $("#completer-ia-status");
      button.hidden = false;
      button.addEventListener("click", async () => {
        if (button.disabled) return;
        button.disabled = true;
        E.message(status, "Claude prépare des propositions…");
        try {
          const { proposition } = await data(sb.functions.invoke("sorties-enrich", {
            body: { action: "completer_fiche", id, espace: ctx.space.id }
          }));
          if (!proposition) throw new E.UserError("Claude n’a renvoyé aucune proposition.");
          let changed = false;
          for (const name of ["accroche", "description", "categorie", "format", "adresse", "ville", "site_reservation",
            "telephone", "budget_min", "budget_max", "date_debut", "date_fin", "date_limite_reservation", "preavis_semaines", "delai_reservation_jours", "saison_activite", "conditions_activite"]) {
            const control = form.elements[name];
            if (control.value.trim() || proposition[name] == null) continue;
            control.value = typeof proposition[name] === "string" ? E.withoutVerificationLabels(proposition[name]) : proposition[name];
            if (control.value) {
              changed = true;
              control.dispatchEvent(new Event("input", { bubbles: true }));
            }
          }
          const monthChoices = [...form.querySelectorAll('input[name="mois"]')];
          if (Array.isArray(proposition.meilleure_periode) && !monthChoices.some((control) => control.checked)) {
            for (const control of monthChoices) {
              if (proposition.meilleure_periode.includes(Number(control.value))) {
                control.checked = true;
                changed = true;
              }
            }
          }
          if (!idea.parametres_creneau && proposition.proposition_creneau) {
            const current = slots.formValues(new FormData(form));
            const suggestion = proposition.proposition_creneau;
            const draft = { ...current };
            const mode = form.elements.plage_activite.value;
            let filledSlot = false;
            if (suggestion.weekend === true && !mode && !idea.brouillon_creneau
                && !current.jours.length && current.heure_activite == null && current.duree_minutes == null) {
              draft.weekend = true;
              draft.jours = [6];
              draft.vendredi_soir = suggestion.vendredi_soir === true;
              filledSlot = true;
            }
            for (const [name, value] of Object.entries(suggestion)) {
              if (value == null || !(draft[name] == null || (name === "jours" && !draft.jours.length))) continue;
              if (!draft.weekend && ["vendredi_soir", "heure_vendredi", "heure_retour", "retour_decalage"].includes(name)) continue;
              if (name === "heure_vendredi" && !draft.vendredi_soir) continue;
              draft[name] = value;
              filledSlot = true;
            }
            if (filledSlot) {
              // La valeur stockée sur la fiche reste celle chargée avant la proposition.
              slotIdea = { ...idea, brouillon_creneau: { ...draft, confirmation_requise: true } };
              const updated = slots.fields(slotIdea);
              slotFields.replaceWith(updated);
              slotFields = updated;
              changed = true;
            }
          }
          E.message(status, changed ? "Propositions ajoutées aux champs vides. Tu peux les modifier avant d’enregistrer."
            : "Claude n’a proposé aucune valeur pour les champs vides.");
        } catch (error) {
          const response = await error.context?.json?.().catch(() => null);
          E.message(status, response?.message || (error instanceof E.UserError ? error.message
            : "Impossible de compléter la fiche pour le moment."), true);
        } finally {
          button.disabled = false;
        }
      });
      if (location.hash === "#completer-ia") {
        history.replaceState(null, "", location.pathname + location.search);
        button.scrollIntoView({ block: "center" });
        button.click();
      }
    }
    if (id) E.watchIdea(ctx, idea);
  });
})();
