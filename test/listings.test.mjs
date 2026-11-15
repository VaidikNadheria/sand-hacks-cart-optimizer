import assert from 'node:assert/strict'
import {Readable} from 'node:stream'
import {test} from 'node:test'
import {handleListings,listingConfig,parseSerp} from '../listings.mjs'

async function send(config,path,payload) {
  const req = Object.assign(Readable.from([JSON.stringify(payload)]),{
    method:'POST',url:path,headers:{'content-type':'application/json'},
  })
  let status, body
  const handled = await handleListings(req,{
    writeHead(code) { status = code },
    end(json) { body = JSON.parse(json) },
  },config)
  assert.equal(handled,true)
  return {status,body}
}

const request = (config,url) => send(config,'/api/listing',{url})
const search = (config,query) => send(config,'/api/listing/search',{query})
const config = listingConfig({BRIGHT_DATA_API_KEY:'test-placeholder'})

test('slow catalog and product requests return pending and reuse their provider jobs',async context=>{
  const setup = listingConfig({BRIGHT_DATA_API_KEY:'test-placeholder'})
  const productUrl = 'https://www.target.com/p/-/A-10801059'
  const record = {url:productUrl,title:'Aveeno body lotion',final_price:9.97,currency:'USD'}
  const result = Promise.withResolvers()
  let lookups = 0
  let catalogJobs = 0
  context.mock.method(globalThis,'fetch',async value=>{
    const {pathname} = new URL(value)
    if (pathname.endsWith('/scrapers')) return Response.json([{id:setup.ids.Target,domain:'target.com',
      name:'Target',scrapers:{discover_by_keyword:{input_schema:[{name:'keyword',type:'text',required:true}]}}}])
    if (pathname.endsWith('/trigger')) {
      catalogJobs += 1
      return Response.json({snapshot_id:'sd_target'})
    }
    if (pathname.includes('/progress/')) return Response.json({status:'ready'})
    if (pathname.endsWith('/scrape')) lookups += 1
    else assert.ok(pathname.includes('/snapshot/'))
    await result.promise
    return Response.json([record])
  })
  const find = catalog => send(setup,'/api/listing/search',{query:'Aveeno lotion',retailer:'Target',mode:'keyword',catalog})
  const check = () => send(setup,'/api/listing',{url:productUrl,quickCheck:true})
  try {
    const [catalog,product] = await Promise.all([find(),check()])
    assert.deepEqual(catalog.body.results.Target,{pending:true})
    assert.deepEqual(product,{status:202,body:{pending:true}})
    const status = await send(setup,'/api/listing',{url:productUrl+'?ref=status',operation:'status'})
    assert.deepEqual(status,{status:202,body:{state:'pending',pending:true}})
    assert.equal(lookups,1)
  } finally {
    result.resolve()
  }
  const [catalog,product] = await Promise.all([find('resume'),request(setup,productUrl)])
  assert.equal(catalog.body.results.Target.offers[0].price,'9.97')
  assert.equal(product.body.price,'9.97')
  const status = await send(setup,'/api/listing',{url:productUrl,operation:'status'})
  assert.equal(status.body.state,'succeeded')
  assert.equal(status.body.price,'9.97')
  assert.equal(catalogJobs,1)
  assert.equal(lookups,1)
})

test('lookup validates and normalizes a retailer URL before fetching one listing',async context=>{
  const call = context.mock.method(globalThis,'fetch',async (url,init)=>{
    assert.equal(new URL(url).origin,'https://api.brightdata.com')
    assert.equal(new URL(url).searchParams.get('dataset_id'),config.ids.Walmart)
    assert.deepEqual(JSON.parse(init.body),{input:[{url:'https://www.walmart.com/ip/10818473'}]})
    return Response.json([{url:'https://www.walmart.com/ip/Daily-lotion/10818473',title:'Daily lotion',
      final_price:9.97,currency:'USD',seller_name:'Walmart.com',availability:'IN_STOCK',reviews_count:'2,541',rating:'4.7',
      top_reviews:[{review_text:'<p>Works well for everyday use.</p>'}]}])
  })
  const invalid = await request(config,'https://walmart.com.example.com/ip/10818473')
  assert.equal(invalid.status,400)
  const result = await request(config,'https://www.walmart.com/ip/Daily-lotion/10818473?ref=tracking')
  assert.equal(result.status,200)
  assert.equal(result.body.price,'9.97')
  assert.equal(result.body.seller,'Walmart')
  assert.equal(result.body.available,true)
  assert.equal(result.body.reviewCount,2541)
  assert.equal(result.body.rating,4.7)
  assert.deepEqual(result.body.reviewExcerpts,['Works well for everyday use.'])
  assert.ok(Number.isFinite(Date.parse(result.body.checkedAt)))
  assert.equal(call.mock.callCount(),1)
  assert.equal(Object.hasOwn(result.body,'standard'),false)
})

