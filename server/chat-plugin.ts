import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import handler from '../api/chat.ts'

function applyServerKey() {
  if (process.env.GEMINI_API_KEY?.trim()) return
  for (const name of ['.env', '.env.local', '.env.development', '.env.development.local']) {
    const path = resolve(process.cwd(), name)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const match = trimmed.match(/^GEMINI_API_KEY\s*=\s*(.*)$/)
      if (!match) continue
      let value = match[1].trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
      if (value) process.env.GEMINI_API_KEY = value
    }
  }
}

export function chatPlugin(): Plugin {
  return {name:'robaq-chat',config(_config, env){if(env.command==='serve')applyServerKey()},configureServer(server){
    applyServerKey()
    server.middlewares.use((req,res,next)=>{if(req.url?.split('?')[0]!=='/api/chat')return next();void handler(req as never,res)})
  },configurePreviewServer(server){
    applyServerKey()
    server.middlewares.use((req,res,next)=>{if(req.url?.split('?')[0]!=='/api/chat')return next();void handler(req as never,res)})
  }}
}
