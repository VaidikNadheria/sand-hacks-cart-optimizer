import {judgeQuotes} from '../judge-quotes.mjs'
import {shoppingEntry} from './shopping-entry.ts'
import './style.css'
import {cents,money,matchesLine,selectionIssue,hasStandardShipping,optimize,selectedCart,policies,stores,substitutions} from './cart.ts'
import type {Attribute,Line,Offer,Plan,PolicyStore,Store} from './cart.ts'
import {blank,demo,snapshot} from './data.ts'
import {swapOffers,swapLabel} from './swap.ts'

import {amazonProductUrl, exactMatch, listingFeatures, listingSize, needsKeywordSearch, rankListings, recentHistorical, savedPriceRecent, searchQuery, reviewFit, typedLine, words} from './fit.ts'
import type {ListingDraft} from './fit.ts'
import {applyNeeds, guidedNeeds, needsFor} from './needs.ts'
import type {Need} from './needs.ts'

const root = document.querySelector<HTMLDivElement>('#app')!
const icon = (paths: string) => '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths+'</svg>'
const cart = icon('<path d="M3 4h2l2.4 11h11.8l2-8H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>')
const spark = icon('<path d="M12 2l2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6z"/>')
const arr = '<span aria-hidden="true">→</span>'
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
const textTags = (value: string) => value.split(',').map(s=>s.trim()).filter(Boolean)
const id = () => crypto.randomUUID()
const href = (raw: string) => {
  try {
    const u = new URL(raw)
    return (u.protocol === 'https:' || u.protocol === 'http:') ? esc(u.href) : ''
  } catch { return '' }
}
const link = (url: string, label: string) => href(url) ? '<a href="'+href(url)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+' ↗</a>' : ''
const dollars = (value: number | null) => value === null ? 'Unknown' : money(value)
let lines: Line[] = [blank(id())]
let offers: Offer[] = []
const selections = new Map<string,Offer>()
let budgetInput = ''
let compared = false
let showSwap = false
let approved = ''
let notice = ''
let mode = ''
let gemini = false
let importMessage = ''
let liveListings = false
let liveSearch = false
let brightSearch = false
let shopSavvy = false
let savedResults = false
let targetOnDemand = false
let zip = ''
let fulfillment = 'shipping'
let fulfillmentChecked = false
let busy = false
let shoppingText = ''
let serp = false
let offerLine = ''
let editOffer = ''
let reviewToCart = false
let offerError = ''
let importVersion = 0
const listingDrafts = new WeakMap<HTMLFormElement, ListingDraft>()
type CheckState = 'pending'|'succeeded'|'failed'|'expired'
type ListingSearch = {
  key:string; pending:Store[]; catalogPending:Set<Store>; catalogRestart:Set<Store>;
  shopStatus:string; shopFailed:boolean; failedStores:Set<Store>;
  drafts:ListingDraft[]; notes:Partial<Record<Store,string>>;
  checks:Map<string,CheckState>; active:Set<string>; deadline:number; loading:boolean; tip:boolean; targetRequested?:boolean; catalogQueries:Partial<Record<Store,string>>; filters?:Map<string,string>;
}
const searches = new Map<string, ListingSearch>()
type NeedKind = Need['kind']
type NeedsEditor = {key:string;questions:Need[];answers:Map<NeedKind,string>;custom:Map<NeedKind,string>;loading?:boolean;error?:string}
const needsEditors = new Map<string,NeedsEditor>()
const needsDone = new Set<string>()
const requirementKey = (line:Line) => JSON.stringify([line.product,line.exact,line.must,line.brand,line.size,line.flexible,line.multi,line.preferences??[],line.priceCap??null])
const searchKey = (line:Line) => JSON.stringify([requirementKey(line),line.query,line.quantity])
const searchState = (line:Line) => searches.get(line.id)?.key===searchKey(line) ? searches.get(line.id) : undefined
const listingLookupTimeout = 135000
const batchDeadline = 45000
const catalogSearching = 'Searching retailer catalog…'
const catalogSlow = 'Retailer catalog still checking…'
const delay = (ms:number) => new Promise<void>(resolve=>window.setTimeout(resolve,ms))

async function withSlowNotice<T>(pending:Promise<T>,onSlow:()=>void) {
  const timer = window.setTimeout(onSlow,8000)
  try { return await pending }
  finally { window.clearTimeout(timer) }
}

function listingDetails(draft:ListingDraft, fit:ReturnType<typeof reviewFit>) {
  const policy = draft.retailer==='Amazon'?null:policies[draft.retailer]
  const standard = hasStandardShipping({...draft,standard:draft.shippingAvailable===true})
  const shipping = draft.shippingAvailable===false?'Shipping unavailable':standard&&policy?
    `Standard shipping estimate · ${money(policy.fee)} below ${money(policy.threshold)}`:'Confirm shipping at retailer'
  const speed = fit.specs?.speed
  const range = fit.specs?.range
  const specs = fit.specs ? `<small>Advertised top speed · ${speed==null?'Unconfirmed':speed.toFixed(1).replace(/\.0$/,'')+' mph'}</small>
    <small>Advertised range · ${range==null?'Unconfirmed':range.toFixed(1).replace(/\.0$/,'')+' miles'}</small>` : ''
  return `<details class="product-details" data-listing="${esc(draft.url)}"><summary>Listing details</summary>
    <div class="product-evidence">
    <small>Seller · ${esc(draft.seller||'Unconfirmed')}</small>
    ${draft.lastSeen?`<small>Price observed · <time datetime="${esc(draft.lastSeen)}">${esc(draft.lastSeen)}</time></small>`:''}
    <small>Pack · ${draft.pack==null?'Unconfirmed':draft.pack+' per pack'}${draft.size?' · '+esc(draft.size)+' per unit':''}</small>
    <small>${esc(shipping)} ${standard&&policy?link(policy.url,'Policy'):''}</small>${specs}
    ${fit.conflicts.length?`<small>Doesn’t match · ${esc(fit.conflicts.join(', '))}</small>`:''}
    ${fit.missing.length?`<small>Unconfirmed · ${esc(fit.missing.join(', '))}</small>`:''}
    ${draft.attributes?.map(spec=>`<small>${esc(spec.name)} · ${esc(spec.value)}</small>`).join('')??''}
    ${draft.evidence?`<p>${esc(draft.evidence)}</p>`:''}
    ${draft.reviewExcerpts?.map(excerpt=>`<small>“${esc(excerpt)}”</small>`).join('')??''}
    ${link(draft.offerUrl||draft.url,'View at retailer')}</div></details>`
}
// A current product quote can be shown before remaining cart fields are confirmed.
function displayableOffer(fit:ReturnType<typeof reviewFit>,draft:ListingDraft) {
  return !draft.lead && !draft.stale && !draft.variantUnconfirmed && fit.relevant && fit.price!==null &&
    draft.available===true && !!draft.seller.trim() && Boolean(href(draft.offerUrl||draft.url)) &&
    fit.missing.every(detail=>draft.retailer!=='Amazon' && (detail==='single-unit pack'||detail==='pack count'))
}

function readyOffer(line:Line,draft:ListingDraft): Offer|null {
  const fit = reviewFit(line,draft)
  if (!displayableOffer(fit,draft) || fit.price===null || draft.pack==null) return null
  const offer: Offer = {
    id:line.id+'-retailer-'+draft.url,product:line.product,lineId:line.id,title:draft.title,
    retailer:draft.retailer,seller:draft.seller,cents:fit.price,pack:draft.pack,brand:draft.brand,size:listingSize(draft),
    tags:fit.tags,available:draft.available,standard:draft.shippingAvailable===true,certain:true,
    source:'Retailer data',url:draft.offerUrl||draft.url,note:draft.lastSeen||draft.checkedAt?'Price observed · '+(draft.lastSeen||draft.checkedAt):undefined,
  }
  return selectionIssue(line,offer)?null:offer
}
function historicalOffer(line:Line,draft:ListingDraft):Offer|null {
  if ((!draft.savedQuote && draft.provider!=='ShopSavvy') || !draft.exactListing || draft.variantUnconfirmed || !draft.stale ||
      draft.available===false || !draft.lastSeen || !(draft.savedQuote?savedPriceRecent(draft.lastSeen):recentHistorical(draft.lastSeen)) || draft.pack==null) return null
  const fit = reviewFit(line,{...draft,stale:false,available:null})
  if (!fit.relevant || fit.missing.length || fit.price===null) return null
  const offer:Offer = {id:line.id+'-estimate-'+draft.url,product:line.product,lineId:line.id,title:draft.title,
    retailer:draft.retailer,seller:draft.seller,cents:fit.price,pack:draft.pack,brand:draft.brand,size:listingSize(draft),
    tags:fit.tags,available:null,standard:false,certain:true,source:'Historical estimate',historicalPriceAt:draft.lastSeen,savedQuote:draft.savedQuote,
    url:draft.offerUrl||draft.url}
  return selectionIssue(line,offer)?null:offer
}
function listingSelectionLabel(line:Line,offer:Offer) {
  const current = selections.get(line.id)
  if (!current) return 'Add to cart'
  const sameListing = current.id===offer.id || (Boolean(current.historicalPriceAt)===Boolean(offer.historicalPriceAt) && offer.url && current.url===offer.url && current.retailer===offer.retailer && current.seller===offer.seller)
  if (sameListing && selectedCart([line],selections).rows[0]?.purchase) return 'In your cart'
  return 'Replace selection'
}
function selectOffer(line:Line,offer:Offer,refresh=false) {
  if (!refresh && listingSelectionLabel(line,offer)==='In your cart') return
  const attached = {...offer,id:offer.lineId===line.id?offer.id:line.id+'-selection-'+offer.id,lineId:line.id,product:line.product}
  selections.set(line.id,attached)
  if (!offers.some(entry=>entry.id===attached.id)) offers.push(attached)
  compared = true
  approved = ''
}
function comparisonOffers() {
  const available = new Map(offers.filter(offer=>!offer.lineId || lines.some(line=>line.id===offer.lineId &&
    line.product.trim().toLowerCase()===offer.product.trim().toLowerCase())).map(offer=>[offer.id,offer]))
  for (const line of lines) for (const draft of searchState(line)?.drafts??[]) {
    const offer = readyOffer(line,draft)
    if (offer && !available.has(offer.id)) available.set(offer.id,offer)
  }
  return [...available.values()]
}
function listingAction(line:Line,search:ListingSearch,draft:ListingDraft) {
  const index = search.drafts.indexOf(draft)
  const offer = readyOffer(line,draft)
  if (offer) {
    const label = listingSelectionLabel(line,offer)
    return `<button type="button" class="primary" data-action="select-found" data-candidate="${index}" ${label==='In your cart'?'disabled':''}>${label}</button>`
  }
  return `<button type="button" class="secondary" data-action="review-found" data-candidate="${index}">Review &amp; add</button>`
}

function withSearchReviews(draft:ListingDraft,previous:ListingDraft) {
  return previous.reviewSource==='search' && draft.rating==null && draft.reviewCount==null ?
    {...draft,rating:previous.rating,reviewCount:previous.reviewCount,reviewSource:previous.reviewSource} : draft
}

