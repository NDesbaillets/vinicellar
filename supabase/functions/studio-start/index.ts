import { endpoint, session, reply } from "../_shared/studio-http.ts";
import { normalizeRequest, checkSources, digest, fingerprint, StudioError } from "../_shared/studio-contract.mjs";

Deno.serve(endpoint(async req => {
  const { userClient, admin, user } = await session(req);
  const raw = await req.text();
  if (raw.length > 16000) throw new StudioError("Demande trop volumineuse.", 413);
  const request = normalizeRequest(JSON.parse(raw));
  const { data: item } = await userClient.from("items").select("*").eq("id", request.item_id).single();
  if (!item) throw new StudioError("Fiche introuvable.", 404);
  const { data: canEdit } = await userClient.rpc("can_edit", { c: item.collection_id });
  if (!canEdit) throw new StudioError("Accès en lecture seule.", 403);
  checkSources(item, request.sources);
  const hashes: Record<string, string> = {};
  for (const [kind, path] of Object.entries(request.sources)) {
    // Lecture avec le JWT utilisateur : le rôle serveur ne sert pas d'oracle de téléchargement.
    const { data: file, error } = await userClient.storage.from("labels").download(path as string);
    if (error || !file) throw new StudioError("Photo inaccessible.", 403);
    if (file.size > 8 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new StudioError("Utilisez une photo JPEG, PNG ou WebP de moins de 8 Mo.");
    hashes[kind] = await digest(await file.arrayBuffer());
  }
  const { data, error } = await admin.rpc("studio_enqueue", { p_user: user.id, p_item: item.id, p_request: request.request_key, p_fingerprint: await fingerprint(request, hashes), p_outputs: request.outputs, p_sources: request.sources, p_hashes: hashes, p_settings: request.settings, p_force: request.force });
  if (error) throw new StudioError("Création impossible : droits modifiés, quota atteint ou demande invalide.", 409);
  return reply(req, { job: data }, 202);
}));
