import { randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import { LiveRooms, deserializeLiveRoom, serializeLiveRoom, type StoredLiveRoom } from '../../server/live-rooms.ts'
import { bodyOf, limit, redis, respond, sameOrigin, type ApiRequest } from '../../server/redis.ts'

type Stored = { version: string; room: StoredLiveRoom }
const saveScript = `local old=redis.call('GET',KEYS[1]); if ARGV[1]=='' then if old then return 0 end else if not old or cjson.decode(old).version~=ARGV[1] then return 0 end end; if ARGV[2]=='' then redis.call('DEL',KEYS[1]) else redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]) end; return 1`
const actions = new Set(['health','create','join','poll','leave','end','signal','message','ask','skip','cut','stop-round','point','allow-point'])

export default async function handler(req: ApiRequest, res: ServerResponse) {
  if (!sameOrigin(req)) { respond(res, 403, { error: 'Same-origin requests only.' }); return }
  const action = new URL(req.url ?? '/', 'https://local.invalid').pathname.split('/').pop() ?? ''
  if (!actions.has(action)) { respond(res, 404, { error: 'Unknown room action.' }); return }
  let body: Record<string, unknown>
  try { body = await bodyOf(req, action === 'signal' ? 30000 : 8000) }
  catch { respond(res, 400, { error: 'Invalid request.' }); return }
  try {
    if (action === 'health') {
      await redis('PING')
      respond(res, 200, { ready: true })
      return
    }
    if ((action === 'create' || action === 'join') && !await limit(req, 'live-room-entry', 20, 60)) {
      respond(res, 429, { error: 'Too many requests. Please wait.' }); return
    }
    const roomId = String(body.room ?? '')
    if (action !== 'create' && !/^[a-f0-9]{48}$/.test(roomId)) {
      respond(res, 400, { error: 'This room has ended or does not exist.' }); return
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      const raw = action === 'create' ? null : await redis<string | null>('GET', `robaq:live:${roomId}`)
      const stored: Stored | null = raw ? JSON.parse(raw) as Stored : null
      if (action !== 'create' && !stored) { respond(res, 400, { error: 'This room has ended or does not exist.' }); return }
      const service = new LiveRooms()
      if (stored) service.rooms.set(stored.room.id, deserializeLiveRoom(stored.room))
      let status = 200
      let output: unknown
      try {
        output = service.act(action, body, 'request')
      } catch (e) {
        respond(res, 400, { error: e instanceof Error ? e.message : 'Room request failed.' })
        return
      }
      const room = [...service.rooms.values()][0]
      const key = `robaq:live:${room?.id ?? roomId}`
      if (!room) {
        if (stored) {
          const deleted = await redis<number>('EVAL', saveScript, 1, key, stored.version, '', 1)
          if (deleted !== 1) { await new Promise(r => setTimeout(r, 25 + Math.random() * 75)); continue }
        }
        respond(res, status, output)
        return
      }
      const encoded = JSON.stringify({ version: randomUUID(), room: serializeLiveRoom(room) })
      if (Buffer.byteLength(encoded) > 2_000_000) { respond(res, 413, { error: 'Room service is busy. Try again later.' }); return }
      const host = [...room.members.values()].find(m => m.host)
      const ttl = host ? Math.max(1, Math.ceil((Math.min(room.created + 6 * 3600000, host.seen + 20000) - Date.now()) / 1000)) : 1
      const saved = await redis<number>('EVAL', saveScript, 1, key, stored?.version ?? '', encoded, ttl)
      if (saved === 1) { respond(res, status, output); return }
      await new Promise(r => setTimeout(r, 25 + Math.random() * 75))
    }
    respond(res, 503, { error: 'Room service is busy. Try again later.' })
  } catch (e) {
    const message = e instanceof Error && e.message.includes('storage')
      ? 'Room service is not configured. This room cannot start.'
      : e instanceof Error && e.message.startsWith('MovieSync storage')
        ? 'Room service is not configured. This room cannot start.'
        : 'Room service is not configured. This room cannot start.'
    respond(res, 503, { error: message })
  }
}
