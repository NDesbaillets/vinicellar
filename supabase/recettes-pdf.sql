-- ARÔMES V&N · import « Photo ou PDF » : le bucket privé « recipes » accepte aussi les PDF (≤ 8 Mo, limite inchangée).
-- Rejouable. Ne touche qu'au bucket « recipes » (propre à ARÔMES). Chemins inchangés : <book_id>/imports/<id>/<n>.pdf,
-- copiés par recipe-import vers <book_id>/<recipe_id>/page-<n>.pdf (recipe_photos.kind = 'page', jamais publique).
update storage.buckets
   set allowed_mime_types = array['image/jpeg','image/png','image/webp','image/avif','image/gif','application/pdf']
 where id = 'recipes';
