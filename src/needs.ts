import type {Line} from './cart.ts'
import {amazonProductUrl, contains, modelNumber, words} from './fit.ts'

type Kind = 'goal'|'price'|'size'|'scent'|'pack'|'feature'|'speed'|'range'|'texture'|'audience'|'level'|'style'|'guided-0'|'guided-1'|'guided-2'
export type Need = {kind:Kind;prompt:string;hint:string;choices:string[]}
const goal = (prompt:string,choices:string[]):Need=>({kind:'goal',prompt,choices,hint:'Describe what you need'})
const price = (choices:string[] = []):Need=>({kind:'price',prompt:'What’s your maximum price per item?',choices,hint:'e.g. $15'})
const scent:Need = {kind:'scent',prompt:'Does it need to be fragrance-free?',choices:['Fragrance-free','Scented'],hint:'e.g. lemon'}
const pack:Need = {kind:'pack',prompt:'Is a multipack okay?',choices:['Single pack only','Allow multipacks'],hint:'e.g. yes, multipacks are okay'}
const size = (prompt:string,choices:string[]):Need=>({kind:'size',prompt,choices,hint:'Enter a size and unit'})
const feature = (prompt:string,choices:string[]):Need=>({kind:'feature',prompt,choices,hint:'Describe the feature'})

export function needsFor(line:Line):Need[] {
  const request = words(line.query||line.product)
  if (line.exact || amazonProductUrl(line.product) || modelNumber.test(line.query||line.product)) return []
  const product = words(line.product)
  let questions:Need[]
  if (/\bdeodorants?\b/.test(product)) questions = [
    goal('What do you need most from your deodorant?',['Odor control','Sweat control','Sensitive skin']),scent,price(['$5','$10','$15']),
  ]
  else if (/\b(?:face|facial) moisturiz(?:er|ers|ing)\b/.test(product)) questions = [
    goal('What is your skin type?',['Dry skin','Oily skin','Combination skin','Sensitive skin']),
    {kind:'texture',prompt:'What texture do you prefer?',choices:['Lightweight gel','Lotion','Rich cream'],hint:'Describe your preferred texture'},scent,
  ]
  else if (/\btennis (?:racquets?|rackets?)\b/.test(product)) questions = [
    {kind:'audience',prompt:'Who will use the racquet?',choices:['Adult','Junior'],hint:'e.g. junior, age 10'},
    {kind:'level',prompt:'What is the player’s level?',choices:['Beginner','Intermediate','Advanced'],hint:'Describe the player’s experience'},
    {kind:'style',prompt:'What do you want from the racquet?',choices:['Power','Control','Easy swinging'],hint:'Describe the playing preference'},
  ]
  else if (/\b(?:face|facial) (?:wash|cleanser)\b/.test(product)) questions = [
    goal('What is your skin type?',['Sensitive skin','Dry skin','Oily skin','Combination skin']),
    feature('What cleanser format do you want?',['Gentle cleanser','Foam','Gel','Cream','Oil']),scent,
  ]
  else if (/\bshampoo\b/.test(product)) questions = [
    goal('What do you want your shampoo to do?',['Clean an oily scalp','Moisturize dry hair','Protect color']),scent,price(),
  ]
  else if (/\b(?:wash|lotion|cleanser)\b/.test(product)) questions = [
    goal('What do you want it to do for your skin?',['Sensitive skin','Dry skin','Oily skin']),
    /\bface\b/.test(product)?feature('What cleanser format do you need?',['Foam','Gel','Cream']):scent,price(),
  ]
  else if (/\bdish soap\b/.test(product)) questions = [scent,pack,price(['$5','$10','$15'])]
  else if (/\bwater bottle\b/.test(product)) questions = [
    size('What capacity do you need?',['16 oz','24 oz','32 oz']),feature('Does it need to be insulated?',['Insulated','Uninsulated']),price(['$15','$25','$40']),
  ]
  else if (/\b(?:tvs?|televisions?)\b/.test(product)) questions = [
    size('What screen size do you need?',['43 inch','55 inch','65 inch']),feature('What resolution or feature do you need?',['4K','OLED','QLED']),price(['$300','$500','$800']),
  ]
  else if (/\bscooter\b/.test(product)) questions = [goal('How will you use your scooter?',['Commuting','Errands','Recreation']),
    {kind:'speed',prompt:'What advertised top speed do you need?',choices:['Speed 10–15 mph','Speed 16–25 mph'],hint:'e.g. 16–25 mph'},
    {kind:'range',prompt:'What distance do you need between charges?',choices:['Commute distance: 10 miles','Minimum advertised range: 20 miles'],hint:'e.g. commute distance: 10 miles'}]
  else if (/\b(?:headphones|earbuds)\b/.test(product)) questions = [
    goal('Where will you use them?',['Commuting','Exercise','Work calls']),feature('What feature do you need?',['Wireless','Noise cancelling']),price(['$25','$50','$100']),
  ]
  else questions = [goal(`Is there a requirement that would change which ${line.product} you choose?`,[])]
  return questions.filter(question=>{
    const {kind}=question
    const evidence = request+' '+words([...line.must,...(line.preferences??[])].join(' '))
    if (kind==='texture') return !/\b(?:gel|lotion|cream|texture|lightweight)\b/.test(evidence)
    if (kind==='audience') return !/\b(?:adult|junior|youth|children|kids)\b/.test(evidence)
    if (kind==='level') return !/\b(?:beginner|intermediate|advanced|novice)\b/.test(evidence)
    if (kind==='style') return !/\b(?:power|control|easy swinging|maneuverability)\b/.test(evidence)
    if (kind==='price') return line.priceCap==null && !/\b(?:under|budget|maximum|up to)\s*\$?\s*\d/i.test(line.query??'')
    if (kind==='size') return !line.size
    if (kind==='pack') return !line.multi && !/\b(?:single|one bottle|pack|multipack)\b/.test(request+' '+words(line.must.join(' ')))
    if (kind==='scent') return !/\b(?:fragrance|scent|scented|unscented|lavender|lemon|mint)\b/.test(request+' '+words(line.must.join(' ')))
    if (kind==='goal') return !question.choices.some(choice=>contains(evidence,choice)) && !line.preferences?.length && !/\b(?:for|to|commuting|odor control|sweat control|sensitive skin|antiperspirant)\b/.test(request+' '+words(line.must.join(' ')))
    if (kind==='speed') return !/\bmph\b/.test(request+' '+words(line.must.join(' ')))
    if (kind==='range') return !/\b(?:range|miles)\b/.test(request+' '+words(line.must.join(' ')))
    return !/\b(?:insulated|foam|foaming|gel|cream|4k|1080p|oled|qled)\b/.test(request+' '+words(line.must.join(' ')))
  })
}

