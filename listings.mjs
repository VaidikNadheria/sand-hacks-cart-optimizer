import {canonicalJudgeUrl, exactItems, judgeQuotes} from './judge-quotes.mjs'
import {randomUUID} from 'node:crypto'
import {setTimeout as wait} from 'node:timers/promises'
import {amazonProductUrl} from './src/fit.ts'
import {offerTiming,shoppingLine,shopSavvySearch} from './shopsavvy.mjs'

const datasetApi = 'https://api.brightdata.com/datasets/v3'
const validId = value => /^gd_[a-z0-9]+$/i.test(value ?? '')
const domains = {Target:'target.com',Walmart:'walmart.com'}
const productPaths = {Target:'/p/',Walmart:'/ip/'}
const keywordFields = ['keyword','search_keyword','keywords','search_term','search_query','query']
const searchLimit = 4

export function listingConfig(env) {
  const ids = {
    Target: env.BRIGHT_DATA_TARGET_DATASET_ID || 'gd_ltppk5mx2lp0v1k0vo',
    Walmart: env.BRIGHT_DATA_WALMART_DATASET_ID || 'gd_l95fol7l1ru6rlo116',
  }
  return {
    key: env.BRIGHT_DATA_API_KEY,
    shopSavvyKey: env.SHOPSAVVY_API_KEY?.trim(),
    ids: Object.fromEntries(Object.entries(ids).filter(([, value]) => validId(value))),
    zone: env.BRIGHT_DATA_SERP_ZONE,
    serpJobs: new Map(),
    productJobs: new Map(),
    discovery: new Map(),
    searchJobs: new Map(),
    exactOfferJobs: new Map(),
    judgeHandoffs: new Map(),
  }
}

export function listingUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    const host = url.hostname.replace(/^www\./, '')
    const targetId = host === 'target.com' && /^\/p\/(?:[^/]+\/)?(?:-\/)?A-(\d+)\/?$/i.exec(url.pathname)?.[1]
    if (targetId) return {retailer:'Target',url:'https://www.target.com/p/-/A-'+targetId}
    const walmartId = host === 'walmart.com' && /^\/ip\/(?:[^/]+\/)?([a-z0-9]+)\/?$/i.exec(url.pathname)?.[1]
    if (walmartId) return {retailer:'Walmart',url:'https://www.walmart.com/ip/'+walmartId}
  } catch {
    return null
  }
  return null
}

function shopSavvyListing(value) {
  const listing = listingUrl(value)
  const amazon = typeof value==='string' && amazonProductUrl(value)
  return listing ?? (amazon?{retailer:'Amazon',url:amazon}:null)
}

const field = (...values) => values.find(value=>typeof value==='string' && value.trim())?.trim().slice(0,300) ?? ''

function pageText(value) {
  const entities = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}
  return String(value??'').replace(/<[^>]*>/g,' ')
    .replace(/&(amp|lt|gt|quot|apos|nbsp);|&#(x[\da-f]+|\d+);/gi,(_,name,number)=>{
      if (name) return entities[name.toLowerCase()]
      const code = /^x/i.test(number) ? Number.parseInt(number.slice(1),16) : Number(number)
      return code<=0x10ffff ? String.fromCodePoint(code) : ''
    }).replace(/\s+/g,' ').trim()
}

function reviewStats(record) {
  const rawCount = record.reviews_count ?? record.review_count ?? record.reviews_cnt ?? record.reviewCount ?? record.aggregateRating?.reviewCount
  const count = String(rawCount).trim()
  const reviewCount = /^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(count) ? Number(count.replaceAll(',','')) : NaN
  const rawRating = record.rating?.ratingValue ?? record.rating ?? record.aggregateRating?.ratingValue
  const rating = Number(rawRating)
  const reviews = Array.isArray(record.top_reviews) ? record.top_reviews : []
  const reviewExcerpts = [...new Set(reviews.map(review=>field(review,review?.review_text,review?.text,review?.review,review?.comment,review?.content))
    .map(excerpt=>excerpt.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()).filter(Boolean))].slice(0,2)
  return {reviewCount:Number.isSafeInteger(reviewCount) ? reviewCount : null,
    rating:rating>=1 && rating<=5 ? rating : null,reviewExcerpts}
}

