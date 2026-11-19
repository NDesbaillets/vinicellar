// ARÔMES V&N · recipe-import : fonctions pures (aucun réseau, aucune base), testées dans lib_test.ts.

// ---------------------------------------------------------------- types
export const UNITS = ["g", "kg", "ml", "cl", "l", "cas", "cac", "piece", "pincee", "botte", "gousse", "tranche"] as const;
export type Unit = typeof UNITS[number];
export const COURSES = ["entree", "plat", "dessert", "accompagnement", "boisson", "autre"] as const;
export const SOURCES = ["legende", "parole", "ecran", "visuel", "page", "web"] as const;

export type RawIngredient = {
  group: string | null; label: string; canonical: string; quantity: number | null;
  unit: string | null; unitOrigin: string | null; precision: string | null; optional: boolean; source: string | null;
};
export type RawStep = { text: string; textOriginal: string | null; timerSeconds: number | null; source: string | null };
export type Structured = {
  title: string | null; titleOriginal: string | null; lang: string | null; summary: string | null;
  course: typeof COURSES[number] | null; cuisine: string | null;
  servings: { value: number | null; estimated: boolean };
  timeActive: { value: number | null; estimated: boolean };
  timeTotal: { value: number | null; estimated: boolean };
  difficulty: 1 | 2 | 3 | null;
  ingredients: RawIngredient[]; steps: RawStep[]; alerts: string[];
  completeness: "complete" | "partielle" | "insuffisante";
};

// ---------------------------------------------------------------- petits utilitaires
export const str = (v: unknown, max = 2000): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) v = String(v);
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
};
const numOrNull = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const intOrNull = (v: unknown, min: number, max: number): number | null => {
  const n = numOrNull(v, min, max);
  return n === null ? null : Math.round(n);
};
const bool = (v: unknown) => v === true || v === "true";

/** minuscules, sans accents ni ligatures, ponctuation en espaces : clé de comparaison. */
export function norm(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/œ/g, "oe").replace(/æ/g, "ae")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Clé tolérant singulier/pluriel : chaque mot de plus de 3 lettres perd son « s » ou « x » final. */
export function matchKey(s: string): string {
  return norm(s).split(" ").filter(Boolean).map((w) => (w.length > 3 && /[sx]$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w)).join(" ");
}

// ---------------------------------------------------------------- catalogue
export type CatalogRow = { id: string; name: string; aliases?: string[] | null; density_g_per_ml?: number | null; aisle?: string | null };
export type CatalogIndex = { byKey: Map<string, CatalogRow> };

export function buildCatalogIndex(rows: CatalogRow[]): CatalogIndex {
  const byKey = new Map<string, CatalogRow>();
  // Noms canoniques d'abord : ils l'emportent sur un alias identique d'une autre ligne.
  for (const r of rows) { const k = matchKey(r.name); if (k && !byKey.has(k)) byKey.set(k, r); }
  for (const r of rows) for (const a of r.aliases ?? []) { const k = matchKey(a); if (k && !byKey.has(k)) byKey.set(k, r); }
  return { byKey };
}
/** Premier nom (canonique ou alias) trouvé, insensible à la casse, aux accents et au pluriel. */
export function findCatalog(index: CatalogIndex, ...names: (string | null | undefined)[]): CatalogRow | null {
  for (const n of names) {
    if (!n) continue;
    const hit = index.byKey.get(matchKey(n));
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------- quantités et unités
const FRACTIONS: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875 };

/** Nombre, « 1,5 », « 1/2 », « 1 1/2 », « ½ » ; fourchette (« 2-3 ») ou texte : null (aucune quantité inventée). */
export function parseQuantity(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== "string") return null;
  let s = v.trim();
  if (!s) return null;
  s = s.replace(/[½¼¾⅓⅔⅛⅜⅝⅞]/g, (m) => ` ${FRACTIONS[m]} `).replace(/(\d)\s+(0\.\d+)/, (_m, a, b) => String(Number(a) + Number(b))).trim();
  let m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (m) return Number(m[3]) ? Number(m[1]) + Number(m[2]) / Number(m[3]) : null;
  m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
  m = s.match(/^(\d+(?:[.,]\d+)?)$/);
  if (m) return Number(m[1].replace(",", "."));
  const f = Number(s);
  return Number.isFinite(f) && f >= 0 && /^[\d.]+$/.test(s) ? f : null;
}

