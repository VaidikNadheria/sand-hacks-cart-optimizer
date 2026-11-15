// Provider fixture used by the browser regression. Local routes and the job cache are real.
const realFetch = globalThis.fetch
let targetReady = 0
globalThis.fetch = async (input,init) => {
  const endpoint = new URL(typeof input==='string'?input:input.url)
  if (endpoint.origin!=='https://api.brightdata.com') return realFetch(input,init)
  const dataset = endpoint.searchParams.get('dataset_id')
  const target = dataset==='gd_fixturetarget'
  const store = target?'Target':'Walmart'
  if (endpoint.pathname.endsWith('/scrapers')) return Response.json([{
    id:dataset,domain:store.toLowerCase()+'.com',name:store,
    scrapers:{discover_by_keyword:{input_schema:[{name:'keyword',type:'text',required:true}]}},
  }])
  if (endpoint.pathname.endsWith('/trigger')) {
    const [{keyword}] = JSON.parse(init.body).input
    if (keyword!=='instant coffee') throw new Error('Unexpected catalog query')
    console.log('FIXTURE_CATALOG '+store)
    return Response.json({snapshot_id:target?'sd_targetcoffee':'sd_walmartcoffee'})
  }
  const coffeeUrl = 'https://www.target.com/p/-/A-23456789'
  const coffee = {url:coffeeUrl,title:'Example Classic Instant Coffee, 7 oz',currency:'USD',current_price:5.49,pack_count:1}
  if (endpoint.pathname.includes('/progress/')) {
    const isTarget = endpoint.pathname.endsWith('sd_targetcoffee')
    if (isTarget && !targetReady) {
      targetReady = Date.now()+11000
    }
    return Response.json({status:isTarget && Date.now()>=targetReady?'ready':'running'})
  }
  if (endpoint.pathname.endsWith('/snapshot/sd_targetcoffee')) return Response.json([coffee])
  if (!endpoint.pathname.endsWith('/scrape')) throw new Error('Unexpected provider endpoint')

  const [{url}] = JSON.parse(init.body).input
  console.log('FIXTURE_SCRAPE '+url)
  if (url===coffeeUrl) return Response.json([{...coffee,seller_name:'Target',in_stock:true,shipping_available:true}])
  await new Promise(resolve=>setTimeout(resolve,10500))
  return Response.json([{
    url, title:'Owala 16 fl oz Kids’ Water Bottle – Day Dreams', final_price:24.99, currency:'USD',
    brand:'Owala', seller_name:'Target', in_stock:true, shipping_available:true,
    specifications:{'Package Quantity':'1','Material':'Stainless Steel'}, rating:4.8, review_count:1812,
    timestamp:new Date().toISOString(),
  }])
}
