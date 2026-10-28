const {test}=require('node:test');
const assert=require('node:assert/strict');
const {publish}=require('../listing-uploads');
const user={id:'11111111-1111-4111-8111-111111111111',email_confirmed_at:'2026-10-27'};
const values={title:'24x12 TIS wheels',seller:'QA Seller',email:'qa@example.test',public_contact:true,price:2400,size:'24',width:'12',bolt:'8x170',city:'Anniston',state:'AL',zip:'36206',condition:'Used - Good',delivery:'both'};
function fixture(){
 const tables={profiles:[],listings:[],listing_photos:[]},objects=new Map();
 const state={uploadCalls:0,failUpload:0,loseListingResponse:false,losePhotoResponse:false,publishCalls:0};
 const client={from(table){
  let operation='select',payload,filters=[],mode='all';
  const query={select(){return query},eq(key,value){filters.push([key,value]);return query},insert(value){operation='insert';payload=value;return query},upsert(value){operation='upsert';payload=value;return query},update(value){operation='update';payload=value;return query},single(){mode='one';return query},maybeSingle(){mode='maybe';return query},then(resolve,reject){return Promise.resolve().then(()=>{
   const rows=tables[table],matches=rows.filter(row=>filters.every(([key,value])=>row[key]===value));let output=matches;
   if(operation==='insert'||operation==='upsert'){
    const existing=payload.id&&rows.find(row=>row.id===payload.id);
    if(existing&&operation==='insert')return {data:null,error:{code:'23505',message:'Duplicate ID'}};
    if(existing)Object.assign(existing,payload);else rows.push({...payload});output=[existing||rows.at(-1)];
    if(table==='listings'&&state.loseListingResponse){state.loseListingResponse=false;return {error:{message:'Connection lost after insert'}};}
    if(table==='listing_photos'&&state.losePhotoResponse){state.losePhotoResponse=false;return {error:{message:'Connection lost after photo insert'}};}
   }else if(operation==='update'){for(const row of matches)Object.assign(row,payload);}
   if(mode==='one'&&output.length!==1)return {error:{message:'Row not found'}};
   return {data:mode==='all'?output:output[0]||null,error:null};
  }).then(resolve,reject)}};
  return query;
 },storage:{from(){return {async upload(path,file){state.uploadCalls++;if(state.failUpload===state.uploadCalls)return {error:{message:'Upload interrupted'}};objects.set(path,new Uint8Array(await file.arrayBuffer()));return {data:{path}};}}}}};
 const draft={id:crypto.randomUUID(),userId:user.id,saved:false,photos:[]};
 const files=[1,2].map(n=>new Blob([Uint8Array.from([255,216,255,n])],{type:'image/jpeg'}));
 const run=()=>publish({client,user,values,files,draft,publishAccess:async id=>{state.publishCalls++;assert.equal(tables.listing_photos.length,files.length);for(const photo of tables.listing_photos)assert.ok(objects.has(photo.storage_path));tables.listings.find(row=>row.id===id).status='active';}});
 return {tables,objects,state,draft,files,run,client};
}
test('publish persists both photos in order before making the listing visible',async()=>{
 const f=fixture(),id=await f.run();assert.equal(id,f.draft.id);assert.equal(f.tables.listings.length,1);assert.equal(f.tables.listings[0].seller_id,user.id);assert.equal(f.tables.listings[0].status,'active');assert.deepEqual(f.tables.listing_photos.map(p=>p.sort_order),[0,1]);assert.equal(f.objects.size,2);
});
test('interrupted second upload resumes without duplicating listing or first photo',async()=>{
 const f=fixture();f.state.failUpload=2;await assert.rejects(f.run(),/Upload interrupted/);assert.equal(f.tables.listings[0].status,'hidden');assert.equal(f.state.publishCalls,0);assert.equal(f.objects.size,1);
 await f.run();assert.equal(f.tables.listings.length,1);assert.equal(f.tables.listing_photos.length,2);assert.equal(f.objects.size,2);assert.equal(f.state.uploadCalls,3);
});
test('lost photo metadata response is recovered without duplicate rows or uploads',async()=>{
 const f=fixture();f.state.losePhotoResponse=true;await assert.rejects(f.run());await f.run();assert.equal(f.tables.listing_photos.length,2);assert.equal(f.state.uploadCalls,2);
});
test('lost create response retries the same hidden listing ID',async()=>{
 const f=fixture();f.state.loseListingResponse=true;await assert.rejects(f.run());await f.run();assert.equal(f.tables.listings.length,1);assert.equal(f.tables.listings[0].status,'active');
});
test('lost publish response does not republish or overwrite an active listing',async()=>{
 const f=fixture();await f.run();const calls=f.state.publishCalls;await f.run();assert.equal(f.state.publishCalls,calls);assert.equal(f.objects.size,2);
});
test('unverified sellers, account switches, oversized and unsupported photos cannot write',async()=>{
 const f=fixture(),base={client:f.client,user,values,files:f.files,draft:f.draft,publishAccess:()=>{throw Error('Must not publish')}};
 await assert.rejects(publish({...base,user:{...user,email_confirmed_at:null}}),/verified/);
 await assert.rejects(publish({...base,draft:{...f.draft,userId:'other-user'}}),/account/);
 await assert.rejects(publish({...base,files:[{type:'image/jpeg',size:7*1024*1024}]}),/resizing/);
 await assert.rejects(publish({...base,files:[new Blob(['bad'],{type:'text/plain'})]}),/supported/);
 assert.equal(f.tables.listings.length,0);assert.equal(f.objects.size,0);
});
const {edit}=require('../listing-uploads');
test('seller edits existing fields and appends photos without resetting status, charging or duplicating listing',async()=>{
 const f=fixture();await f.run();const row=f.tables.listings[0];row.availability='pending';const draft={id:row.id,userId:user.id,photos:[]};
 await edit({client:f.client,user,values:{...values,title:'Updated TIS wheels',price:2000},files:[f.files[0]],draft});
 assert.equal(f.tables.listings.length,1);assert.equal(row.title,'Updated TIS wheels');assert.equal(row.price,2000);assert.equal(row.status,'active');assert.equal(row.availability,'pending');assert.equal(f.tables.listing_photos.length,3);assert.equal(f.tables.listing_photos[2].sort_order,2);assert.equal(f.state.publishCalls,1);
});
test('editing with no added photos preserves every original image',async()=>{
 const f=fixture();await f.run();const before=structuredClone(f.tables.listing_photos),draft={id:f.draft.id,userId:user.id,photos:[]};
 await edit({client:f.client,user,values,files:[],draft});assert.deepEqual(f.tables.listing_photos,before);assert.equal(f.state.uploadCalls,2);
});
test('editing retries interrupted photo append without duplicate uploads or metadata',async()=>{
 const f=fixture();await f.run();f.state.failUpload=4;const draft={id:f.draft.id,userId:user.id,photos:[]},args={client:f.client,user,values,files:f.files,draft};
 await assert.rejects(edit(args),/interrupted/);await edit(args);assert.equal(f.tables.listing_photos.length,4);assert.equal(f.state.uploadCalls,5);assert.deepEqual(f.tables.listing_photos.map(p=>p.sort_order),[0,1,2,3]);
});
test('other sellers cannot edit details or append photos; total image cap is enforced',async()=>{
 const f=fixture();await f.run();const draft={id:f.draft.id,userId:user.id,photos:[]};
 await assert.rejects(edit({client:f.client,user:{...user,id:'another'},values,files:f.files,draft}),/account/);
 await assert.rejects(edit({client:f.client,user:{...user,id:'another'},values,files:f.files,draft:{...draft,userId:'another'}}),/Row not found/);
 await assert.rejects(edit({client:f.client,user,values,files:Array(9).fill(f.files[0]),draft}),/10 photos/);assert.equal(f.state.uploadCalls,2);
});
