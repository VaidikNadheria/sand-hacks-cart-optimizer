import {defineConfig,loadEnv} from 'vite'
import {geminiConfig,handleApi} from './gemini.mjs'
export default defineConfig(({mode}) => {
  const config = geminiConfig(loadEnv(mode,process.cwd(),''))
  return {
    server:{strictPort:true},
    plugins:[{
      name:'cartwise-api',
      configureServer(server) {
        server.middlewares.use(async (req,res,next)=>{
          if (!await handleApi(req,res,config)) next()
        })
      },
    }],
  }
})
