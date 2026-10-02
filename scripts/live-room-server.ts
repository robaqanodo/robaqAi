// Owned, memory-only signaling process. Never run this inside a serverless function.
import {createServer} from 'node:http'
import {LiveRooms,liveRoomHandler} from '../server/live-rooms.ts'
const origin=process.env.ROBAQ_APP_ORIGIN
if(!origin)throw Error('Set ROBAQ_APP_ORIGIN to the exact HTTPS app origin.')
const rooms=new LiveRooms(),handler=liveRoomHandler(rooms,origin)
const server=createServer((req,res)=>void handler(req,res,()=>{res.writeHead(404);res.end()}))
const timer=setInterval(()=>rooms.sweep(),5000);timer.unref()
server.listen(Number(process.env.PORT||8790),'127.0.0.1')
for(const event of ['SIGINT','SIGTERM'] as const)process.on(event,()=>{rooms.rooms.clear();clearInterval(timer);server.close(()=>process.exit(0))})
