import type {Offer} from './cart.ts'
import {snapshot} from './data.ts'

export const swapLabel = 'Budget example · Target listings checked Nov 14, 2026'
const checked = 'Target product page showed the listed variant, price and in-stock status on Nov 14, 2026. Target is the seller based on the first-party return terms and absence of a Target Plus partner label. ZIP-specific shipping and stock may vary.'
export const swapOffers: Offer[] = [
  ...snapshot.map(offer => offer.retailer === 'Target' ? {...offer,source:'Verified' as const,note:checked} : offer),
  {id:'target-wash-8',product:'Hydrating facial cleanser',title:'CeraVe Hydrating Face Wash, 8 fl oz',retailer:'Target',seller:'Target',
    cents:1299,pack:1,brand:'CeraVe',size:'8 fl oz',tags:['hydrating'],available:true,standard:true,certain:true,
    source:'Verified',url:'https://www.target.com/p/-/A-76198439',note:checked},
  {id:'target-wash-12',product:'Hydrating facial cleanser',title:'CeraVe Hydrating Face Wash, 12 fl oz',retailer:'Target',seller:'Target',
    cents:1379,pack:1,brand:'CeraVe',size:'12 fl oz',tags:['hydrating'],available:true,standard:true,certain:true,
    source:'Verified',url:'https://www.target.com/p/-/A-13977968',note:checked},
]
