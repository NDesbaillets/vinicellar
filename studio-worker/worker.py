"""Worker durable : traitement hors Edge Functions, aucune entrée HTTP publique.

Ne démarrer qu'après validation du SQL et de l'environnement ciblé.
Secrets uniquement côté serveur ; aucune clé dans les arguments de commande.
"""
import hashlib
import json
import os
import time
import urllib.request
import urllib.parse
from processor import process, ProcessingError

class Worker:
    def __init__(self,url,key):
        parsed=urllib.parse.urlparse(url)
        if parsed.scheme != "https" or not parsed.hostname or not parsed.hostname.endswith(".supabase.co"):
            raise ValueError("URL Supabase HTTPS explicite requise.")
        if not key: raise ValueError("Clé serveur absente.")
        self.url=url.rstrip("/"); self.key=key

    def request(self,path,body=None,content_type="application/json"):
        data=json.dumps(body).encode() if body is not None and content_type=="application/json" else body
        headers={"apikey":self.key,"Authorization":"Bearer "+self.key,"Content-Type":content_type}
        req=urllib.request.Request(self.url+path,data=data,headers=headers,method="POST" if body is not None else "GET")
        with urllib.request.urlopen(req,timeout=40) as res:
            result=res.read(9*1024*1024)
        return json.loads(result) if content_type=="application/json" and result else result

    def rpc(self,name,args): return self.request("/rest/v1/rpc/"+name,args)

    def once(self):
        jobs=self.rpc("studio_claim_job",{})
        if not jobs: return False
        job=jobs[0]; assets=[]; errors={}; source_bytes={}
        lease={"p_job":job["id"],"p_lease":job["lease_token"]}
        try:
            for kind,path in job["sources"].items():
                if ".." in path or ":" in path or "\\" in path: raise ProcessingError("Chemin source invalide.")
                data=self.request("/storage/v1/object/authenticated/labels/"+urllib.parse.quote(path,safe="/"),content_type="image/png")
                if hashlib.sha256(data).hexdigest()!=job["source_hashes"][kind]: raise ProcessingError("La photo source a changé. Relancez Studio.")
                source_bytes[kind]=data
            for kind in job["outputs"]:
                self.rpc("studio_progress",{**lease,"p_stage":kind})
                try:
                    data,metadata=process(kind,source_bytes,job["settings"])
                    path="/".join([job["collection_id"],job["item_id"],job["id"],job["lease_token"],kind+".png"])
                    self.request("/storage/v1/object/studio-candidates/"+path,data,"image/png")
                    assets.append({"kind":kind,"candidate_path":path,**metadata})
                except ProcessingError as exc:
                    errors[kind]=str(exc)
            self.rpc("studio_progress",{**lease,"p_stage":"checks"})
            self.rpc("studio_finish_job",{**lease,"p_assets":assets,"p_errors":errors})
        except ProcessingError as exc:
            self.rpc("studio_finish_job",{**lease,"p_assets":[],"p_errors":{"system":str(exc)}})
        # Les erreurs réseau inattendues laissent expirer le bail : reprise limitée à trois essais.
        return True

if __name__=="__main__":
    if os.environ.get("STUDIO_ENABLED")!="true": raise SystemExit("Worker désactivé. Aucun traitement lancé.")
    worker=Worker(os.environ.get("SUPABASE_URL",""),os.environ.get("SUPABASE_SERVICE_ROLE_KEY",""))
    while True:
        try:
            if not worker.once(): time.sleep(5)
        except Exception as exc:
            # Ne jamais journaliser secrets, photos, URL signées ou détails de réponse.
            print("Studio : interruption temporaire",type(exc).__name__,flush=True); time.sleep(5)
