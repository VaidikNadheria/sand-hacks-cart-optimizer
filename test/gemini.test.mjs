import assert from 'node:assert/strict'
import {Readable} from 'node:stream'
import {test} from 'node:test'
import {geminiConfig,handleApi} from '../gemini.mjs'

async function send(path,payload) {
  const req = Object.assign(Readable.from([JSON.stringify(payload)]),{
    url:path,method:'POST',headers:{'content-type':'application/json'},
  })
  let status, body
  const handled = await handleApi(req,{
    writeHead(code) { status = code },
    end(json) { body = JSON.parse(json) },
  },geminiConfig({GEMINI_API_KEY:'test-placeholder'}))
  assert.equal(handled,true)
  return {status,body}
}

const modelReply = value => Response.json({candidates:[{content:{parts:[{text:JSON.stringify(value)}]}}]})

test('shopping guidance retains soft preferences and stops after two answers',async context=>{
  const draft = {items:[{product:'Body lotion',quantity:1,exact:'',must:['fragrance-free'],brand:'',size:'',
    flexible:[],multi:false,preferences:['dry skin']}],budget:20,followUp:'Is this for your face or body?'}
  context.mock.method(globalThis,'fetch',async ()=>modelReply(draft))
  const text = 'Help me find fragrance-free lotion for dry skin under $20.'
  const first = await send('/api/requirements',{text,history:[]})
  assert.equal(first.status,200)
  assert.deepEqual(first.body.items[0].preferences,['dry skin'])
  assert.equal(first.body.followUp,draft.followUp)
  const last = await send('/api/requirements',{text,history:[
    {question:'Is this for your face or body?',answer:'Body'},
    {question:'Any preferred texture?',answer:'Lightweight'},
  ]})
  assert.equal(last.body.followUp,null)
})

test('a recommendation needs a returned candidate and evidence from its listing',async context=>{
  const description = 'Fragrance-free lotion formulated for dry skin.'
  const payload = {needs:{product:'Body lotion',must:['fragrance-free']},candidates:[{title:'Body lotion',description,price:9.97}]}
  let selection = {index:0,reason:'It meets your fragrance preference.',evidence:'Fragrance-free lotion'}
  context.mock.method(globalThis,'fetch',async ()=>modelReply(selection))
  assert.deepEqual((await send('/api/recommendation',payload)).body,selection)
  selection = {...selection,evidence:'Dermatologist-approved'}
  assert.equal((await send('/api/recommendation',payload)).body.index,null)
  selection = {...selection,index:1,evidence:description}
  assert.equal((await send('/api/recommendation',payload)).body.index,null)
})

test('a category guidance batch keeps the per-item cap separate from cart budget',async context=>{
  let output = {items:[{product:'Body lotion',quantity:1,exact:'',must:['fragrance-free'],brand:'',size:'',
    flexible:[],multi:false,preferences:['for dry skin'],priceCap:15}],budget:null,questions:[
    {prompt:'What texture do you prefer?',choices:['Lightweight','Rich']},
    {prompt:'Any preferred ingredients?',choices:['Oatmeal','Ceramides']},
  ]}
  context.mock.method(globalThis,'fetch',async ()=>modelReply(output))
  const text = 'I need a fragrance-free body lotion for dry skin, under $15.'
  const first = await send('/api/requirements',{text,history:[]})
  assert.equal(first.status,200)
  assert.equal(first.body.budget,null)
  assert.equal(first.body.items[0].priceCap,15)
  assert.equal(first.body.questions.length,2)
  output = {...output,items:[{...output.items[0],preferences:['for dry skin','Lightweight']}]}
  const clarified = await send('/api/requirements',{text,history:[
    {question:output.questions[0].prompt,answer:'Lightweight'},
    {question:output.questions[1].prompt,answer:'No preference'},
  ]})
  assert.deepEqual(clarified.body.questions,[])
  assert.ok(clarified.body.items[0].preferences.includes('Lightweight'))
})

