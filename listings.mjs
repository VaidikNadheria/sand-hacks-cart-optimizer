const endpoint = 'https://api.brightdata.com/datasets/v3/scrape'

export function listingConfig(env) {
  const ids = {
    Target: env.BRIGHT_DATA_TARGET_DATASET_ID,
    Walmart: env.BRIGHT_DATA_WALMART_DATASET_ID || 'gd_l95fol7l1ru6rlo116',
  }
  return {
    key: env.BRIGHT_DATA_API_KEY,
    ids: Object.fromEntries(Object.entries(ids).filter(([, value]) => /^gd_[a-z0-9]+$/i.test(value ?? ''))),
  }
}

function listingUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    const host = url.hostname.replace(/^www\./, '')
    const targetId = host === 'target.com' && /^\/p\/[^/]+\/A-(\d+)\/?$/i.exec(url.pathname)?.[1]
    if (targetId) return {retailer:'Target',url:'https://www.target.com/p/-/A-'+targetId}
    const walmartId = host === 'walmart.com' && /^\/ip\/(?:[^/]+\/)?([a-z0-9]+)\/?$/i.exec(url.pathname)?.[1]
    if (walmartId) return {retailer:'Walmart',url:'https://www.walmart.com/ip/'+walmartId}
  } catch {
    return null
  }
  return null
}

const field = (...values) => values.find(value=>typeof value==='string' && value.trim())?.trim().slice(0,300) ?? ''

function listingDraft(record, listing) {
  if (!record || record.error || listingUrl(record.url)?.url !== listing.url) return null
  const title = field(record.title, record.product_name, record.name)
  if (!title) return null
  const amount = record.final_price ?? record.current_price
  const currency = field(record.currency).toUpperCase()
  const price = ['USD','$','US$'].includes(currency) && /^(?:\d{1,6})(?:\.\d{1,2})?$/.test(String(amount)) ? String(amount) : ''
  const status = field(record.availability, record.availability_status).toLowerCase().replace(/[_-]/g,' ')
  const available = record.in_stock===true || status==='in stock' ? true :
    record.in_stock===false || status==='out of stock' ? false : null
  const sellerName = field(record.seller_name, record.seller?.name, record.seller)
  const seller = listing.retailer==='Walmart' && sellerName.toLowerCase()==='walmart.com' ? 'Walmart' : sellerName
  return {...listing,title,price,seller,brand:field(record.brand),available,checkedAt:new Date().toISOString()}
}

export async function handleListings(req,res,config) {
  const path = req.url?.split('?')[0]
  if (path !== '/api/listing' && path !== '/api/listing/status') return false
  const reply = (status,data) => {
    res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'})
    res.end(JSON.stringify(data))
    return true
  }
  if (path === '/api/listing/status') return reply(200,{enabled:Boolean(config.key && Object.keys(config.ids).length)})
  if (req.method !== 'POST' || req.headers['content-type']?.split(';')[0] !== 'application/json') {
    return reply(405,{error:'Expected a JSON POST.'})
  }
  let listing
  try {
    let body = ''
    for await (const chunk of req) {
      body += chunk
      if (body.length > 4000) return reply(413,{error:'Listing URL is too long.'})
    }
    listing = listingUrl(JSON.parse(body)?.url)
  } catch {
    return reply(400,{error:'Enter a valid listing URL.'})
  }
  if (!listing) return reply(400,{error:'Paste a Target or Walmart product URL.'})
  const dataset = config.ids[listing.retailer]
  if (!config.key || !dataset) return reply(503,{error:'Live lookup is unavailable for this retailer. You can still enter the offer manually.'})

  try {
    const response = await fetch(endpoint+'?'+new URLSearchParams({dataset_id:dataset,format:'json'}),{
      method:'POST',
      headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json'},
      body:JSON.stringify({input:[{url:listing.url}]}),
      signal:AbortSignal.timeout(65000),
    })
    if (response.status===202) return reply(504,{error:'The provider needs more time for this listing. Open the listing to enter the offer manually.'})
    if (!response.ok) return reply(502,{error:'Bright Data lookup returned HTTP '+response.status+'. You can still enter the offer manually.'})
    const records = await response.json()
    const matches = Array.isArray(records) ? records.map(record=>listingDraft(record,listing)).filter(Boolean) : []
    if (matches.length!==1) return reply(502,{error:'Could not confirm a single matching listing. Enter the offer manually.'})
    return reply(200,matches[0])
  } catch {
    return reply(502,{error:'Could not retrieve the listing. You can still enter the offer manually.'})
  }
}
