// Arrivée d'une personne invitée dans un carnet : le lien d'e-mail est vérifié ici (token_hash), puis mot de passe et identité.
(function () {
  const { sb, $, esc, setMsg, errMsg } = window.AR;
  const status = $("#status"), f = $("#welcome-form"), out = $("#msg"), resend = $("#resend");
  const T = {
    expired: "Ce lien a expiré ou a déjà été utilisé. Indiquez votre adresse pour en recevoir un nouveau.",
    pwShort: "Le mot de passe doit compter au moins 10 caractères.",
    pwMismatch: "Les mots de passe ne correspondent pas.",
    names: "Indiquez votre prénom et votre nom.",
    done: "Bienvenue ! Votre carnet vous attend."
  };
  window.AR.registerSW();
  const expired = () => { setMsg(status, T.expired, "erreur"); resend.hidden = false; };

  resend.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = resend.email.value.trim();
    if (!email) return;
    try {
      await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/recettes/bienvenue.html" });
      setMsg(status, "Si un compte existe pour cette adresse, un nouveau lien vient d'être envoyé. Il ouvre directement cette page.", "ok");
    } catch (err) { setMsg(status, errMsg(err), "erreur"); }
  });

  (async () => {
    if (!sb) return expired();
    const qs = new URLSearchParams(location.search);
    const token_hash = qs.get("token_hash"), type = qs.get("type");
    if (token_hash && type) {
      try { const { error } = await sb.auth.verifyOtp({ token_hash, type }); if (error) console.warn("lien", error.message); }
      catch (err) { console.error(err); }
    }
    const { data } = await sb.auth.getSession();
    if (!data.session) return expired();
    const user = data.session.user;
    if (location.search || location.hash) history.replaceState(null, "", location.pathname);

    const { data: prof, error: pe } = await sb.from("profiles").select("first_name,last_name,full_name,onboarded_at").eq("id", user.id).maybeSingle();
    if (pe) console.error(pe);
    if (prof && prof.onboarded_at) return location.replace("/recettes/");

    const full = ((prof && prof.full_name) || (user.user_metadata || {}).full_name || "").trim().split(/\s+/).filter(Boolean);
    f.first_name.value = (prof && prof.first_name) || (full.length > 1 ? full[0] : "");
    f.last_name.value = (prof && prof.last_name) || (full.length > 1 ? full.slice(1).join(" ") : full[0] || "");
    $("#who").textContent = user.email || "";
    status.hidden = true; f.hidden = false; f.password.focus();

    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pw = f.password.value, first = f.first_name.value.trim(), last = f.last_name.value.trim();
      if (pw.length < 10) return setMsg(out, T.pwShort, "erreur");
      if (pw !== f.confirm.value) return setMsg(out, T.pwMismatch, "erreur");
      if (!first || !last) return setMsg(out, T.names, "erreur");
      const btn = f.querySelector("button[type=submit]");
      btn.disabled = true; setMsg(out, "Préparation de votre carnet…");
      try {
        const { error: pwError } = await sb.auth.updateUser({ password: pw });
        // Mot de passe déjà défini par « mot de passe oublié » : on le garde.
        if (pwError && !/different from the old|same_password/i.test(pwError.message + (pwError.code || ""))) throw pwError;
        const { error } = await sb.from("profiles").update({ first_name: first, last_name: last, full_name: `${first} ${last}`, onboarded_at: new Date().toISOString() }).eq("id", user.id);
        if (error) throw error;
        // Le carnet créé à l'inscription porte le prénom (échec sans conséquence).
        await sb.from("recipe_books").update({ name: `Carnet de ${first}` }).eq("owner_id", user.id).eq("name", "Mon carnet");
        setMsg(out, T.done, "ok");
        setTimeout(() => location.replace("/recettes/"), 800);
      } catch (err) { btn.disabled = false; setMsg(out, errMsg(err, pwShortHint(err)), "erreur"); }
    });
  })();
  function pwShortHint() { return "Impossible d'enregistrer. Réessayez dans un instant."; }
})();
