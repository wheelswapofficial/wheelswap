const b=require('../server/billing');
module.exports=async function handler(req,res) {
  if(!b.method(req,res,'POST')) return;
  try {
    const c=b.config(),user=await b.seller(c,req);
    const id=req.body?.session_id;
    if(typeof id!=='string'||!/^cs_[a-zA-Z0-9_]{10,255}$/.test(id)) throw b.httpError(400,'Invalid checkout.');
    return res.json(await b.fulfill(c,b.stripe(c),id,user.id));
  } catch(error) {return b.failure(res,error);}
};
