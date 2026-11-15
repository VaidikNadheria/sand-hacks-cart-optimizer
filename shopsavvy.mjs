import {recentHistorical, reviewFit, searchQuery} from './src/fit.ts'

const base = 'https://api.shopsavvy.com/v1'
const shortlistLimit = 3
const freshness = 48 * 60 * 60 * 1000
const stores = {Target:'target.com',Walmart:'walmart.com',Amazon:'amazon.com'}

export function offerTiming(value,now=Date.now()) {
  const seen = typeof value==='string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : NaN
  const lastSeen = Number.isFinite(seen)?new Date(seen).toISOString():''
  return {lastSeen,stale:!lastSeen || seen>now || now-seen>freshness}
}

function providerRows(payload, field) {
  if (field==='data' && Array.isArray(payload)) return payload
  if (payload?.success!==true || !Array.isArray(payload[field])) throw new Error('ShopSavvy returned an unreadable response.')
  return payload[field]
}

async function request(key,path,body,signal) {
  const response = await fetch(base+path,{
    headers:{Authorization:'Bearer '+key,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal,
  })
  if (!response.ok) throw new Error('ShopSavvy returned HTTP '+response.status+'.')
  return response.json()
}

export function shoppingLine(value) {
  const short = input=>typeof input==='string'?input.trim().slice(0,300):''
  const tags = input=>Array.isArray(input)?input.slice(0,15).map(short).filter(Boolean):[]
  if (!short(value?.product)) return null
  return {id:'provider-search',product:short(value.product),query:short(value.query),exact:short(value.exact),brand:short(value.brand),
    size:short(value.size),must:tags(value.must),preferences:tags(value.preferences),flexible:[],multi:value.multi===true,
    quantity:1,priceCap:null}
}

function barcodeIdentifier(value) {
  if (Number.isSafeInteger(value) && value>0) return String(value)
  const barcode = typeof value==='string'?value.trim():''
  return /^\d{1,250}$/.test(barcode) && /[1-9]/.test(barcode)?barcode:''
}
function productIdentifier(product) {
  const fallback = typeof product.shopsavvy==='string'?product.shopsavvy.trim():''
  return barcodeIdentifier(product.barcode) || (/^(?:products\/)?[\w-]{1,240}$/.test(fallback)?fallback:'')
}
function retailerMatches(value,retailer) {
  if (typeof value!=='string') return false
  const name = value.trim().toLowerCase().replace(/^www\./,'')
  return name===retailer.toLowerCase() || name===stores[retailer]
}

function productDraft(product) {
  const title = typeof product?.title==='string'?product.title:''
  const sizes = [...new Set([...title.matchAll(/\b(\d+(?:\.\d+)?)\s*(fl\.?\s*oz|fluid ounces?|ounces?|oz|ml)\b/gi)]
    .map(([,amount,unit])=>amount+' '+(/^fl/i.test(unit)?'fl oz':/^ounce/i.test(unit)?'oz':unit.toLowerCase())))]
  return {title,brand:typeof product?.brand==='string'?product.brand:'',size:sizes.length===1?sizes[0]:'',
    evidence:typeof product?.description==='string'?product.description.slice(0,900):'',lead:true,
    seller:'',price:'',available:null,checkedAt:'',url:'',retailer:'Target'}
}

function matchesProduct(line,product) {
  const draft = productDraft(product)
  if (!draft.title) return false
  const fit = reviewFit(line,draft)
  return fit.relevant && !fit.missing.includes('exact product identity')
}

function identifierMatches(product,listing) {
  const value = product.identifiers?.[listing.retailer.toLowerCase()] ??
    (listing.retailer==='Amazon'?product.amazon:null)
  const id = listing.url.split('/').at(-1).replace(/^A-/i,'').toLowerCase()
  return [value].flat().some(entry=>String(entry).replace(/^A-/i,'').toLowerCase()===id)
}

function linkEvidence(line,raw,listing,product) {
  const url = new URL(raw)
  const slug = url.pathname.split('/').filter(Boolean).find((part,index)=>index===1)
  const id = listing.url.split('/').at(-1).replace(/^A-/,'')
  if (!slug || slug==='-' || slug===id) {
    return {supported:identifierMatches(product,listing),conflict:false}
  }
  const title = slug.replace(/-/g,' ')
  if (/\b(?:hydrocortisone|anti itch)\b/i.test(title) && /lotion/i.test(product.title) && !/hydrocortisone|anti itch/i.test(product.title)) {
    return {supported:false,conflict:true}
  }
  const size = /\b(\d+(?:\.\d+)?)\s*(fl oz|oz|ml)\b/i.exec(title)?.slice(1).join(' ')??''
  const productSize = productDraft(product).size
  const check = reviewFit({...line,exact:'',size:line.size||productSize}, {...productDraft({title}),size})
  const productCheck = reviewFit({...line,exact:'',size:''},productDraft(product))
  const supported = check.productMatch && !check.missing.includes('size or package format') &&
    check.tags.length===productCheck.tags.length && (!line.exact || reviewFit(line,{...productDraft({title}),size}).relevant)
  const numbers = text=>[...text.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:pk|pack|ct|count)\b/gi)].map(match=>Number(match[1]))
  const catalogPack = numbers(product.title)[0]
  const linkPack = numbers(title)[0]
  return {supported,conflict:!check.productMatch || check.conflicts.length>0 ||
    (catalogPack!=null && linkPack!=null && catalogPack!==linkPack)}
}

