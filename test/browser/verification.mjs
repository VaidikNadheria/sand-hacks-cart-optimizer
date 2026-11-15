import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {chromium} from 'playwright'

const port = process.env.CARTWISE_TEST_PORT || '4191'
const base = 'http://127.0.0.1:'+port
const child = spawn(process.execPath,['--import','./test/browser/verification-provider.mjs','server.mjs'],{
  env:{...process.env,PORT:port,BRIGHT_DATA_API_KEY:'fixture-only',BRIGHT_DATA_TARGET_DATASET_ID:'gd_fixturetarget',BRIGHT_DATA_WALMART_DATASET_ID:'gd_fixturewalmart'},
  stdio:['ignore','pipe','inherit'],
})
let output = ''
child.stdout.setEncoding('utf8').on('data',chunk=>{output+=chunk})
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms))
let browser

async function storefront(width,settings={}) {
  const page = await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'})
  page.setDefaultTimeout(18000)
  await page.route('**/api/status',route=>route.fulfill({json:{gemini:false}}))
  await page.route('**/api/listing/status',route=>route.fulfill({json:{enabled:true,search:true,serp:true,bright:true,shopSavvy:false,...settings}}))
  return page
}
async function find(page,product) {
  await page.getByRole('textbox',{name:'Item 1',exact:true}).fill(product)
  await page.getByRole('button',{name:'Find listings',exact:true}).click()
  const region = page.getByRole('region',{name:'Listings for '+product,exact:true})
  await region.getByRole('button',{name:'Skip and search',exact:true}).click()
  return region
}
const walmart = 'https://www.walmart.com/ip/15490467123'
const target = 'https://www.target.com/p/-/A-94803092'
const make = (retailer,url,title,rest={})=>({retailer,url,title,price:'',seller:'',pack:null,available:null,brand:'',checkedAt:'',...rest})
async function assertNoOverflow(page) {
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
}

