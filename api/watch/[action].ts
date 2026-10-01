import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createWatchHandler, type Room } from '../../server/watch-together.ts'
import { bodyOf, limit, redis, respond, sameOrigin, type ApiRequest } from '../../server/redis.ts'

type StoredRoom = Omit<Room, 'code' | 'members'> & { code: string; members: [string, Room['members'] extends Map<string, infer M> ? M : never][] }
type Stored = { version: string; room: StoredRoom }
const saveScript = `local old=redis.call('GET',KEYS[1]); if ARGV[1]=='' then if old then return 0 end else if not old or cjson.decode(old).version~=ARGV[1] then return 0 end end; if ARGV[2]=='' then redis.call('DEL',KEYS[1]) else redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]) end; return 1`
const actions = new Set(['create','join','state','control','message','leave','admin','voice','voice-get','like','signal','signals','broadcast','frame'])
export default async function handler(req: ApiRequest, res: ServerResponse) {
  if (!sameOrigin(req) || req.headers['x-ostra-watch'] !== '1') { respond(res, 403, { error: 'Same-origin requests only.' }); return }
  const action = new URL(req.url ?? '/', 'https://local.invalid').pathname.split('/').pop() ?? ''
  if (!actions.has(action)) { respond(res, 404, { error: 'Unknown room action.' }); return }
  let body: Record<string, unknown>
  try { body = await bodyOf(req, action === 'voice' ? 360000 : action === 'signal' ? 40000 : 8000) }
  catch { respond(res, 400, { error: 'Invalid request.' }); return }
  const roomId = String(body.room ?? '')
  if (action !== 'create' && !/^[a-f0-9]{24}$/.test(roomId)) { respond(res, 400, { error: 'The room or code is incorrect, or the room has closed.' }); return }
  try {
    if ((action === 'create' || action === 'join') && !await limit(req, 'room-entry', 12, 60)) { respond(res, 429, { error: 'Too many attempts. Wait a minute.' }); return }
    // Optimistic version checks serialize concurrent updates without process-local state.
    for (let attempt = 0; attempt < 6; attempt++) {
      const raw = action === 'create' ? null : await redis<string | null>('GET', `robaq:room:${roomId}`)
      const stored: Stored | null = raw ? JSON.parse(raw) : null
      const rooms = new Map<string, Room>()
      if (stored) rooms.set(roomId, { ...stored.room, code: Buffer.from(stored.room.code, 'base64'), members: new Map(stored.room.members) })
      let status = 500, output = JSON.stringify({ error: 'Room request failed.' })
      const buffered = { writeHead(code: number) { status = code }, end(data: string) { output = data } } as unknown as ServerResponse
      const forwarded = {
        method: req.method, url: `/api/watch/${action}`, headers: req.headers, socket: { remoteAddress: 'request' },
        setEncoding() {}, async *[Symbol.asyncIterator]() { yield JSON.stringify(body) },
      } as unknown as IncomingMessage
      await createWatchHandler(rooms)(forwarded, buffered, () => {})
      const room = [...rooms.values()][0]
      const key = `robaq:room:${room?.id ?? roomId}`
      if (!room && !stored) { respond(res, status, JSON.parse(output)); return }
      const encoded = room ? JSON.stringify({ version: randomUUID(), room: { ...room, code: room.code.toString('base64'), members: [...room.members] } }) : ''
      if (Buffer.byteLength(encoded) > 8_000_000) { respond(res, 413, { error: 'Room storage is full. Start a new room.' }); return }
      const host = room && [...room.members.values()].find(member => member.host)
      const ttl = room && host ? Math.max(1, Math.ceil((Math.min(room.created + 12 * 3600000, host.seen + 120000) - Date.now()) / 1000)) : 1
      const saved = await redis<number>('EVAL', saveScript, 1, key, stored?.version ?? '', encoded, ttl)
      if (saved === 1) { respond(res, status, JSON.parse(output)); return }
      await new Promise(resolve => setTimeout(resolve, 25 + Math.random() * 75))
    }
    respond(res, 503, { error: 'The room is busy. Please try again.' })
  } catch (e) { respond(res, 503, { error: e instanceof Error && e.message.startsWith('MovieSync storage') ? e.message : 'MovieSync storage is temporarily unavailable.' }) }
}
