const b=require('./billing');
const LOOKUP='wheelswap_unlimited_monthly_v1';
async function price(c,client) {
 const prices=await client.prices.list({lookup_keys:[LOOKUP],active:true,limit:2});
 const p=prices.data[0];
 if(prices.data.length!==1||p.livemode!==c.live||p.unit_amount!==2500||p.currency!=='usd'||p.type!=='recurring'||p.recurring?.interval!=='month'||p.recurring.interval_count!==1) throw b.httpError(503,'Monthly posting is temporarily unavailable. You can still use the $5 listing option.');
 return p;
}
async function account(c,user) {
 return b.rpc(c,'billing_subscription_account',{p_seller_id:user.id});
}
async function sync(c,client,id,expectedSeller) {
 // Retrieve current state instead of trusting an old or reordered webhook payload.
 const sub=await client.subscriptions.retrieve(id,{expand:['latest_invoice']});
 const item=sub.items?.data?.[0],p=await price(c,client);
 if(!b.UUID.test(sub.metadata?.seller_id||'')||sub.metadata?.plan!==LOOKUP||sub.livemode!==c.live||sub.items.data.length!==1||item.price.id!==p.id||item.quantity!==1||!item.current_period_end||sub.pause_collection) throw b.httpError(409,'Subscription details need attention.');
 if(expectedSeller&&sub.metadata.seller_id!==expectedSeller) throw b.httpError(404,'Subscription not found.');
 const effectiveStatus=sub.status==='active'&&sub.latest_invoice?.status!=='paid'?'payment_pending':sub.status;
 const end=new Date(item.current_period_end*1000).toISOString();
 await b.rpc(c,'billing_sync_subscription',{p_subscription_id:sub.id,p_seller_id:sub.metadata.seller_id,p_customer_id:typeof sub.customer==='string'?sub.customer:sub.customer.id,p_status:effectiveStatus,p_period_end:end,p_cancel:!!(sub.cancel_at_period_end||sub.cancel_at)});
 return {id:sub.id,status:effectiveStatus,active:effectiveStatus==='active'&&item.current_period_end>Date.now()/1000,period_end:end,cancel_at_period_end:!!(sub.cancel_at_period_end||sub.cancel_at)};
}
async function current(c,client,user,a) {
 a=a||await account(c,user);
 if(!a.customer_id)return null;
 const subs=await client.subscriptions.list({customer:a.customer_id,status:'all',limit:100});
 const matches=subs.data.filter(s=>s.metadata?.seller_id===user.id&&s.metadata?.plan===LOOKUP);
 let best=null;
 for(const s of matches) {
  const latest=await sync(c,client,s.id,user.id);
  if(!best||latest.active||(!best.active&&['past_due','unpaid','incomplete'].includes(latest.status)))best=latest;
 }
 return best;
}
module.exports={LOOKUP,price,account,sync,current};
