import type {Line} from './cart.ts'

export type ListingDraft = {
  url:string; retailer:'Target'|'Walmart'|'Amazon'; title:string; price:string; seller:string; brand:string
  available:boolean|null; checkedAt:string; evidence?:string; size?:string; pack?:number|null
  lead?:boolean; preview?:boolean; snippet?:string
  reviewCount?:number|null; rating?:number|null; reviewExcerpts?:string[]
  reviewSource?:'search'|'catalog'
  provider?:'ShopSavvy'
  lastSeen?:string
  offerUrl?:string
  image?:string
  attributes?:{name:string;value:string}[]
  stale?:boolean
  exactListing?:boolean
  savedQuote?:boolean
  variantUnconfirmed?:boolean
  shippingAvailable?:boolean|null
}

export function amazonProductUrl(value:string) {
  if (value.length>2000) return ''
  try {
    const url = new URL(value)
    if (url.protocol!=='https:' || url.username || url.password || url.port ||
      !['www.amazon.com','amazon.com'].includes(url.hostname)) return ''
    const id = /\/(?:dp|gp\/product|gp\/offer-listing)\/([a-z0-9]{10})(?:\/|$)/i.exec(url.pathname)?.[1]
    return id ? 'https://www.amazon.com/dp/'+id.toUpperCase() : ''
  } catch { return '' }
}

export function savedPriceRecent(date:string,now=Date.now()) {
  const age=now-Date.parse(date)
  return age>=0 && age<=14*86400000
}
export function recentHistorical(lastSeen:string,now=Date.now()) {
  const age = (now-Date.parse(lastSeen))/86_400_000
  return age>2 && age<=14
}

