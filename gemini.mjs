const string = {type:'string'}
const nullable = schema => ({...schema,type:[schema.type,'null']})
const list = items => ({type:'array',items})
const object = properties => ({type:'object',properties,required:Object.keys(properties)})
const schema = object({
  items:{...list(object({
    product:string,quantity:{type:'integer',minimum:1,maximum:99},exact:string,must:list(string),
    brand:string,size:string,flexible:list({type:'string',enum:['brand','size']}),multi:{type:'boolean'},
  })),minItems:1,maxItems:40},
  budget:nullable({type:'number',minimum:0,maximum:999999}),
  followUp:nullable(string),
})

// Keep the provider grammar small. Enforce field lengths and numeric bounds locally.
const providerSchema = object({
  items:list(object({
    product:string,quantity:{type:'integer'},exact:string,must:list(string),brand:string,size:string,
    flexible:list(string),multi:{type:'boolean'},
  })),
  budget:nullable({type:'number'}),
  followUp:nullable(string),
})

function validate(value, rule) {
  if (Array.isArray(rule.type)) return value === null || validate(value,{...rule,type:rule.type[0]})
  switch (rule.type) {
    case 'object':
      return !!value && typeof value==='object' && !Array.isArray(value) &&
        Object.keys(value).length===rule.required.length && rule.required.every(k=>Object.hasOwn(value,k)&&validate(value[k],rule.properties[k]))
    case 'string': return typeof value==='string' && value.length<=300 && (!rule.enum || rule.enum.includes(value))
    case 'array': return Array.isArray(value) && value.length>=(rule.minItems??0) && value.length<=(rule.maxItems??40) && value.every(v=>validate(v,rule.items))
    case 'integer': return Number.isInteger(value) && value>=rule.minimum && value<=rule.maximum
    case 'number': return Number.isFinite(value) && value>=rule.minimum && value<=rule.maximum
    case 'boolean': return typeof value==='boolean'
    default: return false
  }
}
export function geminiConfig(env) {
  return {key:env.GEMINI_API_KEY, model:env.GEMINI_MODEL || 'gemini-2.5-flash'}
}
export async function handleApi(req,res,config) {
  const path = req.url?.split('?')[0]
  if (path !== '/api/status' && path !== '/api/requirements') return false
  const reply = (status,data) => {
    res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'})
    res.end(JSON.stringify(data))
    return true
  }
  if (path==='/api/status') return reply(200,{gemini:Boolean(config.key)})
  if (req.method!=='POST' || !req.headers['content-type']?.startsWith('application/json')) return reply(405,{error:'Expected a JSON POST'})
  if (!config.key) return reply(503,{error:'Gemini is unavailable'})
  try {
    let raw = ''
    for await (const chunk of req) {
      raw += chunk
      if (raw.length>16000) return reply(413,{error:'List too long'})
    }
    const data = JSON.parse(raw)
    if (typeof data?.text!=='string' || !data.text.trim() || data.text.length>2500 ||
      !Array.isArray(data.history) || data.history.length>8 || data.history.some(turn=>
        typeof turn?.question!=='string' || turn.question.length>300 || typeof turn.answer!=='string' || turn.answer.length>500)) return reply(400,{error:'Invalid shopping text'})
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(config.model)+':generateContent',{
      method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':config.key},
      signal:AbortSignal.timeout(18000),
      body:JSON.stringify({
        systemInstruction:{parts:[{text:'Extract a shopping list. Return one item per separate product, category names in product. For the TI-30XS MultiView, use Scientific calculator in product and TI-30XS MultiView scientific calculator in exact if locked. For a hydrating facial cleanser use Hydrating facial cleanser in product. For daily moisturizing lotion use Daily moisturizing lotion in product. Normalize fluid ounces to fl oz. Quantity is the total number of individual units requested (default 1). A two-pack supplies two units: if someone asks for two bottles and later accepts one two-pack, quantity stays 2 and multi becomes true. A clarification about packaging does not change the requested unit count. Use exact listing title only for explicitly locked products, explicit required attributes in must, and flexible must be empty unless the shopper explicitly says brand or size may change. An unspecified brand or size does not qualify as an explicitly flexible preference. If exact is supplied, leave brand and size blank. Use empty strings/arrays for unset fields. Set multi to false unless the shopper unambiguously permits a multipack for this item. When asking which item can be a multipack, leave multi false on every unresolved item. Ask one short follow-up only if an ambiguity materially affects eligibility or quantities. Incorporate all supplied answers. Never repeat a question that has an answer. Use null budget if absent. Never infer prices, sellers or availability.'}]},
        contents:[{parts:[{text:JSON.stringify({list:data.text,clarifications:data.history})}]}],
        generationConfig:{responseMimeType:'application/json',responseJsonSchema:providerSchema,maxOutputTokens:4096},
      }),
    })
    if (!response.ok) return reply(502,{error:'Gemini returned '+response.status})
    const output = await response.json()
    const content = output.candidates?.[0]?.content?.parts?.filter(part=>!part.thought).map(part=>part.text??'').join('')
    const value = JSON.parse(content ?? '')
    if (!validate(value,schema) || value.items.some(item=>!item.product.trim())) return reply(502,{error:'Invalid Gemini output'})
    if (value.budget!==null) value.budget = Math.round(value.budget*100)/100
    return reply(200,value)
  } catch {
    return reply(502,{error:'Unable to import shopping list'})
  }
}
