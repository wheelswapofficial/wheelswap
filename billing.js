/* Checkout uses the existing Supabase session; secret keys never reach this file. */
async function billingRequest(path,body) {
 const {data,error}=await cloud.auth.getSession();
 if(error||!data.session)throw Error('Please log in again to continue.');
 const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+data.session.access_token},body:JSON.stringify(body)});
 const result=await response.json();
 if(!response.ok)throw Error(result.error||'Could not start checkout. Your listing is saved in My Garage.');
 return result;
}
async function publishListingAccess(id) {
 const result=await billingRequest('/api/create-checkout-session',{listing_id:id});
 if(result.published)return;
 if(result.processing)throw Error('Your payment is processing. Your listing will publish when payment succeeds.');
 if(!result.url||new URL(result.url).hostname!=='checkout.stripe.com')throw Error('Unable to open checkout. Retry from My Garage.');
 const accepted=window.confirm('Your free posting period has ended. Continue to Stripe to pay $5 for this listing? Cancel keeps your draft in My Garage.');
 if(accepted)location.assign(result.url);
 throw Error(accepted?'Opening secure checkout. Your draft is saved.':'Your draft is saved in My Garage. Publish it when you are ready.');
}
let checkoutReturnHandled=false;
async function handleCheckoutReturn() {
 if(checkoutReturnHandled)return;
 const params=new URLSearchParams(location.search),state=params.get('checkout');
 if(!state)return;
 if(state==='cancel') {
  checkoutReturnHandled=true;history.replaceState(null,'',location.pathname+location.hash);
  toast('Checkout canceled. Your draft is saved in My Garage.');
  if(currentUser)await openGarage();
  return;
 }
 if(state!=='success'||!currentUser)return;
 checkoutReturnHandled=true;
 try {
  const result=await billingRequest('/api/checkout-status',{session_id:params.get('session_id')});
  toast(result.fulfilled?'Payment verified. Your listing is ready in My Garage.':'Your payment is processing. Your listing will publish when it succeeds.');
  await openGarage();
  history.replaceState(null,'',location.pathname+location.hash);
 } catch(error) {
  toast(error.message);
  document.querySelector('main').insertAdjacentHTML('afterbegin','<p class="note" id="checkoutRetry">Payment confirmation could not finish. <button class="btn ghost" id="retryCheckout">Check payment again</button></p>');
  document.getElementById('retryCheckout').onclick=()=>{document.getElementById('checkoutRetry').remove();checkoutReturnHandled=false;handleCheckoutReturn();};
 }
}
if(cloud){cloud.auth.onAuthStateChange(()=>setTimeout(handleCheckoutReturn,0));handleCheckoutReturn();}
async function openMembership() {
 if(!currentUser){openAccount();return;}
 let box=document.getElementById('membershipPanel');
 if(!box){document.querySelector('main').insertAdjacentHTML('afterbegin','<section id="membershipPanel" class="note" aria-live="polite"></section>');box=document.getElementById('membershipPanel');}
 box.textContent='Loading posting plan…';box.scrollIntoView({behavior:'smooth',block:'center'});
 try {
  const result=await billingRequest('/api/subscription',{action:'status'}),sub=result.subscription;
  box.innerHTML='<h3>Your posting plan</h3><p>First 30 days free from your first publish attempt. Then choose $5 per new listing or unlimited new listings for $25/month or $260/year. Annual membership saves $40 compared with twelve monthly payments and includes one surprise box with a shirt and little goodies after signup, with US shipping included. Goodies vary. Membership renews until canceled. Existing listings stay posted after cancellation.</p>';
  if(sub&&!['canceled','incomplete_expired'].includes(sub.status)) {
   const note=document.createElement('p');note.textContent=sub.active?'Unlimited posting '+(sub.cancel_at_period_end?'ends ':'renews ')+new Date(sub.period_end).toLocaleDateString()+'.':(sub.plan==='annual'?'Annual':'Monthly')+' plan: '+sub.status+'. New posts use the $5 option until payment is resolved.';box.append(note);
   if(!sub.cancel_at_period_end&&['active','past_due','unpaid'].includes(sub.status)) {const btn=document.createElement('button');btn.className='btn ghost';btn.textContent='Cancel '+(sub.plan==='annual'?'annual':'monthly')+' renewal';btn.onclick=cancelMembership;box.append(btn);}
  } else {const btn=document.createElement('button');btn.className='btn';btn.textContent='Choose unlimited — $25/month';btn.onclick=()=>startMembership('monthly');box.append(btn);const annual=document.createElement('button');annual.className='btn';annual.style.margin='10px';annual.textContent='Choose annual + surprise box — $260/year';annual.onclick=()=>startMembership('annual');box.append(annual);}
 }catch(e){box.textContent=e.message;}
}
async function startMembership(plan='monthly') {
 if(!window.confirm(plan==='annual'?'Join for $260 USD per year with unlimited posting and one surprise box with a shirt and little goodies after signup? US shipping included. Renews annually until canceled in My Garage. Billing starts at checkout.':'Subscribe for $25 USD per month with unlimited posting? Renews monthly until canceled in My Garage. Billing starts at checkout.'))return;
 try {const r=await billingRequest('/api/subscription',{action:'checkout',plan});if(r.url&&new URL(r.url).hostname==='checkout.stripe.com'){location.assign(r.url);return;}if(r.already_subscribed){toast('You already have a membership.');await openMembership();return;}toast('Your subscription payment is processing.');}catch(e){toast(e.message);}
}
async function cancelMembership() {
 if(!window.confirm('Stop your membership renewal? Unlimited posting continues through the paid period. Existing listings stay posted.'))return;
 try {await billingRequest('/api/subscription',{action:'cancel'});toast('Membership renewal canceled.');await openMembership();}catch(e){toast(e.message);}
}
if(typeof openGarage==='function') {
 const garageWithListings=openGarage;
 openGarage=async function(){await garageWithListings();if(currentUser)await openMembership();};
}
async function membershipReturn(){
 const state=new URLSearchParams(location.search).get('membership');if(!state||!currentUser)return;
 history.replaceState(null,'',location.pathname+location.hash);
 toast(state==='cancel'?'Subscription checkout canceled.':'Checking your membership…');await openGarage();
}
if(cloud){cloud.auth.onAuthStateChange(()=>setTimeout(membershipReturn,0));membershipReturn();}