export const words = (value:string) => value.toLowerCase().replace(/[‐‑–]/g,'-').replace(/\bfluid ounces?\b|\bfl\.?\s*oz\b/g,'fl oz').replace(/\.(?!\d)|(?<!\d)\./g,' ').replace(/[^a-z0-9.]+/g,' ').trim()
const tvName = (value:string) => {
  const named = value.replace(/\b(?:televisions?|tvs|tv sets?)\b/gi,'tv')
  return /\btv\b/i.test(named)?named.replace(/(\d+(?:\.\d+)?)\s*(?:[- ]?in(?:ch(?:es)?)?\b|["″])/gi,'$1 inch'):named
}
const identity = (value:string) => words(discoveryName(value).replace(/\bbody lotion\b/gi,'lotion')).replace(/\bmultiview\b/g,'multi view').replace(/\bby\b/g,' ').replace(/\s+/g,' ').trim()
export function contains(text:string, term:string) {
  return Boolean(words(term)) && (' '+words(text)+' ').includes(' '+words(term)+' ')
}

const packagedSize = /^(\d+(?:\.\d+)? (?:fl oz|oz|ml|l|g|kg))(?: (can|bottle|jar|tube)s?)?$/

export function sizeMatch(requested:string, listed:string, title:string):boolean|null {
  const wanted = words(requested)
  const actual = words(listed)
  const screen = /^(\d+(?:\.\d+)?)\s*(?:[- ]?in(?:ch(?:es)?)?|["″])(?:\s+(?:screen|diagonal))?$/i.exec(requested.trim())
  if (screen && /\btv\b/.test(words(tvName(title)))) {
    const inches = /\b(\d+(?:\.\d+)?)\s*(?:[- ]?in(?:ch(?:es)?)?\b|["″])/gi
    const sizes = new Set([...listed.matchAll(inches),...title.matchAll(inches)].map(match=>Number(match[1])))
    return sizes.size===1 ? sizes.has(Number(screen[1])) : null
  }
  if (wanted===actual && actual) return true
  const request = packagedSize.exec(wanted)
  const offer = packagedSize.exec(actual)
  if (!request || !offer) return actual ? false : null
  const capacity = /\b(?:water bottles?|tumblers?|drinkware)\b/.test(words(title)) || dishSoap.test(words(title))
  const canonical = (value:string) => capacity ? value.replace(/ fl oz$/,' oz') : value
  if (canonical(request[1])!==canonical(offer[1])) return false
  if (!request[2]) return true
  if (offer[2]) return offer[2]===request[2]
  const formats = ['can','bottle','jar','tube'].filter(format=>
    contains(title,offer[1]+' '+format) || contains(title,offer[1]+' '+format+'s'))
  return formats.length===1 ? formats[0]===request[2] : null
}

const alternate = /\b(sheer(?: hydration)?|skin relief|baby|stress relief|lavender|cocoa|tinted|cream to foam)\b/
const bodyWash = /\b(?:body wash|body cleanser|shower gel)\b/
const faceWash = /\b(?:face|facial) (?:wash|cleanser)\b/
const treatmentWash = /\b(?:exfoliat\w*|body scrub|glycolic acid|salicylic acid|benzoyl peroxide|acne)\b/
const scooterAccessory = /\b(?:kick scooter|non electric|stunt scooter|(?:charger|battery|wheel|tire|bag|accessories) for|replacement (?:battery|wheel|tire))\b/
const televisionAccessory = /\b(?:mount(?:s|ing)?|brackets?|remote(?: control)?s?)\b/
function isTelevisionAccessory(text:string) {
  const product = text.replace(/\b(?:with|includes?) (?:an? )?(?:voice |smart )?(?:remote(?: control)?|(?:wall )?mount)\b/g,'')
    .replace(/\b(?:vesa |wall )?mount(?:ing)? (?:compatible|support|holes)\b/g,'')
  return televisionAccessory.test(product) || /^tv (?:games|nostalgia)\b/.test(product)
}
const dishSoap = /\b(?:soap for (?:hand )?washing dishes(?: by hand)?|hand dish(?:washing)? (?:liquid |gel )?(?:soap|detergent|liquid)|(?:liquid |gel )?dish(?:washing)? (?:soap|liquid|detergent)(?: (?:liquid|gel))?|(?:liquid |gel )?dishwash (?:liquid|gel))\b/
const dishSoapMismatch = /\b(?:hand soap|hand wash(?:ing)? soap|hand and body soap|dishwasher|automatic dishwashing|dish(?:washing)? (?:detergent )?(?:tabs?|tablets?|pods?|powder)|(?:dish )?soap (?:dispensers?|holders?)|(?:dispensers?|holders?) for (?:dish )?soap|dispensers?|replacement pumps?)\b/
const categoryAliases: [RegExp,string][] = [
  [dishSoap,'dish soap'], [/\btennis rackets?\b/,'tennis racquet'], [/\bfacial moisturizers?\b/,'face moisturizer'], [faceWash,'face wash'], [bodyWash,'body wash'],
  [/\b(?:water bottles?|drinking bottles?)\b/,'water bottle'],
  [/\b(?:e[- ]scooters?|electric scooters?)\b/,'electric scooter'], [/\b(?:airfryers?|air fryers?)\b/,'air fryer'],
]
function discoveryName(value:string) {
  return categoryAliases.reduce((text,[alias,label])=>text.replace(new RegExp(alias.source,'gi'),label),tvName(value))
}
function categoryName(value:string) {
  return words(discoveryName(words(value)))
}

const measures = {
  speed: String.raw`(\d+(?:\.\d+)?)\s*(mph|mi\s*\/\s*h|km\s*\/\s*h|kph)\b`,
  range: String.raw`(\d+(?:\.\d+)?)\s*(miles?|mi|km|kilometers?)\b(?!\s*/)`,
}
export function scooterSpecs(evidence:string) {
  const unique = (values:number[]) => values.length && values.every(value=>Math.abs(value-values[0])<=0.2) ? values[0] : null
  const speedMatches = [...evidence.matchAll(new RegExp(measures.speed,'gi'))]
  const speed = speedMatches.map(([,n,unit])=>Number(n)*(/^(?:km|kph)/i.test(unit)?0.621371:1))
  const rangeExpressions = [
    String.raw`(?:advertised\s+|max(?:imum)?\s+|battery\s+|riding\s+|travel\s+)?range\s*(?:of|:|is)?\s*(?:up to\s+)?`+measures.range,
    measures.range+String.raw`\s*(?:per charge|(?:max(?:imum)?\s+)?range)\b`,
    measures.range.replace(String.raw`\s*`,String.raw`[ -]*`)+String.raw`\s+range\b`,
  ]
  const rangeMatches = rangeExpressions.flatMap(expression=>[...evidence.matchAll(new RegExp(expression,'gi'))])
  const interval = /\d+(?:\.\d+)?\s*(?:[-–—]|to)\s*$/
  const range = rangeMatches.map(([,n,unit])=>Number(n)*(/^(?:km|kilo)/i.test(unit)?0.621371:1))
  const ambiguous = (matches:RegExpMatchArray[]) => matches.some(match=>interval.test(evidence.slice(0,match.index)))
  return {speed:ambiguous(speedMatches)?null:unique(speed),range:ambiguous(rangeMatches)?null:unique(range)}
}

function scooterRequirement(tag:string, specs:ReturnType<typeof scooterSpecs>):boolean|null|undefined {
  const text = tag.toLowerCase().trim()
  const speed = /^(?:top |max(?:imum)? )?speed:? (\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?) mph$/.exec(text)
  if (speed) return specs.speed===null ? null : specs.speed>=Number(speed[1]) && specs.speed<=Number(speed[2])
  const range = /^(minimum advertised range|maximum advertised range|commute distance):? (\d+(?:\.\d+)?) miles?$/.exec(text)
  if (range) return specs.range===null ? null : range[1]==='maximum advertised range' ? specs.range<=Number(range[2]) : specs.range>=Number(range[2])
  return undefined
}

const sofa = /\b(?:couch(?:es)?|sofas?)\b/
const sofaParts = /\b(?:sofa|seat|armrest) (?:slip)?covers?\b|\b(?:slipcovers?|furniture protectors?|(?:sofa|furniture) (?:pads?|supports?|risers?|protectors?|legs?|trays?))\b|\b(?:covers?|pads?|protectors?|replacement cushions?) for (?:a |the )?sofa\b/
function sofaName(value:string) {
  return words(value).replace(/\b(?:couches|sofas|couch)\b/g,'sofa').replace(/\b(?:slipcovers?|covers?)\b/g,'cover')
}

function identityMatch(request:string,title:string) {
  const tokens = new Set(identity(title).split(' '))
  return identity(request).split(' ').every(token=>tokens.has(token))
}
export function exactMatch(request:string,title:string) {
  const variant = words(title).match(alternate)?.[0]
  return (!variant || contains(request,variant)) && identityMatch(request,title)
}

export function searchQuery(line:Line, keyword = false) {
  const category = categoryName(line.product)
  const name = line.exact || (category===words(line.product) ? line.product : category)
  const preferences = line.preferences ?? []
  const searchPreferences = preferences.filter(preference=>!/^gentle everyday (?:use|washing|cleansing)$|^everyday (?:use|washing|cleansing)$/i.test(preference.trim()))
  const scooter = /\belectric scooter\b/.test(categoryName(line.product))
  const requirements = scooter ? line.must.filter(tag=>scooterRequirement(tag,{speed:null,range:null})===undefined) : line.must
  const entries = [line.query?discoveryName(line.query):name,line.brand,line.size,...requirements,...(line.exact ? preferences : keyword ? [] : line.query ? searchPreferences : searchPreferences.slice(0,1))]
  const parts: string[] = []
  for (const entry of entries) {
    if (entry && !parts.some(part=>contains(part,entry))) parts.push(entry)
  }
  return parts.join(' ').slice(0,320)
}

function supportsTag(evidence:string, tag:string) {
  return contains(evidence,tag) && !contains(evidence,'not '+tag) && !contains(evidence,'non '+tag)
}

const lengthUnit = `(?:ft\\.?|feet|foot|['′]|in\\.?|inches|inch|["″]|mm|cm|metres?|meters?|m)`
const lengthValue = `(\\d+(?:\\.\\d+)?)\\s*(${lengthUnit})(?![a-z])`
const lengthPrefix = new RegExp(`^(under|less than|shorter than|up to|at most|no more than|<=|<)\\s*${lengthValue}$`,'i')
const lengthSuffix = new RegExp(`^${lengthValue}\\s+(or (?:shorter|less)|max(?:imum)?)$`,'i')
const chargingRequirement = /^(?:for charging(?: devices)?|(?:fast )?charging(?: support)?|charge(?:s)? devices)$/i

function lengthInMillimeters(value:string, unit:string) {
  const normalized = unit.toLowerCase().replace(/\.$/,'')
  const scale = /^(?:ft|feet|foot|['′])$/.test(normalized) ? 304.8 :
    /^(?:in|inch(?:es)?|["″])$/.test(normalized) ? 25.4 : normalized==='mm' ? 1 : normalized==='cm' ? 10 : 1000
  return {value:Number(value)*scale,scale}
}

function requirementEvidence(evidence:string, tag:string, cable:boolean, facial:boolean):boolean|null {
  if (['unscented','fragrance free','scent free','no fragrance'].includes(words(tag))) {
    const text = words(evidence)
    if (/\b(?:not fragrance free|not unscented|lightly scented|with added fragrance)\b/.test(text)) return false
    if (/\b(?:unscented|fragrance free|free of fragrance|no (?:added )?fragrance|scent free)\b/.test(text)) return true
    if (/\b(?:scented|added fragrance)\b/.test(text)) return false
  }
  if (facial) {
    const need = words(tag).replace(/^for /,'')
    const text = words(evidence)
    if (/^(?:foam|foaming)(?: cleanser| face wash)?$/.test(need)) {
      if (/\b(?:non foaming|nonfoaming|does not foam)\b/.test(text)) return false
      return /\b(?:foam|foaming)\b/.test(text) ? true : null
    }
    if (need==='sensitive skin') {
      if (/\b(?:not (?:recommended )?for|avoid (?:on|for)) sensitive skin\b/.test(text)) return false
      return supportsTag(evidence,need) ? true : null
    }
  }
  if (cable) {
    const prefix = lengthPrefix.exec(tag.trim())
    const suffix = lengthSuffix.exec(tag.trim())
    if (prefix || suffix) {
      const limit = prefix ? lengthInMillimeters(prefix[2],prefix[3]) : lengthInMillimeters(suffix![1],suffix![2])
      const lengths = [...evidence.matchAll(new RegExp(`(?<![\\d.])${lengthValue}`,'gi'))]
        .map(([,value,unit])=>lengthInMillimeters(value,unit))
      const actual = lengths.find(length=>length.scale===limit.scale) ?? lengths[0]
      if (!actual || lengths.some(length=>Math.abs(length.value-actual.value)>Math.max(1,actual.value*0.01))) return null
      const strict = prefix && /^(?:under|less than|shorter than|<)$/i.test(prefix[1])
      return strict ? actual.value<limit.value : actual.value<=limit.value
    }
    if (chargingRequirement.test(words(tag))) {
      const text = words(evidence)
      if (/\b(?:data only|(?:no|not for) charging|does not (?:charge|support charging))\b/.test(text)) return false
      if (contains(tag,'fast charging')) return /\b(?:fast|quick) charg(?:e|ing)\b/.test(text) ? true : null
      return /\b(?:charging|charge(?:s)? devices|power delivery)\b/.test(text) ? true : null
    }
  }
  return supportsTag(evidence,tag) ? true : null
}

export function reviewFit(line:Line,draft:ListingDraft) {
  const conflicts: string[] = []
  const missing: string[] = []
  const evidence = [draft.title,draft.evidence,...(draft.attributes??[]).map(attribute=>attribute.name+' '+attribute.value)].filter(Boolean).join(' ')
  const price = /^\d{1,6}(?:\.\d{1,2})?$/.test(draft.price) ? Math.round(Number(draft.price)*100) : null
  const identityEvidence = draft.title+' '+draft.brand
  const cable = contains(line.product,'cable') || contains(line.product,'cables')
  const wash = bodyWash.test(words(line.product))
  const facial = faceWash.test(words(line.product))
  const category = wash ? bodyWash : facial ? faceWash : null
  const label = wash ? 'body wash' : 'face wash'
  const request = category ? words(line.product).replace(category,label) : categoryName(line.product)
  const title = category ? words(identityEvidence).replace(category,label) : categoryName(identityEvidence)
  const scooter = /\belectric scooter\b/.test(request)
  const specs = scooter ? scooterSpecs(evidence) : null
  const sofaRequest = sofa.test(words(line.product))
  const requestedSofa = sofaName(line.exact || line.product)
  const listedSofa = sofaName(draft.title)
  const accessoryMismatch = sofaRequest && sofaParts.test(listedSofa) && !sofaParts.test(requestedSofa)
  const tvRequest = /\btv\b/.test(request) && !isTelevisionAccessory(request + ' ' + words(line.exact))
  const bottleAccessory = /\b(?:lids?|straws?|caps?|holders?|sleeves?) for\b|\breplacement (?:lids?|straws?|caps?)\b/
  const bottleMismatch = /\bwater bottle\b/.test(request) && bottleAccessory.test(words(draft.title)) &&
    !bottleAccessory.test(request+' '+words(line.exact))
  const dishMismatch = contains(request,'dish soap') && dishSoapMismatch.test(words(draft.title))
  const amazon = amazonProductUrl(line.product)
  const productMatch = amazon ? (draft.exactListing===true && draft.url===amazon) : !dishMismatch && !accessoryMismatch && !bottleMismatch && !(tvRequest && isTelevisionAccessory(words(draft.title))) && (line.exact ? exactMatch(line.exact,identityEvidence) :
    sofaRequest ? identityMatch(requestedSofa,listedSofa) : identityMatch(request,title))
  const specialty = !line.exact && wash && treatmentWash.test(words(draft.title)) &&
    !treatmentWash.test(words([line.product,...line.must,...(line.preferences??[])].join(' ')))
  if (scooter && scooterAccessory.test(words(draft.title))) conflicts.push('scooter accessory or different scooter type')
  if (!productMatch) missing.push(line.exact ? 'exact product identity' : 'product category')
  const variant = words(draft.title).match(alternate)?.[0]
  if ((line.exact || line.must.some(tag=>words(tag)==='regular formula')) && variant && !contains(line.exact,variant)) conflicts.push('alternate formula: '+variant)
  if (line.brand && words(line.brand)!==words(draft.brand) && !contains(draft.title,line.brand)) {
    if (draft.brand) conflicts.push('different brand')
    else missing.push('brand')
  }
  if (line.size) {
    const size = sizeMatch(line.size,listingSize(draft),draft.title)
    if (size===false) conflicts.push('different size or package format')
    else if (size===null) missing.push('size or package format')
  }
  const tags = line.must.filter(tag=>{
    if (words(tag)==='regular formula' && line.exact && exactMatch(line.exact,identityEvidence) && !variant) return true
    const packNeed = /^(?:pack of (\d+)|(\d+) (?:pack|units? per pack|bottles? per pack)|(?:single|one) (?:unit|bottle)(?: per pack)?)$/.exec(words(tag))
    if (packNeed) {
      const count = Number(packNeed[1]||packNeed[2]||1)
      if (draft.pack===count) return true
      if (draft.pack==null) missing.push(tag)
      else conflicts.push('does not meet '+tag)
      return false
    }
    const numeric = specs ? scooterRequirement(tag,specs) : undefined
    const supported = numeric===undefined ? requirementEvidence(evidence,tag,cable,facial) : numeric
    if (supported) return true
    if (supported===false) conflicts.push('does not meet '+tag)
    else missing.push(tag)
    return false
  })
  if (draft.variantUnconfirmed) missing.push('retailer variant')
  if (draft.stale) missing.push('current price and stock')
  if (!line.multi && draft.pack != null && draft.pack>1) conflicts.push('multipack')
  if (draft.pack == null) missing.push(line.multi?'pack count':'single-unit pack')
  if (line.priceCap != null) {
    if (price===null || draft.pack==null) missing.push('item price cap')
    else if (price>Math.round(line.priceCap*100)*draft.pack) conflicts.push('above item price cap')
  }
  if (draft.available===false) conflicts.push('out of stock')
  const preferences = (line.preferences??[]).filter(preference=>contains(evidence,preference))
  const relevant = productMatch && !specialty && !conflicts.length
  const shortlist = relevant && (tags.length===line.must.length ||
    Boolean(draft.lead && line.must.every(tag=>{
      const leadEvidence = evidence+' '+(draft.snippet??'')
      const numeric = specs ? scooterRequirement(tag,scooterSpecs(leadEvidence)) : undefined
      return (numeric===undefined ? requirementEvidence(leadEvidence,tag,cable,facial) : numeric)===true
    })))
  return {conflicts,missing,tags,preferences,productMatch,specialty,relevant,shortlist,price,specs,
    eligible:!draft.lead && relevant && !missing.length && draft.available===true && price!==null}
}

function reviewScore(draft:ListingDraft) {
  if (draft.rating==null) return 0
  const count = draft.reviewCount ?? 1
  return (draft.rating*count+3.5*20)/(count+20)
}

function wellReviewed(draft:ListingDraft) {
  return (draft.rating??0)>=4 && (draft.reviewCount??0)>=50
}

export function rankListings(line:Line,drafts:ListingDraft[]) {
  return drafts.map(draft=>({draft,fit:reviewFit(line,draft)})).sort((a,b)=>
    Number(b.fit.eligible)-Number(a.fit.eligible) ||
    Number(b.fit.shortlist)-Number(a.fit.shortlist) ||
    Number(Boolean(a.draft.stale))-Number(Boolean(b.draft.stale)) ||
    Number(Boolean(a.fit.conflicts.length))-Number(Boolean(b.fit.conflicts.length)) ||
    Number(b.fit.relevant)-Number(a.fit.relevant) || Number(b.fit.productMatch)-Number(a.fit.productMatch) ||
    b.fit.tags.length-a.fit.tags.length ||
    Number(b.draft.available===true)-Number(a.draft.available===true) ||
    Number(wellReviewed(b.draft))-Number(wellReviewed(a.draft)) ||
    reviewScore(b.draft)-reviewScore(a.draft) || (b.draft.reviewCount??-1)-(a.draft.reviewCount??-1) ||
    b.fit.preferences.length-a.fit.preferences.length ||
    (a.fit.price??Infinity)-(b.fit.price??Infinity))
}

export function needsKeywordSearch(line:Line,drafts:ListingDraft[]) {
  return drafts.filter(draft=>reviewFit(line,draft).shortlist).length<(line.exact?1:2)
}

export function listingFeatures(draft:ListingDraft) {
  const attributes = draft.attributes ?? []
  const values = (names:RegExp) => attributes.filter(({name})=>names.test(name.trim())).map(({value})=>value)
  const known = (raw:string[]) => {
    const options = new Map<string,string>()
    for (const value of raw) {
      const label = value.trim()
      if (label && label.length<=60 && !/^(?:n\/?a|unknown|not (?:available|applicable|specified)|varies|none|other|-|see .*|assorted)$/i.test(label)) options.set(words(label),label)
    }
    return options.size===1 ? [...options.values()][0] : undefined
  }
  const scentValue = (value:string) => /^(?:unscented|fragrance free|scent free|no (?:added )?fragrance|free of fragrance)$/.test(words(value)) ?
    'Unscented' : /^(?:scented|fragranced)$/.test(words(value)) ? 'Scented' : value
  const title = words(draft.title)
  const unscented = /\b(?:unscented|fragrance free|scent free)\b/.test(title) &&
    !/\bnot (?:unscented|fragrance free)\b/.test(title)
  const namedScent = /\b(lemon|lavender|orange|lime|rose|mint) scent(?:ed)?\b/.exec(title)?.[1]
  const titleScent = unscented?'Unscented':namedScent?namedScent[0].toUpperCase()+namedScent.slice(1):/\bscented\b/.test(title)?'Scented':''
  const recordedScent = known(values(/^(?:(?:product |actual )?scent(?: name)?|fragrance(?: name)?)$/i).map(scentValue))
  const scent = titleScent==='Unscented' && recordedScent && recordedScent!==titleScent ? undefined : recordedScent || titleScent
  const sizeLabel = (value:string) => {
    const m = /^(\d+(?:\.\d+)?) (fl oz|oz|ml|l|g|kg)$/.exec(words(value))
    return m ? Number(m[1])+' '+m[2] : value
  }
  const bottle = /\b(?:water bottles?|tumblers?|drinkware)\b/.test(title)
  const capacities = values(/^(?:volume capacity|capacity|net volume|net content)$/i)
  const size = known([...capacities,draft.size??''].map(sizeLabel).map(value=>bottle?value.replace(/ fl oz$/,' oz'):value))
  const volume = bottle || capacities.length>0 || /(?:fl oz|ml|l)$/.test(size??'')
  const screen = /\btv\b/.test(categoryName(draft.title)) ?
    known([...values(/^(?:screen (?:size|diagonal)|display size)$/i),...Array.from(tvName(draft.title).matchAll(/\b\d+(?:\.\d+)? inch\b/gi),m=>m[0])]
      .flatMap(value=>{
        const match = /^(\d+(?:\.\d+)?)\s*(?:[- ]?in(?:ch(?:es)?)?|["″])?$/i.exec(value.trim())
        return match?[Number(match[1])+' inch']:[]
      })) : undefined
  const result = new Map<string,string>()
  for (const [name,value] of [
    ['Scent',scent], [volume?'Capacity':'Size',size],
    ['Material',known(values(/^(?:material|primary material)$/i))],
    ['Brand',known([draft.brand])], ['Screen size',screen],
  ]) if (name && value) result.set(name,value)
  return result
}

export function listingSize(draft:ListingDraft) {
  if (draft.size) return draft.size
  const features = listingFeatures(draft)
  return features.get('Screen size') ?? features.get('Capacity') ?? features.get('Size') ?? ''
}

export const modelNumber = /\b[a-z]{2,}\d[a-z0-9-]{2,}\b/i
const typedCategory = /\b(?:dish soap|hand soap|face wash|body wash|water bottle|tv|electric scooter|air fryer|body lotion|(?:face|facial) moisturizers?|tennis (?:racquets?|rackets?)|shampoo|deodorants?|(?:usb[ -]?c )?cables?)s?\b/i
export function typedLine(line:Line):Line {
  if (line.query || line.exact) return line
  const original = line.product
  const allowPacks = /\bmultipacks? (?:allowed|okay|ok|accepted)\b/i
  const text = discoveryName(original).replace(allowPacks,'').trim()
  const match = typedCategory.exec(text)
  if (!match || dishSoapMismatch.test(words(text)) && contains(match[0],'dish soap')) return line
  const measurement = /\b\d+(?:\.\d+)?\s*(?:fluid ounces?|fl\.?\s*oz|oz|ml|inch(?:es)?|in\b|["″])/i
  const scent = /\b(?:unscented|fragrance[- ]free|scent[- ]free|scented|(?:lemon|lavender|orange|lime|rose|mint)\b)/gi
  const budget = /\b(?:under|up to|at most)\s*\$\s*(\d+(?:\.\d{1,2})?)/i
  const pack = /\b(?:pack of (\d+)|(\d+)\s*[- ]?\s*pack|(?:single|one) (?:unit|bottle|jar|tube|can))\b/i
  const packCount = text.match(pack)
  const units = packCount ? Number(packCount[1]??packCount[2]??'1') : null
  const size = text.match(measurement)?.[0] ?? ''
  const cap = text.match(budget)
  const scents = [...text.matchAll(scent)].map(m=>m[0])
  const remainder = (text.slice(0,match.index)+' '+text.slice(match.index+match[0].length))
    .replace(measurement,' ').replace(budget,' ').replace(pack,' ').replace(scent,' ')
    .replace(/\b(?:i (?:want|need)|looking for|find me|please|brand|model|a|an|the|with|in|and|must be|liquid|scent)\b/gi,' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g,'').replace(/\s+/g,' ')
  const product = match[0]
  const exact = modelNumber.test(remainder)?remainder:''
  return {...line,product:words(original)===words(text) && !remainder && !size && !scents.length && !cap && units===null ? original : product,
    query:original,exact,size:line.size||size,priceCap:line.priceCap ?? (cap?Number(cap[1]):null),
    multi:line.multi || allowPacks.test(original) || (units!==null && units>1),
    must:[...new Set([...line.must,...scents,...(units?[`pack of ${units}`]:[]),...(remainder&&!exact?[remainder]:[])])]}
}
