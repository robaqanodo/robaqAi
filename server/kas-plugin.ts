import type { Plugin } from 'vite'
import { kasHandler, memorySecretStore, secretStore } from './kas.ts'
export function kasPlugin(): Plugin {
  return {name:'kas',configureServer(server){
    const handle=kasHandler(process.env.KV_REST_API_URL||process.env.UPSTASH_REDIS_REST_URL?secretStore:memorySecretStore())
    server.middlewares.use((req,res,next)=>{if(req.url?.split('?')[0]!=='/api/kas')return next();void handle(req,res)})
  }}
}