function isCurrent(line:Line,search:ListingSearch) {
  return searches.get(line.id)===search && lines.some(item=>item.id===line.id && searchState(item)===search)
}
function updateSearch(line:Line,search:ListingSearch) {
  if (!isCurrent(line,search)) return
  if (!search.pending.length && search.shopStatus!=='Searching…' && !search.active.size && !search.catalogPending.size) {
    search.loading = false
  }
  showSearch(lines.find(item=>item.id===line.id)!)
  root.querySelector('#cart-content')!.innerHTML = cartRegion()
}
function openBatch(line:Line,search:ListingSearch) {
  const deadline = Date.now()+batchDeadline
  search.deadline = deadline
  search.loading = true
  search.tip = false
  showSearch(line)
  window.setTimeout(()=>{
    if (!isCurrent(line,search) || search.deadline!==deadline || !search.loading) return
    search.tip = true
    showSearch(lines.find(item=>item.id===line.id)!)
  },4500)
  window.setTimeout(()=>{
    if (!isCurrent(line,search) || search.deadline!==deadline) return
    search.loading = false
    updateSearch(line,search)
  },batchDeadline)
}
async function verifyListing(line:Line,search:ListingSearch,draft:ListingDraft,operation?:'status'|'retry') {
  if (search.active.has(draft.url)) return
  const deadline = search.deadline
  const current = () => isCurrent(line,search) && search.deadline===deadline && Date.now()<deadline
  search.active.add(draft.url)
  search.checks.set(draft.url,'pending')
  showSearch(lines.find(item=>item.id===line.id)!)
  let attempts = 0
  try {
    while (current()) {
      const timeout = Math.max(1,Math.min(operation==='status'?5000:14000,deadline-Date.now()))
      const response = await fetch('/api/listing',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:draft.url,quickCheck:true,operation}),
        signal:AbortSignal.timeout(timeout),
      })
      const checked = await response.json()
      if (!current()) return
      if (response.status===202 && checked.pending) {
        operation = 'status'
        await delay(Math.min(1000+800*attempts++,3500,Math.max(deadline-Date.now(),0)))
        continue
      }
      if (!response.ok || checked.url!==draft.url) {
        search.checks.set(draft.url,response.status===410?'expired':'failed')
        return
      }
      const criteria = lines.find(item=>item.id===line.id)!
      mergeDrafts(criteria,search,[checked])
      search.checks.set(draft.url,'succeeded')
      return
    }
  } catch {
    // The status route can still retrieve a request whose response was interrupted.
  } finally {
    search.active.delete(draft.url)
    if (isCurrent(line,search)) updateSearch(line,search)
  }
}
function quoteRank(line:Line,draft:ListingDraft) {
  const fit = reviewFit(line,draft)
  if (displayableOffer(fit,draft)) return readyOffer(line,draft)?5:3
  if (historicalOffer(line,draft)) return 4
  if (!fit.relevant) return 0
  return !draft.lead && fit.price!==null?2:1
}
function possibleOffer(line:Line,draft:ListingDraft,fit:ReturnType<typeof reviewFit>) {
  if (!fit.relevant || !href(draft.offerUrl||draft.url) || displayableOffer(fit,draft) || historicalOffer(line,draft)) return false
  return !(line.priceCap!=null && !line.multi && fit.price!=null && fit.price>Math.round(line.priceCap*100))
}
function missingEvidence(draft:ListingDraft,fit:ReturnType<typeof reviewFit>) {
  return [...new Set([
    ...fit.missing.filter(detail=>detail!=='current price and stock'),
    ...(draft.stale || fit.price===null?['current price']:[]),
    ...(draft.stale || draft.available==null?['stock']:[]),
    ...(!draft.seller.trim()?['seller']:[]),
  ])].join(', ')
}
function promisingListings(line:Line,search:ListingSearch) {
  return rankListings(line,search.drafts).filter(({draft,fit})=>possibleOffer(line,draft,fit) || Boolean(historicalOffer(line,draft)))
}
function queueVerification(line:Line,search:ListingSearch) {
  if (!liveListings || !isCurrent(line,search) || Date.now()>=search.deadline) return
  for (const store of stores) {
    const used = search.drafts.filter(draft=>draft.retailer===store && search.checks.has(draft.url)).length
    const capacity = Math.max(0,(line.exact?1:2)-used)
    for (const {draft} of promisingListings(line,search).filter(entry=>entry.draft.retailer===store &&
      !entry.draft.savedQuote && !search.checks.has(entry.draft.url) && !(search.pending.includes(store) && entry.draft.stale &&
        !historicalOffer(line,entry.draft))).slice(0,capacity)) void verifyListing(line,search,draft)
  }
}
function retryVerification(line:Line,store?:Store,restart=false) {
  const search = searchState(line)
  if (!search || search.loading || search.active.size || !liveListings) return
  const candidates = promisingListings(line,search).filter(({draft})=>!search.active.has(draft.url) &&
    (!store || draft.retailer===store && (restart?
      ['failed','expired'].includes(search.checks.get(draft.url)??''):search.checks.get(draft.url)==='pending')))
  if (!candidates.length) {
    if (!store && search.catalogPending.size) {
      const pending = stores.find(retailer=>search.catalogPending.has(retailer))
      if (pending) void findListings(line,pending)
    } else if (!store) void findListings(line)
    return
  }
  openBatch(line,search)
  for (const store of stores) for (const {draft} of candidates.filter(entry=>entry.draft.retailer===store).slice(0,line.exact?1:2)) {
    const state = search.checks.get(draft.url)
    void verifyListing(line,search,draft,state==='pending'?'status':state==='failed'||state==='expired'?'retry':undefined)
  }
}

function retailerSearchLink(store:Store,line:Line) {
  const query = encodeURIComponent(searchQuery(line,true))
  return link(store==='Target'?'https://www.target.com/s?searchTerm='+query:'https://www.walmart.com/search?q='+query,'Search '+store)
}

function mergeDrafts(line:Line,search:ListingSearch,drafts:ListingDraft[]) {
  for (const draft of drafts) {
    const index = search.drafts.findIndex(known=>known.url===draft.url)
    if (index===-1) {
      search.drafts.push(draft)
      continue
    }
    const previous = search.drafts[index]
    // Keep price, seller, stock and date on the same source record.
    const incomingRank = quoteRank(line,draft)
    const previousRank = quoteRank(line,previous)
    const estimate = incomingRank===4?draft:previousRank===4?previous:null
    const live = incomingRank===5?draft:previousRank===5?previous:null
    if (estimate && live && (live.pack!==estimate.pack ||
        (!exactMatch(estimate.title,live.title) && !exactMatch(live.title,estimate.title)) ||
        (Boolean(listingSize(estimate)) && (!listingSize(live) || words(listingSize(live))!==words(listingSize(estimate)))) ||
        (estimate.brand && live.brand && words(estimate.brand)!==words(live.brand)))) continue
    const checkedMismatch = incomingRank===0 && previousRank<=2 && Boolean(draft.checkedAt) && !draft.lead
    if (checkedMismatch || incomingRank>=previousRank) search.drafts[index] = withSearchReviews(draft,previous)

  }
}

function requirementLabels(line:Line) {
  return [
    ...(['exact','brand','size','priceCap'] as const).flatMap(key=>line[key]!=='' && line[key]!=null?
      [{key,value:key==='priceCap'?'Up to '+dollars(Math.round(Number(line[key])*100))+' per unit':String(line[key])}]:[]),
    ...line.must.map((value,index)=>({key:'must-'+index,value})),
  ]
}
function featurePanel(offers:ReturnType<typeof rankListings>, filters:Map<string,string>) {
  const choices = new Map<string,Map<string,{value:string;count:number}>>()
  for (const {draft} of offers) {
    const features = listingFeatures(draft)
    for (const [name,value] of features) {
      if (![...filters].every(([group,selected])=>group===name || words(features.get(group)??'')===selected)) continue
      let group = choices.get(name)
      if (!group) choices.set(name,group=new Map())
      const key = words(value)
      const option = group.get(key)
      if (option) option.count++
      else group.set(key,{value,count:1})
    }
  }
  const groups = [...choices].filter(([,options])=>options.size>1)
  if (!groups.length && !filters.size) return ''
  return `<div class="offer-filters" aria-label="Filter verified offers"><div class="filter-header">
    <strong>Filter verified offers</strong><button type="button" class="text-btn" data-action="clear-filters">Show all matches</button></div>
    ${groups.map(([name,options])=>`<fieldset class="filter-group"><legend>${esc(name)}</legend>
      ${[...options].sort((a,b)=>a[1].value.localeCompare(b[1].value,undefined,{numeric:true})).map(([key,{value,count}])=>
        `<button type="button" class="filter-option" aria-pressed="${filters.get(name)===key}" data-action="filter-offers" data-group="${esc(name)}" data-value="${esc(key)}">${esc(value)} <span>(${count})</span></button>`).join('')}</fieldset>`).join('')}
  </div>`
}

function beginSearch(line:Line) {
  if (!needsDone.has(line.id) && !needsEditors.has(line.id)) {
    const questions = needsFor(line)
    if (questions.length) {
      const editor:NeedsEditor = {key:searchKey(line),questions,answers:new Map(),custom:new Map()}
      needsEditors.set(line.id,editor)
      if (gemini && questions.length===1 && !questions[0].choices.length) {
        editor.loading = true
        void fetch('/api/requirements',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({text:searchQuery(line),history:[]}),signal:AbortSignal.timeout(6000)})
          .then(response=>response.ok?response.json():null)
          .then(output=>{
            const choices = guidedNeeds(output?.questions,line)
            if (choices.length && !editor.answers.size) editor.questions = choices
          }).catch(()=>{}).finally(()=>{
            editor.loading = false
            if (needsEditors.get(line.id)!==editor) return
            const current = lines.find(item=>item.id===line.id)
            if (current && searchKey(current)===editor.key) showSearch(current)
          })
      }
    }
  }
  if (needsEditors.has(line.id)) {
    showSearch(line)
    return
  }
  void findListings(line)
}

function needsEditor(line:Line,editor:NeedsEditor) {
  const {questions,answers,custom} = editor
  return `<form class="needs-editor" data-needs="${esc(line.id)}"><h3>What matters for this search?</h3>
    ${editor.loading?'<small role="status">Checking which questions would help…</small>':''}
    ${questions.map(need=>{
      const current = answers.get(need.kind)
      return `<fieldset><legend>${esc(need.prompt)}</legend><div class="needs-choices">
        ${[...need.choices,need.kind==='price'?'No price cap':'No preference','Type my own'].map(value=>
          `<button type="button" class="filter-option" data-action="needs-choice" data-kind="${need.kind}" data-value="${esc(value)}" aria-pressed="${current===value}">${esc(value)}</button>`).join('')}</div>
        ${current==='Type my own'?`<input name="${need.kind}" aria-label="${esc(need.prompt)}" placeholder="${esc(need.hint)}" maxlength="150"${need.kind==='price'?' inputmode="decimal"':''} required value="${esc(custom.get(need.kind)??'')}">`:''}</fieldset>`
    }).join('')}
    ${editor.error?`<p role="alert">${esc(editor.error)}</p>`:''}
    <div class="needs-choices"><button type="submit" class="primary">Apply answers</button>
      <button type="button" class="text-btn" data-action="skip-needs">Skip and search</button></div></form>`
}
function completeNeeds(line:Line,skip=false) {
  const editor = needsEditors.get(line.id)
  if (!editor) return
  const answers = new Map([...editor.answers].map(([kind,value])=>[kind,value==='Type my own'?editor.custom.get(kind)??'':value]))
  const outcome = skip?{line}:applyNeeds(line,editor.questions,answers)
  if (!outcome.line) {
    editor.error = outcome.error
    showSearch(line)
    return
  }
  const revised = outcome.line
  needsEditors.delete(line.id)
  needsDone.add(line.id)
  lines = lines.map(item=>item.id===line.id?revised:item)
  render()
  void findListings(revised)
}
function judgingDrafts(line:Line):ListingDraft[] {
  const category=words(line.product)
  return judgeQuotes.filter(draft=>(draft.category===category || draft.category==='television'&&category==='tv') &&
    reviewFit(line,draft).relevant && (!line.priceCap || Boolean(draft.price)) &&
    (line.preferences??[]).every(term=>words(draft.title+' '+draft.evidence).includes(words(term))))
}
function productKey(draft:ListingDraft) {
  return judgeQuotes.find(record=>record.url===draft.url)?.key ??
    words(draft.title)+'|'+listingSize(draft)+'|'+draft.pack
}
function distinct<T>(items:T[],key:(item:T)=>string,seen=new Set<string>()) {
  return items.filter(item=>{
    const id=key(item)
    if(seen.has(id))return false
    seen.add(id)
    return true
  })
}