const compact = (s: string) => s.toLowerCase().replace(/œ/g, "oe").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");

const UNIT_WORDS: Record<Unit, string[]> = {
  g: ["g", "gr", "gramme", "grammes", "gram", "grams"],
  kg: ["kg", "kilo", "kilos", "kilogramme", "kilogrammes", "kilogram", "kilograms"],
  ml: ["ml", "millilitre", "millilitres", "milliliter", "milliliters"],
  cl: ["cl", "centilitre", "centilitres", "centiliter", "centiliters"],
  l: ["l", "litre", "litres", "liter", "liters"],
  cas: ["cas", "cs", "cuilleresoupe", "cuillereasoupe", "cuilleresasoupe", "cuilleresoupes", "cuillerasoupe", "csoupe", "cuilleree", "tbsp", "tbs", "tbl", "tablespoon", "tablespoons"],
  cac: ["cac", "cc", "cuilleremoka", "cuillereacafe", "cuilleresacafe", "cuilleresdecafe", "cuilleredecafe", "ccafe", "tsp", "teaspoon", "teaspoons"],
  piece: ["piece", "pieces", "pc", "pcs", "unite", "unites", "entier", "entiere", "entiers", "entieres", "whole", "item", "items", "each"],
  pincee: ["pincee", "pincees", "pinch", "pinches", "dash", "dashes"],
  botte: ["botte", "bottes", "bunch", "bunches", "bouquet", "bouquets"],
  gousse: ["gousse", "gousses", "clove", "cloves"],
  tranche: ["tranche", "tranches", "slice", "slices"],
};
const UNIT_LOOKUP = new Map<string, Unit>();
for (const [u, words] of Object.entries(UNIT_WORDS) as [Unit, string[]][]) for (const w of words) UNIT_LOOKUP.set(w, u);

type Conv = { kind: "mass" | "volume"; factor: number; label: string; plural?: string; cup?: boolean };
// Unités anglo-saxonnes à convertir : masse en g, volume en ml (valeurs US).
const CONVERTIBLE: Record<string, Conv> = {
  oz: { kind: "mass", factor: 28.3495, label: "oz" }, ounce: { kind: "mass", factor: 28.3495, label: "oz" }, ounces: { kind: "mass", factor: 28.3495, label: "oz" },
  lb: { kind: "mass", factor: 453.592, label: "lb" }, lbs: { kind: "mass", factor: 453.592, label: "lb" },
  pound: { kind: "mass", factor: 453.592, label: "lb" }, pounds: { kind: "mass", factor: 453.592, label: "lb" },
  stick: { kind: "mass", factor: 113.4, label: "stick", plural: "sticks" }, sticks: { kind: "mass", factor: 113.4, label: "stick", plural: "sticks" },
  cup: { kind: "volume", factor: 236.588, label: "cup", plural: "cups", cup: true }, cups: { kind: "volume", factor: 236.588, label: "cup", plural: "cups", cup: true },
  floz: { kind: "volume", factor: 29.5735, label: "fl oz" }, fluidounce: { kind: "volume", factor: 29.5735, label: "fl oz" }, fluidounces: { kind: "volume", factor: 29.5735, label: "fl oz" },
  pint: { kind: "volume", factor: 473.176, label: "pint", plural: "pints" }, pints: { kind: "volume", factor: 473.176, label: "pint", plural: "pints" }, pt: { kind: "volume", factor: 473.176, label: "pint", plural: "pints" },
  quart: { kind: "volume", factor: 946.353, label: "quart", plural: "quarts" }, quarts: { kind: "volume", factor: 946.353, label: "quart", plural: "quarts" }, qt: { kind: "volume", factor: 946.353, label: "quart", plural: "quarts" },
  gallon: { kind: "volume", factor: 3785.41, label: "gallon", plural: "gallons" }, gallons: { kind: "volume", factor: 3785.41, label: "gallon", plural: "gallons" }, gal: { kind: "volume", factor: 3785.41, label: "gallon", plural: "gallons" },
};

