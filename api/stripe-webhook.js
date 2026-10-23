const b=require('../server/billing');
const s=require('../server/subscriptions');
module.exports=async function handler(req,res) {
  if(!b.method(req,res,'POST')) return;
  let c,client,event;
  try {c=b.config();client=b.stripe(c);} catch(error) {return b.failure(res,error);}
  try {
    const chunks=[];let size=0;
    for await(const chunk of req) {
      size+=chunk.length;if(size>1024*1024) return res.status(413).json({error:'Request too large.'});
      chunks.push(Buffer.from(chunk));
    }
    event=client.webhooks.constructEvent(Buffer.concat(chunks),req.headers['stripe-signature'],c.STRIPE_WEBHOOK_SECRET);
  } catch {return res.status(400).json({error:'Invalid webhook signature.'});}
  if(event.livemode!==c.live) return res.status(400).json({error:'Environment mismatch.'});
  try {
    if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)) {
      if(event.data.object.metadata?.order_id) await b.fulfill(c,client,event.data.object.id);
    }
    const obj=event.data.object;
    if(event.type.startsWith('customer.subscription.')&&obj.metadata?.plan===s.LOOKUP)await s.sync(c,client,obj.id);
    if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)&&obj.metadata?.plan===s.LOOKUP&&obj.subscription)await s.sync(c,client,typeof obj.subscription==='string'?obj.subscription:obj.subscription.id);
    if(['invoice.paid','invoice.payment_failed'].includes(event.type)) {
      const id=obj.parent?.subscription_details?.subscription||obj.subscription;
      if(id) {const sub=await client.subscriptions.retrieve(typeof id==='string'?id:id.id);if(sub.metadata?.plan===s.LOOKUP)await s.sync(c,client,sub.id);}
    }
    return res.json({received:true});
  } catch(error) {return b.failure(res,error);}
};
module.exports.config={api:{bodyParser:false}};
