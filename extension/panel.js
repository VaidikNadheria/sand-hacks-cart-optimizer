const home='http://127.0.0.1:4180'
const el=id=>document.getElementById(id)
const money=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100)
let saved=[]
const status=text=>{el('status').textContent=text}
const node=(tag,text,parent)=>{
  const child=document.createElement(tag)
  child.textContent=text
  parent.append(child)
  return child
}
const button=(text,parent,action)=>{
  const child=node('button',text,parent)
  child.type='button'
  child.addEventListener('click',action)
  return child
}
async function getSample(params={}) {
  const response=await fetch(home+'/api/demo?'+new URLSearchParams(params))
  const data=await response.json()
  if(!response.ok)throw new Error(data.error)
  return data
}
function renderSaved() {
  el('saved').replaceChildren()
  if (!saved.length) node('li','No saved items yet.',el('saved'))
  for(const item of saved){
    const line=node('li',item.name+' · '+item.variant+' · '+item.pack+' per pack · '+item.price,el('saved'))
    button('Remove',line,async()=>{
      saved=saved.filter(entry=>entry.id!==item.id)
      await chrome.storage.local.set({saved})
      el('matches').replaceChildren()
      renderSaved()
    })
  }
}
async function init() {
  const stored=await chrome.storage.local.get(['saved','zip'])
  saved=Array.isArray(stored.saved)?stored.saved:[]
  el('zip').value=stored.zip??''
  renderSaved()
  button('Open typed sample search',el('open-list'),()=>chrome.tabs.create({url:home+'/demo.html'}))

}
let captured
async function captureWalmart(tab) {
  const [reading]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{
    const title=document.querySelector('h1')?.innerText.trim()
    if (!title) return null
    const page=(document.querySelector('main')??document.body).innerText.split(/Key item features|About this item/i)[0]
    const size=title.match(/\b\d+(?:\.\d+)?\s*(?:fl\.?\s*oz|oz|ounces?)\b/i)?.[0]
    const pack=page.match(/(?:Multipack Quantity|Count per pack)\s*:\s*(\d+)/i)?.[1] ??
      title.match(/\b(?:pack of (\d+)|(\d+)\s*[- ]?pack)\b/i)?.slice(1).find(Boolean)
    const price=document.querySelector('[itemprop="price"]')?.innerText.match(/\$[\d,.]+/)?.[0] ??
      page.match(/(?:Now|current price)\s*\$([\d,]+\.\d{2})/i)?.[0]?.match(/\$[\d,.]+/)?.[0]
    return {title,size,pack:pack?Number(pack):null,price:price??null,url:location.href}
  }})
  if (!reading?.result?.size) throw new Error('The selected variant is not visible yet.')
  captured=reading.result
  await chrome.storage.local.set({realItem:captured})
  status('Saved '+captured.title+' · '+captured.size+' · '+(captured.pack?'Pack '+captured.pack:'Pack unconfirmed')+' · '+(captured.price||'Price unconfirmed'))
}
el('compare-real').addEventListener('click',async()=>{
  const item=captured??(await chrome.storage.local.get('realItem')).realItem
  if (!item) {status('Save a real Walmart item first.');return}
  const results=el('real-results')
  results.replaceChildren()
  status('Checking exact marketplace prices…')
  try {
    const response=await fetch(home+'/api/judge-compare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item)})
    const data=await response.json()
    if (!response.ok) throw new Error(data.error)
    if (!data.offers.length) {status('No comparable prices for this exact size and pack.');return}
    status('Cheapest comparable item price '+money(Number(data.offers[0].price)*100)+' · Shipping unconfirmed')
    for(const offer of data.offers) {
      const row=node('article','',results)
      const link=node('a',offer.retailer,row)
      link.href=offer.url
      link.target='_blank'
      link.rel='noopener'
      node('p',money(Number(offer.price)*100)+' · '+offer.size+' · Pack '+offer.pack,row)
      node('p',(offer.savedQuote?'Saved quote · Last checked ':'Last checked ')+offer.lastSeen.slice(0,10)+' · Shipping unconfirmed',row)
      button('Send to website cart',row,async()=>{
        const url=home+'/?judge-offer='+encodeURIComponent(offer.token)
        const tabs=await chrome.tabs.query({url:home+'/*'})
        const existing=tabs.find(tab=>new URL(tab.url).pathname==='/')
        if(existing) await chrome.tabs.update(existing.id,{url,active:true})
        else await chrome.tabs.create({url})
      })
    }
  }catch(error){status(error.message)}
})
el('save').addEventListener('click',async()=>{
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true})
    const url=new URL(tab?.url??'about:blank')
    if(url.hostname.replace(/^www\./,'')==='walmart.com' && url.protocol==='https:' && url.pathname.startsWith('/ip/')) {await captureWalmart(tab);return}
    if(url.origin!==home || url.pathname!=='/sample.html') {captured=null;await chrome.storage.local.remove('realItem');throw new Error('Open a Walmart product page or a local sample product first.')}
    const [capture]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{
      const product=document.querySelector('[data-sample-id]')
      if(!product)return null
      const text=field=>product.querySelector('[data-field="'+field+'"]')?.innerText.trim()
      return {id:product.dataset.sampleId,name:text('name'),variant:text('variant'),pack:Number(text('pack')),price:text('price')}
    }})
    const visible=capture?.result
    if(!visible)throw new Error('The sample is still loading. Try Save this item again.')
    const {item}=await getSample({id:visible.id})
    if(!item||visible.variant!==item.variant||visible.pack!==item.pack||visible.price!==money(item.price))throw new Error('The visible listing does not match the sample catalog.')
    if(saved.some(item=>item.id===visible.id)){status('This sample is already saved.');return}
    saved.push({...visible,category:item.category})
    await chrome.storage.local.set({saved})
    el('matches').replaceChildren()
    renderSaved()
    status('Saved '+visible.name+'.')
  }catch(error){status(error.message)}
})
document.querySelectorAll('[data-zip]').forEach(control=>control.addEventListener('click',()=>{
  el('zip').value=control.dataset.zip
  el('matches').replaceChildren()
}))
el('zip').addEventListener('input',()=>el('matches').replaceChildren())
el('compare').addEventListener('submit',async event=>{
  event.preventDefault()
  el('matches').replaceChildren()
  const zip=el('zip').value.trim()
  if(!saved.length){status('Save a sample product before comparing.');return}
  if(!['92101','92037'].includes(zip)){status('Enter a supported five-digit ZIP or choose 92101 or 92037.');return}
  try{
    await chrome.storage.local.set({zip})
    const groups=new Map(await Promise.all([...new Set(saved.map(item=>item.category))].map(async category=>
      [category,(await getSample({category,zip})).offers])))
    if (el('zip').value.trim()!==zip) return
    for(const item of saved){
      const section=node('section','',el('matches'))
      node('h3',item.name,section)
      for(const offer of groups.get(item.category)){
        const article=node('article','',section)
        node('strong',offer.name+' · '+offer.marketplace,article)
        node('p',offer.variant+' · '+offer.size+' · '+offer.pack+' per pack',article)
        node('p',money(offer.price)+' · Arrives '+offer.arrival,article)
        button('Send to sample cart',article,async()=>{
          try {
            const {offers}=await getSample({category:item.category,zip})
            if(!offers.some(entry=>entry.id===offer.id))throw new Error('Choose an eligible offer for this ZIP.')
            await chrome.tabs.create({url:home+'/demo.html?'+new URLSearchParams({add:offer.id,saved:item.id,zip})})
            status('Sent '+offer.name+' to the sample cart.')
          } catch(error){status(error.message)}
        })
      }
    }
    status('Sample delivery for '+zip+'.')
  }catch(error){status('Start the local One Less Tab server and try again. '+error.message)}
})
init().catch(()=>status('Open the local demo at '+home+' and reopen this panel.'))
