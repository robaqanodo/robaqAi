import { useEffect, useRef, useState } from 'react'

type SignalData = { type: 'offer' | 'answer' | 'candidate'; sdp?: string; candidate?: RTCIceCandidateInit }
type Peer = { pc: RTCPeerConnection; pending: RTCIceCandidateInit[] }
type Room = { host: boolean; broadcast: string; members: { id: string; host: boolean }[] }
type Transport = (action: string, data: object) => Promise<{ signals?: { from: string; session: string; data: SignalData }[]; iceServers?: RTCIceServer[] }>

export function useBroadcast(room: Room | null, transport: Transport, report: (error: string) => void) {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [sharing, setSharing] = useState(false)
  const [starting, setStarting] = useState(false)
  const local = useRef<MediaStream | null>(null)
  const peers = useRef(new Map<string, Peer>())
  const alive = useRef(true)
  const refs = useRef({ room, transport, report }); refs.current = { room, transport, report }
  function clearPeers() { peers.current.forEach(p => p.pc.close()); peers.current.clear() }
  function release() { local.current?.getTracks().forEach(t => t.stop()); local.current = null; clearPeers() }
  async function stop() {
    release(); setSharing(false); setStream(null)
    try { await refs.current.transport('broadcast', { active: false }) } catch { /* Room may already be closed. */ }
  }
  async function start(target?: HTMLElement | null) {
    if (!navigator.mediaDevices?.getDisplayMedia) { report('Screen sharing is unavailable in this browser. Use a desktop browser.'); return }
    if (starting || local.current) return
    setStarting(true)
    let captured: MediaStream | null = null
    try {
      const cropAPI = (window as unknown as { CropTarget?: { fromElement: (element: HTMLElement) => Promise<unknown> } }).CropTarget
      if (!target || !cropAPI) throw new Error('Player-only sharing requires desktop Chrome or Edge. Use a supported browser as host.')
      captured = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 24 }, audio: true, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude' } as DisplayMediaStreamOptions)
      const track = captured.getVideoTracks()[0] as MediaStreamTrack & { cropTo?: (target: unknown) => Promise<void> }
      if (!track?.cropTo || track.getSettings().displaySurface !== 'browser') throw new Error('Select this robaqAI browser tab. Entire screens and other windows are not shared.')
      // Never attach any track to a peer until cropping has succeeded.
      await track.cropTo(await cropAPI.fromElement(target))
      if (!alive.current) { captured.getTracks().forEach(t => t.stop()); return }
      if (!refs.current.room?.host) { captured.getTracks().forEach(t => t.stop()); return }
      local.current = captured
      captured.getVideoTracks()[0].onended = () => { void stop() }
      await refs.current.transport('broadcast', { active: true })
      if (!alive.current) { release(); return }
      setSharing(true)
      if (!captured.getAudioTracks().length) report('Screen sharing started without audio. To share sound, choose a browser tab with audio sharing enabled.')
    } catch (e) {
      captured?.getTracks().forEach(t => t.stop()); local.current = null
      if (alive.current) report(e instanceof DOMException && e.name === 'NotAllowedError' ? 'Screen sharing was cancelled or denied.' : e instanceof Error ? e.message : 'Could not start screen sharing.')
    } finally { if (alive.current) setStarting(false) }
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; release() } }, [])
  useEffect(() => {
    const session = room?.broadcast
    clearPeers(); setStream(null)
    if (!session) { if (local.current) { release(); setSharing(false) } return }
    let cancelled = false, busy = false
    let iceServers: RTCIceServer[] | undefined
    async function signal(to: string, data: SignalData) { if (!cancelled) await refs.current.transport('signal', { to, data, session }) }
    function peer(id: string) {
      const existing = peers.current.get(id); if (existing) return existing
      const pc = new RTCPeerConnection({ iceServers })
      const item: Peer = { pc, pending: [] }; peers.current.set(id, item)
      pc.onicecandidate = event => { if (event.candidate) void signal(id, { type: 'candidate', candidate: event.candidate.toJSON() }).catch(() => {}) }
      pc.ontrack = event => { if (!cancelled) setStream(event.streams[0] ?? new MediaStream([event.track])) }
      pc.onconnectionstatechange = () => { if (!cancelled && pc.connectionState === 'failed') { refs.current.report('Broadcast connection failed. This network may require a TURN relay.'); pc.close(); peers.current.delete(id) } }
      return item
    }
    async function tick() {
      if (cancelled || busy) return
      busy = true
      try {
        const current = refs.current.room
        if (!current || current.broadcast !== session) return
        if (!iceServers) { const config = await refs.current.transport('ice', {}); if (cancelled) return; iceServers = config.iceServers ?? [] }
        if (current.host && local.current) {
          const guests = current.members.filter(m => !m.host)
          for (const [id, item] of peers.current) if (!guests.some(g => g.id === id)) { item.pc.close(); peers.current.delete(id) }
          for (const guest of guests) {
            if (peers.current.has(guest.id)) continue
            const { pc } = peer(guest.id)
            local.current.getTracks().forEach(track => pc.addTrack(track, local.current!))
            await pc.setLocalDescription(await pc.createOffer())
            await signal(guest.id, { type: 'offer', sdp: pc.localDescription!.sdp })
          }
        }
        const result = await refs.current.transport('signals', {})
        if (cancelled) return
        for (const message of (result.signals ?? []) as { from: string; session: string; data: SignalData }[]) {
          if (message.session !== session) continue
          const item = peer(message.from), data = message.data
          if (data.type === 'candidate') {
            if (!data.candidate) continue
            if (item.pc.remoteDescription) await item.pc.addIceCandidate(data.candidate)
            else item.pending.push(data.candidate)
          } else {
            await item.pc.setRemoteDescription({ type: data.type, sdp: data.sdp })
            for (const candidate of item.pending.splice(0)) await item.pc.addIceCandidate(candidate)
            if (data.type === 'offer') {
              await item.pc.setLocalDescription(await item.pc.createAnswer())
              await signal(message.from, { type: 'answer', sdp: item.pc.localDescription!.sdp })
            }
          }
        }
      } catch { if (!cancelled) refs.current.report('Broadcast connection interrupted. Check your connection.') }
      finally { busy = false }
    }
    void tick(); const timer = setInterval(() => void tick(), 1000)
    return () => { cancelled = true; clearInterval(timer); clearPeers() }
  }, [room?.broadcast])
  useEffect(() => { if (!room) { release(); setSharing(false); setStream(null) } }, [room])
  return { stream, sharing, starting, start, stop }
}