function searchResults(line: Line) {
  const editor = needsEditors.get(line.id)
  if (editor) return `<section class="search-results" aria-label="Listings for ${esc(line.product)}">
    <div class="products-heading"><h2>${esc(line.product)}</h2></div>${needsEditor(line,editor)}</section>`
  const search = searchState(line)
  if (!search) return ''
  const exactAmazon = amazonProductUrl(line.product)
  const grouped=new Set<string>()
  const limit=savedResults&&judgingDrafts(line).length?4:Infinity
  const verified = distinct(rankListings(line,search.drafts).filter(({draft,fit})=>displayableOffer(fit,draft)),entry=>productKey(entry.draft),grouped).slice(0,limit)
  const filters = search.filters ?? new Map<string,string>()
  const applyFilters = () => verified.filter(({draft})=>{
    const features = listingFeatures(draft)
    return [...filters].every(([name,value])=>words(features.get(name)??'')===value)
  })
  let ranked = applyFilters()
  if (verified.length && !ranked.length) {
    filters.clear()
    ranked = verified
  }
  const historical = distinct(search.drafts.flatMap((draft,index)=>{
    const offer = historicalOffer(line,draft)
    return offer?[{offer,index}]:[]
  }),item=>productKey(search.drafts[item.index]),grouped).slice(0,Math.max(0,limit-ranked.length))
  const offerButton = (offer:Offer,index:number) => selections.get(line.id)?.id===offer.id ?
    '<button type="button" class="secondary" disabled>In your cart</button>' :
    `<button type="button" class="secondary" data-action="estimate-found" data-candidate="${index}">${selections.has(line.id)?'Replace with estimated price':'Add to estimated cart'}</button>`
  const alternateLinks=(draft:ListingDraft)=>search.drafts.filter(item=>item.url!==draft.url && productKey(item)===productKey(draft) &&
    reviewFit(line,item).relevant).map(item=>link(item.offerUrl||item.url,'Also at '+item.retailer)).join(' · ')
  const best = ranked[0]
  const waiting = search.pending.length || search.catalogPending.size || [...search.checks.values()].includes('pending') || search.shopStatus==='Searching…'
  const failed = search.failedStores.size || search.shopFailed || [...search.checks.values()].includes('failed')
  const possible = waiting || failed ||
    [...search.checks.values()].some(state=>state!=='succeeded') || promisingListings(line,search).length
  const emptyStatus = possible?'Couldn’t confirm current prices or stock':'No matching products found'
  const requirements = requirementLabels(line)
  const stage = search.drafts.length || search.checks.size?'Checking current prices and stock':'Finding listings'
  const productPending = (store:Store) => search.drafts.some(draft=>draft.retailer===store && search.checks.get(draft.url)==='pending')
  const leads = distinct(rankListings(line,search.drafts).filter(({draft,fit})=>possibleOffer(line,draft,fit)),entry=>productKey(entry.draft),grouped).slice(0,Math.max(0,limit-ranked.length-historical.length))
  const participating = [...stores,...(search.shopStatus || search.drafts.some(draft=>draft.retailer==='Amazon')?['Amazon' as const]:[])]
  const tally = (count:number,singular:string,plural:string) => count?`${count} ${count===1?singular:plural}`:''
  const counts = (store?:Store) => [
    tally(ranked.filter(({draft})=>!store||draft.retailer===store).length,'verified offer','verified offers'),
    tally(historical.filter(({offer})=>!store||offer.retailer===store).length,'price estimate','price estimates'),
    tally(leads.filter(({draft})=>!store||draft.retailer===store).length,'possible match','possible matches'),
  ].filter(Boolean)
  const terminal = (store:Store) => search.catalogRestart.has(store) || search.failedStores.has(store) ||
    search.drafts.some(draft=>draft.retailer===store && ['failed','expired'].includes(search.checks.get(draft.url)??'')) ||
    (store==='Amazon' && search.shopFailed)
  return `<section class="search-results" role="region" aria-label="Listings for ${esc(line.product)}">
    <div class="products-heading"><h2>${esc(line.product)}</h2><span>${counts().join(' · ')}</span></div>
    ${requirements.length?`<p class="search-requirements"><strong>Required</strong> ${requirements.map(({value})=>esc(value)).join(' · ')}</p>`:''}
    <details class="retailer-updates"><summary><span class="retailer-summary" aria-live="polite">${participating.map(store=>{
      const checking = search.pending.includes(store) || search.catalogPending.has(store) || productPending(store) ||
        store==='Amazon' && search.shopStatus==='Searching…'
      const values = counts(store)
      const state = store==='Target'&&targetOnDemand&&!search.targetRequested?[...values,'live optional'].join(' · '):
        [...values,checking?'checking':terminal(store)?'check failed':values.length?'':'no matches'].filter(Boolean).join(' · ')
      return `<span><strong>${store}</strong> ${state}</span>`
    }).join('<span aria-hidden="true">·</span>')}</span></summary>
    <div class="retailer-statuses">${participating.map(store=>{
      if (store==='Amazon') return terminal(store)&&!search.loading?'<div class="retailer-status"><strong>Amazon</strong><button type="button" class="text-btn" data-action="search-again">Search again</button></div>':''
      if (store==='Target' && targetOnDemand && !search.targetRequested) return ''
      const catalogPending = search.catalogPending.has(store)
      const resumeProduct = !catalogPending && productPending(store)
      const restartProduct = !catalogPending && !resumeProduct && search.drafts.some(draft=>draft.retailer===store &&
        ['failed','expired'].includes(search.checks.get(draft.url)??'') && possibleOffer(line,draft,reviewFit(line,draft)))
      const canSearch = brightSearch && serp && !ranked.some(entry=>entry.draft.retailer===store && entry.fit.eligible) &&
        (!ranked.some(entry=>entry.draft.retailer===store) || /failed|blocked|could not|no suitable/i.test(search.notes[store]??''))
      const status = search.pending.includes(store) || catalogPending ? 'Checking '+store+'…' : resumeProduct ? 'Product price and stock checks are still pending.' : search.notes[store] ?? 'Searching…'
      const action = !search.loading && !search.pending.includes(store) && (catalogPending || resumeProduct || terminal(store) || canSearch) ?
        `<button type="button" class="text-btn" data-action="${resumeProduct?'resume-product':restartProduct?'restart-product':'keyword'}" data-retailer="${store}" ${catalogPending||resumeProduct||search.catalogRestart.has(store)?'data-catalog-action':''}>${catalogPending||resumeProduct ? 'Check existing results' : terminal(store) ? 'Search again' : `Search ${store} catalog`}</button>` : ''
      return `<div class="retailer-status"><strong>${store}</strong><span role="status">${esc(status)}</span>${action}</div>`
    }).join('')}</div></details>
    ${!exactAmazon && targetOnDemand && brightSearch && !search.targetRequested?`<button type="button" class="text-btn" data-action="keyword" data-retailer="Target">Check Target live</button>`:''}
    ${search.loading?`<div class="verification-loading" role="status"><strong>${stage}</strong>
      ${ranked.length||historical.length?'':'<div class="result-skeleton" aria-hidden="true"><i></i><i></i></div><div class="result-skeleton" aria-hidden="true"><i></i><i></i></div>'}
      ${search.tip?`<small>${/bottle/i.test(line.product)?'Compare price per ounce when bottles differ in size.':'Check the item size and pack count before comparing prices.'}</small>`:''}</div>`:''}
    ${verified.length?featurePanel(verified,filters):''}
    ${ranked.length?`<ul class="product-list">${ranked.map(entry=>{
      const {draft,fit} = entry
      const image = draft.image ? href(draft.image) : ''
      const reason = [...fit.tags,...fit.preferences].filter(Boolean).join(' · ')
      const confirmedSpecs = fit.specs ? [
        fit.specs.speed==null?'':Number(fit.specs.speed.toFixed(1))+' mph top speed',
        fit.specs.range==null?'':Number(fit.specs.range.toFixed(1))+' miles advertised range',
      ].filter(Boolean).join(' · ') : ''
      return `<li class="product-card marketplace-card ${entry===best?'top-match':''}">
        <div class="product-main">${image?`<img class="product-image" src="${image}" alt="" loading="lazy">`:''}
          ${entry===best?'<small class="best-fit">Best verified match</small>':''}
          <h3>${esc(draft.title)}</h3>
          <div class="product-meta">${storeMark(draft.retailer)} <span>${draft.retailer}</span>
            ${draft.rating!=null?`<span class="rating">★ ${draft.rating.toFixed(1)}</span>`:''}
            ${draft.reviewCount!=null?`<span>${draft.reviewCount.toLocaleString('en-US')} ${draft.reviewCount===1?'review':'reviews'}</span>`:''}
            ${draft.reviewSource==='search'?'<span>via Google Shopping</span>':draft.reviewSource==='catalog'?'<span>across retailers</span>':''}</div>
          <div class="product-meta">${draft.brand?`<span>${esc(draft.brand)}</span>`:''}
          ${draft.size?`<span>${/bottle|tumbler|drinkware/i.test(draft.title)?'Capacity':'Size'} · ${esc(draft.size)}</span>`:''}
          ${draft.pack==null?'':`<span>Pack · ${draft.pack}</span>`}</div>
          ${entry===best?`<p class="fit-reason">${confirmedSpecs?`Advertises ${esc(confirmedSpecs)}. `:''}${reason?'Matches '+esc(reason):'Matches '+esc(line.exact || line.product)+' and is in stock'}.</p>`:''}
        </div>
        <div class="product-quote">
          <strong>${dollars(fit.price)}</strong><small>In stock · Sold by ${esc(draft.seller)}</small>
          ${!hasStandardShipping({...draft,standard:draft.shippingAvailable===true})?'<small>Delivery unconfirmed · Confirm shipping at retailer</small>':''}
          ${draft.lastSeen||draft.checkedAt?`<small>${esc((draft.lastSeen||draft.checkedAt).slice(0,10))} UTC · Observed price</small>`:''}
          ${listingAction(line,search,draft)}
        </div>${listingDetails(draft,fit)}${alternateLinks(draft)}</li>`
    }).join('')}</ul>`:search.loading||historical.length?'':`<div class="verification-empty"><h3>${emptyStatus}</h3>
      ${waiting?'<p>Some retailer checks are still pending. Check existing results when available, or open a retailer search.</p>':failed?'<p>A provider search or product check failed. Use the retailer updates for details.</p>':''}
      ${requirements.length?`<p>Search with these requirements again, or choose one to relax:</p><div class="relax-options">
        ${requirements.map(({key,value})=>`<button type="button" class="text-btn" data-action="relax-requirement" data-key="${key}">Relax ${esc(value)}</button>`).join('')}</div>`:''}
      <button type="button" class="secondary" data-action="retry-verification">Retry search</button></div>`}
    ${historical.length?`<section class="historical-prices" aria-label="Recent historical prices"><h3>Recent historical prices</h3>
      <ul class="product-list">${historical.map(({offer,index})=>`<li class="product-card historical-card">
        <div class="product-main"><h3>${esc(offer.title)}</h3><small>${offer.retailer} · ${offer.size?esc(offer.size)+' · ':''}Pack · ${offer.pack}</small>
        <small>Price last checked <time datetime="${esc(offer.historicalPriceAt)}">${esc(offer.historicalPriceAt!.slice(0,10))} UTC</time></small>
        <small>Stock and shipping unconfirmed${offer.seller?' · Sold by '+esc(offer.seller):' · Seller unconfirmed'}</small>
        ${link(offer.url,'View at retailer')} ${alternateLinks(search.drafts[index])}</div><div class="product-quote"><strong>${money(offer.cents)}</strong><small>Estimated item price</small>${offerButton(offer,index)}</div>
      </li>`).join('')}</ul></section>`:''}
    ${leads.length?`<details class="unverified-links" data-listing="unverified-leads"><summary>View possible matches</summary>
      <ul>${leads.map(({draft,fit})=>`<li>${link(draft.offerUrl||draft.url,draft.title)} · ${draft.retailer} · ${draft.seller?'Sold by '+esc(draft.seller):'Seller unconfirmed'}<br><small>Needs confirmation: ${esc(missingEvidence(draft,fit))}</small></li>`).join('')}</ul></details>`:''}
    ${savedResults && ranked.length+historical.length+leads.length<3?'<button type="button" class="text-btn" data-action="edit-search-requirements">Edit requirements</button>':''}
    ${!search.loading && !exactAmazon?`<div class="direct-search">${stores.map(store=>retailerSearchLink(store,line)).join('')}
      ${ranked.length&&possible?'<button type="button" class="text-btn" data-action="retry-verification">Retry remaining checks</button>':''}
    </div>`:''}
  </section>`
}
function showSearch(line: Line) {
  const results = [...root.querySelectorAll<HTMLElement>('.line-search')].find(row=>row.dataset.line===line.id)
  if (!results) return
  const expanded = new Set([...results.querySelectorAll<HTMLDetailsElement>('details[open]')].map(detail=>detail.dataset.listing))
  const retailerOpen = results.querySelector<HTMLDetailsElement>('.retailer-updates')?.open ?? false
  const hadCatalogAction = Boolean(results.querySelector('[data-catalog-action]'))
  const active = document.activeElement as HTMLElement|null
  const retailerFocused = Boolean(active?.matches('.retailer-updates > summary') && results.contains(active))
  const needsFocus = active instanceof HTMLInputElement && active.closest('.needs-editor') && results.contains(active) ?
    {name:active.name,start:active.selectionStart,end:active.selectionEnd}:null
  const focus = active && results.contains(active) ? {listing:active.closest('.product-card')?.querySelector('details')?.dataset.listing,action:active.dataset.action,retailer:active.dataset.retailer,summary:active.tagName==='SUMMARY'} : null
  results.innerHTML = searchResults(line)
  const retailerUpdates = results.querySelector<HTMLDetailsElement>('.retailer-updates')
  if (retailerUpdates) {
    retailerUpdates.open = retailerOpen || (!hadCatalogAction && Boolean(retailerUpdates.querySelector('[data-catalog-action]')))
    if (retailerFocused) retailerUpdates.querySelector('summary')?.focus({preventScroll:true})
  }
  for (const detail of results.querySelectorAll<HTMLDetailsElement>('details')) {
    if (detail.dataset.listing) detail.open = expanded.has(detail.dataset.listing)
    if (focus?.listing===detail.dataset.listing) {
      const target = focus?.summary?detail.querySelector('summary'):detail.closest('.product-card')?.querySelector('button')
      if (target instanceof HTMLElement && !(target instanceof HTMLButtonElement && target.disabled)) target.focus({preventScroll:true})
    }
  }
  if (focus?.retailer) [...results.querySelectorAll<HTMLButtonElement>('button[data-retailer]')].find(button=>button.dataset.retailer===focus.retailer)?.focus({preventScroll:true})
  if (needsFocus) {
    const input = [...results.querySelectorAll<HTMLInputElement>('.needs-editor input')].find(element=>element.name===needsFocus.name)
    input?.focus({preventScroll:true})
    input?.setSelectionRange(needsFocus.start,needsFocus.end)
  }
}
async function retailerListings(line:Line,store:Store,keyword:boolean,catalog?:'resume'|'restart',timeout=22000,query=searchQuery(line,keyword)):Promise<ListingDraft[] | null> {
  const response = await fetch('/api/listing/search',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({query,retailer:store,mode:keyword?'keyword':'serp',catalog}),
    signal:AbortSignal.timeout(timeout),
  }).catch(error=>{
    if (error.name==='TimeoutError') throw new Error('Cartwise did not receive a search update in time. Try again.')
    throw new Error('Connection to Cartwise interrupted. Make sure the app is running, then try again.')
  })
  const output = await response.json()
  const found = output.results?.[store]
  if (!response.ok || found?.error) throw Object.assign(new Error(found?.error ?? output.error ?? 'Search failed.'),{terminal:Boolean(found?.expired||found?.failed)})
  if (found?.pending) return null
  if (!Array.isArray(found?.offers)) throw new Error('The search did not return listing data.')
  return found.offers
}

