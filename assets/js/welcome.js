// Première connexion (invitation ou création de compte) : mot de passe, identité et caves en une étape.
(function () {
  const { sb, $, $$, esc, KIND } = window.VC;
  const T = {
    expired: "Ce lien a expiré ou a déjà été utilisé. Indiquez votre adresse pour en recevoir un nouveau.",
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
    // Lien expiré ou déjà utilisé : on propose d'en recevoir un nouveau, sans renvoyer vers l'accueil.
    const expired = () => {
      status.innerHTML = `${esc(T.expired)}<form id="resend" class="row" style="margin-top:12px" novalidate>
        <input type="email" name="email" placeholder="Votre adresse e-mail" autocomplete="email" style="flex:1;min-width:200px">
        <button class="btn" type="submit">Recevoir un nouveau lien</button></form>`;
      status.className = "form-msg error";
      $("#resend").addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = e.target.email.value.trim();
        if (!email) return;
        await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/bienvenue.html" });
        status.className = "form-msg ok";
        status.textContent = "Si un compte existe pour cette adresse, un nouveau lien vient d'être envoyé. Il ouvre directement cette page.";
      });
    };
    if (!sb) return expired();

    // Lien d'invitation : la page valide elle-même le jeton (les messageries qui prévisualisent le lien ne le consomment plus).
    const qs = new URLSearchParams(location.search);
    const tokenHash = qs.get("token_hash"), type = qs.get("type");
    if (tokenHash && type) {
      const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error) console.warn("lien", error.message);
    }
    // Un lien déjà utilisé n'empêche pas de continuer si la session est ouverte (premier clic réussi).
    const { data } = await sb.auth.getSession();
    if (!data.session) return expired();
    const user = data.session.user;
    if (location.hash || location.search) history.replaceState(null, "", location.pathname);

    const { data: prof } = await sb.from("profiles").select("*").eq("id", user.id).single();
    if (prof && prof.onboarded_at) return location.replace("/app/");
    const [{ data: existing }, { data: invites }] = await Promise.all([sb.from("locations").select("id").limit(1), sb.rpc("my_invites")]);
    if ((invites || []).length) {
      $("#invites-set").hidden = false;
      $("#invite-list").innerHTML = invites.map((i) => `<label class="row" style="font-weight:400;color:var(--ink)"><input type="checkbox" name="invite" value="${i.id}" checked>
        <span><b>${esc(i.invited_by_name || "Quelqu'un")}</b> vous invite à partager « ${esc(i.collection_name)} »${i.role === "viewer" ? " (lecture seule)" : ""}.</span></label>`).join("") +
        `<p class="hint" style="margin:0">En acceptant, vous gérez ensemble les mêmes caves. Créer vos propres caves ci-dessous devient facultatif.</p>`;
    }

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
      const accepted = $$('input[name="invite"]:checked').map((x) => x.value);
      if (!$("#places-set").hidden && !places.length && !accepted.length) return msg(out, T.places, "error");
      const btn = f.querySelector('button[type="submit"]');
      btn.disabled = true;
      msg(out, T.saving);
      const { error: pwError } = await sb.auth.updateUser({ password: pw });
      // Mot de passe déjà défini via « mot de passe oublié » : on garde celui-ci.
      if (pwError && !/different from the old|same_password/i.test(pwError.message + (pwError.code || ""))) { btn.disabled = false; return msg(out, pwError.message || T.error, "error"); }
      for (const inv of accepted) await sb.rpc("accept_invite", { p_invite: inv });
      if (places.length && $("#places-set").hidden === false && !(accepted.length && places.length === 1 && places[0].name === "Maison")) {
        const { error: le } = await sb.from("locations").insert(places);
        if (le) { btn.disabled = false; console.error(le); return msg(out, T.error, "error"); }
      }
      const { error } = await sb.from("profiles").update({
        first_name: first, last_name: last, full_name: `${first} ${last}`,
        currency: f.currency.value, onboarded_at: new Date().toISOString()
      }).eq("id", user.id);
      if (error) { btn.disabled = false; console.error(error); return msg(out, T.error, "error"); }
      await sb.from("collections").update({ name: `Cave de ${first}` }).eq("owner_id", user.id).eq("name", "Ma cave");
      msg(out, T.done, "ok");
      setTimeout(() => (location.href = "/app/"), 900);
    });
  })();
})();
