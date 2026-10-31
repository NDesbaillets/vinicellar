// Première connexion (invitation ou création de compte) : mot de passe, identité et caves en une étape.
(function () {
  const { sb, $, $$, esc, KIND } = window.VC;
  const T = {
    expired: "Ce lien est invalide ou a expiré. Retournez à l'accueil et demandez un nouveau lien (« Mot de passe oublié ? » ou « Créer un compte »).",
    pwShort: "Le mot de passe doit compter au moins 10 caractères.",
    pwMismatch: "Les mots de passe ne correspondent pas.",
    names: "Indiquez votre prénom et votre nom.",
    places: "Créez au moins une cave.",
    saving: "Préparation de votre cave…",
    error: "Une erreur est survenue. Réessayez.",
    done: "Bienvenue ! Votre cave est prête."
  };
  const msg = (el, text, kind) => { el.textContent = text; el.className = "form-msg" + (kind ? " " + kind : ""); };
  const kindOptions = (sel) => Object.entries(KIND).map(([k, l]) => `<option value="${k}"${k === sel ? " selected" : ""}>${l}</option>`).join("");

  function addRow(name = "", kind = "home") {
    const row = document.createElement("div");
    row.className = "loc-row";
    row.innerHTML = `<input name="loc_name" maxlength="80" placeholder="ex. Cave de Lausanne" value="${esc(name)}" aria-label="Nom de la cave">
      <select name="loc_kind" aria-label="Type">${kindOptions(kind)}</select>
      <button type="button" class="icon-btn" aria-label="Retirer">×</button>`;
    row.querySelector("button").addEventListener("click", () => { if ($$(".loc-row").length > 1) row.remove(); });
    $("#loc-rows").append(row);
    return row;
  }

  (async () => {
    const status = $("#welcome-status"), f = $("#welcome-form");
    const expired = () => {
      msg(status, T.expired + " ", "error");
      const a = document.createElement("a"); a.href = "/"; a.textContent = "Accueil"; status.append(a);
    };
    if (!sb || /error_code=/.test(location.hash)) return expired();
    const { data } = await sb.auth.getSession();   // supabase-js lit le jeton du lien et ouvre la session
    if (!data.session) return expired();
    const user = data.session.user;
    if (location.hash) history.replaceState(null, "", location.pathname);

    const { data: prof } = await sb.from("profiles").select("*").eq("id", user.id).single();
    if (prof && prof.onboarded_at) return location.replace("/app/");
    const { data: existing } = await sb.from("locations").select("id").limit(1);

    const full = ((prof && prof.full_name) || (user.user_metadata || {}).full_name || "").trim().split(/\s+/);
    f.first_name.value = (prof && prof.first_name) || (full.length > 1 ? full[0] : "");
    f.last_name.value = (prof && prof.last_name) || (full.length > 1 ? full.slice(1).join(" ") : full[0] || "");
    $("#who").textContent = user.email;
    if (existing && existing.length) $("#places-set").hidden = true;
    else { addRow("Maison", "home"); }
    $("#add-loc").addEventListener("click", () => addRow("", "secondary").querySelector("input").focus());

    status.hidden = true;
    f.hidden = false;
    f.password.focus();

    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const out = $("#welcome-msg");
      const pw = f.password.value;
      const first = f.first_name.value.trim(), last = f.last_name.value.trim();
      const places = $$(".loc-row").map((r, i) => ({ name: r.querySelector("input").value.trim(), kind: r.querySelector("select").value, position: i })).filter((p) => p.name);
      if (pw.length < 10) return msg(out, T.pwShort, "error");
      if (pw !== f.confirm.value) return msg(out, T.pwMismatch, "error");
      if (!first || !last) return msg(out, T.names, "error");
      if (!$("#places-set").hidden && !places.length) return msg(out, T.places, "error");
      const btn = f.querySelector('button[type="submit"]');
      btn.disabled = true;
      msg(out, T.saving);
      const { error: pwError } = await sb.auth.updateUser({ password: pw });
      if (pwError) { btn.disabled = false; return msg(out, pwError.message || T.error, "error"); }
      if (places.length && $("#places-set").hidden === false) {
        const { error: le } = await sb.from("locations").insert(places);
        if (le) { btn.disabled = false; console.error(le); return msg(out, T.error, "error"); }
      }
      const { error } = await sb.from("profiles").update({
        first_name: first, last_name: last, full_name: `${first} ${last}`,
        currency: f.currency.value, onboarded_at: new Date().toISOString()
      }).eq("id", user.id);
      if (error) { btn.disabled = false; console.error(error); return msg(out, T.error, "error"); }
      msg(out, T.done, "ok");
      setTimeout(() => (location.href = "/app/"), 900);
    });
  })();
})();