/** Unité écrite en français ou en anglais (« càs », « c. à soupe », « tbsp », « Tablespoons »…) vers la liste autorisée. */
export function normalizeUnit(raw: unknown): Unit | null {
  if (typeof raw !== "string") return null;
  return UNIT_LOOKUP.get(compact(raw)) ?? null;
}

/** 1 chiffre après la virgule sous 10, entier jusqu'à 100, puis multiples de 5 : une quantité de cuisine, pas de laboratoire. */
export function roundNice(v: number): number {
  if (v >= 100) return Math.round(v / 5) * 5;
  if (v >= 10) return Math.round(v);
  return Math.round(v * 10) / 10;
}
const fr = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

const LIQUID_RE = /\b(lait|eau|bouillon|jus|vin|biere|huile|vinaigre|creme|sirop|alcool|rhum|cafe|the|sauce|fond|coulis|yaourt|yogourt|liqueur|whisky|cognac|kirsch|boisson|soda|infusion)\b/;
export function looksLiquid(name: string, aisle?: string | null): boolean {
  return aisle === "boissons" || LIQUID_RE.test(norm(name));
}

export type LineInput = { name: string; quantity: unknown; unit: unknown; unitOrigin: unknown; precision: string | null; density?: number | null; aisle?: string | null };
export type LineOutput = { quantity: number | null; unit: Unit | null; precision: string | null; alerts: string[] };

const joinPrecision = (a: string | null, b: string | null) => [a, b].filter(Boolean).join(", ") || null;
const massOut = (g: number): { quantity: number; unit: Unit } => (g >= 1000 ? { quantity: Math.round(g / 10) / 100, unit: "kg" } : { quantity: roundNice(g), unit: "g" });
const volOut = (ml: number): { quantity: number; unit: Unit } => (ml >= 1000 ? { quantity: Math.round(ml / 10) / 100, unit: "l" } : { quantity: roundNice(ml), unit: "ml" });

/**
 * Ramène une ligne d'ingrédient au système métrique et à la liste d'unités autorisée.
 * - unité déjà autorisée (ou synonyme français/anglais) : gardée telle quelle ;
 * - oz, lb, stick : en g (ou kg) ; fl oz, pint, quart, gallon : en ml (ou l) ; l'unité d'origine va dans `precision` ;
 * - cup : en grammes si la densité du catalogue est connue et que l'ingrédient n'est pas un liquide (alerte « Converti »),
 *   sinon en ml (alerte si l'ingrédient semble se peser, car les grammes n'ont pas pu être calculés) ;
 * - unité inconnue (« boîte », « poignée »…) : unité vide, mot d'origine conservé dans `precision`.
 */
