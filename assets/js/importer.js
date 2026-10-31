// Import d'un tableau Excel ou CSV : modèle à télécharger, consigne pour le remplir avec Claude à partir de photos,
// lecture du fichier dans le navigateur, aperçu ligne par ligne, puis création des fiches et du stock.
(async function () {
  const VC = window.VC;
  const { sb, $, esc, I, toast, fail } = VC;
  const T = VC.table;
  const ctx = await VC.boot("add");
  const main = $("#main");
  let places = (await VC.loadPlaces().catch(() => [])).filter((p) => VC.canEdit(p.collection_id));
  let rows = [], ignored = [];

  const STYLE = { red: "Rouge", white: "Blanc", rose: "Rosé", sparkling: "Mousseux", sweet: "Liquoreux", fortified: "Muté", orange: "Orange" };
  const key = (it, coll) => [T.fold(it.name), T.fold(it.producer), it.vintage || "", coll].join("|");

  main.innerHTML = `<div class="page-head"><div><span class="eyebrow">Ajouter en nombre</span><h1>Importer un tableau</h1></div></div>
    <div class="card"><h3>1. Préparer le tableau avec Claude</h3>
      <ol class="steps">
        <li>Photographiez vos bouteilles (étiquette, et contre-étiquette si le millésime y figure).</li>
        <li>Dans l'app Claude, nouvelle conversation : joignez les photos (une vingtaine par message) et collez la consigne ci-dessous.</li>
        <li>Claude renvoie un fichier Excel au bon format : enregistrez-le, puis importez-le à l'étape 2.</li>
      </ol>
      <div class="row"><button class="btn" id="copy">${I.check}Copier la consigne pour Claude</button><button class="btn ghost" id="model">${I.download}Modèle Excel vide</button></div>
      <details style="margin-top:12px"><summary class="muted">Voir la consigne</summary><pre class="prompt">${esc(T.PROMPT)}</pre></details>
      <p class="hint" style="margin:10px 0 0">Vous pouvez aussi remplir le modèle à la main ou importer un export d'une autre application : les en-têtes reconnus sont listés dans le modèle.</p>
    </div>
    <form class="card" id="load" novalidate><h3>2. Importer le fichier</h3>
      ${places.length ? "" : `<p class="notice">Aucune cave modifiable. <a href="/app/caves.html">Créer une cave</a> d'abord.</p>`}
      <div class="form-line">
        <label>Fichier (.xlsx, .xls ou .csv)<input type="file" name="file" accept=".xlsx,.xls,.csv,.ods,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"></label>
        <label>Cave par défaut<select name="loc">${places.map((p) => `<option value="${p.id}"${p.id === VC.getLoc() ? " selected" : ""}>${esc(VC.placeLabel(p, places))}</option>`).join("")}</select></label>
        <label>Quantité si vide<input type="number" name="qty" value="1" min="0" max="999" inputmode="numeric"></label>
      </div>
      <label class="row" style="margin-top:10px;font-weight:400;color:var(--ink)"><input type="checkbox" name="create" checked> Créer les caves de la colonne « Cave » qui n'existent pas encore</label>
    </form>
    <div id="preview"></div>`;

  $("#copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(T.PROMPT); toast("Consigne copiée. Collez-la dans Claude avec vos photos."); }
    catch { prompt("Copiez la consigne :", T.PROMPT); }
  });

  $("#model").addEventListener("click", () => {
    const head = T.COLUMNS.map((c) => c.h), ex = T.COLUMNS.map((c) => c.ex ?? "");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([head, ex]);
    ws["!cols"] = head.map((h) => ({ wch: Math.max(12, h.length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, "Vins");
    const help = XLSX.utils.aoa_to_sheet([["Consigne à coller dans Claude avec vos photos"], ...T.PROMPT.split("\n").map((l) => [l]),
      [""], ["En-têtes acceptés (une variante suffit)"], ...T.COLUMNS.map((c) => [c.h, c.alt.join(", ")])]);
    help["!cols"] = [{ wch: 110 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, help, "Consigne");
    XLSX.writeFile(wb, "vinicellar-modele.xlsx");
  });

  $("#load").addEventListener("change", async (e) => {
    const f = e.currentTarget;
    if (e.target.name !== "file" || !f.file.files[0]) return e.target.name !== "file" && rows.length && preview();
    try {
      const wb = XLSX.read(await f.file.files[0].arrayBuffer(), { type: "array" });
      // Feuille « Vins » si elle existe, sinon la première.
      const name = wb.SheetNames.find((n) => /vin|wine|cave/i.test(n)) || wb.SheetNames[0];
      const data = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "", raw: true });
      const headers = Object.keys(data[0] || {});
      ignored = headers.filter((h) => h && !/^__EMPTY/.test(h) && !T.columnFor(h));
      if (!headers.some((h) => ["name", "producer"].includes((T.columnFor(h) || {}).key))) {
        rows = []; $("#preview").innerHTML = `<p class="notice">Colonnes « Cuvée » ou « Producteur » introuvables dans la feuille « ${esc(name)} ». Utilisez le modèle Excel.</p>`; return;
      }
      rows = data.map(T.readRow).filter((r) => Object.keys(r.item).length > 1).slice(0, 1000);
      await preview();
    } catch (err) { fail(err, "Fichier illisible. Enregistrez-le en .xlsx ou .csv."); }
  });

  // Cave de chaque ligne : nom de la colonne « Cave » s'il correspond, sinon la cave par défaut.
  const placeFor = (name) => name ? places.find((p) => T.fold(p.name) === T.fold(name)) : null;

  async function preview() {
    const f = $("#load");
    const def = places.find((p) => p.id === f.loc.value) || places[0];
    const defQty = Math.max(0, parseInt(f.qty.value, 10) || 0);
    const colls = [...new Set(places.map((p) => p.collection_id))];
    const { data: existing } = await sb.from("items").select("id, name, producer, vintage, collection_id").in("collection_id", colls);
    const known = new Map((existing || []).map((it) => [key(it, it.collection_id), it.id]));
    const seen = new Set();
    for (const r of rows) {
      const p = placeFor(r.cave);
      r.place = p || def;
      r.newPlace = r.cave && !p ? r.cave : null;
      r.n = r.qty ?? defQty;
      const coll = r.place ? r.place.collection_id : null;
      const k = key(r.item, coll);
      r.existing = known.get(k) || null;
      r.dupInFile = seen.has(k); seen.add(k);
      r.error = !r.item.name ? "Cuvée manquante" : !r.place ? "Aucune cave" : r.newPlace && !f.create.checked ? `Cave « ${r.newPlace} » inconnue` : null;
    }
    const ok = rows.filter((r) => !r.error);
    const bottles = ok.reduce((a, r) => a + r.n, 0);
    $("#preview").innerHTML = `<div class="card">
      <div class="row"><h3 style="margin:0">Aperçu</h3><span class="spacer"></span><span class="faint">${rows.length} ligne${rows.length > 1 ? "s" : ""}</span></div>
      ${ignored.length ? `<p class="notice info" style="margin-top:10px">Colonnes ignorées : ${esc(ignored.join(", "))}.</p>` : ""}
      <div class="table-wrap"><table class="grid-table"><thead><tr><th></th><th>Vin</th><th>Mill.</th><th>Couleur</th><th>Région</th><th>Qté</th><th>Cave</th><th>Statut</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${r.error ? "bad" : ""}"><td class="faint">${i + 1}</td>
        <td><b>${esc(r.item.name || "—")}</b><br><small class="muted">${esc(r.item.producer || "")}</small></td>
        <td>${r.item.vintage || ""}</td><td>${esc(STYLE[r.item.style] || (r.item.category !== "wine" ? VC.CATEGORY_SHORT[r.item.category] : ""))}</td>
        <td>${esc(VC.regionOf(r.item) || VC.countryOf(r.item) || "")}</td><td>${r.n}</td>
        <td>${esc(r.newPlace ? `${r.newPlace} (nouvelle)` : r.place ? r.place.name : "")}</td>
        <td>${r.error ? `<span class="tag past">${esc(r.error)}</span>` : r.existing || r.dupInFile ? `<span class="tag">Déjà en cave · +${r.n}</span>` : `<span class="tag ready">Nouveau</span>`}</td></tr>`).join("")}
      </tbody></table></div>
      <div class="row" style="margin-top:14px"><button class="btn big" id="go"${ok.length ? "" : " disabled"}>${I.check}Importer ${ok.length} vin${ok.length > 1 ? "s" : ""} (${bottles} bouteille${bottles > 1 ? "s" : ""})</button></div>
      <div id="progress"></div></div>`;
    $("#go").addEventListener("click", run);
  }

  async function run() {
    const btn = $("#go"); btn.disabled = true;
    const f = $("#load");
    const todo = rows.filter((r) => !r.error);
    const made = new Map();            // clé → id de fiche créée pendant cet import
    let created = 0, added = 0, failed = 0, done = 0;
    const bar = () => { $("#progress").innerHTML = `<div class="progress" style="margin-top:12px"><b>${done} / ${todo.length}</b><div class="bar"><span style="animation:none;width:${Math.round((done / todo.length) * 100)}%"></span></div></div>`; };
    bar();
    // Caves à créer d'abord (une seule fois chacune).
    if (f.create.checked) {
      for (const name of [...new Set(todo.filter((r) => r.newPlace).map((r) => r.newPlace))]) {
        const coll = (todo.find((r) => r.newPlace === name).place || places[0]).collection_id;
        const { data, error } = await sb.from("locations").insert({ name: name.slice(0, 80), kind: "other", collection_id: coll, position: places.length }).select("*").single();
        if (error) { fail(error); continue; }
        places.push(data);
        todo.filter((r) => r.newPlace === name).forEach((r) => (r.place = data));
      }
    }
    for (const r of todo) {
      try {
        const coll = r.place.collection_id;
        const k = key(r.item, coll);
        let id = r.existing || made.get(k);
        if (!id) {
          const { data, error } = await sb.from("items").insert({ ...r.item, collection_id: coll }).select("id").single();
          if (error) throw error;
          id = data.id; made.set(k, id); created++;
        } else added++;
        if (r.n > 0) {
          const { error } = await sb.rpc("adjust_stock", { p_item: id, p_location: r.place.id, p_delta: r.n, p_bin: r.bin || null });
          if (error) throw error;
        }
      } catch (e) { console.error(e); failed++; r.error = "Échec"; }
      done++; if (done % 3 === 0 || done === todo.length) bar();
    }
    $("#progress").innerHTML = `<p class="notice ${failed ? "" : "info"}" style="margin-top:12px">${created} fiche${created > 1 ? "s" : ""} créée${created > 1 ? "s" : ""}, ${added} vin${added > 1 ? "s" : ""} déjà présent${added > 1 ? "s" : ""} complété${added > 1 ? "s" : ""} en stock${failed ? `, ${failed} échec${failed > 1 ? "s" : ""}` : ""}.
      <a href="/app/cave.html?loc=all">Voir la cave</a></p>`;
    toast("Import terminé.");
  }
})();
