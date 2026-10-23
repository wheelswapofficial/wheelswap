const b=require('../server/billing');
const membership=require('../server/subscriptions');
module.exports=async function handler(req,res) {
  if(!b.method(req,res,'POST')) return;
  try {
    const c=b.config(), user=await b.seller(c,req);
    if(!b.UUID.test(req.body?.listing_id||'')) throw b.httpError(400,'Choose a valid listing.');
    const account=await membership.account(c,user);
    if(account.customer_id)await membership.current(c,b.stripe(c),user,account);
    let order=await b.rpc(c,'billing_prepare_listing',{p_seller_id:user.id,p_listing_id:req.body.listing_id});
    if(order.published) return res.json(order);
    const client=b.stripe(c),price=await client.prices.retrieve(c.STRIPE_LISTING_PRICE_ID);
    if(!price.active || price.livemode!==c.live || price.type!=='one_time' || price.unit_amount!==500 || price.currency!=='usd') throw b.httpError(503,'The listing price needs configuration. Your listing is saved.');
    if(order.session_id) {
      const existing=await client.checkout.sessions.retrieve(order.session_id);
      if(existing.payment_status==='paid') {
        await b.fulfill(c,client,existing.id,user.id);
        return res.json({published:true});
      }
      if(existing.status==='complete') return res.json({processing:true});
      if(existing.status==='open' && existing.url) return res.json({url:existing.url});
      if(existing.status!=='expired') throw b.httpError(409,'Please retry from My Garage.');
      await b.rpc(c,'billing_checkout_session',{p_order_id:order.order_id,p_seller_id:user.id,p_session_id:existing.id,p_expire:true});
      order=await b.rpc(c,'billing_prepare_listing',{p_seller_id:user.id,p_listing_id:req.body.listing_id});
      if(order.published) return res.json(order);
    }
    const session=await client.checkout.sessions.create({
      ui_mode:'hosted_page',mode:'payment',billing_address_collection:'auto',
      phone_number_collection:{enabled:false},automatic_tax:{enabled:false},allow_promotion_codes:false,
      submit_type:'auto',integration_identifier:'hosted_web_0001',origin_context:'web',
      success_url:c.APP_URL+'/?checkout=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url:c.APP_URL+'/?checkout=cancel',line_items:[{price:c.STRIPE_LISTING_PRICE_ID,quantity:1}],
      metadata:{order_id:order.order_id,seller_id:user.id,listing_id:req.body.listing_id},
      expires_at:Math.floor(new Date(order.expires_at).getTime()/1000),
    },{idempotencyKey:'wheelswap-listing-'+order.order_id});
    await b.rpc(c,'billing_checkout_session',{p_order_id:order.order_id,p_seller_id:user.id,p_session_id:session.id,p_expire:false});
    if(session.payment_status==='paid') {
      await b.fulfill(c,client,session.id,user.id);
      return res.json({published:true});
    }
    if(session.status==='complete') return res.json({processing:true});
    if(!session.url) throw b.httpError(409,'Checkout has ended. Retry from My Garage shortly.');
    return res.json({url:session.url});
  } catch(error) { return b.failure(res,error); }
};
