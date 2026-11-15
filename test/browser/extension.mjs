import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {chromium} from 'playwright'

const base='http://127.0.0.1:4180'
const path=resolve('extension')
const profile=await mkdtemp(resolve(tmpdir(),'one-less-tab-chrome-'))
const context=await chromium.launchPersistentContext(profile,{
  channel:'chromium',executablePath:process.env.DEMO_CHROME_EXECUTABLE,headless:false,args:['--disable-extensions-except='+path,'--load-extension='+path],
})
try{
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker')
 const identity=new URL(worker.url()).host
 const config=await worker.evaluate(async()=>await chrome.sidePanel.getOptions({}))
 assert.equal(config.path,'panel.html')
 const launcher=await context.newPage()
 const panelUrl='chrome-extension://'+identity+'/panel.html'
 await launcher.goto(panelUrl)
 // Trigger the Chrome window’s docked side panel with a test-only user gesture.
 await launcher.evaluate(()=>{
   const control=document.createElement('button')
   control.textContent='Open native panel'
   control.onclick=async()=>{
     const current=await chrome.windows.getCurrent()
     await chrome.sidePanel.open({windowId:current.id})
   }
   document.body.append(control)
 })
 const cdp=await context.newCDPSession(launcher)
 const before=new Set((await cdp.send('Target.getTargets')).targetInfos.map(target=>target.targetId))
 await launcher.getByRole('button',{name:'Open native panel'}).click()
 let docked
 for(let attempt=0;attempt<30&&!docked;attempt++){
   docked=(await cdp.send('Target.getTargets')).targetInfos.find(target=>target.url===panelUrl && !before.has(target.targetId))
   if(!docked) await new Promise(resolve=>setTimeout(resolve,100))
 }
 assert.ok(docked,'Chrome opened the native side panel')
 const attached=await cdp.send('Target.attachToTarget',{targetId:docked.targetId,flatten:false})
 const outside=[]
 const record=url=>{if((!url.startsWith(base)&&!url.startsWith('chrome-extension://'))||/\/api\/(listing|requirements)/.test(url))outside.push(url)}
 const commands=new Map()
 let next=0
 cdp.on('Target.receivedMessageFromTarget',event=>{
   if(event.sessionId!==attached.sessionId) return
   const message=JSON.parse(event.message)
   if(message.method==='Network.requestWillBeSent')record(message.params.request.url)
   commands.get(message.id)?.(message)
 })
 async function send(method,params={}) {
   const id=++next
   const reply=new Promise(resolve=>commands.set(id,resolve))
   await cdp.send('Target.sendMessageToTarget',{sessionId:attached.sessionId,message:JSON.stringify({
     id,method,params,
   })})
   const message=await reply
   commands.delete(id)
   assert.ok(!message.error && !message.result.exceptionDetails,JSON.stringify(message))
   return message.result
 }
 const evaluate=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true})).result.value
 await send('Network.enable')
 async function waitFor(expression) {
   for(let attempt=0;attempt<75;attempt++){
     if(await evaluate(expression))return
     await new Promise(resolve=>setTimeout(resolve,100))
   }
   assert.fail('Native side panel timed out: '+expression)
 }
 context.on('request',request=>record(request.url()))
 await waitFor("document.querySelector('#open-list button') !== null")
 assert.ok(await evaluate("document.body.innerText.includes('Demo · Sample prices and delivery')"))
 for(const id of ['body-wash-1','deodorant-1']){
  const demoOpened=context.waitForEvent('page')
  await evaluate("document.querySelector('#open-list button').click()")
  const website=await demoOpened
  await website.getByRole('textbox',{name:'What are you shopping for?'}).fill(id==='body-wash-1'?'Body wash':'Deodorant')
  await website.getByRole('button',{name:'Find products for me'}).click()
  await website.getByRole('button',{name:'Skip and search'}).click()
  await website.getByRole('button',{name:'92101',exact:true}).click()
  const card=website.locator('[data-offer="'+id+'"]')
  await card.getByText('Listing details').click()
  await card.getByRole('link',{name:'Open sample product'}).click()
  await website.locator('[data-sample-id="'+id+'"]').waitFor()
  await website.bringToFront()
  await evaluate("document.querySelector('#save').click()")
  await waitFor("document.querySelector('#status').innerText.startsWith('Saved ')")
  await evaluate("document.querySelector('#save').click()")
  await waitFor("document.querySelector('#status').innerText==='This sample is already saved.'")
 }
 assert.equal(await evaluate("document.querySelectorAll('#saved li').length"),2)
 await evaluate(`document.querySelector('[data-zip="92101"]').click();document.querySelector('#compare').requestSubmit()`)
 await waitFor("document.querySelectorAll('#matches article').length===8")
 const dates=await evaluate("[...document.querySelectorAll('#matches article p')].map(node=>node.innerText)")
 await evaluate(`document.querySelector('[data-zip="92037"]').click();document.querySelector('#compare').requestSubmit()`)
 await waitFor("document.querySelectorAll('#matches article').length===8")
 assert.notDeepEqual(await evaluate("[...document.querySelectorAll('#matches article p')].map(node=>node.innerText)"),dates)
 const names=[]
 for(let index=0;index<2;index++){
   const selector=`document.querySelectorAll('#matches section')[${index}].querySelector('article')`
   names.push((await evaluate(selector+".querySelector('strong').innerText")).split(' · ')[0])
   const newPage=context.waitForEvent('page')
   await evaluate(selector+".querySelector('button').click()")
   const website=await newPage
   await website.locator('.cart-row').getByText(new RegExp(names[index])).waitFor()
   assert.equal(await website.locator('.cart-row').filter({hasNotText:'No offer selected'}).count(),index+1)
 }
 const repeated=context.waitForEvent('page')
 await evaluate("document.querySelector('#matches article button').click()")
 const website=await repeated
 await website.locator('.cart-row').getByText(new RegExp(names[0])).waitFor()
 assert.equal(await website.locator('.cart-row').filter({hasNotText:'No offer selected'}).count(),2)
 assert.deepEqual(outside,[])
 console.log('Docked MV3 side panel in Chrome for Testing: captured two visible listings, rejected duplicate saves, compared both ZIPs, handed off and deduplicated website rows, zero external/provider calls')
} finally {
 await context.close()
 await rm(profile,{recursive:true,force:true})
}
