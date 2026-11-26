(() => {
  const E = window.Eureka;
  const { sb, $, el, params, data } = E;
  const form = $("#idea-form");
  const id = params.get("id");

  const fields = [
    ["titre", "Titre", { required: true, wide: true }],
    ["accroche", "Accroche", { wide: true }],
    ["description", "Description", { type: "textarea", wide: true }],
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

  function descriptionPreview(input, checks) {
    const panel = el("div", null, "wide description-preview");
    const preview = el("div", null, "prose");
    const caption = el("h2", "Aperçu de la description");
    panel.append(caption, preview);
    const entries = E.verificationEntries(checks);
    if (entries.length) {
      const list = el("dl", null, "rows");
      for (const [label, reason] of entries) {
        const item = el("div");
        item.append(el("dt", label, "description-heading"), el("dd", reason, "prose"));
        list.append(item);
      }
      panel.append(list);
    }
    function update() {
      const empty = !input.value.trim();
      caption.hidden = preview.hidden = empty;
      panel.hidden = empty && !entries.length;
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
    result.parametres_creneau = window.EurekaSlots.read(values);
    return result;
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
    form.elements.statut.closest("label").after(recurrenceFields(idea), window.EurekaSlots.fields(idea));
    const description = form.elements.description;
    description.closest("label").after(descriptionPreview(description, idea.a_verifier));
    E.bind(form, $("#form-status"), async (values) => {
      const body = payload(values, idea);
      const table = sb.from("sorties_idees");
      const request = id
        ? table.update(body).eq("id", id).eq("espace_id", ctx.space.id)
        : table.insert({ ...body, espace_id: ctx.space.id });
      const saved = await data(request.select("id").single()).catch((error) => {
        if (values.get("repetition") === "annee" && ["PGRST204", "42703"].includes(error.code)) {
          throw new E.UserError("La récurrence annuelle sera disponible après la mise à jour de la base.");
        }
        throw error;
      });
      location.assign(E.url("fiche.html", { id: saved.id, espace: ctx.space.id }));
      return "Idée enregistrée.";
    });
    form.hidden = false;
    if (id) E.watchIdea(ctx, idea);
  });
})();
