const b=require('./billing');
const KIND='featured_listing_7_days',AMOUNT=500;
async function fulfill(c,client,id,expectedSeller){
 const s=await client.checkout.sessions.retrieve(id,{expand:['line_items']});
 if(expectedSeller&&s.metadata?.seller_id!==expectedSeller)throw b.httpError(404,'Checkout not found.');
 if(s.livemode!==c.live)throw b.httpError(409,'Checkout environment mismatch.');
 if(s.payment_status!=='paid')return {fulfilled:false};
 const items=s.line_items?.data;
 if(s.metadata?.kind!==KIND||s.mode!=='payment'||s.currency!=='usd'||s.amount_total!==AMOUNT||items?.length!==1||items[0].quantity!==1||items[0].price?.unit_amount!==AMOUNT||items[0].price?.currency!=='usd'||items[0].price?.type!=='one_time'||!b.UUID.test(s.metadata?.order_id||'')||!b.UUID.test(s.metadata?.seller_id||'')||!b.UUID.test(s.metadata?.listing_id||''))throw b.httpError(409,'Featured payment details do not match.');
 return b.rpc(c,'feature_fulfill',{p_order_id:s.metadata.order_id,p_seller_id:s.metadata.seller_id,p_listing_id:s.metadata.listing_id,p_session_id:s.id});
}
module.exports={KIND,AMOUNT,fulfill};