test('lookup preserves the manual fallback for disabled, pending, and mismatched results',async context=>{
  let provider = Response.json({snapshot_id:'sample'}, {status:202})
  const call = context.mock.method(globalThis,'fetch',async ()=>provider)
  const url = 'https://www.target.com/p/-/A-51148016'
  assert.equal((await request(listingConfig({}),url)).status,503)
  assert.equal(call.mock.callCount(),0)
  const target = listingConfig({BRIGHT_DATA_API_KEY:'test-placeholder',BRIGHT_DATA_TARGET_DATASET_ID:'gd_sample'})
  assert.equal((await request(target,url)).status,504)
  const retry = () => send(target,'/api/listing',{url,operation:'retry'})
  provider = Response.json([{url:'https://www.target.com/p/-/A-76198439',title:'Wrong variant'}])
  const mismatched = await retry()
  assert.equal(mismatched.status,502)
  assert.match(mismatched.body.error,/single record matching this listing/)
  provider = new Response('private provider detail',{status:403})
  assert.deepEqual(await retry(),{status:502,body:{error:'Bright Data returned HTTP 403 for this product page.'}})
  provider = Response.json([{url,title:'Cleanser',initial_price:16.19,currency:'USD'}])
  const partial = await retry()
  assert.equal(partial.status,200)
  assert.equal(partial.body.price,'')
  assert.equal(partial.body.available,null)
})

test('product lookup shares a delayed snapshot and reads pack, size, and shipping evidence',async context=>{
  const setup = listingConfig({BRIGHT_DATA_API_KEY:'test-placeholder'})
  const url = 'https://www.target.com/p/-/A-10801059'
  const call = context.mock.method(globalThis,'fetch',async endpoint=>{
    switch (new URL(endpoint).pathname) {
      case '/datasets/v3/scrape': return Response.json({snapshot_id:'sd_target'},{status:202})
      case '/datasets/v3/progress/sd_target': return Response.json({status:'ready'})
      case '/datasets/v3/snapshot/sd_target': return Response.json([{url,title:'Fragrance-free lotion 16 oz',
        seller_name:'Target.com',shipping_available:true,specifications:[{name:'Count Per Pack',value:'1 bottle'}]}])
      default: assert.fail('Unexpected provider request')
    }
  })
  const [first,second] = await Promise.all([request(setup,url),request(setup,url+'?ref=duplicate')])
  assert.equal(first.status,200)
  assert.deepEqual(first.body,second.body)
  assert.equal(first.body.seller,'Target')
  assert.equal(first.body.pack,1)
  assert.equal(first.body.size,'16 oz')
  assert.equal(first.body.shippingAvailable,true)
  assert.deepEqual((await request(setup,url)).body,first.body)
  assert.equal(call.mock.callCount(),3)
})

test('weight alone and conflicting pack evidence both leave pack count unknown',async context=>{
  const setup = listingConfig({BRIGHT_DATA_API_KEY:'test-placeholder'})
  const urls = ['https://www.walmart.com/ip/100','https://www.walmart.com/ip/200']
  context.mock.method(globalThis,'fetch',async (_endpoint,init)=>{
    const [{url}] = JSON.parse(init.body).input
    return Response.json([url===urls[0] ? {url,title:'Body lotion 16 oz'} :
      {url,title:'Body lotion 16 oz, 2-pack',specifications:{'Count Per Pack':'1'}}])
  })
  for (const url of urls) assert.equal((await request(setup,url)).body.pack,null)
})

