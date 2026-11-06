import { endpoint, session, reply } from "../_shared/studio-http.ts";
import { digest, StudioError } from "../_shared/studio-contract.mjs";

Deno.serve(endpoint(async req => {
  const { userClient, admin, user } = await session(req);
  const raw = await req.text();
  if (raw.length > 1000) throw new StudioError("Demande invalide.");
  const body = JSON.parse(raw);
  if (!["approved", "rejected"].includes(body.decision) || !/^[0-9a-f-]{36}$/i.test(body.asset_id || "")) throw new StudioError("Décision invalide.");
  const { data: asset } = await userClient.from("studio_assets").select("*").eq("id", body.asset_id).single();
  if (!asset) throw new StudioError("Candidat introuvable.", 404);
  const { data: editable } = await userClient.rpc("can_edit", { c: asset.collection_id });
  if (!editable) throw new StudioError("Accès en lecture seule.", 403);
  let approvedPath = null;
  if (body.decision === "approved") {
    if (asset.decision === "rejected") throw new StudioError("Ce candidat a été rejeté. Créez une nouvelle version.", 409);
    if (asset.decision === "approved") return reply(req, { asset }); // reprise idempotente, sans réactiver une ancienne version
    const { data: job } = await userClient.from("studio_jobs").select("sources,source_hashes").eq("id",asset.job_id).single();
    if (!job) throw new StudioError("Traitement inaccessible.",403);
    for (const [kind,path] of Object.entries(job.sources)) {
      const {data: original} = await userClient.storage.from("labels").download(path as string);
      if (!original || await digest(await original.arrayBuffer()) !== job.source_hashes[kind]) throw new StudioError("La photo source a changé ou est inaccessible. Préparez une nouvelle version.",409);
    }
    const { data: file, error } = await userClient.storage.from("studio-candidates").download(asset.candidate_path);
    if (error || !file || await digest(await file.arrayBuffer()) !== asset.sha256) throw new StudioError("Le fichier candidat n'a pas pu être vérifié.", 409);
    approvedPath = `${asset.collection_id}/${asset.item_id}/${asset.id}.png`;
    const { error: uploadError } = await admin.storage.from("studio-approved").upload(approvedPath, file, { contentType: "image/png", upsert: false });
    if (uploadError) {
      // Un premier appel peut avoir copié le fichier avant une coupure : vérifier avant réutilisation.
      const { data: existing } = await admin.storage.from("studio-approved").download(approvedPath);
      if (!existing || await digest(await existing.arrayBuffer()) !== asset.sha256) throw new StudioError("Copie du fichier impossible. Le visuel actif reste inchangé.", 409);
    }
  }
  const { data, error } = await admin.rpc("studio_decide_asset", { p_user: user.id, p_asset: asset.id, p_decision: body.decision, p_path: approvedPath });
  if (error) throw new StudioError("Validation impossible : décision concurrente ou droits modifiés. Rechargez la page.", 409);
  return reply(req, { asset: data });
}));