export function guidedNeeds(value:unknown,line:Line):Need[] {
  if (!Array.isArray(value)) return []
  return value.slice(0,3).flatMap((item,index)=>{
    if (!item || typeof item.prompt!=='string' || !Array.isArray(item.choices)) return []
    const prompt = item.prompt.trim().slice(0,160)
    if (!prompt || /how will you use it|how much do you want to spend|budget|price cap/i.test(prompt)) return []
    const choices = [...new Set<string>(item.choices.filter((choice:unknown):choice is string=>typeof choice==='string')
      .map((choice:string)=>choice.trim().slice(0,60))
      .filter((choice:string)=>choice && !/^(?:everyday use|occasional use|for a specific task|compact size|durability|no preference|type my own)$/i.test(choice)))].slice(0,4)
    const alreadyStated = [line.query||line.product,...line.must,...(line.preferences??[])].join(' ')
    return choices.length>=2 && !choices.some(choice=>contains(alreadyStated,choice))?[{kind:('guided-'+index) as Kind,prompt,choices,hint:'Describe what you need'}]:[]
  })
}

export function applyNeeds(line:Line,needs:Need[],answers:ReadonlyMap<Kind,string>) {
  const result = {...line,query:line.query ?? line.product,must:[...line.must],preferences:[...(line.preferences??[])]}
  for (const {kind} of needs) {
    const value = answers.get(kind)?.trim() ?? ''
    if (!value || value==='No preference' || value==='No price cap') continue
    if (kind==='goal' || kind==='level' || kind==='style' || kind==='texture' || kind.startsWith('guided-')) result.preferences.push(value)
    else if (kind==='price') {
      const amount = /^(?:under|up to|at most)?\s*\$?\s*(\d{1,6}(?:\.\d{1,2})?)$/i.exec(value)?.[1]
      if (!amount) return {error:'Enter a per-item price such as $15, or choose No preference.'}
      result.priceCap = Number(amount)
    } else if (kind==='pack') {
      if (/^(?:yes.*|allow multipacks?|multipacks?(?: ok(?:ay)?)?)$/i.test(value)) result.multi = true
      else if (!/^(?:no|single(?: units?| packs?)?(?: only)?|one bottle)$/i.test(value)) return {error:'Enter “yes” to allow multipacks or “no” for single-unit packs.'}
    } else if (kind==='size') result.size = value
    else if (kind==='speed') result.must.push(/^speed\b/i.test(value)?value:'Speed '+value)
    else if (kind==='range') result.must.push(/^(?:commute distance|(?:minimum|maximum) advertised range):/i.test(value)?value:'Commute distance: '+value)
    else result.must.push(value)
  }
  result.must = [...new Set(result.must)]
  return {line:result}
}
