/* Public listing images only. Originals remain available if resizing fails. */
function listingImageURL(source,width=640){
 try{
  const url=new URL(source);
  if(url.origin!=='https://gjlmnoyznepvuvzvkjqn.supabase.co'||!url.pathname.startsWith('/storage/v1/object/public/listing-images/')||url.search)return source;
  if(![160,640,1600].includes(width))width=640;
  return '/_vercel/image?url='+encodeURIComponent(url.href)+'&w='+width+'&q=75';
 }catch{return source;}
}
document.addEventListener('error',event=>{
 const img=event.target;
 if(img.tagName!=='IMG'||!img.dataset.original)return;
 const original=img.dataset.original;delete img.dataset.original;
 img.removeAttribute('srcset');img.src=original;
},true);

/* Decode before creating the listing so a bad image cannot leave a partial draft. */
async function compressListingPhoto(file){
 const objectURL=URL.createObjectURL(file),img=new Image();
 try{
  await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('This photo could not be read. Choose a different JPG, PNG, or WebP.'));img.src=objectURL;});
  const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Photo processing is unavailable. Please try another browser.');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.8));
  if(!blob)throw Error('Photo processing failed. Please try another photo.');
  // Keep already small files when re-encoding would make them larger.
  return blob.size<file.size?blob:file;
 }finally{URL.revokeObjectURL(objectURL);}
}
