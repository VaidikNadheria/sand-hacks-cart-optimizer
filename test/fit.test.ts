import {test} from 'node:test'
import assert from 'node:assert/strict'
import {listingFeatures,typedLine,needsKeywordSearch,rankListings,reviewFit,searchQuery} from '../src/fit.ts'
import {blank} from '../src/data.ts'
import type {ListingDraft} from '../src/fit.ts'

const lotion = {...blank('one'),product:'Body lotion',exact:'Aveeno Daily Moisturizing Body Lotion',brand:'Aveeno',
  size:'18 fl oz',must:['regular formula','fragrance-free'],preferences:['dry skin'],priceCap:15}
const draft:ListingDraft = {retailer:'Target',title:'Aveeno Daily Moisturizing Lotion For Dry Skin - Fragrance-Free - 18 fl oz',
  brand:'Aveeno',size:'18 fl oz',price:'9.99',pack:1,available:true,checkedAt:'',url:'https://www.target.com/p/-/A-10801059',seller:''}
test('named identity survives reordered wording while same-price alternatives and missing evidence do not qualify',()=>{
  assert.equal(searchQuery(lotion),'Aveeno Daily Moisturizing Body Lotion 18 fl oz regular formula fragrance-free dry skin')
  assert.equal(reviewFit(lotion,draft).eligible,true)
  assert.equal(reviewFit({...lotion,exact:'Daily Moisturizing Lotion by Aveeno'},draft).eligible,true)
  assert.equal(reviewFit(lotion,{...draft,title:draft.title+' Sheer Hydration'}).eligible,false)
  assert.equal(reviewFit(lotion,{...draft,title:draft.title.replace('Fragrance-Free','')}).eligible,false)
  assert.equal(reviewFit(lotion,{...draft,pack:null}).eligible,false)
  assert.equal(reviewFit(lotion,{...draft,price:'15.01'}).eligible,false)
})
test('an unrelated model can match reordered title words but not a different model',()=>{
  const line = {...blank('two'),product:'Calculator',exact:'TI-30XS MultiView',brand:'Texas Instruments'}
  const offer = {...draft,title:'Texas Instruments Multi View TI-30XS Scientific Calculator',brand:'Texas Instruments'}
  assert.equal(reviewFit(line,offer).eligible,true)
  assert.equal(reviewFit(line,{...offer,title:offer.title.replace('30XS','30XIIS')}).eligible,false)
})

test('category search prioritizes well-reviewed matches and still enforces the item cap',()=>{
  const line = {...blank('three'),product:'Body lotion',preferences:['dry skin','Lightweight'],priceCap:15}
  const niche = {...draft,reviewCount:7,rating:5,price:'8.99'}
  const popular = {...draft,reviewCount:1200,rating:4.5}
  const poorlyRated = {...draft,reviewCount:3000,rating:3}
  const overBudget = {...draft,reviewCount:9000,price:'15.01'}
  assert.equal(searchQuery(line),'Body lotion dry skin')
  assert.deepEqual(rankListings(line,[niche,overBudget,poorlyRated,popular]).map(entry=>entry.draft),[popular,niche,poorlyRated,overBudget])
})

test('review quality prioritizes comparable matches without overriding requirements or availability',()=>{
  const line = {...blank('reviewed'),product:'Body lotion',must:['fragrance-free'],preferences:['dry skin']}
  const established = {...draft,title:draft.title.replace('For Dry Skin',''),rating:4.4,reviewCount:50}
  const handful = {...draft,rating:4.9,reviewCount:30}
  const unrated = {...draft,rating:null,reviewCount:800}
  const unknownStock = {...draft,rating:4.9,reviewCount:1500,available:null}
  const wrong = {...draft,title:draft.title.replace('Fragrance-Free','Lavender'),rating:5,reviewCount:3000}
  const soldOut = {...established,available:false,rating:5,reviewCount:5000}
  const entries = rankListings(line,[handful,wrong,soldOut,unrated,unknownStock,established])
  assert.deepEqual(entries.slice(0,3).map(entry=>entry.draft),[established,handful,unrated])
  assert.ok(entries.slice(3).every(entry=>!entry.fit.eligible))
  assert.equal(rankListings(line,[{...handful,lead:true},{...established,lead:true}])[0].draft.rating,4.4)
})

