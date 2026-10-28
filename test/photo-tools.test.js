const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
function pipeline({corrupt=false}={}){
 const objects=new Map(),canvases=[];let conversions=0;
 const window={heic2any:async()=>{conversions++;return new Blob(['converted'],{type:'image/jpeg'})}};
 class ImageFixture{
  naturalWidth=4000;naturalHeight=3000;
  set src(url){queueMicrotask(()=>{const blob=objects.get(url);if(corrupt||blob.type==='image/heic')this.onerror();else this.onload();});}
 }
 const document={createElement(tag){assert.equal(tag,'canvas');const canvas={getContext(){return {fillRect(){},drawImage(){}}},toBlob(callback,type){assert.equal(type,'image/jpeg');callback(new Blob([Uint8Array.from([255,216,255])],{type}));}};canvases.push(canvas);return canvas;}};
 vm.runInNewContext(readFileSync(require.resolve('../photo-tools.js'),'utf8'),{window,document,File,Blob,Image:ImageFixture,URL:{createObjectURL(blob){const key=String(objects.size);objects.set(key,blob);return key},revokeObjectURL(url){objects.delete(url)}}});
 return {prepare:window.WheelSwapPhotos.prepare,canvases,objects,conversions:()=>conversions};
}
test('a phone JPEG over the old 6 MB limit reaches resizing and preserves aspect ratio',async()=>{
 const f=pipeline(),file=new File([new Uint8Array(7*1024*1024)],'phone.jpg',{type:'image/jpeg'}),output=await f.prepare(file);
 assert.equal(output.type,'image/jpeg');assert.ok(output.size<2*1024*1024);assert.equal(f.canvases[0].width,1600);assert.equal(f.canvases[0].height,1200);assert.equal(f.objects.size,0);
});
test('HEIC falls back to the converter and produces the supported JPEG upload type',async()=>{
 const f=pipeline(),output=await f.prepare(new File(['heic'],'iphone.heic',{type:'image/heic'}));assert.equal(f.conversions(),1);assert.equal(output.type,'image/jpeg');assert.equal(output.name,'iphone.jpg');
});
test('empty, oversized, unsupported and unreadable inputs fail before publication',async()=>{
 const f=pipeline();await assert.rejects(f.prepare(new File([],'empty.jpg',{type:'image/jpeg'})),/25 MB/);
 await assert.rejects(f.prepare({size:26*1024*1024}),/25 MB/);
 await assert.rejects(f.prepare(new File(['bad'],'file.svg',{type:'image/svg+xml'})),/Choose JPG/);
 const broken=pipeline({corrupt:true});await assert.rejects(broken.prepare(new File(['bad'],'broken.jpg',{type:'image/jpeg'})),/could not be read/);assert.equal(broken.objects.size,0);
});
