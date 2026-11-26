(() => {
  const E = window.Eureka;
  const { sb, $, el, data, pages } = E;
  const output = $("#action-status");
  const statusForm = $("#status-form");
  const planForm = $("#plan-form");
  const id = E.params.get("id");
  const occurrenceStates = { prevue: "Prévue", faite: "Faite", annulee: "Annulée" };

  function external(text, value) {
    const href = E.safeUrl(value);
    if (!href) return value;
    const node = E.link(text, href);
    node.target = "_blank";
    node.rel = "noopener noreferrer";
    return node;
  }

  function row(label, value) {
    if (value == null || value === "") return;
    const line = el("div", null, "row");
    const detail = el("dd");
    detail.append(value);
    line.append(el("dt", label), detail);
    $("#details").append(line);
  }

  function position(lat, lng) {
    return lat != null && lng != null
      ? external("Ouvrir dans OpenStreetMap", "https://www.openstreetmap.org/?mlat=" + lat + "&mlon=" + lng + "#map=14/" + lat + "/" + lng)
      : null;
  }

  function map(idea) {
    const lat = Number(idea.lat);
    const lng = Number(idea.lng);
    if (idea.lat == null || idea.lng == null) return;
    const host = $("#map");
    const button = el("button", "Afficher la carte");
    button.type = "button";
    host.append(button);
    button.addEventListener("click", () => {
      const source = new URL("https://www.openstreetmap.org/export/embed.html");
      const bbox = [Math.max(-180, lng - 0.02), Math.max(-90, lat - 0.01),
        Math.min(180, lng + 0.02), Math.min(90, lat + 0.01)];
      source.search = new URLSearchParams({ bbox: bbox.join(","), marker: lat + "," + lng, layer: "mapnik" });
      const frame = el("iframe", null, "map-frame");
      frame.title = "Carte du lieu de la sortie";
      frame.referrerPolicy = "no-referrer";
      frame.src = source.href;
      host.replaceChildren(frame);
    });
  }

  function details(idea) {
    $("#details").replaceChildren();
    const contact = idea.telephone?.replace(/[^\d+]/g, "");
    row("Statut", E.statuts[idea.statut]);
    row("Adresse", [idea.adresse, idea.ville].filter(Boolean).join(", "));
    row("Carte", position(idea.lat, idea.lng));
    row("Réservation", external("Site de réservation", idea.site_reservation));
    row("Téléphone", contact && /^\+?\d+$/.test(contact) ? E.link(idea.telephone, "tel:" + contact) : idea.telephone);
    const minimum = idea.budget_min == null ? null : E.currency.format(idea.budget_min);
    const maximum = idea.budget_max == null ? null : E.currency.format(idea.budget_max);
    row("Budget", minimum && maximum ? minimum + " – " + maximum : minimum ? "Dès " + minimum : maximum ? "Jusqu’à " + maximum : null);
    row("Début", E.date(idea.date_debut));
    row("Fin", E.date(idea.date_fin));
    row("Réserver avant", E.date(idea.date_limite_reservation));
    row("Préavis", idea.preavis_semaines == null ? null : idea.preavis_semaines + " sem.");
    row("Meilleure période", idea.meilleure_periode.map((month) => E.mois[month]).join(", "));
    const firstMonth = E.mois[idea.saison_debut_mois];
    const lastMonth = E.mois[idea.saison_fin_mois];
    row("Récurrence", firstMonth && lastMonth
      ? "Chaque année · " + (firstMonth === lastMonth ? firstMonth : firstMonth + " à " + lastMonth)
      : idea.recurrence_mois ? "Tous les " + idea.recurrence_mois + " mois" : null);
    const planning = idea.parametres_creneau;
    if (planning) {
      const days = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
      row("Temps à prévoir", planning.duree_minutes + " min d’activité · " + planning.aller_minutes
        + " min depuis Nyon · " + planning.retour_minutes + " min de retour");
      row("Jours possibles", planning.jours.map((day) => days[day - 1]).join(", ") + (planning.demi_journee_flexible ? " · demi-journée flexible" : " à " + planning.heure_activite));
      if (planning.weekend) row("Week-end", (planning.vendredi_soir ? "Départ de Nyon vendredi à "
        + planning.heure_vendredi + " · " : "") + "Départ du lieu " + days[(5 + planning.retour_decalage) % 7]
        + " à " + planning.heure_retour);
    } else row("Créneau à réserver", idea.brouillon_creneau ? "Brouillon enregistré · à compléter"
      : idea.proposition_creneau ? "Proposition de Claude à confirmer" : "À compléter");
    row("Sortie", E.modalites[idea.modalite]);
    row("Mots-clés", idea.tags.join(", "));
    row("Notes", idea.notes);
    row("Source", external("Consulter la source", idea.source_url));
    for (const [label, reason] of E.verificationEntries(idea.a_verifier)) row(label, reason);
  }

  function scoreCell(label, value, accent) {
    const cell = el("div", null, "score");
    cell.append(el("strong", value == null ? "—" : E.number.format(value), accent ? "couple" : ""));
    cell.append(el("p", label, "score-label"));
    return cell;
  }

  function scoreForm(label, value, step, action) {
    const form = el("form");
    const input = el("input");
    input.type = "number";
    input.name = "score";
    input.min = 0;
    input.max = 10;
    input.step = step;
    input.value = value ?? "";
    input.required = step === "1";
    input.setAttribute("aria-label", label);
    const feedback = el("p");
    form.append(input, el("button", "Valider"), feedback);
    E.bind(form, feedback, (values) => {
      const raw = values.get("score");
      return action(raw === "" ? null : Number(raw));
    });
    return form;
  }

  function addMonths(value, amount) {
    const [year, month, day] = value.split("-").map(Number);
    const target = new Date(Date.UTC(year, month - 1 + amount, 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(day, last));
    return target.toISOString().slice(0, 10);
  }

  async function followControls(ctx, members) {
    const role = await data(sb.rpc("sorties_suivi_role", { p_espace: ctx.space.id })).catch(() => null);
    if (!role) return;
    const section = $("#following");
    const controls = $("#following-controls");
    const feedback = $("#following-status");
    const status = { en_attente: "Demande en attente", accepte: "Suivi accepté", refuse: "Suivi refusé" };
    section.hidden = false;
    async function render() {
      const follows = await pages(() => sb.from("sorties_suivis").select("demandeuse,statut")
        .eq("espace_id", ctx.space.id).eq("idee_id", id).order("demandeuse"));
      controls.replaceChildren();
      if (role === "demande") {
        const mine = follows.find((row) => row.demandeuse === ctx.user.id);
        const line = el("div", null, "actions");
        line.append(el("p", mine ? status[mine.statut] : "Recevoir une notification pour cette idée si votre demande est acceptée."));
        line.append(action(mine ? "Retirer le suivi" : "Demander à suivre", () =>
          sb.rpc("sorties_demander_suivi", { p_idee: id, p_activer: !mine })));
        controls.append(line);
        return;
      }
      if (!follows.length) controls.append(el("p", "Aucune demande pour cette idée."));
      for (const row of follows) {
        const name = members.find((member) => member.user_id === row.demandeuse)?.prenom_affiche || "Membre de l’espace";
        const line = el("div", null, "actions");
        line.append(el("p", name + " · " + status[row.statut]));
        const decide = (accepted) => sb.rpc("sorties_decider_suivi",
          { p_idee: id, p_demandeuse: row.demandeuse, p_accepter: accepted });
        if (row.statut === "en_attente") line.append(action("Accepter", () => decide(true)), action("Refuser", () => decide(false)));
        if (row.statut === "accepte") line.append(action("Révoquer le suivi", () => decide(false)));
        controls.append(line);
      }
    }
    function action(label, operation) {
      const button = el("button", label);
      button.type = "button";
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await data(operation());
          await render();
          E.message(feedback, "Suivi enregistré.");
        } catch {
          E.message(feedback, "Le suivi n’a pas pu être enregistré. Réessayez.", true);
        } finally {
          button.disabled = false;
        }
      });
      return button;
    }
    await render();
  }

  E.boot("fiche", async (ctx) => {
    let idea = await E.ideaById(ctx, id);
    if (!idea) return E.ideaGone(ctx);
    const scope = { espace: ctx.space.id };
    $(".back").href = E.url("", scope);
    $("#edit").href = E.url("editer.html", { ...scope, id });
    $("#complete-idea").href = $("#edit").href + "#completer-ia";
    let photoEditing = false;
    async function showIdea() {
      const query = (columns) => pages(() => sb.from("sorties_photos")
        .select(columns).eq("idee_id", id).order("position").order("chemin"));
      const photos = await query("chemin,position,categorie").then((rows) => {
        photoEditing = ctx.editor;
        return rows;
      }).catch(() => query("chemin,position").catch(() => []));
      const signed = await E.signedPhotos([idea.image_path, ...photos.map((row) => row.chemin)]).catch(() => new Map());
      const cover = E.visual(signed.get(idea.image_path) || idea.image_path);
      const old = $("#hero > .visual");
      if (old) old.replaceWith(cover);
      else $("#hero").prepend(cover);
      const extras = photos.filter((row) => row.chemin !== idea.image_path && signed.has(row.chemin));
      const memories = extras.filter((row) => row.categorie === "souvenir");
      const illustrations = extras.filter((row) => row.categorie !== "souvenir");
      $("#gallery").replaceChildren(...illustrations.map((row) => E.visual(signed.get(row.chemin))));
      $("#souvenirs-gallery").replaceChildren(...memories.map((row) => E.visual(signed.get(row.chemin))));
      $("#gallery-section").hidden = !illustrations.length && !photoEditing;
      $("#souvenirs-section").hidden = !memories.length && !photoEditing;
      $("#urgent").hidden = idea.urgence < 4;
      $("#meta").textContent = E.meta(idea);
      $("#title").textContent = idea.titre;
      $("#pitch").textContent = idea.accroche || "";
      $("#pitch").hidden = !idea.accroche;
      E.renderDescription($("#description"), idea.description);
      $("#description-section").hidden = !idea.description;
      document.title = idea.titre + " · Eurêka";
      details(idea);
      $("#map").replaceChildren();
      map(idea);
    }
    await showIdea();

    if (photoEditing) {
      const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
      for (const [selector, category] of [["#illustration-form", "illustration"], ["#souvenirs-form", "souvenir"]]) {
        const form = $(selector);
        const input = form.elements.photos;
        const paste = $(".paste-photo", form);
        const feedback = $(".photo-status", form);
        let uploads = [];
        function selectPhotos(files, fromClipboard = false) {
          const chosen = category === "illustration" ? files.slice(0, 1) : files;
          const selected = chosen.map((file) => ({
            file, name: crypto.randomUUID() + "." + extensions[file.type], complete: false
          }));
          uploads = fromClipboard && category === "souvenir" ? [...uploads, ...selected] : selected;
          const count = uploads.filter((upload) => !upload.complete).length;
          E.message(feedback, count === 1 ? "1 photo prête à ajouter." :
            count ? count + " photos prêtes à ajouter." : "");
        }
        input.addEventListener("change", () => selectPhotos([...input.files]));
        paste.addEventListener("click", async () => {
          try {
            const files = await E.clipboardPhotos(extensions);
            if (!files.length) throw new Error();
            if (input.disabled) return;
            input.value = "";
            selectPhotos(files, true);
          } catch {
            E.message(feedback, "Aucune image accessible dans le presse-papiers. Copiez une image ou choisissez un fichier.", true);
          }
        });
        form.addEventListener("paste", (event) => {
          const files = [...event.clipboardData.files].filter((file) => extensions[file.type]);
          if (!files.length || input.disabled) return;
          event.preventDefault();
          input.value = "";
          selectPhotos(files, true);
        });
        form.hidden = false;
        E.bind(form, feedback, async () => {
          if (!uploads.length || uploads.some(({ file }) => !extensions[file.type] || !file.size || file.size > 5_000_000)) {
            throw new E.UserError("Choisis des images JPEG, PNG ou WebP de 5 Mo maximum chacune.");
          }
          input.disabled = paste.disabled = true;
          try {
            for (const upload of uploads) {
              if (upload.complete) continue;
              const path = [ctx.space.id, ctx.user.id, "fiche", id, upload.name].join("/");
              const storage = sb.storage.from("eureka-photos");
              const { error } = await storage.upload(path, upload.file, { contentType: upload.file.type });
              if (error && error.error !== "Duplicate" && String(error.statusCode) !== "409") throw error;
              const linked = await sb.rpc("sorties_ajouter_photo_fiche", {
                p_espace: ctx.space.id, p_idee: id, p_nom: upload.name, p_categorie: category
              });
              if (linked.error) {
                if (["22023", "42501"].includes(linked.error.code)) await storage.remove([path]);
                throw linked.error;
              }
              upload.complete = true;
            }
            input.value = "";
            uploads = [];
            return category === "illustration" ? "Photo de couverture mise à jour." : "Photos souvenirs ajoutées.";
          } finally {
            input.disabled = paste.disabled = false;
            const updated = await E.ideaById(ctx, id).catch(() => null);
            if (updated) {
              idea = updated;
              await showIdea().catch(() => {});
            }
          }
        }, "L’ajout des photos n’a pas pu se terminer. Réessaie avec la même sélection.");
      }
    }

    const [members, options] = await Promise.all([
      pages(() => sb.from("sorties_espace_membres").select("user_id,prenom_affiche").eq("espace_id", ctx.space.id).order("user_id")),
      pages(() => sb.from("sorties_options").select("id,nom,lieu,lat,lng,lien,note").eq("idee_id", id).order("id"))
    ]);
    for (const item of options) {
      const node = el("li");
      node.append(el("strong", item.nom));
      if (item.lieu) node.append(el("p", item.lieu));
      if (item.note) node.append(el("p", item.note, "prose"));
      for (const info of [external("Site de l’option", item.lien), position(item.lat, item.lng)]) {
        if (info) {
          const line = el("div");
          line.append(info);
          node.append(line);
        }
      }
      $("#options").append(node);
    }
    $("#options-section").hidden = !options.length;

    async function changeIdea(body) {
      idea = await E.mustUpdate(sb.from("sorties_idees").update(body).eq("id", id).eq("espace_id", ctx.space.id));
      statusForm.elements.statut.value = idea.statut;
      details(idea);
    }

    async function scores() {
      const [wishes, couple] = await Promise.all([
        pages(() => sb.from("sorties_envies").select("user_id,score").eq("idee_id", id).order("user_id")),
        data(sb.from("sorties_scores_couple").select("score").eq("espace_id", ctx.space.id).eq("idee_id", id).maybeSingle())
      ]);
      const points = new Map(wishes.map((wish) => [wish.user_id, wish.score]));
      const cells = members.map((member) => {
        const value = points.get(member.user_id);
        const cell = scoreCell(member.prenom_affiche, value);
        if (ctx.editor && member.user_id === ctx.user.id) {
          cell.append(scoreForm("Mon score d’envie", value, "1", async (score) => {
            const table = () => sb.from("sorties_envies");
            const update = () => E.mustUpdate(table().update({ score }).eq("idee_id", id).eq("user_id", ctx.user.id));
            if (points.has(ctx.user.id)) await update();
            else {
              const result = await table().insert({ idee_id: id, score });
              if (result.error?.code === "23505") await update();
              else if (result.error) throw result.error;
            }
            await scores();
            E.message(output, "Votre envie est enregistrée.");
            return "Votre envie est enregistrée.";
          }));
        }
        return cell;
      });
      const cell = scoreCell("Couple · " + (idea.score_couple_manuel == null ? "moyenne" : "manuel"), couple?.score, true);
      if (ctx.editor) {
        cell.append(scoreForm("Score couple manuel, vide pour la moyenne", idea.score_couple_manuel, "0.1", async (score) => {
          await changeIdea({ score_couple_manuel: score });
          await scores();
          E.message(output, "Score couple enregistré.");
          return "Score couple enregistré.";
        }));
      }
      $("#scores").replaceChildren(...cells, cell);
    }

    let history = [];
    const seasons = E.annualSeasons(idea);
    const seasonSelect = planForm.elements.saison;
    const dateInput = planForm.elements.date;
    if (seasons.length) {
      $("#season-picker").hidden = false;
      $("#annual-season").hidden = false;
      seasonSelect.disabled = false;
      E.options(seasonSelect, Object.fromEntries(seasons.map((season) => [season.start, E.seasonLabel(season)])));
      const requested = E.params.get("saison");
      if (seasons.some((season) => season.start === requested)) seasonSelect.value = requested;
      seasonSelect.addEventListener("change", updateSeason);
    }

    function updateSeason() {
      const season = seasons.find((item) => item.start === seasonSelect.value);
      if (!season) return;
      dateInput.min = season.start;
      dateInput.max = season.end;
      if (dateInput.value && (dateInput.value < season.start || dateInput.value > season.end)) dateInput.value = "";
      $("#annual-period").textContent = E.seasonLabel(season);
      const matches = E.seasonOccurrences(season, history);
      const completed = matches.find((item) => item.statut === "faite");
      $("#annual-state").textContent = completed
        ? "Réalisée cette saison le " + E.date(completed.date_realisee || completed.date_cible) + "."
        : matches.length ? "Déjà planifiée pour cette saison."
        : "À planifier au moins une fois cette saison.";
    }

    async function occurrences() {
      history = await pages(() => sb.from("sorties_occurrences")
        .select("id,date_cible,date_realisee,statut,debut_planifie,fin_planifie,sorties_notes_occurrence(user_id,note,commentaire)")
        .eq("idee_id", id).order("date_cible", { ascending: false }).order("id"));
      const rows = history.map((item) => {
        const node = el("div", null, "occurrence");
        node.append(el("strong", E.date(item.date_cible) + " · " + occurrenceStates[item.statut]));
        if (item.debut_planifie) node.append(el("p", window.EurekaSlots.describe(window.EurekaSlots.eventSlot(item))));
        if (item.date_realisee) node.append(el("p", "Réalisée le " + E.date(item.date_realisee)));
        const notes = item.sorties_notes_occurrence;
        const own = notes.find((entry) => entry.user_id === ctx.user.id);
        for (const entry of notes) {
          const author = members.find((member) => member.user_id === entry.user_id)?.prenom_affiche || "Ancien membre";
          const text = [entry.note, entry.commentaire].filter(Boolean).join(" — ");
          if (text) node.append(el("p", author + " · " + text, "prose"));
        }
        if (ctx.editor) {
          if (item.statut === "prevue") {
            const completion = el("form", null, "actions");
            const caption = el("label", "Date de réalisation", "grow");
            const done = el("input");
            done.type = "date";
            done.name = "date";
            done.value = item.date_cible;
            done.required = true;
            caption.append(done);
            const feedback = el("p", null, "wide-feedback");
            completion.append(caption, el("button", "Marquer réalisée"), feedback);
            E.bind(completion, feedback, async (values) => {
              await E.mustUpdate(sb.from("sorties_occurrences")
                .update({ statut: "faite", date_realisee: values.get("date") })
                .eq("id", item.id).eq("idee_id", id));
              await occurrences();
              E.message(output, "Occurrence réalisée.");
            });
            node.append(completion);
          }
          const editor = el("form", null, "actions");
          const label = el("label", "Ma note", "grow");
          const input = el("input");
          input.name = "note";
          input.value = own?.note ?? "";
          input.required = true;
          label.append(input);
          const feedback = el("p", null, "wide-feedback");
          editor.append(label, el("button", "Enregistrer la note"), feedback);
          E.bind(editor, feedback, async (values) => {
            const note = values.get("note").trim();
            if (!note) throw new E.UserError("Saisissez une note.");
            const table = sb.from("sorties_notes_occurrence");
            if (own) await E.mustUpdate(table.update({ note }).eq("occurrence_id", item.id).eq("user_id", ctx.user.id));
            else await data(table.insert({ occurrence_id: item.id, note }));
            await occurrences();
            E.message(output, "Note enregistrée.");
          });
          node.append(editor);
          if (item.statut === "faite" && idea.recurrence_mois && idea.parametres_creneau) {
            const next = el("button", "À reprévoir ?");
            next.type = "button";
            next.addEventListener("click", () => {
              planForm.elements.date.value = addMonths(item.date_realisee || item.date_cible, idea.recurrence_mois);
              planForm.elements.date.dispatchEvent(new Event("input"));
              planForm.elements.date.focus();
            });
            node.append(next);
          }
        }
        return node;
      });
      $("#occurrences").replaceChildren(...(rows.length ? rows : [el("p", "Aucune occurrence pour cette idée.")]));
      updateSeason();
    }

    E.options(statusForm.elements.statut, E.statuts);
    statusForm.elements.statut.value = idea.statut;
    dateInput.value = seasons.length ? "" : idea.date_debut || "";
    E.bind(statusForm, output, async (values) => {
      await changeIdea({ statut: values.get("statut") });
      return "Statut enregistré.";
    });
    const slots = window.EurekaSlots;
    if (!idea.parametres_creneau) {
      planForm.before(el("p", "Complète et confirme le créneau dans la modification de la fiche avant de planifier."));
      planForm.hidden = true;
    }
    const plannedRange = el("p");
    plannedRange.setAttribute("role", "status");
    planForm.after(plannedRange);
    function showPlannedRange() {
      const date = dateInput.value;
      const range = slots.slot(idea.parametres_creneau, date);
      plannedRange.textContent = range ? (idea.parametres_creneau.demi_journee_flexible
        ? "Une demi-journée libre sera recherchée à cette date." : slots.describe(range)) : "";
    }
    dateInput.addEventListener("input", showPlannedRange);
    showPlannedRange();
    let savedDate;
    E.bind(planForm, output, async (values) => {
      const date = values.get("date");
      const season = seasons.find((item) => item.start === values.get("saison"));
      if (seasons.length && (!season || date < season.start || date > season.end)) {
        throw new E.UserError("Choisis une date dans la saison sélectionnée.");
      }
      if (savedDate !== date && !history.some((item) => item.date_cible === date && item.statut === "prevue")) {
        const range = await slots.findForDate(ctx.space.id, idea.parametres_creneau, date);
        await data(sb.from("sorties_occurrences").insert(slots.occurrence(id, range))).catch((error) => {
          if (error.code === "23P01") throw new E.UserError("Ce créneau chevauche une sortie déjà planifiée.");
          throw error;
        });
        savedDate = date;
      }
      try {
        await changeIdea({ statut: "planifiee" });
        await occurrences();
      } catch {
        throw new E.UserError("Le créneau existe, mais l’affichage ou le statut n’a pas pu être actualisé. Vous pouvez réessayer.");
      }
      savedDate = undefined;
      return "Sortie planifiée pour le " + E.date(date) + ".";
    });

    await Promise.all([scores(), occurrences()]);
    $("#edit-actions").hidden = !ctx.editor;
    $("#idea").hidden = false;
    E.watchIdea(ctx, idea);
    followControls(ctx, members).catch(() => E.message($("#following-status"), "Le suivi est indisponible.", true));

    let importId = E.params.get("import");
    if (!importId && idea.a_verifier.import) {
      const imports = await data(sb.from("sorties_inbox").select("id").eq("espace_id", ctx.space.id)
        .eq("idee_id", id).eq("user_id", ctx.user.id).limit(1)).catch(() => []);
      importId = imports[0]?.id;
    }
    if (!importId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(importId)) return;
    const section = $("#import-section");
    const label = $("#import-status");
    const retry = $("#retry-import");
    let deadline = Date.now() + 155_000;
    let refreshed = false;
    section.hidden = false;
    async function progress() {
      try {
        const row = await data(sb.from("sorties_inbox").select("statut,erreur,alerte_budget")
          .eq("id", importId).eq("espace_id", ctx.space.id).eq("idee_id", id).maybeSingle());
        if (!row) {
          section.hidden = true;
          return;
        }
        const budget = row.alerte_budget ? " Le seuil de 70 % du budget mensuel de l’espace est atteint ou le coût prévu dépasse le solde." : "";
        const expired = Date.now() >= deadline;
        if (row.statut === "traite") {
          if (!refreshed) {
            idea = await E.ideaById(ctx, id) || idea;
            await showIdea();
            refreshed = true;
          }
          E.message(label, (row.erreur || "Enrichissement terminé.") + budget);
          retry.hidden = true;
        } else if (row.statut === "echec" || expired || row.statut === "nouveau") {
          E.message(label, (row.erreur || "La fiche est enregistrée. L’enrichissement peut être relancé.") + budget, row.statut === "echec");
          retry.hidden = !ctx.editor;
        } else {
          E.message(label, "Fiche enregistrée. Enrichissement en cours…" + budget);
          retry.hidden = true;
          setTimeout(progress, 3000);
        }
      } catch {
        E.message(label, "Le suivi est indisponible. La fiche est enregistrée.", true);
        retry.hidden = !ctx.editor;
      }
    }
    retry.addEventListener("click", async () => {
      retry.disabled = true;
      try {
        await data(sb.functions.invoke("sorties-enrich", { body: { id: importId, espace: ctx.space.id, reprendre: true } }));
        deadline = Date.now() + 155_000;
        await progress();
      } catch {
        E.message(label, "Impossible de relancer l’enrichissement. Réessayez.", true);
      } finally {
        retry.disabled = false;
      }
    });
    await progress();
  });
})();