test('beverage size and package format may be recorded in separate listing fields',()=>{
  const line = {...blank('drink'),product:'Sparkling water',size:'12 fl oz Can'}
  const single = {...draft,title:'Lemon sparkling water - 12 fl oz Can',size:'12 fl oz'}
  assert.equal(reviewFit(line,single).eligible,true)
  assert.deepEqual(reviewFit(line,{...single,title:'Sparkling Water 8pk/12 fl oz Cans',pack:8}).conflicts,['multipack'])
  assert.deepEqual(reviewFit(line,{...single,available:false}).conflicts,['out of stock'])
  assert.deepEqual(reviewFit(line,{...single,title:'Sparkling water - 12 fl oz Bottle'}).conflicts,['different size or package format'])
  assert.ok(reviewFit(line,{...single,title:'Sparkling water - 12 fl oz'}).missing.includes('size or package format'))
})

test('cable requirements use charging evidence and compare lengths across units',()=>{
  const line = {...blank('cable'),product:'USB-C cable',must:['for charging devices','under 3 ft']}
  const cable = {...draft,title:'USB-C Fast Charging Cable (0.5 m)',evidence:''}
  const boundary = {...cable,title:'USB-C Fast Charging Cable 3 ft (91.4 cm)'}
  const tooLong = {...cable,title:'USB-C Fast Charging Cable 1.2m'}
  const ambiguous = {...cable,title:'USB-C Fast Charging Cable 2 ft or 6 ft'}
  const dataOnly = {...cable,title:'USB-C Data Only Cable (2 ft)'}
  assert.equal(reviewFit(line,cable).eligible,true)
  assert.ok(reviewFit(line,boundary).conflicts.includes('does not meet under 3 ft'))
  assert.equal(reviewFit({...line,must:['for charging devices','3 ft or shorter']},boundary).eligible,true)
  assert.equal(reviewFit(line,tooLong).eligible,false)
  assert.ok(reviewFit(line,ambiguous).missing.includes('under 3 ft'))
  assert.ok(reviewFit(line,dataOnly).conflicts.includes('does not meet for charging devices'))
  assert.deepEqual(rankListings(line,[tooLong,{...cable,rating:4.5,reviewCount:7}]).map(entry=>entry.fit.eligible),[true,false])
})

test('everyday body wash search excludes unrequested treatments from the shortlist and fills sparse results',()=>{
  const line = {...blank('body-wash'),product:'Body wash',must:['fragrance-free'],preferences:['Gentle everyday washing']}
  const exfoliating = {...draft,title:'Fragrance-Free Glycolic Acid Exfoliating Body Wash',lead:true,reviewCount:5000}
  const showerGel = {...draft,title:'Gentle Shower Gel',snippet:'Fragrance-free everyday cleanser',evidence:'',lead:true}
  const wash = {...draft,title:'Fragrance-Free Daily Body Wash',lead:true}
  assert.equal(searchQuery(line),'Body wash fragrance-free')
  assert.equal(searchQuery({...line,preferences:['dry skin']},true),'Body wash fragrance-free')
  assert.equal(reviewFit(line,exfoliating).shortlist,false)
  assert.equal(reviewFit({...line,preferences:['Exfoliating']},exfoliating).shortlist,true)
  assert.equal(reviewFit(line,showerGel).shortlist,true)
  assert.equal(reviewFit(line,showerGel).eligible,false)
  assert.equal(reviewFit(line,{...showerGel,lead:false}).shortlist,false)
  assert.equal(needsKeywordSearch(line,[]),true)
  assert.equal(needsKeywordSearch(line,[exfoliating,showerGel]),true)
  assert.equal(needsKeywordSearch(line,[exfoliating,showerGel,wash]),false)
  assert.equal(needsKeywordSearch(lotion,[]),true)
  assert.equal(needsKeywordSearch(lotion,[{...draft,lead:true}]),false)
})

