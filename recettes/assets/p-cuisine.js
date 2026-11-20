// ARÔMES V&N · mode cuisine : une étape à la fois, quantités de l'étape, minuteurs, écran maintenu allumé.
(async function () {
  const AR = window.AR, { sb, $, esc, errMsg } = AR;
  const ctx = await AR.boot("carnet");
  if (!ctx) return;
  const main = $("#main");
  const qs = new URLSearchParams(location.search);
  const id = qs.get("id");
  const fail = (t) => { main.setAttribute("aria-busy", "false"); main.innerHTML = `<div class="vide-etat"><p role="alert">${esc(t)}</p><a class="btn sec petit" href="/recettes/">Retour au carnet</a></div>`; };
  if (!id) return fail("Aucune recette indiquée.");

  // Mêmes requêtes que la fiche : le service worker en garde la copie pour le mode hors ligne.
  let r, lines = [], steps = [];
  try {
    const rr = await sb.from("recipes").select("*").eq("id", id).maybeSingle();
    if (rr.error) throw rr.error;
    if (!rr.data) return fail("Recette introuvable, ou vous n'avez pas accès à son carnet.");
    r = rr.data;
    const [l, s] = await Promise.all([
      sb.from("recipe_ingredient_lines").select("*").eq("recipe_id", id).order("position"),
      sb.from("recipe_steps").select("*").eq("recipe_id", id).order("position")
    ]);
    for (const x of [l, s]) if (x.error) throw x.error;
    lines = l.data || []; steps = s.data || [];
  } catch (e) { return fail(errMsg(e, "Impossible de charger la recette.")); }

  document.title = `${r.title} · Mode cuisine`;
  const pReq = Math.round(Number(qs.get("p")));
  const portions = r.servings != null ? (pReq > 0 && pReq <= 99 ? pReq : r.servings) : null;
  const factor = portions != null ? AR.portionFactor(portions, r.servings) : 1;
  const back = `/recettes/fiche.html?id=${encodeURIComponent(r.id)}${portions != null && portions !== r.servings ? "&p=" + portions : ""}`;
  $("#cu-titre").textContent = r.title;
  $("#cu-quit").href = back; $("#cu-quit").textContent = "← Fiche";
  main.setAttribute("tabindex", "-1"); main.setAttribute("aria-live", "polite");

  // ---- état persistant (sessionStorage, par recette) : étape en cours et minuteurs
  const KEY = "ar.cuisine." + r.id;
  let i = 0, timers = [];
  function load() {
    try {
      const o = JSON.parse(sessionStorage.getItem(KEY) || "null");
      if (!o) return;
      if (Number.isInteger(o.i) && o.i >= 0 && o.i < steps.length) i = o.i;
      if (Array.isArray(o.timers)) timers = o.timers.filter((t) => t && typeof t.id === "string" && Number.isFinite(t.end) && Number.isInteger(t.step) && t.step >= 0 && t.step < steps.length)
        .map((t) => ({ id: t.id, step: t.step, end: t.end, total: Number(t.total) || 0, done: !!t.done }));
    } catch { /* stockage indisponible ou illisible */ }
  }
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify({ i, timers })); } catch { /* stockage indisponible */ } }
  load();

  // ---- ingrédients et étapes
  const strip = (v) => AR.norm(v).replace(/\(.*?\)/g, " ").replace(/[^a-z0-9œ]+/g, " ").trim();
  const reEsc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Ingrédients cités dans le texte de l'étape : libellé entier (singulier ou pluriel), sinon premier mot d'un libellé composé.
  function stepLines(text) {
    const t = " " + strip(text) + " ";
    return lines.filter((l) => {
      const base = strip(l.label_original);
      if (base.length < 3) return false;
      const c = new Set([base, base.replace(/[sx]$/, "")]);
      const w = base.split(" ");
      if (w.length > 1 && w[0].length >= 4) { c.add(w[0]); c.add(w[0].replace(/[sx]$/, "")); }
      return [...c].some((x) => x.length >= 3 && new RegExp(" " + reEsc(x) + "[sx]? ").test(t));
    });
  }
  const qtyHtml = (l) => {
    const sc = AR.scaleQty(l.quantity, l.unit, l.precision, factor);
    return l.quantity != null ? `<span class="cu-q-v">${esc(sc.text)}</span>` : `<span class="cu-q-v inconnue">${esc(l.precision || "q.b.")}</span>`;
  };
  const fmtDur = (sec) => {
    sec = Math.max(0, Math.round(sec));
    if (sec % 60 === 0 && sec >= 60) return AR.fmtMin(sec / 60);
    const m = Math.floor(sec / 60), s = sec % 60;
    return m ? `${m} min ${String(s).padStart(2, "0")} s` : `${s} s`;
  };
  const clock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s % 60).padStart(2, "0"); };

  function renderStep() {
    main.setAttribute("aria-busy", "false");
    $("#cu-ing-btn").hidden = !lines.length;
    if (!steps.length) {
      main.innerHTML = `<p class="cu-vide">Cette recette n'a pas d'étape saisie.</p><p><a class="btn" href="${esc(back)}">Retour à la fiche</a></p>`;
      $("#cu-nav").hidden = true; return;
    }
    const st = steps[i], ql = stepLines(st.text || "");
    const run = timers.find((t) => t.step === i);
    main.innerHTML = `<div class="cu-etape-lib"><span class="cu-num" aria-hidden="true">${i + 1}</span><span class="cu-sur">Étape ${i + 1} sur ${steps.length}</span></div>
      <p class="cu-texte"><span class="sr-only">Étape ${i + 1}. </span>${esc(st.text || "")}</p>
      ${ql.length ? `<ul class="cu-qtes" aria-label="Quantités de cette étape">${ql.map((l) => `<li class="cu-q">${qtyHtml(l)}<span class="cu-q-n">${esc(l.label_original)}${l.optional ? ` <small class="muted">(facultatif)</small>` : ""}</span></li>`).join("")}</ul>` : ""}
      ${st.timer_seconds ? `<button type="button" class="btn cu-minut" data-timer="${i}"${run ? " disabled" : ""}>${run ? "Minuteur lancé" : "Lancer le minuteur : " + esc(fmtDur(st.timer_seconds))}</button>` : ""}`;
    main.scrollTop = 0;
    const last = i === steps.length - 1;
    $("#cu-nav").hidden = false;
    $("#cu-prev").disabled = i === 0;
    $("#cu-next").textContent = last ? "Terminé" : "Suivant";
    $("#cu-pos").textContent = `${i + 1}/${steps.length}`;
  }
  function go(n) {
    if (!steps.length || n < 0) return;
    if (n >= steps.length) { location.assign(back + "&journal=1"); return; }
    i = n; save(); renderStep();
  }
  $("#cu-prev").addEventListener("click", () => go(i - 1));
  $("#cu-next").addEventListener("click", () => go(i + 1));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#cu-ing").hidden) return void closeIng();
    if ($("#cu-ing").hidden && !/INPUT|TEXTAREA|SELECT/.test((e.target || {}).tagName || "")) {
      if (e.key === "ArrowRight") go(i + 1);
      if (e.key === "ArrowLeft") go(i - 1);
    }
  });
  // Balayage horizontal : gauche = suivant, droite = précédent.
  let t0 = null;
  main.addEventListener("touchstart", (e) => { const t = e.changedTouches[0]; t0 = e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null; }, { passive: true });
  main.addEventListener("touchend", (e) => {
    if (!t0) return;
    const t = e.changedTouches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y; t0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? i + 1 : i - 1);
  }, { passive: true });

  // ---- liste des ingrédients (un geste)
  function ingList() {
    const groups = [];
    lines.forEach((l) => {
      const g = (l.group_label || "").trim();
      let grp = groups[groups.length - 1];
      if (!grp || grp.g !== g) { grp = { g, items: [] }; groups.push(grp); }
      grp.items.push(l);
    });
    const item = (l) => {
      const sc = AR.scaleQty(l.quantity, l.unit, l.precision, factor);
      const q = l.quantity != null ? `<span class="qte">${esc(sc.text)}</span>` : `<span class="qte inconnue">${esc(l.precision || "q.b.")}</span>`;
      return `<li class="ing"><span class="nom">${esc(l.label_original)}${l.quantity != null && l.precision ? ` <span class="prec">(${esc(l.precision)})</span>` : ""}${l.optional ? ` <span class="prec">(facultatif)</span>` : ""}</span><span class="guide" aria-hidden="true"></span>${q}</li>`;
    };
    const head = portions != null ? `<p class="po-note">Quantités pour ${portions} portion${portions > 1 ? "s" : ""}${portions !== r.servings ? ` (recette prévue pour ${r.servings})` : ""}.</p>` : "";
    return head + (groups.map((g) => `${g.g ? `<h3 class="groupe">${esc(g.g)}</h3>` : ""}<ul class="ingredients">${g.items.map(item).join("")}</ul>`).join("") || `<p class="muted italique">Aucun ingrédient saisi.</p>`);
  }
  function openIng() {
    $("#cu-ing-liste").innerHTML = ingList();
    $("#cu-ing").hidden = false; $("#cu-ing-btn").setAttribute("aria-expanded", "true");
    ["cu-bar", "cu-timers", "main", "cu-nav"].forEach((x) => { const el = document.getElementById(x); if (el) el.inert = true; });
    $("#cu-ing-x").focus();
  }
  function closeIng() {
    $("#cu-ing").hidden = true; $("#cu-ing-btn").setAttribute("aria-expanded", "false");
    ["cu-bar", "cu-timers", "main", "cu-nav"].forEach((x) => { const el = document.getElementById(x); if (el) el.inert = false; });
    $("#cu-ing-btn").focus();
  }
  $("#cu-ing-btn").addEventListener("click", () => ($("#cu-ing").hidden ? openIng() : closeIng()));
  $("#cu-ing-x").addEventListener("click", closeIng);

  // ---- son (Web Audio, bip généré), vibration
  let actx = null;
  function unlockAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!actx) actx = new AC();
      if (actx.state === "suspended") actx.resume().catch(() => {});
    } catch { /* audio indisponible */ }
  }
  function bip(at, freq, dur) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = "sine"; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.5, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(actx.destination); o.start(at); o.stop(at + dur + 0.02);
  }
  const sound = { beeps: 0 };
  function alarmOnce() {
    sound.beeps++;
    try {
      if (actx && actx.state === "running") { const t = actx.currentTime + 0.02; bip(t, 880, 0.18); bip(t + 0.3, 880, 0.18); bip(t + 0.6, 1175, 0.3); }
    } catch { /* audio indisponible */ }
    try { if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 600]); } catch { /* vibration indisponible */ }
  }
  let alarmTimer = null, alarmStart = 0;
  function alarmSync() {
    const pending = timers.some((t) => t.done);
    if (pending && !alarmTimer) { alarmStart = Date.now(); alarmOnce(); alarmTimer = setInterval(() => { if (Date.now() - alarmStart > 30000) return stopAlarm(); alarmOnce(); }, 2500); }
    if (!pending) stopAlarm();
    document.title = pending ? "Minuteur terminé · " + r.title : `${r.title} · Mode cuisine`;
  }
  function stopAlarm() { if (alarmTimer) { clearInterval(alarmTimer); alarmTimer = null; } }
  window.__cuSound = sound; // lecture seule : permet de vérifier en test que l'alerte a bien été déclenchée

  // ---- minuteurs : plusieurs en même temps, conservés si l'on change d'étape
  const box = $("#cu-timers");
  let sig = "";
  function renderTimers() {
    const s = timers.map((t) => t.id + (t.done ? "!" : "")).join("|");
    if (s === sig) return;
    sig = s;
    box.innerHTML = timers.map((t) => `<div class="cu-t${t.done ? " fini" : ""}" data-id="${esc(t.id)}"${t.done ? ' role="alert"' : ""}>
      <span class="cu-t-lib">Étape ${t.step + 1}${t.done ? " : terminé" : ""}</span><span class="cu-t-tps" data-tps="${esc(t.id)}">${esc(clock(t.done ? 0 : t.end - Date.now()))}</span>
      <button type="button" class="cu-t-x" data-stop="${esc(t.id)}" aria-label="${t.done ? "Fermer l'alerte du minuteur de l'étape " : "Arrêter le minuteur de l'étape "}${t.step + 1}">${t.done ? "OK" : "Arrêter"}</button></div>`).join("");
  }
  function tick() {
    let changed = false;
    timers.forEach((t) => {
      if (!t.done && t.end <= Date.now()) { t.done = true; changed = true; }
      const el = box.querySelector(`[data-tps="${CSS.escape(t.id)}"]`);
      if (el && !t.done) el.textContent = clock(t.end - Date.now());
    });
    if (changed) { save(); alarmSync(); }
    renderTimers();
  }
  setInterval(tick, 250);
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-stop]"); if (!b) return;
    timers = timers.filter((t) => t.id !== b.dataset.stop);
    save(); alarmSync(); renderTimers(); renderStep_keep();
  });
  // Après l'arrêt d'un minuteur, le bouton de l'étape redevient disponible sans perdre la position.
  function renderStep_keep() { const st = steps[i]; if (st && st.timer_seconds) { const btn = main.querySelector("[data-timer]"); if (btn) { const run = timers.find((t) => t.step === i); btn.disabled = !!run; btn.textContent = run ? "Minuteur lancé" : "Lancer le minuteur : " + fmtDur(st.timer_seconds); } } }
  main.addEventListener("click", (e) => {
    const b = e.target.closest("[data-timer]"); if (!b) return;
    unlockAudio();
    const n = Number(b.dataset.timer), st = steps[n];
    if (!st || !st.timer_seconds || timers.some((t) => t.step === n)) return;
    timers.push({ id: AR.uuid(), step: n, end: Date.now() + st.timer_seconds * 1000, total: st.timer_seconds, done: false });
    save(); renderTimers(); renderStep_keep();
  });
  document.addEventListener("pointerdown", unlockAudio);

  // ---- écran maintenu allumé (Wake Lock), repris au retour de visibilité
  const info = (t) => { $("#cu-info").textContent = t || ""; };
  let lock = null;
  async function wake() {
    if (!("wakeLock" in navigator)) return info("Cet appareil ne permet pas de garder l'écran allumé : réglez sa mise en veille.");
    try {
      lock = await navigator.wakeLock.request("screen");
      lock.addEventListener("release", () => { lock = null; });
      info("");
    } catch { lock = null; info("L'écran pourrait s'éteindre : le maintien de l'écran allumé n'est pas accordé."); }
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !lock) wake(); });
  document.addEventListener("pointerdown", () => { if (!lock && "wakeLock" in navigator && document.visibilityState === "visible") wake(); }, { once: true });

  renderStep(); tick(); alarmSync(); wake();
  main.focus({ preventScroll: true });
})();