function fallbackKey(product) {
  const asin = product.identifiers?.amazon ?? product.amazon
  if (typeof asin==='string' && /^[A-Z0-9]{10}$/i.test(asin)) return asin.toUpperCase()
  const barcode = barcodeIdentifier(product.barcode ?? product.identifiers?.barcode)
  if (![8,12,13,14].includes(barcode.length)) return ''
  return [...barcode].reverse().reduce((total,digit,index)=>total+Number(digit)*(index%2?3:1),0)%10===0?barcode:''
}
function exactOffers(key,id,signal,jobs) {
  const cached = jobs.get(id)
  if (cached && cached.until>Date.now()) return cached.promise
  if (jobs.size>=50) jobs.delete(jobs.keys().next().value)
  const job = {until:Date.now()+120000,promise:request(key,'/products/offers?'+new URLSearchParams({ids:id}),null,signal)
    .then(data=>providerRows(data,'data')).catch(error=>{
      if (jobs.get(id)===job) jobs.delete(id)
      throw error
    })}
  jobs.set(id,job)
  return job.promise
}

export async function shopSavvySearch(key,line,identifier,normalize,canonical,jobs=new Map(),exactItem) {
  const signal = AbortSignal.timeout(8500)
  let candidates
  let rows
  if (exactItem) {
    const data = await exactOffers(key,exactItem.upc,signal,jobs)
    const product=data.find(entry=>barcodeIdentifier(entry.barcode??entry.identifiers?.barcode)===exactItem.upc &&
      identifierMatches(entry,canonical(exactItem.source)))
    if (!product) return []
    candidates=[{product,id:exactItem.upc}]
    rows=[{identifier:exactItem.upc,status:'found',product,offers:product.offers}]
  } else if (identifier && canonical(identifier)?.retailer==='Amazon') {
    const data = await exactOffers(key,new URL(identifier).pathname.split('/').at(-1),signal,jobs)
    const product = data.find(entry=>identifierMatches(entry,canonical(identifier)))
    if (!product) return []
    candidates = [{product,id:identifier}]
    rows = [{identifier,status:'found',product,offers:product.offers}]
  } else if (identifier) {
    const data = await request(key,'/products?'+new URLSearchParams({ids:identifier}),null,signal)
    candidates = providerRows(data,'data').filter(product=>product.match?.by==='url')
      .slice(0,1).map(product=>({product,id:identifier}))
  } else {
    const discovery = {...line,must:line.must.filter(tag=>!/^for /i.test(tag)).slice(0,2)}
    const data = await request(key,'/products/search?'+new URLSearchParams({q:searchQuery(discovery,true),limit:'6'}),null,signal)
    candidates = providerRows(data,'data').filter(product=>matchesProduct(line,product))
      .map(product=>({product,id:productIdentifier(product)}))
      .filter(candidate=>typeof candidate.id==='string' && candidate.id.length<=250)
      .slice(0,shortlistLimit)
  }
  const ids = [...new Set(candidates.map(candidate=>candidate.id))]
  if (!ids.length) return []
  if (!rows) {
    const payload = await request(key,'/products/batch',{identifiers:ids,include:['offers']},signal)
    rows = providerRows(payload,'results')
  }
  const drafts = []
  const diagnostics = {rawOffers:0,rejected:{}}
  const reject = reason => { diagnostics.rejected[reason] = (diagnostics.rejected[reason]??0)+1 }
  const normalizeRows = (rows, exact=false) => {
    for (const row of rows) {
      const matchedId = typeof row?.identifier==='string'?row.identifier:barcodeIdentifier(row?.identifier)
      if (row?.status!=='found' || (!exact && !ids.includes(matchedId)) || !Array.isArray(row.offers)) continue
      diagnostics.rawOffers += row.offers.length
      const product = row.product
      if (!product?.title || (line && !matchesProduct(line,product))) {
        for (const _ of row.offers) reject('product mismatch')
        continue
      }
      const candidate = !exact && candidates.find(entry=>entry.id===matchedId)?.product
      if (candidate?.shopsavvy && candidate.shopsavvy!==product.shopsavvy) continue
      for (const offer of row.offers) {
        const raw = offer?.URL
        const listing = canonical(raw)
        if (!listing || !retailerMatches(offer.retailer,listing.retailer)) {
          reject('unsupported retailer or listing URL')
          continue
        }
        if (identifier && listing.url!==identifier) {
          reject('different exact listing')
          continue
        }
        // The offers endpoint serves USD. Treat only an absent currency as the documented default.
        const currency = offer.currency===undefined?'USD':typeof offer.currency==='string'?offer.currency.trim().toUpperCase():''
        if (currency!=='USD') { reject('non-USD price'); continue }
        if (offer.condition && offer.condition!=='new') { reject('condition'); continue }
        const exactListing = identifierMatches(product,listing)
        if (listing.retailer==='Amazon' && !exactListing) { reject('unconfirmed Amazon variant'); continue }
        const identity = line && listing.retailer!=='Amazon' && !exactListing ? linkEvidence(line,raw,listing,product) : {supported:exactListing,conflict:false}
        if (identity.conflict) { reject('variant conflict'); continue }
        const draft = normalize({
          url:listing.url,title:product.title,brand:product.brand,description:product.description,
          specifications:product.attributes,image_urls:product.images,price:offer.price,currency,
          seller:offer.seller,
          rating:product.rating?.value,review_count:product.rating?.count,
          in_stock:offer.availability==='in'?true:offer.availability==='out'?false:null,
        },listing)
        if (!draft) { reject('malformed listing'); continue }
        drafts.push({...draft,offerUrl:raw,provider:'ShopSavvy',checkedAt:'',...offerTiming(offer.timestamp),
          variantUnconfirmed:!identity.supported && !exactListing,exactListing,reviewSource:'catalog'})
      }
    }
  }
  normalizeRows(rows)
  if (!identifier && !exactItem && !drafts.some(draft=>draft.pack!=null && !draft.variantUnconfirmed &&
      (!draft.stale && draft.available===true && draft.price && draft.seller || draft.exactListing && draft.available!==false && draft.price && recentHistorical(draft.lastSeen)))) {
    const lookups = new Map()
    for (const {product} of candidates) {
      const id = fallbackKey(product)
      if (id && !lookups.has(id) && lookups.size<2) lookups.set(id,product)
    }
    await Promise.all([...lookups].map(async ([id,original])=>{
      try {
        const result = await exactOffers(key,id,signal,jobs)
        const product = result.find(entry=>fallbackKey(entry)===id ||
          [entry.barcode,entry.identifiers?.barcode].some(barcode=>barcodeIdentifier(barcode)===id))
        if (product) {
          const originalCode = barcodeIdentifier(original.barcode ?? original.identifiers?.barcode).replace(/^0+/,'')
          const foundCode = barcodeIdentifier(product.barcode ?? product.identifiers?.barcode).replace(/^0+/,'')
          const differentBrand = original.brand && product.brand && original.brand.toLowerCase()!==product.brand.toLowerCase()
          const originalSize = productDraft(original).size
          const foundSize = productDraft(product).size
          if ((originalCode && foundCode && originalCode!==foundCode) || differentBrand ||
              (originalSize && foundSize && originalSize!==foundSize)) {
            reject('exact lookup product conflict')
            return
          }
          normalizeRows([{identifier:id,status:'found',product,offers:product.offers}],true)
        }
      } catch (error) { console.debug('Exact quote lookup unavailable',error?.name) }
    }))
  }
  console.debug('Marketplace normalization',diagnostics)
  // Same product page can carry many marketplace quotes. Prefer current first-party evidence.
  const usable = draft=>draft.price && draft.pack!=null && !draft.variantUnconfirmed ?
    (!draft.stale && draft.available===true && draft.seller?3:draft.exactListing && draft.available!==false && recentHistorical(draft.lastSeen)?2:1):0
  drafts.sort((a,b)=>usable(b)-usable(a) || Number(a.stale)-Number(b.stale) || Number(b.exactListing)-Number(a.exactListing) ||
    Number(b.available===true)-Number(a.available===true) ||
    (exactItem?Number(a.price)-Number(b.price):0) ||     Number(b.seller===b.retailer)-Number(a.seller===a.retailer) || b.lastSeen.localeCompare(a.lastSeen))
  return [...new Map(drafts.reverse().map(draft=>[draft.url,draft])).values()].reverse().slice(0,6)
}
