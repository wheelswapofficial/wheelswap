const b=require('../server/billing'),f=require('../server/featured');
module.exports=async function handler(req,res){
 if(!b.method(req,res,'POST'))return;
 try{
  const c=b.config(),user=await b.seller(c,req),id=req.body?.listing_id;
  if(!b.UUID.test(id||''))throw b.httpError(400,'Choose a valid listing.');
  const client=b.stripe(c);
  let order=await b.rpc(c,'feature_prepare',{p_seller_id:user.id,p_listing_id:id});
  if(order.active)return res.json(order);
  if(order.session_id){
   const existing=await client.checkout.sessions.retrieve(order.session_id);
   if(existing.payment_status==='paid')return res.json(await f.fulfill(c,client,existing.id,user.id));
   if(existing.status==='complete')return res.json({processing:true});
   if(existing.status==='open'&&existing.url)return res.json({url:existing.url});
   if(existing.status!=='expired')throw b.httpError(409,'Please retry from My Garage.');
   await b.rpc(c,'feature_session',{p_order_id:order.order_id,p_seller_id:user.id,p_session_id:existing.id,p_expire:true});
   order=await b.rpc(c,'feature_prepare',{p_seller_id:user.id,p_listing_id:id});
  }else if(Date.parse(order.expires_at)<Date.now()+31*60000){
   // An interrupted checkout without a linked session may still have been created at Stripe.
   // Reuse the same idempotency key and original expiry; do not create a second charge opportunity.
   if(Date.parse(order.expires_at)<=Date.now())throw b.httpError(409,'This checkout needs review. Please contact WheelSwap before starting another featured payment.');
  }
  if(order.active)return res.json(order);
  const session=await client.checkout.sessions.create({
   mode:'payment',allow_promotion_codes:false,
   integration_identifier:'wheelswap_feature_qplmzrta',
   line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:f.AMOUNT,product_data:{name:'WheelSwap featured listing — 7 days',description:'One-time featured placement. No automatic renewal. Sales and views are not guaranteed.'}}}],
   success_url:c.APP_URL+'/?featured=success&session_id={CHECKOUT_SESSION_ID}',cancel_url:c.APP_URL+'/?featured=cancel',
   expires_at:Math.floor(Date.parse(order.expires_at)/1000),
   metadata:{kind:f.KIND,order_id:order.order_id,seller_id:user.id,listing_id:id},
  },{idempotencyKey:'wheelswap-feature-'+order.order_id});
  await b.rpc(c,'feature_session',{p_order_id:order.order_id,p_seller_id:user.id,p_session_id:session.id,p_expire:false});
  if(session.payment_status==='paid')return res.json(await f.fulfill(c,client,session.id,user.id));
  if(session.status==='complete')return res.json({processing:true});
  if(!session.url)throw b.httpError(409,'Checkout ended. Please retry.');
  return res.json({url:session.url});
 }catch(e){return b.failure(res,e);}
};
