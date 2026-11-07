const {test}=require('node:test'),assert=require('node:assert/strict');
const b=require('../server/billing'),s=require('../server/subscriptions'),handler=require('../api/subscription');
const uid='11111111-1111-4111-8111-111111111111';
const c={live:false,APP_URL:'https://www.wheelswapusa.com'};
const price={id:'price_annual',active:true,livemode:false,unit_amount:26000,currency:'usd',type:'recurring',recurring:{interval:'year',interval_count:1}};
const sub={id:'sub_annual',livemode:false,status:'active',customer:'cus_seller',latest_invoice:{status:'paid'},metadata:{seller_id:uid,plan:s.ANNUAL},items:{data:[{price:{id:price.id},quantity:1,current_period_end:Math.floor(Date.now()/1000)+31536000}]}};
function res(){return {code:200,setHeader(){},status(n){this.code=n;return this},json(v){this.body=v;return this}};}
test('annual price and paid membership are verified before granting access',async()=>{
 const rpc=b.rpc;let calls=[];b.rpc=async(c,n,p)=>calls.push({n,p});
 const client={prices:{list:async()=>({data:[price]})},subscriptions:{retrieve:async()=>sub}};
 try {
  const result=await s.sync(c,client,sub.id,uid);assert.equal(result.active,true);assert.equal(result.plan,'annual');assert.equal(calls[0].p.p_seller_id,uid);
  client.subscriptions.retrieve=async()=>({...sub,latest_invoice:{status:'open'}});assert.equal((await s.sync(c,client,sub.id,uid)).active,false);assert.equal(calls.at(-1).p.p_status,'payment_pending');
  client.subscriptions.retrieve=async()=>sub;await assert.rejects(s.sync(c,client,sub.id,'another'),/not found/);
  client.prices.list=async()=>({data:[{...price,unit_amount:2500}]});await assert.rejects(s.price(c,client,'annual',true),/unavailable/);
  await assert.rejects(s.price(c,client,'__proto__'),/valid/);
 }finally{b.rpc=rpc;}
});
test('annual checkout uses $100 server price without shipping and blocks duplicate memberships',async()=>{
 const saved={config:b.config,seller:b.seller,stripe:b.stripe,rpc:b.rpc};let created,creates=0,existing=[];
 const client={prices:{list:async()=>({data:[price]})},subscriptions:{list:async()=>({data:existing}),retrieve:async()=>({...sub,latest_invoice:{status:'open'}})},checkout:{sessions:{create:async(p)=>{created=p;creates++;return {id:'cs_annual',url:'https://checkout.stripe.com/test'}}}}};
 b.config=()=>c;b.seller=async()=>({id:uid});b.stripe=()=>client;b.rpc=async()=>({customer_id:'cus_seller',checkout_token:'token'});
 try {
  let r=res();await handler({method:'POST',body:{action:'checkout',plan:'annual',amount:1}},r);assert.equal(r.code,200);assert.equal(created.line_items[0].price_data.unit_amount,10000);assert.equal(created.line_items[0].price_data.recurring.interval,'year');assert.equal(created.shipping_address_collection,undefined);assert.equal(created.metadata.surprise_box,undefined);assert.equal(created.metadata.plan,s.PLANS.annual.lookup);assert.match(created.custom_text.submit.message,/100/);
  existing=[sub];r=res();await handler({method:'POST',body:{action:'checkout',plan:'annual'}},r);assert.equal(r.body.already_subscribed,true);assert.equal(creates,1);
 }finally{Object.assign(b,saved);}
});
test('box queue only accepts a paid annual checkout, preserves shipped status on webhook replay',async()=>{
 const rpc=b.rpc;b.rpc=async()=>{};let writes=[];
 let session={id:'cs_annual',livemode:false,mode:'subscription',payment_status:'paid',currency:'usd',amount_subtotal:26000,metadata:{seller_id:uid,plan:s.ANNUAL},subscription:sub.id,line_items:{data:[{price:{id:price.id},quantity:1}]},collected_information:{shipping_details:{name:'Test Seller',address:{line1:'Test',country:'US'}}}};
 const client={prices:{list:async()=>({data:[price]})},subscriptions:{retrieve:async()=>sub},checkout:{sessions:{retrieve:async()=>session,update:async(id,p)=>writes.push({id,p})}}};
 try {
  await s.fulfillBox(c,client,session.id);assert.equal(writes[0].p.metadata.box_status,'awaiting_shipment');
  session.metadata.box_status='shipped';await s.fulfillBox(c,client,session.id);assert.equal(writes.length,1);
  session.payment_status='unpaid';await s.fulfillBox(c,client,session.id);assert.equal(writes.length,1);
  session.payment_status='paid';session.amount_subtotal=1;await assert.rejects(s.fulfillBox(c,client,session.id),/do not match/);assert.equal(writes.length,1);
 }finally{b.rpc=rpc;}
});

test('new monthly and annual memberships validate amount, product and interval',async()=>{
 const rpc=b.rpc;b.rpc=async()=>{};
 try {for(const [plan,spec] of Object.entries(s.PLANS)){
  const fresh={...sub,metadata:{seller_id:uid,plan:spec.lookup},items:{data:[{...sub.items.data[0],price:{product:s.PRODUCT,unit_amount:spec.amount,currency:'usd',type:'recurring',recurring:{interval:spec.interval,interval_count:1}}}]}};
  const client={subscriptions:{retrieve:async()=>fresh}};
  const result=await s.sync(c,client,fresh.id,uid);assert.equal(result.active,true);assert.equal(result.plan,plan);
  fresh.items.data[0].price.unit_amount=1;await assert.rejects(s.sync(c,client,fresh.id,uid),/need attention/);
 }}finally{b.rpc=rpc;}
});