test('a matching Target page supplies a preview without treating price or stock as verified',async context=>{
  const setup = listingConfig({})
  const url = 'https://www.target.com/p/-/A-94777919'
  const product = {tcin:'94777919',item:{primary_brand:{name:'Good & Gather'},product_description:{
    title:'Lemon Sparkling Water - 12 fl oz Can Good &#38; Gather',bullet_descriptions:['<b>Package Quantity:</b> 1']}},
    ratings_and_reviews:{statistics:{rating:{average:4.4},review_count:20}}}
  const document = {props:{dehydratedState:{queries:[{state:{data:{data:{data_source_modules:[
    {module_data:{data:{product}}},
  ]}}}}]}}}
  const fetch = context.mock.method(globalThis,'fetch',async (url,init)=>{
    assert.equal(new URL(url).hostname,'www.target.com')
    assert.equal(init.redirect,'manual')
    return new Response('<script id="__NEXT_DATA__" type="application/json">'+JSON.stringify(document)+'</script>')
  })
  const preview = await send(setup,'/api/listing',{url,preview:true})
  assert.equal(preview.status,200)
  assert.equal(preview.body.lead,true)
  assert.equal(preview.body.preview,true)
  assert.equal(preview.body.pack,1)
  assert.equal(preview.body.size,'12 fl oz')
  assert.equal(preview.body.reviewCount,20)
  assert.equal(preview.body.price,'')
  assert.equal(preview.body.available,null)
  assert.match(preview.body.title,/Good & Gather/)
  product.tcin = 'different-item'
  assert.equal((await send(setup,'/api/listing',{url,preview:true})).status,404)
  fetch.mock.mockImplementation(async ()=>new Response('<meta content="'+url+'" property="og:url"/><meta property="og:title" content="Sparkling water 12 fl oz can"/>'))
  const metadataPreview = await send(setup,'/api/listing',{url,preview:true})
  assert.equal(metadataPreview.body.size,'12 fl oz')
  assert.equal(metadataPreview.body.reviewCount,null)
  assert.equal(fetch.mock.callCount(),3)
})

test('product search discovers a keyword scraper for each retailer and returns listing links',async context=>{
  const setup = listingConfig({BRIGHT_DATA_API_KEY:'test-placeholder'})
  const targetUrl = 'https://www.target.com/p/example-lotion/-/A-10801059'
  const walmartUrl = 'https://www.walmart.com/ip/10818473'
  const item = {title:'Aveeno body lotion',final_price:9.97,currency:'USD'}
  const call = context.mock.method(globalThis,'fetch',async (url,init)=>{
    const {pathname,searchParams:params} = new URL(url)
    if (pathname.endsWith('/scrapers')) {
      const walmart = params.get('dataset_id')===setup.ids.Walmart
      assert.equal(params.get('dataset_id'),walmart?setup.ids.Walmart:setup.ids.Target)
      const fields = walmart ? [{name:'keyword',type:'text',required:true},{name:'domain',type:'url',required:true}] :
        [{name:'keywords',type:'text',required:true}]
      return Response.json([{id:walmart?setup.ids.Walmart:setup.ids.Target,domain:walmart?'walmart.com':'target.com',
        name:walmart?'Walmart - products':'Target',
        scrapers:{[walmart?'discover_by_keyword':'discover_by_keywords']:{input_schema:fields}}}])
    }
    if (pathname.includes('/progress/')) return Response.json({status:'ready'})
    if (pathname.includes('/snapshot/')) {
      return pathname.endsWith('sd_walmart') ? Response.json([{...item,url:walmartUrl},{...item,url:walmartUrl},{...item,url:targetUrl}]) :
        Response.json([{...item,url:targetUrl}])
    }
    assert.equal(pathname,'/datasets/v3/trigger')
    assert.equal(params.get('type'),'discover_new')
    const walmart = params.get('dataset_id')===setup.ids.Walmart
    assert.equal(params.get('discover_by'),walmart?'keyword':'keywords')
    const input = walmart ? {keyword:'Aveeno lotion',domain:'https://www.walmart.com/'} : {keywords:'Aveeno lotion'}
    assert.deepEqual(JSON.parse(init.body),{input:[input],limit_per_input:4})
    return Response.json({snapshot_id:walmart?'sd_walmart':'sd_target'})
  })
  const response = await search(setup,'  Aveeno lotion  ')
  assert.equal(response.status,200)
  assert.deepEqual(response.body.results.Target.offers.map(item=>item.url),['https://www.target.com/p/-/A-10801059'])
  assert.deepEqual(response.body.results.Walmart.offers.map(item=>item.url),[walmartUrl])
  assert.equal(call.mock.callCount(),8)
  assert.equal((await search(setup,'Aveeno lotion')).status,200)
  assert.equal(call.mock.callCount(),8)
})

