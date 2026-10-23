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
 box.textContent='Loading posting plan…';
 try {
  const result=await billingRequest('/api/subscription',{action:'status'}),sub=result.subscription;
  box.innerHTML='<h3>Your posting plan</h3><p>First 30 days free from your first publish attempt. Then choose $5 per new listing or $25/month for unlimited new listings. The monthly plan renews until canceled. Existing listings stay posted after cancellation.</p>';
  if(sub&&['active','past_due','unpaid','incomplete','paused'].includes(sub.status)) {
   const note=document.createElement('p');note.textContent=sub.active?'Unlimited posting '+(sub.cancel_at_period_end?'ends ':'renews ')+new Date(sub.period_end).toLocaleDateString()+'.':'Monthly plan: '+sub.status+'. New posts use the $5 option until payment is resolved.';box.append(note);
   if(!sub.cancel_at_period_end&&['active','past_due','unpaid'].includes(sub.status)) {const btn=document.createElement('button');btn.className='btn ghost';btn.textContent='Cancel monthly renewal';btn.onclick=cancelMembership;box.append(btn);}
  } else {const btn=document.createElement('button');btn.className='btn';btn.textContent='Choose unlimited — $25/month';btn.onclick=startMembership;box.append(btn);}
 }catch(e){box.textContent=e.message;}
}
async function startMembership() {
 if(!window.confirm('Subscribe to unlimited posting for $25 USD per month? Billing starts after checkout and renews monthly until you cancel in My Garage. Your free posting trial does not delay subscription billing.'))return;
 try {const r=await billingRequest('/api/subscription',{action:'checkout'});if(r.url&&new URL(r.url).hostname==='checkout.stripe.com'){location.assign(r.url);return;}if(r.already_subscribed){toast('You already have a monthly plan.');await openMembership();return;}toast('Your subscription payment is processing.');}catch(e){toast(e.message);}
}
async function cancelMembership() {
 if(!window.confirm('Stop the $25 monthly renewal? Unlimited posting continues through the paid period. Existing listings stay posted.'))return;
 try {await billingRequest('/api/subscription',{action:'cancel'});toast('Monthly renewal canceled.');await openMembership();}catch(e){toast(e.message);}
}
if(typeof openGarage==='function') {
 const garageWithListings=openGarage;
 openGarage=async function(){await garageWithListings();if(currentUser)await openMembership();};
}
async function membershipReturn(){
 const state=new URLSearchParams(location.search).get('membership');if(!state||!currentUser)return;
 history.replaceState(null,'',location.pathname+location.hash);
 toast(state==='cancel'?'Subscription checkout canceled.':'Checking your monthly subscription…');await openGarage();
}
if(cloud){cloud.auth.onAuthStateChange(()=>setTimeout(membershipReturn,0));membershipReturn();}
