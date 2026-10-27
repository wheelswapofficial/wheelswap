const b=require('../server/billing'),s=require('../server/subscriptions');
module.exports=async function(req,res) {
 if(!b.method(req,res,'POST'))return;
 try {
  const c=b.config(),user=await b.seller(c,req),client=b.stripe(c);
  let a=await s.account(c,user);
  const existing=await s.current(c,client,user,a);
  const action=req.body?.action||'status';
  if(action==='status')return res.json({subscription:existing});
  if(action==='cancel') {
   if(!existing||!['active','past_due','unpaid'].includes(existing.status))throw b.httpError(409,'No renewable subscription was found.');
   await client.subscriptions.update(existing.id,{cancel_at_period_end:true});
   return res.json({subscription:await s.sync(c,client,existing.id,user.id)});
  }
  if(action!=='checkout')throw b.httpError(400,'Invalid subscription action.');
  if(existing&&!['canceled','incomplete_expired'].includes(existing.status))return res.json({subscription:existing,already_subscribed:true});
  const plan=req.body?.plan||'monthly',spec=Object.hasOwn(s.PLANS,plan)?s.PLANS[plan]:null;
  if(!spec)throw b.httpError(400,'Choose a valid membership plan.');
  const p=await s.price(c,client,plan);
  if(!a.customer_id) {
   const customer=await client.customers.create({email:user.email,metadata:{seller_id:user.id}},{idempotencyKey:'wheelswap-customer-'+user.id});
   a=await b.rpc(c,'billing_subscription_account',{p_seller_id:user.id,p_customer_id:customer.id});
  }
  if(a.session_id) {
   const session=await client.checkout.sessions.retrieve(a.session_id);
   if(session.status==='open'&&session.url) {
    if(session.metadata?.plan===spec.lookup)return res.json({url:session.url});
    await client.checkout.sessions.expire(session.id);
    session.status='expired';
   }
   if(session.status==='complete'&&(!existing||!['canceled','incomplete_expired'].includes(existing.status)))return res.json({processing:true});
   if(!['expired','complete'].includes(session.status))throw b.httpError(409,'Please retry from My Garage.');
   a=await b.rpc(c,'billing_subscription_account',{p_seller_id:user.id,p_session_id:a.session_id,p_expire:true});
  }
  const session=await client.checkout.sessions.create({
   mode:'subscription',customer:a.customer_id,line_items:[{price:p.id,quantity:1}],
   subscription_data:{metadata:{seller_id:user.id,plan:spec.lookup}},metadata:{seller_id:user.id,plan:spec.lookup,...(plan==='annual'?{surprise_box:'one_at_signup'}:{})},
   ...(plan==='annual'?{shipping_address_collection:{allowed_countries:['US']},customer_update:{shipping:'auto'}}:{}),
   success_url:c.APP_URL+'/?membership=success',cancel_url:c.APP_URL+'/?membership=cancel',
   integration_identifier:'wheelswap_'+plan+'_qmxrptza',
   custom_text:{submit:{message:plan==='annual'?'$260 USD per year for unlimited new listings, plus one surprise box with a shirt and little goodies after your initial payment. US shipping included. Renews annually until canceled in My Garage. Goodies vary.':'$25 USD per month for unlimited new listings. Renews monthly until canceled. Cancel in My Garage. Existing listings remain posted after cancellation.'}},
  },{idempotencyKey:'wheelswap-subscription-'+a.checkout_token});
  await b.rpc(c,'billing_subscription_account',{p_seller_id:user.id,p_session_id:session.id});
  return res.json({url:session.url});
 }catch(error){return b.failure(res,error);}
};
