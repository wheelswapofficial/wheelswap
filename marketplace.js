const LISTING_CATEGORIES={wheels:'Rims only',tires:'Tires only',wheel_tire_package:'Wheels + tires'};
function updateListingCategory(){
 const form=$('sellForm'),category=form.elements.category.value,tires=category==='tires',hasTires=category!=='wheels';
 form.querySelectorAll('[data-wheel-spec]').forEach(el=>{el.hidden=tires;el.querySelector('input,select').disabled=tires;});
 form.elements.size.required=!tires;form.elements.bolt.required=!tires;
 $('tireSizeField').hidden=!hasTires;form.elements.tire_size.disabled=!hasTires;form.elements.tire_size.required=hasTires;
}
/* Buyer discovery and shareable listing details; preserves existing listing storage. */
(() => {
 const box=document.querySelector('.searchbox');
 const categoryControl=document.createElement('div');categoryControl.innerHTML='<label for="categoryFilter">WHAT ARE YOU LOOKING FOR?</label><select id="categoryFilter"><option value="">Wheels & tires — all</option>'+Object.entries(LISTING_CATEGORIES).map(([value,label])=>'<option value="'+value+'">'+label+'</option>').join('')+'</select>';box.append(categoryControl);$('categoryFilter').addEventListener('change',()=>render());
 updateListingCategory();
 const controls=[['filterWidth','WHEEL WIDTH (IN)','number','Any width'],['minprice','MIN PRICE ($)','number','Any price']];
 for(const [id,title,type,placeholder] of controls){const div=document.createElement('div');div.innerHTML=`<label for="${id}">${title}</label><input id="${id}" type="${type}" min="0" step="any" placeholder="${placeholder}">`;box.append(div);$(id).addEventListener('input',()=>render());}
 const sort=document.createElement('div');sort.innerHTML='<label for="listingSort">SORT BY</label><select id="listingSort"><option value="newest">Newest first</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option><option value="diameter">Wheel diameter</option></select>';box.append(sort);$('listingSort').addEventListener('change',()=>render());
 document.querySelectorAll('.searchbox label').forEach(label=>{const input=label.parentElement.querySelector('input,select');if(input)label.htmlFor=input.id;});
 const aliases={'5x4.5':'5x114.3','5x5':'5x127','5x5.5':'5x139.7','6x4.5':'6x114.3','6x5.5':'6x139.7','8x6.5':'8x165.1'};
 const pattern=value=>{const v=String(value||'').toLowerCase().replace(/\s/g,'').replace(/×/g,'x');return aliases[v]||v;};
 const baseRender=render;
 render=function(){
  const all=listings,bolt=$('bolt').value,width=$('filterWidth').value,min=$('minprice').value;
  listings=all.filter(l=>(!$('categoryFilter').value||(l.category||'wheels')===$('categoryFilter').value)&&(!bolt||pattern(l.bolt)===pattern(bolt))&&(width===''||(l.width!==null&&l.width!==''&&Number(l.width)===Number(width)))&&(min===''||Number(l.price)>=Number(min)));
  const order=$('listingSort').value;
  listings=[...listings].sort((a,b)=>order==='low'?Number(a.price)-Number(b.price):order==='high'?Number(b.price)-Number(a.price):order==='diameter'?Number(a.size)-Number(b.size):(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0));
  $('bolt').value='';
  try{baseRender();}finally{listings=all;$('bolt').value=bolt;}
  for(const card of document.querySelectorAll('.listing')){const l=all.find(row=>String(row.id)===card.dataset.listingId);if(l){const tag=document.createElement('div');tag.className='meta';tag.textContent=LISTING_CATEGORIES[l.category||'wheels']||'Rims only';card.querySelector('.content').prepend(tag);}}
  if(!$('listings').querySelector('.listing')&&all.length&&!garageOnly){$('listings').querySelector('.empty').innerHTML='No sets match these filters. Try a wider search.<br><br><button class="btn ghost" onclick="resetFilters()">Clear filters</button>';}
 };
 const clearExtra=()=>{['filterWidth','minprice','categoryFilter'].forEach(id=>$(id).value='');$('listingSort').value='newest';};
 const baseReset=resetFilters;resetFilters=function(){clearExtra();baseReset();};
 const baseGarage=openGarage;openGarage=function(){clearExtra();return baseGarage();};
 const baseSaved=showSaved;showSaved=function(){clearExtra();return baseSaved();};
 const cleanCondition=value=>({'good':'Used — Good','fair':'Used — Fair','like_new':'Like New'})[value]||value||'Not specified';
 const baseView=viewListing;
 viewListing=function(id){
  baseView(id);const l=listings.find(x=>String(x.id)===String(id));if(!l)return;
  const body=$('detailBody');
  const specs=document.createElement('dl');specs.className='listing-specs';
  const facts=[['Selling',LISTING_CATEGORIES[l.category||'wheels']||'Rims only'],...(l.category==='tires'?[]:[['Diameter',l.size?l.size+' in':'Not specified'],['Width',l.width?l.width+' in':'Not specified'],['Bolt pattern',l.bolt||'Not specified']]),...(l.tire_size?[['Tire size',l.tire_size]]:[]),['Condition',cleanCondition(l.condition)],['Brand',l.brand||'Not specified'],['Location',l.location||'Not specified'],['Delivery',l.delivery==='both'?'Pickup or shipping':l.delivery==='shipping'?'Shipping available':'Local pickup'],['Trades',l.trade?'Welcome':'Contact seller']];
  specs.innerHTML=facts.map(([name,value])=>`<div><dt>${esc(name)}</dt><dd>${esc(value)}</dd></div>`).join('');
  const description=body.querySelector('.details');description.before(specs);
  const note=document.createElement('p');note.className='note';note.textContent='Matching bolt patterns do not guarantee vehicle fitment. Confirm offset, center bore, load rating, brake clearance, tire size, tread, damage, TPMS sensors and included lug nuts with the seller.';description.after(note);
  const share=document.createElement('button');share.type='button';share.className='btn ghost';share.style.cssText='width:100%;margin-top:12px';share.textContent='Share this listing';
  share.onclick=async()=>{const url=new URL('/',location.origin);url.searchParams.set('listing',l.id);try{if(navigator.share){await navigator.share({title:l.title,text:l.title+' — '+money(l.price)+' on WheelSwap',url:url.href});}else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(url.href);toast('Listing link copied');}else{const input=document.createElement('input');input.readOnly=true;input.value=url.href;share.after(input);input.select();share.textContent='Copy the link below';}}catch(e){if(e.name!=='AbortError')toast('Could not share. Please try again.');}};
  body.append(share);
 };
 // Open shared links after the asynchronous cloud listing fetch completes.
 const requested=new URLSearchParams(location.search).get('listing');let sharedOpened=false;
 const baseLoad=loadListings;loadListings=async function(){await baseLoad();if(!requested||sharedOpened)return;if(listings.some(l=>String(l.id)===requested)){sharedOpened=true;viewListing(requested);}};
 const style=document.createElement('style');style.textContent='.listing-specs{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#ffffff18;border:1px solid #ffffff18;border-radius:10px;overflow:hidden;margin:20px 0}.listing-specs>div{padding:12px;background:#15191f}.listing-specs dt{font-size:11px;color:#aeb1b8}.listing-specs dd{margin:5px 0 0;font-weight:700;overflow-wrap:anywhere}';document.head.append(style);
 render();if(requested)void loadListings();
})();
