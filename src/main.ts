import './style.css'
import {cents,money,matchesLine,optimize,policies,stores,substitutions} from './cart.ts'
import type {Attribute,Line,Offer,Plan,Store} from './cart.ts'
import {blank,demo,snapshot} from './data.ts'
import {swapOffers,swapLabel} from './swap.ts'

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
let budgetInput = ''
let compared = false
let showSwap = false
let approved = ''
let notice = ''
let mode = ''
let gemini = false
let busy = false
let shoppingText = ''
let question = ''
let answer = ''
let offerLine = ''
let editOffer = ''
let offerError = ''
let importVersion = 0
let answers: {question:string;answer:string}[] = []

function field(label: string, name: string, value = '', options = '') {
  return '<label>'+label+'<input name="'+name+'" value="'+esc(value)+'" '+options+'></label>'
}
function checked(value: boolean) { return value ? ' checked' : '' }
function checkbox(label: string,name: string,value: boolean) {
  return '<label class="check"><input type="checkbox" name="'+name+'"'+checked(value)+'>'+label+'</label>'
}
function storeMark(store: Store) {
  return '<span class="store-mark '+store.toLowerCase()+'" aria-hidden="true">'+(store==='Target'?'◎':'✳')+'</span>'
}
function lineEditor(line: Line,index: number) {
  const summary = [line.exact ? 'Locked: '+line.exact : '',...line.must, line.size, line.flexible.length && !line.exact ? line.flexible.join(' / ')+' flexible' : ''].filter(Boolean).join(' · ')
  const manualOffers = offers.filter(offer=>offer.lineId===line.id)
  return `<div class="line" data-id="${esc(line.id)}">
    <div class="line-top"><span class="line-number" aria-hidden="true">${String(index+1).padStart(2,'0')}</span>
    ${field('Item '+(index+1),'product',line.product,'placeholder="e.g. Hydrating facial cleanser" required')}
    ${field('Qty','quantity',Number.isNaN(line.quantity)?'':String(line.quantity),'type="number" min="1" max="99" step="1" required')}
    <button class="remove" data-action="remove" type="button" aria-label="Remove item ${index+1}" ${lines.length===1?'disabled':''}>×</button></div>
    <details class="requirements"><summary>Requirements ${summary?'<span>'+esc(summary)+'</span>':''}</summary>
    <div class="fields">
    ${field('Exact listing title','exact',line.exact,'placeholder="Optional product lock"')}
    ${field('Must-haves','must',line.must.join(', '),'placeholder="e.g. fragrance-free, unscented"')}
    ${field('Preferred brand','brand',line.brand)}${field('Preferred size','size',line.size,'placeholder="e.g. 16 fl oz"')}</div>
    <div class="checks">${checkbox('Brand can change','flex-brand',line.flexible.includes('brand'))}
    ${checkbox('Size can change','flex-size',line.flexible.includes('size'))}
    ${checkbox('Multipacks allowed','multi',line.multi)}</div></details>
    <div class="line-offers">
      ${manualOffers.map(offer=>`<button type="button" class="offer-chip" data-action="edit-offer" data-offer="${offer.id}">${offer.retailer} · ${money(offer.cents)} · Manual <span>Edit</span></button>`).join('')}
      <button type="button" class="text-btn" data-action="add-offer" ${line.product?'':'disabled'}>+ Add listing</button>
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
    ${plan.orders.map(order=>`<div><span>${order.store} shipping · ${money(order.subtotal)} order ${link(policies[order.store].url,'Policy')}</span><strong>${order.shipping===0?'Free (est.)':dollars(order.shipping)}</strong></div>`).join('')}
    <div><strong>Estimated total before tax</strong><strong>${dollars(plan.total)}</strong></div></div></div></details>`
}
function shippingChanges(before: Plan, after: Plan) {
  return after.orders.flatMap(order => {
    const previous = before.orders.find(entry=>entry.store===order.store)
    const threshold = policies[order.store].threshold
    if (!order.shipping) return []
    if (!previous) return [order.store+' adds '+money(order.shipping)+' shipping as a separate order.']
    if (previous.shipping !== 0) return []
    return [order.store+' falls from '+money(previous.subtotal)+' to '+money(order.subtotal)+', below its '+money(threshold)+' free-shipping threshold. Shipping adds '+money(order.shipping)+'.']
  }).join(' ')
}
const nextSteps: Record<string,string> = {
  'Shipping fee unknown':'Confirm standard shipping eligibility on the retailer listing or add another offer.',
  'Variant unconfirmed':'Check the exact variant and pack size, then update the offer.',
  'Seller unknown':'Check the listing seller and update the offer.',
  'Third-party seller':'Add an offer sold by the retailer.',
  'Availability unknown':'Check stock and update availability.',
  'Unavailable':'Add an in-stock offer.',
  'Multipack requires approval':'Add a single-unit offer or allow multipacks under Requirements.',
  'Different exact product':'Add an offer for the locked product.',
  'Must-have missing':'Add an offer that meets every must-have and record those attributes.',
  'Different brand':'Add an offer for the preferred brand or edit the preference.',
  'Different size':'Add an offer for the preferred size or edit the preference.',
}
function result() {
  const budget = cents(budgetInput)
  if (compared && (lines.some(line=>!line.product || !Number.isInteger(line.quantity) || line.quantity<1 || line.quantity>99) ||
    (budgetInput.trim() && budget===null))) {
    return '<section class="panel no-plan"><h2>Check your shopping list</h2><p>Enter an item name and a whole quantity from 1 to 99 on each line. Enter a dollar amount for the budget or leave it blank.</p></section>'
  }
  if (!compared) return `<section class="empty"><div class="empty-icon">${cart}</div><h2>See the whole cart.</h2><p>Compare a single store with a split order, including shipping for every retailer.</p><div class="empty-stores">${stores.map(store=>`<span>${storeMark(store)} ${store}</span>`).join('')}</div></section>`
  const result = optimize(lines,offers)
  const {best,one,split,baseline,excluded,limited} = result
  const evidence = `<details class="evidence"><summary>Sources, shipping and exclusions</summary><p>Estimates assume eligible first-party items, standard shipping in the contiguous U.S., and no retailer membership or card benefits. Estimates are before tax and have no ZIP-specific checkout confirmation. Manual offers use the same estimated shipping rules when marked eligible.</p><div class="policy-links">${stores.map(store=>link(policies[store].url,store+' shipping policy')).join('')}</div>${excluded.map(({offer,reason})=>`<div class="exclusion"><strong>${esc(offer.title)}</strong><small>${offer.retailer} · ${offer.source==='Verified'?'Public listing check':offer.source} · ${esc(reason)}</small>${offer.note?'<small>'+esc(offer.note)+'</small>':''}${link(offer.url,'Listing')}</div>`).join('')}</details>`
  if (!best || best.total===null) {
    const missing = lines.filter(line=>!offers.some(offer=>matchesLine(line,offer) && !excluded.some(entry=>entry.line.id===line.id && entry.offer.id===offer.id)))
    return `<section class="panel no-plan"><h2>No priced complete cart</h2><ul class="missing-list">${missing.map(line=>{
      const reasons = excluded.filter(entry=>entry.line.id===line.id)
      const actions = [...new Set(reasons.map(entry=>nextSteps[entry.reason] ?? 'Check the listing details and update the offer.'))].join(' ')
      return `<li><strong>${esc(line.product)}</strong><p>${esc(actions || 'Add a Target or Walmart listing to price this item.')}</p><button class="secondary" data-action="${reasons.some(entry=>entry.offer.lineId===line.id)?'edit-offer':'add-offer'}" data-line="${line.id}" data-offer="${reasons.find(entry=>entry.offer.lineId===line.id)?.offer.id ?? ''}">${reasons.some(entry=>entry.offer.lineId===line.id)?'Review listing':'Add listing'}</button></li>`
    }).join('')}</ul>${evidence}</section>`
  }
  const trial = budget !== null && best.total > budget ? substitutions(lines,offers,budget,best)[0] : undefined
  const shippingTotal = (plan: Plan) => plan.orders.reduce((sum,order)=>sum+(order.shipping??0),0)
  const delta = (n: number) => n===0 ? money(0) : (n<0?'−':'+')+money(Math.abs(n))
  const saving = baseline?.total !== null && baseline ? baseline.total-best.total : 0
  return `<section class="hero-result"><div class="result-label"><span class="status-dot"></span> Best complete cart <span class="provenance">${esc(provenance(best).replace('Verified','Public listing check'))}</span></div>
    <div class="total">${money(best.total)}</div>${verifiedLabel(best)?`<p class="verified-label">${verifiedLabel(best)}</p>`:''}<div class="result-store">${best.orders.map(order=>storeMark(order.store)).join('')} ${esc(storeNames(best))} <span>· estimated before tax</span></div>
    <div class="result-footer"><span>${saving>0 ? '<strong>'+money(saving)+' less</strong> than buying each item at its lowest price' : '<strong>'+money(best.subtotal)+'</strong> in items · '+money(shippingTotal(best))+' shipping'}</span>${budget===null?'':`<b class="budget-state ${best.total>budget?'over':'under'}">${money(Math.abs(best.total-budget))} ${best.total>budget?'over budget':best.total===budget?'to spare':'under budget'}</b>`}</div></section>
    ${limited?'<p class="alert">Search kept up to 10,000 states per item. A cheaper cart or another split may have been missed.</p>':''}
    ${approved?'<p class="approved" role="status">'+esc(approved)+'</p>':''}
    ${budget!==null && best.total>budget ? `<section class="swap" id="swap"><div class="swap-title">${spark}<h2>One change to your cart</h2></div>${trial?
     `<p><strong>${esc(trial.line.product)}</strong> · ${esc(trial.field)} ${esc(trial.line[trial.field])} → ${esc(trial.value)}</p>
     <div class="swap-metrics"><span>Items <b>${delta(trial.next.subtotal-best.subtotal)}</b></span><span>Shipping <b>${delta(shippingTotal(trial.next)-shippingTotal(best))}</b></span><span>${trial.savings<0?'Net increase':'Net savings'} <b>${money(Math.abs(trial.savings))}</b></span></div>
     ${shippingChanges(best,trial.next)?`<p>${esc(shippingChanges(best,trial.next))}</p>`:''}
     <p class="retained">${esc(lines.flatMap(line=>[...(line.exact?['Locked: '+line.exact]:[]),...line.must.map(tag=>line.product+' stays '+tag)]).join(' · '))}</p>
     <p><strong>${dollars(trial.next.total)} after change</strong> · ${trial.next.total===budget?'At budget':money(Math.abs((trial.next.total??0)-budget))+(trial.meets?' under budget':' over budget')} · ${esc(provenance(trial.next).replace('Verified','Public listing check'))}</p>
     ${trial.limited?'<p>Trial reached the search limit.</p>':''}
     ${breakdown(trial.next,'Preview changed cart')}${trial.savings>0?`<button class="primary" data-action="apply">Approve ${esc(trial.field)} change ${arr}</button>`:''}`:
     '<p>No eligible offer changes one flexible preference while keeping the rest of your requirements.</p>'}</section>` : ''}
    <section class="comparisons"><h2>Compare plans</h2>
    ${one?breakdown(one,'Best single retailer'):'<p class="alert">No priced single-retailer cart.</p>'}
    ${split?breakdown(split,'Best Target + Walmart split'):'<p class="alert">No priced split using both retailers.</p>'}
    ${baseline && split && samePlan(baseline,split)?'<p class="baseline-note">Lowest-item-price baseline · same items and total as the split above.</p>':baseline && !samePlan(baseline,best)?breakdown(baseline,'Lowest item prices first'):''}
    ${evidence}<p class="estimate-note">First-party standard shipping · No membership benefits · ZIP-specific fees and availability may vary.</p></section>`
}
function manual() {
  const line = lines.find(line=>line.id===offerLine)
  if (!line) return ''
  const offer = offers.find(offer=>offer.id===editOffer)
  const selected = (label:string,name:string,values:string[],value:string) =>
    '<label>'+label+'<select name="'+name+'">'+values.map(option=>'<option'+(option===value?' selected':'')+'>'+esc(option)+'</option>').join('')+'</select></label>'
  return `<section class="manual" aria-labelledby="listing-title"><h3 id="listing-title" tabindex="-1">${offer?'Edit listing':'Add listing'} · ${esc(line.product)}</h3>
  <p>Copy the price, pack, and seller from the retailer page. Confirm stock and shipping eligibility to include the offer.</p>
  <form id="manual"><div class="fields">
  ${field('Listing URL','url',offer?.url,'type="url" placeholder="https://…"')}
  ${field('Exact listing title','title',offer?.title ?? line.exact,'required')}
  ${selected('Retailer','retailer',[...stores],offer?.retailer ?? 'Target')}${field('Seller','seller',offer?.seller,'placeholder="e.g. Target"')}
  ${field('Price per pack ($)','price',offer?(offer.cents/100).toFixed(2):'','inputmode="decimal" required')}${field('Units per pack','pack',String(offer?.pack ?? 1),'type="number" min="1" max="99" required')}
  ${field('Brand','brand',offer?.brand)}${field('Size per unit','size',offer?.size)}${field('Confirmed must-haves','tags',offer?.tags.join(', '),'placeholder="Comma-separated"')}
  ${selected('Shipping','shipping',['Unknown fee','Standard eligible'],offer?.standard?'Standard eligible':'Unknown fee')}
  ${selected('Availability','availability',['Unknown','Available','Unavailable'],offer?.available===true?'Available':offer?.available===false?'Unavailable':'Unknown')}</div>
  ${checkbox('Exact variant and pack size checked','certain',offer?.certain ?? false)}
  <p id="offer-error" role="alert">${esc(offerError)}</p>
  <button class="primary" type="submit">${offer?'Save listing':'Add manual offer'}</button>
  <button class="text-btn" data-action="close-offer" type="button">Cancel</button>
  ${offer?'<button class="text-btn" data-action="delete-offer" type="button">Remove listing</button>':''}</form></section>`
}
function showMobileResults() {
  if (matchMedia('(max-width: 820px)').matches) root.querySelector('#results')?.scrollIntoView({block:'start'})
}
function aiEditor() {
  return gemini?`<details class="ai" ${shoppingText||question||busy?'open':''}><summary>Import shopping text with Gemini</summary><form id="ai"><label>Shopping text<textarea name="shopping" required maxlength="2500" placeholder="e.g. A 16 oz CeraVe cleanser, size flexible, with a $25 budget">${esc(shoppingText)}</textarea></label>${question?field(esc(question),'answer',answer,'required maxlength="500"'):''}<button class="secondary" ${busy?'disabled':''}>${busy?'Reading list…':question?'Use this answer':'Turn into editable items'}</button></form></details>`:''
}
function render() {
  const openRows = [...root.querySelectorAll<HTMLElement>('.line:has(details[open])')].map(row=>row.dataset.id)
  root.innerHTML = `<header class="top"><div class="shell top-inner"><a class="wordmark" href="./">${cart} Cartwise</a><div class="top-stores">${stores.map(store=>`<span>${storeMark(store)} ${store}</span>`).join('')}</div></div></header>
  <main class="shell"><section class="intro"><h1>Shop the whole cart.</h1><p>Compare Target and Walmart with shipping included. See if one change can bring you under budget.</p></section>
  <div class="workspace"><section class="panel editor"><div class="editor-head"><h2>Shopping list</h2><button class="secondary example" data-action="demo">${spark} Try example cart</button></div>
  ${aiEditor()}
  <form id="compare"><div class="lines">${lines.map(lineEditor).join('')}</div>
  <button class="add" type="button" data-action="add"><span aria-hidden="true">＋</span> Add item</button>
  <div class="editor-bottom">${field('Budget ($) <span>optional</span>','budget',budgetInput,'placeholder="e.g. 37.00" inputmode="decimal" pattern="[0-9]{1,6}([.][0-9]{1,2})?"')}
  <button class="primary" type="submit">Compare carts ${arr}</button></div></form>
  ${mode?`<div class="mode"><small>${esc(mode)}</small><button class="text-btn" data-action="budget">${showSwap?'Reset shipping example':'Try budget example'} ${arr}</button><button class="text-btn" data-action="new">New list</button></div>`:''}
  ${manual()}<p id="notice" class="notice" role="status">${esc(notice)}</p></section>
  <div id="results" class="results" aria-live="polite">${result()}</div></div>
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
    return {id:row.dataset.id!,product:input('product').value.trim(),quantity:input('quantity').valueAsNumber,
      exact:input('exact').value.trim(),must:textTags(input('must').value),brand:input('brand').value.trim(),
      size:input('size').value.trim(),multi:input('multi').checked,
      flexible:(['brand','size'] as Attribute[]).filter(f=>input('flex-'+f).checked)}
  })
}
function cancelImport() {
  importVersion++
  busy = false
}
function clearEditor() {
  cancelImport()
  offerLine = ''
  editOffer = ''
  shoppingText = ''
  answer = ''
  answers = []
  question = ''
  approved = ''
  notice = ''
}
function loadExample(withSwap: boolean) {
  clearEditor()
  lines = structuredClone(demo)
  offers = withSwap ? [...swapOffers] : [...snapshot]
  budgetInput = withSwap ? '37.00' : ''
  mode = withSwap ? swapLabel : 'Public-listing snapshot · Standard shipping'
  showSwap = withSwap
  compared = true
  approved = ''
  notice = ''
}
root.addEventListener('input', event=>{
  const target = event.target as HTMLInputElement
  if (target.closest('#compare')) {
    if (target.name==='product') {
      target.closest('.line')!.querySelector<HTMLButtonElement>('[data-action=add-offer]')!.disabled = !target.value.trim()
    }
    if (busy) {
      cancelImport()
      const button = root.querySelector<HTMLButtonElement>('#ai button')
      if (button) {
        button.disabled = false
        button.textContent = question?'Use this answer':'Turn into editable items'
      }
    }
    approved = ''
    if (compared) {
      readLines()
      root.querySelector('#results')!.innerHTML = result()
    }
  }
})
root.addEventListener('click', event=>{
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]')
  if (!button) return
  readLines()
  if (busy) cancelImport()
  const lineId = button.dataset.line || button.closest<HTMLElement>('.line')?.dataset.id || ''
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
    case 'add-offer':
    case 'edit-offer':
      offerLine=lineId
      editOffer=button.dataset.offer ?? ''
      offerError=''
      break
    case 'delete-offer':
      offers=offers.filter(offer=>offer.id!==editOffer)
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
    case 'add': lines.push(blank(id())); compared = false; break
    case 'remove':
      lines = lines.filter(line=>line.id!==lineId)
      offers = offers.filter(offer=>offer.lineId!==lineId)
      if (offerLine===lineId) offerLine=''
      compared=false
      break
    case 'apply': {
      const best = optimize(lines,offers).best
      const budget = cents(budgetInput)
      if (best && budget!==null) {
        const trial = substitutions(lines,offers,budget,best)[0]
        if (trial && trial.savings>0) {
          lines = trial.changed
          approved = 'Approved: '+trial.line.product+' · '+trial.line[trial.field]+' → '+trial.value
        }
      }
      break
    }
  }
  render()
  if (['demo','budget','apply'].includes(button.dataset.action ?? '')) showMobileResults()
  if (['add-offer','edit-offer'].includes(button.dataset.action ?? '')) root.querySelector<HTMLElement>('#listing-title')?.focus()
  if (button.dataset.action==='add') root.querySelector<HTMLInputElement>('.line:last-child [name=product]')?.focus()
})
root.addEventListener('submit', async event=>{
  event.preventDefault()
  const form = event.target as HTMLFormElement
  const data = new FormData(form)
  const get = (key: string) => String(data.get(key) ?? '').trim()
  readLines()
  if ((form.id==='compare' || form.id==='manual') && busy) cancelImport()
  if (form.id==='compare') {
    if (lines.some(line=>!line.product || !Number.isInteger(line.quantity) || line.quantity<1 || line.quantity>99)) {
      notice = 'Enter an item name and a whole quantity between 1 and 99 on each line.'
    } else if (budgetInput && cents(budgetInput)===null) {
      notice = 'Enter a budget in dollars with up to two decimal places.'
    } else {
      notice = ''
      compared = true
    }
    render()
    if (compared) showMobileResults()
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
    offers = [...offers.filter(entry=>entry.id!==offer.id),offer]
    notice = 'Manual listing saved for '+line.product+'.'
    offerLine=''
    editOffer=''
    approved=''
    render()
  }
  if (form.id==='ai') {
    const input = get('shopping')
    if (input !== shoppingText) {
      answers = []
      question = ''
    }
    shoppingText = input
    answer = get('answer')
    const history = question && answer ? [...answers,{question,answer}] : answers
    busy = true
    const version = ++importVersion
    notice = ''
    render()
    try {
      const response = await fetch('/api/requirements',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({text:shoppingText,history})})
      if (!response.ok) throw new Error('Provider unavailable')
      const output = await response.json()
      if (version!==importVersion) return
      const used = new Set<string>()
      lines = output.items.map((item: Omit<Line,'id'>)=>{
        const prior = lines.find(line=>!used.has(line.id) && line.product.toLowerCase()===item.product.trim().toLowerCase())
        const lineId = prior?.id ?? id()
        used.add(lineId)
        return {...item,id:lineId}
      })
      offers = offers.filter(offer=>!offer.lineId || used.has(offer.lineId))
      offers = [...snapshot,...offers.filter(offer=>offer.lineId)]
      offerLine = ''
      editOffer = ''
      mode = ''
      showSwap = false
      budgetInput = output.budget===null?'':String(output.budget)
      answers = history
      question = output.followUp ?? ''
      answer = ''
      compared = false
      approved = ''
      notice = 'Gemini drafted these requirements. Review the item labels and fields before comparing.'
    } catch {
      if (version!==importVersion) return
      notice = 'Gemini couldn’t import this list. You can enter or edit every requirement below.'
    } finally {
      if (version===importVersion) {
        busy = false
        render()
      }
    }
  }
})
render()
fetch('/api/status').then(response=>response.json()).then(output=>{
  if (!output.gemini) return
  gemini = true
  if (root.querySelector('.ai')) return
  const compare = root.querySelector('#compare')!
  compare.insertAdjacentHTML('beforebegin', aiEditor())
}).catch(()=>{})
