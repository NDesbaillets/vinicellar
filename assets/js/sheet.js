// Vinicellar · format du tableau d'import / export (Excel ou CSV) et consigne pour remplir ce tableau avec Claude.
// Une colonne = un champ de fiche. Les en-têtes sont reconnus avec ou sans accents, en français ou en anglais.
(function () {
  const VC = window.VC;
  const fold = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();

  const TYPE = { vin: "wine", wine: "wine", whisky: "whisky", whiskey: "whisky", sake: "sake", rhum: "rum", rum: "rum", cognac: "brandy", armagnac: "brandy",
    brandy: "brandy", calvados: "brandy", gin: "gin", liqueur: "liqueur", autre: "other", other: "other", spiritueux: "other" };
  const STYLE = { rouge: "red", red: "red", blanc: "white", white: "white", rose: "rose", "rose wine": "rose", mousseux: "sparkling", effervescent: "sparkling",
    sparkling: "sparkling", champagne: "sparkling", liquoreux: "sweet", doux: "sweet", sweet: "sweet", mute: "fortified", fortified: "fortified", porto: "fortified",
    orange: "orange" };
  const TYPE_LABEL = { wine: "Vin", whisky: "Whisky", sake: "Saké", rum: "Rhum", brandy: "Cognac", gin: "Gin", liqueur: "Liqueur", other: "Autre" };
  const STYLE_LABEL = { red: "Rouge", white: "Blanc", rose: "Rosé", sparkling: "Mousseux", sweet: "Liquoreux", fortified: "Muté", orange: "Orange" };

  const num = (v) => { if (v === "" || v == null) return null; const n = Number(String(v).replace(/[^\d,.\-]/g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
  const int = (v) => { const n = num(v); return n == null ? null : Math.round(n); };
  const text = (v) => { const s = String(v ?? "").trim(); return s || null; };
  const list = (sep) => (v) => String(v ?? "").split(sep).map((x) => x.trim()).filter(Boolean);

  // key : champ de la fiche (ou pseudo-champ « stock »), h : en-tête du modèle, alt : autres en-têtes acceptés.
  const COLUMNS = [
    { key: "_cave", h: "Cave", alt: ["lieu", "location", "cellar"], read: text, ex: "Maison" },
    { key: "_bin", h: "Emplacement", alt: ["casier", "bin", "rangee"], read: text, ex: "Casier B3" },
    { key: "_qty", h: "Quantité", alt: ["quantite", "qte", "bouteilles", "nombre", "qty", "quantity", "stock"], read: int, ex: 6 },
    { key: "category", h: "Type", alt: ["categorie", "category"], read: (v) => TYPE[fold(v)] || (v ? "other" : null), out: (it) => TYPE_LABEL[it.category], ex: "Vin" },
    { key: "style", h: "Couleur", alt: ["style", "color", "colour"], read: (v) => STYLE[fold(v)] || null, out: (it) => STYLE_LABEL[it.style], ex: "Blanc" },
    { key: "producer", h: "Producteur", alt: ["domaine", "producteur domaine", "distillerie", "producer", "winery"], read: text, ex: "Domaine Louis Bovard" },
    { key: "name", h: "Cuvée", alt: ["cuvee", "nom", "vin", "name", "wine"], read: text, ex: "Médinette Dézaley Grand Cru" },
    { key: "vintage", h: "Millésime", alt: ["millesime", "annee", "vintage", "year"], read: int, ex: 2020 },
    { key: "country", h: "Pays", alt: ["country"], read: text, ex: "Suisse" },
    { key: "region", h: "Région", alt: ["region"], read: text, ex: "Lavaux" },
    { key: "appellation", h: "Appellation", alt: ["aoc", "doc", "aop"], read: text, ex: "Dézaley Grand Cru AOC" },
    { key: "grapes", h: "Cépages", alt: ["cepages", "cepage", "grapes", "assemblage"], read: list(/[;,/]/), out: (it) => (it.grapes || []).join(", "), ex: "Chasselas" },
    { key: "abv", h: "Degré", alt: ["degre", "alcool", "abv", "vol"], read: num, ex: 13 },
    { key: "volume_cl", h: "Contenance (cl)", alt: ["contenance", "volume", "cl"], read: int, ex: 75 },
    { key: "drink_from", h: "Boire dès", alt: ["boire des", "boire de", "drink from", "fenetre debut"], read: int, ex: 2024 },
    { key: "drink_to", h: "Boire jusqu'à", alt: ["boire jusqu a", "drink to", "drink until", "fenetre fin"], read: int, ex: 2040 },
    { key: "peak_from", h: "Apogée dès", alt: ["apogee des", "apogee de", "peak from"], read: int, ex: 2028 },
    { key: "peak_to", h: "Apogée jusqu'à", alt: ["apogee jusqu a", "peak to"], read: int, ex: 2034 },
    { key: "aging_potential_years", h: "Garde (années)", alt: ["garde", "garde annees", "potentiel de garde"], read: int, ex: 20 },
    { key: "serving_temp_min", h: "Service min (°C)", alt: ["service min", "temperature min"], read: int, ex: 10 },
    { key: "serving_temp_max", h: "Service max (°C)", alt: ["service max", "temperature max"], read: int, ex: 12 },
    { key: "description", h: "Description", alt: ["le vin", "description du vin"], read: text, ex: "Chasselas minéral et tendu, d'une grande longueur saline." },
    { key: "vinification", h: "Vinification", alt: ["elevage", "elaboration"], read: text, ex: "Vendanges manuelles, fermentation en cuve, élevage sur lies fines." },
    { key: "terroir", h: "Terroir", alt: ["sols et climat", "sol", "terroir et climat"], read: text, ex: "Terrasses de poudingue et de calcaire face au Léman." },
    { key: "vintage_notes", h: "Notes millésime", alt: ["millesime notes", "particularites", "notes du millesime"], read: text, ex: "Millésime solaire, belle maturité." },
    { key: "pairings", h: "Accords", alt: ["accords mets", "accords mets vins", "pairings"], read: list(/[;\n]/), out: (it) => (it.pairings || []).join(" ; "), ex: "Filets de perche ; Fondue moitié-moitié ; Omble chevalier" },
    { key: "avg_score", h: "Note moyenne", alt: ["note", "score", "rating"], read: num, ex: 4.1 },
    { key: "avg_score_scale", h: "Échelle note", alt: ["echelle", "sur", "echelle note"], read: (v) => { const n = int(v); return [5, 10, 20, 100].includes(n) ? n : null; }, ex: 5 },
    { key: "avg_score_source", h: "Source note", alt: ["source de la note"], read: text, ex: "Vivino" },
    { key: "market_price", h: "Prix marché", alt: ["prix marche", "prix", "price", "market price"], read: num, ex: 42 },
    { key: "market_currency", h: "Devise", alt: ["devise marche", "currency"], read: (v) => (["CHF", "EUR", "USD", "GBP"].includes(String(v).trim().toUpperCase()) ? String(v).trim().toUpperCase() : null), ex: "CHF" },
    { key: "price_source", h: "Source prix", alt: ["source du prix"], read: text, ex: "Mövenpick" },
    { key: "purchase_price", h: "Prix d'achat", alt: ["prix d achat", "prix achat", "purchase price"], read: num, ex: 35 },
    { key: "purchase_year", h: "Année d'achat", alt: ["annee d achat", "annee achat"], read: int, ex: 2023 },
    { key: "purchase_place", h: "Acheté chez", alt: ["achete chez", "caviste", "fournisseur"], read: text, ex: "Cave du domaine" },
    { key: "my_rating", h: "Ma note (/5)", alt: ["ma note"], read: (v) => { const n = num(v); return n != null && n >= 0 && n <= 5 ? Math.round(n * 2) / 2 : null; }, ex: "" },
    { key: "producer_url", h: "Site producteur", alt: ["site", "site web", "url", "website"], read: (v) => { const s = text(v); if (!s) return null; return VC.safeUrl(/^https?:/.test(s) ? s : "https://" + s); }, ex: "https://www.domainebovard.com" },
    { key: "notes", h: "Remarques", alt: ["notes", "commentaire", "remarque"], read: text, ex: "" }
  ];

  const index = new Map();
  for (const c of COLUMNS) for (const h of [c.h, ...c.alt]) index.set(fold(h), c);
  const columnFor = (header) => index.get(fold(header)) || null;

  // Une ligne du tableau → { item, cave, bin, qty }.
  function readRow(row) {
    const item = {}, extra = {};
    for (const [h, v] of Object.entries(row)) {
      const c = columnFor(h);
      if (!c || v === "" || v == null) continue;
      const val = c.read(v);
      if (val == null || (Array.isArray(val) && !val.length)) continue;
      if (c.key.startsWith("_")) extra[c.key] = val; else item[c.key] = val;
    }
    if (!item.name && item.producer) item.name = item.producer;
    if (!item.category) item.category = "wine";
    if (item.category !== "wine") item.style = null;
    if (item.purchase_price != null) item.purchase_currency = item.market_currency || null;
    return { item, cave: extra._cave || null, bin: extra._bin || null, qty: extra._qty ?? null };
  }

  const cell = (c, it, extra) => {
    if (c.key === "_cave") return extra.cave || "";
    if (c.key === "_bin") return extra.bin || "";
    if (c.key === "_qty") return extra.qty ?? "";
    if (c.out) return c.out(it) || "";
    return it[c.key] ?? "";
  };

  // Consigne à coller dans Claude (app ou claude.ai) avec les photos : renvoie un fichier Excel au bon format.
  const PROMPT = `Je t'envoie des photos de bouteilles de ma cave (étiquettes, parfois contre-étiquettes). Pour chaque bouteille différente :
1. Lis l'étiquette : producteur, cuvée, millésime, appellation, degré, contenance. Si plusieurs photos montrent la même bouteille, regroupe-les en une seule ligne et compte les exemplaires dans « Quantité ».
2. Cherche cette bouteille précise sur le web (site du producteur d'abord, puis cavistes, de préférence suisses pour le prix, puis Vivino ou CellarTracker pour la note et la garde). Si la recherche web n'est pas disponible, remplis ce que tu sais avec certitude et laisse le reste vide.
3. Ne jamais inventer un chiffre : une donnée introuvable reste vide. Fenêtre de garde : tu peux l'estimer d'après l'appellation et le millésime.

Rends-moi un fichier Excel (.xlsx) nommé « vinicellar-import.xlsx », une ligne par vin, avec exactement ces colonnes dans cet ordre :
${COLUMNS.map((c) => c.h).join(" | ")}

Formats :
- Type : Vin, Whisky, Saké, Rhum, Cognac, Gin, Liqueur ou Autre. Couleur (vins seulement) : Rouge, Blanc, Rosé, Mousseux, Liquoreux, Muté ou Orange.
- Pays en français. Pour la France, la Suisse et l'Italie, Région = une grande région : France : Alsace, Beaujolais, Bordeaux, Bourgogne, Champagne, Corse, Jura, Languedoc-Roussillon, Loire, Provence, Rhône, Savoie, Sud-Ouest. Suisse : Lavaux, Chablais, La Côte, Côtes de l'Orbe, Bonvillars, Vully, Valais, Genève, Neuchâtel, Lac de Bienne, Tessin, Suisse alémanique. Italie : Piémont, Toscane, Vénétie, etc. Le détail va dans Appellation.
- Cépages séparés par des virgules ; Accords séparés par des points-virgules (3 à 5 accords concrets).
- Années, quantités, températures (°C), contenance (cl) : nombres entiers. Degré, prix, note : nombres (point ou virgule).
- Note moyenne avec son Échelle (5, 10, 20 ou 100) et sa Source. Prix marché d'une bouteille avec la Devise (CHF, EUR, USD ou GBP) et sa Source.
- Description, Vinification, Terroir : 1 à 3 phrases chacune, en français, ton sobre de caviste. Notes millésime : 1 à 2 phrases.
- Laisse vides : Cave, Emplacement, Prix d'achat, Année d'achat, Acheté chez, Ma note, Remarques (je les compléterai), sauf si je te les donne.`;

  VC.table = { COLUMNS, columnFor, readRow, cell, PROMPT, fold };
})();
