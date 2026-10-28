const {test}=require('node:test'),assert=require('node:assert/strict');
const {Readable}=require('node:stream'),Stripe=require('stripe');
const b=require('../server/billing'),f=require('../server/featured'),checkout=require('../api/feature-listing'),webhook=require('../api/stripe-webhook');
const uid='11111111-1111-4111-8111-111111111111',lid='aaaaaaaa-aaaa-4aaa-8aaa-000000000001',oid='bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
const session=()=>({id:'cs_test_feature123456',livemode:false,payment_status:'paid',status:'complete',mode:'payment',currency:'usd',amount_total:500,metadata:{kind:f.KIND,seller_id:uid,listing_id:lid,order_id:oid},line_items:{data:[{quantity:1,price:{unit_amount:500,currency:'usd',type:'one_time'}}]}});
const res=()=>({code:200,setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;return this;}});
test('featured checkout fixes price server-side, verifies ownership/payment, and fulfills signed webhooks only',async()=>{
 const original={...b},oldEnv={...process.env};let s=session(),calls=[],params,idempotencyKey;
 const signer=new Stripe('sk_test_mock');
 const client={checkout:{sessions:{retrieve:async()=>s,create:async(p,o)=>{params=p;idempotencyKey=o.idempotencyKey;return {id:s.id,url:'https://checkout.stripe.com/featured',status:'open',payment_status:'unpaid'};}}},webhooks:signer.webhooks};
 b.config=()=>({live:false,APP_URL:'https://www.wheelswapusa.com',STRIPE_WEBHOOK_SECRET:'whsec_feature'});b.seller=async(_c,req)=>{if(!req.headers.authorization)throw b.httpError(401,'Sign in');return {id:uid};};b.stripe=()=>client;b.rpc=async(_c,name,data)=>{calls.push({name,data});return name==='feature_prepare'?{order_id:oid,expires_at:new Date(Date.now()+35*60000).toISOString()}:{fulfilled:true};};
 try{
  let r=res();await checkout({method:'POST',headers:{},body:{listing_id:lid}},r);assert.equal(r.code,401);
  r=res();await checkout({method:'POST',headers:{authorization:'Bearer verified'},body:{listing_id:lid,price:1,seller_id:'attacker',success_url:'https://evil.test'}},r);
  assert.equal(r.code,200);assert.equal(params.line_items[0].price_data.unit_amount,500);assert.equal(params.line_items[0].price_data.currency,'usd');assert.equal(params.metadata.seller_id,uid);assert.equal(params.metadata.kind,f.KIND);assert.equal(params.mode,'payment');assert.match(params.success_url,/^https:\/\/www.wheelswapusa.com\/\?featured=success/);assert.equal(idempotencyKey,'wheelswap-feature-'+oid);
  calls=[];s.payment_status='unpaid';assert.deepEqual(await f.fulfill(b.config(),client,s.id,uid),{fulfilled:false});assert.equal(calls.length,0);
  s=session();s.amount_total=100;await assert.rejects(f.fulfill(b.config(),client,s.id,uid),/do not match/);assert.equal(calls.length,0);
  s=session();await assert.rejects(f.fulfill(b.config(),client,s.id,'other'),/not found/);s.livemode=true;await assert.rejects(f.fulfill(b.config(),client,s.id,uid),/environment/);
  s=session();await f.fulfill(b.config(),client,s.id,uid);assert.equal(calls.at(-1).name,'feature_fulfill');
  calls=[];const event={id:'evt_feature',livemode:false,type:'checkout.session.completed',data:{object:s}};const payload=JSON.stringify(event);const signature=signer.webhooks.generateTestHeaderString({payload,secret:'whsec_feature'});const req=Readable.from([Buffer.from(payload)]);Object.assign(req,{method:'POST',headers:{'stripe-signature':signature}});r=res();await webhook(req,r);assert.equal(r.code,200);assert.equal(calls.length,1);assert.equal(calls[0].name,'feature_fulfill');
  calls=[];const bad=Readable.from([Buffer.from(payload)]);Object.assign(bad,{method:'POST',headers:{'stripe-signature':'invalid'}});r=res();await webhook(bad,r);assert.equal(r.code,400);assert.equal(calls.length,0);
 }finally{Object.assign(b,original);process.env=oldEnv;}
});
