// Pages publiques : connexion, création de compte, mot de passe oublié, nouveau mot de passe.
// Repris du flux Onconic : lien e-mail → page de bienvenue (mot de passe + profil) ou page « nouveau mot de passe ».
(function () {
  const { sb, cfg, $ } = window.VC;
  const T = {
    notConfigured: "Le service n'est pas disponible pour le moment.",
    badLogin: "Adresse e-mail ou mot de passe incorrect.",
    enterEmail: "Indiquez d'abord votre adresse e-mail ci-dessus.",
    resetSent: "Si un compte existe pour cette adresse, un lien de réinitialisation vient d'être envoyé.",
    requestSent: "Merci, votre demande est envoyée. Vous recevrez un e-mail d'activation dès qu'elle sera validée.",
    requestInvalid: "Indiquez votre nom et une adresse e-mail valide.",
    pwShort: "Au moins 10 caractères.",
    pwMismatch: "Les mots de passe ne correspondent pas.",
    pwUpdated: "Mot de passe modifié. Redirection…",
    linkExpired: "Ce lien est invalide ou a expiré. Demandez-en un nouveau avec « Mot de passe oublié ? ».",
    error: "Une erreur est survenue. Réessayez dans un instant.",
    rate: "Trop de tentatives. Patientez quelques minutes."
  };
  const msg = (el, text, kind) => { if (!el) return; el.textContent = text; el.className = "form-msg" + (kind ? " " + kind : ""); };
  const origin = location.origin;
  const next = () => {
    const n = new URLSearchParams(location.search).get("next");
    return n && n.startsWith("/app/") ? n : "/app/";
  };

  // Onglets connexion / création de compte
  const tabs = $(".tabs");
  if (tabs) {
    tabs.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-tab]");
      if (!b) return;
      tabs.querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      $("#login-form").hidden = b.dataset.tab !== "login";
      $("#signup-form").hidden = b.dataset.tab !== "signup";
    });
  }

  const login = $("#login-form");
  if (login) {
    const out = login.querySelector(".form-msg");
    if (sb) sb.auth.getSession().then(({ data }) => { if (data.session && !location.hash) location.replace(next()); });

    login.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!sb) return msg(out, T.notConfigured, "error");
      const btn = login.querySelector("button[type=submit]");
      btn.disabled = true;
      const { error } = await sb.auth.signInWithPassword({ email: login.email.value.trim(), password: login.password.value });
      btn.disabled = false;
      if (error) return msg(out, error.status === 429 ? T.rate : T.badLogin, "error");
      location.href = next();
    });

    $("#forgot")?.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!sb) return msg(out, T.notConfigured, "error");
      const email = login.email.value.trim();
      if (!email) { login.email.focus(); return msg(out, T.enterEmail, "error"); }
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: origin + "/nouveau-mot-de-passe.html" });
      msg(out, error && error.status === 429 ? T.rate : T.resetSent, error && error.status === 429 ? "error" : "ok");
    });
  }

  // Demande d'invitation : enregistrée, puis validée par l'admin (qui déclenche l'e-mail d'activation).
  const signup = $("#signup-form");
  if (signup) {
    const out = signup.querySelector(".form-msg");
    signup.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!sb) return msg(out, T.notConfigured, "error");
      const name = signup.name.value.trim(), email = signup.email.value.trim();
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return msg(out, T.requestInvalid, "error");
      const btn = signup.querySelector("button[type=submit]");
      btn.disabled = true;
      const { error } = await sb.functions.invoke("request-access", {
        body: { name, email, message: signup.message.value.trim(), website: signup.website.value }
      });
      btn.disabled = false;
      if (error) { console.error(error); return msg(out, T.error, "error"); }
      signup.reset();
      msg(out, T.requestSent, "ok");
    });
  }

  // Nouveau mot de passe (lien « mot de passe oublié »)
  const reset = $("#reset-form");
  if (reset) {
    const out = reset.querySelector(".form-msg");
    if (/error_code=/.test(location.hash)) msg(out, T.linkExpired, "error");
    reset.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!sb) return msg(out, T.notConfigured, "error");
      const pw = reset.password.value;
      if (pw.length < 10) return msg(out, T.pwShort, "error");
      if (pw !== reset.confirm.value) return msg(out, T.pwMismatch, "error");
      const { data } = await sb.auth.getSession();
      if (!data.session) return msg(out, T.linkExpired, "error");
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) return msg(out, error.message || T.error, "error");
      msg(out, T.pwUpdated, "ok");
      setTimeout(() => (location.href = "/app/"), 1200);
    });
  }
})();
