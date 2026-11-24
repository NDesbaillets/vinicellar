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
    row("Récurrence", idea.recurrence_mois ? "Tous les " + idea.recurrence_mois + " mois" : null);
    row("Sortie", E.modalites[idea.modalite]);
    row("Mots-clés", idea.tags.join(", "));
    row("Notes", idea.notes);
    row("Source", external("Consulter la source", idea.source_url));
    for (const [field, reason] of Object.entries(idea.a_verifier)) {
      if (typeof reason === "string") row(field === "import" ? "Import" : "À vérifier · " + field.replaceAll("_", " "), reason);
    }
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

  E.boot("fiche", async (ctx) => {
    let idea = await E.ideaById(ctx, id);
    if (!idea) throw new E.UserError("Cette idée n’est pas accessible.");
    const scope = { espace: ctx.space.id };
    $(".back").href = E.url("", scope);
    $("#edit").href = E.url("editer.html", { ...scope, id });
    async function showIdea() {
      const photos = await pages(() => sb.from("sorties_photos")
        .select("chemin,position").eq("idee_id", id).order("position")).catch(() => []);
      const signed = await E.signedPhotos([idea.image_path, ...photos.map((row) => row.chemin)]).catch(() => new Map());
      const cover = E.visual(signed.get(idea.image_path) || idea.image_path);
      const old = $("#hero > .visual");
      if (old) old.replaceWith(cover);
      else $("#hero").prepend(cover);
      const extras = photos.filter((row) => row.chemin !== idea.image_path && signed.has(row.chemin));
      $("#gallery").replaceChildren(...extras.map((row) => E.visual(signed.get(row.chemin))));
      $("#gallery-section").hidden = !extras.length;
      $("#urgent").hidden = idea.urgence < 4;
      $("#meta").textContent = E.meta(idea);
      $("#title").textContent = idea.titre;
      $("#pitch").textContent = idea.accroche || "";
      $("#pitch").hidden = !idea.accroche;
      $("#description").textContent = idea.description || "";
      $("#description-section").hidden = !idea.description;
      document.title = idea.titre + " · Eurêka";
      details(idea);
      $("#map").replaceChildren();
      map(idea);
    }
    await showIdea();

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
    async function occurrences() {
      history = await pages(() => sb.from("sorties_occurrences")
        .select("id,date_cible,date_realisee,statut,sorties_notes_occurrence(user_id,note,commentaire)")
        .eq("idee_id", id).order("date_cible", { ascending: false }).order("id"));
      const rows = history.map((item) => {
        const node = el("div", null, "occurrence");
        node.append(el("strong", E.date(item.date_cible) + " · " + occurrenceStates[item.statut]));
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
          if (item.statut === "faite" && idea.recurrence_mois) {
            const next = el("button", "À reprévoir ?");
            next.type = "button";
            next.addEventListener("click", () => {
              planForm.elements.date.value = addMonths(item.date_realisee || item.date_cible, idea.recurrence_mois);
              planForm.elements.date.focus();
            });
            node.append(next);
          }
        }
        return node;
      });
      $("#occurrences").replaceChildren(...(rows.length ? rows : [el("p", "Aucune occurrence pour cette idée.")]));
    }

    E.options(statusForm.elements.statut, E.statuts);
    statusForm.elements.statut.value = idea.statut;
    planForm.elements.date.value = idea.date_debut || "";
    E.bind(statusForm, output, async (values) => {
      await changeIdea({ statut: values.get("statut") });
      return "Statut enregistré.";
    });
    let savedDate;
    E.bind(planForm, output, async (values) => {
      const date = values.get("date");
      if (savedDate !== date && !history.some((item) => item.date_cible === date && item.statut === "prevue")) {
        await data(sb.from("sorties_occurrences").insert({ idee_id: id, date_cible: date }));
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
