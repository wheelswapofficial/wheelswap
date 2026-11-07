const b = require('../server/billing');
// Public readiness signal only; never return configuration or provider errors.
module.exports = async function handler(req, res) {
  if (!b.method(req, res, 'GET')) return;
  try {
    const c = b.config();
    const price = await b.stripe(c).prices.retrieve(c.STRIPE_LISTING_PRICE_ID);
    if (!price.active || price.livemode !== c.live || price.type !== 'one_time' ||
        ![100,250,500].includes(price.unit_amount) || price.currency !== 'usd') {
      return res.status(503).json({ready:false});
    }
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
    return res.json({ready:true, live:c.live, listing_fee:1, monthly_fee:10, annual_fee:100, currency:'USD'});
  } catch {
    return res.status(503).json({ready:false});
  }
};
