import { randomBytes, createCipheriv, createDecipheriv, scrypt as derive, createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { bodyOf, respond, sameOrigin, redis, type ApiRequest } from './redis.ts'
import type { ServerResponse } from 'node:http'
const scrypt = promisify(derive)
const MONTH = 30 * 86400
export type Secret = { questions: string[]; salt: string; iv: string; tag: string; ciphertext: string; expiresAt: number; openedAt?: number }
export interface SecretStore {
  put(code: string, record: Secret): Promise<void>
  get(code: string): Promise<Secret | null>
  open(code: string): Promise<Secret | null>
  attempt(key: string, maximum: number, seconds: number): Promise<boolean>
}
export const secretStore: SecretStore = {
  async put(code, value) { await redis('SET', `robaq:kas:${code}`, JSON.stringify(value), 'EX', MONTH) },
  async get(code) { const raw = await redis<string | null>('GET', `robaq:kas:${code}`); return raw ? JSON.parse(raw) : null },
  async open(code) {
    const raw = await redis<string | null>('EVAL', `local raw=redis.call('GET',KEYS[1]); if not raw then return nil end; local r=cjson.decode(raw); local now=tonumber(ARGV[1]); if r.expiresAt<=now then redis.call('DEL',KEYS[1]); return nil end; if not r.openedAt then r.openedAt=now; r.expiresAt=math.min(r.expiresAt,now+3600000); raw=cjson.encode(r); redis.call('SET',KEYS[1],raw,'PX',r.expiresAt-now) end; return raw`, 1, `robaq:kas:${code}`, Date.now())
    return raw ? JSON.parse(raw) : null
  },
  async attempt(key, max, seconds) { return await redis<number>('EVAL', "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n", 1, `robaq:kas-limit:${key}`, seconds) <= max },
}
export function memorySecretStore(): SecretStore {
  const records = new Map<string, Secret>(), limits = new Map<string, {count:number;until:number}>()
  return {
    async put(code, record) { records.set(code,record); const timer=setTimeout(()=>records.delete(code),MONTH*1000); timer.unref() },
    async get(code) { const r=records.get(code); if (!r || r.expiresAt<=Date.now()) {records.delete(code);return null} return r },
    async open(code) { const r=await this.get(code); if(r&&!r.openedAt){r.openedAt=Date.now();r.expiresAt=Math.min(r.expiresAt,r.openedAt+3600000);const timer=setTimeout(()=>records.delete(code),r.expiresAt-Date.now());timer.unref()}return r },
    async attempt(key,max,seconds){const now=Date.now();let r=limits.get(key);if(!r||r.until<=now){r={count:0,until:now+seconds*1000};limits.set(key,r)}return ++r.count<=max},
  }
}
function pair(value: unknown) {
  if(!Array.isArray(value)||value.length!==2||value.some(v=>typeof v!=='string'||!v.trim()||v.length>300))throw Error('Enter two questions and two answers.')
  return value.map(v=>(v as string).normalize('NFKC').trim())
}
export function kasHandler(store: SecretStore = secretStore) {
 return async(req:ApiRequest,res:ServerResponse)=>{
  if(!sameOrigin(req)){respond(res,403,{error:'Same-origin requests only.'});return}
  try{
   const body=await bodyOf(req,70000)
   const ip=createHash('sha256').update(String(req.headers['x-forwarded-for']??req.socket?.remoteAddress??'local').split(',')[0]).digest('hex')
   if(!await store.attempt(ip,60,600)){respond(res,429,{error:'Too many attempts. Try again in 10 minutes.'});return}
   if(body.action==='create'){
    if(!await store.attempt(`create:${ip}`,10,3600)){respond(res,429,{error:'Too many secrets. Try again later.'});return}
    if(typeof body.text!=='string'||!body.text.trim()||body.text.length>20000)throw Error('Enter a secret of up to 20,000 characters.')
    const questions=pair(body.questions), answers=pair(body.answers)
    const salt=randomBytes(16),iv=randomBytes(12),key=await scrypt(JSON.stringify(answers),salt,32) as Buffer
    const cipher=createCipheriv('aes-256-gcm',key,iv)
    const ciphertext=Buffer.concat([cipher.update(body.text,'utf8'),cipher.final()]);key.fill(0)
    const code='KAS-'+randomBytes(24).toString('hex').toUpperCase()
    await store.put(code,{questions,salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64'),expiresAt:Date.now()+MONTH*1000})
    respond(res,200,{code});return
   }
   const code=String(body.code??'').trim().toUpperCase()
   if(!/^KAS-[A-F0-9]{48}$/.test(code))throw Error('Invalid KAS code.')
   const record=await store.get(code)
   if(!record||record.expiresAt<=Date.now()){respond(res,404,{error:'This secret has expired or does not exist.'});return}
   if(body.action==='questions'){respond(res,200,{questions:record.questions});return}
   if(body.action!=='unlock')throw Error('Invalid KAS request.')
   if(!await store.attempt(`unlock:${code}`,5,600)){respond(res,429,{error:'Too many attempts. Try again in 10 minutes.'});return}
   const key=await scrypt(JSON.stringify(pair(body.answers)),Buffer.from(record.salt,'base64'),32) as Buffer
   let text:string
   try{const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(record.iv,'base64'));decipher.setAuthTag(Buffer.from(record.tag,'base64'));text=Buffer.concat([decipher.update(Buffer.from(record.ciphertext,'base64')),decipher.final()]).toString('utf8')}
   catch{respond(res,403,{error:'The answers are incorrect.'});return}finally{key.fill(0)}
   const opened=await store.open(code)
   if(!opened){respond(res,404,{error:'This secret has expired or does not exist.'});return}
   respond(res,200,{text,expiresAt:opened.expiresAt,remainingMs:Math.max(0,opened.expiresAt-Date.now())})
  }catch{respond(res,400,{error:'KAS request failed. Check your input and connection.'})}
 }
}
