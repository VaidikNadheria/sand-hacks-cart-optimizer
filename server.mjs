import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {loadEnvFile} from 'node:process'
import {geminiConfig,handleApi} from './gemini.mjs'

for (const file of ['.env.local','.env']) {
  try { loadEnvFile(file) } catch (error) { if (error.code!=='ENOENT') throw error }
}
const config = geminiConfig(process.env)
const types = {html:'text/html',js:'text/javascript',css:'text/css'}
const port = Number(process.env.PORT || 4173)
createServer(async (req,res)=>{
  if (await handleApi(req,res,config)) return
  const pathname = req.url?.split('?')[0]
  const file = pathname==='/' ? 'index.html' : /^\/assets\/[\w.-]+\.(js|css)$/.test(pathname??'') ? pathname.slice(1) : ''
  try {
    if (!file) throw new Error('Unknown path')
    const body = await readFile(new URL('./dist/'+file,import.meta.url))
    res.writeHead(200,{'Content-Type':types[file.split('.').at(-1)]+'; charset=utf-8'})
    res.end(body)
  } catch {
    res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'})
    res.end('Page missing. Run npm run build before starting the production server.')
  }
}).listen(port,'127.0.0.1',()=>console.log('Cartwise at http://127.0.0.1:'+port))