test('product search shows partial results and avoids calling the provider with no key or query',async context=>{
  const setup = listingConfig({BRIGHT_DATA_API_KEY:'test-placeholder'})
  const call = context.mock.method(globalThis,'fetch',async url=>{
    const {pathname,searchParams:params} = new URL(url)
    if (pathname.endsWith('/scrapers')) {
      if (params.get('dataset_id')!==setup.ids.Walmart) return Response.json([])
      return Response.json([{id:setup.ids.Walmart,domain:'walmart.com',name:'Walmart Products',
        scrapers:{discover_by_keyword:{input_schema:[{name:'keyword',required:true}]}}}])
    }
    if (pathname.endsWith('/trigger')) return Response.json({snapshot_id:'sd_walmart'})
    if (pathname.includes('/progress/')) return Response.json({status:'ready'})
    return Response.json([{url:'https://www.walmart.com/ip/10818473',title:'Body lotion'}])
  })
  assert.equal((await search(setup,' ')).status,400)
  assert.equal((await search(listingConfig({}),'lotion')).status,503)
  assert.equal(call.mock.callCount(),0)
  const {body} = await search(setup,'lotion')
  assert.match(body.results.Target.error,/No product keyword scraper/)
  assert.equal(body.results.Walmart.offers.length,1)
  const walmart = await send(setup,'/api/listing/search',{query:'lotion',retailer:'Walmart'})
  assert.deepEqual(Object.keys(walmart.body.results),['Walmart'])
  const invalid = await send(setup,'/api/listing/search',{query:'lotion',retailer:'Amazon'})
  assert.equal(invalid.status,400)
})

test('Light JSON reuses in-flight and cached requests and deduplicates canonical links',async context=>{
  const setup = listingConfig({BRIGHT_DATA_API_KEY:'placeholder',BRIGHT_DATA_SERP_ZONE:'fixture'})
  const call = context.mock.method(globalThis,'fetch',async (url,init)=>{
    assert.equal(url,'https://api.brightdata.com/request')
    const request = JSON.parse(init.body)
    assert.equal(request.format,'raw')
    assert.equal(request.data_format,'parsed_light')
    const params = new URL(request.url).searchParams
    assert.match(params.get('q'),/site:target\.com\/p\/$/)
    assert.equal(params.has('brd_json'),false)
    return Response.json({organic:[
      {title:'Aveeno Daily Moisturizing Lotion',link:'https://www.target.com/p/name/-/A-10801059'},
      {title:'Duplicate',link:'https://www.target.com/p/-/A-10801059?ref=foo'},
      {title:'Sparkling Water - 8pk/12 fl oz Cans',link:'https://www.target.com/p/-/A-12345678'},
      {title:'Wrong retailer',link:'https://www.walmart.com/ip/10818473'},
    ]})
  })
  const lookup = () => send(setup,'/api/listing/search',{query:'Aveeno lotion',retailer:'Target'})
  const [first,second] = await Promise.all([lookup(),lookup()])
  assert.deepEqual(first.body,second.body)
  assert.deepEqual(first.body,(await lookup()).body)
  assert.equal(call.mock.callCount(),1)
  assert.deepEqual(first.body.results.Target.offers.map(x=>[x.url,x.lead,x.price]),[
    ['https://www.target.com/p/-/A-10801059',true,''],['https://www.target.com/p/-/A-12345678',true,''],
  ])
  assert.deepEqual(first.body.results.Target.offers.map(x=>x.pack),[null,8])
})

test('an empty SERP response is isolated from a successful search with no matches',async context=>{
  const setup = listingConfig({BRIGHT_DATA_API_KEY:'placeholder',BRIGHT_DATA_SERP_ZONE:'fixture'})
  context.mock.method(globalThis,'fetch',async (_url,init)=>{
    const restricted = new URL(JSON.parse(init.body).url).searchParams.get('q')
    return restricted.endsWith('site:target.com/p/') ? new Response('') : Response.json({organic:[]})
  })
  const {body} = await search(setup,'body lotion')
  assert.match(body.results.Target.error,/empty SERP response/)
  assert.deepEqual(body.results.Walmart.offers,[])
})

