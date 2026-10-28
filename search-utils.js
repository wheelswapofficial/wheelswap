/* Shared by discovery, saved searches and tests. */
(function(root){
 const aliases={'5x4.5':'5x114.3','5x5':'5x127','5x5.5':'5x139.7','6x4.5':'6x114.3','6x5.5':'6x139.7','8x6.5':'8x165.1'};
 function bolt(value){const s=String(value||'').toLowerCase().replace(/\s/g,'').replace(/×/g,'x');return aliases[s]||s;}
 function matches(l,f){
  const q=String(f.search||'').trim().toLowerCase();
  return (!q||[l.title,l.brand,l.location,l.city,l.state,l.zip,l.zip_code,l.size,l.wheel_diameter,l.bolt,l.bolt_pattern,l.description].join(' ').toLowerCase().includes(q))&&
   (!f.size||Number(l.size??l.wheel_diameter)===Number(f.size))&&(!f.bolt||bolt(l.bolt??l.bolt_pattern)===bolt(f.bolt))&&
   (!f.state||l.state===f.state)&&(!f.filterWidth||Number(l.width??l.wheel_width)===Number(f.filterWidth))&&
   (f.minprice===''||f.minprice==null||Number(l.price)>=Number(f.minprice))&&(f.maxprice===''||f.maxprice==null||Number(l.price)<=Number(f.maxprice))&&
   (!f.type||(f.type==='trade'?!!(l.trade??l.trades_accepted):!(l.trade??l.trades_accepted)))&&
   (!f.delivery||(f.delivery==='shipping'?['shipping','both'].includes(l.delivery)||l.shipping_available:['pickup','both'].includes(l.delivery)||l.pickup_available));
 }
 const api={bolt,matches};if(typeof module!=='undefined')module.exports=api;else root.WheelSearch=api;
})(typeof window==='undefined'?{}:window);
