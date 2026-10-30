const b=require('./billing');
const LOOKUP='wheelswap_unlimited_monthly_v1';
const ANNUAL='wheelswap_annual_260_surprise_box';
const PLANS={monthly:{lookup:LOOKUP,amount:2500,interval:'month'},annual:{lookup:ANNUAL,amount:26000,interval:'year'}};
function isPlan(lookup){return Object.values(PLANS).some(p=>p.lookup===lookup);}
async function price(c,client,plan='monthly') {
 const spec=Object.hasOwn(PLANS,plan)?PLANS[plan]:null;if(!spec)throw b.httpError(400,'Choose a valid membership plan.');
 const prices=await client.prices.list({lookup_keys:[spec.lookup],active:true,limit:2});
 const p=prices.data[0];
 if(prices.data.length!==1||p.livemode!==c.live||p.unit_amount!==spec.amount||p.currency!=='usd'||p.type!=='recurring'||p.recurring?.interval!==spec.interval||p.recurring.interval_count!==1) throw b.httpError(503,'This membership is temporarily unavailable. You can still use the $2.50 listing option.');
 return p;
}
async function account(c,user) {
 return b.rpc(c,'billing_subscription_account',{p_seller_id:user.id});
}
async function sync(c,client,id,expectedSeller) {
 // Retrieve current state instead of trusting an old or reordered webhook payload.
 const sub=await client.subscriptions.retrieve(id,{expand:['latest_invoice']});
 const item=sub.items?.data?.[0],p=await price(c,client,sub.metadata?.plan===ANNUAL?'annual':'monthly');
 if(!b.UUID.test(sub.metadata?.seller_id||'')||!isPlan(sub.metadata?.plan)||sub.livemode!==c.live||sub.items.data.length!==1||item.price.id!==p.id||item.quantity!==1||!item.current_period_end||sub.pause_collection) throw b.httpError(409,'Subscription details need attention.');
 if(expectedSeller&&sub.metadata.seller_id!==expectedSeller) throw b.httpError(404,'Subscription not found.');
 const effectiveStatus=sub.status==='active'&&sub.latest_invoice?.status!=='paid'?'payment_pending':sub.status;
 const end=new Date(item.current_period_end*1000).toISOString();
 await b.rpc(c,'billing_sync_subscription',{p_subscription_id:sub.id,p_seller_id:sub.metadata.seller_id,p_customer_id:typeof sub.customer==='string'?sub.customer:sub.customer.id,p_status:effectiveStatus,p_period_end:end,p_cancel:!!(sub.cancel_at_period_end||sub.cancel_at)});
 return {id:sub.id,plan:sub.metadata.plan===ANNUAL?'annual':'monthly',status:effectiveStatus,active:effectiveStatus==='active'&&item.current_period_end>Date.now()/1000,period_end:end,cancel_at_period_end:!!(sub.cancel_at_period_end||sub.cancel_at)};
}
async function current(c,client,user,a) {
 a=a||await account(c,user);
 if(!a.customer_id)return null;
 const subs=await client.subscriptions.list({customer:a.customer_id,status:'all',limit:100});
 if(subs.has_more)throw b.httpError(503,'Please contact support to review your membership history.');
 const matches=subs.data.filter(s=>s.metadata?.seller_id===user.id&&isPlan(s.metadata?.plan));
 let best=null;
 for(const s of matches) {
  const latest=await sync(c,client,s.id,user.id);
  if(!best||latest.active||(!best.active&&!['canceled','incomplete_expired'].includes(latest.status)))best=latest;
 }
 return best;
}
async function fulfillBox(c,client,id) {
 const session=await client.checkout.sessions.retrieve(id,{expand:['line_items']});
 if(session.metadata?.plan!==ANNUAL||session.payment_status!=='paid')return;
 const p=await price(c,client,'annual'),items=session.line_items?.data;
 if(session.livemode!==c.live||session.mode!=='subscription'||session.currency!=='usd'||session.amount_subtotal!==26000||items?.length!==1||items[0].price?.id!==p.id||items[0].quantity!==1)throw b.httpError(409,'Annual checkout details do not match.');
 const shipping=session.collected_information?.shipping_details||session.shipping_details;
 if(!shipping?.name||!shipping.address?.line1||shipping.address.country!=='US')throw b.httpError(409,'Surprise box shipping address is missing.');
 const sub=await sync(c,client,typeof session.subscription==='string'?session.subscription:session.subscription.id,session.metadata.seller_id);
 if(!sub.active)return;
 // This is a manual shipping queue in Stripe. Never overwrite a shipped status on retries.
 if(!session.metadata.box_status)await client.checkout.sessions.update(id,{metadata:{box_status:'awaiting_shipment'}});
}
module.exports={LOOKUP,ANNUAL,PLANS,isPlan,price,account,sync,current,fulfillBox};