async function findListings(line: Line, keywordStore?:PolicyStore) {
  const previous = searchState(line)
  if (!line.product || !liveSearch || needsEditors.has(line.id) || (keywordStore?previous?.pending.includes(keywordStore):previous?.pending.length)) return
  const productUrl = amazonProductUrl(line.product)
  const retailers:readonly PolicyStore[] = keywordStore ? [keywordStore] : productUrl ? [] : targetOnDemand ? ['Walmart'] as const : stores
  const search: ListingSearch = (keywordStore && previous) || {key:searchKey(line),pending:[],catalogPending:new Set(),catalogRestart:new Set(),shopStatus:'',shopFailed:false,failedStores:new Set(),drafts:[],notes:{},checks:new Map(),active:new Set(),deadline:0,loading:false,tip:false,catalogQueries:{}}
  if (retailers.includes('Target')) search.targetRequested = true
  if (brightSearch) search.pending.push(...retailers)
  for (const store of retailers) {
    delete search.notes[store]
    search.failedStores.delete(store)
  }
  searches.set(line.id,search)
  if (savedResults && !keywordStore) mergeDrafts(line,search,judgingDrafts(line))
  if (!search.loading) openBatch(line,search)
  const deadline = search.deadline
  const current = () => isCurrent(line,search)
  const update = () => updateSearch(line,search)
  const merge = (drafts:ListingDraft[]) => {
    if (!current()) return
    const criteria = lines.find(item=>item.id===line.id)!
    mergeDrafts(criteria,search,drafts.filter(draft=>draft.retailer!=='Target'||!targetOnDemand||search.targetRequested))
    queueVerification(criteria,search)
  }
  const shopTask = !keywordStore && shopSavvy ? (async()=>{
    search.shopStatus = 'Searching…'
    update()
    try {
      const response = await fetch('/api/listing/shopsavvy',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(productUrl?{url:productUrl}:{line}),signal:AbortSignal.timeout(10000)})
      const output = await response.json()
      if (!current()) return
      if (!response.ok || !Array.isArray(output.offers)) throw new Error(output.error || 'Offers unavailable.')
      merge(output.offers)
      console.debug('Offer diagnostics',output.offers.map((draft:ListingDraft)=>{
        const fit = reviewFit(line,draft)
        return {url:draft.url,retailer:draft.retailer,provider:draft.provider,rank:quoteRank(line,draft),
          reason:fit.conflicts.join(', ') || (!fit.productMatch?'Product mismatch':missingEvidence(draft,fit))}
      }))
      search.shopStatus = 'Complete'
    } catch (error) {
      if (!current()) return
      search.shopFailed = true
      console.debug('Marketplace provider error',error)
      search.shopStatus = 'Unavailable'
    } finally { update() }
  })() : Promise.resolve()
  if (!brightSearch) {
    for (const store of retailers) search.notes[store] = 'Bright Data unavailable.'
    await shopTask
    update()
    return
  }
  await Promise.all(retailers.map(async store=>{
    const searchCatalog = async (catalog?:'resume'|'restart')=>{
      const withinBatch = () => current() && search.deadline===deadline && Date.now()<deadline
      if (!withinBatch()) return null
      const query = catalog==='resume' ? search.catalogQueries[store]??searchQuery(line,true) : searchQuery(line,true)
      search.catalogQueries[store] = query
      search.notes[store] = catalogSearching
      update()
      try {
        while (withinBatch()) {
          const remaining = Math.min(22000,deadline-Date.now())
          const drafts = await withSlowNotice(retailerListings(line,store,true,catalog,Math.max(1,remaining),query),()=>{
            if (!withinBatch() || search.notes[store]!==catalogSearching) return
            search.notes[store] = catalogSlow
            update()
          })
          if (!current() || search.deadline!==deadline) return null
          search.catalogRestart.delete(store)
          if (drafts!==null) {
            search.catalogPending.delete(store)
            return withinBatch()?drafts:null
          }
          search.catalogPending.add(store)
          search.notes[store] = 'Catalog results are still pending.'
          update()
          catalog = 'resume'
          await delay(Math.min(1500,Math.max(0,deadline-Date.now())))
        }
        return null
      } catch (error) {
        if (!current() || search.deadline!==deadline) return null
        if ((error as {terminal?:boolean}).terminal) {
          search.catalogPending.delete(store)
          search.catalogRestart.add(store)
        } else {
          search.catalogRestart.delete(store)
          search.catalogPending.add(store)
          if (!withinBatch()) return null
        }
        throw error
      }
    }
    try {
      let useKeyword = Boolean(keywordStore) || !serp
      let blocked = false
      const catalog = search.catalogPending.has(store)?'resume':search.catalogRestart.has(store)?'restart':undefined
      let drafts:ListingDraft[]|null
      if (useKeyword) drafts = await searchCatalog(catalog)
      else {
        try { drafts = await retailerListings(line,store,false) }
        catch (error) {
          if (!(error instanceof Error) || !/CAPTCHA/i.test(error.message) || !current()) throw error
          blocked = true
          useKeyword = true
          drafts = await searchCatalog()
        }
      }
      if (!current()) return
      if (drafts) merge(drafts)
      let catalogError = ''
      if (!useKeyword && drafts && needsKeywordSearch(line,drafts)) {
        try {
          const results = await searchCatalog()
          if (!current()) return
          if (results) merge(results)
        } catch (error) {
          if (!current()) return
          search.failedStores.add(store)
          catalogError = error instanceof Error ? error.message : 'The retailer catalog could not be searched.'
        }
      }
      if (!current()) return
      const criteria = lines.find(item=>item.id===line.id)!
      const retailerResults = rankListings(criteria,search.drafts.filter(draft=>draft.retailer===store))
      const checked = retailerResults.filter(({draft})=>!draft.lead)
      const candidates = retailerResults.filter(({fit})=>fit.productMatch)
      const rejections = candidates.length && candidates.every(({fit})=>fit.conflicts.length) ?
        [...new Set(candidates.flatMap(({fit})=>fit.conflicts))] : []
      search.notes[store] = checked.some(({fit})=>fit.eligible)?'Matching product page found.':
        search.catalogPending.has(store)?'Catalog results are still pending.':
        checked.some(({fit})=>fit.shortlist)?'Found a potential match. Review the remaining offer details.':
        catalogError || (
        retailerResults.some(({fit,draft})=>fit.shortlist && draft.lead)?'Possible matches found. Price and stock need verification.':
        rejections.length?'Found listings with conflicts ('+rejections.join(', ')+').':
        'No suitable match found in the results returned.')
      if (blocked) search.notes[store] = 'Search CAPTCHA. '+search.notes[store]
    } catch (error) {
      if (!current()) return
      search.failedStores.add(store)
      search.notes[store] = error instanceof Error ? error.message : 'Provider failure.'
    } finally {
      search.pending = search.pending.filter(retailer=>retailer!==store)
      if (current()) queueVerification(lines.find(item=>item.id===line.id)!,search)
      update()
    }
  }))
  await shopTask
}

function loadMatchingSnapshots() {
  const tokens = (value: string) => value.toLowerCase().match(/[a-z0-9]+/g) ?? []
  const supplied = offers.filter(offer=>offer.source!=='Snapshot' || !offer.lineId)
  const equivalents = lines.flatMap(line=>{
    const wanted = tokens(line.exact || line.product)
    if (!wanted.length || supplied.some(offer=>offer.lineId===line.id)) return []
    return snapshot.filter(offer=>{
      const title = new Set(tokens(offer.product+' '+offer.title+' '+offer.brand))
      return Boolean(offer.url) && wanted.every(word=>title.has(word))
    }).map(offer=>({...offer,id:line.id+'-'+offer.id,lineId:line.id}))
  })
  offers = [...supplied,...equivalents]
}

