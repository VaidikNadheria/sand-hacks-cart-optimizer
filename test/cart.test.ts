import {strict as assert} from 'node:assert'
import {test} from 'node:test'
import {demo,snapshot} from '../src/data.ts'
import {optimize,shipping,substitutions} from '../src/cart.ts'
import type {Offer} from '../src/cart.ts'
const wash = snapshot[2]
const small: Offer = {...wash,id:'small',size:'12 fl oz',cents:1219,source:'Sample'}
test('snapshot compares one store, an actual split, and item-first shipping', () => {
  const result = optimize(demo,snapshot)
  assert.equal(result.best?.total,4017)
  assert.equal(result.one?.total,4017)
  assert.equal(result.baseline?.total,5291)
  assert.equal(result.split?.total,5291)
  assert.equal(result.split?.orders.length,2)
})
test('shipping brackets at both stores', () => {
  assert.deepEqual([3499,3500,3501].map(x=>shipping('Target',x)),[599,0,0])
  assert.deepEqual([3499,3500,3501].map(x=>shipping('Walmart',x)),[699,0,0])
})
test('packs round up only when allowed and a quantity can split', () => {
  const pack: Offer = {...wash,pack:2,cents:800}
  const line = {...demo[1], quantity:3}
  assert.equal(optimize([line],[pack]).best,null)
  assert.equal(optimize([{...line,multi:true}],[pack]).best?.purchases[0].packs,2)
  assert.equal(optimize([line],snapshot).split?.purchases.reduce((sum,item)=>sum+item.requested,0),3)
})
test('wrong variants, missing stock, unknown terms, and invalid quantities cannot rank', () => {
  for (const bad of [{...wash,certain:false},{...wash,standard:false},{...wash,available:false},{...wash,brand:'Other'}]) {
    assert.equal(optimize([demo[1]],[bad]).best,null)
  }
  assert.equal(optimize([{...demo[1],quantity:1.5}],snapshot).best,null)
  assert.equal(optimize(demo,snapshot.filter(o=>o.id!=='tc')).best,null)
})
test('only the designated preference changes and shipping can erase the savings', () => {
  const best = optimize(demo,snapshot).best!
  assert.equal(substitutions(demo,[...snapshot,small],3700,best)[0].next.total,3617)
  const trial = substitutions(demo,[...snapshot,{...small,cents:1019}],3700,best)[0]
  assert.equal(trial.savings,1)
  assert.equal(trial.meets,false)
  assert.deepEqual(trial.changed,[demo[0],{...demo[1],size:'12 fl oz'},demo[2]])
  assert.equal(substitutions(demo,[...snapshot,{...small,tags:[]}],3700,best).length,0)
  assert.equal(substitutions(demo.map(l=>({...l,flexible:[]})),[...snapshot,small],3700,best).length,0)
})
test('an exact product stays locked even with flexibility marked', () => {
  const locked = [{...demo[1],exact:wash.title}]
  assert.equal(substitutions(locked,[wash,small],2000,optimize(locked,[wash]).best!).length,0)
})

test('the public-listing budget example crosses $37 after one approved size change', async () => {
  const {swapOffers} = await import('../src/swap.ts')
  const before = optimize(demo,swapOffers).best!
  assert.equal(before.total,4017)
  const best = substitutions(demo,swapOffers,3700,before)[0]
  assert.equal(best.value,'8 fl oz')
  assert.equal(best.savings,320)
  assert.equal(best.next.total,3697)
  assert.equal(best.meets,true)
  assert.equal(optimize(best.changed,swapOffers).best?.total,3697)
})

test('a line-linked offer survives a rename and cannot price another line with the same label', () => {
  const line = {...demo[1],product:'Face wash'}
  const linked = {...wash,lineId:line.id,source:'Manual' as const}
  assert.equal(optimize([line],[linked]).best?.total,2218)
  assert.equal(optimize([{...line,id:'other',product:wash.product}],[linked]).best,null)
  assert.equal(substitutions([line],[linked,{...small,lineId:line.id}],2000,optimize([line],[linked]).best!)[0].next.total,1818)
})

