export const demoLabel = 'Demo · Sample prices and delivery'
export const demoZips = ['92101','92037']
export const presets = [
  {id:'body-wash',name:'Body wash',cap:1500,needs:['Sensitive skin','Fragrance-free'],products:[
    ['Vanicream Gentle Body Wash','Unscented','Target','12 fl oz',1199,'https://www.target.com/p/-/A-84697206'],
    ['Harbor Gentle Body Wash','Unscented cream','Walmart','16 fl oz',849],
    ['Cove Daily Body Wash','Unscented gel','Amazon','14 fl oz',999],
    ['Mesa Comfort Body Wash','Unscented lotion wash','Walmart','18 fl oz',1099],
    ['Dune Soft Body Wash','Unscented gel','Target','16 fl oz',1049],
  ]},
  {id:'face-wash',name:'Face wash',cap:1500,needs:['Gentle','Fragrance-free'],products:[
    ['Cove Gentle Face Wash','Unscented gel','Walmart','6 fl oz',799],['Mesa Daily Face Wash','Unscented cream','Target','8 fl oz',999],
    ['Dune Calm Face Wash','Unscented foam','Amazon','5 fl oz',899],['Harbor Gentle Face Wash','Unscented gel','Target','8 fl oz',1149],
    ['Grove Soft Face Wash','Unscented cream','Walmart','7 fl oz',949],
  ]},
  {id:'moisturizer',name:'Face moisturizer',cap:2000,needs:['Lightweight','Fragrance-free'],products:[
    ['Cove Cloud Face Moisturizer','Lightweight gel','Amazon','2 fl oz',1399],['Mesa Daily Face Moisturizer','Lightweight lotion','Target','3 fl oz',1499],
    ['Dune Light Face Moisturizer','Lightweight gel','Walmart','2 fl oz',1199],['Harbor Air Face Moisturizer','Lightweight cream','Target','2.5 fl oz',1599],
    ['Grove Fresh Face Moisturizer','Lightweight lotion','Walmart','2 fl oz',1299],
  ]},
  {id:'deodorant',name:'Deodorant',cap:1500,needs:['Sweat control','Fragrance-free'],products:[
    ['Vanicream Anti-perspirant / Deodorant','Unscented stick','Amazon','2.25 oz',1249,'https://www.amazon.com/dp/B01M7ZAQNN'],
    ['Mesa Daily Antiperspirant','Unscented stick','Walmart','2.6 oz',699],['Dune Dry Antiperspirant','Unscented solid','Target','2.7 oz',899],
    ['Grove Comfort Antiperspirant','Unscented gel','Walmart','2.4 oz',849],['Harbor Dry Antiperspirant','Unscented stick','Target','2.5 oz',949],
  ]},
  {id:'dish-soap',name:'Hand dish soap',cap:1200,needs:['Fragrance-free'],products:[
    ['Mesa Liquid Hand Dish Soap','Unscented','Walmart','18 fl oz',449],['Grove Clear Dish Soap','Unscented','Target','20 fl oz',549],
    ['Cove Gentle Dish Soap','Unscented refill','Amazon','24 fl oz',649],['Dune Daily Dish Soap','Unscented','Walmart','16 fl oz',499],
    ['Harbor Clear Dish Soap','Unscented refill','Target','24 fl oz',599],
  ]},
  {id:'bottle',name:'Water bottle',cap:3000,needs:['Insulated','Stainless steel','16–24 fl oz'],products:[
    ['Harbor Trail Water Bottle','Blue · flip lid','Walmart','16 fl oz',1799],['Mesa Loop Water Bottle','Green · carry loop','Target','20 fl oz',2099],
    ['Cove Summit Water Bottle','Silver · screw lid','Amazon','24 fl oz',2399],['Grove Day Water Bottle','Lilac · straw lid','Walmart','18 fl oz',1999],
    ['Dune Coast Water Bottle','Sand · flip lid','Target','22 fl oz',2299],
  ]},
].map(({products,...preset})=>({...preset,listings:products.map(([name,variant,marketplace,size,price,retailerUrl],index)=>({
  id:preset.id+'-'+(index+1),category:preset.id,name,variant,marketplace,size,price,pack:1,retailerUrl,
  evidence:preset.needs,delivery:Object.fromEntries(demoZips.map((zip,area)=>[
    zip,{available:index!==(area?0:4),days:1+area+(index%3),fee:({Walmart:[399,499],Amazon:[299,399],Target:[499,599]})[marketplace][area]},
  ])),
}))}))
export const catalog = presets.flatMap(preset=>preset.listings)
export function sampleDate(days, now = new Date()) {
  const day = new Date(now)
  day.setUTCHours(12,0,0,0)
  day.setUTCDate(day.getUTCDate()+days)
  return new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'}).format(day)
}
export function sampleOffers(category,zip,cap,required=[],size='') {
  const preset = presets.find(row=>row.id===category)
  if (!preset || !demoZips.includes(zip)) return []
  const terms = value=>value.toLowerCase().replace(/[‐‑–—-]/g,' ').trim()
  return preset.listings.filter(item=>item.delivery[zip].available && item.price/item.pack<preset.cap && item.price/item.pack<=(cap??preset.cap) &&
    (!size || terms(size)===terms(item.size) || terms(size).replace('fl ','')===terms(item.size).replace('fl ','')) &&
    required.every(need=>terms([item.variant,...item.evidence].join(' ')).includes(terms(need))))
}
export function samplePlan(rows,zip) {
  const orders = new Map()
  let subtotal = 0
  const selections = rows.map(row=>{
    const item = catalog.find(item=>item.id===row.offer)
    const valid = item && sampleOffers(row.category,zip,row.cap,row.required,row.size).includes(item)
    if (!valid) return {...row,item,valid:false}
    const delivery = item.delivery[zip]
    subtotal += item.price*row.quantity
    if (!orders.has(item.marketplace)) orders.set(item.marketplace,{marketplace:item.marketplace,fee:delivery.fee,items:[]})
    orders.get(item.marketplace).items.push({id:item.id,name:item.name,days:delivery.days})
    return {...row,item,valid:true,delivery}
  })
  const shipments = [...orders.values()]
  const fee = shipments.some(order=>order.fee==null)?null:shipments.reduce((sum,order)=>sum+order.fee,0)
  return {selections,orders:shipments,subtotal,fee,total:fee==null?null:subtotal+fee}
}