function packCount(record, title) {
  const labels = /^(?:pack (?:size|count|quantity)|count per pack|package quantity|items per pack|units per pack|number of items)$/i
  const specs = record.specifications
  const values = Array.isArray(specs)
    ? specs.filter(spec=>labels.test(field(spec?.name,spec?.label,spec?.key))).map(spec=>spec.value)
    : Object.entries(specs && typeof specs==='object' ? specs : {}).filter(([key])=>labels.test(key)).map(([,value])=>value)
  const titlePack = /\b(?:pack of (\d+)|(\d+)\s*[- ]?\s*(?:pack|pk|count|ct)|(\d+)\s+(?:bottles?|tubes?|jars?|cans?)|(?:single|one)\s+(?:bottle|tube|jar|can))\b/i.exec(title)
  const statedPack = titlePack && (titlePack.slice(1).find(Boolean) ?? '1')
  const counts = [record.pack_count,record.pack_size,record.items_per_pack,...values,statedPack]
    .map(value=>/^\s*(\d{1,2})(?:\s*[- ]?\s*(?:pack|pk|bottles?|tubes?|jars?|cans?|units?))?\s*$/i.exec(String(value))?.[1])
    .map(Number).filter(count=>count>0)
  return new Set(counts).size===1 ? counts[0] : null
}

function listingSpecs(record) {
  const labels = /^(?:material|primary material|volume capacity|capacity|net volume|net content|(?:product |actual )?scent(?: name)?|fragrance(?: name)?|screen diagonal|display size|color(?: category)?|actual color|water bottle (?:feature|lid style)|product line|screen size|resolution|model(?: number)?|voltage|power|finish)$/i
  const rows = Array.isArray(record.specifications)?record.specifications:
    Object.entries(record.specifications??{}).map(([name,value])=>({name,value}))
  const variant = Array.isArray(record.product_variant)?record.product_variant.map(entry=>({name:entry?.type,value:entry?.value})):[]
  return [...rows,...variant].flatMap(row=>{
    const name = field(row?.name,row?.label,row?.key)
    const value = typeof row?.value==='number' && Number.isFinite(row.value) && /^(?:screen (?:size|diagonal)|display size)$/i.test(name)
      ? String(row.value) : field(row?.value)
    return labels.test(name) && value ? [{name,value}] : []
  }).slice(0,12)
}

function imageUrl(record) {
  const urls = [record.main_image,record.image_url,...(Array.isArray(record.image_urls)?record.image_urls:[])]
  return urls.find(value=>{
    if (typeof value!=='string') return false
    try { const url = new URL(value); return url.protocol==='https:' && !url.username && !url.password }
    catch { return false }
  })
}