test('search picks up product reviews for canonical retailer links without trusting the shopping price',()=>{
  const primary = 'https://www.target.com/p/-/A-10801059'
  const additional = 'https://www.target.com/p/-/A-12345678'
  const leads = parseSerp({organic:[{link:primary,title:'Fragrance-free body lotion'}],shopping:[
    {link:primary+'?ref=search',title:'Same lotion',rating:4.5,reviews_cnt:952,price:'$9.99'},
    {link:additional,title:'Another body lotion',rating:4.8,reviews_cnt:58},
    {link:'https://www.walmart.com/ip/10818473',title:'Wrong retailer',rating:5,reviews_cnt:5000},
    {link:'https://www.target.com/p/-/A-12345679',title:'Invalid rating',rating:17,reviews_cnt:5000},
    {link:'https://www.target.com/p/-/A-12345680',title:'Unrated lotion'},
  ]},'Target')
  assert.deepEqual(leads.map(({url,rating,reviewCount,reviewSource,price,lead})=>[url,rating,reviewCount,reviewSource,price,lead]),[
    [primary,4.5,952,'search','',true], [additional,4.8,58,'search','',true],
    ['https://www.target.com/p/-/A-12345679',null,5000,'search','',true],
    ['https://www.target.com/p/-/A-12345680',null,null,undefined,'',true],
  ])
  assert.equal(leads[0].title,'Fragrance-free body lotion')
})

test('SERP failures distinguish a provider CAPTCHA from non-JSON responses',async context=>{
  const setup = listingConfig({BRIGHT_DATA_API_KEY:'placeholder',BRIGHT_DATA_SERP_ZONE:'fixture'})
  const call = context.mock.method(globalThis,'fetch',async (_url,init)=>{
    const query = new URL(JSON.parse(init.body).url).searchParams.get('q')
    return query.endsWith('site:target.com/p/')
      ? new Response('',{headers:{'x-brd-error-code':'captcha'}})
      : new Response('<html>unexpected response</html>')
  })
  const {body} = await search(setup,'shampoo')
  assert.match(body.results.Target.error,/blocked \(CAPTCHA\)/)
  assert.match(body.results.Walmart.error,/was not JSON/)
  assert.equal(call.mock.callCount(),2)
})

test('ShopSavvy batches shortlisted ids, preserves time and missing fields, and rejects wrong retailer and variant links',async context=>{
  const setup = listingConfig({SHOPSAVVY_API_KEY:'fixture-only'})
  const recent = new Date(Date.now()-600000).toISOString()
  const older = '2020-01-01T00:00:00.000Z'
  const product = {title:'Aveeno Daily Moisturizing Body Lotion, Fragrance-Free, 18 fl oz',brand:'Aveeno',
    shopsavvy:'products/known-lotion',barcode:'123456789123',identifiers:{walmart:'10818473',target:'10801059'},
    attributes:{'Pack Count':'1'},rating:{value:4.4,count:110}}
  const wrong = {...product,title:'Aveeno Skin Relief Body Lotion, 18 fl oz',barcode:'wrong',shopsavvy:'products/wrong'}
  const call = context.mock.method(globalThis,'fetch',async (raw,init)=>{
    const url = new URL(raw)
    assert.equal(init.headers.Authorization,'Bearer fixture-only')
    if (url.pathname.endsWith('/search')) return Response.json({success:true,data:[wrong,product]})
    assert.equal(url.pathname,'/v1/products/batch')
    assert.deepEqual(JSON.parse(init.body),{identifiers:[product.barcode],include:['offers']})
    return Response.json({success:true,results:[{status:'found',identifier:product.barcode,product,offers:[
      {URL:'https://www.walmart.com/ip/Aveeno-Hydrocortisone-Anti-Itch-Cream/1234',retailer:'walmart.com',price:1,currency:'USD',timestamp:recent},
      {URL:'https://www.walmart.com/ip/Aveeno-Daily-Moisturizing-Lotion-8-fl-oz/98765',retailer:'walmart.com',price:4,currency:'USD',timestamp:recent},
      {URL:'https://www.walmart.com/ip/10818473',retailer:'walmart.com',price:8.99,currency:'USD',availability:'in',seller:'Walmart',is_marketplace:false,timestamp:recent},
      {URL:'https://www.walmart.com/ip/10818473?selectedSellerId=2',retailer:'walmart.com',price:6.99,currency:'USD',availability:'in',seller:'Marketplace',timestamp:older},
      {URL:'https://www.target.com/p/-/A-10801059',retailer:'target.com',price:9.99,currency:'USD',timestamp:older},
      {URL:'https://www.target.com/p/-/A-12345',retailer:'walmart.com',price:10,currency:'USD',timestamp:recent},
    ]}]})
  })
  const {body,status} = await send(setup,'/api/listing/shopsavvy',{line:{product:'body lotion',exact:'Aveeno Daily Moisturizing Lotion',
    brand:'Aveeno',size:'18 fl oz',must:['fragrance-free','regular formula']}})
  assert.equal(status,200)
  assert.equal(call.mock.callCount(),2)
  assert.equal(body.offers.length,2)
  const [walmart,target]=body.offers
  assert.equal(walmart.price,'8.99')
  assert.equal(walmart.available,true)
  assert.equal(walmart.seller,'Walmart')
  assert.equal(walmart.pack,1)
  assert.equal(walmart.variantUnconfirmed,false)
  assert.equal(walmart.lastSeen,recent)
  assert.equal(walmart.shippingAvailable,null)
  assert.equal(target.seller,'')
  assert.equal(target.available,null)
  assert.equal(target.stale,true)
})

