// Contrat sans dépendance : partagé par les Edge Functions et les tests Node.
export const PIPELINE = "photographic-v1";
export const OUTPUTS = ["label", "bottle"];
export class StudioError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function normalizeRequest(body) {
  if (!body || body.confirmed !== true) throw new StudioError("Confirmez la création des visuels.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.item_id || "") || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.request_key || "")) throw new StudioError("Référence invalide.");
  if (!Array.isArray(body.outputs) || body.outputs.length > 2) throw new StudioError("Visuels invalides.");
  const outputs = [...new Set(body.outputs)].sort();
  if (!outputs.length || outputs.some(k => !OUTPUTS.includes(k))) throw new StudioError("Choisissez un visuel.");
  const s = body.settings || {}, sources = body.sources || {};
  if (s.mode != null && !["cutout","reconstructed"].includes(s.mode)) throw new StudioError("Méthode inconnue.");
  const settings = { mode: s.mode === "reconstructed" ? "reconstructed" : "cutout", template: s.template || "", glass: s.glass || "", confirmed_shape: s.confirmed_shape === true, full_bottle: s.full_bottle === true, label_is_crop: s.label_is_crop === true, corners: points(s.corners, 4, 4), outline: points(s.outline, 3, 64) };
  if (outputs.includes("label") && !sources.label) throw new StudioError("Photo d'étiquette requise.");
  if (outputs.includes("bottle")) {
    if (settings.mode === "cutout" && (!sources.bottle || !settings.full_bottle)) throw new StudioError("Confirmez que la photo montre la bouteille entière.");
    if (settings.mode === "reconstructed" && (!sources.label || !settings.confirmed_shape || !["bordeaux", "burgundy", "champagne"].includes(settings.template) || !["green", "brown", "clear"].includes(settings.glass))) throw new StudioError("Confirmez la forme et le verre de la reconstitution indicative.");
  }
  const needed = {};
  if (outputs.includes("label") || settings.mode === "reconstructed" && outputs.includes("bottle")) needed.label = sources.label;
  if (outputs.includes("bottle") && settings.mode === "cutout") needed.bottle = sources.bottle;
  if (needed.label && settings.corners.length !== 4 && !settings.label_is_crop) throw new StudioError("Délimitez les quatre coins ou confirmez que la photo est déjà recadrée.");
  return { item_id: body.item_id, request_key: body.request_key, outputs, sources: needed, settings, force: body.force === true, pipeline: PIPELINE };
}
function points(value, min, max) {
  if (!value || !value.length) return [];
  if (!Array.isArray(value) || value.length < min || value.length > max || value.some(p => !Array.isArray(p) || p.length !== 2 || p.some(n => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1))) throw new StudioError("Contour invalide.");
  return value;
}
export function checkSources(item, sources) {
  const paths = new Set([item.label_path, item.label_back_path, item.bottle_path, ...(item.photo_paths || [])].filter(Boolean));
  for (const path of Object.values(sources)) {
    if (typeof path !== "string" || !paths.has(path) || path.includes("..") || /[\\%:]/.test(path)) throw new StudioError("Cette photo ne peut pas être utilisée dans cette collection.", 403);
  }
}
export async function digest(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
}
export async function fingerprint(request, hashes) {
  // Ordre canonique indépendant de l'ordre des clés transmis par le navigateur.
  return digest(new TextEncoder().encode(JSON.stringify([request.pipeline, request.item_id, request.outputs, request.settings, Object.entries(hashes).sort()])));
}
