const STATIC_CACHE='wheelswap-static-v1';
const STATIC_FILES=['/icon-192.png','/icon-512.png','/apple-touch-icon.png','/manifest.webmanifest'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(STATIC_CACHE).then(cache=>cache.addAll(STATIC_FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('wheelswap-static-')&&key!==STATIC_CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin)return;
 if(req.mode==='navigate'){
  event.respondWith(fetch(req).catch(()=>new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WheelSwap — Offline</title><body style="background:#101216;color:white;font:18px system-ui;padding:30px"><h1>WheelSwap</h1><p>You are offline. Reconnect to see current listings or use your account.</p><button onclick="location.reload()" style="padding:12px;background:#ff681e;border:0;border-radius:10px">Try again</button></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8'}})));return;
 }
 // Never cache account data, APIs, listing photos, or application code.
 if(STATIC_FILES.includes(url.pathname))event.respondWith(caches.match(req).then(cached=>cached||fetch(req)));
});
