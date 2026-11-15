import {test} from 'node:test'
import assert from 'node:assert/strict'
import {catalog,presets,sampleOffers,samplePlan,sampleDate} from '../sample-catalog.mjs'

test('all six presets have five distinct listings and four deliverable matches per ZIP',()=>{
  assert.equal(new Set(catalog.map(item=>item.id)).size,30)
  for(const preset of presets){
    assert.equal(preset.listings.length,5)
    assert.ok(new Set(preset.listings.map(item=>item.marketplace)).size>=2)
    const downtown=sampleOffers(preset.id,'92101')
    const laJolla=sampleOffers(preset.id,'92037')
    assert.equal(downtown.length,4)
    assert.equal(laJolla.length,4)
    assert.notDeepEqual(downtown.map(item=>item.id),laJolla.map(item=>item.id))
    assert.ok(downtown.filter(item=>laJolla.includes(item)).every(item=>item.delivery['92101'].days!==item.delivery['92037'].days))
  }
  assert.deepEqual(sampleOffers('bottle','12345'),[])
  assert.deepEqual(sampleOffers('bottle','92101',1000),[])
})
test('cart delivery groups charges and rejects unavailable items and wrong category handoffs',()=>{
  const rows=[{category:'body-wash',offer:'body-wash-1',quantity:1},{category:'dish-soap',offer:'dish-soap-1',quantity:1},{category:'bottle',offer:'bottle-1',quantity:1}]
  assert.equal(samplePlan(rows,'92101').total,4345)
  assert.equal(samplePlan(rows,'92037').total,0)
  assert.equal(samplePlan(rows,'92037').selections.length,3)
  assert.equal(samplePlan([{category:'bottle',offer:'dish-soap-2',quantity:1}],'92037').subtotal,0)
  assert.equal(sampleDate(1,new Date('2026-11-15T15:00:00Z')),'Mon, Nov 16')
})