test('a bare category shows useful questions even when Gemini skips them',async context=>{
  const item = {product:'Body lotion',quantity:1,exact:'',must:[],brand:'',size:'',flexible:[],multi:false,preferences:[],priceCap:null}
  context.mock.method(globalThis,'fetch',async ()=>modelReply({items:[item],budget:null,questions:[]}))
  const text = 'body lotion'
  const first = await send('/api/requirements',{text,history:[]})
  assert.ok(first.body.questions.some(question=>question.choices.includes('Everyday moisturizing')))
  const manual = await send('/api/requirements',{text:`${text}. Requested quantity: 1. Single-unit packs only`,history:[]})
  assert.deepEqual(manual.body.questions,first.body.questions)
  const clarified = await send('/api/requirements',{text,history:[{question:first.body.questions[0].prompt,answer:'Everyday moisturizing'}]})
  assert.deepEqual(clarified.body.questions,[])
})

test('body wash guidance asks about purpose and does not infer a fragrance requirement',async context=>{
  const item = {product:'body wash',quantity:1,exact:'',must:['fragrance-free'],brand:'',size:'',flexible:[],multi:false,preferences:[],priceCap:null}
  context.mock.method(globalThis,'fetch',async ()=>modelReply({items:[item],budget:null,questions:[]}))
  const first = await send('/api/requirements',{text:'body wash',history:[]})
  assert.deepEqual(first.body.items[0].must,[])
  assert.ok(first.body.questions[0].choices.includes('Gentle everyday washing'))
  const question = first.body.questions[1].prompt
  const unrestricted = await send('/api/requirements',{text:'body wash',history:[{question,answer:'No preference'}]})
  assert.deepEqual(unrestricted.body.items[0].must,[])
  const selected = await send('/api/requirements',{text:'body wash',history:[{question,answer:'Must be fragrance-free'}]})
  assert.deepEqual(selected.body.items[0].must,['fragrance-free'])
})

test('shopping guidance distinguishes quota, truncation, and timeouts without exposing the provider body',async context=>{
  let reply = () => Response.json({error:{message:'private provider details'}},{status:429})
  context.mock.method(globalThis,'fetch',async (_url,init)=>{
    const {generationConfig} = JSON.parse(init.body)
    assert.equal(generationConfig.thinkingConfig.thinkingBudget,0)
    return reply()
  })
  const payload = {text:'USB-C cable',history:[]}
  const limited = await send('/api/requirements',payload)
  assert.equal(limited.status,429)
  assert.match(limited.body.error,/quota limit/)
  assert.doesNotMatch(limited.body.error,/private provider details/)
  reply = () => Response.json({candidates:[{finishReason:'MAX_TOKENS'}]})
  assert.match((await send('/api/requirements',payload)).body.error,/stopped before finishing/)
  reply = () => {throw new DOMException('timed out','TimeoutError')}
  assert.equal((await send('/api/requirements',payload)).status,504)
})

test('housing requests get a scope message and apartment products remain searchable',async context=>{
  const item = {product:'curtains',quantity:1,exact:'',must:[],brand:'',size:'',flexible:[],multi:false,preferences:[],priceCap:null}
  const fetch = context.mock.method(globalThis,'fetch',async (_url,init)=>{
    const request = JSON.parse(init.body)
    assert.ok(request.generationConfig.responseJsonSchema.properties.intent.enum.includes('housing'))
    const {list} = JSON.parse(request.contents[0].parts[0].text)
    if (list.startsWith('A place')) return modelReply({intent:'housing',items:[],budget:null,questions:[]})
    return modelReply({intent:list.startsWith('Find')?'mixed':'shopping',items:[item],budget:null,questions:[]})
  })
  const apartment = await send('/api/requirements',{text:'3 bedroom apartment',history:[]})
  assert.equal(apartment.status,200)
  assert.equal(apartment.body.intent,'housing')
  assert.deepEqual(apartment.body.items,[])
  assert.match(apartment.body.message,/apartment supplies/)
  assert.equal(fetch.mock.callCount(),0)
  const housing = await send('/api/requirements',{text:'A place to live near campus',history:[]})
  assert.equal(housing.body.intent,'housing')
  const supplies = await send('/api/requirements',{text:'Curtains for a 3-bedroom apartment',history:[]})
  assert.equal(supplies.body.items[0].product,'curtains')
  const mixed = await send('/api/requirements',{text:'Find an apartment and curtains',history:[]})
  assert.equal(mixed.body.intent,'mixed')
  assert.deepEqual(mixed.body.items.map(entry=>entry.product),['curtains'])
})

