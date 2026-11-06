import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {normalizeRequest,checkSources,fingerprint} from '../supabase/functions/_shared/studio-contract.mjs';
const id='12345678-1234-4234-8234-123456789abc';
const base=()=>({confirmed:true,item_id:id,request_key:id,outputs:['label','bottle'],sources:{label:'u/label.jpg',bottle:'u/bottle.jpg'},settings:{mode:'cutout',full_bottle:true,label_is_crop:true}});
test('aucune génération sans confirmation et paramètres valides',()=>{
 for (const b of [{...base(),confirmed:false},{...base(),item_id:'------------------------------------'},{...base(),outputs:'label'},{...base(),outputs:['bad']},{...base(),settings:{full_bottle:false}},{...base(),settings:{full_bottle:true}}]) assert.throws(()=>normalizeRequest(b));
 assert.deepEqual(normalizeRequest(base()).outputs,['bottle','label']);
 assert.throws(()=>normalizeRequest({...base(),settings:{...base().settings,corners:[[0,0],[1,0],[NaN,1],[0,1]]}}));
});
test('reconstitution : caractéristiques confirmées et photo d’étiquette obligatoires',()=>{
 const b=base(); b.outputs=['bottle'];b.settings={mode:'reconstructed',template:'bordeaux',glass:'green',confirmed_shape:true,label_is_crop:true};
 assert.deepEqual(normalizeRequest(b).sources,{label:'u/label.jpg'});
 for(const key of ['template','glass','confirmed_shape']) assert.throws(()=>normalizeRequest({...b,settings:{...b.settings,[key]:null}}));
});
test('sources : uniquement les originaux rattachés et accessibles à la collection',()=>{
 const it={label_path:'u/label.jpg',photo_paths:['u/../secret.jpg']};
 checkSources(it,{label:'u/label.jpg'},['u']);
 for(const p of ['u/detached.jpg','other/secret.jpg','u/../secret.jpg',null]) assert.throws(()=>checkSources(it,{label:p},['u']));
});
test('cache canonique : mêmes entrées, même empreinte ; contenu, options et version distincts',async()=>{
 const a=normalizeRequest(base()), b=normalizeRequest({...base(),outputs:['bottle','label'],settings:{label_is_crop:true,full_bottle:true,mode:'cutout'}});
 const hashes={label:'a',bottle:'b'}, h=await fingerprint(a,hashes);
 assert.equal(h,await fingerprint(b,{bottle:'b',label:'a'}));
 for(const req of [{...a,pipeline:'v2'},{...a,item_id:id.replace('abc','abd')},{...a,settings:{...a.settings,outline:[[0,0],[1,0],[.5,1]]}}]) assert.notEqual(h,await fingerprint(req,hashes));
 assert.notEqual(h,await fingerprint(a,{...hashes,bottle:'modified'}));
});
function studio(enabled,rows=[]) {
 const calls=[],sheets=[];
 const query={select(){return this;},in(){return this;},eq(){return this;},then(resolve){return Promise.resolve({data:rows}).then(resolve);}};
 const VC={cfg:{studioEnabled:enabled},sb:{from:t=>{calls.push(t);return query;}},sheet:h=>{sheets.push(h);return {};},I:{},esc:String};
 vm.runInNewContext(fs.readFileSync('assets/js/studio.js','utf8'),{window:{VC},URL,Blob});
 return {VC,calls,sheets};
}
test('feature désactivée : aucun accès aux nouvelles tables et aucune proposition',async()=>{
 const {VC,calls,sheets}=studio(false);await VC.Studio.loadActive([{id}]);VC.Studio.offer(id);
 assert.equal(calls.length,0);assert.equal(sheets.length,0);
});
test('seuls les actifs approuvés sont rendus ; lecture groupée sans altérer les fiches',async()=>{
 const rows=[{item_id:id,kind:'bottle',decision:'pending',active:true,approved_path:'bad'},{item_id:id,kind:'label',decision:'approved',active:true,approved_path:'good'}];
 const {VC,calls}=studio(true,rows),item={id,label_path:'original'},before=JSON.stringify(item);
 await VC.Studio.loadActive([item]);assert.equal(calls.length,1);assert.equal(VC.Studio.asset(item,'bottle'),null);
 assert.equal(VC.Studio.ref(VC.Studio.asset(item,'label')),'studio-approved:good');
 assert.equal(VC.Studio.ref({...rows[1],active:false}),null);assert.equal(JSON.stringify(item),before);
});
test('proposition après ajout : lien de configuration et Plus tard, sans appel de génération',()=>{
 const {VC,calls,sheets}=studio(true);VC.Studio.offer(id);
 assert.match(sheets[0],/Créer les visuels Studio Vinicellar/);assert.match(sheets[0],/Plus tard/);assert.match(sheets[0],/studio.html\?id=/);assert.equal(calls.length,0);
});