export function normalizeLine(l: LineInput): LineOutput {
  const q = parseQuantity(l.quantity);
  const originRaw = typeof l.unitOrigin === "string" && l.unitOrigin.trim() ? l.unitOrigin.trim() : null;
  const unitRaw = typeof l.unit === "string" && l.unit.trim() ? l.unit.trim() : null;
  const alerts: string[] = [];

  // Priorité à l'unité d'origine reconnue ; sinon l'unité donnée par le modèle si elle est valide.
  const candidates = [originRaw, unitRaw].filter(Boolean) as string[];
  for (const c of candidates) {
    const conv = CONVERTIBLE[compact(c)];
    if (conv) {
      if (q === null) return { quantity: null, unit: null, precision: joinPrecision(c, l.precision), alerts };
      const label = q > 1 && conv.plural ? conv.plural : conv.label;
      const origin = `${fr(q)} ${label}`;
      if (conv.kind === "mass") {
        const o = massOut(q * conv.factor);
        return { ...o, precision: joinPrecision(origin, l.precision), alerts };
      }
      const ml = q * conv.factor;
      if (conv.cup) {
        const d = typeof l.density === "number" && l.density > 0 ? l.density : null;
        const liquid = looksLiquid(l.name, l.aisle);
        if (d && !liquid) {
          const o = massOut(ml * d);
          alerts.push(`Converti : ${origin} de ${l.name} → ${o.quantity} ${o.unit} (densité ${fr(d)} g/ml du catalogue)`);
          return { ...o, precision: joinPrecision(origin, l.precision), alerts };
        }
        const o = volOut(ml);
        if (!liquid) alerts.push(`Converti : ${origin} de ${l.name} → ${o.quantity} ${o.unit} (densité absente du catalogue : grammes non calculés)`);
        return { ...o, precision: joinPrecision(origin, l.precision), alerts };
      }
      return { ...volOut(ml), precision: joinPrecision(origin, l.precision), alerts };
    }
    const unit = normalizeUnit(c);
    if (unit) {
      return q === null ? { quantity: null, unit: null, precision: l.precision, alerts } : { quantity: q, unit, precision: l.precision, alerts };
    }
  }
  // Unité inconnue : on garde le mot d'origine, sans rien convertir.
  return { quantity: q, unit: null, precision: q !== null && candidates[0] ? joinPrecision(candidates[0].slice(0, 40), l.precision) : l.precision, alerts };
}

// ---------------------------------------------------------------- températures
export const fahrenheitToCelsius = (f: number) => Math.round(((f - 32) * 5 / 9) / 5) * 5;

/** « 350°F », « 350 °F », « 350 degrees F », « 350 Fahrenheit », « 350-375°F » → °C arrondis à 5 près. Les °C ne bougent pas. */
export function convertTemperaturesInText(text: string): { text: string; converted: boolean } {
  let converted = false;
  const conv = (v: string) => { converted = true; return fahrenheitToCelsius(Number(v.replace(",", "."))); };
  const unit = String.raw`(?:\s*(?:°|º|˚)\s*F\b|\s*(?:degrees?|degrés?)\s*(?:F\b|Fahrenheit)|\s*Fahrenheit)`;
  let out = text.replace(new RegExp(String.raw`(\d{2,3})\s*(?:-|–|à|to)\s*(\d{2,3})${unit}`, "gi"), (_m, a, b) => `${conv(a)} à ${conv(b)} °C`);
  out = out.replace(new RegExp(String.raw`(\d{2,3}(?:[.,]\d+)?)${unit}`, "gi"), (_m, a) => `${conv(a)} °C`);
  return { text: out, converted };
}

// ---------------------------------------------------------------- JSON renvoyé par Claude
function repairJson(s: string): string {
  // virgules traînantes avant } ou ]
  let out = s.replace(/,\s*([}\]])/g, "$1");
  // JSON tronqué : on referme chaînes, tableaux et objets ouverts après avoir retiré le dernier élément incomplet.
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (const ch of out) {
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  if (!stack.length && !inStr) return out;
  if (inStr) out += '"';
  out = out.replace(/,\s*"[^"]*"\s*:\s*$/, "").replace(/,\s*$/, "").replace(/:\s*$/, ": null");
  return out + stack.reverse().join("");
}

