import {useEffect,useRef,useState} from 'react'
import {roomRequest,type LiveRoom} from './client'
export function useLiveMedia(room:LiveRoom|null,token:string,local:MediaStream|null,onError:(text:string)=>void){
 const [pausedVideo,setPausedVideo]=useState<Record<string,boolean>>({});const degraded=useRef(new Set<string>())
 const screen=useRef<MediaStream|null>(null),[sharedStream,setSharedStream]=useState<MediaStream|null>(null)
 const alive=useRef(true)
 const peers=useRef(new Map<string,RTCPeerConnection>()),pending=useRef(new Map<string,RTCIceCandidateInit[]>()),failed=useRef(new Set<string>()),timeouts=useRef(new Map<string,ReturnType<typeof setTimeout>>())
 const [streams,setStreams]=useState<Record<string,MediaStream>>({}),current=useRef(room),media=useRef(local);current.current=room;media.current=local
 const callbacks=useRef(onError);callbacks.current=onError
 const chain=useRef(Promise.resolve())
 useEffect(()=>{if(!room)return;const closed=()=>!alive.current||current.current?.id!==room.id
  const send=(to:string,data:object)=>roomRequest('signal',{room:room.id,token,to,data}).catch(e=>{if(!closed())callbacks.current(e.message)})
  const create=(id:string)=>{
   const prior=peers.current.get(id);if(prior)return prior
   const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}],iceTransportPolicy:'all'});peers.current.set(id,pc)
   const tracks=[...(media.current?.getAudioTracks()??[]),...(screen.current?.getVideoTracks()??media.current?.getVideoTracks()??[])];const outgoing=new MediaStream(tracks)
   for(const track of tracks)pc.addTrack(track,outgoing)
   if(!tracks.some(t=>t.kind==='video'))pc.addTransceiver('video',{direction:'sendrecv'})
   if(!tracks.some(t=>t.kind==='audio'))pc.addTransceiver('audio',{direction:'sendrecv'})
   pc.onicecandidate=e=>{if(e.candidate)void send(id,{candidate:e.candidate.toJSON()})}
   pc.ontrack=e=>{if(!closed())setStreams(old=>({...old,[id]:e.streams[0]??new MediaStream([e.track])}))}
   const failure=()=>{if(closed())return;failed.current.add(id);pc.close();peers.current.delete(id);clearTimeout(timeouts.current.get(id));setStreams(old=>{const next={...old};delete next[id];return next});callbacks.current('The networks could not reach each other directly. No relay is used.')}
   pc.onconnectionstatechange=()=>{if(pc.connectionState==='connected')clearTimeout(timeouts.current.get(id));if(pc.connectionState==='failed')failure()}
   timeouts.current.set(id,setTimeout(()=>{if(pc.connectionState!=='connected')failure()},20000));return pc
  }
  chain.current=chain.current.catch(()=>{}).then(async()=>{
   for(const id of peers.current.keys())if(!room.members.some(m=>m.id===id)){peers.current.get(id)?.close();peers.current.delete(id);clearTimeout(timeouts.current.get(id));setStreams(old=>{const next={...old};delete next[id];return next})}
   for(const member of room.members){if(closed())return;if(member.id===room.self||failed.current.has(member.id)||peers.current.has(member.id))continue;const pc=create(member.id);if(room.self<member.id){await pc.setLocalDescription(await pc.createOffer());await send(member.id,{description:pc.localDescription})}}
   for(const signal of room.signals){if(closed()||failed.current.has(signal.from)||!room.members.some(m=>m.id===signal.from))continue;const pc=create(signal.from)
    if(signal.data.videoPaused)setPausedVideo(old=>({...old,[signal.from]:true}))
    if(signal.data.description){await pc.setRemoteDescription(signal.data.description);for(const c of pending.current.get(signal.from)??[])await pc.addIceCandidate(c);pending.current.delete(signal.from);if(signal.data.description.type==='offer'){await pc.setLocalDescription(await pc.createAnswer());await send(signal.from,{description:pc.localDescription})}}
    if(signal.data.candidate){if(pc.remoteDescription)await pc.addIceCandidate(signal.data.candidate);else pending.current.set(signal.from,[...(pending.current.get(signal.from)??[]),signal.data.candidate])}
   }
  }).catch(()=>{if(!closed())callbacks.current('Direct connection failed. Try a different network.')})
 },[room,token])
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;screen.current?.getTracks().forEach(t=>t.stop());screen.current=null;for(const pc of peers.current.values())pc.close();peers.current.clear();for(const timeout of timeouts.current.values())clearTimeout(timeout);timeouts.current.clear();pending.current.clear();failed.current.clear()}},[room?.id])
 useEffect(()=>{if(!room){setSharedStream(null);setStreams({});setPausedVideo({});degraded.current.clear()}},[room?.id])
 // Host microphone authority is applied on the sender and every receiving element.
 useEffect(()=>{if(!local||!room)return;const speaker=room.round?.point?.id??room.round?.speaker;for(const track of local.getAudioTracks())track.enabled=room.kind==='syberlive'||speaker===room.self},[room?.round,room?.self,room?.kind,local])
 useEffect(()=>{if(!room||room.kind!=='crossfire')return;const timer=setInterval(()=>{for(const [id,pc] of peers.current)void pc.getStats().then(stats=>{for(const report of stats.values())if(!degraded.current.has(id)&&report.type==='outbound-rtp'&&report.kind==='video'&&report.qualityLimitationReason==='bandwidth'){degraded.current.add(id);void roomRequest('signal',{room:room.id,token,to:id,data:{videoPaused:true}}).catch(()=>{});for(const sender of pc.getSenders())if(sender.track?.kind==='video'){const p=sender.getParameters();p.encodings=p.encodings.map(e=>({...e,active:false}));void sender.setParameters(p).catch(()=>{});}callbacks.current('Video paused for this connection. Audio and the debate continue.')}}).catch(()=>{})},5000);return()=>clearInterval(timer)},[room?.kind])
 async function shareScreen(){
  const roomId=current.current?.id;if(!current.current?.host)return
  const restore=()=>{screen.current=null;setSharedStream(null);for(const pc of peers.current.values())void pc.getTransceivers().find(t=>t.receiver.track.kind==='video')?.sender.replaceTrack(media.current?.getVideoTracks()[0]??null).catch(()=>{})}
  if(screen.current){screen.current.getTracks().forEach(t=>t.stop());restore();return}
  const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false})
  if(!alive.current||current.current?.id!==roomId){stream.getTracks().forEach(t=>t.stop());return}
  const track=stream.getVideoTracks()[0];screen.current=stream;setSharedStream(stream)
  try{await Promise.all([...peers.current.values()].map(pc=>pc.getTransceivers().find(t=>t.receiver.track.kind==='video')?.sender.replaceTrack(track)))}catch(error){stream.getTracks().forEach(t=>t.stop());restore();throw error}
  track.onended=restore;return stream
 }
 return {streams,shareScreen,pausedVideo,sharedStream}
}