test('ShopSavvy supports exact URL lookup and requires the batch quote to belong to that URL',async context=>{
  const setup = listingConfig({SHOPSAVVY_API_KEY:'fixture-only'})
  const identifier = 'https://www.target.com/p/-/A-10801059'
  const product = {title:'Aveeno lotion',shopsavvy:'products/known',match:{by:'url'}}
  context.mock.method(globalThis,'fetch',async (raw,init)=>{
    const url = new URL(raw)
    if (url.pathname==='/v1/products') {
      assert.equal(url.searchParams.get('ids'),identifier)
      return Response.json({success:true,data:[product]})
    }
    assert.deepEqual(JSON.parse(init.body),{identifiers:[identifier],include:['offers']})
    return Response.json({success:true,results:[{identifier,product,status:'found',offers:[
      {URL:'https://www.target.com/p/-/A-99',retailer:'target.com',price:4,currency:'USD'},
    ]}]})
  })
  const response = await send(setup,'/api/listing/shopsavvy',{url:identifier})
  assert.deepEqual(response.body,{offers:[]})
})

test('catalog resume reports expiry without submitting a replacement job',async context=>{
  const setup = listingConfig({BRIGHT_DATA_API_KEY:'fixture-only'})
  const call = context.mock.method(globalThis,'fetch',async ()=>{throw new Error('No provider call expected')})
  setup.searchJobs.set(JSON.stringify(['Target','body lotion']),{until:Date.now()-1,snapshot:Promise.resolve('sd_fixture')})
  const response = await send(setup,'/api/listing/search',{query:'body lotion',retailer:'Target',mode:'keyword',catalog:'resume'})
  assert.equal(response.body.results.Target.expired,true)
  assert.equal(call.mock.callCount(),0)
})

test('Television batches the numeric Smart TV barcode, skips the mount, and normalizes USD retailer offers',async context=>{
  const {tv,mount,tvOfferBatch} = await import('./fixtures/television.mjs')
  const setup = listingConfig({SHOPSAVVY_API_KEY:'fixture-only'})
  const call = context.mock.method(globalThis,'fetch',async (raw,init)=>{
    const url = new URL(raw)
    if (url.pathname.endsWith('/search')) {
      assert.equal(url.searchParams.get('q'),'tv')
      return Response.json({success:true,data:[mount,tv]})
    }
    assert.deepEqual(JSON.parse(init.body),{identifiers:[String(tv.barcode)],include:['offers']})
    return Response.json(tvOfferBatch())
  })
  const {status,body} = await send(setup,'/api/listing/shopsavvy',{line:{product:'Television'}})
  assert.equal(status,200)
  assert.equal(call.mock.callCount(),2)
  assert.deepEqual(body.offers.map(({title,price,retailer,url,stale,shippingAvailable})=>({title,price,retailer,url,stale,shippingAvailable})),[
    {title:tv.title,price:'299.99',retailer:'Walmart',url:'https://www.walmart.com/ip/12340001',stale:false,shippingAvailable:null},
  ])
})

