export type Delivery = {available:boolean;days:number;fee:number|null}
export type Sample = {id:string;category:string;name:string;variant:string;marketplace:string;size:string;price:number;pack:number;retailerUrl?:string;evidence:string[];delivery:Record<string,Delivery>}
export type Preset = {id:string;name:string;cap:number;needs:string[];listings:Sample[]}
export type SampleRow = {id:string;category:string;offer?:string;quantity:number;cap?:number;required?:string[];size?:string}
export const demoLabel:string
export const demoZips:string[]
export const presets:Preset[]
export const catalog:Sample[]
export function sampleDate(days:number, now?:Date):string
export function sampleOffers(category:string,zip:string,cap?:number,required?:string[],size?:string):Sample[]
export function samplePlan(rows:SampleRow[],zip:string):{selections:(SampleRow&{item?:Sample;valid:boolean;delivery?:Delivery})[];orders:{marketplace:string;fee:number|null;items:{id:string;name:string;days:number}[]}[];subtotal:number;fee:number|null;total:number|null}