try {
  for(let i=0;i<50&&!output.includes('Cartwise at');i++) {
    if(child.exitCode!==null) throw new Error('Fixture server unavailable')
    await sleep(100)
  }
  assert.match(output,/Cartwise at/)
  browser = await chromium.launch(process.env.CARTWISE_CHROME_CHANNEL?{channel:process.env.CARTWISE_CHROME_CHANNEL}:{})
  for (const width of [390,1440]) {
    const direct = target+(width===390?'':'0')
    const page = await storefront(width)
    const checks = []
    page.on('response',response=>{
      if(response.url().endsWith('/api/listing')) checks.push({status:response.status(),...response.request().postDataJSON()})
    })
    await page.route('**/api/listing/search',route=>{
      const {retailer,mode}=route.request().postDataJSON()
      const offers=retailer==='Target'&&mode==='serp'?[make('Target',direct,'Owala 16 fl oz Kids’ Water Bottle',{lead:true})]:[]
      return route.fulfill({json:{results:{[retailer]:{offers}}}})
    })
    await page.goto(base)
    const region = await find(page,'water bottle')
    await region.getByText('Checking current prices and stock',{exact:true}).waitFor()
    await region.getByText('Compare price per ounce when bottles differ in size.').waitFor()
    assert.equal(await region.locator('.product-card').count(),0)
    const quote=region.locator('.product-card').filter({hasText:'Day Dreams'})
    await quote.getByText('$24.99',{exact:true}).waitFor()
    await quote.getByText('Capacity · 16 fl oz',{exact:true}).waitFor()
    await quote.getByText('Pack · 1',{exact:true}).waitFor()
    assert.ok(checks.some(check=>check.status===202&&!check.operation))
    assert.ok(checks.some(check=>check.status===200&&check.operation==='status'))
    assert.equal(output.split('\n').filter(line=>line==='FIXTURE_SCRAPE '+direct).length,1)
    await quote.getByRole('button',{name:'Add to cart',exact:true}).click()
    await page.locator('.selection-cart').getByText(/Sold by Target/).waitFor()
    await assertNoOverflow(page)
    await page.getByRole('button',{name:'Try a $37 shopping list'}).click()
    await page.getByRole('button',{name:'Use recommended cart'}).click()
    await page.getByRole('button',{name:'Approve size change'}).click()
    await page.locator('.selection-total dd').getByText('$36.97',{exact:true}).waitFor()
    await page.close()

    const mixed = await storefront(width,{shopSavvy:true})
    const attempts = []
    const sellerUrl = walmart+'?selectedSellerId=fixture'
    const marketplace = make('Walmart',walmart,'Owala Stainless Steel 16 oz Water Bottle, Make Waves',{
      seller:'Independent Sport Shop',price:'24.97',available:true,pack:1,shippingAvailable:null,
      size:'16 oz',brand:'Owala',offerUrl:sellerUrl,checkedAt:new Date().toISOString(),
    })
    await mixed.route('**/api/listing/shopsavvy',route=>route.fulfill({json:{offers:[
      {...marketplace,price:'8.00',provider:'ShopSavvy',stale:true,lastSeen:'2021-01-01T00:00:00Z'},
    ]}}))
    await mixed.route('**/api/listing/search',route=>{
      const {retailer,mode}=route.request().postDataJSON()
      const offers=retailer==='Target'&&mode==='serp'?[
        make('Target',target,'Owala 16 fl oz Water Bottle',{lead:true}),
        make('Target','https://www.target.com/p/-/A-12345678','Owala 16 fl oz Water Bottle, Blue',{lead:true}),
      ]:[]
      return route.fulfill({json:{results:{[retailer]:{offers}}}})
    })
    await mixed.route('**/api/listing',route=>{
      const request=route.request().postDataJSON()
      attempts.push(request.url)
      const quote=request.url===walmart?marketplace:request.url===target?
        make('Target',target,'Owala 16 fl oz Water Bottle',{size:'16 fl oz',price:'22.00',available:true,pack:1}):
        make('Target',request.url,'Owala 24 fl oz Water Bottle',{size:'24 fl oz',price:'23.00',seller:'Target',available:true,pack:1})
      return route.fulfill({json:quote})
    })
    await mixed.goto(base)
    await mixed.getByRole('textbox',{name:'Item 1',exact:true}).fill('water bottle')
    await mixed.locator('.requirements summary').click()
    await mixed.getByLabel('Preferred size').fill('16 fl oz')
    await mixed.getByRole('button',{name:'Find listings',exact:true}).click()
    await mixed.getByRole('button',{name:'Skip and search',exact:true}).click()
    const card=mixed.locator('.product-card')
    await card.getByText('$24.97',{exact:true}).waitFor()
    assert.ok(attempts.includes(walmart))
    assert.equal(await card.count(),1)
    assert.equal(await mixed.getByText('$8.00',{exact:true}).count(),0)
    await card.getByRole('button',{name:'Add to cart',exact:true}).click()
    await mixed.locator('.selection-cart').getByText(/Sold by Independent Sport Shop/).waitFor()
    await mixed.locator('.selection-cart').getByText('Confirm shipping at retailer',{exact:true}).waitFor()
    await mixed.locator('.selection-total dd').getByText('Unconfirmed',{exact:true}).waitFor()
    assert.equal(await mixed.locator('.selection-cart').getByRole('link',{name:'View at retailer'}).getAttribute('href'),sellerUrl)
    await mixed.close()

    const deadline = await storefront(width)
    await deadline.clock.install()
    await deadline.route('**/api/listing/search',route=>{
      const {retailer,mode}=route.request().postDataJSON()
      return route.fulfill({json:{results:{[retailer]:{offers:retailer==='Target'&&mode==='serp'?
        [make('Target',target,'Owala 16 fl oz Water Bottle',{lead:true})]:[]}}}})
    })
    await deadline.route('**/api/listing',route=>route.fulfill({status:202,json:{pending:true,state:'pending'}}))
    await deadline.goto(base)
    const pending = await find(deadline,'water bottle')
    await pending.getByText('Checking current prices and stock',{exact:true}).waitFor()
    await deadline.clock.fastForward(46000)
    await pending.getByText('Couldn’t confirm current prices or stock',{exact:true}).waitFor()
    assert.equal(await pending.locator('.product-card').count(),0)
    await pending.getByRole('button',{name:'Retry search'}).waitFor()
    await pending.getByRole('link',{name:'Search Walmart'}).waitFor()
    await assertNoOverflow(deadline)
    await deadline.close()
    console.log(width+'px: one-scrape pending handoff, current mixed batch, marketplace cart, deadline fallback and $36.97 demo passed')
  }

  async function productFeatures(width) {
    const page = await storefront(width)
    const searches = []
    const checks = []
    const data = [
      make('Target','https://www.target.com/p/-/A-76543210','Clear Dishwashing Liquid, Unscented, 18 oz',{
        size:'18 oz',attributes:[{name:'Scent',value:'Fragrance Free'}],
      }),
      make('Walmart','https://www.walmart.com/ip/76543211','Clear Liquid Dish Soap, Scented, 30 oz',{
        size:'30 oz',attributes:[{name:'Scent',value:'Scented'}],
      }),
      make('Walmart','https://www.walmart.com/ip/76543212','Clear Dish Soap, 30 oz',{
        size:'30 oz',attributes:[{name:'Scent',value:'Unknown'}],
      }),
      make('Target','https://www.target.com/p/-/A-76543213','Dish Soap Dispenser'),
      make('Target','https://www.target.com/p/-/A-76543214','Clear Automatic Dishwasher Detergent'),
      make('Target','https://www.target.com/p/-/A-76543215','Clear Hand Soap'),
      make('Target','https://www.target.com/p/-/A-76543216','Trail Water Bottle, 16 oz',{
        size:'16 oz',attributes:[{name:'Material',value:'Stainless steel'}],
      }),
      make('Walmart','https://www.walmart.com/ip/76543217','Trail Water Bottle, 24 oz',{
        size:'24 oz',attributes:[{name:'Material',value:'Glass'}],
      }),
      make('Target','https://www.target.com/p/-/A-76543218','Acme 55-inch 4K Smart TV',{brand:'Acme'}),
      make('Walmart','https://www.walmart.com/ip/76543219','Acme 65-inch 4K Smart Television',{brand:'Acme'}),
      make('Walmart','https://www.walmart.com/ip/76543220','Acme TV Wall Mount'),
    ]
    await page.route('**/api/listing/search',route=>{
      const {retailer,mode,query}=route.request().postDataJSON()
      searches.push({retailer,mode,query})
      const category=/dish|hand soap/i.test(query)?'soap':/water bottle/i.test(query)?'bottle':/\btv\b/i.test(query)?'tv':'none'
      const pattern={soap:/soap|detergent|dishwashing/i,bottle:/water bottle/i,tv:/\b(?:tv|television)\b/i,none:/$a/}[category]
      const offers=mode==='serp'?data.filter(draft=>draft.retailer===retailer && pattern.test(draft.title)).map(draft=>({
        retailer,url:draft.url,title:draft.title,lead:true,price:'',seller:'',brand:'',available:null,
      })):[]
      return route.fulfill({json:{results:{[retailer]:{offers}}}})
    })
    await page.route('**/api/listing',route=>{
      const draft=data.find(entry=>entry.url===route.request().postDataJSON().url)
      checks.push(draft.url)
      return route.fulfill({json:{...draft,seller:draft.retailer,price:'6.49',available:true,pack:1,shippingAvailable:true}})
    })
    await page.goto(base)
    const search = async (query,category) => {
      await page.getByRole('textbox',{name:'Item 1',exact:true}).fill(query)
      await page.getByRole('button',{name:'Find listings',exact:true}).click()
      const region = page.getByRole('region',{name:'Listings for '+category,exact:true})
      await region.getByRole('button',{name:'Skip and search'}).click()
      await region.locator('.verification-loading').waitFor({state:'hidden'})
      return region
    }
    async function everyOption(region) {
      const options = await region.locator('.filter-option').allTextContents()
      assert.ok(options.length>1)
      const requests = [searches.length,checks.length]
      for (const option of options) {
        const button = region.getByRole('button',{name:option,exact:true}).first()
        await button.click()
        const count = Number(option.match(/\((\d+)\)$/)[1])
        assert.equal(await region.locator('.product-card').count(),count)
        await region.getByRole('button',{name:'Show all matches',exact:true}).click()
      }
      assert.deepEqual([searches.length,checks.length],requests)
    }

    const soap = await search('Hand Dish Soap','dish soap')
    await soap.getByRole('button',{name:'Unscented (1)',exact:true}).waitFor()
    assert.equal(await soap.locator('.product-card').count(),3)
    assert.ok(searches.every(request=>request.query==='dish soap'))
    for (const entry of data.slice(3,6)) assert.ok(!checks.includes(entry.url))
    assert.equal(await soap.getByRole('button',{name:/Unknown/}).count(),0)
    await everyOption(soap)
    await soap.getByRole('button',{name:'Unscented (1)',exact:true}).click()
    assert.equal(await soap.getByRole('button',{name:/30 oz/}).count(),0)
    assert.equal(await soap.locator('.product-card').count(),1)
    await soap.getByRole('button',{name:'Show all matches'}).click()
    assert.equal(await soap.locator('.product-card').count(),3)

    await search('Unscented Hand Dish Soap','dish soap')
    await soap.getByText('Required',{exact:true}).waitFor()
    await soap.locator('.search-requirements').getByText(/unscented/i).waitFor()
    assert.equal(await soap.locator('.product-card').count(),1)
    assert.equal(await soap.locator('.filter-option').count(),0)
    assert.ok(searches.some(request=>/Unscented dish soap/i.test(request.query)))

    const empty = await search('Unscented 99 oz Hand Dish Soap','dish soap')
    await empty.getByRole('button',{name:'Relax 99 oz',exact:true}).waitFor()
    await empty.getByRole('link',{name:'Search Target'}).waitFor()
    assert.equal(await empty.locator('.filter-option').count(),0)
    await empty.getByRole('button',{name:'Relax 99 oz',exact:true}).click()
    await empty.locator('.product-card').getByText(/Dishwashing Liquid/).waitFor()
    assert.match(await empty.locator('.search-requirements').innerText(),/unscented/i)

    await page.reload()
    const bottles = await search('water bottle','water bottle')
    await bottles.getByRole('button',{name:'Stainless steel (1)',exact:true}).waitFor()
    await everyOption(bottles)
    const televisions = await search('Television','tv')
    await televisions.getByRole('button',{name:'55 inch (1)',exact:true}).waitFor()
    await everyOption(televisions)
    await page.unroute('**/api/status')
    await page.route('**/api/status',route=>route.fulfill({json:{gemini:true}}))
    let extraction
    await page.route('**/api/requirements',route=>{
      extraction=route.request().postDataJSON()
      return route.fulfill({json:{intent:'shopping',items:[{product:'tv',quantity:1,exact:'',must:['4K'],brand:'',size:'',
        flexible:[],multi:false,preferences:[],priceCap:null}],budget:null,questions:[{prompt:'What size screen?',choices:['55 inch','65 inch']}]}})
    })
    await page.reload()
    await page.getByRole('textbox',{name:'What are you shopping for?'}).fill('4K Television')
    await page.getByRole('button',{name:'Find products for me'}).click()
    await televisions.getByRole('button',{name:'Skip and search'}).click()
    await televisions.getByRole('button',{name:'55 inch (1)',exact:true}).click()
    assert.deepEqual(extraction,{text:'4K Television',history:[],extractOnly:true})
    assert.ok(searches.some(request=>request.query==='4K tv'))
    assert.equal(await page.getByText('What size screen?',{exact:true}).count(),0)
    assert.equal(await televisions.locator('.product-card').count(),1)
    await televisions.getByRole('button',{name:'Show all matches'}).click()
    assert.match(await televisions.locator('.search-requirements').innerText(),/4K/)
    assert.equal(await televisions.locator('.product-card').count(),2)
    assert.ok(!checks.includes(data.at(-1).url))
    await assertNoOverflow(page)
    await page.close()
    console.log(width+'px: dish soap, water bottle and TV filters, per-choice counts, typed must-haves and zero-offer recovery passed')
  }
  await productFeatures(390)
  await productFeatures(1440)

  const needs = await storefront(1440)
  await needs.unroute('**/api/status')
  await needs.route('**/api/status',route=>route.fulfill({json:{gemini:true}}))
  await needs.route('**/api/requirements',route=>route.fulfill({json:{items:[{product:42}]}}))
  const offers = [
    make('Walmart',walmart,'Trail Water Bottle 16 oz',{seller:'Marketplace Shop',size:'16 oz',available:true,pack:1,price:'10.00'}),
    make('Walmart','https://www.walmart.com/ip/12345678','Trail Insulated Water Bottle 24 oz',{seller:'Marketplace Shop',size:'24 oz',available:true,pack:1,price:'13.00'}),
  ]
  const calls = []
  await needs.route('**/api/listing/search',route=>{
    const {retailer,mode,query,catalog}=route.request().postDataJSON()
    calls.push({retailer,mode,query,catalog})
    const result = retailer==='Walmart'&&mode==='serp'?{offers}:retailer==='Target'&&mode==='keyword'?{pending:true}:{offers:[]}
    return route.fulfill({json:{results:{[retailer]:result}}})
  })
  await needs.goto(base)
  await needs.getByRole('textbox',{name:'What are you shopping for?'}).fill('water bottle')
  await needs.getByRole('button',{name:'Find products for me'}).click()
  const needsRegion=needs.getByRole('region',{name:'Listings for water bottle',exact:true})
  const form=needsRegion.locator('.needs-editor')
  await form.getByRole('button',{name:'16 oz',exact:true}).click()
  await form.getByRole('group',{name:'What’s your maximum price per item?'}).getByRole('button',{name:'Type my own'}).click()
  await form.getByRole('textbox',{name:'What’s your maximum price per item?'}).fill('$12')
  await form.getByRole('button',{name:'Apply answers',exact:true}).click()
  await needsRegion.locator('.verification-loading').waitFor()
  await needsRegion.getByRole('button',{name:'Add to cart',exact:true}).click()
  assert.equal(await needsRegion.locator('.product-card').count(),1)
  assert.equal(await needs.locator('.selection-cart dl dd').first().innerText(),'$10.00')
  await needs.locator('.selection-cart').getByText('Confirm shipping at retailer',{exact:true}).waitFor()
  await needs.locator('.selection-total dd').getByText('Unconfirmed',{exact:true}).waitFor()
  assert.equal(await needs.locator('#compare [name=budget]').inputValue(),'')
  assert.equal(await needs.locator('#compare [name=priceCap]').inputValue(),'12')
  assert.equal(calls.filter(call=>call.retailer==='Walmart'&&call.mode==='serp').length,1)
  assert.ok(calls.filter(call=>call.retailer==='Target').every(call=>call.query==='water bottle 16 oz'))
  await needs.close()

  const exactNeeds = await storefront(390)
  await exactNeeds.route('**/api/listing/search',route=>route.fulfill({json:{results:{
    [route.request().postDataJSON().retailer]:{offers:[]},
  }}}))
  await exactNeeds.goto(base)
  await exactNeeds.getByRole('textbox',{name:'Item 1',exact:true}).fill('24 oz water bottle')
  await exactNeeds.getByRole('button',{name:'Find listings',exact:true}).click()
  await exactNeeds.getByRole('group',{name:'Does it need to be insulated?'}).waitFor()
  assert.equal(await exactNeeds.getByRole('group',{name:'What capacity do you need?'}).count(),0)
  await exactNeeds.getByRole('textbox',{name:'Item 1',exact:true}).fill('Television')
  await exactNeeds.locator('.requirements summary').click()
  await exactNeeds.getByLabel('Exact listing title').fill('Samsung QN55Q60D 55-inch Smart TV')
  await exactNeeds.getByRole('button',{name:'Find listings',exact:true}).click()
  await exactNeeds.getByText('No matching products found',{exact:true}).waitFor()
  assert.equal(await exactNeeds.locator('.needs-editor').count(),0)
  await exactNeeds.close()
  console.log('Both needs entry points, partial and exact needs, Gemini failure, and cart with another retailer pending passed')

  for (const entry of ['main','manual']) {
    for (const mode of ['apply','skip','exact','partial']) {
      const page = await storefront(entry==='main'?1440:390,{shopSavvy:true})
      await page.unroute('**/api/status')
      await page.route('**/api/status',route=>route.fulfill({json:{gemini:true}}))
      const calls = []
      const exact = mode==='exact'
      const partial = mode==='partial'
      const input = exact?'Acme Shield XN550 deodorant':partial?'Fragrance-free deodorant under $12':'deodorant'
      await page.route('**/api/requirements',route=>route.fulfill({json:{items:[{
        product:'deodorant',quantity:1,exact:exact?'Acme Shield XN550':'',brand:'',size:'',flexible:[],multi:false,preferences:[],
        must:partial?['Fragrance-free']:[],priceCap:partial?12:null,
      }],budget:null}}))
      await page.route('**/api/listing{,/**}',async route=>{
        const path=new URL(route.request().url()).pathname
        if (path==='/api/listing/status') return route.fallback()
        const data=route.request().postDataJSON()
        calls.push({path,data})
        await sleep(400)
        if(path==='/api/listing/shopsavvy') return route.fulfill({json:{offers:[]}})
        assert.equal(path,'/api/listing/search')
        const {retailer}=data
        const url=retailer==='Target'?target:walmart
        const offers = [make(retailer,url,'Acme Shield XN550 Fragrance-free deodorant',{
          seller:retailer,price:'5.49',available:true,pack:1,shippingAvailable:true,
        })]
        if (!exact) offers.push({...offers[0],url:url+'1',title:offers[0].title+' Stick',price:'6.49'})
        return route.fulfill({json:{results:{[retailer]:{offers}}}})
      })
      await page.goto(base)
      await page.locator('#compare [name=budget]').fill('37')
      await page.getByRole('textbox',{name:entry==='main'?'What are you shopping for?':'Item 1',exact:true}).fill(input)
      await page.getByRole('button',{name:entry==='main'?'Find products for me':'Find listings'}).click()
      const form=page.locator('.needs-editor')
      if (!exact) {
        await form.waitFor()
        await sleep(450)
        assert.equal(calls.length,0)
        assert.equal(await form.locator('input').count(),0)
        if (partial) {
          assert.equal(await form.getByRole('group',{name:'Does it need to be fragrance-free?'}).count(),0)
          assert.equal(await form.getByRole('group',{name:'What’s your maximum price per item?'}).count(),0)
        }
        const goal=form.getByRole('group',{name:'What do you need most from your deodorant?'})
        for (const choice of ['Odor control','Sensitive skin','No preference','Sweat control']) await goal.getByRole('button',{name:choice,exact:true}).click()
        if (!partial) {
          const price=form.getByRole('group',{name:'What’s your maximum price per item?'})
          await form.getByRole('button',{name:'Fragrance-free',exact:true}).click()
          await price.getByRole('button',{name:'$10',exact:true}).click()
          await price.getByRole('button',{name:'Type my own',exact:true}).click()
          const amount=price.getByRole('textbox')
          await amount.fill('8.50')
          await price.getByRole('button',{name:'$15',exact:true}).click()
          assert.equal(await price.getByRole('textbox').count(),0)
          await price.getByRole('button',{name:'Type my own',exact:true}).click()
          assert.equal(await price.getByRole('textbox').inputValue(),'8.50')
        }
        await sleep(450)
        assert.equal(calls.length,0)
        await form.getByRole('button',{name:mode==='apply'?'Apply answers':'Skip and search',exact:true}).click()
      }
      const query = mode==='apply'?'deodorant Fragrance-free Sweat control':input
      await page.locator('.product-card').first().waitFor()
      await page.locator('.verification-loading').waitFor({state:'hidden'})
      assert.equal(await form.count(),0)
      const initial=calls.filter(call=>call.path==='/api/listing/search')
      assert.deepEqual(initial.map(({data})=>data).sort((a,b)=>a.retailer.localeCompare(b.retailer)),[
        {query,retailer:'Target',mode:'serp'},{query,retailer:'Walmart',mode:'serp'},
      ])
      const line=calls.find(call=>call.path==='/api/listing/shopsavvy').data.line
      assert.deepEqual(line.must,mode==='apply'||partial?['Fragrance-free']:[])
      assert.deepEqual(line.preferences,mode==='apply'?['Sweat control']:[])
      assert.equal(line.priceCap??null,mode==='apply'?8.5:partial?12:null)
      assert.deepEqual(calls.map(call=>call.path).sort(),['/api/listing/search','/api/listing/search','/api/listing/shopsavvy'])
      assert.equal(await page.locator('#compare [name=budget]').inputValue(),'37')
      await page.locator('.product-card').first().getByRole('button',{name:'Add to cart',exact:true}).click()
      await page.locator('.selection-cart').getByText('0 required items remaining').waitFor()
      console.log(entry+' '+mode+': '+(exact?'immediate':'0 opening / 0 editing')+' → '+calls.length+' requests, query '+JSON.stringify(query))
      await page.close()
    }
  }

  for (const entry of ['main','manual']) {
    for (const [input,prompts,choice,expected] of [
      ['face moisturizer',['What is your skin type?','What texture do you prefer?','Does it need to be fragrance-free?'],'Lightweight gel','face moisturizer Lightweight gel'],
      ['fragrance-free face moisturizer',['What is your skin type?','What texture do you prefer?'],'Dry skin','fragrance-free face moisturizer Dry skin'],
      ['face wash',['What is your skin type?','What cleanser format do you want?','Does it need to be fragrance-free?'],'Foam','face wash Foam'],
      ['deodorant',['What do you need most from your deodorant?','Does it need to be fragrance-free?','What’s your maximum price per item?'],'Odor control','deodorant Odor control'],
      ['tennis racquet',['Who will use the racquet?','What is the player’s level?','What do you want from the racquet?'],'Junior','tennis racquet Junior'],
      ['dobsonian collimator',['Is there a requirement that would change which dobsonian collimator you choose?'],null,'dobsonian collimator'],
    ]) {
      const page=await storefront(entry==='main'?1440:390,{targetOptional:true})
      if(choice && entry==='main') {
        await page.unroute('**/api/status')
        await page.route('**/api/status',route=>route.fulfill({json:{gemini:true}}))
        await page.route('**/api/requirements',route=>route.fulfill({json:{items:[{
          product:input.replace(/^fragrance-free /,''),quantity:1,exact:'',brand:'',size:'',flexible:[],multi:false,preferences:[],
          must:input.startsWith('fragrance-free')?['fragrance-free']:[],priceCap:null,
        }],budget:null}}))
      }
      const retailerCalls=[]
      await page.route('**/api/listing{,/**}',route=>{
        const path=new URL(route.request().url()).pathname
        if(path==='/api/listing/status') return route.fallback()
        const request=route.request().postDataJSON()
        retailerCalls.push({path,request})
        return route.fulfill({json:{results:{[request.retailer]:{offers:[]}}}})
      })
      await page.goto(base)
      await page.getByRole('textbox',{name:entry==='main'?'What are you shopping for?':'Item 1',exact:true}).fill(input)
      await page.getByRole('button',{name:entry==='main'?'Find products for me':'Find listings'}).click()
      const form=page.locator('.needs-editor')
      await form.waitFor()
      assert.deepEqual(await form.locator('legend').allTextContents(),prompts)
      assert.equal(await form.getByRole('button',{name:/Everyday use|Compact size|Durability/}).count(),0)
      assert.equal(await form.locator('input').count(),0)
      if(choice) await form.getByRole('button',{name:choice,exact:true}).click()
      else {
        await form.getByRole('button',{name:'Type my own',exact:true}).click()
        await form.getByRole('textbox').fill('A center mark is important')
      }
      assert.equal(retailerCalls.length,0)
      const submitted=page.waitForRequest(r=>r.url().endsWith('/api/listing/search'))
      await form.getByRole('button',{name:choice?'Apply answers':'Skip and search'}).click()
      assert.deepEqual((await submitted).postDataJSON(),{retailer:'Walmart',query:expected,mode:'serp'})
      await page.close()
    }
  }
  console.log('Both entry points asked category-specific questions for all six requests with zero pre-submit retailer calls')

  const historical = await storefront(1440,{targetOptional:true,shopSavvy:true})
  const seen = new Date(Date.now()-6*86400000).toISOString()
  const historyDraft = {...make('Amazon','https://www.amazon.com/dp/B00QY1XZ4W','Example Trail Water Bottle 24 oz',{
    price:'9.47',pack:1,available:true,size:'24 oz',
  }),provider:'ShopSavvy',exactListing:true,lastSeen:seen,stale:true}
  const retailerCalls=[]
  await historical.route('**/api/listing/shopsavvy',route=>route.fulfill({json:{offers:[
    historyDraft,{...historyDraft,url:'https://www.amazon.com/dp/B00QY1XZ4X',lastSeen:'2020-01-01T00:00:00Z'},
    {...historyDraft,url:'https://www.amazon.com/dp/B00QY1XZ4Y',exactListing:false},
    {...historyDraft,url:'https://www.amazon.com/dp/B00QY1XZ4Z',pack:null},
  ]}}))
  await historical.route('**/api/listing/search',async route=>{
    const input=route.request().postDataJSON()
    retailerCalls.push(input.retailer)
    return route.fulfill({json:{results:{[input.retailer]:{offers:input.retailer==='Walmart'?[
      make('Walmart',walmart,'Verified Trail Water Bottle 16 oz',{price:'15.00',pack:1,available:true,seller:'Walmart',size:'16 oz'}),
      make('Walmart',walmart+'1','Verified Trail Water Bottle 20 oz',{price:'17.00',pack:1,available:true,seller:'Walmart',size:'20 oz'}),
    ]:[],...(input.retailer==='Target'?{pending:true}:{})}}}})
  })
  await historical.goto(base)
  await historical.locator('#compare [name=budget]').fill('20')
  const estimateRegion=await find(historical,'water bottle')
  const estimate=estimateRegion.locator('.historical-card')
  await estimate.getByText('Stock and shipping unconfirmed',{exact:false}).waitFor()
  assert.equal(await estimate.count(),1)
  assert.deepEqual(retailerCalls,['Walmart'])
  await estimateRegion.getByRole('button',{name:'Check Target live'}).click()
  await estimateRegion.getByText('Checking current prices and stock',{exact:true}).waitFor()
  assert.equal(await estimateRegion.locator('.product-card:not(.historical-card)').count(),2)
  await estimate.getByRole('button',{name:'Add to estimated cart'}).click()
  const summary=historical.locator('.selection-cart')
  await summary.getByText('Estimated item subtotal',{exact:true}).waitFor()
  assert.match(await summary.innerText(),/Current selected subtotal\s*\$0.00\s*Estimated item subtotal\s*\$9.47/)
  await summary.getByText('Unconfirmed',{exact:true}).waitFor()
  await summary.getByText(/Item-only budget estimate/).waitFor()
  await historical.close()
  console.log('Amazon historical price is selectable only as an estimate; expired, unmatched, and unknown packs are excluded; Target is optional')

  const marketplacePage = await storefront(390,{targetOptional:true,shopSavvy:true})
  await marketplacePage.clock.install()
  const amazonUrl = 'https://www.amazon.com/dp/B00QY1XZ4W'
  const sameWalmart = 'https://www.walmart.com/ip/34561234'
  const historicalDate = new Date(Date.now()-6*86400000).toISOString()
  const quote = {...make('Amazon',amazonUrl,'Example Gentle Body Wash 18 oz',{
    price:'9.47',pack:1,size:'18 oz',seller:'Independent Store',available:true,
  }),provider:'ShopSavvy',exactListing:true,lastSeen:historicalDate,stale:true}
  const releaseVerification = Promise.withResolvers()
  const searchInputs = []
  await marketplacePage.route('**/api/listing/shopsavvy',route=>route.fulfill({json:{offers:[
    quote,{...quote,retailer:'Walmart',url:sameWalmart,title:'Other Gentle Body Wash 18 oz',price:'10.50'},
    {...quote,url:amazonUrl.slice(0,-1)+'X',lastSeen:'2020-01-01T00:00:00Z'},
    {...quote,url:amazonUrl.slice(0,-1)+'Y',title:'Daily Gentle Body Wash 18 oz',pack:null,seller:''},
    {...quote,url:amazonUrl.slice(0,-1)+'Z',title:'Automatic Dishwasher Detergent'},
    {...quote,url:amazonUrl.slice(0,-1)+'1',title:'Soothing Body Wash 18 oz',available:false},
  ]}}))
  await marketplacePage.route('**/api/listing/search',route=>{
    const input = route.request().postDataJSON()
    searchInputs.push(input)
    return route.fulfill({json:{results:{Walmart:input.mode==='serp'?{error:'CAPTCHA'}:{pending:true}}}})
  })
  await marketplacePage.route('**/api/listing',async route=>{
    await releaseVerification.promise
    return route.fulfill({json:make('Walmart',sameWalmart,'Other Gentle Body Wash 18 oz',{checkedAt:new Date().toISOString(),size:'18 oz'})})
  })
  await marketplacePage.goto(base)
  const marketRegion=await find(marketplacePage,'Body Wash')
  await marketRegion.getByText(/Amazon 1 price estimate · 2 possible matches/).waitFor()
  assert.equal(await marketRegion.locator('.historical-card').count(),2)
  assert.equal(await marketRegion.locator('.unverified-links li').count(),2)
  const incomplete=marketplacePage.waitForResponse(r=>r.url().endsWith('/api/listing') && r.status()===200)
  releaseVerification.resolve()
  await incomplete
  await marketRegion.getByText('$10.50',{exact:true}).waitFor()
  await marketRegion.locator('.historical-card').filter({hasText:'Amazon'}).getByRole('button',{name:'Add to estimated cart'}).click()
  await marketplacePage.locator('.selection-cart').getByText('Estimated item subtotal',{exact:true}).waitFor()
  assert.equal(await marketplacePage.getByText(/ShopSavvy/i).count(),0)
  await marketplacePage.clock.fastForward(46000)
  const resume = marketplacePage.waitForRequest(r=>r.url().endsWith('/api/listing/search') &&
    r.postDataJSON().catalog==='resume')
  await marketRegion.getByRole('button',{name:'Check existing results',exact:true}).click()
  await resume
  assert.equal(searchInputs.filter(input=>input.mode==='keyword' && !input.catalog).length,1)
  assert.equal(await marketRegion.locator('.historical-card').count(),2)
  await marketplacePage.close()

  const noMatches=await storefront(390,{targetOptional:true,shopSavvy:true})
  await noMatches.route('**/api/listing/search',route=>route.fulfill({json:{results:{Walmart:{offers:[]}}}}))
  await noMatches.route('**/api/listing/shopsavvy',route=>route.fulfill({json:{offers:[
    {...quote,title:'Dishwasher tablets'}, {...quote,url:amazonUrl.slice(0,-1)+'X',pack:null,price:'30.00'},
  ]}}))
  await noMatches.goto(base)
  await noMatches.getByRole('textbox',{name:'Item 1',exact:true}).fill('Body Wash')
  await noMatches.locator('.requirements summary').click()
  await noMatches.getByLabel('Item price cap ($)',{exact:true}).fill('12')
  await noMatches.getByRole('button',{name:'Find listings',exact:true}).click()
  await noMatches.getByRole('button',{name:'Skip and search',exact:true}).click()
  await noMatches.getByText('No matching products found',{exact:true}).waitFor()
  assert.equal(await noMatches.locator('.product-card, .unverified-links').count(),0)
  assert.equal(await noMatches.getByText(/ShopSavvy/i).count(),0)
  await noMatches.close()
  console.log('Six marketplace candidates, late incomplete verification, cart estimate, completed empty state and status-only catalog resume passed')

  const catalog = await storefront(390,{serp:false})
  await catalog.clock.install()
  const submissions = []
  catalog.on('request',request=>{
    if (request.url().endsWith('/api/listing/search')) submissions.push(request.postDataJSON())
  })
  const initialReplies = ['Target','Walmart'].map(retailer=>catalog.waitForResponse(response=>{
    if (!response.url().endsWith('/api/listing/search')) return false
    const input = response.request().postDataJSON()
    return input.retailer===retailer && !input.catalog
  }))
  await catalog.goto(base)
  const coffeeRegion = await find(catalog,'instant coffee')
  for (const reply of await Promise.all(initialReplies)) {
    const store = reply.request().postDataJSON().retailer
    assert.equal((await reply.json()).results[store].pending,true)
  }
  const productCheck = await catalog.waitForResponse(response=>response.url().endsWith('/api/listing') && response.status()===200)
  assert.equal((await productCheck.json()).price,'5.49')
  assert.ok(submissions.some(request=>request.retailer==='Target' && request.catalog==='resume'))
  await catalog.clock.fastForward(46000)
  const coffeeCard = coffeeRegion.locator('.product-card').filter({hasText:'Example Classic Instant Coffee'})
  await coffeeCard.getByText('$5.49',{exact:true}).waitFor()
  await coffeeCard.getByRole('button',{name:'Add to cart',exact:true}).waitFor()
  assert.equal(await coffeeRegion.locator('.verification-loading').count(),0)
  const walmartStatus = coffeeRegion.locator('.retailer-status').filter({hasText:'Walmart'})
  const check = walmartStatus.getByRole('button',{name:'Check existing results',exact:true})
  await check.waitFor()
  const requested = catalog.waitForRequest(request=>request.url().endsWith('/api/listing/search') &&
    request.postDataJSON().retailer==='Walmart')
  await check.click()
  assert.equal((await requested).postDataJSON().catalog,'resume')
  assert.ok(await coffeeCard.isVisible())
  for (const store of ['Target','Walmart']) {
    assert.equal(output.split('\n').filter(line=>line==='FIXTURE_CATALOG '+store).length,1)
    assert.equal(submissions.filter(request=>request.retailer===store && !request.catalog).length,1)
  }
  await catalog.close()
  console.log('Instant-coffee catalogs each started once; automatic Target verification and Walmart deadline resume passed')

  const replacement = await storefront(1440)
  const release = Promise.withResolvers()
  await replacement.route('**/api/listing/search',route=>{
    const {retailer,mode,query}=route.request().postDataJSON()
    return route.fulfill({json:{results:{[retailer]:{offers:retailer==='Target'&&mode==='serp'&&query==='water bottle'?
      [make('Target',target,'Owala 16 fl oz Water Bottle',{lead:true})]:[]}}}})
  })
  await replacement.route('**/api/listing',async route=>{
    await release.promise
    await route.fulfill({json:make('Target',target,'Owala 16 fl oz Water Bottle',{seller:'Target',price:'24.99',available:true,pack:1})})
  })
  await replacement.goto(base)
  await find(replacement,'water bottle')
  await replacement.getByText('Checking current prices and stock',{exact:true}).waitFor()
  const newRegion=await find(replacement,'notebook')
  await newRegion.getByText('No matching products found',{exact:true}).waitFor()
  const finished = replacement.waitForResponse(response=>response.url().endsWith('/api/listing'))
  release.resolve()
  await finished
  assert.equal(await replacement.locator('.product-card').count(),0)
  assert.equal(await replacement.getByRole('region',{name:'Listings for water bottle'}).count(),0)
  console.log('Obsolete product response ignored after replacing the search')
  await replacement.close()
} finally {
  await browser?.close()
  if (child.exitCode===null) {
    child.kill()
    await once(child,'exit')
  }
}
