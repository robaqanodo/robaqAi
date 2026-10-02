import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto'
import type {IncomingMessage,ServerResponse} from 'node:http'
import type {Plugin} from 'vite'
type Side='for'|'against'
type Member={id:string;token:string;name:string;side?:Side;host:boolean;seen:number}
type Signal={from:string;to:string;data:unknown;at:number}
type Round={side:Side;speaker:string;start:number;end:number;second:boolean;point?:{id:string;end:number};requests:string[]}
type Room={id:string;kind:'syberlive'|'crossfire';limit:number;motion:string;password?:Buffer;salt:string;members:Map<string,Member>;signals:Signal[];messages:{id:string;name:string;text:string}[];round?:Round;last:Partial<Record<Side,string>>;created:number}
const token=()=>randomBytes(24).toString('hex')
function fail(message:string):never{throw Error(message)}
export class LiveRooms {
 rooms=new Map<string,Room>()
 private attempts=new Map<string,{count:number;until:number}>()
 private now:()=>number;private random:()=>number
 constructor(now=()=>Date.now(),random=()=>Math.random()){this.now=now;this.random=random}
 sweep(){const now=this.now();for(const [id,r] of this.rooms){const host=[...r.members.values()].find(m=>m.host);if(!host||now-host.seen>20000||now-r.created>6*3600000){this.rooms.delete(id);continue}for(const [mid,m] of r.members)if(now-m.seen>20000)r.members.delete(mid);r.signals=r.signals.filter(s=>now-s.at<15000);this.tick(r)}for(const [id,a] of this.attempts)if(a.until<now)this.attempts.delete(id)}
 private choose(r:Room,side:Side,second:boolean){let candidates=[...r.members.values()].filter(m=>m.side===side);if(candidates.length>1)candidates=candidates.filter(m=>m.id!==r.last[side]);if(!candidates.length){r.round=undefined;return}const m=candidates[Math.floor(this.random()*candidates.length)];r.last[side]=m.id;r.round={side,speaker:m.id,start:this.now(),end:this.now()+60000,second,requests:[]}}
 private tick(r:Room){const round=r.round;if(!round)return;if(round.point&&round.point.end<=this.now())round.point=undefined;if(!r.members.has(round.speaker)||round.end<=this.now()){if(!round.second)this.choose(r,round.side==='for'?'against':'for',true);else r.round=undefined}}
 private snapshot(r:Room,m:Member,drain=false){this.tick(r);const signals=drain?r.signals.filter(s=>s.to===m.id):[];if(drain)r.signals=r.signals.filter(s=>s.to!==m.id);return {id:r.id,kind:r.kind,limit:r.limit,motion:r.motion,self:m.id,host:m.host,members:[...r.members.values()].map(({token:_token,seen:_seen,...v})=>v),messages:r.messages,signals,round:r.round??null,now:this.now()}}
 act(action:string,b:Record<string,unknown>,address='local'){
  this.sweep();const now=this.now();let rate=this.attempts.get(address);if(!rate||rate.until<now){rate={count:0,until:now+60000};this.attempts.set(address,rate)}if(++rate.count>1200)fail('Too many requests. Please wait.')
  if(action==='health')return {ready:true}
  if(action==='create'||action==='join'){const key=`${address}:${action}`;let entry=this.attempts.get(key);if(!entry||entry.until<now){entry={count:0,until:now+60000};this.attempts.set(key,entry)}if(++entry.count>20)fail('Too many requests. Please wait.')}
  const name=(v:unknown)=>typeof v==='string'?v.trim().slice(0,48):''
  if(action==='create'){
   if(this.rooms.size>=100)fail('Room service is busy. Try again later.')
   if(b.kind!=='syberlive'&&b.kind!=='crossfire')fail('Invalid skill.')
   const kind=b.kind,limit=kind==='crossfire'?9:Number(b.limit)
   if(!Number.isInteger(limit)||limit<2||limit>(kind==='crossfire'?9:4))fail('Choose 2, 3 or 4 people.')
   const motion=typeof b.motion==='string'?b.motion.trim():'';if(kind==='crossfire'&&(!motion||motion.length>300))fail('Enter a motion of up to 300 characters.')
   const password=typeof b.password==='string'?b.password:'';if(password.length>128)fail('Password is too long.')
   const salt=token(),m:Member={id:token(),token:token(),name:name(b.name)||'Host',host:true,seen:now}
   const r:Room={id:token(),kind,limit,motion,password:password?scryptSync(password,salt,32):undefined,salt,members:new Map([[m.id,m]]),signals:[],messages:[],last:{},created:now};this.rooms.set(r.id,r)
   return {...this.snapshot(r,m),token:m.token}
  }
  const r=this.rooms.get(String(b.room));if(!r)fail('This room has ended or does not exist.')
  if(action==='join'){
   if(r.members.size>=r.limit)fail('The room is full.')
   if(r.password&&!timingSafeEqual(r.password,scryptSync(String(b.password??'').slice(0,128),r.salt,32)))fail('Incorrect room password.')
   if(r.kind==='crossfire'&&b.side!=='for'&&b.side!=='against')fail('Choose For or Against.')
   const m:Member={id:token(),token:token(),name:name(b.name)||`Guest${r.members.size}`,side:r.kind==='crossfire'?b.side as Side:undefined,host:false,seen:now};r.members.set(m.id,m);return {...this.snapshot(r,m),token:m.token}
  }
  const m=[...r.members.values()].find(m=>m.token===b.token);if(!m)fail('This room session has ended.');m.seen=now
  if(action==='leave'||action==='end'){if(action==='end'&&!m.host)fail('Only the host can do that.');if(m.host){this.rooms.delete(r.id);return {ended:true}}r.members.delete(m.id);r.signals=r.signals.filter(s=>s.from!==m.id&&s.to!==m.id);if(!r.members.size)this.rooms.delete(r.id);return {ended:true}}
  if(action==='signal'){
   if(!r.members.has(String(b.to))||b.to===m.id)fail('Invalid peer.')
   if(!b.data||typeof b.data!=='object')fail('Invalid request.');
   if(JSON.stringify(b.data).length>24000)fail('Signal is too large.')
   if(r.signals.length>2000)fail('Room service is busy. Try again later.')
   r.signals.push({from:m.id,to:String(b.to),data:b.data,at:now})
  }else if(action==='message'){
   const text=typeof b.text==='string'?b.text.trim():'';if(!text||text.length>2000)fail('Enter a message of up to 2,000 characters.')
   r.messages.push({id:token(),name:m.name,text});r.messages=r.messages.slice(-150)
  }else if(action==='ask'||action==='skip'||action==='cut'||action==='stop-round'){
   if(r.kind!=='crossfire'||!m.host)fail('Only the host can do that.')
   if(action==='ask'){if(r.round)fail('A round is already running.');if(!['for','against'].every(side=>[...r.members.values()].some(m=>m.side===side)))fail('Both sides need a participant.');this.choose(r,this.random()<.5?'for':'against',false)}
   else if(action==='skip'&&r.round)this.choose(r,r.round.side==='for'?'against':'for',true)
   else r.round=undefined
  }else if(action==='point'||action==='allow-point'){
   const q=r.round;if(!q||now-q.start<10000||q.end-now<=10000||q.point)fail('Points are allowed only during the middle 40 seconds.')
   if(action==='point'){if(m.host||m.id===q.speaker)fail('Only another guest can request a Point.');if(!q.requests.includes(m.id))q.requests.push(m.id)}
   else {if(!m.host&&m.id!==q.speaker)fail('Only the host or speaker can allow a Point.');const target=String(b.member);if(!q.requests.includes(target)||!r.members.has(target))fail('Point request is unavailable.');q.point={id:target,end:Math.min(now+15000,q.end-10000)};q.requests=[]}
  }else if(action!=='poll')fail('Invalid room action.')
  return this.snapshot(r,m,action==='poll')
 }
}
export function liveRoomHandler(service=new LiveRooms(),allowedOrigin?:string){
 return async(req:IncomingMessage,res:ServerResponse,next:()=>void)=>{
  if(!req.url?.startsWith('/api/rooms/'))return next()
  const origin=req.headers.origin;let allowed=false;try{allowed=Boolean(origin&&(allowedOrigin?origin===allowedOrigin:new URL(origin).host===req.headers.host))}catch{/* Invalid origins are rejected below. */}
  if(allowed){res.setHeader('Access-Control-Allow-Origin',origin!);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS')}
  if(req.method==='OPTIONS'){res.writeHead(allowed?204:403);res.end();return}
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json')
  try{if(!allowed||req.method!=='POST')fail('Same-origin requests only.');let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>30000)fail('Request is too large.')}const body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))fail('Invalid request.');const result=service.act(req.url.split('?')[0].slice('/api/rooms/'.length),body,req.socket.remoteAddress);res.writeHead(200);res.end(JSON.stringify(result))}catch(e){res.writeHead(400);res.end(JSON.stringify({error:e instanceof Error?e.message:'Room request failed.'}))}
 }
}
export function liveRoomsPlugin():Plugin{return {name:'robaq-live-rooms',configureServer(server){const rooms=new LiveRooms(),handler=liveRoomHandler(rooms);const timer=setInterval(()=>rooms.sweep(),5000);timer.unref();server.httpServer?.on('close',()=>clearInterval(timer));server.middlewares.use((req,res,next)=>void handler(req,res,next))}}}
