const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const vm=require('node:vm'),fs=require('node:fs');
const Stripe=require('stripe');
const b=require('../server/billing');
const create=require('../api/create-checkout-session'),status=require('../api/checkout-status'),webhook=require('../api/stripe-webhook');
const uid='11111111-1111-4111-8111-111111111111',listing='aaaaaaaa-aaaa-4aaa-8aaa-000000000004',order='bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
const session={id:'cs_test_1234567890123',livemode:false,status:'complete',payment_status:'paid',mode:'payment',currency:'usd',amount_total:250,line_items:{data:[{price:{id:'price_verified'},quantity:1}]},metadata:{seller_id:uid,listing_id:listing,order_id:order},payment_intent:'pi_verified',customer:'cus_verified'};
function res(){return {headers:{},code:200,setHeader(k,v){this.headers[k]=v},status(s){this.code=s;return this},json(x){this.body=x;return this}};}
function env(){Object.assign(process.env,{STRIPE_SECRET_KEY:'sk_test_mock',STRIPE_WEBHOOK_SECRET:'whsec_mock',STRIPE_LISTING_PRICE_ID:'price_verified',SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'private',APP_URL:'https://www.wheelswapusa.com',STRIPE_LIVEMODE:'false'});}
test('server: identity, prices, redirects, idempotency, settlement and signed raw webhooks',async()=>{
 const savedEnv={...process.env},savedFetch=global.fetch,originalStripe=b.stripe,originalRpc=b.rpc;
 env();let user={id:uid,email_confirmed_at:new Date().toISOString()},calls=[],params,key;
 global.fetch=async(url,options)=>{if(url.includes('/rest/v1/rpc/'))return new Response(JSON.stringify({fulfilled:true}));assert.ok(url.endsWith('/auth/v1/user'));assert.equal(options.headers.Authorization,'Bearer valid');return {ok:true,json:async()=>user};};
 let prep={published:false,order_id:order,expires_at:new Date(Date.now()+35*60000).toISOString()};
 b.rpc=async(c,name,body)=>{calls.push({name,body});return name==='billing_prepare_listing'?prep:{fulfilled:true};};
 let returned={id:session.id,payment_status:'unpaid',status:'open',url:'https://checkout.stripe.com/pay'};
 const stripeInstance=new Stripe('sk_test_mock');
 const fake={prices:{retrieve:async()=>({active:true,livemode:false,type:'one_time',unit_amount:250,currency:'usd'})},checkout:{sessions:{create:async(p,o)=>{params=p;key=o.idempotencyKey;return returned},retrieve:async()=>session}},webhooks:stripeInstance.webhooks};
 b.stripe=()=>fake;
 try {
  let r=res();await create({method:'GET',headers:{}},r);assert.equal(r.code,405);
  r=res();await create({method:'POST',headers:{},body:{listing_id:listing}},r);assert.equal(r.code,401);
  user={id:uid};r=res();await create({method:'POST',headers:{authorization:'Bearer valid'},body:{listing_id:listing}},r);assert.equal(r.code,403);user.email_confirmed_at='verified';
  r=res();await create({method:'POST',headers:{authorization:'Bearer valid'},body:{listing_id:'bad'}},r);assert.equal(r.code,400);
  r=res();await create({method:'POST',headers:{authorization:'Bearer valid'},body:{listing_id:listing,seller_id:'attacker',price:1,success_url:'https://evil.test'}},r);
  assert.equal(r.code,200);assert.equal(r.body.url,returned.url);assert.equal(calls[0].body.p_seller_id,uid);
  assert.equal(params.line_items[0].price,'price_verified');assert.equal(params.line_items[0].quantity,1);assert.equal(params.mode,'payment');assert.equal(params.payment_method_collection,undefined);
  assert.equal(params.success_url,'https://www.wheelswapusa.com/?checkout=success&session_id={CHECKOUT_SESSION_ID}');assert.equal(params.cancel_url,'https://www.wheelswapusa.com/?checkout=cancel');
  assert.equal(params.metadata.seller_id,uid);assert.equal(key,'wheelswap-listing-'+order);
  prep={published:true};r=res();await create({method:'POST',headers:{authorization:'Bearer valid'},body:{listing_id:listing}},r);assert.equal(r.body.published,true);
  // A completed delayed payment is reused and cannot create a second payment.
  prep={published:false,order_id:order,session_id:session.id};fake.checkout.sessions.retrieve=async()=>({...session,payment_status:'unpaid'});
  r=res();await create({method:'POST',headers:{authorization:'Bearer valid'},body:{listing_id:listing}},r);assert.equal(r.body.processing,true);
  fake.checkout.sessions.retrieve=async()=>session;
  r=res();await status({method:'POST',headers:{authorization:'Bearer valid'},body:{session_id:session.id}},r);assert.equal(r.body.fulfilled,true);
  fake.checkout.sessions.retrieve=async()=>({...session,metadata:{...session.metadata,seller_id:'other'}});
  r=res();await status({method:'POST',headers:{authorization:'Bearer valid'},body:{session_id:session.id}},r);assert.equal(r.code,404);
  fake.checkout.sessions.retrieve=async()=>({...session,amount_total:1});r=res();await status({method:'POST',headers:{authorization:'Bearer valid'},body:{session_id:session.id}},r);assert.equal(r.code,409);
  fake.checkout.sessions.retrieve=async()=>({...session,livemode:true});r=res();await status({method:'POST',headers:{authorization:'Bearer valid'},body:{session_id:session.id}},r);assert.equal(r.code,409);
  fake.checkout.sessions.retrieve=async()=>({...session,payment_status:'unpaid'});r=res();await status({method:'POST',headers:{authorization:'Bearer valid'},body:{session_id:session.id}},r);assert.equal(r.body.fulfilled,false);
  fake.checkout.sessions.retrieve=async()=>session;
  for(const type of ['checkout.session.completed','checkout.session.async_payment_succeeded']) {
   const payload=JSON.stringify({id:'evt_verified',type,livemode:false,data:{object:session}});
   const signature=stripeInstance.webhooks.generateTestHeaderString({payload,secret:'whsec_mock'});
   const req=Readable.from([Buffer.from(payload)]);req.method='POST';req.headers={'stripe-signature':signature};
   r=res();await webhook(req,r);assert.equal(r.body.received,true);
  }
  const req=Readable.from([Buffer.from('{}')]);req.method='POST';req.headers={'stripe-signature':'forged'};
  r=res();await webhook(req,r);assert.equal(r.code,400);
  delete process.env.STRIPE_SECRET_KEY;r=res();await create({method:'POST',headers:{authorization:'Bearer valid'},body:{listing_id:listing}},r);assert.equal(r.code,503);
 } finally {global.fetch=savedFetch;b.stripe=originalStripe;b.rpc=originalRpc;process.env=savedEnv;}
});
test('fulfillment only calls the datastore for a verified paid listing and preserves provider IDs',async()=>{
 const original=global.fetch;let count=0;
 global.fetch=async(url,opts)=>{count++;const body=JSON.parse(opts.body);assert.equal(body.p_seller_id,uid);assert.equal(body.p_order_id,order);assert.equal(body.p_session_id,session.id);assert.equal(body.p_customer_id,'cus_verified');return new Response(JSON.stringify({fulfilled:true}));};
 const c={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'private',STRIPE_LISTING_PRICE_ID:'price_verified',live:false};
 try {assert.equal((await b.fulfill(c,{checkout:{sessions:{retrieve:async()=>session}}},session.id,uid)).fulfilled,true);assert.equal(count,1);
 await b.fulfill(c,{checkout:{sessions:{retrieve:async()=>({...session,payment_status:'unpaid'})}}},session.id,uid);assert.equal(count,1);
 }finally{global.fetch=original;}
});
test('database RPC accepts empty successful responses when linking a checkout session',async()=>{
 const original=global.fetch;
 try {
  global.fetch=async()=>new Response(null,{status:204});
  assert.equal(await b.rpc({SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'private'},'billing_checkout_session',{}),null);
  global.fetch=async()=>new Response(JSON.stringify({published:true}));
  assert.deepEqual(await b.rpc({SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'private'},'billing_prepare_listing',{}),{published:true});
 }finally{global.fetch=original;}
});
test('browser: cancellation keeps draft, checkout requires consent, status uses existing login',async()=>{
 let assigned=null,confirmValue=false,requests=[];
 const ctx={URL,URLSearchParams,setTimeout,cloud:{auth:{getSession:async()=>({data:{session:{access_token:'existing'}}}),onAuthStateChange(){}}},currentUser:null,location:{search:'',assign:u=>assigned=u},history:{replaceState(){}},window:{confirm:()=>confirmValue},fetch:async(path,opts)=>{requests.push({path,...opts});return {ok:true,json:async()=>({url:'https://checkout.stripe.com/pay'})}}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('billing.js','utf8'),ctx);
 await assert.rejects(vm.runInContext(`publishListingAccess('${listing}')`,ctx),/draft is saved/);assert.equal(assigned,null);
 confirmValue=true;await assert.rejects(vm.runInContext(`publishListingAccess('${listing}')`,ctx),/Opening secure checkout/);assert.equal(assigned,'https://checkout.stripe.com/pay');assert.equal(requests[0].headers.Authorization,'Bearer existing');
});
