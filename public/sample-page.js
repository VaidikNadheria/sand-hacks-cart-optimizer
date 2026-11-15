const root = document.querySelector('#sample-product')
const params = new URLSearchParams(location.search)
const id = params.get('id') ?? ''
const show = (tag,text,field) => {
  const node = document.createElement(tag)
  node.textContent = text
  if (field) node.dataset.field = field
  root.append(node)
}
try {
  const response = await fetch('/api/demo?'+new URLSearchParams({id}))
  const {item} = await response.json()
  if (!response.ok || !item) throw new Error('That sample listing is unavailable.')
  root.replaceChildren()
  root.dataset.sampleId = item.id
  show('h1',item.name,'name')
  show('p',item.marketplace,'marketplace')
  show('dt','Selected variant')
  show('dd',item.variant,'variant')
  show('dt','Units per pack')
  show('dd',String(item.pack),'pack')
  show('dt','Sample price')
  show('dd',new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(item.price/100),'price')
  show('p',item.size+' · '+item.evidence.join(' · '))
  show('p','Open the One Less Tab side panel and choose Save this item.')
} catch (error) { root.textContent = error.message }