function field(label: string, name: string, value = '', options = '') {
  return '<label>'+label+'<input name="'+name+'" value="'+esc(value)+'" '+options+'></label>'
}
function checked(value: boolean) { return value ? ' checked' : '' }
function checkbox(label: string,name: string,value: boolean) {
  return '<label class="check"><input type="checkbox" name="'+name+'"'+checked(value)+'>'+label+'</label>'
}
function storeMark(store: Store) {
  return '<span class="store-mark '+store.toLowerCase()+'" aria-hidden="true">'+(store==='Target'?'◎':store==='Amazon'?'a':'✳')+'</span>'
}
function lineEditor(line: Line,index: number) {
  const summary = [line.exact ? 'Locked: '+line.exact : '',...line.must,line.brand,line.size,line.flexible.length && !line.exact ? line.flexible.join(' / ')+' flexible' : ''].filter(Boolean).join(' · ')
  const manualOffers = offers.filter(offer=>offer.lineId===line.id && offer.source==='Manual')
  return `<div class="line" data-id="${esc(line.id)}">
    <div class="line-top"><span class="line-number" aria-hidden="true">${String(index+1).padStart(2,'0')}</span>
    ${field('Item '+(index+1),'product',line.product,'placeholder="e.g. Hydrating facial cleanser" required')}
    ${field('Qty','quantity',Number.isNaN(line.quantity)?'':String(line.quantity),'type="number" min="1" max="99" step="1" required')}
    <button class="remove" data-action="remove" type="button" aria-label="Remove item ${index+1}" ${lines.length===1?'disabled':''}>×</button></div>
    <details class="requirements"><summary>Requirements ${summary?'<span>'+esc(summary)+'</span>':''}</summary>
    <div class="fields">
    ${field('Exact listing title','exact',line.exact,'placeholder="Optional product lock"')}
    ${field('Must-haves','must',line.must.join(', '),'placeholder="e.g. fragrance-free, unscented"')}
    ${field('Preferred brand','brand',line.brand)}${field('Preferred size','size',line.size,'placeholder="e.g. 16 fl oz"')}
    ${field('Item price cap ($)','priceCap',line.priceCap==null?'':String(line.priceCap),'inputmode="decimal" pattern="[0-9]{1,6}([.][0-9]{1,2})?"')}
    ${field('What matters to you','preferences',(line.preferences??[]).join(', '))}</div>
    <div class="checks">${checkbox('Brand can change','flex-brand',line.flexible.includes('brand'))}
    ${checkbox('Size can change','flex-size',line.flexible.includes('size'))}
    ${checkbox('Multipacks allowed','multi',line.multi)}</div></details>
    <div class="line-offers">
      ${manualOffers.map(offer=>`<button type="button" class="offer-chip" data-action="edit-offer" data-offer="${offer.id}">${offer.retailer} · ${money(offer.cents)} · Manual <span>Edit</span></button>`).join('')}
      <button type="button" class="text-btn" data-action="add-offer" ${line.product?'':'disabled'}>+ Add listing</button>
      <button type="button" class="text-btn find-listings" data-action="search-line" ${liveSearch?'':'hidden'} ${line.product?'':'disabled'}>Find listings</button>
    </div></div>`
}
function provenance(plan: Plan) {return [...new Set(plan.purchases.map(item=>item.offer.source))].join(' + ')}
const verifiedLabel = (plan: Plan) => plan.purchases.every(item=>item.offer.source==='Verified') ? 'Price and variant checked on public listings · Seller inferred' : ''
function storeNames(plan: Plan) {return plan.orders.map(order=>order.store).join(' + ')}
function samePlan(left: Plan,right: Plan) {
  return left.total === right.total && left.purchases.length === right.purchases.length && left.purchases.every((item,i)=>item.offer.id===right.purchases[i].offer.id && item.requested===right.purchases[i].requested)
}
function breakdown(plan: Plan, name: string, open = false) {
  return `<details class="breakdown" ${open?'open':''}><summary><span><strong>${name}</strong><small>${esc(storeNames(plan))} · ${money(plan.subtotal)} items · ${dollars(plan.total===null?null:plan.total-plan.subtotal)} shipping</small></span><b>${dollars(plan.total)}</b></summary>
    <div class="breakdown-content">${plan.purchases.map(({offer,requested,packs,cost,line})=>`<div class="purchase"><div><strong>${esc(offer.title)}</strong><small>${storeMark(offer.retailer)} ${offer.retailer} · ${offer.source==='Verified'?'Seller inferred:':'Sold by'} ${esc(offer.seller)} · ${offer.source==='Verified'?'Public listing check':offer.source}</small><small>${requested} needed · ${packs} × ${offer.pack}-unit pack at ${money(offer.cents)}${offer.size?' · '+esc(offer.size)+' per unit':''}${line.must.length?' · '+esc(line.must.join(', ')):''}</small>${link(offer.url,'Listing')}${offer.note?'<small>'+esc(offer.note)+'</small>':''}</div><strong>${money(cost)}</strong></div>`).join('')}
    <div class="receipt"><div><span>Item subtotal</span><strong>${money(plan.subtotal)}</strong></div>
    ${plan.orders.map(order=>`<div><span>${order.store} shipping · ${money(order.subtotal)} order ${order.store==='Amazon'?'':link(policies[order.store].url,'Policy')}</span><strong>${order.shipping===0?'Free (est.)':dollars(order.shipping)}</strong></div>`).join('')}
    <div><strong>Estimated total before tax</strong><strong>${dollars(plan.total)}</strong></div></div></div></details>`
}
function shippingChanges(before: Plan, after: Plan) {
  return after.orders.flatMap(order => {
    const previous = before.orders.find(entry=>entry.store===order.store)
    if (!order.shipping || order.store==='Amazon') return []
    const threshold = policies[order.store].threshold
    if (!previous) return [order.store+' adds '+money(order.shipping)+' shipping as a separate order.']
    if (previous.shipping !== 0) return []
    return [order.store+' falls from '+money(previous.subtotal)+' to '+money(order.subtotal)+', below its '+money(threshold)+' free-shipping threshold. Shipping adds '+money(order.shipping)+'.']
  }).join(' ')
}
const nextSteps: Record<string,string> = {
  'Shipping fee unknown':'Confirm shipping at retailer.',
  'Variant unconfirmed':'Check the exact variant and pack size, then update the offer.',
  'Seller unknown':'Check the listing seller and update the offer.',
  'Availability unknown':'Check stock and update availability.',
  'Unavailable':'Add an in-stock offer.',
  'Multipack requires approval':'Add a single-unit offer or allow multipacks under Requirements.',
  'Different exact product':'Add an offer for the locked product.',
  'Must-have missing':'Add an offer that meets every must-have and record those attributes.',
  'Different brand':'Add an offer for the preferred brand or edit the preference.',
  'Different size':'Add an offer for the preferred size or edit the preference.',
}
function fulfillmentNotice() {
  if (!fulfillmentChecked) return 'Local stock and fees require confirmation at the retailer.'
  if (!/^\d{5}$/.test(zip)) return 'Enter a five-digit US ZIP to check fulfillment.'
  const method = fulfillment==='pickup'?'Pickup':fulfillment==='delivery'?'Local delivery':'Shipping'
  return method+' for '+zip+': the connected sources do not provide ZIP-specific stock or fees. Confirm on the retailer site.'
}
function fulfillmentEditor() {
  return `<section class="fulfillment panel" aria-labelledby="fulfillment-heading"><h2 id="fulfillment-heading">Fulfillment</h2>
    <form id="fulfillment-form"><div class="fulfillment-fields">
      ${field('US ZIP','zip',zip,'inputmode="numeric" autocomplete="postal-code" maxlength="5" pattern="[0-9]{5}" placeholder="Optional"')}
      <label>Method<select name="fulfillment">${[['shipping','Shipping'],['pickup','Pickup'],['delivery','Local delivery']].map(([value,label])=>
        `<option value="${value}" ${fulfillment===value?'selected':''}>${label}</option>`).join('')}</select></label></div>
      <button class="text-btn" type="submit">Check local availability</button>
      <p id="fulfillment-status" role="status">${esc(fulfillmentNotice())}</p>
    </form></section>`
}
function selectionSummary() {
  const {rows,subtotal,historical,estimatedSubtotal,remaining,complete} = selectedCart(lines,selections)
  if (!rows.length) return ''
  const budget = cents(budgetInput)
  const total = complete?.total
  return `<section class="selection-cart panel marketplace-cart" aria-labelledby="selected-cart-heading"><div class="selection-heading">
    <h2 id="selected-cart-heading">Your cart</h2><small>${remaining} required ${remaining===1?'item':'items'} remaining</small></div>
    <ul>${rows.map(({line,offer,issue,purchase})=>`<li><div><small>${esc(line.product||'Shopping list item')}</small>
    <strong>${esc(offer?.title??'Choose a listing')}</strong>
    ${offer?`<small>${offer.retailer} · Sold by ${esc(offer.seller||'Unconfirmed')} · ${purchase?.requested??(Number.isFinite(line.quantity)?line.quantity:'?')} requested · ${purchase?.packs??'—'} × ${offer.pack}-unit pack</small>`:''}
    ${offer?.url?link(offer.url,'View at retailer'):''}
    ${offer&&issue?`<small class="selection-issue">${issue==='Historical price estimate'?'Historical price · '+esc(offer.historicalPriceAt!.slice(0,10))+' · stock and shipping unconfirmed':issue==='Shipping fee unknown'?'Confirm shipping at retailer':'Review required · '+esc(issue)}</small>`:''}</div>
    <div class="selection-actions">${purchase?`<strong>${money(purchase.cost)}</strong>`:''}
    <button type="button" class="text-btn" data-action="${offer&&issue&&issue!=='Shipping fee unknown'&&issue!=='Historical price estimate'?'review-selection':'change-selection'}" data-line="${esc(line.id)}">${offer?(issue&&issue!=='Shipping fee unknown'&&issue!=='Historical price estimate'?'Review selection':'Change selection'):'Find listing'}</button>
    ${offer?`<button type="button" class="text-btn" data-action="remove-selection" data-line="${esc(line.id)}" aria-label="Remove ${esc(line.product)} selection">Remove</button>`:''}</div></li>`).join('')}</ul>
    <dl><div><dt>${historical?'Current selected subtotal':'Selected subtotal'}</dt><dd>${money(subtotal)}</dd></div>
    ${historical?`<div><dt>Estimated item subtotal</dt><dd>${money(estimatedSubtotal)}</dd></div>`:''}
    ${complete?.orders.map(order=>`<div><dt>${order.store} shipping</dt><dd>${dollars(order.shipping)}</dd></div>`).join('')??''}
    <div class="selection-total"><dt>${fulfillment==='shipping'?'Estimated total':'Standard shipping estimate'}</dt><dd>${total==null?'Unconfirmed':money(total)}</dd></div></dl>
    ${total!=null?`<small>${fulfillment==='shipping'?'Policy estimate before tax · ZIP-specific fees unconfirmed':'Shipping comparison only · Pickup or delivery fees unconfirmed'}</small>`:''}
    ${historical && !remaining && budget!=null?`<small>Item-only budget estimate · ${money(Math.abs(estimatedSubtotal-budget))} ${estimatedSubtotal>budget?'over':'under'} budget before unconfirmed shipping.</small>`:''}
    ${total!=null&&budget!=null?`<small>${money(Math.abs(total-budget))} ${total>budget?'over budget':'budget remaining'}</small>`:''}
    ${total==null?`<small>${remaining?'Choose eligible offers for every item to estimate shipping and total.':'Confirm shipping at retailer to get the full total.'}</small>`:''}
  </section>`
}
function cartRegion() {
  const summary = selectionSummary()
  if (mode && !selections.size) return result() + summary
  return summary + (compared || !summary?result():'')
}
function result() {
  const budget = cents(budgetInput)
  if (compared && (lines.some(line=>!line.product || !Number.isInteger(line.quantity) || line.quantity<1 || line.quantity>99) ||
    (budgetInput.trim() && budget===null))) {
    return '<section class="panel no-plan"><h2>Check your shopping list</h2><p>Enter an item name and a whole quantity from 1 to 99 on each line. Enter a dollar amount for the budget or leave it blank.</p></section>'
  }
  if (!compared) return `<section class="empty"><div class="empty-icon">${cart}</div><h2>Your cart</h2><p>Add a shopping list and a budget to compare totals with shipping.</p><div class="empty-stores">${stores.map(store=>`<span>${storeMark(store)} ${store}</span>`).join('')}</div></section>`
  const available = comparisonOffers()
  const result = optimize(lines,available)
  const {best,one,split,baseline,excluded,limited} = result
  const evidence = `<details class="evidence"><summary>Sources, shipping and exclusions</summary><p>Estimates assume eligible first-party items, standard shipping in the contiguous U.S., and no retailer membership or card benefits. Estimates are before tax and have no ZIP-specific checkout confirmation. Manual offers use the same estimated shipping rules when marked eligible.</p><div class="policy-links">${stores.map(store=>link(policies[store].url,store+' shipping policy')).join('')}</div>${excluded.map(({offer,reason})=>`<div class="exclusion"><strong>${esc(offer.title)}</strong><small>${offer.retailer} · ${offer.source==='Verified'?'Public listing check':offer.source} · ${esc(reason)}</small>${offer.note?'<small>'+esc(offer.note)+'</small>':''}${link(offer.url,'Listing')}</div>`).join('')}</details>`
  if (!best || best.total===null) {
    const missing = lines.filter(line=>!available.some(offer=>matchesLine(line,offer) && !excluded.some(entry=>entry.line.id===line.id && entry.offer.id===offer.id)))
    const searching = missing.some(line=>searchState(line)?.pending.length)
    const listingsFound = missing.some(line=>searchState(line)?.drafts.length)
    return `<section class="panel no-plan"><h2>${listingsFound?'Review listings for your cart':searching?'Finding offers for your cart':'No priced complete cart'}</h2><ul class="missing-list">${missing.map(line=>{
      const reasons = excluded.filter(entry=>entry.line.id===line.id)
      const actions = [...new Set(reasons.map(entry=>nextSteps[entry.reason] ?? 'Check the listing details and update the offer.'))].join(' ')
      const editable = reasons.find(entry=>entry.offer.lineId===line.id && entry.offer.source==='Manual')
      const search = searchState(line)
      const next = search?.drafts.length ? 'Review a found offer under this item to include it in the cart.' :
        search?.pending.length ? 'Still searching '+search.pending.join(' and ')+'.' :
        search ? 'No offer is ready to price. See retailer results under this item.' :
        liveSearch ? 'Compare carts to search for offers.' : 'Live search needs Bright Data. Try the example cart or enter an offer manually.'
      return `<li><strong>${esc(line.product)}</strong><p>${esc(actions || next)}</p>
      ${editable?`<button class="secondary" data-action="edit-offer" data-line="${line.id}" data-offer="${esc(editable.offer.id)}">Review listing</button>`:''}</li>`
    }).join('')}</ul>${evidence}</section>`
  }
  const selected = selectedCart(lines,selections).complete
  const swapBefore = selected ?? best
  const swapTotal = swapBefore.total ?? best.total
  const trial = budget !== null && swapTotal > budget ? substitutions(lines,available,budget,swapBefore,selected?selections:undefined)[0] : undefined
  const shippingTotal = (plan: Plan) => plan.orders.reduce((sum,order)=>sum+(order.shipping??0),0)
  const delta = (n: number) => n===0 ? money(0) : (n<0?'−':'+')+money(Math.abs(n))
  const saving = baseline?.total !== null && baseline ? baseline.total-best.total : 0
  const itemAdvantage = one && split ? one.subtotal-split.subtotal : 0
  const shippingPenalty = one && split ? shippingTotal(split)-shippingTotal(one) : 0
  const difference = itemAdvantage>0 && shippingPenalty>itemAdvantage ?
    `The split saves ${money(itemAdvantage)} on items but adds ${money(shippingPenalty)} in shipping.` : ''
  return `<section class="hero-result"><div class="result-label"><span class="status-dot"></span> Recommended cart <span class="provenance">${mode?'Demo snapshot':esc(provenance(best).replace('Verified','Public listing check'))}</span></div>
    <div class="total">${money(best.total)}</div>${verifiedLabel(best)?`<p class="verified-label">${verifiedLabel(best)}</p>`:''}<div class="result-store">${best.orders.map(order=>storeMark(order.store)).join('')} ${esc(storeNames(best))} <span>· estimated before tax</span></div>
    <dl class="cart-costs"><div><dt>Items</dt><dd>${money(best.subtotal)}</dd></div><div><dt>Shipping</dt><dd>${money(shippingTotal(best))}</dd></div></dl>
    <div class="result-footer"><span>${saving>0 ? '<strong>'+money(saving)+' less</strong> than buying each item at its lowest price' : 'Standard shipping estimate'}</span>${budget===null?'':`<b class="budget-state ${best.total>budget?'over':'under'}">${money(Math.abs(best.total-budget))} ${best.total>budget?'over budget':'budget remaining'}</b>`}</div></section>
    ${new Set(best.purchases.map(item=>item.line.id)).size===best.purchases.length ?
      '<button type="button" class="secondary use-recommendation" data-action="use-recommendation">Use recommended cart</button>':
      '<p class="estimate-note">This recommendation uses more than one listing for one item. Choose a single listing on each row to build your cart.</p>'}
    ${limited?'<p class="alert">Search kept up to 10,000 states per item. A cheaper cart or another split may have been missed.</p>':''}
    <section class="plan-comparison"><h2>Compare carts</h2><div class="plan-grid">
      ${one?breakdown(one,one.orders[0].store):'<p class="alert">No priced single-retailer cart.</p>'}
      ${split?breakdown(split,'Split'):'<p class="alert">No priced split using both retailers.</p>'}
    </div>
    ${difference?`<p class="baseline-note">${difference}</p>`:''}
    ${baseline && split && samePlan(baseline,split)?(difference?'':'<p class="baseline-note">The split uses the lowest item prices.</p>'):baseline && !samePlan(baseline,best)?breakdown(baseline,'Lowest item prices first'):''}
    </section>
    ${approved?'<p class="approved" role="status">'+esc(approved)+'</p>':''}
    ${budget!==null && swapTotal>budget && (!selections.size || selected) ? `<section class="swap" id="swap"><div class="swap-title">${spark}<h2>One change to ${selected?'your cart':'the recommended cart'}</h2></div>${trial?
     `<p><strong>${esc(trial.line.product)}</strong> · ${esc(trial.field)} ${esc(trial.line[trial.field])} → ${esc(trial.value)}</p>
     <div class="swap-decision"><dl class="swap-totals"><div><dt>Before</dt><dd>${money(swapTotal)}</dd></div>
     <div><dt>After swap</dt><dd>${dollars(trial.next.total)}</dd></div></dl>
     ${trial.savings>0?`<button class="primary" data-action="apply">Approve ${esc(trial.field)} change ${arr}</button>`:''}</div>
     <div class="swap-metrics"><span>Items <b>${delta(trial.next.subtotal-swapBefore.subtotal)}</b></span><span>Shipping <b>${delta(shippingTotal(trial.next)-shippingTotal(swapBefore))}</b></span><span>${trial.savings<0?'Net increase':'Net savings'} <b>${money(Math.abs(trial.savings))}</b></span></div>
     ${shippingChanges(swapBefore,trial.next)?`<p>${esc(shippingChanges(swapBefore,trial.next))}</p>`:''}
     <p class="retained">${esc(lines.flatMap(line=>[...(line.exact?['Locked: '+line.exact]:[]),...line.must.map(tag=>line.product+' stays '+tag)]).join(' · '))}</p>
     <p>${trial.next.total===budget?'At budget':money(Math.abs((trial.next.total??0)-budget))+(trial.meets?' budget remaining after approval':' over budget after swap')}${mode?' · Demo snapshot':''}</p>
     ${trial.limited?'<p>Trial reached the search limit.</p>':''}
     ${breakdown(trial.next,'Preview changed cart')}`:
     '<p>No eligible offer changes one flexible preference while keeping the rest of your requirements.</p>'}</section>` : ''}
    <section class="comparisons">
    ${evidence}<p class="estimate-note">First-party standard shipping · No membership benefits · ZIP-specific fees and availability may vary.</p></section>`
}
function manual() {
  const line = lines.find(line=>line.id===offerLine)
  if (!line) return ''
  const offer = offers.find(offer=>offer.id===editOffer)
  const selected = (label:string,name:string,values:string[],value:string) =>
    '<label>'+label+'<select name="'+name+'">'+values.map(option=>'<option'+(option===value?' selected':'')+'>'+esc(option)+'</option>').join('')+'</select></label>'
  return `<section class="manual" aria-labelledby="listing-title"><h3 id="listing-title" tabindex="-1">${offer?'Edit listing':'Add listing'} · ${esc(line.product)}</h3>
  <p>Check the price, pack, seller, stock, and shipping eligibility before including this offer in your cart.</p>
  <form id="manual"><div class="fields">
  ${field('Listing URL','url',offer?.url,'type="url" placeholder="https://…"')}
  <div id="listing-lookup" ${liveListings||shopSavvy?'':'hidden'}><button class="secondary" data-action="fetch-listing" type="button">Look up listing</button><p id="lookup-status" role="status"></p></div>
  ${field('Exact listing title','title',offer?.title ?? line.exact,'required')}
  ${selected('Retailer','retailer',[...stores,'Amazon'],offer?.retailer ?? 'Target')}${field('Seller','seller',offer?.seller,'placeholder="e.g. Target"')}
  ${field('Price per pack ($)','price',offer?(offer.cents/100).toFixed(2):'','inputmode="decimal" required')}${field('Units per pack','pack',String(offer?.pack ?? 1),'type="number" min="1" max="99" required')}
  ${field('Brand','brand',offer?.brand)}${field('Size per unit','size',offer?.size)}${field('Confirmed must-haves','tags',offer?.tags.join(', '),'placeholder="Comma-separated"')}
  ${selected('Shipping','shipping',['Unknown fee','Standard eligible'],offer?.standard?'Standard eligible':'Unknown fee')}
  ${selected('Availability','availability',['Unknown','Available','Unavailable'],offer?.available===true?'Available':offer?.available===false?'Unavailable':'Unknown')}</div>
  ${checkbox('Exact variant and pack size checked','certain',offer?.certain ?? false)}
  <p id="offer-error" role="alert">${esc(offerError)}</p>
  ${reviewToCart?'':`<button class="secondary" type="submit" value="save">${offer?'Save listing':'Add manual offer'}</button>`}
  <button class="primary" type="submit" value="choose">${selections.has(line.id)?'Replace selection':'Add to cart'}</button>
  <button class="text-btn" data-action="close-offer" type="button">Cancel</button>
  ${offer?'<button class="text-btn" data-action="delete-offer" type="button">Remove listing</button>':''}</form></section>`
}
function fillListing(form: HTMLFormElement,listing: ListingDraft) {
  const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement
  listingDrafts.set(form,listing)
  input('url').value = listing.offerUrl||listing.url
  input('retailer').value = listing.retailer
  input('title').value = listing.title
  input('price').value = listing.stale?'':listing.price
  input('seller').value = listing.seller
  input('brand').value = listing.brand
  input('availability').value = !listing.stale && listing.available===true?'Available':!listing.stale && listing.available===false?'Unavailable':'Unknown'
  input('shipping').value = listing.shippingAvailable===true && listing.seller===listing.retailer?'Standard eligible':'Unknown fee'
  input('pack').value = listing.pack==null?'':String(listing.pack)
  input('size').value = listingSize(listing)
  const line = lines.find(line=>line.id===offerLine)
  input('tags').value = line && !listing.lead ? reviewFit(line,listing).tags.join(', ') : ''
  input('certain').checked = false
  form.querySelector('#lookup-status')!.textContent = listing.lead ?
    'Discovered link. Open the listing or fetch details before confirming the offer.' :
    'Review the listing fields. Confirm the pack, variant, stock, seller, and shipping before saving.'
}
async function prefillListing(form: HTMLFormElement, button: HTMLButtonElement) {
  const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement
  const url = input('url').value.trim()
  const status = form.querySelector('#lookup-status')!
  if (!url) {
    status.textContent = 'Paste a product URL first.'
    return
  }
  const editable = ['retailer','title','price','seller','brand','availability','shipping','pack','size','tags']
  const original = editable.map(name=>input(name).value)
  const checkedBefore = input('certain').checked
  button.disabled = true
  status.textContent = 'Checking the retailer listing…'
  try {
    const request = async (path:string,body:object,timeout:number) => {
      const response = await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)})
      const data = await response.json()
      if (!response.ok || data.pending) throw new Error(path.endsWith('/shopsavvy')?'Couldn’t check marketplace listings.':data.error || 'Offer check is still pending.')
      return data
    }
    const pending = shopSavvy ? (async()=>{
      const requests = [request('/api/listing/shopsavvy',{url,line:lines.find(line=>line.id===offerLine)},10000)
        .then(data=>data.offers?.[0])]
      if (liveListings && !/^https:\/\/(?:www\.)?amazon\.com\//i.test(url)) requests.push(request('/api/listing',{url,quickCheck:true,operation:'retry'},13500))
      const results = await Promise.allSettled(requests)
      const available = results.flatMap(result=>result.status==='fulfilled' && result.value ? [result.value as ListingDraft] : [])
      const draft = available.find(item=>!item.stale && item.checkedAt && cents(item.price)!==null) ??
        available.find(item=>!item.stale && cents(item.price)!==null) ?? available[0]
      if (!draft) throw new Error('No current listing details. Open the retailer listing to confirm the offer.')
      return draft
    })() : request('/api/listing',{url,operation:'retry'},listingLookupTimeout)
    const draft = await withSlowNotice(pending,()=>{
      if (form.isConnected && input('url').value.trim()===url) status.textContent = 'The retailer is taking longer. You can enter the offer details while it checks.'
    })
    if (input('url').value.trim()!==url) {
      status.textContent = 'The URL changed. Run the lookup again for this listing.'
      return
    }
    if (editable.some((name,index)=>input(name).value!==original[index]) || input('certain').checked!==checkedBefore) {
      status.textContent = 'Your edits were kept. Run the lookup again to prefill these fields.'
      return
    }
    fillListing(form,draft as ListingDraft)
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Lookup failed. Enter the offer manually.'
  } finally {
    button.disabled = false
  }
}
function showMobileResults() {
  if (matchMedia('(max-width: 820px)').matches) root.querySelector('#results')?.scrollIntoView({block:'start'})
}
function prepareSearch(line:Line) {
  const prepared = typedLine(line)
  if (prepared!==line) lines = lines.map(item=>item.id===line.id?prepared:item)
  return prepared
}
function compareCart() {
  compared = true
  notice = ''
  if (!mode && !liveSearch) loadMatchingSnapshots()
  if (mode || !liveSearch) {
    render()
    return false
  }
  const toSearch = lines.filter(line=>line.product && !searchState(line) &&
    !offers.some(offer=>offer.source==='Manual' && offer.lineId===line.id))
  const capacity = Math.max(0,4-[...searches.values()].filter(search=>search.pending.length).length)
  const prepared = toSearch.slice(0,capacity).map(prepareSearch)
  render()
  for (const line of prepared) beginSearch(line)
  if (toSearch.length>capacity) {
    root.querySelector('#notice')!.textContent = 'Search runs up to four items at a time. Click Compare carts again after the current searches finish.'
  }
  root.querySelector('#cart-content')!.innerHTML = cartRegion()
  return prepared.length>0
}
try {
  if (new URLSearchParams(location.search).has('return-live') || new URLSearchParams(location.search).has('judge-offer')) {
    const saved=JSON.parse(sessionStorage.getItem('olt-live-return')??'null')
    if (saved) {
      lines=saved.lines
      offers=saved.offers
      for (const [key,offer] of saved.selections) selections.set(key,offer)
      budgetInput=saved.budget
      compared=saved.compared
      mode=saved.mode
      showSwap=saved.showSwap
      approved=saved.approved
    }
    if (!new URLSearchParams(location.search).has('judge-offer')) history.replaceState(null,'',location.pathname+location.hash)
  }
} catch {}
window.addEventListener('pagehide',()=>{
  sessionStorage.setItem('olt-live-return',JSON.stringify({lines,offers,selections:[...selections],budget:budgetInput,compared,mode,showSwap,approved}))
})
function aiEditor() { return shoppingEntry(esc(shoppingText),busy) }
async function importSearch(text:string) {
  const version = ++importVersion
  let imported:Line[] = []
  let budget:number|null = null
  let message = ''
  if (gemini && !amazonProductUrl(text.trim())) {
    busy = true
    importMessage = 'Reading your list…'
    render()
    try {
      const response = await fetch('/api/requirements',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({text,history:[],extractOnly:true}),signal:AbortSignal.timeout(27000)})
      const output = await response.json()
      if (!response.ok) throw new Error(typeof output.error==='string'?output.error:'Could not extract items.')
      if (version!==importVersion) return
      if (output.intent==='housing' || output.intent==='unsupported') {
        busy = false
        importMessage = output.message
        render()
        return
      }
      if (output.intent==='mixed') message = 'Searching for the retail products in your request.'
      if (!Array.isArray(output.items) || output.items.some((item:Omit<Line,'id'>)=>!item ||
        !['product','exact','brand','size'].every(field=>typeof item[field as 'product']==='string') ||
        !item.product.trim() || !Number.isInteger(item.quantity) || typeof item.multi!=='boolean' ||
        !Array.isArray(item.must) || !Array.isArray(item.preferences) || !Array.isArray(item.flexible))) {
        throw new Error('Invalid shopping items.')
      }
      imported = output.items.map((item:Omit<Line,'id'>)=>({...item,id:id()}))
      budget = output.budget
    } catch {
      message = 'Searching with your text as entered. Review the item requirements below.'
    }
  }
  if (version!==importVersion) return
  busy = false
  if (!imported.length) {
    imported = text.split(/\r?\n/).map(part=>part.trim()).filter(Boolean)
      .map(product=>typedLine({...blank(id()),product}))
  } else if (imported.length===1) {
    const extracted = imported[0]
    const typed = typedLine({...blank(extracted.id),product:text.trim()})
    imported[0] = {...extracted,query:text.trim(),exact:extracted.exact||typed.exact,size:extracted.size||typed.size,
      multi:extracted.multi||typed.multi,
      priceCap:extracted.priceCap??typed.priceCap,
      must:[...new Map([...extracted.must,...typed.must.filter(tag=>/^(?:unscented|fragrance[- ]free|scent[- ]free|scented|pack of \d+)$/i.test(tag))]
        .map(tag=>[words(tag),tag])).values()]}
  }
  const occupied = lines.filter(line=>line.product || selections.has(line.id) || offers.some(offer=>offer.lineId===line.id))
  const reused = new Set<string>()
  for (const item of imported) {
    const prior = occupied.find(line=>!reused.has(line.id) && requirementKey(line)===requirementKey(item))
    if (prior) {
      item.id = prior.id
      reused.add(prior.id)
    }
  }
  lines = [...occupied.filter(line=>!reused.has(line.id)),...imported]
  if (budget!=null) budgetInput = String(budget)
  mode = ''
  showSwap = false
  compared = true
  approved = ''
  importMessage = message
  if (!liveSearch) loadMatchingSnapshots()
  render()
  if (liveSearch) for (const line of imported.slice(0,4)) beginSearch(line)
}
function render() {
  const openRows = [...root.querySelectorAll<HTMLElement>('.line:has(details[open])')].map(row=>row.dataset.id)
  root.innerHTML = `<header class="top"><div class="shell top-inner"><a class="wordmark" href="./">${cart} Cartwise</a>
  <nav aria-label="Shopping shortcuts"><a href="#shopping-heading">Live search</a><a href="#shopping-list">Manual entry</a><button class="secondary example" data-action="demo">${spark} Try example cart</button></nav></div></header>
  <main class="shell"><section class="intro" aria-labelledby="shopping-heading">
    <div class="top-stores"><span>${storeMark('Walmart')} Walmart</span><span>${storeMark('Amazon')} Amazon</span><span>${storeMark('Target')} Target · optional live check</span></div>
    <h1 id="shopping-heading">Build a cart within budget.</h1><p>Compare item prices and check shipping before you choose.</p>
    <a href="/demo.html" class="primary demo-entry">Try the demo</a><small class="demo-entry-label">Demo · Sample prices and delivery</small>
    <div class="budget-entry"><div id="shopping-search">${aiEditor()}</div><button id="snapshot" class="secondary" data-action="try-budget">Try a $37 shopping list</button></div>
    <p id="import-status" class="notice" role="status">${esc(importMessage)}</p>

  </section>
  <div class="workspace"><section class="discovery" aria-label="Product results">
    ${lines.map(line=>`<div class="line-search" data-line="${esc(line.id)}">${searchResults(line)}</div>`).join('')}
  </section>
  <section class="panel editor" id="shopping-list"><div class="editor-head"><h2>Shopping list</h2></div>
  <form id="compare"><div class="lines">${lines.map(lineEditor).join('')}</div>
  <button class="add" type="button" data-action="add"><span aria-hidden="true">＋</span> Add item</button>
  <div class="editor-bottom">${field('Budget ($) <span>optional</span>','budget',budgetInput,'placeholder="e.g. 37.00" inputmode="decimal" pattern="[0-9]{1,6}([.][0-9]{1,2})?"')}
  <button class="primary" type="submit">Compare carts ${arr}</button></div></form>
  ${mode?`<div class="mode"><small>${esc(mode)}</small><button class="text-btn" data-action="budget">${showSwap?'Reset shipping example':'Try budget example'} ${arr}</button><button class="text-btn" data-action="new">New list</button></div>`:''}
  ${manual()}<p id="notice" class="notice" role="status">${esc(notice)}</p></section>
  <aside id="results" class="results" aria-label="Cart summary" aria-live="polite"><div id="cart-content">${cartRegion()}</div>${fulfillmentEditor()}</aside></div>
  <footer>SanD Hacks · Cartwise <span>Estimates before tax · Standard shipping</span></footer></main>`
  for (const row of root.querySelectorAll<HTMLElement>('.line')) {
    if (openRows.includes(row.dataset.id)) row.querySelector<HTMLDetailsElement>('details')!.open = true
  }
}
function readLines() {
  const editor = root.querySelector<HTMLFormElement>('#compare')!
  budgetInput = editor.querySelector<HTMLInputElement>('[name=budget]')!.value
  lines = [...editor.querySelectorAll<HTMLElement>('.line')].map(row=>{
    const input = (name: string) => row.querySelector<HTMLInputElement>('[name="'+name+'"]')!
    const preferences = row.querySelector<HTMLInputElement>('[name=preferences]')
    const cap = cents(input('priceCap').value)
    const next:Line = {priceCap:cap===null?null:cap/100,id:row.dataset.id!,product:input('product').value.trim(),quantity:input('quantity').valueAsNumber,
      exact:input('exact').value.trim(),must:textTags(input('must').value),brand:input('brand').value.trim(),
      size:input('size').value.trim(),multi:input('multi').checked,
      flexible:(['brand','size'] as Attribute[]).filter(f=>input('flex-'+f).checked),
      preferences:textTags(preferences?.value ?? '')}
    const previous = lines.find(line=>line.id===next.id)
    if (previous?.query && requirementKey(previous)===requirementKey(next)) next.query = previous.query
    return next
  })
}
function cancelImport() {
  importVersion++
  busy = false
}
function clearEditor() {
  cancelImport()
  searches.clear()
  needsEditors.clear()
  needsDone.clear()
  selections.clear()
  reviewToCart = false
  offerLine = ''
  editOffer = ''
  shoppingText = ''
  importMessage = ''
  approved = ''
  notice = ''
}
function loadExample(withSwap: boolean) {
  clearEditor()
  lines = structuredClone(demo)
  offers = withSwap ? [...swapOffers] : [...snapshot]
  budgetInput = withSwap ? '37.00' : ''
  mode = 'Demo · Sample prices and delivery · '+(withSwap ? swapLabel : 'Public-listing snapshot · Standard shipping')
  showSwap = withSwap
  compared = true
  approved = ''
  notice = ''
}
root.addEventListener('input', event=>{
  const target = event.target as HTMLInputElement
  const needsForm = target.closest<HTMLFormElement>('form[data-needs]')
  if (needsForm) {
    const editor = needsEditors.get(needsForm.dataset.needs!)
    editor?.custom.set(target.name as NeedKind,target.value)
    return
  }
  if (target.closest('#fulfillment-form')) {
    if (target.name==='zip') zip = target.value.trim()
    if (target.name==='fulfillment') fulfillment = target.value
    fulfillmentChecked = false
    root.querySelector('#fulfillment-status')!.textContent = fulfillmentNotice()
    if (target.name==='fulfillment') root.querySelector('#cart-content')!.innerHTML = cartRegion()
    return
  }
  if (target.name==='shopping' && target.closest('#ai')) {
    if (busy) {
      cancelImport()
      const submit = root.querySelector<HTMLButtonElement>('#ai button')!
      submit.disabled = false
      submit.textContent = 'Find products for me'
    }
  }
  if (target.closest('#compare')) {
    if (target.name==='product') {
      for (const button of target.closest('.line')!.querySelectorAll<HTMLButtonElement>('[data-action=add-offer], .find-listings')) {
        button.disabled = !target.value.trim()
      }
    }
    if (busy) {
      cancelImport()
      const button = root.querySelector<HTMLButtonElement>('#ai button')
      if (button) {
        button.disabled = false
        button.textContent = 'Find products for me'
      }
    }
    approved = ''
    readLines()
    const edited = lines.find(line=>line.id===target.closest<HTMLElement>('.line')?.dataset.id)
    const editor = edited && needsEditors.get(edited.id)
    if (edited && (editor && editor.key!==searchKey(edited) || searches.has(edited.id) && !searchState(edited))) {
      searches.delete(edited.id)
      needsEditors.delete(edited.id)
      needsDone.delete(edited.id)
      showSearch(edited)
    }
    if (compared && !liveSearch && !mode) loadMatchingSnapshots()
    if (edited) showSearch(edited)
    root.querySelector('#cart-content')!.innerHTML = cartRegion()
  }
})
root.addEventListener('click', event=>{
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]')
  if (!button) return
  if (button.dataset.action==='fetch-listing' && button.form) {
    void prefillListing(button.form,button)
    return
  }
  readLines()
  if (busy) cancelImport()
  const lineId = button.dataset.line || button.closest<HTMLElement>('.line')?.dataset.id || button.closest<HTMLElement>('.line-search')?.dataset.line || ''
  const line = lines.find(item=>item.id===lineId)
  if ((button.dataset.action==='search-line' || button.dataset.action==='keyword') && line) {
    if (button.dataset.action==='keyword') {
      const store = stores.find(store=>store===button.dataset.retailer)
      if (store) void findListings(line,store)
    } else {
      const prepared = prepareSearch(line)
      if (prepared!==line) render()
      beginSearch(prepared)
    }
    return
  }
  if (line && button.dataset.action==='needs-choice') {
    const editor = needsEditors.get(line.id)
    const {kind,value} = button.dataset
    if (editor && kind && value) {
      editor.answers.set(kind as NeedKind,value)
      editor.error = undefined
      showSearch(line)
      const selector = `.line-search[data-line="${line.id}"] .needs-editor button[data-kind="${kind}"]`
      const focused = [...root.querySelectorAll<HTMLButtonElement>(selector)].find(option=>option.dataset.value===value)
      const custom = value==='Type my own' ? root.querySelector<HTMLInputElement>(`.needs-editor[data-needs="${line.id}"] input[name="${kind}"]`) : null
      const target = custom ?? focused
      target?.focus({preventScroll:true})
    }
    return
  }
  if (line && button.dataset.action==='skip-needs') {
    completeNeeds(line,true)
    return
  }
  if ((button.dataset.action==='filter-offers' || button.dataset.action==='clear-filters') && line) {
    const search = searchState(line)
    if (!search) return
    const filters = search.filters ??= new Map()
    const {group,value} = button.dataset
    if (button.dataset.action==='clear-filters') filters.clear()
    else if (group && value) {
      if (filters.get(group)===value) filters.delete(group)
      else filters.set(group,value)
    }
    showSearch(line)
    const buttons = [...root.querySelectorAll<HTMLButtonElement>(`.line-search[data-line="${line.id}"] .offer-filters button`)]
    const focus = buttons.find(candidate=>group && candidate.dataset.group===group && candidate.dataset.value===value) ??
      buttons[0] ?? root.querySelector<HTMLElement>(`.line-search[data-line="${line.id}"] .product-card button`)
    focus?.focus({preventScroll:true})
    return
  }
  if (button.dataset.action==='edit-search-requirements' && line) {
    const editor = [...root.querySelectorAll<HTMLElement>('.line')].find(row=>row.dataset.id===line.id)
      ?.querySelector<HTMLDetailsElement>('.requirements')
    if (editor) {
      editor.open = true
      editor.querySelector<HTMLInputElement>('input[name=must]')?.focus()
    }
    return
  }
  if (button.dataset.action==='relax-requirement' && line) {
    const key = button.dataset.key ?? ''
    const changed:Line = {...line,must:[...line.must],query:undefined}
    if (key==='exact' || key==='brand' || key==='size') changed[key] = ''
    else if (key==='priceCap') changed.priceCap = null
    else if (/^must-\d+$/.test(key)) changed.must.splice(Number(key.slice(5)),1)
    else return
    lines = lines.map(item=>item.id===line.id?changed:item)
    render()
    void findListings(changed)
    return
  }
  if (line && button.dataset.action==='search-again') {
    void findListings(line)
    return
  }
  if (line && (button.dataset.action==='retry-verification' || button.dataset.action==='resume-product' || button.dataset.action==='restart-product')) {
    const store = stores.find(store=>store===button.dataset.retailer)
    retryVerification(line,store,button.dataset.action==='restart-product')
    return
  }
  if (line && (button.dataset.action==='select-found' || button.dataset.action==='estimate-found')) {
    const draft = searchState(line)?.drafts[Number(button.dataset.candidate)]
    const offer = draft && (button.dataset.action==='estimate-found'?historicalOffer(line,draft):readyOffer(line,draft))
    if (offer && Number.isInteger(line.quantity) && line.quantity>=1 && line.quantity<=99) {
      selectOffer(line,offer)
      showSearch(line)
      root.querySelector('#cart-content')!.innerHTML = cartRegion()
    }
    return
  }
  if (button.dataset.action==='change-selection' && line) {
    const region = root.querySelector<HTMLElement>(`.line-search[data-line="${line.id}"] .search-results`)
    if (region) region.scrollIntoView({block:'start'})
    else {
      const row = root.querySelector<HTMLElement>(`.line[data-id="${line.id}"]`)
      const find = row?.querySelector<HTMLButtonElement>('.find-listings:not([hidden]):not(:disabled)')
      if (find) find.click()
      else row?.querySelector<HTMLButtonElement>('[data-action=add-offer]')?.click()
    }
    return
  }
  if (button.dataset.action==='review-found' && line) {
    const draft = searchState(line)?.drafts[Number(button.dataset.candidate)]
    if (!draft) return
    offerLine = line.id
    reviewToCart = true
    editOffer = ''
    offerError = ''
    render()
    fillListing(root.querySelector<HTMLFormElement>('#manual')!,draft)
    root.querySelector<HTMLElement>('#listing-title')?.focus()
    return
  }
  switch (button.dataset.action) {
    case 'new':
      clearEditor()
      lines=[blank(id())]
      offers=[]
      budgetInput=''
      mode=''
      showSwap=false
      compared=false
      break
    case 'review-selection':
      if (line) {
        offerLine = line.id
        editOffer = selections.get(line.id)?.id ?? ''
        reviewToCart = true
        offerError = ''
      }
      break
    case 'remove-selection':
      selections.delete(lineId)
      approved = ''
      break
    case 'use-recommendation': {
      const best = optimize(lines,comparisonOffers()).best
      if (best && new Set(best.purchases.map(item=>item.line.id)).size===best.purchases.length) {
        selections.clear()
        for (const {line,offer} of best.purchases) selectOffer(line,offer)
      }
      break
    }
    case 'add-offer':
    case 'edit-offer':
      reviewToCart = false
      offerLine=lineId
      editOffer=button.dataset.offer ?? ''
      offerError=''
      break
    case 'delete-offer':
      offers=offers.filter(offer=>offer.id!==editOffer)
      for (const [key,offer] of selections) if (offer.id===editOffer) selections.delete(key)
      approved=''
      notice='Manual listing removed.'
      // Fall through to close the listing editor.
    case 'close-offer':
      offerLine=''
      editOffer=''
      offerError=''
      break
    case 'demo': loadExample(false); break
    case 'budget': loadExample(!showSwap); break
    case 'try-budget': loadExample(true); break
    case 'add': lines.push(blank(id())); compared = false; break
    case 'remove':
      lines = lines.filter(line=>line.id!==lineId)
      offers = offers.filter(offer=>offer.lineId!==lineId)
      searches.delete(lineId)
      needsEditors.delete(lineId)
      needsDone.delete(lineId)
      selections.delete(lineId)
      if (offerLine===lineId) offerLine=''
      compared=false
      break
    case 'apply': {
      const available = comparisonOffers()
      const selected = selectedCart(lines,selections).complete
      const before = selected ?? optimize(lines,available).best
      const budget = cents(budgetInput)
      if (before && budget!==null) {
        const trial = substitutions(lines,available,budget,before,selected?selections:undefined)[0]
        if (trial && trial.savings>0 && (!selections.size || selected)) {
          lines = trial.changed
          const changed = lines.find(line=>line.id===trial.line.id)!
          const picks = trial.next.purchases.filter(item=>item.line.id===changed.id)
          if (selected && picks.length===1) {
            selections.delete(changed.id)
            selectOffer(changed,picks[0].offer)
          }
          approved = 'Saved '+money(trial.savings)+' with an approved change · '+trial.line.product+' · '+trial.line[trial.field]+' → '+trial.value
        }
      }
      break
    }
  }
  render()
  if (['demo','budget','try-budget','apply'].includes(button.dataset.action ?? '')) showMobileResults()
  if (['add-offer','edit-offer','review-selection'].includes(button.dataset.action ?? '')) root.querySelector<HTMLElement>('#listing-title')?.focus()
  if (button.dataset.action==='add') root.querySelector<HTMLInputElement>('.line:last-child [name=product]')?.focus()
})
root.addEventListener('submit', async event=>{
  event.preventDefault()
  const form = event.target as HTMLFormElement
  if (form.dataset.needs) {
    const line = lines.find(item=>item.id===form.dataset.needs)
    if (line) completeNeeds(line)
    return
  }
  const data = new FormData(form)
  const get = (key: string) => String(data.get(key) ?? '').trim()
  readLines()
  if (form.id==='fulfillment-form') {
    fulfillmentChecked = true
    root.querySelector('#fulfillment-status')!.textContent = fulfillmentNotice()
    return
  }
  if ((form.id==='compare' || form.id==='manual') && busy) cancelImport()
  if (form.id==='compare') {
    if (lines.some(line=>!line.product || !Number.isInteger(line.quantity) || line.quantity<1 || line.quantity>99)) {
      notice = 'Enter an item name and a whole quantity between 1 and 99 on each line.'
    } else if (budgetInput && cents(budgetInput)===null) {
      notice = 'Enter a budget in dollars with up to two decimal places.'
    } else {
      if (!compareCart()) showMobileResults()
      return
    }
    render()
  }
  if (form.id==='manual') {
    const price = cents(get('price'))
    const pack = Number(get('pack'))
    const line = lines.find(line=>line.id===offerLine)
    if (price===null || !line?.product || !get('title') || !Number.isInteger(pack) || pack<1 || pack>99 || (get('url') && !href(get('url')))) {
      offerError = 'Enter an item, listing title, valid price, pack count, and an HTTP or HTTPS link if available.'
      root.querySelector('#offer-error')!.textContent = offerError
      return
    }
    const offer: Offer = {id:editOffer || id(),lineId:line.id,product:line.product,title:get('title'),retailer:get('retailer') as Store,
      seller:stores.find(store=>store.toLowerCase()===get('seller').toLowerCase()) ?? get('seller'),cents:price,pack,brand:get('brand'),size:get('size'),tags:textTags(get('tags')),
      available:get('availability')==='Available'?true:get('availability')==='Unavailable'?false:null,
      certain:data.has('certain'),standard:get('shipping')==='Standard eligible',source:'Manual',url:get('url')}
    const draft = listingDrafts.get(form)
    const previous = offers.find(entry=>entry.id===editOffer)
    if (draft && (draft.offerUrl||draft.url)===offer.url && draft.retailer===offer.retailer && draft.title===offer.title && cents(draft.price)===price) {
      offer.note = 'Listing checked '+(draft.lastSeen||draft.checkedAt||'at an unreported time')+' · Eligibility uses shopper confirmation'
    } else if (!draft && previous?.url===offer.url && previous.retailer===offer.retailer && previous.title===offer.title && previous.cents===price) {
      offer.note = previous.note
    }
    const submitter = (event as SubmitEvent).submitter
    const choosing = submitter instanceof HTMLButtonElement && submitter.value==='choose'
    const issue = !Number.isInteger(line.quantity) || line.quantity<1 || line.quantity>99 ?
      'Enter a quantity from 1 to 99 on the shopping-list row' : selectionIssue(line,offer)
    if (choosing && issue) {
      offerError = issue + '. ' + (nextSteps[issue] ?? 'Review the listing before adding it.')
      root.querySelector('#offer-error')!.textContent = offerError
      return
    }
    offers = [...offers.filter(entry=>entry.id!==offer.id),offer]
    if (selections.get(line.id)?.id===offer.id) selections.set(line.id,offer)
    else if (choosing) selectOffer(line,offer,true)
    if (!mode && !liveSearch) loadMatchingSnapshots()
    notice = (choosing?'Cart selection saved for ':'Manual listing saved for ')+line.product+'.'
    offerLine=''
    editOffer=''
    approved=''
    render()
  }
  if (form.id==='ai') {
    shoppingText = get('shopping')
    void importSearch(shoppingText)
  }

})
render()
fetch('/api/status').then(response=>response.json()).then(output=>{
  gemini = output.gemini===true
}).catch(()=>{})
const judgeToken=new URLSearchParams(location.search).get('judge-offer')
if (judgeToken) {
  history.replaceState(null,'',location.pathname)
  void fetch('/api/judge-handoff?'+new URLSearchParams({token:judgeToken})).then(async response=>{
    if (!response.ok) throw new Error('This comparison expired. Open the extension and compare again.')
    const {key,draft}=await response.json()
    const record=judgeQuotes.find(quote=>quote.key===key)
    if (!record) throw new Error('Product could not be confirmed.')
    const row:Line={...blank('captured-'+key),product:record.category,multi:(record.pack??0)>1}
    const offer=historicalOffer(row,draft)
    if (!offer) throw new Error('That quote is no longer eligible for the estimated cart.')
    lines=lines.filter(item=>item.product || selections.has(item.id))
    if (!lines.some(item=>item.id===row.id)) lines.push(row)
    selectOffer(row,offer)
    notice='Exact item added to the estimated cart.'
    render()
  }).catch(error=>{notice=error.message;render()})
}
fetch('/api/listing/status').then(response=>response.json()).then(output=>{
  liveListings = output.enabled === true
  liveSearch = output.search === true
  brightSearch = output.bright === true || output.bright===undefined && liveSearch
  shopSavvy = output.shopSavvy === true
  targetOnDemand = output.targetOptional === true
  savedResults = output.savedResults === true
  serp = output.serp === true
  for (const button of root.querySelectorAll<HTMLElement>('.find-listings')) button.hidden = !liveSearch
  const lookup = root.querySelector<HTMLElement>('#listing-lookup')
  if (lookup) lookup.hidden = !liveListings && !shopSavvy
}).catch(()=>{})
