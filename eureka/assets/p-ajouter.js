(() => {
  const E = window.Eureka;
  const { sb, $, el } = E;
  const form = $("#quick-form");
  const feedback = $("#quick-info");
  const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  const selected = [];
  let busy = false;
  let pending = null;
  const draftKey = "eureka.partage";
  if (location.hash.startsWith("#text=")) {
    try {
      form.elements.source.value = decodeURIComponent(location.hash.slice(6)).slice(0, 8000);
      sessionStorage.setItem(draftKey, form.elements.source.value);
    } catch { /* Lien tronqué ou stockage indisponible. */ }
    history.replaceState(null, "", location.pathname + location.search);
  }
  try {
    if (!form.elements.source.value) form.elements.source.value = sessionStorage.getItem(draftKey) || "";
  } catch { /* Le formulaire peut être rempli à la main. */ }

  function renderPhotos() {
    const list = $("#selected-photos");
    list.replaceChildren(...selected.map((file, index) => {
      const row = el("li");
      const remove = el("button", "Retirer");
      remove.type = "button";
      remove.disabled = busy;
      remove.setAttribute("aria-label", "Retirer " + file.name);
      remove.addEventListener("click", () => {
        selected.splice(index, 1);
        pending = null;
        renderPhotos();
      });
      row.append(el("span", file.name), remove);
      return row;
    }));
  }

  function take(files) {
    if (busy) return;
    if (files.some((file) => !extensions[file.type] || file.size === 0 || file.size > 5_000_000)) {
      E.message(feedback, "Choisissez des photos JPEG, PNG ou WebP de 5 Mo maximum chacune.", true);
    } else if (files.length + selected.length > 5) {
      E.message(feedback, "Vous pouvez joindre jusqu’à 5 photos.", true);
    } else if (files.length) {
      selected.push(...files);
      pending = null;
      E.message(feedback);
      renderPhotos();
    }
  }

  form.elements.photos.addEventListener("change", (event) => {
    take([...event.target.files]);
    event.target.value = "";
  });
  $("#choose-photos").addEventListener("click", () => form.elements.photos.click());
  $("#camera").addEventListener("click", () => $("#camera-input").click());
  $("#camera-input").addEventListener("change", (event) => {
    take([...event.target.files]);
    event.target.value = "";
  });
  $("#paste").addEventListener("click", async () => {
    try {
      const images = await E.clipboardPhotos(extensions);
      if (!images.length) throw new Error();
      take(images);
    } catch {
      E.message(feedback, "Aucune photo accessible dans le presse-papiers. Choisissez-la dans vos fichiers ou prenez-la avec l’appareil photo.", true);
    }
  });
  document.addEventListener("paste", (event) => {
    const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
    if (!files.length || form.hidden || busy) return;
    event.preventDefault();
    take(files);
  });
  form.elements.source.addEventListener("input", () => { pending = null; });

  E.boot("ajout", async (ctx) => {
    if (!ctx.editor) throw new E.UserError("Cet espace est en lecture seule pour votre compte.");
    const scope = { espace: ctx.space.id };
    $("#cancel-top").href = E.url("", scope);
    $("#manual").href = E.url("editer.html", scope);
    E.bind(form, $("#quick-status"), async (fields) => {
      if (busy) return;
      const input = fields.get("source").trim();
      const url = /^https:\/\/\S+$/i.test(input) ? E.safeUrl(input) : null;
      const type = url ? "lien" : selected.length ? "photo" : "texte";
      if (!input && !selected.length) throw new E.UserError("Saisissez un texte, un lien ou ajoutez une photo.");
      busy = true;
      renderPhotos();
      const controls = [form.elements.source, $("#choose-photos"), $("#camera"), $("#paste")];
      controls.forEach((control) => { control.disabled = true; });
      try {
        pending ||= { id: crypto.randomUUID(), paths: [] };
        for (const [i, file] of selected.entries()) {
          if (pending.paths[i]) continue;
          const key = [ctx.space.id, ctx.user.id, pending.id, (i + 1) + "." + extensions[file.type]].join("/");
          const { error } = await sb.storage.from("eureka-photos").upload(key, file, { contentType: file.type });
          if (error && error.error !== "Duplicate" && error.statusCode !== "409") {
            throw new E.UserError("Un visuel n’a pas pu être envoyé. Réessayez.");
          }
          pending.paths[i] = key;
        }
        const { idee_id } = await E.data(sb.functions.invoke("sorties-enrich", {
          body: { id: pending.id, espace: ctx.space.id, type, contenu: url || input, photos: pending.paths },
        }));
        if (!idee_id) throw new Error();
        try { sessionStorage.removeItem(draftKey); } catch { /* Stockage facultatif. */ }
        location.assign(E.url("fiche.html", { ...scope, id: idee_id, import: pending.id }));
        return "Fiche créée.";
      } finally {
        busy = false;
        controls.forEach((control) => { control.disabled = false; });
        renderPhotos();
      }
    }, "L’ajout est indisponible. Réessayez ou créez l’idée à la main.");
    form.hidden = false;
  });
})();