test('an initial clarification can arrive before Gemini drafts a product',async context=>{
  const questions = [{prompt:'What form do you prefer?',choices:['Canned drink','Powder mix']}]
  let value = {intent:'shopping',items:[],budget:null,questions}
  context.mock.method(globalThis,'fetch',async ()=>modelReply(value))
  const text = 'energy drink'
  assert.deepEqual(await send('/api/requirements',{text,history:[]}),{status:200,body:value})
  const history = [{question:questions[0].prompt,answer:'Canned drink'}]
  assert.equal((await send('/api/requirements',{text,history})).status,502)
  value = {...value,items:[{product:'energy drink',quantity:1,exact:'',must:[],brand:'',size:'',flexible:[],
    multi:false,preferences:['canned'],priceCap:null}],questions:[]}
  assert.deepEqual(await send('/api/requirements',{text,history}),{status:200,body:value})
})

test('bare face wash offers Sensitive skin and Foam before a product draft exists',async context=>{
  const draft = {intent:'shopping',items:[],budget:null,questions:[
    {prompt:'What is your skin type?',choices:['Oily','Sensitive']},
    {prompt:'What is your goal?',choices:['Hydrating','Exfoliating']},
  ]}
  context.mock.method(globalThis,'fetch',async ()=>modelReply(draft))
  const result = await send('/api/requirements',{text:'face wash',history:[]})
  assert.equal(result.status,200)
  assert.ok(result.body.questions[0].choices.includes('Sensitive skin'))
  assert.ok(result.body.questions[1].choices.includes('Foam'))
})

test('scooter clarification preserves commute distance as a lower bound and top speed separately',async context=>{
  const item = {product:'electric scooter',quantity:1,exact:'',must:['maximum advertised range: 10 miles'],brand:'',size:'',
    flexible:[],multi:false,preferences:[],priceCap:null}
  context.mock.method(globalThis,'fetch',async ()=>modelReply({intent:'shopping',items:[item],budget:null,questions:[]}))
  const first = await send('/api/requirements',{text:'e-scooter',history:[]})
  assert.equal(first.body.questions.length,3)
  const history = first.body.questions.map(({prompt},i)=>({question:prompt,answer:['Commuting','Speed 16–25 mph','Commute distance: 10 miles'][i]}))
  const second = await send('/api/requirements',{text:'e-scooter',history})
  assert.deepEqual(second.body.items[0].must,['Speed 16–25 mph','Commute distance: 10 miles'])
  assert.ok(second.body.items[0].preferences.includes('Commuting'))
})

test('storefront extraction returns typed requirements without a clarification step',async context=>{
  context.mock.method(globalThis,'fetch',async (_url,init)=>{
    const prompt = JSON.parse(init.body).systemInstruction.parts[0].text
    assert.match(prompt,/Return shopping items immediately/)
    assert.doesNotMatch(prompt,/always needs clarification/)
    return modelReply({intent:'shopping',items:[{product:'Hand Dish Soap',quantity:1,exact:'',must:['unscented'],
      brand:'Dawn',size:'18 oz',flexible:[],multi:false,preferences:[],priceCap:null}],budget:null,
      questions:[{prompt:'Do you want a lemon scent?',choices:['Yes','No']}]})
  })
  const result = await send('/api/requirements',{text:'Dawn unscented 18 oz hand dish soap',history:[],extractOnly:true})
  assert.equal(result.status,200)
  assert.deepEqual(result.body.questions,[])
  assert.deepEqual(result.body.items.map(({must,brand,size})=>({must,brand,size})),[{must:['unscented'],brand:'Dawn',size:'18 oz'}])
})
