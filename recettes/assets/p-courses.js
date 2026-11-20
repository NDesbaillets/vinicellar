// ARÔMES V&N · liste de courses partagée : temps réel (repli sondage), rayons, hors ligne (copie + file d'attente des coches).
(async function () {
  const AR = window.AR, { sb, $, $$, esc, errMsg, toast, setMsg } = AR;
  const ctx = await AR.boot("courses");
  if (!ctx) return;
  const main = $("#main"), zone = $("#zone"), me = ctx.user.id;
  main.setAttribute("aria-busy", "false");
  const books = ctx.books;
  if (!books.length) { zone.innerHTML = `<div class="vide-etat"><p>Vous n'appartenez à aucun carnet pour le moment.</p></div>`; return; }

  const st = { book: AR.pickBook(books) };
  let items = [], offline = false, savedAt = null, channel = null, pollT = null;
  const book = () => books.find((b) => b.id === st.book);
  const editor = () => !!book() && book().role !== "reader";

  // ---- copie locale et file d'attente (appareil seulement, effacées à la déconnexion)
  const CK = (b) => "ar.courses." + b, QK = "ar.courses.q";
  const readJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || "null") || d; } catch { return d; } };
  const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage plein ou indisponible */ } };
  const queue = () => readJson(QK, []).filter((o) => o.uid === me);
  const saveQueue = (q) => writeJson(QK, [...readJson(QK, []).filter((o) => o.uid !== me), ...q]);
  const saveCache = () => { savedAt = new Date().toISOString(); writeJson(CK(st.book), { at: savedAt, items }); };
  const pending = () => queue().filter((o) => o.book === st.book).length;

  zone.innerHTML = `
    <div class="ligne-filtres" style="grid-template-columns:1fr"><label for="co-book">Carnet<select id="co-book">${books.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}${b.role === "reader" ? " (lecture)" : ""}</option>`).join("")}</select></label></div>
    <div id="co-bandeau" role="status" aria-live="polite"></div>
    <p class="msg" id="co-msg" role="status" aria-live="polite"></p>
    <div id="co-liste" aria-busy="true"><p class="chargement">Chargement de la liste…</p></div>
    <div id="co-bas"></div>`;
  $("#co-book").value = st.book;

  // ---- affichage
  const rayons = AR.RAYONS, known = new Set(rayons.map((r) => r[0]));
  function render() {
    const left = items.filter((x) => !x.checked).length, done = items.length - left, ed = editor();
    const nq = pending();
    $("#co-bandeau").innerHTML = offline
      ? `<div class="hors-ligne co-hl">Hors ligne : liste enregistrée le ${esc(AR.fmtDay(savedAt))} à ${esc(new Date(savedAt).toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" }))}.${ed ? (nq ? ` ${nq} changement${nq > 1 ? "s" : ""} en attente d'envoi.` : " Vos coches seront envoyées au retour du réseau.") : " Lecture seule."}</div>`
      : nq ? `<div class="hors-ligne co-hl">${nq} changement${nq > 1 ? "s" : ""} en attente d'envoi.</div>` : "";
    const L = $("#co-liste");
    L.setAttribute("aria-busy", "false");
    if (!items.length) L.innerHTML = `<div class="vide-etat"><p class="italique">La liste est vide.</p><p class="aide">Ajoutez des articles ci-dessous, ou depuis une recette ou la semaine.</p></div>`;
    else {
      const group = (k) => items.filter((x) => (known.has(x.aisle) ? x.aisle : "autre") === k)
        .sort((a, b) => Number(a.checked) - Number(b.checked) || a.label.localeCompare(b.label, "fr"));
      L.innerHTML = `<p class="co-resume"><strong>${left}</strong> à acheter${done ? ` · ${done} coché${done > 1 ? "s" : ""}` : ""}</p>` + rayons.map(([k, nom]) => {
        const g = group(k);
        if (!g.length) return "";
        return `<section class="co-rayon" aria-labelledby="co-r-${k}"><h2 class="co-rayon-t" id="co-r-${k}">${esc(nom)}</h2><ul class="co-liste">${g.map((x) => {
          const q = AR.fmtShop(x.quantity, x.unit);
          const qtxt = q || (x.catalog_id || x.source_recipe_id || x.source_plan_id ? "q.b." : "");
          return `<li class="co-art${x.checked ? " fait" : ""}"><button type="button" class="co-ligne" role="checkbox" aria-checked="${x.checked}" data-id="${esc(x.id)}"${ed ? "" : " disabled"}>
            <span class="co-boite" aria-hidden="true"></span><span class="co-nom">${esc(x.label)}</span>${qtxt ? `<span class="co-qte${q ? "" : " inconnue"}">${esc(qtxt)}</span>` : ""}</button></li>`;
        }).join("")}</ul></section>`;
      }).join("");
    }
    $("#co-bas").innerHTML = ed
      ? `<form id="co-add" class="co-add champs" novalidate><h2 class="libelle or" style="margin:0">Ajouter un article</h2>
          <label for="co-lab">Article<input id="co-lab" name="label" maxlength="300" autocomplete="off" enterkeyhint="done" placeholder="Pain, 2 kg de pommes…"></label>
          <label for="co-aisle">Rayon<select id="co-aisle" name="aisle">${rayons.map(([k, n]) => `<option value="${k}"${k === "autre" ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
          <div><button class="btn" type="submit">Ajouter</button></div></form>
        ${done ? `<div class="co-retirer"><button type="button" class="btn danger" id="co-clear">Retirer les articles cochés (${done})</button></div>` : ""}`
      : `<p class="muted italique" style="margin-top:28px">Vous consultez cette liste en lecture seule : seuls les membres qui peuvent écrire dans le carnet cochent les articles.</p>`;
  }

  // ---- lecture
  const applyQueue = (list) => {
    queue().filter((o) => o.book === st.book).forEach((o) => {
      if (o.op === "check") list.forEach((x) => { if (x.id === o.id) x.checked = o.checked; });
      else if (o.op === "add" && !list.some((x) => x.id === o.row.id)) list.push({ ...o.row, created_at: o.row.created_at || new Date().toISOString() });
    });
    return list;
  };
  async function load(silent) {
    if (!silent) { $("#co-liste").setAttribute("aria-busy", "true"); }
    await flush();
    const { data, error } = await sb.from("recipe_shopping_items").select("*").eq("book_id", st.book).order("created_at");
    if (error) {
      const c = readJson(CK(st.book), null);
      if (AR.isNetErr(error) && c) { items = applyQueue(c.items || []); savedAt = c.at; offline = true; render(); return; }
      if (silent) return console.error(error);
      $("#co-liste").innerHTML = `<p class="msg erreur" role="alert">${esc(errMsg(error, "Impossible de charger la liste de courses."))}</p>`; $("#co-bas").innerHTML = ""; return;
    }
    offline = false;
    items = data || [];
    saveCache();
    items = applyQueue(items);
    render();
  }

  // ---- écritures (optimistes ; hors ligne, mises en file)
  let flushing = false;
  async function flush() {
    if (flushing || navigator.onLine === false) return;
    const q = queue();
    if (!q.length) return;
    flushing = true;
    const rest = [];
    for (const o of q) {
      let err = null;
      if (o.op === "check") err = (await sb.from("recipe_shopping_items").update({ checked: o.checked }).eq("id", o.id)).error;
      else if (o.op === "add") { err = (await sb.from("recipe_shopping_items").insert({ id: o.row.id, book_id: o.book, label: o.row.label, aisle: o.row.aisle, checked: !!o.row.checked, added_by: me })).error; if (err && err.code === "23505") err = null; }
      if (err && AR.isNetErr(err)) { rest.push(o); continue; }
      if (err) console.error(err); // refusé par le serveur (droits, article supprimé) : abandonné
    }
    saveQueue(rest);
    flushing = false;
    if (q.length !== rest.length) toast("Vos changements ont été envoyés.");
  }
  function enqueue(o) { saveQueue([...queue(), { ...o, uid: me, book: st.book }]); }

  async function toggle(id) {
    const it = items.find((x) => x.id === id); if (!it || !editor()) return;
    const next = !it.checked;
    it.checked = next; render(); saveCache();
    const f = $(`[data-id="${CSS.escape(id)}"]`); if (f) f.focus();
    const q = queue().filter((o) => !(o.op === "check" && o.id === id));
    if (navigator.onLine === false) { saveQueue([...q, { op: "check", id, checked: next, uid: me, book: st.book }]); offline = true; render(); const f2 = $(`[data-id="${CSS.escape(id)}"]`); if (f2) f2.focus(); return; }
    const { error } = await sb.from("recipe_shopping_items").update({ checked: next }).eq("id", id);
    if (error) {
      if (AR.isNetErr(error)) { enqueue({ op: "check", id, checked: next }); offline = true; }
      else { it.checked = !next; toast(errMsg(error, "Impossible de modifier cet article."), "erreur"); }
      render(); const f3 = $(`[data-id="${CSS.escape(id)}"]`); if (f3) f3.focus();
    }
  }
  async function addFree(f) {
    const label = f.label.value.replace(/\s+/g, " ").trim(), out = $("#co-msg");
    if (!label) return setMsg(out, "Écrivez le nom de l'article.", "erreur");
    if (label.length > 300) return setMsg(out, "Le nom est limité à 300 caractères.", "erreur");
    setMsg(out, "");
    const row = { id: AR.uuid(), book_id: st.book, label, aisle: f.aisle.value, checked: false, added_by: me, quantity: null, unit: null, catalog_id: null, created_at: new Date().toISOString() };
    items.push(row); render(); saveCache();
    const inp = $("#co-lab"); if (inp) inp.focus();
    if (navigator.onLine === false) { enqueue({ op: "add", row }); offline = true; render(); return; }
    const { error } = await sb.from("recipe_shopping_items").insert({ id: row.id, book_id: st.book, label, aisle: row.aisle, checked: false, added_by: me });
    if (error) {
      if (AR.isNetErr(error)) { enqueue({ op: "add", row }); offline = true; }
      else { items = items.filter((x) => x.id !== row.id); toast(errMsg(error, "Impossible d'ajouter l'article."), "erreur"); }
      render();
    }
  }
  async function clearChecked(btn) {
    if (navigator.onLine === false) return toast("Impossible hors ligne : retirez les articles cochés une fois le réseau revenu.", "erreur");
    const n = items.filter((x) => x.checked).length;
    if (!confirm(`Retirer ${n} article${n > 1 ? "s" : ""} coché${n > 1 ? "s" : ""} de la liste ?`)) return;
    btn.disabled = true;
    const { error } = await sb.from("recipe_shopping_items").delete().eq("book_id", st.book).eq("checked", true);
    if (error) { btn.disabled = false; return toast(errMsg(error, "Impossible de retirer les articles."), "erreur"); }
    items = items.filter((x) => !x.checked); saveCache(); render(); toast("Articles cochés retirés.");
  }

  // ---- temps réel : applique chaque événement ; repli par sondage (15 s) si le canal n'est pas établi
  function onEvent(p) {
    if (p.eventType === "DELETE") items = items.filter((x) => x.id !== (p.old && p.old.id));
    else if (p.new) {
      const i = items.findIndex((x) => x.id === p.new.id);
      const mine = queue().find((o) => o.op === "check" && o.id === p.new.id);
      const row = mine ? { ...p.new, checked: mine.checked } : p.new;
      if (i >= 0) items[i] = { ...items[i], ...row }; else items.push(row);
    }
    saveCache(); render();
  }
  function startPoll() { if (!pollT) pollT = setInterval(() => { if (!document.hidden && navigator.onLine !== false) load(true); }, 15000); }
  function stopPoll() { clearInterval(pollT); pollT = null; }
  function subscribe() {
    if (channel) { sb.removeChannel(channel); channel = null; }
    stopPoll();
    try {
      channel = sb.channel("courses-" + st.book).on("postgres_changes", { event: "*", schema: "public", table: "recipe_shopping_items", filter: `book_id=eq.${st.book}` }, onEvent)
        .subscribe((s) => { if (s === "SUBSCRIBED") { stopPoll(); } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") startPoll(); });
    } catch (e) { console.error(e); startPoll(); }
  }

  zone.addEventListener("click", (e) => {
    const l = e.target.closest(".co-ligne"); if (l) return void toggle(l.dataset.id);
    const c = e.target.closest("#co-clear"); if (c) clearChecked(c);
  });
  zone.addEventListener("submit", (e) => { if (e.target.id === "co-add") { e.preventDefault(); addFree(e.target); } });
  zone.addEventListener("change", (e) => {
    if (e.target.id !== "co-book") return;
    st.book = e.target.value; AR.setBookPref(st.book); items = []; offline = false; subscribe(); load();
  });
  window.addEventListener("online", () => { load(true); });
  window.addEventListener("offline", () => { offline = true; if (!savedAt) savedAt = new Date().toISOString(); render(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(true); });
  window.addEventListener("pagehide", () => { if (channel) sb.removeChannel(channel); stopPoll(); });

  await load();
  subscribe();
})();