test('ShopSavvy preserves string barcode zeros and uses the product ID for unsafe barcodes',async context=>{
  const setup = listingConfig({SHOPSAVVY_API_KEY:'fixture-only'})
  const products = [
    {title:'55-inch Television',barcode:'001234567890',shopsavvy:'products/zero'},
    {title:'42-inch Television',barcode:Number.MAX_SAFE_INTEGER+1,shopsavvy:'products/fallback'},
  ]
  context.mock.method(globalThis,'fetch',async (url,init)=>{
    if (url.includes('/search?')) return Response.json(products)
    assert.deepEqual(JSON.parse(init.body).identifiers,['001234567890','products/fallback'])
    return Response.json({success:true,results:[]})
  })
  assert.deepEqual((await send(setup,'/api/listing/shopsavvy',{line:{product:'TV'}})).body,{offers:[]})
})

test('product status never starts a scrape and a terminal failure needs an explicit retry',async context=>{
  const setup = listingConfig({BRIGHT_DATA_API_KEY:'fixture-only'})
  const url = 'https://www.target.com/p/-/A-12345678'
  const call = context.mock.method(globalThis,'fetch',async()=>new Response('',{status:503}))
  const sendCheck = operation => send(setup,'/api/listing',{url,quickCheck:true,operation})
  assert.equal((await sendCheck('status')).body.state,'expired')
  assert.equal(call.mock.callCount(),0)
  assert.equal((await sendCheck()).body.state,'failed')
  assert.equal((await sendCheck('status')).body.state,'failed')
  assert.equal((await sendCheck()).body.state,'failed')
  assert.equal(call.mock.callCount(),1)
  assert.equal((await sendCheck('retry')).body.state,'failed')
  assert.equal(call.mock.callCount(),2)
})

test('ShopSavvy exact Amazon link uses ASIN and keeps only verified identifier offers',async context=>{
  const setup = listingConfig({SHOPSAVVY_API_KEY:'fixture-only'})
  const url = 'https://www.amazon.com/dp/B00QY1XZ4W'
  const date = new Date(Date.now()-6*86400000).toISOString()
  const offer = {URL:url,retailer:'Amazon',price:9.47,timestamp:date,availability:'in',condition:'new'}
  const call = context.mock.method(globalThis,'fetch',async value=>{
    const endpoint = new URL(value)
    assert.equal(endpoint.pathname,'/v1/products/offers')
    assert.equal(endpoint.searchParams.get('ids'),'B00QY1XZ4W')
    return Response.json({success:true,data:[{title:'Example Gentle Face Wash 8 fl oz',identifiers:{amazon:'B00QY1XZ4W'},
      attributes:{'Package Quantity':'1'},offers:[offer,{...offer,URL:'https://www.amazon.com/dp/B00QY1XZ4X'}]}]})
  })
  const {body,status} = await send(setup,'/api/listing/shopsavvy',{url})
  assert.equal(status,200)
  assert.equal(call.mock.callCount(),1)
  assert.equal(body.offers.length,1)
  assert.equal(body.offers[0].exactListing,true)
  assert.equal(body.offers[0].pack,1)
  assert.equal(body.offers[0].stale,true)
  assert.equal(body.offers[0].lastSeen,date)
})

test('empty broad batch reuses one exact ASIN lookup and keeps missing seller unconfirmed',async context=>{
  const setup = listingConfig({SHOPSAVVY_API_KEY:'fixture-only'})
  const product = {title:'Example Gentle Body Wash 18 oz',barcode:'123456789012',identifiers:{amazon:'B00QY1XZ4W'}}
  let exact = 0
  context.mock.method(globalThis,'fetch',async value=>{
    const url = new URL(value)
    if (url.pathname.endsWith('/search')) return Response.json({success:true,data:[product,product]})
    if (url.pathname.endsWith('/batch')) return Response.json({success:true,results:[{identifier:product.barcode,status:'found',product,offers:[]}]})
    assert.equal(url.searchParams.get('ids'),'B00QY1XZ4W')
    exact++
    return Response.json({success:true,data:[{...product,attributes:{'Number of Items':'1'},offers:[{
      URL:'https://www.amazon.com/dp/B00QY1XZ4W',retailer:'Amazon',price:9.47,is_marketplace:false,
      timestamp:new Date(Date.now()-6*86400000).toISOString(),
    }]}]})
  })
  for (let i=0;i<2;i++) {
    const {body} = await send(setup,'/api/listing/shopsavvy',{line:{product:'body wash'}})
    assert.equal(body.offers.length,1)
    assert.equal(body.offers[0].pack,1)
    assert.equal(body.offers[0].seller,'')
  }
  assert.equal(exact,1)
})
