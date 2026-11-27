import type { CarTrip } from "./route.ts";

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

export function exactDate(date: string) {
  return /^\d{4}-\d\d-\d\d$/.test(date) && validDate(date);
}

export function localEvents(raw: Record<string, unknown>, first: string, last: string, excluded: string[], inspiration = false) {
  const found = new Set(Array.isArray(raw.sources_trouvees) ? raw.sources_trouvees : []);
  const seen = new Set<string>();
  const events = Array.isArray(raw.sorties) ? raw.sorties : [];
  return events.flatMap((item: unknown) => {
    const candidate = record(item);
    const source = https(candidate.source);
    const titre = text(candidate.titre, 160), ville = text(candidate.ville, 100);
    const description = text(candidate.description, 300), date = text(candidate.date, 12);
    const dateAllowed = date ? exactDate(date) && date >= first && date <= last && !excluded.includes(date)
      : inspiration && candidate.date == null;
    if (!titre || !ville || !description || !dateAllowed || !source || !found.has(source) || seen.has(source)) return [];
    seen.add(source);
    return [{ titre, ville, description, date, source }];
  }).slice(0, inspiration ? 12 : 6).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
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
  const dates: Record<"date_debut" | "date_fin" | "date_limite_reservation", string | null> = {
    date_debut: null, date_fin: null, date_limite_reservation: null,
  };
  for (const key of ["date_debut", "date_fin", "date_limite_reservation"] as const) {
    const date = extractionDate(doc[key], reference);
    if (date?.inferred) checks[key] = "Année absente de la source, prochaine occurrence à vérifier.";
    if (doc[key] && !date) checks[key] = "Date illisible ou invalide.";
    dates[key] = date?.value ?? null;
  }
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
  const delay = doc.delai_reservation_jours;
  const season = typeof doc.saison_activite === "string"
      && ["hiver", "printemps", "ete", "automne", "toute_annee"].includes(doc.saison_activite)
    ? doc.saison_activite : null;
  const months = Array.isArray(doc.meilleure_periode)
    ? [...new Set(doc.meilleure_periode.filter((month) => Number.isInteger(month) && month >= 1 && month <= 12))].sort((a, b) => a - b)
    : [];
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
    delai_reservation_jours: typeof delay === "number" && Number.isInteger(delay) && delay >= 0 && delay <= 365 ? delay : null,
    saison_activite: season,
    meilleure_periode: months,
    conditions_activite: text(doc.conditions_activite, 240),
    image_url: thumbnail ?? https(doc.image_url),
    proposition_creneau: planningProposal(doc.proposition_creneau),
    a_verifier: checks,
  };
}

/** Les hypothèses réservent du temps dans les suggestions, sans créer d’occurrence. */
export function importedSlot(idea: ReturnType<typeof normalize>, trip: CarTrip | null) {
  const suggestion = record(idea.proposition_creneau);
  const assumptions: string[] = [];
  function fallback(key: string, value: unknown, label: string) {
    const fromSource = suggestion[key];
    if (fromSource != null) return fromSource;
    assumptions.push(label);
    return value;
  }

  const asWeekday = (date: string) => new Date(date + "T00:00:00Z").getUTCDay() || 7;
  const fixedDate = idea.date_debut && (!idea.date_fin || idea.date_debut === idea.date_fin) ? idea.date_debut : null;
  const weekend = suggestion.weekend === true || (suggestion.weekend == null && !fixedDate && idea.format === "week_end");
  const proposedDays = Array.isArray(suggestion.jours) ? suggestion.jours : null;

  // Un événement daté et un horaire de week-end incompatible ne peuvent pas être planifiés automatiquement.
  if ((fixedDate && proposedDays && !proposedDays.includes(asWeekday(fixedDate)))
      || (weekend && proposedDays && !proposedDays.includes(6))
      || (weekend && fixedDate && asWeekday(fixedDate) !== 6)) return null;

  let days = proposedDays;
  if (weekend) days = [6];
  else if (fixedDate) days = [asWeekday(fixedDate)];
  else if (!days && idea.date_debut && idea.date_fin) {
    days = [];
    const first = Date.parse(idea.date_debut), last = Date.parse(idea.date_fin);
    for (let day = first; day <= last && day < first + 7 * DAY; day += DAY) {
      days.push(new Date(day).getUTCDay() || 7);
    }
    assumptions.push("jours déduits de la période annoncée");
  } else if (!days) {
    days = [6, 7];
    assumptions.push("samedi et dimanche");
  }

  const settings = {
    ...suggestion,
    jours: days,
    weekend,
    duree_minutes: fallback("duree_minutes", 180, "3 h d’activité"),
    heure_activite: fallback("heure_activite", "10:00", "début à 10 h"),
    aller_minutes: trip?.aller_minutes ?? null,
    retour_minutes: trip?.retour_minutes ?? null,
  };
  if (weekend) {
    Object.assign(settings, {
      vendredi_soir: suggestion.vendredi_soir === true,
      retour_decalage: fallback("retour_decalage", 1, "retour le dimanche"),
      heure_retour: fallback("heure_retour", "17:00", "départ pour le retour à 17 h"),
    });
    if (suggestion.vendredi_soir === true) {
      Object.assign(settings, { heure_vendredi: fallback("heure_vendredi", "18:00", "départ le vendredi à 18 h") });
    }
  }
  return { ...settings, hypotheses: assumptions, ...(trip ? { source_trajets: "google_maps" } : {}) };
}