/** Extrait un objet JSON d'une réponse de modèle : clôtures ```json, texte autour, virgules traînantes, coupure en fin de réponse. */
export function parseModelJson(text: string): Record<string, unknown> | null {
  if (typeof text !== "string") return null;
  const t = text.replace(/```(?:json|JSON)?/g, "");
  const start = t.indexOf("{");
  if (start < 0) return null;
  const end = t.lastIndexOf("}");
  const attempts = [end > start ? t.slice(start, end + 1) : "", t.slice(start)].filter(Boolean);
  for (const a of attempts) {
    for (const cand of [a, repairJson(a)]) {
      try {
        const v = JSON.parse(cand);
        if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
      } catch { /* essai suivant */ }
    }
  }
  return null;
}

const wrapVal = (v: unknown): { value: unknown; estimated: boolean } =>
  v && typeof v === "object" && !Array.isArray(v) ? { value: (v as Record<string, unknown>).valeur, estimated: bool((v as Record<string, unknown>).estime) } : { value: v, estimated: false };

/** Valide et borne le JSON du §3 du contrat. Ce que le modèle renvoie reste une donnée : types et longueurs vérifiés ici. */
export function sanitizeStructured(raw: Record<string, unknown>): Structured {
  const ingredients: RawIngredient[] = (Array.isArray(raw.ingredients) ? raw.ingredients : []).slice(0, 150).flatMap((x) => {
    if (!x || typeof x !== "object") return [];
    const o = x as Record<string, unknown>;
    const label = str(o.libelle, 300) ?? str(o.nom_canonique, 300);
    if (!label) return [];
    return [{
      group: str(o.groupe, 120), label, canonical: str(o.nom_canonique, 120) ?? label.slice(0, 120),
      quantity: parseQuantity(o.quantite), unit: str(o.unite, 40), unitOrigin: str(o.unite_origine, 40),
      precision: str(o.precision, 200), optional: bool(o.facultatif),
      source: (SOURCES as readonly string[]).includes(String(o.source)) ? String(o.source) : null,
    }];
  });
  const steps: RawStep[] = (Array.isArray(raw.etapes) ? raw.etapes : []).slice(0, 100).flatMap((x) => {
    if (!x || typeof x !== "object") return [];
    const o = x as Record<string, unknown>;
    const text = str(o.texte, 3000);
    if (!text) return [];
    return [{
      text, textOriginal: str(o.texte_original, 3000), timerSeconds: intOrNull(o.minuteur_s, 1, 86400),
      source: (SOURCES as readonly string[]).includes(String(o.source)) ? String(o.source) : null,
    }];
  });
  const sv = wrapVal(raw.portions), ta = wrapVal(raw.temps_actif_min), tt = wrapVal(raw.temps_total_min);
  const lang = typeof raw.langue_originale === "string" && /^[a-z]{2,3}$/i.test(raw.langue_originale.trim()) ? raw.langue_originale.trim().toLowerCase() : null;
  const diff = intOrNull(raw.difficulte, 1, 3);
  const course = typeof raw.type_plat === "string" ? (COURSES as readonly string[]).find((c) => c === raw.type_plat) : undefined;
  const comp = raw.completude === "complete" || raw.completude === "insuffisante" ? raw.completude : "partielle";
  return {
    title: str(raw.titre, 200), titleOriginal: str(raw.titre_original, 200), lang, summary: str(raw.resume, 1000),
    course: (course as Structured["course"]) ?? null, cuisine: str(raw.cuisine, 80),
    servings: { value: intOrNull(sv.value, 1, 200), estimated: sv.estimated },
    timeActive: { value: intOrNull(ta.value, 0, 43200), estimated: ta.estimated },
    timeTotal: { value: intOrNull(tt.value, 0, 43200), estimated: tt.estimated },
    difficulty: diff as Structured["difficulty"],
    ingredients, steps,
    alerts: (Array.isArray(raw.alertes) ? raw.alertes : []).map((a) => str(a, 400)).filter(Boolean).slice(0, 20) as string[],
    completeness: comp as Structured["completeness"],
  };
}

// ---------------------------------------------------------------- légende : suffisante ou non ?
export type CaptionSignals = { ingredientLines: number; stepLines: number; verdict: "no" | "maybe"; sufficient: boolean };
const QTY_RE = /(^|\s)(\d+([.,/]\d+)?|[½¼¾⅓⅔]|une?|deux|trois|quatre|cinq|demi|quelques?)\s*(g|gr|kg|ml|cl|dl|l|c\.?\s?à\.?\s?[sc]\.?|càs|càc|cuill\w*|gousses?|pincées?|bottes?|tranches?|pièces?|pouces?|sachets?|boîtes?|noix|brins?|feuilles?|cup|cups|tbsp|tsp|oz|lb)\b/i;
const STEP_RE = /(^\s*(\d+\s*[.)\-:]|étape|step)\s*)|\b(mélang\w*|cuis\w*|cuire|ajout\w*|enfourn\w*|préchauff\w*|verse\w*|incorpor\w*|laiss\w*|coup\w*|émince\w*|chauff\w*|mijot\w*|fouett\w*|pétri\w*|sal\w*|poêl\w*|dor\w*|rôti\w*|laqu\w*|badigeonn\w*|mix\w*|rissol\w*|faites|faire|réserv\w*|dispos\w*|étal\w*|mari\w*|bake|mix|stir|add|preheat)\b/i;

/**
 * Heuristique sans appel IA, en complément du triage Claude :
 * - verdict « no » (moins de 2 lignes d'ingrédients chiffrés) : la légende ne peut pas suffire, on passe directement à la vidéo ;
 * - verdict « maybe » : c'est Claude qui tranche ;
 * - `sufficient` (≥ 3 ingrédients ET ≥ 2 étapes) sert de décision de repli si l'appel de triage échoue.
 */
export function captionSignals(caption: string): CaptionSignals {
  const lines = String(caption ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let ing = 0, steps = 0;
  for (const l of lines) {
    const isIng = l.length <= 120 && QTY_RE.test(l) && !/^(\d+\s*[.)]\s+)\p{L}{3,}.*\b(mélang|cuis|ajout|enfourn)/iu.test(l);
    if (isIng) ing++;
    else if (l.length >= 15 && STEP_RE.test(l)) steps++;
  }
  return { ingredientLines: ing, stepLines: steps, verdict: ing >= 2 ? "maybe" : "no", sufficient: ing >= 3 && steps >= 2 };
}

// ---------------------------------------------------------------- URL
const TRACKING = /^(utm_|fbclid$|gclid$|igsh$|igshid$|img_index$|mc_|ref$|ref_)/i;
/** Retire ancre et paramètres de suivi ; null si ce n'est pas une URL http(s). */
export function cleanUrl(input: string): string | null {
  try {
    const u = new URL(String(input).trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch { return null; }
}

/** Lien de post Instagram (p, reel, reels, tv) → { shortCode, url canonique } ; sinon null. */
export function parseInstagramUrl(input: string): { shortCode: string; url: string } | null {
  try {
    const u = new URL(String(input).trim());
    if (!/^(www\.)?instagram\.com$/i.test(u.hostname) && !/^instagr\.am$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/\/(?:[A-Za-z0-9._]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/);
    return m ? { shortCode: m[1], url: `https://www.instagram.com/${/\/reels?\//.test(u.pathname) ? "reel" : "p"}/${m[1]}/` } : null;
  } catch { return null; }
}

