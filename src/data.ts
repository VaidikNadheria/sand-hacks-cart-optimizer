import type { Line, Offer } from './cart.ts'
export const calculator = 'TI-30XS MultiView scientific calculator'
export const demo: Line[] = [
  {id:'calc', product:'Scientific calculator', quantity:1, exact:calculator, must:[], brand:'', size:'', flexible:[], multi:false},
  {id:'wash', product:'Hydrating facial cleanser', quantity:1, exact:'', must:['hydrating'], brand:'CeraVe', size:'16 fl oz', flexible:['size'], multi:false},
  {id:'lotion', product:'Daily moisturizing lotion', quantity:1, exact:'', must:['fragrance-free'], brand:'Aveeno', size:'18 fl oz', flexible:[], multi:false},
]
const base = {pack:1, available:true, standard:true, certain:true, source:'Snapshot' as const}
export const snapshot: Offer[] = [
  {...base,id:'tc',product:demo[0].product,title:calculator,retailer:'Target',seller:'Target',cents:1399,brand:'Texas Instruments',size:'',tags:[],url:'https://www.target.com/p/-/A-14773104'},
  {...base,id:'wc',product:demo[0].product,title:calculator,retailer:'Walmart',seller:'Marketplace seller',cents:0,available:null,brand:'Texas Instruments',size:'',tags:[],url:'',note:'Checked Walmart listings were third-party. No eligible first-party quote in the supplied snapshot.'},
  ...(['Target','Walmart'] as const).map(retailer => ({
    ...base,id:retailer+'wash',product:demo[1].product,title:'CeraVe Hydrating Facial Cleanser, 16 fl oz',
    retailer,seller:retailer,cents:retailer==='Target'?1619:1597,brand:'CeraVe',size:'16 fl oz',tags:['hydrating'],
    url:retailer==='Target'?'https://www.target.com/p/-/A-51148016':'https://www.walmart.com/ip/3HPHLFVA6EJI',
  })),
  ...(['Target','Walmart'] as const).map(retailer => ({
    ...base,id:retailer+'lotion',product:demo[2].product,title:'Aveeno fragrance-free daily moisturizing lotion, 18 fl oz',
    retailer,seller:retailer,cents:retailer==='Target'?999:997,brand:'Aveeno',size:'18 fl oz',tags:['fragrance-free'],
    url:retailer==='Target'?'https://www.target.com/p/-/A-10801059':'https://www.walmart.com/ip/10818473',
  })),
]
export const blank = (id: string): Line => ({id,product:'',quantity:1,exact:'',must:[],brand:'',size:'',flexible:[],multi:false})
