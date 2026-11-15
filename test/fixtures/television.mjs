export const tv = {
  title:'Samsung 55-inch 4K Smart TV',brand:'Samsung',barcode:887276123456,
  shopsavvy:'products/smart-tv',identifiers:{walmart:'12340001'},
}
export const mount = {
  title:'Wall mount for Samsung 55-inch 4K Smart TV',barcode:887276123457,shopsavvy:'products/wall-mount',
}
export function tvOfferBatch(now=new Date()) {
  const offer = {retailer:'Walmart',URL:'https://www.walmart.com/ip/12340001',
    price:299.99,availability:'in',condition:'new',is_marketplace:false,timestamp:now.toISOString()}
  return {success:true,results:[{identifier:tv.barcode,status:'found',product:tv,offers:[
    offer,
    {...offer,retailer:'Target',URL:'https://www.walmart.com/ip/99990001'},
    {...offer,URL:'https://www.walmart.com/ip/99990002',currency:'CAD'},
  ]}]}
}
