const { timingSafeEqual } = require('node:crypto');
const VISITOR_FIELDS = ['visitors','visitors_7_days','visitors_30_days','visitors_all_time'];
const FIELDS = ['new_accounts','new_listings','total_accounts','total_listings','active_listings','messages'];
function authorized(value, token) {
  if (!token || typeof value !== 'string') return false;
  const a=Buffer.from(value), b=Buffer.from('Bearer '+token);
  return a.length===b.length && timingSafeEqual(a,b);
}
module.exports = async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed'});}
  if(!authorized(req.headers.authorization,process.env.REPORT_TOKEN))return res.status(401).json({error:'Unauthorized'});
  if(!process.env.RESEND_API_KEY)return res.status(503).json({error:'Email is not configured'});
  let body=req.body;
  try{if(typeof body==='string')body=JSON.parse(body);}catch{return res.status(400).json({error:'Invalid report'});}
  if(!body || !/^\d{4}-\d{2}-\d{2}$/.test(body.date||'') || FIELDS.some(k=>!Number.isSafeInteger(body[k])||body[k]<0) || VISITOR_FIELDS.some(k=>body[k]!==undefined&&(!Number.isSafeInteger(body[k])||body[k]<0)))
    return res.status(400).json({error:'Invalid report'});
  const text=[
    'WheelSwap daily report — '+body.date+' (Central time)','',
    'New accounts: '+body.new_accounts,'New listings: '+body.new_listings,'Messages sent: '+body.messages,'',
    'Current totals','Accounts: '+body.total_accounts,'Listings: '+body.total_listings,'Active listings: '+body.active_listings,'',
    ...(VISITOR_FIELDS.every(k=>body[k]!==undefined)?[
      'Website visitors (unique browsers)',
      'Report day: '+body.visitors,
      'Last 7 days: '+body.visitors_7_days,
      'Last 30 days: '+body.visitors_30_days,
      'Since tracking began: '+body.visitors_all_time,
      'Tracking began October 27, 2026. Earlier visits are unavailable. Repeat visits from the same browser count once per period.'
    ]:['Visitors: unavailable — visitor totals were not supplied.']),
    'Payment totals: unavailable in this report.'
  ].join('\n');
  try {
    const response=await fetch('https://api.resend.com/emails',{
      method:'POST',signal:AbortSignal.timeout(20000),
      headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'wheelswap-daily-report/'+body.date},
      body:JSON.stringify({from:'WheelSwap <noreply@wheelswapusa.com>',to:['Ewinton7754@gmail.com'],subject:'WheelSwap Daily Update — '+body.date,text})
    });
    const result=await response.json();
    if(!response.ok||!result.id)return res.status(502).json({error:'Email provider did not accept the report'});
    return res.status(200).json({accepted:true,id:result.id});
  } catch {
    return res.status(502).json({error:'Email provider unavailable'});
  }
};
