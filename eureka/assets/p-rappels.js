(() => {
  const E = window.Eureka;
  const { $, sb, el, data, params, message } = E;
  const vapidPublic = "BBkHgMDBgJTiHVrdDKjRY7SZCxJMSr3NRcdD0BPxrp9hY0YwtY629J6FobuCvam-WQ06ux1xkDhjEwKXs2coOq4";
  const stateNames = {
    reserve: "Réservation confirmée", reporte: "Reporté", archive: "Archivée",
    disponible: "Disponible", actuel: "Toujours d’actualité", baisse: "Priorité baissée"
  };
  const weightKeys = ["envie", "urgence", "saison", "ajouts", "recent"];
  const subscriptionKey = "eureka.push.user";
  const output = $("#push-status");

  function deviceOwner(value) {
    try {
      if (value === null) localStorage.removeItem(subscriptionKey);
      else if (value !== undefined) localStorage.setItem(subscriptionKey, value);
      return localStorage.getItem(subscriptionKey);
    } catch { return null; }
  }

  async function pushControls(ctx) {
    const button = $("#toggle-push");
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      message(output, "Les notifications ne sont pas disponibles ici. Sur iPhone, ouvrez Eurêka depuis l’écran d’accueil après l’y avoir ajouté.");
      return;
    }
    let registration;
    try {
      registration = await navigator.serviceWorker.register("/eureka/sw.js", { scope: "/eureka/" });
      if (!registration.active) {
        await Promise.race([navigator.serviceWorker.ready, new Promise((resolve) => setTimeout(resolve, 3500))]);
      }
      if (!registration.active) {
        message(output, "L’installation se termine. Rouvrez cette page pour activer les notifications.");
        return;
      }
    } catch {
      message(output, "Les notifications sont indisponibles sur cet appareil.", true);
      return;
    }
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && deviceOwner() !== ctx.user.id) {
      await subscription.unsubscribe();
      subscription = null;
    }

    function render() {
      button.hidden = false;
      button.textContent = subscription ? "Désactiver sur cet appareil" : "Activer sur cet appareil";
      message(output, subscription ? "Notifications activées sur cet appareil." : "Notifications désactivées sur cet appareil.");
    }
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        if (subscription) {
          await data(sb.rpc("sorties_desabonner_push", { p_endpoint: subscription.endpoint }));
          await subscription.unsubscribe();
          deviceOwner(null);
          subscription = null;
        } else {
          if (await Notification.requestPermission() !== "granted") {
            message(output, "Les notifications sont bloquées. Vous pouvez les autoriser dans les réglages de l’appareil.", true);
            return;
          }
          const raw = atob(vapidPublic.replace(/-/g, "+").replace(/_/g, "/"));
          const next = await registration.pushManager.subscribe({
            userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (char) => char.charCodeAt(0))
          });
          try {
            const { keys } = next.toJSON();
            await data(sb.rpc("sorties_abonner_push", {
              p_espace: ctx.space.id, p_endpoint: next.endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth
            }));
          } catch (error) {
            await next.unsubscribe();
            throw error;
          }
          deviceOwner(ctx.user.id);
          subscription = next;
        }
        render();
      } catch {
        message(output, "Ce réglage n’a pas pu être enregistré. Réessayez.", true);
      } finally {
        button.disabled = false;
      }
    });
    render();
  }

  function dayLabel(value) {
    return new Intl.DateTimeFormat("fr-CH", {
      day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Zurich"
    }).format(new Date(value));
  }

  function countdown(idea) {
    const target = idea.date_limite_reservation || idea.date_debut;
    if (!target) return "";
    const local = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date());
    const days = (Date.parse(target) - Date.parse(local)) / 86400000;
    return days === 0 ? "Échéance aujourd’hui" : days < 0 ? "Échéance passée" : "Échéance dans " + days + (days === 1 ? " jour" : " jours");
  }

  function sameCycle(row) {
    const idea = row.sorties_idees;
    const date = idea.date_limite_reservation || idea.date_debut;
    if (row.type === "suggestion") return !date;
    return Boolean(date && row.cycle && (Date.parse(date) - Date.parse(row.cycle)) / 86400000
      === Math.min(idea.preavis_semaines || 0, 5200) * 7);
  }

  function reminder(ctx, row, latest) {
    const item = el("li");
    const idea = row.sorties_idees;
    const selected = params.get("rappel") === row.id;
    if (selected) {
      item.className = "highlight";
      item.tabIndex = -1;
    }
    const scope = { espace: ctx.space.id, id: row.idee_id };
    const heading = el("h3");
    heading.append(E.link(idea.titre, E.url("fiche.html", scope)));
    item.append(el("p", dayLabel(row.prevu_le) + " · " +
      (row.type === "suggestion" ? "Suggestion" : "Réservation"), "eyebrow"), heading);
    if (row.motif) item.append(el("p", row.type === "suggestion" ? "Pourquoi cette idée ? " + row.motif : row.motif));
    if (row.type === "echeance" && row.etape >= 3) item.append(el("p", countdown(idea)));
    if (row.reponse) {
      const suffix = row.reporte_jusqua ? " au " + dayLabel(row.reporte_jusqua) : "";
      item.append(el("p", stateNames[row.reponse] + suffix));
      return item;
    }
    if (!latest || !sameCycle(row) || !["envie", "preselection"].includes(idea.statut)) return item;

    const area = el("div", null, "actions");
    const feedback = el("p", null, "wide-feedback");
    const buttons = [];
    function action(label, key, days = null) {
      const button = el("button", label);
      button.type = "button";
      buttons.push(button);
      button.addEventListener("click", async () => {
        buttons.forEach((b) => { b.disabled = true; });
        try {
          await data(sb.rpc("sorties_repondre_rappel", { p_id: row.id, p_reponse: key, p_jours: typeof days === "function" ? days() : days }));
          if (key === "disponible") {
            location.assign(E.url("fiche.html", scope) + "#plan-form");
            return;
          }
          feedback.textContent = stateNames[key];
          area.replaceWith(feedback);
        } catch {
          message(feedback, "Ce rappel a changé ou la réponse n’a pas été enregistrée. Actualisez la page.", true);
        } finally {
          buttons.forEach((b) => { b.disabled = false; });
        }
      });
      area.append(button);
      return button;
    }
    if (row.confirme_actualite) {
      item.append(el("p", "Toujours d’actualité ?"));
      action("Oui", "actuel");
      action("Archiver", "archive");
      action("Baisser la priorité", "baisse");
    } else {
      if (row.type === "suggestion") {
        item.append(el("p", "Libre ce week-end ?"));
        action("Oui", "disponible").dataset.notificationAction = "disponible";
        action("Non, dans 3 jours", "reporte", 3).dataset.notificationAction = "plus-tard";
      } else {
        const booking = E.link("Réserver", E.url("fiche.html", scope) + "#details", "button");
        booking.dataset.notificationAction = "reserver";
        area.append(booking);
        action("J’ai réservé", "reserve");
        if (row.etape === 10) action("Archiver", "archive");
      }
      const caption = el("label", "Reporter de", "grow");
      const days = el("select");
      E.options(days, { 3: "3 jours", 7: "1 semaine", 14: "2 semaines" });
      const hint = selected && params.get("action") === "plus-tard";
      if (hint) days.value = "3";
      caption.append(days);
      area.append(caption);
      action("Reporter", "reporte", () => Number(days.value));
    }
    item.append(area, feedback);
    return item;
  }

  E.boot("rappels", async (ctx) => {
    const scope = { espace: ctx.space.id };
    data(sb.rpc("sorties_agenda_actif", { p_espace: ctx.space.id })).then((allowed) => {
      if (!allowed) return;
      const link = $("#agenda-link");
      link.href = E.url("agendas.html", scope);
      link.hidden = false;
    }).catch(() => {});
    const [settings, reminders, pending] = await Promise.all([
      data(sb.from("sorties_reglages").select("max_notifs_par_jour,heure_semaine,heure_weekend,ton,poids_classement")
        .eq("espace_id", ctx.space.id).eq("user_id", ctx.user.id).maybeSingle()),
      data(sb.from("sorties_rappels").select(
        "id,idee_id,type,etape,prevu_le,cycle,motif,reponse,reporte_jusqua,confirme_actualite,sorties_idees(titre,statut,date_limite_reservation,date_debut,preavis_semaines)"
      ).eq("espace_id", ctx.space.id).eq("user_id", ctx.user.id).order("prevu_le", { ascending: false })
        .order("id", { ascending: false }).limit(80)),
      data(sb.rpc("sorties_gere_suivis", { p_espace: ctx.space.id })).then((principal) => principal
        ? data(sb.from("sorties_suivis").select("idee_id,sorties_idees(titre)").eq("espace_id", ctx.space.id)
          .eq("statut", "en_attente").order("cree_le").limit(80))
        : [])
    ]);
    const defaults = { max: settings?.max_notifs_par_jour ?? 2, semaine: settings?.heure_semaine?.slice(0, 5) || "18:30",
      weekend: settings?.heure_weekend?.slice(0, 5) || "10:00", ton: settings?.ton || "direct_humour" };
    const form = $("#preferences");
    for (const [name, value] of Object.entries(defaults)) form.elements[name].value = value;
    for (const key of weightKeys) form.elements[key].value = settings?.poids_classement?.[key] ?? 1;
    E.bind(form, $("#preferences-status"), async (fields) => {
      const weights = Object.fromEntries(weightKeys.map((key) => [key, Number(fields.get(key))]));
      await data(sb.rpc("sorties_enregistrer_reglages", {
        p_espace: ctx.space.id, p_max: Number(fields.get("max")), p_semaine: fields.get("semaine"),
        p_weekend: fields.get("weekend"), p_ton: fields.get("ton"), p_poids: weights
      }));
      return "Réglages enregistrés.";
    });
    const seen = new Set();
    const rows = reminders.filter((row) => row.sorties_idees).map((row) => {
      const key = row.idee_id + ":" + row.type + ":" + row.cycle;
      const latest = !seen.has(key);
      seen.add(key);
      return reminder(ctx, row, latest);
    });
    $("#reminder-list").replaceChildren(...(rows.length ? rows : [el("li", "Aucun rappel pour le moment.")]));
    const requests = new Map(pending.filter((row) => row.sorties_idees)
      .map((row) => [row.idee_id, row.sorties_idees.titre]));
    for (const [id, title] of requests) {
      const item = el("li");
      item.append(E.link(title, E.url("fiche.html", { ...scope, id }) + "#following"));
      $("#pending-list").append(item);
    }
    $("#pending-section").hidden = !requests.size;
    $("#reminders-page").hidden = false;
    const selected = $(".highlight");
    if (selected) {
      const action = [...selected.querySelectorAll("[data-notification-action]")]
        .find((control) => control.dataset.notificationAction === params.get("action"));
      (action || selected).focus({ preventScroll: true });
      selected.scrollIntoView({ block: "start" });
    }
    pushControls(ctx).catch(() => message(output, "Les notifications sont indisponibles sur cet appareil.", true));
  });
})();
