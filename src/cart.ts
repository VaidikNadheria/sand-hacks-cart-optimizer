export const stores = ['Target', 'Walmart'] as const
export type Store = typeof stores[number]
export type Attribute = 'brand' | 'size'
export type Line = {
  id: string
  product: string
  quantity: number
  exact: string
  must: string[]
  brand: string
  size: string
  flexible: Attribute[]
  multi: boolean
}
export type Offer = {
  id: string
  product: string
  title: string
  lineId?: string
  retailer: Store
  seller: string
  cents: number
  pack: number
  brand: string
  size: string
  tags: string[]
  available: boolean | null
  standard: boolean
  certain: boolean
  source: 'Snapshot' | 'Manual' | 'Sample' | 'Verified'
  url: string
  note?: string
}
export const policies = {
  Target: { threshold: 3500, fee: 599, url: 'https://www.target.com/help/article/000055608' },
  Walmart: { threshold: 3500, fee: 699, url: 'https://www.walmart.com/help/article/the-walmart-site-and-app-experience/27f2678cb25a40a7b57a359fec3ca67f' },
}
type Purchase = { line: Line; offer: Offer; requested: number; packs: number; cost: number }
type Order = { store: Store; subtotal: number; shipping: number | null }
export type Plan = { purchases: Purchase[]; orders: Order[]; subtotal: number; total: number | null }
const clean = (value: string) => value.trim().toLowerCase()
const same = (a: string, b: string) => clean(a) === clean(b)
export const money = (cents: number) => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(cents / 100)
export function cents(input: string) {
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(input.trim())) return null
  const [whole, decimal = ''] = input.trim().split('.')
  return Number(whole) * 100 + Number(decimal.padEnd(2, '0'))
}

export function matchesLine(line: Line, offer: Offer) {
  return offer.lineId ? offer.lineId === line.id : same(offer.product, line.product)
}

export function exclusion(line: Line, offer: Offer) {
  if (!offer.certain) return 'Variant unconfirmed'
  if (offer.seller !== offer.retailer) return offer.seller ? 'Third-party seller' : 'Seller unknown'
  if (offer.available !== true) return offer.available === null ? 'Availability unknown' : 'Unavailable'
  if (!Number.isSafeInteger(offer.cents) || offer.cents < 0 || !Number.isSafeInteger(offer.pack) || offer.pack < 1) return 'Invalid price or pack size'
  if (line.exact && !same(line.exact, offer.title)) return 'Different exact product'
  if (line.must.some(tag => !offer.tags.some(value => same(tag, value)))) return 'Must-have missing'
  if (line.brand && !same(line.brand, offer.brand)) return 'Different brand'
  if (line.size && !same(line.size, offer.size)) return 'Different size'
  if (!line.multi && offer.pack > 1) return 'Multipack requires approval'
  if (!offer.standard) return 'Shipping fee unknown'
  return ''
}

export function shipping(store: Store, subtotal: number) {
  return subtotal >= policies[store].threshold ? 0 : policies[store].fee
}

function buy(line: Line, offer: Offer, requested: number): Purchase {
  const packs = Math.ceil(requested / offer.pack)
  return { line, offer, requested, packs, cost: packs * offer.cents }
}
function plan(purchases: Purchase[]): Plan {
  const orders = stores.flatMap(store => {
    const items = purchases.filter(item => item.offer.retailer === store)
    if (!items.length) return []
    const subtotal = items.reduce((sum, item) => sum + item.cost, 0)
    return [{store, subtotal, shipping: items.every(item => item.offer.standard) ? shipping(store, subtotal) : null}]
  })
  const subtotal = orders.reduce((sum, order) => sum + order.subtotal, 0)
  const total = orders.some(order => order.shipping === null) ? null : orders.reduce((sum, order) => sum + order.subtotal + (order.shipping ?? 0), 0)
  return { purchases, orders, subtotal, total }
}
type State = { totals: [number, number]; used: number; items: Purchase[] }
const stateLimit = 10000
const cost = (s: State) => s.totals[0] + s.totals[1]
const delivered = (s: State) => cost(s) + stores.reduce((sum, store, i) =>
  sum + ((s.used & (1 << i)) ? shipping(store, s.totals[i]) : 0), 0)

