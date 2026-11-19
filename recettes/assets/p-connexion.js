(function () {
  const { sb, $, setMsg, safeNext } = window.AR;
  const f = $("#login-form"), out = $("#msg");
  const next = () => safeNext(new URLSearchParams(location.search).get("next"));
  const T = {
    off: "Le service n'est pas disponible pour le moment.",
    bad: "Adresse e-mail ou mot de passe incorrect.",
    rate: "Trop de tentatives. Patientez quelques minutes.",
    email: "Indiquez d'abord votre adresse e-mail ci-dessus.",
    sent: "Si un compte existe pour cette adresse, un lien de réinitialisation vient d'être envoyé.",
    net: "Connexion impossible. Vérifiez votre réseau et réessayez."
  };
  window.AR.registerSW();
  if (sb) sb.auth.getSession().then(({ data }) => { if (data.session) location.replace(next()); });

  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!sb) return setMsg(out, T.off, "erreur");
    const email = f.email.value.trim(), password = f.password.value;
    if (!email || !password) return setMsg(out, "Indiquez votre adresse e-mail et votre mot de passe.", "erreur");
    const btn = f.querySelector("button[type=submit]");
    btn.disabled = true; setMsg(out, "Connexion…");
    try {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) { btn.disabled = false; return setMsg(out, error.status === 429 ? T.rate : /fetch|network/i.test(error.message) ? T.net : T.bad, "erreur"); }
      location.href = next();
    } catch (err) { console.error(err); btn.disabled = false; setMsg(out, T.net, "erreur"); }
  });

  // Flux existant du site : lien e-mail vers /nouveau-mot-de-passe.html.
  $("#forgot").addEventListener("click", async () => {
    if (!sb) return setMsg(out, T.off, "erreur");
    const email = f.email.value.trim();
    if (!email) { f.email.focus(); return setMsg(out, T.email, "erreur"); }
    try {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: (location.hostname === "vinicellar.ch" ? "https://vinicellar.ch" : location.origin) + "/nouveau-mot-de-passe.html?next=/recettes/" });
      if (error && error.status === 429) return setMsg(out, T.rate, "erreur");
      setMsg(out, T.sent, "ok");
    } catch (err) { console.error(err); setMsg(out, T.net, "erreur"); }
  });
})();