/** Anti-SSRF : refuse tout ce qui n'est pas un site public (localhost, réseaux privés, métadonnées cloud, IPv6 locales). */
export function isPublicHttpUrl(input: string): boolean {
  let u: URL;
  try { u = new URL(input); } catch { return false; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password) return false;
  const h = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan")) return false;
  if (h.startsWith("[")) {
    const v6 = h.slice(1, -1);
    // Seuls les IPv6 globaux (2000::/3) sont acceptés.
    return /^[23][0-9a-f]{0,3}:/.test(v6) && !v6.startsWith("2001:db8");
  }
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  return h.includes(".") && /[a-z]/.test(h);
}

// ---------------------------------------------------------------- HTML : JSON-LD, texte
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", hellip: "…",
  ndash: "–", mdash: "—", deg: "°", frac12: "½", frac14: "¼", frac34: "¾", eacute: "é", egrave: "è", ecirc: "ê", agrave: "à",
  acirc: "â", ccedil: "ç", ocirc: "ô", ucirc: "û", ugrave: "ù", icirc: "î", euml: "ë", iuml: "ï", oelig: "œ", laquo: "«", raquo: "»",
};
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return Number.isFinite(cp) ? String.fromCodePoint(cp) : m; } catch { return m; }
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}
const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

function findRecipeNode(node: unknown, depth = 0): Record<string, unknown> | null {
  if (!node || typeof node !== "object" || depth > 6) return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findRecipeNode(n, depth + 1); if (r) return r; } return null; }
  const o = node as Record<string, unknown>;
  const t = o["@type"];
  if ((Array.isArray(t) ? t : [t]).some((x) => typeof x === "string" && /(^|[/#:])Recipe$/i.test(x))) return o;
  for (const k of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "item"]) {
    const r = findRecipeNode(o[k], depth + 1);
    if (r) return r;
  }
  return null;
}

/** Premier objet schema.org/Recipe trouvé dans les balises <script type="application/ld+json"> (y compris dans @graph). */
export function extractJsonLdRecipe(html: string): Record<string, unknown> | null {
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const body = m[1].replace(/^\s*<!--/, "").replace(/-->\s*$/, "").replace(/^\s*\/\/\s*<!\[CDATA\[|\/\/\s*\]\]>\s*$/g, "").trim();
    let data: unknown;
    try { data = JSON.parse(body); } catch {
      try { data = JSON.parse(body.replace(/[\u0000-\u001f]+/g, " ")); } catch { continue; }
    }
    const r = findRecipeNode(data);
    if (r) return r;
  }
  return null;
}

/** « PT1H30M » → 90 ; « P0DT45M » → 45 ; sinon null. */
export function isoDurationToMinutes(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m || !m.slice(1).some(Boolean)) return null;
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) + Math.round(Number(m[4] ?? 0) / 60);
}

