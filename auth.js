/* Public browser key only. Authorization is enforced by existing Supabase RLS. */
const cloud = window.supabase?.createClient('https://gjlmnoyznepvuvzvkjqn.supabase.co','sb_publishable_ljhMWJJpxO2LEGb18nghYg_l7LbSx4d');
let currentUser=null, garageOnly=false, authMode='login', recoveryReady=false, garageFilter='all';
const GARAGE_LABELS={active:'Available',pending:'Pending',multiple_sets:'Multiple Sets',sold:'Sold',hidden:'Draft'};
function garageStatus(l){return l.status==='active'?(['pending','multiple_sets'].includes(l.availability)?l.availability:'active'):l.status;}
function setGarageFilter(value){garageFilter=value;render();}

/* Seller analytics: only detail opens count, once per browser session. */
let listingViewCounts=null, listingViewSession=null;
const recordedListingViews=new Set();
function getListingViewSession(){
 if(listingViewSession)return listingViewSession;
 try{listingViewSession=sessionStorage.getItem('wheelswap_view_session_v1');}catch{}
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(listingViewSession||'')){
  listingViewSession=crypto.randomUUID();
  try{sessionStorage.setItem('wheelswap_view_session_v1',listingViewSession);}catch{}
 }
 return listingViewSession;
}
async function recordListingView(l){
 if(!cloud||!l?.seller_id||l.status!=='active'||l.seller_id===currentUser?.id||recordedListingViews.has(l.id))return;
 recordedListingViews.add(l.id);
 try{
  const session=await cloud.auth.getSession();
  if(session.error)throw session.error;
  if(session.data.session?.user?.id===l.seller_id)return;
  const result=await cloud.from('listing_views').insert({listing_id:l.id,viewer_session:getListingViewSession()});
  if(result.error&&result.error.code!=='23505')throw result.error;
 }catch{recordedListingViews.delete(l.id);}
}
async function loadGarageViewCounts(){
 listingViewCounts=null;
 if(!garageOnly||!currentUser)return;
 const userId=currentUser.id;
 try{
  const rows=checked(await cloud.rpc('get_my_listing_view_counts'));
  if(currentUser?.id===userId)listingViewCounts=new Map((rows||[]).map(row=>[String(row.listing_id),Number(row.views)]));
 }catch{/* Keep listings usable when analytics is temporarily unavailable. */}
}

