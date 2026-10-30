/* Resumable publishing. The browser key and the current seller's RLS remain in force. */
(function(root){
 const checked=result=>{if(result.error)throw Object.assign(Error(result.error.message),result.error);return result.data;};
 function listingRow(user,values,id){return {id,seller_id:user.id,seller_name:values.seller.trim(),contact_email:values.email.trim(),title:values.title,price:Number(values.price),wheel_diameter:values.category==='tires'?null:(Number(values.size)||null),wheel_width:values.category==='tires'?null:(Number(values.width)||null),bolt_pattern:values.category==='tires'?null:(values.bolt||null),tire_size:values.category==='wheels'?null:(values.tire_size||null),brand:values.brand||null,city:values.city,state:values.state,zip_code:values.zip,description:values.description||'',condition:({'Like New':'like_new','Used - Fair':'fair','Used - Good':'good'})[values.condition]||'good',category:['wheels','tires','wheel_tire_package'].includes(values.category)?values.category:'wheels',pickup_available:values.delivery!=='shipping',shipping_available:values.delivery!=='pickup',trades_accepted:!!values.trade,status:'hidden'};}
 async function publish({client,user,values,files,draft,publishAccess,progress=()=>{}}){
  if(!user?.email_confirmed_at)throw Error('Sign in with a verified email first.');
  if(!values.public_contact||!values.email?.trim()||!values.seller?.trim())throw Error('Enter your public seller name and contact email and agree to share them.');
  if(draft.userId!==user.id)throw Error('Use the account that started this draft.');
  if(files.length>10)throw Error('Choose up to 10 photos.');
  for(const file of files)if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>6*1024*1024)throw Error('Choose supported photos under 6 MB after resizing.');
  const id=draft.id,row=listingRow(user,values,id);
  progress('Saving your listing…');
  checked(await client.from('profiles').upsert({id:user.id,display_name:values.seller.trim()},{onConflict:'id'}));
  if(!draft.saved){
   const result=await client.from('listings').insert(row);
   if(result.error){
    if(result.error.code!=='23505')throw result.error;
    const existing=checked(await client.from('listings').select('id,status').eq('id',id).eq('seller_id',user.id).single());
    if(existing.status==='active')return id;
    if(existing.status!=='hidden')throw Error('This draft is no longer available for publishing.');
   }
   draft.saved=true;
  }
  // A previous publish request may have succeeded before its response was lost.
  const current=checked(await client.from('listings').select('id,status').eq('id',id).eq('seller_id',user.id).single());
  if(current.status==='active')return id;
  if(current.status!=='hidden')throw Error('This draft is no longer available for publishing.');
  checked(await client.from('listings').update(row).eq('id',id).eq('seller_id',user.id).eq('status','hidden').select().single());
  for(const [index,file] of files.entries()){
   progress('Uploading photo '+(index+1)+' of '+files.length+'…');
   let uploaded=draft.photos[index];
   if(!uploaded){
    const path=`${user.id}/${id}/${crypto.randomUUID()}.${file.type.split('/')[1]}`;
    checked(await client.storage.from('listing-images').upload(path,file,{contentType:file.type,cacheControl:'31536000'}));
    uploaded=draft.photos[index]={path,linked:false};
   }
   if(!uploaded.linked){
    const previous=checked(await client.from('listing_photos').select('storage_path').eq('listing_id',id).eq('storage_path',uploaded.path).maybeSingle());
    if(!previous)checked(await client.from('listing_photos').insert({listing_id:id,storage_path:uploaded.path,sort_order:index}));
    uploaded.linked=true;
   }
  }
  progress('Publishing your listing…');await publishAccess(id);return id;
 }

 async function edit({client,user,values,files,draft,progress=()=>{}}){
  if(!user?.email_confirmed_at)throw Error('Sign in with a verified email first.');
  if(draft.userId!==user.id)throw Error('Use the account that owns this listing.');
  if(!values.public_contact||!values.email?.trim()||!values.seller?.trim())throw Error('Enter your public seller name and contact email and agree to share them.');
  for(const file of files)if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>6*1024*1024)throw Error('Choose supported photos under 6 MB after resizing.');
  const id=draft.id;
  checked(await client.from('listings').select('id,seller_id,status').eq('id',id).eq('seller_id',user.id).single());
  const existing=checked(await client.from('listing_photos').select('storage_path,sort_order').eq('listing_id',id))||[];
  const known=new Set(draft.photos.filter(Boolean).map(photo=>photo.path));
  if(existing.filter(photo=>!known.has(photo.storage_path)).length+files.length>10)throw Error('A listing can have up to 10 photos including existing photos.');
  if(draft.offset==null)draft.offset=existing.reduce((max,photo)=>Math.max(max,photo.sort_order),-1)+1;
  const row=listingRow(user,values,id);delete row.id;delete row.seller_id;delete row.status;
  progress('Saving listing details…');
  checked(await client.from('listings').update(row).eq('id',id).eq('seller_id',user.id).select().single());
  for(const [index,file] of files.entries()){
   draft.started=true;progress('Adding photo '+(index+1)+' of '+files.length+'…');
   let uploaded=draft.photos[index];
   if(!uploaded){
    const path=`${user.id}/${id}/${crypto.randomUUID()}.jpg`;
    checked(await client.storage.from('listing-images').upload(path,file,{contentType:file.type,cacheControl:'31536000'}));
    uploaded=draft.photos[index]={path,linked:false};
   }
   if(!uploaded.linked){
    const previous=checked(await client.from('listing_photos').select('storage_path').eq('listing_id',id).eq('storage_path',uploaded.path).maybeSingle());
    if(!previous)checked(await client.from('listing_photos').insert({listing_id:id,storage_path:uploaded.path,sort_order:draft.offset+index}));
    uploaded.linked=true;
   }
  }
  return id;
 }
 const api={publish,edit};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WheelSwapListingUploads=api;
})(globalThis);