const nameOf = (v: unknown): string | null => {
  if (typeof v === "string") return str(stripTags(v), 120);
  if (Array.isArray(v)) return v.map(nameOf).filter(Boolean).join(", ") || null;
  if (v && typeof v === "object") return nameOf((v as Record<string, unknown>).name);
  return null;
};
function flattenInstructions(v: unknown, depth = 0): string[] {
  if (depth > 4 || v == null) return [];
  if (typeof v === "string") return stripTags(v.replace(/<\/?(p|li|br)\b[^>]*>/gi, "\n")).length ? v.split(/\r?\n+/).map(stripTags).filter(Boolean) : [];
  if (Array.isArray(v)) return v.flatMap((x) => flattenInstructions(x, depth + 1));
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.itemListElement) return flattenInstructions(o.itemListElement, depth + 1);
    return flattenInstructions(o.text ?? o.name, depth + 1);
  }
  return [];
}

/** Fiche JSON-LD → texte compact pour Claude, plus l'auteur et le titre. */
export function recipeJsonLdToText(r: Record<string, unknown>): { text: string; author: string | null; name: string | null; hasContent: boolean } {
  const ingredients = (Array.isArray(r.recipeIngredient) ? r.recipeIngredient : typeof r.recipeIngredient === "string" ? [r.recipeIngredient] : [])
    .map((x) => stripTags(String(x))).filter(Boolean);
  const steps = flattenInstructions(r.recipeInstructions);
  const yieldV = Array.isArray(r.recipeYield) ? r.recipeYield.join(" / ") : r.recipeYield;
  const mins = (k: string) => isoDurationToMinutes(r[k]);
  const name = nameOf(r.name), author = nameOf(r.author);
  const out = [
    name && `Titre : ${name}`,
    author && `Auteur : ${author}`,
    typeof r.description === "string" && `Description : ${stripTags(r.description).slice(0, 600)}`,
    yieldV != null && `Portions : ${stripTags(String(yieldV))}`,
    mins("prepTime") != null && `Préparation : ${mins("prepTime")} min`,
    mins("cookTime") != null && `Cuisson : ${mins("cookTime")} min`,
    mins("totalTime") != null && `Temps total : ${mins("totalTime")} min`,
    nameOf(r.recipeCategory) && `Catégorie : ${nameOf(r.recipeCategory)}`,
    nameOf(r.recipeCuisine) && `Cuisine : ${nameOf(r.recipeCuisine)}`,
    ingredients.length && `Ingrédients :\n${ingredients.map((i) => `- ${i}`).join("\n")}`,
    steps.length && `Étapes :\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
  ].filter(Boolean).join("\n");
  return { text: out.slice(0, 30000), author, name, hasContent: ingredients.length > 0 && steps.length > 0 };
}

/** Texte principal d'une page : <article> ou <main> si présent, sans scripts, menus ni pied de page. 60 000 caractères au plus. */
export function htmlToText(html: string, max = 60000): { text: string; title: string | null; siteName: string | null } {
  const title = (() => { const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i); return m ? str(stripTags(m[1]), 200) : null; })();
  const siteName = (() => {
    const m = html.match(/<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']*)["']/i) ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:site_name["']/i);
    return m ? str(decodeEntities(m[1]), 120) : null;
  })();
  const description = (() => {
    const m = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i);
    return m ? str(decodeEntities(m[1]), 500) : null;
  })();
  let body = html.replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head|nav|footer|aside|form|button|select)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const main = body.match(/<article\b[\s\S]*?<\/article\s*>/i) ?? body.match(/<main\b[\s\S]*?<\/main\s*>/i);
  if (main && stripTags(main[0]).length > 500) body = main[0];
  const text = decodeEntities(body.replace(/<\/?(p|li|div|br|h[1-6]|tr|section|ul|ol)\b[^>]*>/gi, "\n").replace(/<[^>]*>/g, " "))
    .replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: [title && `Titre de la page : ${title}`, description && `Description : ${description}`, text].filter(Boolean).join("\n").slice(0, max), title, siteName };
}

// ---------------------------------------------------------------- contenu non fiable dans le prompt
/** Entoure un contenu externe d'une balise ; toute balise du même nom déjà présente dans le contenu est neutralisée. */
export function fence(tag: string, content: string): string {
  const safe = content.replace(/<\s*\/?\s*(legende|commentaires_auteur|transcription_video|page_web|json_ld|catalogue|donnees)[^>]*>/gi, "[balise retirée]");
  return `<${tag}>\n${safe}\n</${tag}>`;
}

// ---------------------------------------------------------------- divers
/** Base64 par morceaux (multiples de 3 octets) : évite la pile d'appels et les copies inutiles sur 20 Mo. */
export function bytesToBase64(buf: Uint8Array): string {
  const parts: string[] = [];
  const step = 3 * 0x4000;
  for (let i = 0; i < buf.length; i += step) {
    let s = "";
    const sub = buf.subarray(i, i + step);
    for (let j = 0; j < sub.length; j += 0x2000) s += String.fromCharCode(...sub.subarray(j, j + 0x2000));
    parts.push(btoa(s));
  }
  return parts.join("");
}

/** Part des éléments du plus petit ensemble qui se retrouvent dans l'autre ; 0 si l'un des ensembles a moins de `minSize` éléments. */
export function overlapRatio(a: Iterable<string>, b: Iterable<string>, minSize = 3): number {
  const A = new Set(a), B = new Set(b);
  if (A.size < minSize || B.size < minSize) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size);
}

/** Première lettre en minuscule des noms de catalogue importés (« Oignon » → « oignon »), sauf sigles. */
export const canonicalName = (s: string) => s.trim().replace(/\s+/g, " ").replace(/^(\p{Lu})(\p{Ll})/u, (_m, a: string, b: string) => a.toLowerCase() + b).slice(0, 120);
