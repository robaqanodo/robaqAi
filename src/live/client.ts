export type LiveKind='syberlive'|'crossfire'
export type LiveMember={id:string;name:string;host:boolean;side?:'for'|'against'}
export type LiveRoom={id:string;kind:LiveKind;limit:number;motion:string;self:string;host:boolean;token?:string;members:LiveMember[];messages:{id:string;name:string;text:string}[];signals:{from:string;data:{description?:RTCSessionDescriptionInit;candidate?:RTCIceCandidateInit;videoPaused?:boolean}}[];round:null|{speaker:string;side:'for'|'against';start:number;end:number;second:boolean;point?:{id:string;end:number};requests:string[]};now:number}
const configured=import.meta.env.VITE_ROOMS_SERVER_URL as string|undefined
export const roomBase=configured?configured.replace(/\/$/,''):''
export async function roomRequest(action:string,body:object):Promise<LiveRoom>{
 try{const response=await fetch(`${roomBase}/api/rooms/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(8000)});if(!response.headers.get('content-type')?.includes('application/json'))throw Error('Room service is not configured. This room cannot start.');const data=await response.json();if(!response.ok)throw Error(data.error??'Room request failed.');return data}catch(error){if(error instanceof TypeError||(error instanceof DOMException))throw Error('Room service is not configured. This room cannot start.');throw error}
}
export function roomInvite(){const p=new URLSearchParams(location.hash.slice(1));const kind=p.get('live');const room=p.get('room');return (kind==='syberlive'||kind==='crossfire')&&room&&/^[a-f0-9]{48}$/.test(room)?{kind:kind as LiveKind,room}:null}
