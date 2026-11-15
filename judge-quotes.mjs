// Observed public listings. Reviews, stock, seller and shipping do not carry forward.
const checked='2026-11-15T00:00:00.000Z'
const target=id=>'https://www.target.com/p/-/A-'+id
const walmart=id=>'https://www.walmart.com/ip/'+id
const amazon=id=>'https://www.amazon.com/dp/'+id
const q=(key,category,retailer,url,title,brand,size,pack,price,evidence,lastSeen=checked)=>({
  key,category,retailer,url,title,brand,size,pack,price,evidence,lastSeen,seller:'',available:null,checkedAt:'',stale:true,savedQuote:true,exactListing:true,
})
export const judgeQuotes=[
  q('vanicream-body','body wash','Target',target('84697206'),'Vanicream Gentle Body Wash','Vanicream','12 fl oz',1,'11.99','Sensitive skin, dry skin, fragrance-free'),
  q('vanicream-body','body wash','Walmart',walmart('298964526'),'Vanicream Gentle Body Wash','Vanicream','12 fl oz',1,'','Sensitive skin, dry skin, fragrance-free'),
  q('aveeno-body','body wash','Walmart',walmart('53722502'),'Aveeno Skin Relief Body Wash','Aveeno','18 fl oz',1,'9.97','Sensitive skin, dry skin, fragrance-free'),
  q('cerave-body','body wash','Target',target('1012127083'),'CeraVe Hydrating Body Wash','CeraVe','10 oz',null,'','Gentle hydrating body wash'),
  q('cetaphil-body','body wash','Target',target('89531611'),'Cetaphil Ultra Gentle Body Wash','Cetaphil','16.9 fl oz',1,'8.39','Sensitive skin, dry skin, fragrance-free'),
  q('cetaphil-relief','body wash','Target',target('94837434'),'Cetaphil Moisturizing Relief Body Wash','Cetaphil','16.9 fl oz',1,'7.99','Sensitive skin, dry skin, fragrance-free, moisturizing'),
  q('samsung55h','television','Walmart',walmart('18211860309'),'Samsung U8000H UN55U8000HFXZA 55-inch 4K TV','Samsung','55 inch',1,'248.00','4K UHD'),
  q('tcl55s5','television','Walmart',walmart('5378490191'),'TCL S5 55S551G 55-inch 4K TV','TCL','55 inch',1,'399.98','4K UHD'),
  q('roku55selectq','television','Target',target('95003216'),'Roku Select Series 55-inch 4K QLED TV','Roku','55 inch',1,'','4K QLED'),
  q('vizio55quantum','television','Walmart',walmart('320NP1VP0A28'),'VIZIO VQD55R-10 55-inch 4K QLED TV','VIZIO','55 inch',1,'228.00','4K QLED'),
  q('onn65s4','television','Walmart',walmart('16109363845'),'onn 65S4V4 65-inch 4K TV','onn','65 inch',1,'258.00','4K UHD'),
  q('samsung65h','television','Target',target('95003227'),'Samsung U8000H UN65U8000H 65-inch 4K TV','Samsung','65 inch',1,'329.99','4K UHD'),
  q('roku65select','television','Target',target('90471876'),'Roku Select Series 65-inch 4K HDR TV','Roku','65 inch',1,'','4K HDR; public listing was out of stock'),
  q('vanicream-face','face wash','Amazon',amazon('B00QY1XZ4W'),'Vanicream Gentle Facial Cleanser','Vanicream','8 fl oz',1,'9.47','Gentle cleanser; sensitive skin; dry skin; fragrance-free','2026-11-09T12:26:37.362Z'),
  q('cerave-face','face wash','Target',target('13977968'),'CeraVe Hydrating Face Wash','CeraVe','12 fl oz',1,'13.79','Gentle cleanser; normal to dry skin; sensitive skin; fragrance-free'),
  q('cetaphil-face','face wash','Target',target('83019455'),'Cetaphil Gentle Face Wash','Cetaphil','16 fl oz',1,'12.49','Gentle cleanser; normal to dry skin; sensitive skin; fragrance-free'),
  q('neutrogena-face','face wash','Target',target('76545826'),'Neutrogena Ultra Gentle Foaming Facial Cleanser','Neutrogena','16 fl oz',1,'11.89','Gentle cleanser; sensitive skin; foaming cleanser'),
  q('vanicream-deo','deodorant','Walmart',walmart('445816671'),'Vanicream Antiperspirant Deodorant','Vanicream','2.25 oz',1,'','Sweat control; odor control; sensitive skin; unscented; Walmart listing was out of stock'),
  q('vanicream-deo','deodorant','Amazon',amazon('B01M7ZAQNN'),'Vanicream Antiperspirant Deodorant','Vanicream','2.25 oz',1,'12.68','Sweat control; odor control; sensitive skin; unscented','2026-11-13T02:39:21.343Z'),
  q('arm-hammer-deo','deodorant','Walmart',walmart('2798957901'),'Arm & Hammer Ultra Max Antiperspirant Deodorant','Arm & Hammer','2.6 oz',null,'','Unscented; sweat control; odor control'),
  q('dove-deo','deodorant','Walmart',walmart('35433682'),'Dove Advanced Care Sensitive Antiperspirant Deodorant','Dove','2.6 oz',1,'9.94','Unscented; sensitive skin; sweat control; odor control'),
  q('mitchum-deo','deodorant','Target',target('13197379'),'Mitchum Unscented Antiperspirant Deodorant Gel 2-pack','Mitchum','3.4 oz',2,'6.99','Unscented; sweat control; odor control'),
]
export const exactItems={
  'vanicream-body':{key:'vanicream-body',upc:'345334302124',source:walmart('298964526'),size:'12 fl oz',pack:1},
  'vanicream-deo':{key:'vanicream-deo',upc:'345334305026',source:walmart('445816671'),size:'2.25 oz',pack:1},
}
export function canonicalJudgeUrl(raw) {
  try {
    const u=new URL(raw)
    if (u.protocol!=='https:' || u.port || u.username || u.password) return ''
    const domain=u.hostname.replace(/^www\./,'')
    if(domain==='walmart.com'&&u.pathname.startsWith('/ip/'))return walmart(u.pathname.split('/').filter(Boolean).at(-1))
    if(domain==='target.com'&&/A-\d+$/.test(u.pathname))return target(u.pathname.split('A-').at(-1))
    if(domain==='amazon.com')return amazon(u.pathname.match(/\/(?:dp|product|offer-listing)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase()??'')
  }catch {}
  return ''
}
