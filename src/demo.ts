import {shoppingEntry} from './shopping-entry.ts'
import {typedLine,words} from './fit.ts'
import './demo.css'
import {applyNeeds,needsFor} from './needs.ts'
import type {Need} from './needs.ts'
import type {Line} from './cart.ts'
import {catalog,demoLabel,demoZips,presets,sampleDate,sampleOffers,samplePlan} from '../sample-catalog.mjs'
import type {Preset,SampleRow} from '../sample-catalog.mjs'

const root=document.querySelector<HTMLElement>('#demo')!
const key='one-less-tab-sample-v1'
const money=(value:number|null)=>value===null?'Unconfirmed':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100)
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
const getPreset=(id:string)=>presets.find(p=>p.id===id)
let rows:SampleRow[]=[]
let zip=''
let active=''
let budget='37'
let notice=''
let zipError=''
let editing=false
let shopping=''
let typed:Line|null=null
let openCart=false
let answers=new Map<Need['kind'],string>()
const customAnswers=new Map<string,string>()
try {
  const stored=JSON.parse(localStorage.getItem(key)??'{}')
  if (demoZips.includes(stored.zip)) zip=stored.zip
  if (Array.isArray(stored.rows)) rows=stored.rows.filter((r:SampleRow)=>getPreset(r.category)&&
    typeof r.id==='string'&&Number.isInteger(r.quantity)&&r.quantity>=1&&r.quantity<=99&&
    (!r.offer||catalog.some(item=>item.id===r.offer&&item.category===r.category))).slice(0,30)
  if (typeof stored.budget==='string') budget=stored.budget
}catch {}
active=rows[0]?.id??''
const store=()=>localStorage.setItem(key,JSON.stringify({zip,rows,budget}))
function start(id:string) {
  const existing=rows.find(row=>row.id===id)
  if (!existing) rows.push({id,category:id,quantity:1})
  active=id
  editing=false
  answers.clear();customAnswers.clear()
}
const params=new URLSearchParams(location.search)
if (params.has('add')) {
  const targetZip=params.get('zip')??''
  const item=catalog.find(entry=>entry.id===params.get('add'))
  const original=catalog.find(entry=>entry.id===params.get('saved'))
  if (item && original?.category===item.category && sampleOffers(item.category,targetZip).includes(item)) {
    zip=targetZip
    const id='saved-'+original.id
    const row=rows.find(entry=>entry.id===id)
    if (row) row.offer=item.id
    else rows.push({id,category:item.category,quantity:1,offer:item.id})
    active=id
    openCart=true
    notice='Added '+item.name+' to your sample cart.'
    store()
  } else notice='This selection is unavailable. Choose an eligible offer for 92101 or 92037.'
  history.replaceState(null,'','/demo.html')
}
function chooseZip(value:string) {
  if (!/^\d{5}$/.test(value)) zipError='Enter five digits or choose 92101 or 92037.'
  else if (!demoZips.includes(value)) zipError='Delivery in this demo is available for 92101 and 92037. Choose either example.'
  else {zip=value;zipError='';notice='Sample delivery checked for '+zip+'.'}
  if (zipError) zip=''
}
function questionLine(preset:Preset):Line {
  return typed ?? {id:preset.id,product:preset.name,quantity:1,exact:'',brand:'',size:'',multi:false,flexible:[],
    must:[],priceCap:null,preferences:[]}
}
function acceptNeeds(line:Line) {
  const row=rows.find(row=>row.id===active)
  if (!row) return
  row.required=[...line.must,...line.preferences??[]].map(need=>need.replace(/^for /i,''))
  row.size=line.size
  row.cap=Math.min(getPreset(row.category)!.cap,line.priceCap==null?Infinity:Math.round(line.priceCap*100))
  editing=false
}
function questionnaire(preset:Preset) {
  const questions=needsFor(questionLine(preset))
  return `<form id="demo-needs" class="surface"><h3>Refine your needs</h3>
    ${questions.map(q=>`<fieldset><legend>${esc(q.prompt)}</legend><div class="pills">${[...q.choices,q.kind==='price'?'No price cap':'No preference','Type my own'].map(value=>
    `<button type="button" aria-pressed="${answers.get(q.kind)===value}" data-question="${q.kind}" data-value="${esc(value)}">${esc(value)}</button>`).join('')}</div>
    ${answers.get(q.kind)==='Type my own'?`<input name="${q.kind}" aria-label="${esc(q.prompt)}" placeholder="${esc(q.hint)}" value="${esc(customAnswers.get(q.kind))}" required>`:''}</fieldset>`).join('')}
    <button class="primary">Apply answers</button> <button type="button" data-action="close-needs">Skip and search</button></form>`
}
function render() {
  const selected=rows.find(row=>row.id===active)
  const preset=selected&&getPreset(selected.category)
  const offers=selected&&zip?sampleOffers(selected.category,zip,selected.cap,selected.required,selected.size):[]
  const plan=samplePlan(rows,zip)
  const budgetCents=budget!==''?Math.round(Number(budget)*100):null
  const complete=zip && rows.length>0 && plan.selections.every(row=>row.valid)
  const replacement=selected?.offer&&complete?offers.map(item=>({item,total:samplePlan(rows.map(row=>row.id===selected.id?{...row,offer:item.id}:row),zip).total}))
    .filter(choice=>choice.total!==null&&plan.total!==null&&choice.total<plan.total).sort((a,b)=>a.total!-b.total!)[0]:null
  root.innerHTML=`<header class="bar"><div><a class="brand" href="/demo.html">One Less Tab</a><nav><a href="/?return-live=1">Live search</a><a href="/?return-live=1#snapshot">Original $37 snapshot</a></nav></div></header>
  <main class="demo-shell"><section class="hero"><span class="label">${demoLabel}</span><h1>Find the right item.<br>Know when it arrives.</h1>
  <p>Start with a sample shopping list, then compare delivery by ZIP.</p></section>
  <section class="surface start">${shoppingEntry(esc(shopping))}</section>
  <form class="surface zip" id="zip-form"><div><h2>Where should we deliver?</h2><p>Compare sample arrival dates for San Diego and La Jolla.</p></div>
  <div><div class="zip-input"><label>ZIP code<input name="zip" inputmode="numeric" maxlength="5" autocomplete="postal-code" value="${esc(zip)}"></label><button class="primary">Check delivery</button></div>
  <div class="pills"><button type="button" data-action="zip" data-id="92101">92101</button><button type="button" data-action="zip" data-id="92037">92037</button></div></div>
  ${zipError?`<p class="error" role="alert">${zipError}</p>`:''}</form>
  <p class="notice" role="status">${esc(notice)}</p>
  <div class="demo-grid"><section id="demo-results" aria-label="Sample results">
    ${preset?`<div class="section-head"><div><h2>${preset.name}</h2><p>${[...preset.needs,...(selected.required??[]),selected.size,'Up to '+money(selected.cap??preset.cap)].filter(Boolean).map(esc).join(' · ')}</p></div><button data-action="needs">Refine needs</button></div>`:''}
    ${preset&&editing?questionnaire(preset):''}
    ${editing?'':!zip?'<div class="surface empty-demo">Choose a supported ZIP to see sample offers.</div>':!preset?'<div class="surface empty-demo">Choose a product to see sample offers.</div>':
    `<p class="results-count">${offers.length} eligible listings for ${zip}</p>
    ${offers.map(item=>`<article class="surface demo-card marketplace-card" data-offer="${item.id}"><div><span class="market">${item.marketplace}</span><h3>${item.name}</h3>
      <p>${item.variant} · ${item.size} · ${item.pack} per pack</p><small>Matches ${item.evidence.join(' · ')}</small></div>
      <div class="quote"><strong>${money(item.price)}</strong><span>Arrives ${sampleDate(item.delivery[zip].days)}</span>
      <button class="primary" data-action="add" data-id="${item.id}" ${selected.offer===item.id?'disabled':''}>${selected.offer===item.id?'In your cart':selected.offer?'Choose this offer':'Add to cart'}</button></div>
      <details><summary>Listing details</summary><p>${demoLabel}. Delivery fee applies once per marketplace order.</p><a href="/sample.html?id=${item.id}">Open sample product</a>
      ${item.retailerUrl?` · <a href="${item.retailerUrl}" target="_blank" rel="noopener">Exact retailer listing ↗</a>`:''}</details>
    </article>`).join('')||'<div class="surface empty-demo">No samples meet these needs. Refine your answers to try again.</div>'}`}
  </section><aside class="surface sample-cart marketplace-cart ${openCart?'cart-open':''}" id="sample-cart" aria-label="Sample cart"><div class="section-head"><div><span class="label">${demoLabel}</span><h2>Your sample cart</h2></div><button class="close-cart" data-action="close-cart">Close</button></div>
  ${plan.selections.length?plan.selections.map(row=>`<div class="cart-row" data-row="${esc(row.id)}"><strong>${getPreset(row.category)?.name}</strong><p>${row.item?esc(row.item.name)+' · '+row.item.marketplace:'No offer selected'}</p>
  ${row.valid&&row.delivery?`<small>${money(row.item!.price*row.quantity)} · Arrives ${sampleDate(row.delivery.days)}</small>`:row.item?'<small class="error">Unavailable for this ZIP or these needs</small>':''}
  <div class="row-controls"><label>Packs <input aria-label="Packs for ${getPreset(row.category)?.name}" data-quantity="${esc(row.id)}" type="number" min="1" max="99" value="${row.quantity}"></label>
  <button data-action="replace" data-id="${esc(row.id)}">${row.item&&!row.valid?'Choose a replacement':'Choose offer'}</button><button data-action="remove" data-id="${esc(row.id)}">Remove</button></div></div>`).join(''):'<p>Choose an offer to start your cart.</p>'}
  ${plan.orders.map(order=>`<div class="delivery-order"><strong>${order.marketplace} delivery · ${money(order.fee)}</strong>
  ${order.items.map(item=>`<small>${item.name} · Arrives ${sampleDate(item.days)}</small>`).join('')}</div>`).join('')}
  <dl><div><dt>Eligible items</dt><dd>${money(plan.subtotal)}</dd></div><div><dt>Delivery fees</dt><dd>${zip?money(plan.fee):'Unconfirmed'}</dd></div>
    <div class="total-line"><dt>${complete?'Sample total':'Eligible delivery plan'}</dt><dd data-total="${plan.total}">${zip?money(plan.total):'Unconfirmed'}</dd></div></dl>
  <label>Cart budget ($)<input id="sample-budget" type="number" min="0" step=".01" value="${esc(budget)}"></label>
  ${complete&&plan.total!==null&&budgetCents!==null?`<p>${money(Math.abs(budgetCents-plan.total))} ${plan.total>budgetCents?'over budget':'remaining'}</p>`:''}
  ${replacement?`<div class="suggestion"><strong>Possible savings</strong><p>${replacement.item.name} would make the total ${money(replacement.total)}.</p><button data-action="approve" data-id="${replacement.item.id}">Approve substitution</button></div>`:''}
  </aside></div></main><button class="primary view-cart" data-action="view-cart">View cart · ${rows.filter(row=>row.offer).length}</button>`
  store()
}
root.addEventListener('click',event=>{
  const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button')
  if (!button) return
  const {action,id,question,value}=button.dataset
  if (question)tweak(question as Need['kind'],value??'')
  if (action==='zip'&&id) chooseZip(id)
  if (action==='needs') {editing=!editing;answers.clear();customAnswers.clear()}
  if (action==='close-needs'&&typed) acceptNeeds(typed)
  else if (action==='close-needs') editing=false
  if (action==='replace'&&id) {active=id;typed=null;editing=false;openCart=false}
  if (action==='remove'&&id) {rows=rows.filter(row=>row.id!==id);if(active===id)active=rows[0]?.id??''}
  if (action==='view-cart') openCart=true
  if (action==='close-cart') openCart=false
  if ((action==='add'||action==='approve')&&id) {
    const row=rows.find(row=>row.id===active)
    if (row&&sampleOffers(row.category,zip,row.cap,row.required,row.size).some(item=>item.id===id)) {
      row.offer=id;notice=(action==='approve'?'Approved sample substitution.':'Sample offer added to your cart.')
    }
  }
  if (action||question) {
    render()
    if (action==='replace') root.querySelector('#demo-results')?.scrollIntoView()
    if (question&&value==='Type my own') root.querySelector<HTMLInputElement>(`#demo-needs [name="${question}"]`)?.focus()
  }
})
function tweak(kind:Need['kind'],value:string) {answers.set(kind,value)}
root.addEventListener('submit',event=>{
  event.preventDefault()
  const form=event.target as HTMLFormElement
  const data=new FormData(form)
  if(form.id==='ai') {
    shopping=String(data.get('shopping')??'').trim()
    const text=words(shopping)
    const category=[
      [/\b(?:hand )?(?:dish soap|dishwashing liquid)\b/,'dish-soap'],
      [/\b(?:face|facial) moisturizer\b/,'moisturizer'],
      [/\b(?:face wash|facial cleanser)\b/,'face-wash'],
      [/\b(?:body wash|shower gel)\b/,'body-wash'],
      [/\b(?:deodorants?|antiperspirants?)\b/,'deodorant'],
      [/\bwater bottles?\b/,'bottle'],
    ] as const
    const found=category.find(([pattern])=>pattern.test(text))
    if (!found) {
      notice='Try body wash, face wash, face moisturizer, deodorant, hand dish soap, or water bottles.'
      render()
      return
    }
    start(found[1])
    const preset=getPreset(found[1])!
    typed=null
    const normalized=shopping.replace(found[0],found[1]==='dish-soap'?'dish soap':preset.name)
    typed={...typedLine({...questionLine(preset),product:normalized}),product:preset.name,query:shopping}
    editing=needsFor(typed).length>0
    if(!editing)acceptNeeds(typed)
    notice=''
  }
  if(form.id==='zip-form')chooseZip(String(data.get('zip')??'').trim())
  if(form.id==='demo-needs') {
    const row=rows.find(row=>row.id===active)
    const preset=row&&getPreset(row.category)
    if(row&&preset) {
      const line=questionLine(preset)
      const parsed=applyNeeds(line,needsFor(line),new Map([...answers].map(([kind,value])=>[kind,value==='Type my own'?String(data.get(kind)??''):value])))
      if(parsed.line) {
        acceptNeeds(parsed.line)
      } else notice=parsed.error??'Check your answers.'
    }
  }
  render()
})
root.addEventListener('input',event=>{
  const input=event.target as HTMLInputElement
  if (input.closest('#demo-needs') && input.name!=='cap') customAnswers.set(input.name,input.value)
})
root.addEventListener('change',event=>{
  const input=event.target as HTMLInputElement
  if(input.id==='sample-budget')budget=input.value
  else if(input.dataset.quantity) {
    const row=rows.find(row=>row.id===input.dataset.quantity)
    if(row&&Number.isInteger(input.valueAsNumber))row.quantity=Math.max(1,Math.min(99,input.valueAsNumber))
  } else return
  render()
})
render()
