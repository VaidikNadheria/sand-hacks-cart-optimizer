import {catalog,demoZips,presets,sampleDate,sampleOffers} from './sample-catalog.mjs'

export function handleDemo(req,res) {
  const url = new URL(req.url,'http://127.0.0.1')
  if (url.pathname!=='/api/demo') return false
  const zip=url.searchParams.get('zip')
  const id=url.searchParams.get('id')
  const category=url.searchParams.get('category')
  const item=id?catalog.find(item=>item.id===id):null
  const valid = req.method==='GET' && (!zip||demoZips.includes(zip)) && (!id||item) &&
    (!category||presets.some(preset=>preset.id===category))
  res.writeHead(valid?200:400,{'Content-Type':'application/json','Cache-Control':'no-store'})
  res.end(JSON.stringify(!valid?{error:'Choose a valid sample and ZIP 92101 or 92037.'}:{
    presets,id,item,offers:zip ? sampleOffers(category??item?.category,zip).map(offer=>({...offer,arrival:sampleDate(offer.delivery[zip].days)})):[],
  }))
  return true
}
