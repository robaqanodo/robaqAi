import { watchMedia } from '../src/watch/media.ts'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

type Member = { id: string; name: string; host: boolean; seen: number; lastMessage: number; lastVoice: number; muted: boolean; color: string; lastLike: number }
type Voice = { id: string; memberId: string; name: string; sentAt: number; mime: string; data: string }
type Like = { id: string; memberId: string; color: string; sentAt: number }
const memberColors = ['#f472b6','#60a5fa','#4ade80','#fbbf24','#c084fc','#22d3ee','#fb923c','#fb7185']
type Room = { frame: { x: number; y: number; zoom: number; locked: boolean }; likes: Like[]; likeCount: number; locked: boolean; muteAll: boolean; voices: Voice[]; id: string; salt: string; code: Buffer; created: number; members: Map<string, Member>; url: string; position: number; playing: boolean; updated: number; messages: { id: string; name: string; text: string; memberId: string; sentAt: number; color: string }[] }
const rooms = new Map<string, Room>()
const attempts = new Map<string, { count: number; until: number }>()
const token = () => randomBytes(24).toString('hex')
const position = (r: Room) => r.position + (r.playing ? (Date.now() - r.updated) / 1000 : 0)
function reply(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data))
}
function mediaUrl(value: unknown) {
  if (typeof value !== 'string') throw new Error('Enter a video link.')
  return watchMedia(value).url
}
function snapshot(r: Room, member: Member) {
  return { frame: r.frame, likes: r.likes.filter(l => Date.now() - l.sentAt < 6000), likeCount: r.likeCount, locked: r.locked, muteAll: r.muteAll, muted: member.muted || (!member.host && r.muteAll), voices: r.voices.filter(v => Date.now() - v.sentAt < 60000).map(({ data: _data, mime: _mime, ...meta }) => meta), id: r.id, host: member.host, memberId: member.id, url: r.url, position: position(r), playing: r.playing, members: [...r.members.values()].filter(m => Date.now() - m.seen < 15000).map(m => ({ id: m.id, name: m.name, color: m.color, host: m.host, muted: m.muted || (!m.host && r.muteAll) })), messages: r.messages }
}
export function watchTogether(): Plugin {
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/watch/')) return next()
    try {
      const origin = req.headers.origin
      if (!origin || new URL(origin).host !== req.headers.host || req.headers['x-ostra-watch'] !== '1' || req.method !== 'POST') { reply(res, 403, { error: 'Same-origin requests only.' }); return }
      const now = Date.now()
      for (const [id, room] of rooms) {
        const host = [...room.members.values()].find(m => m.host)
        if (now - room.created > 12 * 3600000 || !host || now - host.seen > 120000) rooms.delete(id)
      }
      for (const [key, value] of attempts) if (value.until < now) attempts.delete(key)
      const action = req.url.slice('/api/watch/'.length)
      req.setEncoding('utf8'); let raw = ''
      for await (const chunk of req) { raw += chunk; if (raw.length > (action === 'voice' ? 360000 : 8000)) throw new Error('Request too large.') }
      const body = JSON.parse(raw) as Record<string, unknown>
      if (action === 'create' || action === 'join') {
        const ip = req.socket.remoteAddress ?? 'unknown'
        const limit = attempts.get(ip) ?? { count: 0, until: now + 60000 }
        attempts.set(ip, limit)
        if (++limit.count > 12) { reply(res, 429, { error: 'Too many attempts. Wait a minute.' }); return }
        let name = typeof body.name === 'string' ? body.name.trim().slice(0, 32) : ''
        if (body.guest !== false) name = ''
        if (typeof body.code !== 'string' || body.code.length < 6 || body.code.length > 64) throw new Error('Use a room code between 6 and 64 characters.')
        let room: Room
        if (action === 'create') {
          if (rooms.size >= 50) throw new Error('The server is full. Try later.')
          const url = mediaUrl(body.url)
          const salt = token()
          room = { frame: { x: 0, y: 0, zoom: 1, locked: false }, likes: [], likeCount: 0, locked: false, muteAll: false, voices: [], id: randomBytes(12).toString('hex'), salt, code: scryptSync(body.code, salt, 32), created: now, members: new Map(), url, position: 0, playing: false, updated: now, messages: [] }
          rooms.set(room.id, room)
        } else {
          const found = rooms.get(String(body.room))
          if (!found || !timingSafeEqual(found.code, scryptSync(body.code, found.salt, 32))) throw new Error('The room or code is incorrect, or the room has closed.')
          room = found
          if (room.locked) throw new Error('The host has locked this room.')
          for (const [key, m] of room.members) if (!m.host && now - m.seen > 120000) room.members.delete(key)
          if (room.members.size >= 8) throw new Error('This room is full (8 people maximum).')
        }
        if (!name) { const used = new Set([...room.members.values()].map(m => m.name)); name = Array.from({ length: 8 }, (_, i) => `Guest${i + 1}`).find(n => !used.has(n)) ?? 'Guest8' }
        const key = token(); const member = { id: token(), name, host: action === 'create', seen: now, lastMessage: 0, lastVoice: 0, muted: false, color: memberColors.find(c => ![...room.members.values()].some(m => m.color === c)) ?? memberColors[0], lastLike: 0 }
        room.members.set(key, member)
        reply(res, 200, { token: key, state: snapshot(room, member) }); return
      }
      const room = rooms.get(String(body.room))
      const member = room?.members.get(String(req.headers.authorization?.replace(/^Bearer /, '')))
      if (!room || !member) { reply(res, 404, { error: 'This room has closed. Create or join another room.' }); return }
      member.seen = now
      room.voices = room.voices.filter(v => now - v.sentAt < 60000)
      room.likes = room.likes.filter(l => now - l.sentAt < 6000)
      if (action === 'frame') {
        if (!member.host) { reply(res, 403, { error: 'Only the host controls playback.' }); return }
        if (body.url !== room.url || watchMedia(room.url).kind !== 'external') throw new Error('Invalid frame source.')
        const f = body.frame as Room['frame'] | undefined
        if (!f || !Number.isFinite(f.x) || !Number.isFinite(f.y) || !Number.isFinite(f.zoom) || f.x > 0 || f.x < -2400 || f.y > 0 || f.y < -3000 || f.zoom < .4 || f.zoom > 1.5 || typeof f.locked !== 'boolean') throw new Error('Invalid frame position.')
        room.frame = { x: f.x, y: f.y, zoom: f.zoom, locked: f.locked }
      } else if (action === 'control') {
        if (!member.host) { reply(res, 403, { error: 'Only the host controls playback.' }); return }
        if (typeof body.position !== 'number' || !Number.isFinite(body.position) || body.position < 0 || body.position > 604800 || typeof body.playing !== 'boolean') throw new Error('Invalid playback state.')
        if (body.url !== undefined && body.url !== room.url) { room.url = mediaUrl(body.url); room.frame = { x: 0, y: 0, zoom: 1, locked: false }; room.position = 0; room.playing = false }
        else { room.position = body.position; room.playing = body.playing }
        room.updated = now
      } else if (action === 'like') {
        if (now - member.lastLike >= 300) {
          member.lastLike = now; room.likeCount++
          room.likes.push({ id: token(), memberId: member.id, color: member.color, sentAt: now }); room.likes = room.likes.slice(-80)
        }
      } else if (action === 'admin') {
        if (!member.host) { reply(res, 403, { error: 'Only the host can manage participants.' }); return }
        if (body.operation === 'lock') room.locked = Boolean(body.value)
        else if (body.operation === 'mute-all') { room.muteAll = Boolean(body.value); if (room.muteAll) room.voices = [] }
        else {
          const target = [...room.members.entries()].find(([, m]) => m.id === body.memberId)
          if (!target || target[1].host) throw new Error('Participant not found.')
          if (body.operation === 'mute') target[1].muted = Boolean(body.value)
          else if (body.operation === 'remove') room.members.delete(target[0])
          else throw new Error('Unknown moderation action.')
          room.voices = room.voices.filter(v => v.memberId !== target[1].id)
        }
      } else if (action === 'voice') {
        if (member.muted || (!member.host && room.muteAll)) throw new Error('The host has muted your microphone.')
        if (now - member.lastVoice < 6000) throw new Error('Wait a moment before another voice reaction.')
        if (typeof body.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.data) || body.data.length > 350000 || !['audio/webm','audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].includes(String(body.mime))) throw new Error('Invalid voice recording.')
        if (Buffer.from(body.data, 'base64').length > 262144) throw new Error('Voice recording is too large.')
        member.lastVoice = now
        room.voices.push({ id: token(), memberId: member.id, name: member.name, sentAt: now, mime: String(body.mime), data: body.data }); room.voices = room.voices.slice(-24)
      } else if (action === 'voice-get') {
        const voice = room.voices.find(v => v.id === body.id)
        if (!voice) throw new Error('This voice reaction has expired.')
        reply(res, 200, { data: voice.data, mime: voice.mime }); return
      } else if (action === 'message') {
        if (now - member.lastMessage < 750) throw new Error('Please wait before sending another message.')
        const text = typeof body.text === 'string' ? body.text.trim().slice(0, 1000) : ''
        if (!text) throw new Error('Write a message first.')
        if (room.messages.length >= 10000) throw new Error('Room history is full. Start a new room to keep chatting.')
        member.lastMessage = now
        room.messages.push({ id: token(), name: member.name, text, memberId: member.id, sentAt: now, color: member.color })
      } else if (action === 'leave') {
        if (member.host) rooms.delete(room.id)
        else room.members.delete(String(req.headers.authorization?.replace(/^Bearer /, '')))
        reply(res, 200, { left: true }); return
      } else if (action !== 'state') throw new Error('Unknown room action.')
      reply(res, 200, snapshot(room, member))
    } catch (error) { reply(res, 400, { error: error instanceof Error ? error.message : 'Room request failed.' }) }
  }
  return { name: 'ostra-watch-together', configureServer(server) { server.middlewares.use((req, res, next) => { void middleware(req, res, next) }) }, configurePreviewServer(server) { server.middlewares.use((req, res, next) => { void middleware(req, res, next) }) } }
}
