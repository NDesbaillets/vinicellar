// ARÔMES V&N · les invités du carnet (liste, recherche, archivés) et leurs réceptions. Contrat : docs/recettes/07-invites-contrat.md.
// Confidentialité : allergies et régimes de tiers, visibles des membres du carnet seulement (jamais dans le lien public, le livre ou l'export).
(async function () {
  const AR = window.AR, { sb, $, $$, esc, errMsg } = AR;
  const ctx = await AR.boot("invites");
  if (!ctx) return;
  const main = $("#main"), zone = $("#zone");
  main.setAttribute("aria-busy", "false");
  const books = ctx.books;
  if (!books.length) { zone.innerHTML = `<div class="vide-etat"><p>Vous n'appartenez à aucun carnet pour le moment.</p></div>`; return; }

  const wanted = new URLSearchParams(location.search).get("book");
  const st = { book: AR.pickBook(books, books.some((b) => b.id === wanted) ? wanted : null), q: "" };
  const book = () => books.find((b) => b.id === st.book);
  const editor = () => !!book() && book().role !== "reader";
  let guests = [], receptions = [], seq = 0;

  zone.innerHTML = `
    <div class="ligne-filtres" style="grid-template-columns:1fr"><label for="iv-book">Carnet<select id="iv-book">${books.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}${b.role === "reader" ? " (lecture)" : ""}</option>`).join("")}</select></label></div>
    <div id="iv-corps" aria-busy="true"><p class="chargement">Chargement des invités…</p></div>`;
  $("#iv-book").value = st.book;

  async function load() {
    const my = ++seq, box = $("#iv-corps");
    box.setAttribute("aria-busy", "true");
    box.innerHTML = `<p class="chargement">Chargement des invités…</p>`;
    try {
      const [g, r] = await Promise.all([
        sb.from("recipe_guests").select("*").eq("book_id", st.book).order("name"),
        sb.from("recipe_receptions").select("id,day,slot,title,recipe_reception_guests(guest_id,recipe_guests(id,name))").eq("book_id", st.book).order("day", { ascending: false }).limit(20)]);
      if (g.error) throw g.error;
      if (my !== seq) return;
      guests = g.data || [];
      receptions = r.error ? [] : r.data || [];
      if (r.error) console.error(r.error);
      render(!r.error);
    } catch (e) {
      if (my !== seq) return;
      box.setAttribute("aria-busy", "false");
      box.innerHTML = `<p class="msg erreur" role="alert">${esc(errMsg(e, "Impossible de charger les invités."))}</p>`;
    }
  }

  const carte = (g) => `<li class="iv-carte"><a class="iv-lien" href="/recettes/invite.html?id=${encodeURIComponent(g.id)}"><span class="iv-nom">${esc(g.name)}</span>${g.household ? `<span class="iv-foyer">${esc(g.household)}</span>` : ""}${AR.guestPills(g)}</a></li>`;

  function render(recOk) {
    const box = $("#iv-corps");
    box.setAttribute("aria-busy", "false");
    const n = AR.norm(st.q);
    const match = (g) => !n || AR.norm(g.name).includes(n) || AR.norm(g.household || "").includes(n);
    const actifs = guests.filter((g) => !g.archived_at), archives = guests.filter((g) => g.archived_at);
    const f = actifs.filter(match), fa = archives.filter(match);
    const ed = editor();
    box.innerHTML = `
      ${ed ? `<p><a class="btn" href="/recettes/invite.html?book=${encodeURIComponent(st.book)}&amp;nouveau=1">Nouvel invité</a></p>` : `<p class="muted italique">Vous consultez les invités de ce carnet en lecture seule.</p>`}
      ${guests.length ? `<label for="iv-rech" class="sr-only">Chercher un invité</label><input id="iv-rech" type="search" placeholder="Chercher un invité…" autocomplete="off" value="${esc(st.q)}">` : ""}
      <div id="iv-liste" aria-live="polite">${listeHtml(f, actifs, fa, archives)}</div>
      <h2 class="section">Réceptions</h2><span class="filet" aria-hidden="true"></span>
      ${ed ? `<p><a class="btn sec" href="/recettes/reception.html?book=${encodeURIComponent(st.book)}">Nouvelle réception</a></p>` : ""}
      ${recOk ? recHtml() : `<p class="msg erreur" role="alert">Les réceptions ne sont pas disponibles pour le moment.</p>`}`;
  }
  function listeHtml(f, actifs, fa, archives) {
    let h = "";
    if (!actifs.length && !archives.length) h = `<div class="vide-etat"><p>Aucun invité pour l'instant. Ajoutez les personnes que vous recevez pour tenir compte de leurs allergies et de ce qu'elles ont déjà mangé.</p></div>`;
    else if (!f.length && actifs.length) h = `<p class="muted italique">Aucun invité ne correspond.</p>`;
    else if (f.length) h = `<ul class="iv-liste">${f.map(carte).join("")}</ul>`;
    if (archives.length) h += `<details class="iv-archives"${st.q && fa.length ? " open" : ""}><summary>Invités archivés (${archives.length})</summary>${fa.length ? `<ul class="iv-liste">${fa.map(carte).join("")}</ul>` : `<p class="muted italique">Aucun invité archivé ne correspond.</p>`}</details>`;
    return h;
  }
  function recHtml() {
    if (!receptions.length) return `<p class="muted italique">Aucune réception enregistrée dans ce carnet.</p>`;
    return `<ul class="iv-liste iv-recs">${receptions.map((r) => {
      const noms = (r.recipe_reception_guests || []).map((x) => x.recipe_guests && x.recipe_guests.name).filter(Boolean);
      return `<li class="iv-carte"><a class="iv-lien" href="/recettes/reception.html?id=${encodeURIComponent(r.id)}"><span class="iv-date">${esc(AR.fmtDay(r.day))}${r.slot ? ` · ${esc(AR.CRENEAUX[r.slot] || "")}` : ""}</span><span class="iv-nom">${esc(r.title || "Réception")}</span>${noms.length ? `<span class="iv-foyer">${esc(noms.join(", "))}</span>` : ""}</a></li>`;
    }).join("")}</ul>`;
  }

  zone.addEventListener("change", (e) => {
    if (e.target.id === "iv-book") { st.book = e.target.value; AR.setBookPref(st.book); st.q = ""; load(); }
  });
  zone.addEventListener("input", (e) => {
    if (e.target.id !== "iv-rech") return;
    st.q = e.target.value;
    const n = AR.norm(st.q), match = (g) => !n || AR.norm(g.name).includes(n) || AR.norm(g.household || "").includes(n);
    const actifs = guests.filter((g) => !g.archived_at), archives = guests.filter((g) => g.archived_at);
    $("#iv-liste").innerHTML = listeHtml(actifs.filter(match), actifs, archives.filter(match), archives);
  });
  load();
})();
