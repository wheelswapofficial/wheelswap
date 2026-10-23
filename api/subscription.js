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
  if(existing&&['active','past_due','unpaid','incomplete','paused'].includes(existing.status))return res.json({subscription:existing,already_subscribed:true});
  const p=await s.price(c,client);
  if(!a.customer_id) {
   const customer=await client.customers.create({email:user.email,metadata:{seller_id:user.id}},{idempotencyKey:'wheelswap-customer-'+user.id});
   a=await b.rpc(c,'billing_subscription_account',{p_seller_id:user.id,p_customer_id:customer.id});
  }
  if(a.session_id) {
   const session=await client.checkout.sessions.retrieve(a.session_id);
   if(session.status==='open'&&session.url)return res.json({url:session.url});
   if(session.status==='complete'&&(!existing||!['canceled','incomplete_expired'].includes(existing.status)))return res.json({processing:true});
   if(!['expired','complete'].includes(session.status))throw b.httpError(409,'Please retry from My Garage.');
   a=await b.rpc(c,'billing_subscription_account',{p_seller_id:user.id,p_session_id:a.session_id,p_expire:true});
  }
  const session=await client.checkout.sessions.create({
   mode:'subscription',customer:a.customer_id,line_items:[{price:p.id,quantity:1}],
   subscription_data:{metadata:{seller_id:user.id,plan:s.LOOKUP}},metadata:{seller_id:user.id,plan:s.LOOKUP},
   success_url:c.APP_URL+'/?membership=success',cancel_url:c.APP_URL+'/?membership=cancel',
   integration_identifier:'wheelswap_monthly_qmxrptza',
   custom_text:{submit:{message:'$25 USD per month for unlimited new listings. Renews monthly until canceled. Cancel in My Garage. Existing listings remain posted after cancellation.'}},
  },{idempotencyKey:'wheelswap-subscription-'+a.checkout_token});
  await b.rpc(c,'billing_subscription_account',{p_seller_id:user.id,p_session_id:session.id});
  return res.json({url:session.url});
 }catch(error){return b.failure(res,error);}
};