test('face wash matches facial cleanser aliases and checks foam and sensitive-skin evidence',()=>{
  const line = {...blank('face-wash'),product:'face wash',must:['for sensitive skin','foam']}
  const option = {...draft,title:'CeraVe Balancing Air Foam Facial Cleanser',evidence:'Suitable for sensitive skin.'}
  assert.equal(reviewFit(line,option).eligible,true)
  assert.equal(reviewFit(line,{...option,title:'Foaming Facial Cleanser',evidence:'Suitable for sensitive skin.'}).eligible,true)
  assert.ok(reviewFit(line,{...option,evidence:''}).missing.includes('for sensitive skin'))
  assert.ok(reviewFit(line,{...option,evidence:'Not recommended for sensitive skin.'}).conflicts.includes('does not meet for sensitive skin'))
  assert.ok(reviewFit(line,{...option,title:'Non-foaming facial cleanser'}).conflicts.includes('does not meet foam'))
  assert.equal(reviewFit(line,{...option,title:'Foaming body wash for sensitive skin'}).productMatch,false)
})

test('e-scooter aliases reach checks while accessories and wrong locked models do not',()=>{
  const line = {...blank('scooter'),product:'e-scooter',must:['Speed 16–25 mph','Commute distance: 10 miles']}
  const scooter = {...draft,title:'Segway E2 Pro Electric Scooter, 18 mph, 25 miles per charge',brand:'Segway'}
  assert.equal(reviewFit(line,{...scooter,lead:true}).relevant,true)
  assert.equal(reviewFit(line,scooter).eligible,true)
  assert.equal(reviewFit(line,{...scooter,title:'Charger for Segway E2 Pro Electric Scooter'}).relevant,false)
  assert.equal(reviewFit({...line,exact:'Segway E2 Plus'},scooter).relevant,false)
  assert.equal(reviewFit({...line,brand:'NIU'},scooter).relevant,false)
  assert.equal(reviewFit({...line,must:['Maximum advertised range: 20 miles']},scooter).relevant,false)
  assert.equal(reviewFit(line,{...scooter,title:'Electric Scooter, 18 mph, fitted for a 12 mile commute'}).missing.includes('Commute distance: 10 miles'),true)
  assert.equal(reviewFit(line,{...scooter,title:'Electric scooter, 28 mph, range 20 miles'}).conflicts.includes('does not meet Speed 16–25 mph'),true)
  assert.equal(reviewFit(line,{...scooter,title:'Electric scooter, 30 km/h, range 24 km'}).eligible,true)
  assert.equal(reviewFit(line,{...scooter,title:'Electric Scooter, speed 18 mph or 11 mph, range 20 miles'}).missing.includes('Speed 16–25 mph'),true)
  assert.equal(reviewFit(line,{...scooter,title:'Electric Scooter, 19 mph, 15–22 miles range'}).missing.includes('Commute distance: 10 miles'),true)
})

test('air fryer also matches the closed-up retailer category spelling',()=>{
  assert.equal(reviewFit({...blank('fryer'),product:'air fryer'},{...draft,title:'Compact AirFryer'}).productMatch,true)
})

test('couch skips sofa pads before verification while couch cover accepts sofa slipcovers',()=>{
  const couch = {...blank('couch'),product:'couch'}
  const pad = {...draft,title:'Non-Slip Sofa Pads for Hardwood Floors',lead:true}
  const cover = {...draft,title:'Stretch Sofa Slipcover, Gray',lead:true}
  const furniture = {...draft,title:'Dark Gray Sectional Sofa with Chaise',lead:true}
  for (const accessory of [pad,cover]) {
    const fit = reviewFit(couch,accessory)
    assert.equal(fit.productMatch,false)
    assert.equal(fit.relevant,false)
  }
  assert.equal(reviewFit(couch,furniture).relevant,true)
  assert.equal(reviewFit({...couch,product:'couch cover'},cover).relevant,true)
  assert.equal(reviewFit({...couch,product:'couch cover'},furniture).relevant,false)
})

test('Television uses the TV alias without accepting accessories or weakening locked requirements',()=>{
  const line = {...blank('tv'),product:'Television'}
  const tv = {...draft,title:'Samsung 55-inch 4K Smart TV QN55ABC, with remote',brand:'Samsung',price:'299.99'}
  assert.equal(searchQuery(line),'tv')
  assert.equal(reviewFit(line,tv).productMatch,true)
  assert.equal(reviewFit(line,{...tv,title:'Wall mount for Samsung 55-inch Smart TV'}).relevant,false)
  assert.equal(reviewFit(line,{...tv,title:'Replacement television remote for Samsung'}).relevant,false)
  for (const title of ['TV Games Deluxe Golden Tee','TV Nostalgia [VHS]','TV Basic Mounting, 55 inches or Smaller']) {
    assert.equal(reviewFit(line,{...tv,title}).relevant,false)
  }
  const locked = {...line,brand:'Samsung',size:'55 inches',exact:'Samsung Television QN55ABC',priceCap:300}
  assert.equal(reviewFit(locked,tv).eligible,true)
  assert.equal(reviewFit(locked,{...tv,title:tv.title.replace('55-inch','65-inch')}).relevant,false)
  assert.equal(reviewFit(locked,{...tv,title:tv.title.replace('QN55ABC','QN55XYZ')}).relevant,false)
  assert.equal(reviewFit({...locked,brand:'LG'},tv).relevant,false)
  assert.equal(reviewFit({...locked,priceCap:250},tv).relevant,false)
})

