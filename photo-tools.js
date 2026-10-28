/* Reuses the private prototype's photo pipeline. Only resized JPEGs leave the device. */
(() => {
 let converterPromise;
 function heicConverter(){
  if(window.heic2any)return Promise.resolve(window.heic2any);
  if(!converterPromise)converterPromise=new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src='/vendor/heic2any.min.js';
   script.onload=()=>resolve(window.heic2any);script.onerror=()=>{converterPromise=null;script.remove();reject(Error('Could not load the iPhone photo converter. Please retry.'));};
   document.head.append(script);
  });return converterPromise;
 }
 async function decode(blob){
  const url=URL.createObjectURL(blob),img=new Image();
  try{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('Photo could not be read.'));img.src=url;});return img;}
  finally{URL.revokeObjectURL(url);}
 }
 async function prepare(file){
  if(!file.size||file.size>25*1024*1024)throw Error('Choose photos up to 25 MB each.');
  const heic=/image\/hei[cf]/i.test(file.type)||/\.hei[cf]$/i.test(file.name);
  if(!heic&&!['image/jpeg','image/png','image/webp'].includes(file.type)&&!(!file.type&&/\.(jpe?g|png|webp)$/i.test(file.name)))throw Error('Choose JPG, PNG, WebP or iPhone HEIC photos.');
  let image;
  try{image=await decode(file);}catch{
   if(!heic)throw Error('This photo could not be read. Choose another JPG, PNG or WebP.');
   try{const convert=await heicConverter();let jpg=await convert({blob:file,toType:'image/jpeg',quality:0.85});if(Array.isArray(jpg))jpg=jpg[0];image=await decode(jpg);}
   catch{throw Error('This iPhone photo could not be converted. Export it as JPG or choose another photo.');}
  }
  const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  const context=canvas.getContext('2d');if(!context)throw Error('Photo resizing is unavailable in this browser.');
  context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.82));
  if(!blob||blob.size>2*1024*1024)throw Error('Photo could not be resized. Choose another photo.');
  return new File([blob],file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg',lastModified:file.lastModified});
 }
 window.WheelSwapPhotos={prepare};
})();
