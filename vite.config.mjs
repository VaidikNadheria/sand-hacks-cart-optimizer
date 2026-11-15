import {handleDemo} from './demo-api.mjs'
import {defineConfig,loadEnv} from 'vite'
import {geminiConfig,handleApi} from './gemini.mjs'
import {handleListings,listingConfig} from './listings.mjs'
export default defineConfig(({mode}) => {
  const env = loadEnv(mode,process.cwd(),'')
  const config = geminiConfig(env)
  const listings = listingConfig(env)
  return {
    server:{strictPort:true},
    build:{rollupOptions:{input:{home:'index.html',demo:'demo.html'}}},
    plugins:[{
      name:'cartwise-api',
      configureServer(server) {
        server.middlewares.use(async (req,res,next)=>{
          if (!handleDemo(req,res) && !await handleApi(req,res,config) && !await handleListings(req,res,listings)) next()
        })
      },
    }],
  }
})
