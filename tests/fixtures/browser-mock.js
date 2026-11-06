// QA isolée : aucune connexion Supabase et aucune donnée personnelle.
(() => {
  // Le serveur de prévisualisation utilise HTTP ; UUID de test uniquement.
  if (!crypto.randomUUID) crypto.randomUUID = () => 'demo-' + Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('-');
  const q = new URLSearchParams(location.search), role = q.get('role') || 'owner';
  const profile = { id:'demo', first_name:'Camille', full_name:'Camille Martin', currency:'CHF', onboarded_at:'2026-01-01' };
  const names = [ ['Les Terrasses','Domaine des Rives','white','Lavaux',2023,24], ['Pinot Noir Réserve','Cave du Vallon','red','Valais',2021,38], ['Brut Nature','Maison des Coteaux','sparkling','Champagne',2019,62], ['Chasselas Vieilles Vignes','Domaine du Lac','white','Lavaux',2024,19], ['Syrah Les Roches','Cave des Hauts','red','Valais',2020,45], ['Rosé des Vignes','Domaine de la Colline','rose','Provence',2024,22], ['Assemblage du Terroir','Les Vignerons Réunis','red','Vaud',2022,29], ['Blanc de Noirs','Maison du Levant','sparkling','Champagne',2020,58], ['Dézaley Grand Cru','Domaine des Terrasses','white','Lavaux',2022,36], ['La Cuvée des Amis','Cave de la Rive','red','Bourgogne',2018,71] ];
  const items = names.map(([name,producer,style,region,vintage,market_price],i)=>({ id:'wine-'+i, collection_id:'family', name, producer, style, region, vintage, category:'wine', country: region==='Champagne'||region==='Provence'||region==='Bourgogne'?'France':'Suisse', grapes:[style==='white'?'Chasselas':'Pinot noir'], market_price, market_currency:'CHF', created_at:'2026-10-'+String(20+i).padStart(2,'0'), volume_cl:75, abv:13, drink_from:2025, drink_to:i===1?2026:2030, peak_from:2025, peak_to:2028, description:'Une cuvée de caractère, à découvrir autour d’une table entre amis.', terroir:'Vignes en terrasses, sols calcaires et exposition au lac.', pairings:['Poisson du lac','Fromages affinés'], photo_paths:[], label_path:i===3?'label-demo':null, bottle_path:i===3?null:'bottle-'+i, serving_temp_min:10, serving_temp_max:12, notes:'Données fictives pour la revue de l’interface.' }));
  const tables = {profiles:[profile], collection_members:[{collection_id:'family',user_id:'demo',role}], items:q.get('empty')?[]:items, locations:[{id:'home',collection_id:'family',name:'Cave de Lausanne',kind:'home',position:0,collections:{id:'family',name:'Cave familiale'}} ,{id:'chalet',collection_id:'family',name:'Chalet',kind:'secondary',position:1,collections:{id:'family',name:'Cave familiale'}}], stock:items.map((it,i)=>({item_id:it.id,location_id:'home',quantity:i===9?0:2+i%5,bin:'A'+i})), tastings:[], drafts:[], wishlists:[], wishlist_items:[], access_requests:[], ai_calls:[] };
  if (!q.has('legacy')) { items[0].label_path='studio-demo-label.png'; items[0].bottle_path='studio-demo-bottle.png'; }
  tables.studio_jobs=[];tables.studio_assets=[];tables.qa_uploads={};
  const saved=sessionStorage.getItem('vinicellar-studio-qa-v1');
  if (saved && !q.has('reset')) { try { Object.assign(tables,JSON.parse(saved).tables); } catch {} }
  tables.collection_members.forEach(m=>m.role=role);
  const calls=saved && !q.has('reset') ? JSON.parse(saved).calls || [] : [];
  const report=()=>{sessionStorage.setItem('vinicellar-studio-qa-v1',JSON.stringify({tables,calls}));let el=document.getElementById('qa-studio-counts');if(!el){el=document.createElement('p');el.id='qa-studio-counts';el.style='font:11px Inter,sans-serif;color:var(--ink-2);padding:10px 20px;margin:0 0 70px';document.body.append(el);}el.textContent=`Simulation locale · créations : ${calls.filter(x=>x.fn==='studio-start').length} · décisions : ${calls.filter(x=>x.fn==='studio-review').length} · sauvegardes : ${calls.filter(x=>x.rpc==='studio_save_item').length}`;};
  document.addEventListener('DOMContentLoaded',report);
  const finish=(job)=>{job.status='ready';job.stage='done';for(const kind of job.outputs) tables.studio_assets.push({id:crypto.randomUUID(),job_id:job.id,item_id:job.item_id,collection_id:'family',kind,candidate_path:`family/${job.id}/${kind}.png`,width:kind==='bottle'?1000:400,height:kind==='bottle'?1800:300,provenance:kind==='label'?'label_restored':job.settings.mode==='reconstructed'?'bottle_reconstructed':'bottle_cutout',warnings:[kind==='label'?'Correction photographique, sans réécriture.':job.settings.mode==='reconstructed'?'Reconstitution indicative : forme confirmée, capsule neutre.':'Détourage photographique. Vérifiez le contour.'],decision:'pending',active:false});report();};
  for(const job of tables.studio_jobs)if(['queued','processing'].includes(job.status))setTimeout(()=>finish(job),400);
  async function invoke(name,{body}){
    if(!['studio-start','studio-review'].includes(name))throw Error('Appels externes désactivés dans cet aperçu');
    calls.push({fn:name});
    if(name==='studio-start'){
      if(body.confirmed!==true)throw Error('Confirmation manquante');
      const job={id:crypto.randomUUID(),item_id:body.item_id,collection_id:'family',sources:body.sources,settings:body.settings,outputs:body.outputs,status:'queued',stage:'queued',errors:{},created_at:new Date().toISOString()};
      tables.studio_jobs.push(job);report();setTimeout(()=>{job.status='processing';job.stage='label';report();},300);setTimeout(()=>finish(job),1500);return {data:{job},error:null};
    }
    const a=tables.studio_assets.find(x=>x.id===body.asset_id);a.decision=body.decision;
    if(body.decision==='approved'){tables.studio_assets.filter(x=>x.item_id===a.item_id&&x.kind===a.kind).forEach(x=>x.active=false);a.active=true;a.approved_path=`family/${a.id}/${a.kind}.png`;}
    report();return {data:{asset:a},error:null};
  }
  const svg=(i,labelOnly=false)=>`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="600" viewBox="0 0 240 600"><defs><linearGradient id="glass"><stop stop-color="#26382b"/><stop offset=".3" stop-color="${i%3===0?'#667251':'#344330'}"/><stop offset=".58" stop-color="#1d2a20"/><stop offset=".78" stop-color="#3e503d"/><stop offset="1" stop-color="#152218"/></linearGradient></defs>${labelOnly?'':`<path d="M98 16h44v125c0 30 45 45 45 90v330q0 24-24 24H77q-24 0-24-24V231c0-45 45-60 45-90Z" fill="url(#glass)"/><path d="M99 18h42v95H99Z" fill="${i%2?'#743d48':'#aaa17c'}"/><path d="M66 240v310" stroke="white" stroke-width="4" opacity=".12"/>`}<rect x="${labelOnly?15:62}" y="${labelOnly?100:318}" width="${labelOnly?210:116}" height="${labelOnly?290:145}" rx="2" fill="#f6f1e4"/><text x="120" y="${labelOnly?180:355}" font-family="Georgia" text-anchor="middle" font-size="${labelOnly?16:11}" fill="#434d3b">VIN DE DÉMONSTRATION</text><path d="M96 375h48M104 383h32" stroke="#ae9b71"/><text x="120" y="${labelOnly?255:414}" font-family="Georgia" text-anchor="middle" font-size="${labelOnly?28:17}" fill="#713d47">${2020+i%5}</text></svg>`;
  const urls = new Map();
  const urlFor=(p)=>{if(tables.qa_uploads[p])return '/review/fixtures/'+tables.qa_uploads[p];if(p==='studio-demo-label.png')return '/review/fixtures/original-label.png';if(p==='studio-demo-bottle.png')return '/review/fixtures/original-bottle.png';if(p.startsWith('family/')&&p.endsWith('/label.png'))return '/review/fixtures/restored-label.png';if(p.startsWith('family/')&&p.endsWith('/bottle.png'))return '/review/fixtures/'+(tables.studio_assets.find(a=>[a.candidate_path,a.approved_path].includes(p))?.provenance==='bottle_reconstructed'?'reconstructed-bottle.png':'studio-bottle.png');if(!urls.has(p)) urls.set(p,URL.createObjectURL(new Blob([svg(Number(p.replace(/\D/g,''))||0,p==='label-demo')],{type:'image/svg+xml'})));return urls.get(p);};
  class Query {
    constructor(table){this.table=table;this.tests=[];this.op='select';}
    select(){return this;} order(k,o={}){this.sortKey=k;this.ascending=o.ascending!==false;return this;} limit(n){this.max=n;return this;}
    eq(k,v){this.tests.push(x=>x[k]===v);return this;}
    in(k,v){this.tests.push(x=>v.includes(x[k]));return this;}
    gt(k,v){this.tests.push(x=>x[k]>v);return this;} gte(){return this;}
    insert(v){this.op='insert';this.values=v;return this;}
    update(v){this.op='update';this.values=v;return this;}
    delete(){this.op='delete';return this;}
    single(){this.one=true;return this;}
    then(resolve,reject){return Promise.resolve().then(()=>{
      let rows=(tables[this.table]||[]).filter(x=>this.tests.every(f=>f(x)));
      if(this.sortKey) rows.sort((a,b)=>(String(a[this.sortKey]).localeCompare(String(b[this.sortKey])))*(this.ascending?1:-1));
      if(this.max)rows=rows.slice(0,this.max);
      if(this.op==='update'){rows.forEach(x=>Object.assign(x,this.values));calls.push({op:this.op,table:this.table,patch:this.values});}
      if(this.op==='insert'){rows=[{id:'new-'+Date.now(),created_at:new Date().toISOString(),...this.values}];tables[this.table].push(...rows);calls.push({op:this.op,table:this.table});}
      if(this.op==='delete'){tables[this.table]=(tables[this.table]||[]).filter(x=>!rows.includes(x));calls.push({op:this.op,table:this.table});}
      if(this.op!=='select')report();
      return {data:this.one?rows[0]:rows,count:rows.length,error:null};
    }).then(resolve,reject);}
  }
  const sb={ auth:{getSession:async()=>({data:{session:{user:{id:'demo',email:'demo@example.test'}}}})}, from:t=>new Query(t), storage:{from:()=>({createSignedUrls:async paths=>({data:paths.map(path=>({path,signedUrl:urlFor(path)}))}), upload:async(path,file)=>{tables.qa_uploads[path]=file.name?.includes('bottle')?'original-bottle.png':'original-label.png';report();return {error:null};}, remove:async()=>{throw Error('Suppression d’original interdite en QA');}})}, functions:{invoke}, rpc:async(name,p)=>{
    calls.push({rpc:name,args:p});
    if(name==='studio_save_item'){
      const payload=p.p_payload;const item={id:crypto.randomUUID(),collection_id:'family',photo_paths:payload.photos || [],label_path:payload.photos?.[0],...payload.data};tables.items.push(item);if(payload.qty>0)tables.stock.push({item_id:item.id,location_id:payload.location,quantity:payload.qty});report();return {data:item.id,error:null};
    }
    if(name==='studio_attach_source'){const item=tables.items.find(x=>x.id===p.p_item);item.photo_paths.push(p.p_path);report();return {data:null,error:null};}
    if(name==='my_invites')return {data:[],error:null};
    const s=tables.stock.find(x=>x.item_id===p?.p_item&&x.location_id===p?.p_location);
    if(name==='adjust_stock'&&s)s.quantity+=p.p_delta;
    if(name==='take_bottle'&&s){s.quantity--;return {data:'tasting-demo',error:null};}
    return {data:null,error:null};
  }};
  window.VC_CONFIG={supabaseUrl:'https://example.invalid',supabaseAnonKey:'demo',studioEnabled:!q.has('legacy')};
  window.supabase={createClient:()=>sb};
  window.review={tables,calls};
  if(navigator.serviceWorker)navigator.serviceWorker.register=async()=>({});
})();