const localListings=JSON.parse(localStorage.getItem(KEY)||'[]');
const redirectURL=()=>location.origin+'/';
const checked=result=>{if(result.error)throw result.error;return result.data};
document.body.insertAdjacentHTML('beforeend',`<div class="modal" id="accountModal"><div class="panel"><div class="panelhead"><h2 id="accountTitle">Log in</h2><button class="x" onclick="closeModal('accountModal')" aria-label="Close account">×</button></div><form id="accountForm"><label for="accountEmail">EMAIL</label><input id="accountEmail" type="email" autocomplete="email" required><div id="passwordFields"><label for="accountPassword">PASSWORD</label><input id="accountPassword" type="password" autocomplete="current-password" minlength="8" required></div><p role="status" id="accountStatus" class="note"></p><button class="btn" id="accountSubmit">Log in</button></form><p><button class="btn ghost" onclick="setAuthMode('signup')">Sign up</button> <button class="btn ghost" onclick="setAuthMode('login')">Log in</button></p><p><button class="navlink" style="display:inline-block" onclick="setAuthMode('forgot')">Forgot password?</button> <button class="navlink" style="display:inline-block" onclick="setAuthMode('resend')">Resend verification</button></p><button class="btn ghost" id="signOutButton" onclick="logout()" hidden>Sign out</button></div></div>`);
function setAuthMode(mode){authMode=mode;const reset=mode==='reset';$('accountEmail').hidden=reset;$('accountEmail').required=!reset;$('passwordFields').hidden=!['signup','login','reset'].includes(mode);$('accountPassword').required=!$('passwordFields').hidden;$('accountPassword').autocomplete=mode==='login'?'current-password':'new-password';$('accountPassword').minLength=mode==='login'?1:8;$('accountPassword').value='';$('accountStatus').textContent='';$('accountTitle').textContent=$('accountSubmit').textContent=({login:'Log in',signup:'Create account',forgot:'Send password reset',reset:'Save new password',resend:'Resend verification'})[mode];}
function openAccount(){setAuthMode('login');$('accountModal').classList.add('open')}
const originalOpenSell=openSell;
openSell=function(){if(!currentUser){openAccount();$('accountStatus').textContent='Log in or sign up to list your wheels.';return}if(!currentUser.email_confirmed_at){openAccount();$('accountStatus').textContent='Verify your email before publishing.';return}originalOpenSell();};
async function openGarage(){if(!currentUser){openAccount();return}['search','size','bolt','type','state','delivery','maxprice'].forEach(id=>$(id).value='');savedOnly=false;garageOnly=true;garageFilter='all';await loadListings();document.querySelector('main').scrollIntoView({behavior:'smooth'})}
const originalRender=render;
render=function(){
 const all=listings,owned=all.filter(l=>l.seller_id===currentUser?.id);
 if(garageOnly)listings=owned.filter(l=>garageFilter==='all'||garageStatus(l)===garageFilter);
 try{originalRender()}finally{listings=all}
 $('garageTools')?.remove();
 if(garageOnly){
  $('listTitle').textContent='My Garage';
  $('count').textContent=owned.length+' total listing'+(owned.length===1?'':'s')+' · Manage your sets below';
  const tools=document.createElement('section');tools.id='garageTools';tools.className='garage-tools';tools.setAttribute('aria-label','Garage controls');
  tools.innerHTML='<div class="garage-intro"><div><h3>Your sets. Your next move.</h3><p>Update availability, manage contact details, or post another set.</p></div><button class="btn" onclick="openSell()">+ Post a new set</button></div><div class="garage-tabs" role="group" aria-label="Filter your listings">'+Object.entries({all:'All sets',...GARAGE_LABELS}).map(([key,label])=>`<button class="garage-tab ${garageFilter===key?'selected':''}" aria-pressed="${garageFilter===key}" data-garage-filter="${key}">${label} <span>${key==='all'?owned.length:owned.filter(l=>garageStatus(l)===key).length}</span></button>`).join('')+'</div>';
  $('listings').before(tools);
  tools.addEventListener('click',e=>{const b=e.target.closest('[data-garage-filter]');if(b)setGarageFilter(b.dataset.garageFilter)});
  for(const l of owned){
   const card=[...document.querySelectorAll('.listing')].find(el=>el.dataset.listingId===String(l.id));if(!card)continue;
   const state=garageStatus(l);card.querySelector('.pill').textContent=GARAGE_LABELS[state]||'Draft';card.querySelector('.pill').dataset.availability=state;
   const controls=document.createElement('div');controls.className='garage-manage';
   controls.innerHTML=`<p class="garage-view-count">${listingViewCounts?`${(listingViewCounts.get(String(l.id))||0).toLocaleString()} views`:'Views temporarily unavailable'}</p><p class="note">Listing opens since tracking began. Your own views are excluded.</p><label for="status-${esc(l.id)}">LISTING STATUS</label><select id="status-${esc(l.id)}" aria-label="Status for ${esc(l.title)}">${Object.entries(GARAGE_LABELS).filter(([key])=>key!=='hidden'||state==='hidden').map(([key,label])=>`<option value="${key}" ${state===key?'selected':''}>${label}</option>`).join('')}</select><div class="garage-actions"><button class="btn" data-garage-save>Save status</button><button class="btn ghost" data-garage-contact>Contact details</button></div><p class="note" role="status" data-garage-feedback>${state==='hidden'?'Drafts are private. Choose Available to publish.':state==='sold'?'Sold — saved here for your records.':state==='pending'?'Buyers see Pending while the deal is in progress.':state==='multiple_sets'?'Buyers see that you have multiple sets available.':'Visible to buyers and ready for inquiries.'}</p>`;
   controls.addEventListener('click',e=>{if(e.target.closest('[data-garage-save]'))changeStatus(l.id,controls.querySelector('select').value);if(e.target.closest('[data-garage-contact]'))editContact(l.id)});
   if(state==='sold'){const relist=document.createElement('button');relist.className='btn';relist.textContent='Relist →';relist.style.width='100%';relist.addEventListener('click',()=>changeStatus(l.id,'active'));controls.append(relist)}
   card.querySelector('.content').append(controls);
  }
  const empty=$('listings').querySelector('.empty');if(empty){empty.innerHTML=owned.length?'No sets in this view. Choose another status above.':'Your Garage is ready for its first set.<br><br><button class="btn" onclick="openSell()">+ Post your first set</button>'}
  if(localListings.length){const block=document.createElement('div');block.className='full';block.innerHTML='<p class="note">Listings saved on this device — publish a copy to your account:</p>';for(const l of localListings){const b=document.createElement('button');b.className='btn ghost';b.textContent='Publish '+l.title;b.onclick=()=>importLocal(l.id);block.append(b)}$('listings').append(block)}
 }else{
  for(const card of document.querySelectorAll('.listing')){const l=all.find(l=>String(l.id)===card.dataset.listingId);if(!l)continue;const state=garageStatus(l);if(['pending','multiple_sets'].includes(state)){card.querySelector('.pill').textContent=GARAGE_LABELS[state];card.querySelector('.pill').dataset.availability=state}}
 }
};
const originalReset=resetFilters;resetFilters=function(){garageOnly=false;originalReset();loadListings()};
const originalSaved=showSaved;showSaved=function(){garageOnly=false;originalSaved();loadListings()};
async function loadListings(){if(!cloud){toast('Account service could not load. Refresh to retry.');return}try{let query=cloud.from('listings').select('*,listing_photos(storage_path,sort_order)').order('created_at',{ascending:false});if(garageOnly)query=query.eq('seller_id',currentUser.id);else query=query.eq('status','active');const rows=checked(await query);await loadGarageViewCounts();listings=rows.map(l=>({...l,size:String(l.wheel_diameter||''),width:l.wheel_width||'',bolt:l.bolt_pattern,location:[l.city,l.state].filter(Boolean).join(', '),zip:l.zip_code,trade:l.trades_accepted,delivery:l.shipping_available?(l.pickup_available?'both':'shipping'):'pickup',photo:l.listing_photos?.length?cloud.storage.from('listing-images').getPublicUrl([...l.listing_photos].sort((a,b)=>a.sort_order-b.sort_order)[0].storage_path).data.publicUrl:'',seller:l.seller_name||'WheelSwap seller',email:l.contact_email||''}));if(!garageOnly)listings.push(...localListings.filter(l=>!listings.some(c=>c.id===l.id)));render()}catch(e){toast('Could not load cloud listings. Your device listings are preserved.')}}
async function changeStatus(id,status){
 if(!currentUser){openAccount();return}
 if(!Object.hasOwn(GARAGE_LABELS,status)){toast('Choose a valid status.');return}
 const card=[...document.querySelectorAll('.listing')].find(el=>el.dataset.listingId===String(id)),controls=card?.querySelector('.garage-manage'),feedback=controls?.querySelector('[data-garage-feedback]');
 if(controls?.dataset.saving)return;
 if(controls){controls.dataset.saving='true';controls.querySelectorAll('button,select').forEach(el=>el.disabled=true)}
 if(feedback)feedback.textContent='Saving status…';
 try{
  const listing=checked(await cloud.from('listings').select('id,status,seller_id,availability').eq('id',id).eq('seller_id',currentUser.id).single());
  if(status==='sold'||status==='hidden')checked(await cloud.from('listings').update({status}).eq('id',id).eq('seller_id',currentUser.id).select().single());
  else{
   const availability=status==='active'?'available':status;
   checked(await cloud.from('listings').update({availability}).eq('id',id).eq('seller_id',currentUser.id).select().single());
   if(listing.status!=='active')await publishListingAccess(id);
  }
  await loadListings();toast('Status saved: '+GARAGE_LABELS[status]);
 }catch(e){if(feedback)feedback.textContent='Could not save: '+e.message;toast(e.message)}
 finally{if(controls){delete controls.dataset.saving;controls.querySelectorAll('button,select').forEach(el=>el.disabled=false)}}
}
const originalView=viewListing;viewListing=function(id){originalView(id);const l=listings.find(x=>String(x.id)===String(id));if(l)void recordListingView(l);if(l&&['pending','multiple_sets','sold'].includes(garageStatus(l))){const note=document.createElement('p');note.className='availability-detail';note.dataset.availability=garageStatus(l);note.textContent=GARAGE_LABELS[garageStatus(l)];$('detailBody').prepend(note);}if(l?.seller_id&&l.email){const href='mailto:'+encodeURIComponent(l.email)+'?subject='+encodeURIComponent('WheelSwap inquiry: '+l.title)+'&body='+encodeURIComponent('Hi, is your '+l.title+' still available?');$('contactSeller').outerHTML=`<p class="note">Contact email: <span>${esc(l.email)}</span></p><a id="contactSeller" class="btn" style="display:block;text-align:center;text-decoration:none" href="${esc(href)}">Contact Seller by Email →</a>`;}if(l?.seller_id&&!l.email){$('contactSeller').disabled=true;$('contactSeller').textContent='Seller has not added a contact email yet.';}if(l?.seller_id===currentUser?.id)$('detailBody').insertAdjacentHTML('beforeend',`<button class="btn ghost" style="width:100%;margin-top:10px" onclick="editContact('${l.id}')">Edit contact details</button>`);};
let contactListingId=null,contactImportId=null;
document.body.insertAdjacentHTML('beforeend',`<div class="modal" id="contactModal"><div class="panel"><div class="panelhead"><h2>Seller contact details</h2><button class="x" onclick="closeModal('contactModal')" aria-label="Close contact details">×</button></div><form id="contactForm"><label for="contactName">PUBLIC SELLER NAME</label><input id="contactName" required maxlength="120"><label for="contactEmail">PUBLIC CONTACT EMAIL</label><input id="contactEmail" required type="email" maxlength="254"><p class="note">Buyers will see this name and email on your listing. Use a contact email you are comfortable sharing publicly. This does not change your account login email.</p><label style="display:flex;gap:8px;align-items:center"><input id="contactConsent" type="checkbox" required style="width:auto"> I agree to share these contact details publicly.</label><p id="contactStatus" class="note" role="status"></p><button class="btn" id="saveContact">Save contact details</button></form></div></div>`);
function editContact(id,importing=false){if(!currentUser){openAccount();return}const l=(importing?localListings:listings).find(x=>x.id===id);if(!l||(!importing&&l.seller_id!==currentUser.id))return;contactListingId=importing?null:id;contactImportId=importing?id:null;$('contactName').value=l.seller||'';$('contactEmail').value=l.email||'';$('contactConsent').checked=false;$('contactStatus').textContent='';$('saveContact').textContent=importing?'Publish listing':'Save contact details';$('contactModal').classList.add('open');}
$('contactForm').addEventListener('submit',async e=>{e.preventDefault();const b=$('saveContact');b.disabled=true;try{if(!currentUser||!$('contactConsent').checked)throw Error('Sign in and agree to share your contact details first.');const seller=$('contactName').value.trim(),email=$('contactEmail').value.trim();if(contactImportId){const l=localListings.find(x=>x.id===contactImportId);let file;if(l.photo?.startsWith('data:image/'))file=await(await fetch(l.photo)).blob();await publish({...l,seller,email,public_contact:true},file,l.id);}else{checked(await cloud.from('listings').update({seller_name:seller,contact_email:email}).eq('id',contactListingId).eq('seller_id',currentUser.id).select().single());}closeModal('contactModal');closeModal('detailModal');await loadListings();toast(contactImportId?'Listing published!':'Contact details saved.');}catch(e){$('contactStatus').textContent=e.message}finally{b.disabled=false}});
$('accountForm').addEventListener('submit',async e=>{e.preventDefault();if(!cloud){$('accountStatus').textContent='Account service unavailable. Refresh to retry.';return}const button=$('accountSubmit');button.disabled=true;try{const email=$('accountEmail').value.trim(),password=$('accountPassword').value;let message='';if(authMode==='signup'){checked(await cloud.auth.signUp({email,password,options:{emailRedirectTo:redirectURL()}}));message='Check your email for a verification link before logging in.'}else if(authMode==='login'){checked(await cloud.auth.signInWithPassword({email,password}));closeModal('accountModal');message='Logged in.'}else if(authMode==='forgot'){checked(await cloud.auth.resetPasswordForEmail(email,{redirectTo:redirectURL()}));message='If that account exists, a password reset email is on its way.'}else if(authMode==='resend'){checked(await cloud.auth.resend({type:'signup',email,options:{emailRedirectTo:redirectURL()}}));message='Check your email for a verification link.'}else if(authMode==='reset'){if(!recoveryReady)throw Error('Open a valid password reset link first.');checked(await cloud.auth.updateUser({password}));recoveryReady=false;message='Password updated.';closeModal('accountModal');toast(message)}$('accountStatus').textContent=message;$('accountPassword').value=''}catch(e){$('accountStatus').textContent=e.message}finally{button.disabled=false}});
async function logout(){try{checked(await cloud.auth.signOut());garageOnly=false;currentUser=null;closeModal('accountModal');await loadListings()}catch(e){toast(e.message)}}
async function publish(values,file,existingId){if(!currentUser?.email_confirmed_at)throw Error('Sign in with a verified email first.');if(!values.public_contact)throw Error('Agree to share a seller name and contact email before publishing.');if(!values.email?.trim()||!values.seller?.trim())throw Error('Enter a seller name and contact email.');const id=existingId||crypto.randomUUID();const row={id,seller_id:currentUser.id,seller_name:values.seller.trim(),contact_email:values.email.trim(),title:values.title,price:Number(values.price),wheel_diameter:Number(values.size),wheel_width:Number(values.width)||null,bolt_pattern:values.bolt,brand:values.brand||null,city:values.city,state:values.state,zip_code:values.zip,description:values.description||'',condition:({'Like New':'like_new','Used - Fair':'fair','Used - Good':'good'})[values.condition]||'good',category:'wheels',pickup_available:values.delivery!=='shipping',shipping_available:values.delivery!=='pickup',trades_accepted:!!values.trade,status:'hidden'};
if(file&&(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>6*1024*1024))throw Error('Use a JPG, PNG, or WebP photo under 6 MB.');
checked(await cloud.from('profiles').upsert({id:currentUser.id,display_name:values.seller||'WheelSwap seller'},{onConflict:'id'}));
checked(await cloud.from('listings').insert(row));
try{if(file){const path=`${currentUser.id}/${id}/${crypto.randomUUID()}.${file.type.split('/')[1]}`;checked(await cloud.storage.from('listing-images').upload(path,file,{contentType:file.type}));checked(await cloud.from('listing_photos').insert({listing_id:id,storage_path:path,sort_order:0}));}await publishListingAccess(id)}catch(e){throw Object.assign(Error('Your listing is saved as hidden in My Garage. '+e.message),{draftSavedId:id})}return id;}
$('sellForm').insertAdjacentHTML('beforeend','<p class="note" id="publishStatus" role="status"></p>');
$('sellForm').addEventListener('submit',async e=>{e.preventDefault();$('publishStatus').textContent='';const b=e.target.querySelector('[type=submit]');b.disabled=true;try{const values=Object.fromEntries(new FormData(e.target));values.trade=new FormData(e.target).has('trade');await publish(values,$('photoInput').files[0]);e.target.reset();$('preview').style.display='none';closeModal('sellModal');garageOnly=false;await loadListings();toast('Listing published!')}catch(e){if(e.draftSavedId){document.getElementById('sellForm').reset();$('preview').style.display='none';closeModal('sellModal');await openGarage()}$('publishStatus').textContent=e.message;toast(e.message)}finally{b.disabled=false}});
function importLocal(id){editContact(id,true)}
if(cloud){cloud.auth.onAuthStateChange((event,session)=>{currentUser=session?.user||null;if(!currentUser){garageOnly=false;recoveryReady=false;}$('accountButton').textContent=currentUser?'Account':'Log in / Sign up';$('signOutButton').hidden=!currentUser;if(event==='PASSWORD_RECOVERY'){recoveryReady=true;setAuthMode('reset');$('accountModal').classList.add('open')}setTimeout(()=>loadListings(),0)});cloud.auth.getSession().then(({data,error})=>{if(error){toast(error.message);return}currentUser=data.session?.user||null;loadListings()});const params=new URLSearchParams(location.hash.slice(1));if(params.has('error_description')){openAccount();$('accountStatus').textContent=params.get('error_description');history.replaceState(null,'',location.pathname)}}else toast('Account service unavailable. Refresh to retry.');


