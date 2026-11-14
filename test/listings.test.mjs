import assert from 'node:assert/strict'
import {Readable} from 'node:stream'
import {test} from 'node:test'
import {handleListings,listingConfig} from '../listings.mjs'

async function request(config,url) {
  const req = Object.assign(Readable.from([JSON.stringify({url})]),{
    method:'POST',url:'/api/listing',headers:{'content-type':'application/json'},
  })
  let status, body
  const handled = await handleListings(req,{
    writeHead(code) { status = code },
    end(json) { body = JSON.parse(json) },
  },config)
  assert.equal(handled,true)
  return {status,body}
}

const config = listingConfig({BRIGHT_DATA_API_KEY:'test-placeholder'})

test('lookup validates and normalizes a retailer URL before fetching one listing',async context=>{
  const call = context.mock.method(globalThis,'fetch',async (url,init)=>{
    assert.equal(new URL(url).origin,'https://api.brightdata.com')
    assert.equal(new URL(url).searchParams.get('dataset_id'),config.ids.Walmart)
    assert.deepEqual(JSON.parse(init.body),{input:[{url:'https://www.walmart.com/ip/10818473'}]})
    return Response.json([{url:'https://www.walmart.com/ip/Daily-lotion/10818473',title:'Daily lotion',
      final_price:9.97,currency:'USD',seller_name:'Walmart.com',availability:'IN_STOCK'}])
  })
  const invalid = await request(config,'https://walmart.com.example.com/ip/10818473')
  assert.equal(invalid.status,400)
  const result = await request(config,'https://www.walmart.com/ip/Daily-lotion/10818473?ref=tracking')
  assert.equal(result.status,200)
  assert.equal(result.body.price,'9.97')
  assert.equal(result.body.seller,'Walmart')
  assert.equal(result.body.available,true)
  assert.ok(Number.isFinite(Date.parse(result.body.checkedAt)))
  assert.equal(call.mock.callCount(),1)
  assert.equal(Object.hasOwn(result.body,'standard'),false)
})

test('lookup preserves the manual fallback for disabled, pending, and mismatched results',async context=>{
  let provider = Response.json({snapshot_id:'sample'}, {status:202})
  const call = context.mock.method(globalThis,'fetch',async ()=>provider)
  const url = 'https://www.target.com/p/-/A-51148016'
  assert.equal((await request(config,url)).status,503)
  assert.equal(call.mock.callCount(),0)
  const target = listingConfig({BRIGHT_DATA_API_KEY:'test-placeholder',BRIGHT_DATA_TARGET_DATASET_ID:'gd_sample'})
  assert.equal((await request(target,url)).status,504)
  provider = Response.json([{url:'https://www.target.com/p/-/A-76198439',title:'Wrong variant'}])
  assert.equal((await request(target,url)).status,502)
  provider = Response.json([{url,title:'Cleanser',initial_price:16.19,currency:'USD'}])
  const partial = await request(target,url)
  assert.equal(partial.status,200)
  assert.equal(partial.body.price,'')
  assert.equal(partial.body.available,null)
})