test('a cheaper item can bring a retailer below free shipping and raise the total', () => {
  const best = optimize(demo,snapshot).best!
  const trial = substitutions(demo,[...snapshot,{...small,cents:1099}],3700,best)[0]
  assert.equal(best.total,4017)
  assert.equal(trial.next.subtotal,3497)
  assert.equal(trial.next.orders[0].shipping,599)
  assert.equal(trial.next.total,4096)
  assert.equal(trial.savings,-79)
})

test('selected cart prices only compatible rows and estimates shipping when all rows are eligible',async()=>{
  const {selectedCart} = await import('../src/cart.ts')
  const calculator = snapshot.find(offer=>offer.id==='tc')!
  const cleanser = snapshot.find(offer=>offer.id==='Walmartwash')!
  const lotion = snapshot.find(offer=>offer.id==='Walmartlotion')!
  const chosen = new Map([[demo[0].id,calculator],[demo[1].id,cleanser]])
  assert.equal(selectedCart(demo,chosen).remaining,1)
  assert.equal(selectedCart(demo,chosen).subtotal,2996)
  assert.equal(selectedCart(demo,chosen).complete,null)
  chosen.set(demo[2].id,lotion)
  assert.equal(selectedCart(demo,chosen).complete?.total,5291)
  chosen.set(demo[2].id,{...lotion,standard:false})
  const unknown = selectedCart(demo,chosen)
  assert.equal(unknown.rows[2].issue,'Shipping fee unknown')
  assert.equal(unknown.complete,null)
  const changed = [{...demo[0],product:'Notebook'},demo[1],demo[2]]
  assert.equal(selectedCart(changed,chosen).rows[0].issue,'Item name changed')
})

test('selected-cart swaps hold other retailer selections fixed and respect row pack rules',async()=>{
  const {selectedCart} = await import('../src/cart.ts')
  const {swapOffers} = await import('../src/swap.ts')
  const chosen = new Map(demo.map(line=>[line.id,swapOffers.find(offer=>offer.retailer==='Target'&&offer.product===line.product)!]))
  const plan = selectedCart(demo,chosen).complete!
  const trial = substitutions(demo,swapOffers,3700,plan,chosen)[0]
  assert.equal(trial.next.total,3697)
  assert.equal(trial.next.purchases[0].offer.id,chosen.get(demo[0].id)?.id)
  assert.equal(trial.next.purchases[2].offer.id,chosen.get(demo[2].id)?.id)
  const large = {...demo[1],quantity:3,multi:true}
  const twoPack = {...chosen.get(demo[1].id)!,pack:2}
  const cart = selectedCart([large],new Map([[large.id,twoPack]]))
  assert.equal(cart.complete?.purchases[0].packs,2)
  assert.equal(selectedCart([{...large,multi:false}],new Map([[large.id,twoPack]])).rows[0].issue,'Multipack requires approval')
})

test('marketplace selections keep item subtotals and never borrow retailer shipping policies',async()=>{
  const {exclusion,selectionIssue,selectedCart,hasStandardShipping} = await import('../src/cart.ts')
  const line = demo[1]
  for (const retailer of ['Target','Walmart'] as const) {
    const original = snapshot.find(offer=>offer.product===line.product && offer.retailer===retailer)!
    const marketplace = {...original,seller:'Independent Shop',cents:4900,standard:true}
    assert.equal(selectionIssue(line,marketplace),'')
    assert.equal(hasStandardShipping(marketplace),false)
    assert.equal(exclusion(line,marketplace),'Shipping fee unknown')
    const cart = selectedCart([line],new Map([[line.id,marketplace]]))
    assert.equal(cart.subtotal,4900)
    assert.equal(cart.remaining,0)
    assert.equal(cart.complete,null)
    assert.equal(optimize([line],[marketplace]).best,null)
    assert.equal(hasStandardShipping(original),true)
    assert.equal(selectionIssue(line,{...original,standard:false}),'')
    assert.equal(exclusion(line,{...original,standard:false}),'Shipping fee unknown')
    assert.equal(selectionIssue(line,{...marketplace,seller:''}),'Seller unknown')
  }
})