function listingDraft(record, listing) {
  if (!record || record.error || shopSavvyListing(record.url)?.url !== listing.url) return null
  const title = field(record.title, record.product_name, record.name)
  if (!title) return null
  const amount = record.final_price ?? record.current_price ?? record.price
  const currency = field(record.currency).toUpperCase()
  const price = ['USD','$','US$'].includes(currency) && /^(?:\d{1,6})(?:\.\d{1,2})?$/.test(String(amount)) ? String(amount) : ''
  const status = field(record.availability, record.availability_status).toLowerCase().replace(/[_-]/g,' ')
  const available = record.in_stock===false || status==='out of stock' ? false :
    record.in_stock===true || status==='in stock' ? true :
    typeof record.is_available==='boolean' ? record.is_available : null
  const sellerName = field(record.seller_name, record.seller?.name, record.seller)
  const seller = [listing.retailer.toLowerCase(),domains[listing.retailer]].includes(sellerName.toLowerCase()) ? listing.retailer : sellerName
  const specs = listingSpecs(record)
  const features = Array.isArray(record.product_details)?record.product_details:[]
  const evidence = [...specs.map(({name,value})=>name+': '+value),...features,
      record.short_description,record.description,record.product_description,record.manufacturer_description]
    .filter(value=>typeof value==='string').join(' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,900)
  const sizes = [...new Set([...title.matchAll(/\b(\d+(?:\.\d+)?)\s*(fl\.?\s*oz|fluid ounces?|ounces?|oz|ml)\b/gi)]
    .map(([,amount,unit])=>amount+' '+(/^fl/i.test(unit)?'fl oz':/^ounce/i.test(unit)?'oz':unit.toLowerCase())))]
  const pack = packCount(record,title)
  const offerUrl = [record.product_url,record.url].filter(value=>listingUrl(value)?.url===listing.url)
    .find(value=>/selectedSellerId|sellerId/i.test(value))
  const image = imageUrl(record)
  const shippingAvailable = typeof record.shipping_available==='boolean' ? record.shipping_available : null
  const observed = field(record.last_seen,record.timestamp)
  return {...listing,title,price,seller,pack,brand:field(record.brand,record.product_brand),available,...reviewStats(record),
    evidence,attributes:specs, size:sizes.length===1?sizes[0]:'',shippingAvailable,
    ...(image?{image}:{}),...(offerUrl?{offerUrl}:{}),checkedAt:new Date().toISOString(),...(observed?offerTiming(observed):{})}
}

async function targetPreview(listing) {
  const response = await fetch(listing.url,{redirect:'manual',signal:AbortSignal.timeout(8000)})
  if (!response.ok) return null
  const page = await response.text()
  const json = page.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1]
  let queries
  try { queries = JSON.parse(json ?? 'null')?.props?.dehydratedState?.queries } catch {}
  const id = listing.url.split('A-').at(-1)
  const product = (Array.isArray(queries)?queries:[]).flatMap(query=>query?.state?.data?.data?.data_source_modules ?? [])
    .map(module=>module?.module_data?.data?.product).find(entry=>String(entry?.tcin)===id)
  const details = product?.item?.product_description
  let title = pageText(details?.title)
  if (!title) {
    const metadata = new Map()
    for (const [tag] of page.matchAll(/<meta\b[^>]*>/gi)) {
      const name = tag.match(/\bproperty=["'](og:url|og:title)["']/i)?.[1]?.toLowerCase()
      const value = tag.match(/\bcontent=(?:"([^"]*)"|'([^']*)')/i)
      if (name && value) metadata.set(name,value[1] ?? value[2])
    }
    if (listingUrl(pageText(metadata.get('og:url')))?.url!==listing.url) return null
    title = pageText(metadata.get('og:title'))
  }
  if (!title) return null
  const bullets = Array.isArray(details?.bullet_descriptions) ? details.bullet_descriptions.map(pageText) : []
  const pack = bullets.map(bullet=>/^package quantity:\s*(\d{1,2})$/i.exec(bullet)?.[1]).find(Boolean)
  const reviews = product?.ratings_and_reviews?.statistics
  const draft = listingDraft({url:listing.url,title,brand:product?.item?.primary_brand?.name,pack_count:pack,
    description:[...bullets,pageText(details?.downstream_description)].join(' '),
    rating:reviews?.rating?.average,reviews_count:reviews?.review_count},listing)
  return draft && {...draft,lead:true,preview:true}
}

export function parseSerp(data, retailer) {
  if (!Array.isArray(data?.organic)) throw new Error('Bright Data did not return Light JSON organic results.')
  const leads = new Map()
  for (const result of data.organic) {
    const listing = listingUrl(result?.link ?? result?.url)
    const title = field(result?.title)
    if (!title || listing?.retailer!==retailer || leads.has(listing.url)) continue
    leads.set(listing.url,{...listing,title,snippet:field(result.description,result.snippet),lead:true,
      price:'',seller:'',brand:'',pack:packCount({},title),available:null,checkedAt:''})
    if (leads.size===searchLimit) break
  }
  let shoppingCount = 0
  for (const result of Array.isArray(data.shopping) ? data.shopping : []) {
    const listing = listingUrl(result?.link)
    const title = field(result?.title)
    if (!title || listing?.retailer!==retailer) continue
    const {rating,reviewCount} = reviewStats(result)
    const existing = leads.get(listing.url)
    if (existing?.reviewSource) continue
    if (existing && rating==null && reviewCount==null) continue
    leads.set(listing.url,{...(existing ?? {...listing,title,lead:true,price:'',seller:'',brand:'',
      pack:packCount({},title),available:null,checkedAt:''}),rating,reviewCount,...(rating!=null||reviewCount!=null?{reviewSource:'search'}:{})})
    if (++shoppingCount===searchLimit) break
  }
  return [...leads.values()]
}

async function discoverLinks(config, retailer, query) {
  const url = new URL('https://www.google.com/search')
  url.search = new URLSearchParams({q:query+' site:'+domains[retailer]+productPaths[retailer],gl:'us',hl:'en'})
  const response = await fetch('https://api.brightdata.com/request',{
    method:'POST',headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json'},
    body:JSON.stringify({zone:config.zone,url:url.href,format:'raw',data_format:'parsed_light'}),
    signal:AbortSignal.timeout(18000),
  })
  const code = response.headers.get('x-brd-error-code')
  const errorCode = /^[a-z0-9_-]{1,64}$/i.test(code ?? '') ? ' ('+code+')' : ''
  if (code?.toLowerCase()==='captcha') throw new Error('Search provider was blocked (CAPTCHA). Try the retailer keyword search.')
  if (!response.ok) throw new Error('Bright Data SERP returned HTTP '+response.status+errorCode+'.')
  if (code) throw new Error('Bright Data reported a SERP provider error'+errorCode+'.')
  const body = await response.text()
  if (!body.trim()) throw new Error('Bright Data returned an empty SERP response.')
  let data
  try { data = JSON.parse(body) }
  catch { throw new Error('Bright Data returned a SERP response that was not JSON.') }
  return parseSerp(data,retailer)
}

function serpSearch(config, retailer, query) {
  const key = JSON.stringify([retailer,query.toLowerCase().replace(/\s+/g,' ')])
  const existing = config.serpJobs.get(key)
  if (existing && existing.until>Date.now()) return existing.promise
  if (config.serpJobs.size>=100) config.serpJobs.delete(config.serpJobs.keys().next().value)
  const promise = discoverLinks(config,retailer,query).catch(error=>{
    if (config.serpJobs.get(key)?.promise===promise) config.serpJobs.delete(key)
    throw error
  })
  config.serpJobs.set(key,{promise,until:Date.now()+120000})
  return promise
}

function brightData(config, path, body, timeout = 10000) {
  return fetch(datasetApi+path,{
    headers:{Authorization:'Bearer '+config.key,...(body && {'Content-Type':'application/json'})},
    ...(body && {method:'POST',body:JSON.stringify(body)}),
    signal:AbortSignal.timeout(timeout),
  })
}

async function waitForListingUpdate(pending, code) {
  const timer = new AbortController()
  try {
    return await Promise.race([
      pending,
      wait(10000,undefined,{signal:timer.signal}).then(()=>{
        throw Object.assign(new Error('The retailer request is still running.'),{code})
      }),
    ])
  } finally {
    timer.abort()
  }
}

async function findKeywordScraper(config, retailer) {
  const domain = domains[retailer]
  const configured = config.ids[retailer]
  const filters = [...(configured ? [{dataset_id:configured}] : []),{domain},{domain:'www.'+domain}]
  for (const filter of filters) {
    const response = await brightData(config,'/scrapers?'+new URLSearchParams(filter))
    if (!response.ok) throw new Error('Scraper catalogue returned HTTP '+response.status+'.')
    const result = await response.json()
    const rows = Array.isArray(result) ? result : result.datasets ?? result.data
    if (!Array.isArray(rows)) throw new Error('Bright Data returned an unreadable scraper catalogue.')
    for (const row of rows) {
      if (!validId(row?.id) || row.domain?.replace(/^www\./,'')!==domain ||
          (!/^(target|walmart)$|\bproducts?\b/i.test(row.name ?? '') && row.id!==configured)) continue
      const variant = ['keyword','keywords'].find(name=>row.scrapers?.['discover_by_'+name])
      if (!variant) continue
      const inputs = row.scrapers['discover_by_'+variant].input_schema
      if (!Array.isArray(inputs)) continue
      const keyword = inputs.find(input=>keywordFields.includes(input?.name))
      if (!keyword) continue
      const required = inputs.filter(input=>input?.required===true && input.name!==keyword.name)
      if (required.some(input=>input.name!=='domain' || input.type!=='url')) continue
      const defaults = required.length ? {domain:'https://www.'+domain+'/'} : {}
      return {id:row.id,variant,keyword:keyword.name,array:keyword.type==='array',defaults}
    }
  }
  throw new Error('No product keyword scraper was available for '+retailer+' in the Bright Data catalogue.')
}

async function searchRetailer(config,retailer,query,mode) {
  const jobKey = JSON.stringify([retailer,query.toLowerCase()])
  const existing = config.searchJobs.get(jobKey)
  if (mode==='resume' && (!existing || existing.until<=Date.now())) {
    throw Object.assign(new Error('Catalog job expired. Search again to start a new job.'),{code:'SEARCH_EXPIRED'})
  }
  let job = existing && existing.until>Date.now() && mode!=='restart' ? existing : undefined
  if (!job) {
    let cached = config.discovery.get(retailer)
    if (!cached || cached.until<=Date.now()) {
      cached = {until:Date.now()+600000,scraper:findKeywordScraper(config,retailer)}
      config.discovery.set(retailer,cached)
    }
    const snapshot = cached.scraper.catch(error=>{
      if (config.discovery.get(retailer)===cached) config.discovery.delete(retailer)
      throw error
    }).then(({id,variant,keyword,array,defaults})=>
      startSearch(config,id,variant,{...defaults,[keyword]:array?[query]:query}))
    if (config.searchJobs.size>=100) config.searchJobs.delete(config.searchJobs.keys().next().value)
    job = {until:Date.now()+900000,snapshot}
    config.searchJobs.set(jobKey,job)
  }
  const snapshot = await job.snapshot
  if (!job.poll) {
    job.poll = searchSnapshot(config,snapshot).catch(error=>{
      if (error.code==='SEARCH_PENDING' || error.name==='TimeoutError') job.poll = undefined
      throw error
    })
  }
  const records = await job.poll
  if (!Array.isArray(records)) throw new Error('Bright Data returned unreadable product results.')
  if (records.length && records.every(record=>record?.error)) throw new Error('Bright Data could not retrieve product listings.')
  const drafts = new Map()
  for (const record of records) {
    const listing = listingUrl(record?.url)
    if (listing?.retailer!==retailer || drafts.has(listing.url)) continue
    const draft = listingDraft(record,listing)
    if (draft) drafts.set(listing.url,draft)
    if (drafts.size===searchLimit) break
  }
  return [...drafts.values()]
}

async function startSearch(config,id,variant,input) {
  const params = new URLSearchParams({dataset_id:id,type:'discover_new',discover_by:variant})
  const response = await brightData(config,'/trigger?'+params,{
    input:[input],limit_per_input:searchLimit,
  },20000)
  if (!response.ok) throw new Error('Product search returned HTTP '+response.status+'.')
  const {snapshot_id:snapshot} = await response.json()
  if (typeof snapshot!=='string' || !/^s[a-z]*_[a-z0-9]+$/i.test(snapshot)) throw new Error('Product search did not return a valid snapshot.')
  return snapshot
}

async function searchSnapshot(config,snapshot,timeout=90000) {
  const deadline = Date.now()+timeout
  while (Date.now()<deadline) {
    const progress = await brightData(config,'/progress/'+snapshot,undefined,Math.max(1,Math.min(10000,deadline-Date.now())))
    if (progress.status===404 || progress.status===410) throw Object.assign(new Error('Catalog job expired.'),{code:'SEARCH_EXPIRED'})
    if (!progress.ok) throw new Error('Product search progress returned HTTP '+progress.status+'.')
    const {status} = await progress.json()
    if (['failed','canceled','cancelled'].includes(status)) {
      throw Object.assign(new Error('Product search failed in Bright Data.'),{code:'SEARCH_FAILED'})
    }
    if (status==='ready') {
      const download = await brightData(config,'/snapshot/'+snapshot+'?format=json',undefined,Math.max(1,Math.min(20000,deadline-Date.now())))
      if (download.status===404 || download.status===410) throw Object.assign(new Error('Catalog job expired.'),{code:'SEARCH_EXPIRED'})
      if (!download.ok) throw new Error('Could not download product results (HTTP '+download.status+').')
      if (download.status!==202) return download.json()
    }
    await wait(Math.max(0,Math.min(5000,deadline-Date.now())))
  }
  throw Object.assign(new Error('Bright Data is still processing this search. Search again to check for results.'),{code:'SEARCH_PENDING'})
}

async function readProduct(config,dataset,listing,job) {
  const params = new URLSearchParams({dataset_id:dataset,format:'json'})
  let records
  if (!job.snapshot) {
    const response = await brightData(config,'/scrape?'+params,{input:[{url:listing.url}]},65000)
    if (!response.ok) throw Object.assign(new Error('Bright Data returned HTTP '+response.status+' for this product page.'),{code:'LOOKUP_RESPONSE'})
    if (response.status===202) {
      const {snapshot_id:snapshot} = await response.json()
      if (typeof snapshot!=='string' || !/^s[a-z]*_[a-z0-9]+$/i.test(snapshot)) {
        throw Object.assign(new Error('Product details are still pending and no usable snapshot was returned.'),{code:'LOOKUP_PENDING'})
      }
      job.snapshot = snapshot
    } else records = await response.json()
  }
  if (job.snapshot) records = await searchSnapshot(config,job.snapshot,60000)
  const matches = Array.isArray(records) ? records.map(record=>listingDraft(record,listing)).filter(Boolean) : []
  if (matches.length!==1) throw Object.assign(new Error('Bright Data did not return a single record matching this listing.'),{code:'LOOKUP_MISMATCH'})
  return matches[0]
}

function productLookup(config,dataset,listing,retry) {
  const key = listing.url
  let job = config.productJobs.get(key)
  if (!job || job.until<=Date.now() || (retry && ['failed','expired'].includes(job.state))) {
    if (config.productJobs.size>=100) {
      for (const [url,current] of config.productJobs) if (current.until<=Date.now()) config.productJobs.delete(url)
      if (!config.productJobs.has(key) && config.productJobs.size>=100) throw new Error('Too many product lookups are open. Try again shortly.')
    }
    job = {until:Date.now()+900000,state:'pending'}
    config.productJobs.set(key,job)
    job.promise = readProduct(config,dataset,listing,job).then(draft=>{
      job.state = 'succeeded'
      job.draft = draft
      job.until = Date.now()+120000
      return draft
    },error=>{
      job.state = error.code==='SEARCH_EXPIRED'?'expired':'failed'
      job.error = error
      throw error
    })
  }
  return job.promise
}

function productFailure(error) {
  if (error?.code==='SEARCH_EXPIRED') return {status:410,error:'Product check expired. Retry to start a new check.'}
  if (error?.code==='LOOKUP_PENDING' || error?.code==='SEARCH_PENDING') {
    return {status:504,error:error.code==='LOOKUP_PENDING'?error.message:'Bright Data did not finish the product snapshot before the provider deadline.'}
  }
  if (error?.name==='TimeoutError') return {status:504,error:'Bright Data timed out while checking the product page.'}
  if (['LOOKUP_RESPONSE','LOOKUP_MISMATCH','SEARCH_FAILED'].includes(error?.code)) return {status:502,error:error.message}
  return {status:502,error:'Could not retrieve the listing. You can still enter the offer manually.'}
}

export async function handleListings(req,res,config) {
  const path = req.url?.split('?')[0]
  if (path==='/api/judge-handoff' && req.method==='GET') {
    const token=new URL(req.url,'http://localhost').searchParams.get('token')
    const entry=config.judgeHandoffs.get(token)
    res.writeHead(entry && entry.until>Date.now()?200:404,{'Content-Type':'application/json','Cache-Control':'no-store'})
    res.end(JSON.stringify(entry && entry.until>Date.now()?entry.value:{error:'Comparison expired. Run it again.'}))
    return true
  }
  if (path !== '/api/judge-compare' && path !== '/api/listing' && path !== '/api/listing/status' && path !== '/api/listing/search' && path !== '/api/listing/shopsavvy') return false
  const reply = (status,data) => {
    res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'})
    res.end(JSON.stringify(data))
    return true
  }
  if (path === '/api/listing/status') return reply(200,{enabled:Boolean(config.key && Object.keys(config.ids).length),search:Boolean(config.key || config.shopSavvyKey),serp:Boolean(config.key && config.zone),bright:Boolean(config.key),shopSavvy:Boolean(config.shopSavvyKey),targetOptional:true,savedResults:true})
  if (req.method !== 'POST' || req.headers['content-type']?.split(';')[0] !== 'application/json') {
    return reply(405,{error:'Expected a JSON POST.'})
  }
  let input
  try {
    let body = ''
    for await (const chunk of req) {
      body += chunk
      if (body.length > 4000) return reply(413,{error:'Listing request is too long.'})
    }
    input = JSON.parse(body)
  } catch {
    return reply(400,{error:'Enter a valid listing request.'})
  }
  if (path==='/api/judge-compare') {
    const source=canonicalJudgeUrl(input?.url)
    const item=Object.values(exactItems).find(record=>record.source===source)
    const normalize=value=>String(value??'').toLowerCase().replace(/\bo(u)?nces?\b/g,'oz').replace(/\s+/g,'')
    if (!item || normalize(input.size)!==normalize(item.size) || (input.pack!=null && input.pack!==item.pack) ||
        typeof input.title!=='string' || !/vanicream/i.test(input.title) ||
        !(item.key.endsWith('deo')?/deodorant|anti.?perspirant/i:/body wash/i).test(input.title)) {
      return reply(422,{error:'Could not confirm the exact product variant and size.'})
    }
    let live=[]
    if (config.shopSavvyKey) {
      try {
        live=await shopSavvySearch(config.shopSavvyKey,null,null,listingDraft,shopSavvyListing,config.exactOfferJobs,item)
      }catch {}
    }
    const saved=judgeQuotes.filter(quote=>quote.key===item.key)
    const packConfirmed=input.pack===item.pack || live.some(quote=>quote.url===source && quote.pack===item.pack &&
      normalize(quote.size)===normalize(item.size) && quote.exactListing)
    if (!packConfirmed) return reply(422,{error:'The selected pack could not be verified on the page or in the exact product record.'})
    const bounds = value=>{const age=Date.now()-Date.parse(value);return age>=0&&age<=14*86400000}
    const offers=[...live.filter(draft=>draft.exactListing && draft.pack===item.pack && normalize(draft.size)===normalize(item.size) && draft.price &&
      draft.available!==false && bounds(draft.lastSeen)),...saved.filter(draft=>draft.price&&bounds(draft.lastSeen))]
    const unique=[...new Map(offers.reverse().map(offer=>[offer.url,offer])).values()].sort((a,b)=>Number(a.price)-Number(b.price))
    return reply(200,{offers:unique.map(draft=>{
      if (config.judgeHandoffs.size>=100) config.judgeHandoffs.delete(config.judgeHandoffs.keys().next().value)
      const token=randomUUID()
      const value={key:item.key,draft:saved.includes(draft)?draft:{...draft,savedQuote:true,stale:true,available:null}}
      config.judgeHandoffs.set(token,{until:Date.now()+300000,value})
      return {...draft,token}
    })})
  }
  if (path === '/api/listing/shopsavvy') {
    if (!config.shopSavvyKey) return reply(503,{error:'Marketplace price lookup is unavailable.'})
    const line = shoppingLine(input?.line)
    const listing = input?.url ? shopSavvyListing(input.url) : null
    if (input?.url && !listing || !line && !listing) return reply(400,{error:'Enter shopping requirements or a supported retailer URL.'})
    try {
      return reply(200,{offers:await shopSavvySearch(config.shopSavvyKey,line,listing?.url,listingDraft,shopSavvyListing,config.exactOfferJobs)})
    } catch (error) {
      const message = error?.name==='TimeoutError'?'ShopSavvy timed out.':
        /^ShopSavvy (?:returned|timed out)/.test(error?.message??'')?error.message:'ShopSavvy could not retrieve offers.'
      console.debug('Marketplace quote error',message)
      return reply(502,{error:'Couldn’t check marketplace prices.'})
    }
  }
  if (path === '/api/listing/search') {
    const query = typeof input?.query==='string' ? input.query.trim() : ''
    if (!query || query.length>320) return reply(400,{error:'Enter a product name and requirements under 320 characters.'})
    const retailer = input?.retailer
    if (retailer!==undefined && (typeof retailer!=='string' || !Object.hasOwn(domains,retailer))) {
      return reply(400,{error:'Choose Target or Walmart.'})
    }
    if (!config.key) return reply(503,{error:'Live product search needs a Bright Data API token.'})
    const retailers = retailer ? [retailer] : Object.keys(domains)
    const results = await Promise.allSettled(retailers.map(retailer=>config.zone && input.mode!=='keyword' ?
      serpSearch(config,retailer,query) : waitForListingUpdate(searchRetailer(config,retailer,query,input.catalog),'SEARCH_PENDING')))
    return reply(200,{results:Object.fromEntries(results.map((result,index)=>{
      const retailer = retailers[index]
      if (result.status==='fulfilled') return [retailer,{offers:result.value}]
      if (result.reason?.code==='SEARCH_PENDING') return [retailer,{pending:true}]
      if (result.reason?.code==='SEARCH_EXPIRED') return [retailer,{expired:true,error:'Catalog job expired. Search again to start a new job.'}]
      if (result.reason?.code==='SEARCH_FAILED') return [retailer,{failed:true,error:result.reason.message}]
      if (result.reason?.cause?.code==='ECONNREFUSED') {
        return [retailer,{error:'The local server’s connection to Bright Data was refused. Restart Cartwise from Terminal and try again.'}]
      }
      if (result.reason?.name==='TimeoutError') return [retailer,{error:'Bright Data provider timed out.'}]
      if (result.reason?.name==='TypeError') {
        return [retailer,{error:'The local server could not reach Bright Data. Try again when the connection is available.'}]
      }
      return [retailer,{failed:input.mode==='keyword',error:result.reason?.message ?? 'Search failed.'}]
    }))})
  }
  const listing = listingUrl(input?.url)
  if (!listing) return reply(400,{error:'Paste a Target or Walmart product URL.'})
  if (input.preview===true) {
    if (listing.retailer!=='Target') return reply(400,{error:'Page previews are available for Target listings.'})
    try {
      const preview = await targetPreview(listing)
      return preview ? reply(200,preview) : reply(404,{error:'No public product details were found.'})
    } catch {
      return reply(404,{error:'No public product details were found.'})
    }
  }
  const dataset = config.ids[listing.retailer]
  if (!config.key || !dataset) return reply(503,{error:'Live lookup is unavailable for this retailer. You can still enter the offer manually.'})

  if (input.operation==='status') {
    const job = config.productJobs.get(listing.url)
    if (!job || job.until<=Date.now() || job.state==='expired') {
      return reply(410,{state:'expired',error:'Product check expired. Retry to start a new check.'})
    }
    if (job.state==='pending') return reply(202,{state:'pending',pending:true})
    if (job.state==='succeeded') return reply(200,{state:'succeeded',...job.draft})
    const failure = productFailure(job.error)
    return reply(failure.status,{state:'failed',error:failure.error})
  }

  try {
    const pending = productLookup(config,dataset,listing,input.operation==='retry')
    const draft = await (input.quickCheck===true ? waitForListingUpdate(pending,'CHECK_PENDING') : pending)
    return reply(200,draft)
  } catch (error) {
    if (error?.code==='CHECK_PENDING') return reply(202,{pending:true})
    const failure = productFailure(error)
    if (input.quickCheck===true) return reply(failure.status,{state:failure.status===410?'expired':'failed',error:failure.error})
    return reply(failure.status,{error:failure.error})
  }
}
