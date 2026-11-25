(() => {
  const config = window.VC_CONFIG;
  const sb = window.supabase && config?.supabaseUrl && config.supabaseAnonKey
    ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
    : null;
  const $ = (selector, root = document) => root.querySelector(selector);
  const params = new URLSearchParams(location.search);
  const formats = { demi_journee: "Demi-journée", journee: "Journée", week_end: "Week-end", sejour: "Séjour" };
  const statuts = { envie: "Envie", preselection: "Présélectionnée", planifiee: "Planifiée", faite: "Faite", archivee: "Archivée", manquee: "Manquée" };
  const modalites = { couple: "En couple", seul: "En solo" };
  const mois = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [
    i + 1, new Intl.DateTimeFormat("fr-CH", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, i)))
  ]));
  const number = new Intl.NumberFormat("fr-CH", { maximumFractionDigits: 1 });
  const currency = new Intl.NumberFormat("fr-CH", { style: "currency", currency: "CHF" });

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function renderDescription(target, text = "") {
    const heading = /^([^\S\n]*(?:Idée|Programme suggéré|Repas et pauses|À prévoir|Points d'attention|Points d’attention|Vérifié sur le web)[^\S\n]*:)/i;
    const output = document.createDocumentFragment();
    for (const [index, line] of (text || "").replace(/\r\n?/g, "\n").split("\n").entries()) {
      if (index) output.append("\n");
      const label = line.match(heading)?.[0];
      if (label) output.append(el("strong", label, "description-heading"));
      const parts = line.slice(label?.length ?? 0).split(/(\([^\S\n]*à[^\S\n]+vérifier[^\S\n]*\))/gi);
      parts.forEach((part, index) => output.append(index % 2 ? el("mark", part, "description-check") : part));
    }
    target.replaceChildren(output);
  }

  function verificationEntries(checks) {
    return Object.entries(checks || {})
      .filter(([, reason]) => typeof reason === "string")
      .map(([field, reason]) => [field === "import" ? "Import" : "À vérifier · " + field.replaceAll("_", " "), reason]);
  }

  function link(text, href, className) {
    const node = el("a", text, className);
    node.href = href;
    return node;
  }

  function url(path = "", values = {}) {
    const search = new URLSearchParams(Object.entries(values).filter(([, value]) => value != null && value !== ""));
    return "/eureka/" + path + (search.size ? "?" + search : "");
  }

  function safeUrl(value) {
    if (!value) return null;
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" ? parsed.href : null;
    } catch {
      return null;
    }
  }

  function visual(path) {
    const box = el("div", null, "visual");
    const src = safeUrl(path);
    if (src) {
      const img = el("img");
      img.src = src;
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => img.remove(), { once: true });
      box.append(img);
    }
    return box;
  }

  function privatePhoto(value) {
    return typeof value === "string" && /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/(?:[0-9a-f-]{36}\/[1-5]|fiche\/[0-9a-f-]{36}\/[0-9a-f-]{36})\.(jpg|png|webp)$/.test(value);
  }

  async function signedPhotos(paths) {
    const keys = [...new Set(paths.filter(privatePhoto))];
    const signed = new Map();
    for (let i = 0; i < keys.length; i += 100) {
      const { data: batch } = await sb.storage.from("eureka-photos").createSignedUrls(keys.slice(i, i + 100), 900);
      for (const row of batch || []) if (row.signedUrl) signed.set(row.path, row.signedUrl);
    }
    return signed;
  }

  function options(select, entries, empty) {
    select.replaceChildren();
    if (empty != null) select.add(new Option(empty, ""));
    for (const [value, label] of Object.entries(entries)) select.add(new Option(label, value));
  }

  function date(value) {
    if (!value) return null;
    return value.split("-").reverse().join(".");
  }

  function meta(idea) {
    return [
      formats[idea.format],
      idea.categorie,
      idea.ville || (idea.type_lieu === "generique" ? "Sans lieu fixe" : null),
      idea.distance_nyon_km != null ? number.format(idea.distance_nyon_km) + " km" : null
    ].filter(Boolean).join(" · ");
  }

  async function data(request) {
    const result = await request;
    if (result.error) throw result.error;
    return result.data;
  }

  async function pages(makeQuery) {
    const rows = [];
    const limit = 250;
    for (let start = 0; ; start += limit) {
      const batch = await data(makeQuery().range(start, start + limit - 1));
      rows.push(...batch);
      if (batch.length < limit) return rows;
    }
  }

  function message(node, text = "", error = false) {
    node.textContent = text;
    node.classList.toggle("error", error);
    node.setAttribute("role", error ? "alert" : "status");
  }

  function bind(form, output, action, failure = "Impossible d’enregistrer. Réessayez.") {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = $('button[type="submit"], button:not([type])', form);
      if (button.disabled) return;
      button.disabled = true;
      message(output, "Enregistrement…");
      try {
        const confirmation = await action(new FormData(form));
        message(output, confirmation);
      } catch (error) {
        message(output, error instanceof UserError ? error.message : failure, true);
      } finally {
        button.disabled = false;
      }
    });
  }

  class UserError extends Error {}

  function navigation(ctx, page) {
    const nav = $("#nav");
    const entries = [
      ["Idées", url("", { espace: ctx.space.id }), "idees"],
      ["Planifié", url("", { espace: ctx.space.id, statut: "planifiee" }), "planifiee"],
      ["Souvenirs", url("", { espace: ctx.space.id, statut: "faite" }), "faite"]
    ];
    entries.push(["Rappels", url("rappels.html", { espace: ctx.space.id }), "rappels"]);
    if (ctx.editor) entries.splice(2, 0, ["Ajouter une idée", url("ajouter.html", { espace: ctx.space.id }), "ajout"]);
    for (const [name, href, key] of entries) {
      const item = link(name, href);
      if (key === page) item.setAttribute("aria-current", "page");
      if (key === "ajout") {
        item.className = page === "idees" || page === "planifiee" || page === "faite" ? "add add-primary" : "add";
        item.setAttribute("aria-label", name);
        item.replaceChildren(el("span", "+"));
      }
      nav.append(item);
    }
    nav.hidden = false;
  }

  function mustUpdate(request) {
    // Une mise à jour invisible pour la RLS peut renvoyer zéro ligne sans erreur.
    return data(request.select().single());
  }

  async function cleanOtherPush(userId) {
    try {
      if (!("serviceWorker" in navigator)) return;
      const key = "eureka.push.user";
      const active = localStorage.getItem(key);
      if (!active || active === userId) return;
      const registration = await navigator.serviceWorker.getRegistration("/eureka/");
      if (registration?.scope !== new URL("/eureka/", location.origin).href || !registration.pushManager) return;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();
      localStorage.removeItem(key);
    } catch { /* Le navigateur peut bloquer l'accès aux réglages de l'appareil. */ }
  }

  async function boot(page, start) {
    const state = $("#state");
    try {
      if (!sb) throw new UserError("Le service est momentanément indisponible.");
      const { session } = await data(sb.auth.getSession());
      if (!session) {
        await cleanOtherPush(null);
        location.replace("/recettes/connexion.html?next=" + encodeURIComponent(location.pathname + location.search));
        return;
      }
      cleanOtherPush(session.user.id);
      sb.auth.onAuthStateChange((event, current) => {
        if (event === "SIGNED_OUT" || (event === "SIGNED_IN" && current?.user.id !== session.user.id)) {
          location.reload();
        }
      });
      const memberships = await pages(() => sb.from("sorties_espace_membres")
        .select("espace_id, role, sorties_espaces(id, nom)").eq("user_id", session.user.id).order("espace_id"));
      const spaces = memberships.filter((row) => row.sorties_espaces)
        .map((row) => ({ ...row.sorties_espaces, role: row.role }))
        .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
      if (!spaces.length) throw new UserError("Vous n’avez accès à aucun espace Eurêka.");
      const requested = params.get("espace");
      const space = requested ? spaces.find((item) => item.id === requested) : spaces[0];
      if (!space) throw new UserError("Cet espace n’est pas accessible depuis votre compte.");
      const ctx = { user: session.user, space, spaces, editor: space.role === "owner" || space.role === "membre" };
      navigation(ctx, page);
      await start(ctx);
      message(state);
    } catch (error) {
      message(state, error instanceof UserError ? error.message : "Impossible de charger Eurêka. Vérifiez votre connexion puis réessayez.", true);
    }
  }

  function ideaById(ctx, id) {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id || "")) {
      throw new UserError("Cette idée n’est pas accessible.");
    }
    return data(sb.from("sorties_idees").select("*").eq("espace_id", ctx.space.id).eq("id", id).maybeSingle());
  }

  function ideaGone(ctx) {
    location.replace(url("", { espace: ctx.space.id, avis: "introuvable" }));
  }

  function pendingPhotos(ctx, ideaId) {
    const query = sb.from("sorties_photos_a_supprimer").select("chemin").eq("espace_id", ctx.space.id);
    return ideaId ? query.eq("idee_id", ideaId) : query;
  }

  async function cleanDeletedPhotos(ctx, ideaId) {
    const rows = await data(pendingPhotos(ctx, ideaId).order("chemin").limit(50));
    if (!rows.length) return true;
    const paths = rows.map((row) => row.chemin);
    await sb.storage.from("eureka-photos").remove(paths);
    const remaining = await data(sb.rpc("sorties_confirmer_suppression_photos", {
      p_espace: ctx.space.id, p_chemins: paths
    }));
    return remaining === 0;
  }

  function watchIdea(ctx, idea) {
    const area = $("#delete-idea");
    const dialog = $("dialog", area);
    let busy = false;
    let checking = false;

    async function check() {
      if (busy || checking || document.hidden) return;
      checking = true;
      try {
        const row = await data(sb.from("sorties_idees").select("id")
          .eq("espace_id", ctx.space.id).eq("id", idea.id).maybeSingle());
        if (!row && !busy) ideaGone(ctx);
      } catch { /* Une panne réseau ne confirme pas une suppression. */ }
      finally { checking = false; }
    }
    setInterval(check, 15000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("pageshow", (event) => { if (event.persisted) check(); });
    if (!ctx.editor) return;

    const feedback = $(".delete-status", dialog);
    const buttons = [...dialog.querySelectorAll("button")];
    area.hidden = false;
    $(".delete-link", area).addEventListener("click", () => {
      $("#delete-description", dialog).textContent = "La suppression de « " + idea.titre +
        " » est définitive, photos, scores, rappels et créneaux provisoires compris.";
      message(feedback);
      dialog.showModal();
    });
    dialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
    $("form", dialog).addEventListener("submit", async (event) => {
      if (event.submitter?.value !== "delete") return;
      event.preventDefault();
      if (busy) return;
      busy = true;
      buttons.forEach((button) => { button.disabled = true; });
      message(feedback, "Suppression en cours…");
      try {
        await data(pendingPhotos(ctx, idea.id).limit(1));
      } catch {
        message(feedback, "La suppression n’est pas disponible pour le moment. Réessayez.", true);
        busy = false;
        buttons.forEach((button) => { button.disabled = false; });
        return;
      }
      try {
        const rows = await data(sb.from("sorties_idees").delete()
          .eq("espace_id", ctx.space.id).eq("id", idea.id).select("id"));
        if (!rows.length) {
          message(feedback, "Suppression refusée. Cette fiche a déjà disparu ou vous n’avez plus le droit de la supprimer.", true);
          return;
        }
        const clean = await cleanDeletedPhotos(ctx, idea.id).catch(() => false);
        location.replace(url("", { espace: ctx.space.id, avis: clean ? "supprimee" : "photos" }));
      } catch {
        message(feedback, "La fiche n’a pas pu être supprimée. Réessayez.", true);
      } finally {
        busy = false;
        buttons.forEach((button) => { button.disabled = false; });
      }
    });
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/eureka/sw.js", { scope: "/eureka/" }).catch(() => {});
    });
  }

  window.Eureka = {
    sb, $, params, formats, statuts, modalites, mois, number, currency, el, link, url, safeUrl,
    visual, signedPhotos, options, date, meta, data, pages, message, bind, UserError, mustUpdate, boot, ideaById,
    ideaGone, watchIdea, cleanDeletedPhotos, renderDescription, verificationEntries
  };
})();
