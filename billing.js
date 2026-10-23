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