export function optimize(lines: Line[], offers: Offer[]) {
  const missing: string[] = []
  const excluded: {line: Line; offer: Offer; reason: string}[] = []
  const baseline: Purchase[] = []
  let states: State[] = [{totals: [0, 0], used: 0, items: []}]
  let limited = false

  for (const line of lines) {
    const eligible = offers.filter(offer => {
      if (!matchesLine(line, offer)) return false
      const reason = exclusion(line, offer)
      if (reason) excluded.push({line, offer, reason})
      return !reason
    })
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 99 || !eligible.length) {
      missing.push(line.product || 'Unnamed item')
      continue
    }
    const whole = eligible.map(offer => buy(line, offer, line.quantity)).sort((a,b) => a.cost - b.cost)
    baseline.push(whole[0])
    const choices = whole.map(item => [item])
    const target = eligible.filter(offer => offer.retailer === 'Target')
    const walmart = eligible.filter(offer => offer.retailer === 'Walmart')
    for (const left of target) for (const right of walmart) {
      for (let quantity = 1; quantity < line.quantity; quantity++) {
        choices.push([buy(line, left, quantity), buy(line, right, line.quantity - quantity)])
      }
    }
    const next = new Map<number, State>()
    for (const choice of choices) {
      const increments: [number, number] = [0, 0]
      let used = 0
      for (const item of choice) {
        const index = stores.indexOf(item.offer.retailer)
        increments[index] += item.cost
        used |= 1 << index
      }
      for (const prior of states) {
        const totals: [number, number] = [prior.totals[0] + increments[0], prior.totals[1] + increments[1]]
        const mask = prior.used | used
        // Once a store qualifies for free shipping, its exact subtotal only affects cost.
        const key = (mask * 3501 + Math.min(totals[0], 3500)) * 3501 + Math.min(totals[1], 3500)
        const current = next.get(key)
        if (!current || totals[0] + totals[1] < cost(current)) {
          next.set(key, {totals, used: mask, items: [...prior.items, ...choice]})
        }
      }
    }
    states = [...next.values()]
    if (states.length > stateLimit) {
      limited = true
      states = states.sort((a,b) => delivered(a) - delivered(b)).slice(0, stateLimit)
    }
  }

  const ordered = lines.length && !missing.length ? states.sort((a,b) => delivered(a) - delivered(b)) : []
  const one = ordered.find(s => s.used === 1 || s.used === 2)
  const split = ordered.find(s => s.used === 3)
  return {
    best: ordered[0] ? plan(ordered[0].items) : null,
    one: one ? plan(one.items) : null,
    split: split ? plan(split.items) : null,
    baseline: ordered.length ? plan(baseline) : null,
    missing, excluded, limited,
  }
}

export function substitutions(lines: Line[], offers: Offer[], budget: number, original: Plan) {
  return lines.flatMap(line => line.exact ? [] : [...new Set(line.flexible)].flatMap(field => {
    if (!line[field]) return []
    const values = new Set(offers.filter(offer => matchesLine(line, offer)).map(offer => offer[field].trim()).filter(value => value && !same(value, line[field])))
    return [...values].flatMap(value => {
      const changed = lines.map(entry => entry.id === line.id ? {...entry, [field]: value} : entry)
      const result = optimize(changed, offers)
      const next = result.best
      if (!next || next.total === null || original.total === null) return []
      return [{line, field, value, next, changed, limited: result.limited, meets: next.total <= budget, savings: original.total - next.total}]
    })
  })).sort((a,b) => b.savings - a.savings)
}
