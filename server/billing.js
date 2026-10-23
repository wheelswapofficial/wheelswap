const Stripe = require('stripe');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function httpError(status, message) { return Object.assign(new Error(message), { status }); }
function config() {
  const e = process.env;
  const names = ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_LISTING_PRICE_ID','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY','APP_URL','STRIPE_LIVEMODE'];
  if (names.some(n => !e[n])) throw httpError(503, 'Payments are not configured yet. Your listing is saved in My Garage.');
  const origin = new URL(e.APP_URL);
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || !['true','false'].includes(e.STRIPE_LIVEMODE)) throw httpError(503, 'Payments configuration needs attention.');
  if (new URL(e.SUPABASE_URL).protocol !== 'https:') throw httpError(503, 'Payments configuration needs attention.');
  return { ...e, APP_URL: origin.origin, live: e.STRIPE_LIVEMODE === 'true' };
}
async function rpc(c, name, body) {
  const response = await fetch(c.SUPABASE_URL+'/rest/v1/rpc/'+name, {
    method:'POST', headers:{apikey:c.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+c.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'},
    body:JSON.stringify(body), signal:AbortSignal.timeout(15000),
  });
  if (!response.ok) throw httpError(502, 'Could not update your listing. Please try again from My Garage.');
  const payload = await response.text();
  return payload.trim() ? JSON.parse(payload) : null;
}
async function seller(c, req) {
  const bearer=req.headers.authorization;
  if (typeof bearer !== 'string' || !/^Bearer \S+$/.test(bearer)) throw httpError(401, 'Please log in first.');
  const response=await fetch(c.SUPABASE_URL+'/auth/v1/user', {
    headers:{apikey:c.SUPABASE_PUBLISHABLE_KEY,Authorization:bearer},signal:AbortSignal.timeout(10000),
  });
  if (!response.ok) throw httpError(401, 'Please log in again.');
  const user=await response.json();
  if (!user.id || !user.email_confirmed_at || user.is_anonymous) throw httpError(403,'Verify your email before publishing.');
  return user;
}
function stripe(c) { return new Stripe(c.STRIPE_SECRET_KEY); }
function method(req,res,allowed) {
  res.setHeader('Cache-Control','no-store');
  if(req.method===allowed) return true;
  res.setHeader('Allow',allowed);res.status(405).json({error:'Method not allowed.'});return false;
}
function failure(res,error) { return res.status(error.status||502).json({error:error.status?error.message:'Payments are temporarily unavailable. Your listing is saved in My Garage.'}); }
async function fulfill(c, client, id, expectedSeller) {
  const session=await client.checkout.sessions.retrieve(id,{expand:['line_items']});
  if(expectedSeller && session.metadata?.seller_id!==expectedSeller) throw httpError(404,'Checkout not found.');
  if(session.livemode!==c.live) throw httpError(409,'Checkout environment mismatch.');
  if(session.payment_status!=='paid') return {fulfilled:false};
  const items=session.line_items?.data;
  if(session.mode!=='payment' || session.currency!=='usd' || session.amount_total!==500 ||
     items?.length!==1 || items[0].price?.id!==c.STRIPE_LISTING_PRICE_ID || items[0].quantity!==1 ||
     !UUID.test(session.metadata?.order_id||'') || !UUID.test(session.metadata?.listing_id||'') || !UUID.test(session.metadata?.seller_id||'')) {
    throw httpError(409,'Payment details do not match this listing. Please contact support.');
  }
  return rpc(c,'billing_fulfill_listing',{
    p_order_id:session.metadata.order_id,p_session_id:session.id,p_seller_id:session.metadata.seller_id,
    p_listing_id:session.metadata.listing_id,p_customer_id:typeof session.customer==='string'?session.customer:null,
    p_payment_intent_id:typeof session.payment_intent==='string'?session.payment_intent:null,
  });
}
module.exports={UUID,httpError,config,rpc,seller,stripe,method,failure,fulfill};