test('hand dish soap aliases respect typed scent, size and brand or model evidence',()=>{
  const row = typedLine({...blank('soap'),product:'Dawn Unscented 18 oz Hand Dish Soap'})
  assert.equal(row.product,'dish soap')
  assert.match(searchQuery(row),/Dawn Unscented 18 oz dish soap/i)
  const soap = {...draft,title:'Dawn Dishwashing Liquid, Fragrance-Free, 18 oz',brand:'Dawn',size:'18 oz',price:'4.49'}
  assert.equal(reviewFit(row,soap).eligible,true)
  for (const title of ['Dawn Hand Soap, Unscented, 18 oz','Dawn Automatic Dishwasher Detergent', 'Dawn Dish Soap Dispenser']) {
    assert.equal(reviewFit(row,{...soap,title}).productMatch,false)
  }
  assert.equal(reviewFit(row,{...soap,title:'Ajax Dishwashing Liquid, Fragrance-Free, 18 oz',brand:'Ajax'}).eligible,false)
  assert.equal(reviewFit(row,{...soap,title:'Dawn Dishwashing Liquid, Lemon Scent, 18 oz'}).eligible,false)
  assert.equal(reviewFit(row,{...soap,size:'30 oz'}).eligible,false)
})

test('feature labels come from known evidence and keep bottle capacity separate from pack',()=>{
  assert.deepEqual([...listingFeatures({...draft,title:'Owala water bottle 16 fl oz',brand:'Owala',size:'16 fl oz',pack:1,
    attributes:[{name:'Volume capacity',value:'16 oz'},{name:'Material',value:'Stainless steel'},{name:'Scent',value:'Not specified'}]})],
    [['Capacity','16 oz'],['Material','Stainless steel'],['Brand','Owala']])
  assert.equal(listingFeatures({...draft,title:'Samsung Smart Television',size:'',attributes:[{name:'Screen Size',value:'55'}]}).get('Screen size'),'55 inch')
  assert.equal(listingFeatures({...draft,title:'55-inch Smart TV',size:'',attributes:[{name:'Screen Size',value:'65 inches'}]}).has('Screen size'),false)
})

test('manual free text keeps a TV model lock and an explicit pack rule',()=>{
  const row = typedLine({...blank('tv'),product:'Samsung QN55Q60D 55-inch Smart TV'})
  assert.equal(row.exact,'Samsung QN55Q60D Smart')
  assert.equal(row.size,'55 inch')
  const tv = {...draft,title:'Samsung 55-inch 4K Smart TV QN55Q60D',brand:'Samsung',size:'55 inch',pack:1}
  assert.equal(reviewFit(row,tv).eligible,true)
  assert.equal(reviewFit(row,{...tv,title:tv.title.replace('QN55Q60D','QN55Q80D')}).eligible,false)
  const pack = typedLine({...blank('pack'),product:'Hand dish soap 3-pack'})
  assert.equal(pack.multi,true)
  assert.deepEqual(pack.must,['pack of 3'])
})

test('historical offer window excludes fresh, expired and invalid timestamps',async()=>{
  const {recentHistorical} = await import('../src/fit.ts')
  const now = Date.parse('2026-11-15T12:00:00Z')
  assert.equal(recentHistorical('2026-11-13T12:00:00Z',now),false)
  assert.equal(recentHistorical('2026-11-13T11:59:59Z',now),true)
  assert.equal(recentHistorical('2026-11-01T12:00:00Z',now),true)
  assert.equal(recentHistorical('2026-11-01T11:59:59Z',now),false)
  assert.equal(recentHistorical('invalid',now),false)
})
