const DAY = 86_400_000;
const formats = new Set(["demi_journee", "journee", "week_end", "sejour"]);
export const MAX_PHOTO = 5_000_000;
export const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function text(value: unknown, max: number): string | null {
  return typeof value === "string" ? value.replaceAll("\0", "").trim().slice(0, max) || null : null;
}

export function https(value: unknown): string | null {
  const candidate = text(value, 2000);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function reel(value: string | null): string | null {
  if (!value) return null;
  const url = new URL(value);
  if (url.port || !["instagram.com", "www.instagram.com"].includes(url.hostname)) return null;
  const shortcode = /^\/reels?\/([\w-]+)\/?$/.exec(url.pathname)?.[1];
  return shortcode ? "https://www.instagram.com/reel/" + shortcode + "/" : null;
}

export function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function validDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value && value >= "1900-01-01";
}

function extractionDate(value: unknown, reference: string) {
  if (typeof value !== "string") return null;
  if (/^\d{4}-\d\d-\d\d$/.test(value)) return validDate(value) ? { value, inferred: false } : null;
  if (!/^\d\d-\d\d$/.test(value)) return null;
  const year = Number(reference.slice(0, 4));
  for (let offset = 0; offset <= 8; offset++) {
    const candidate = (year + offset) + "-" + value;
    if (candidate >= reference && validDate(candidate)) return { value: candidate, inferred: true };
  }
  return null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function planningProposal(raw: unknown) {
  const value = record(raw);
  const fields: Record<string, unknown> = {};
  for (const [key, min, max] of [
    ["duree_minutes", 1, 10080], ["aller_minutes", 0, 1440], ["retour_minutes", 0, 1440], ["retour_decalage", 0, 6],
  ] as const) {
    const number = value[key];
    if (typeof number === "number" && Number.isInteger(number) && number >= min && number <= max) fields[key] = number;
  }
  for (const key of ["heure_activite", "heure_vendredi", "heure_retour"]) {
    const hour = value[key];
    if (typeof hour === "string" && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(hour)) fields[key] = hour;
  }
  for (const key of ["weekend", "vendredi_soir"]) {
    if (typeof value[key] === "boolean") fields[key] = value[key];
  }
  if (Array.isArray(value.jours)) {
    const days = [...new Set(value.jours.filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))];
    if (days.length) fields.jours = days;
  }
  return Object.keys(fields).length ? fields : null;
}

export function normalize(raw: unknown, reference: string, thumbnail: string | null) {
  const doc = record(raw);
  const expected = [
    "titre", "accroche", "description", "categorie", "format", "adresse", "ville",
    "site_reservation", "telephone", "budget_min", "budget_max", "date_debut",
    "date_fin", "date_limite_reservation", "preavis_semaines", "image_url",
  ] as const;
  const checks: Record<string, string> = {};
  const inputChecks = record(doc.a_verifier);
  for (const key of expected) {
    const note = text(inputChecks[key], 240);
    if (note) checks[key] = note;
  }
  const dates = Object.fromEntries(
    (["date_debut", "date_fin", "date_limite_reservation"] as const).map((key) => {
      const date = extractionDate(doc[key], reference);
      if (date?.inferred) checks[key] = "Année absente de la source, prochaine occurrence à vérifier.";
      if (doc[key] && !date) checks[key] = "Date illisible ou invalide.";
      return [key, date?.value ?? null];
    }),
  );
  if (dates.date_fin && dates.date_debut && dates.date_fin < dates.date_debut) {
    dates.date_fin = null;
    checks.date_fin = "Incohérente avec la date de début.";
  }
  const money = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1e8
    ? Math.round(value * 100) / 100 : null;
  const budget_min = money(doc.budget_min);
  let budget_max = money(doc.budget_max);
  if (budget_min != null && budget_max != null && budget_max < budget_min) {
    budget_max = null;
    checks.budget_max = "Incohérent avec le minimum.";
  }
  const dateCible = dates.date_limite_reservation ?? dates.date_debut;
  const remains = dateCible ? (Date.parse(dateCible) - Date.parse(reference)) / DAY : null;
  const urgence = remains == null || remains < 0 ? null : remains <= 3 ? 5 : remains <= 7 ? 4 : remains <= 21 ? 3 : 2;
  const proposedFormat = text(doc.format, 20);
  const preavis = doc.preavis_semaines;
  return {
    titre: text(doc.titre, 160),
    accroche: text(doc.accroche, 200)?.replace(/\s*\n\s*/g, " ") ?? null,
    description: text(doc.description, 5000),
    categorie: text(doc.categorie, 60),
    format: proposedFormat && formats.has(proposedFormat) ? proposedFormat : null,
    adresse: text(doc.adresse, 300), ville: text(doc.ville, 100),
    site_reservation: https(doc.site_reservation), telephone: text(doc.telephone, 50),
    budget_min, budget_max, ...dates, urgence,
    preavis_semaines: typeof preavis === "number" && Number.isInteger(preavis) && preavis >= 0 && preavis <= 52 ? preavis : null,
    image_url: thumbnail ?? https(doc.image_url),
    proposition_creneau: planningProposal(doc.proposition_creneau),
    a_verifier: checks,
  };
}
