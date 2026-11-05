// QA isolée : aucune connexion Supabase et aucune donnée personnelle.
(() => {
  // Le serveur de prévisualisation utilise HTTP ; UUID de test uniquement.
  if (!crypto.randomUUID) crypto.randomUUID = () => 'demo-' + Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('-');
  const q = new URLSearchParams(location.search), role = q.get('role') || 'owner';
  const profile = { id:'demo', first_name:'Camille', full_name:'Camille Martin', currency:'CHF', onboarded_at:'2026-01-01' };
  const names = [ ['Les Terrasses','Domaine des Rives','white','Lavaux',2023,24], ['Pinot Noir Réserve','Cave du Vallon','red','Valais',2021,38], ['Brut Nature','Maison des Coteaux','sparkling','Champagne',2019,62], ['Chasselas Vieilles Vignes','Domaine du Lac','white','Lavaux',2024,19], ['Syrah Les Roches','Cave des Hauts','red','Valais',2020,45], ['Rosé des Vignes','Domaine de la Colline','rose','Provence',2024,22], ['Assemblage du Terroir','Les Vignerons Réunis','red','Vaud',2022,29], ['Blanc de Noirs','Maison du Levant','sparkling','Champagne',2020,58], ['Dézaley Grand Cru','Domaine des Terrasses','white','Lavaux',2022,36], ['La Cuvée des Amis','Cave de la Rive','red','Bourgogne',2018,71] ];
  const items = names.map(([name,producer,style,region,vintage,market_price],i)=>({ id:'wine-'+i, collection_id:'family', name, producer, style, region, vintage, category:'wine', country: region==='Champagne'||region==='Provence'||region==='Bourgogne'?'France':'Suisse', grapes:[style==='white'?'Chasselas':'Pinot noir'], market_price, market_currency:'CHF', created_at:'2026-10-'+String(20+i).padStart(2,'0'), volume_cl:75, abv:13, drink_from:2025, drink_to:i===1?2026:2030, peak_from:2025, peak_to:2028, description:'Une cuvée de caractère, à découvrir autour d’une table entre amis.', terroir:'Vignes en terrasses, sols calcaires et exposition au lac.', pairings:['Poisson du lac','Fromages affinés'], photo_paths:[], label_path:i===3?'label-demo':null, bottle_path:i===3?null:'bottle-'+i, serving_temp_min:10, serving_temp_max:12, notes:'Données fictives pour la revue de l’interface.' }));
  const tables = {profiles:[profile], collection_members:[{collection_id:'family',user_id:'demo',role}], items:q.get('empty')?[]:items, locations:[{id:'home',collection_id:'family',name:'Cave de Lausanne',kind:'home',position:0,collections:{id:'family',name:'Cave familiale'}} ,{id:'chalet',collection_id:'family',name:'Chalet',kind:'secondary',position:1,collections:{id:'family',name:'Cave familiale'}}], stock:items.map((it,i)=>({item_id:it.id,location_id:'home',quantity:i===9?0:2+i%5,bin:'A'+i})), tastings:[], drafts:[], wishlists:[], wishlist_items:[], access_requests:[], ai_calls:[] };
  const calls=[];
  const svg=(i,labelOnly=false)=>`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="600" viewBox="0 0 240 600"><defs><linearGradient id="glass"><stop stop-color="#26382b"/><stop offset=".3" stop-color="${i%3===0?'#667251':'#344330'}"/><stop offset=".58" stop-color="#1d2a20"/><stop offset=".78" stop-color="#3e503d"/><stop offset="1" stop-color="#152218"/></linearGradient></defs>${labelOnly?'':`<path d="M98 16h44v125c0 30 45 45 45 90v330q0 24-24 24H77q-24 0-24-24V231c0-45 45-60 45-90Z" fill="url(#glass)"/><path d="M99 18h42v95H99Z" fill="${i%2?'#743d48':'#aaa17c'}"/><path d="M66 240v310" stroke="white" stroke-width="4" opacity=".12"/>`}<rect x="${labelOnly?15:62}" y="${labelOnly?100:318}" width="${labelOnly?210:116}" height="${labelOnly?290:145}" rx="2" fill="#f6f1e4"/><text x="120" y="${labelOnly?180:355}" font-family="Georgia" text-anchor="middle" font-size="${labelOnly?16:11}" fill="#434d3b">VIN DE DÉMONSTRATION</text><path d="M96 375h48M104 383h32" stroke="#ae9b71"/><text x="120" y="${labelOnly?255:414}" font-family="Georgia" text-anchor="middle" font-size="${labelOnly?28:17}" fill="#713d47">${2020+i%5}</text></svg>`;
  const urls = new Map();
  const urlFor=(p)=>{if(!urls.has(p)) urls.set(p,URL.createObjectURL(new Blob([svg(Number(p.replace(/\D/g,''))||0,p==='label-demo')],{type:'image/svg+xml'})));return urls.get(p);};
  class Query {
    constructor(table){this.table=table;this.tests=[];this.op='select';}
    select(){return this;} order(){return this;} limit(){return this;}
    eq(k,v){this.tests.push(x=>x[k]===v);return this;}
    in(k,v){this.tests.push(x=>v.includes(x[k]));return this;}
    gt(k,v){this.tests.push(x=>x[k]>v);return this;} gte(){return this;}
    insert(v){this.op='insert';this.values=v;return this;}
    update(v){this.op='update';this.values=v;return this;}
    delete(){this.op='delete';return this;}
    single(){this.one=true;return this;}
    then(resolve,reject){return Promise.resolve().then(()=>{
      let rows=(tables[this.table]||[]).filter(x=>this.tests.every(f=>f(x)));
      if(this.op==='update'){rows.forEach(x=>Object.assign(x,this.values));calls.push({op:this.op,table:this.table,patch:this.values});}
      if(this.op==='insert'){rows=[{id:'new-'+Date.now(),created_at:new Date().toISOString(),...this.values}];tables[this.table].push(...rows);calls.push({op:this.op,table:this.table});}
      if(this.op==='delete'){tables[this.table]=(tables[this.table]||[]).filter(x=>!rows.includes(x));calls.push({op:this.op,table:this.table});}
      return {data:this.one?rows[0]:rows,count:rows.length,error:null};
    }).then(resolve,reject);}
  }
  const sb={ auth:{getSession:async()=>({data:{session:{user:{id:'demo',email:'demo@example.test'}}}})}, from:t=>new Query(t), storage:{from:()=>({createSignedUrls:async paths=>({data:paths.map(path=>({path,signedUrl:urlFor(path)}))}), upload:async()=>({error:null}), remove:async()=>{throw Error('Suppression d’original interdite en QA');}})}, functions:{invoke:async()=>{throw Error('Appels IA désactivés dans cet aperçu');}}, rpc:async(name,p)=>{
    calls.push({rpc:name,args:p});
    if(name==='my_invites')return {data:[],error:null};
    const s=tables.stock.find(x=>x.item_id===p?.p_item&&x.location_id===p?.p_location);
    if(name==='adjust_stock'&&s)s.quantity+=p.p_delta;
    if(name==='take_bottle'&&s){s.quantity--;return {data:'tasting-demo',error:null};}
    return {data:null,error:null};
  }};
  window.VC_CONFIG={supabaseUrl:'https://example.invalid',supabaseAnonKey:'demo'};
  window.supabase={createClient:()=>sb};
  window.review={tables,calls};
  if(navigator.serviceWorker)navigator.serviceWorker.register=async()=>({});
})();
