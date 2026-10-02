import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

// Anonymous browser presence, shared only by clients connected to this server.
export function guestPresence(): Plugin {
  const visits = new Map<string, { browser: string; seen: number; guest:boolean }>()
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url !== '/api/presence') return next()
    try {
      if (req.method !== 'POST' || !req.headers.origin || new URL(req.headers.origin).host !== req.headers.host) { res.writeHead(403); res.end(); return }
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 600) throw new Error('Invalid presence') }
      const body = JSON.parse(raw)
      const valid = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9-]{20,64}$/.test(value)
      if (!valid(body.tab) || !valid(body.browser) || typeof body.guest !== 'boolean') throw new Error('Invalid presence')
      const now = Date.now()
      for (const [key, visit] of visits) if (now - visit.seen > 35000) visits.delete(key)
      if (body.active !== false) { if (visits.size < 10000 || visits.has(body.tab)) visits.set(body.tab, { browser: body.browser, seen: now,guest:body.guest }) }
      else visits.delete(body.tab)
      const membersSet=new Set([...visits.values()].filter(v=>!v.guest).map(v=>v.browser))
      const guests = new Set([...visits.values()].filter(v=>v.guest&&!membersSet.has(v.browser)).map(v => v.browser)).size
      const members=membersSet.size
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ guests,members }))
    } catch { res.writeHead(400); res.end() }
  }
  return { name: 'robaq-guest-presence', configureServer(server) { server.middlewares.use((req, res, next) => { void middleware(req, res, next) }) }, configurePreviewServer(server) { server.middlewares.use((req, res, next) => { void middleware(req, res, next) }) } }
}