const garageStyle=document.createElement('style');garageStyle.textContent=`
.garage-tools{margin:0 0 24px;padding:24px;border:1px solid #ffffff20;border-radius:14px;background:linear-gradient(120deg,#222833,#12161c)}
.garage-intro{display:flex;gap:20px;align-items:center;justify-content:space-between}.garage-intro h3{font-size:23px;letter-spacing:-.6px;margin:0 0 8px}.garage-intro p{margin:0;color:#afb8c5;font-size:13px;line-height:1.5}.garage-intro>.btn{white-space:nowrap}
.garage-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-top:22px}.garage-tab{border:1px solid #ffffff20;background:#10141b;color:#d4dae3;padding:10px 13px;border-radius:8px;font-weight:700;font-size:12px}.garage-tab span{margin-left:6px;opacity:.65}.garage-tab.selected{border-color:#ff7936;color:#ffad81;background:#ff681e16}
.garage-view-count{font-size:20px;font-weight:800;color:#ffad81;margin:0 0 6px}.garage-manage{border-top:1px solid #ffffff18;padding-top:16px;margin-top:16px;cursor:default}.garage-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}.garage-actions .btn{font-size:12px;padding:11px 8px}.garage-manage .note{margin-bottom:0;min-height:36px}.garage-manage button:disabled,.garage-manage select:disabled{opacity:.55;cursor:wait}
.pill[data-availability=active]{color:#a2e8bb}.pill[data-availability=pending],.availability-detail[data-availability=pending]{color:#ffd176}.pill[data-availability=multiple_sets],.availability-detail[data-availability=multiple_sets]{color:#9dc9ff}.pill[data-availability=sold]{color:#c3c8d0}.availability-detail{font-size:13px;font-weight:800;border:1px solid #ffffff20;display:inline-block;border-radius:7px;padding:8px 12px}
@media(max-width:600px){.garage-tools{padding:18px}.garage-intro{align-items:stretch;flex-direction:column;gap:16px}.garage-tab{padding:10px;font-size:11px}.garage-tabs{gap:6px}}
`;document.head.append(garageStyle);
