import { randomBytes, createCipheriv, createDecipheriv, scrypt as derive, createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { bodyOf, respond, sameOrigin, redis, type ApiRequest } from './redis.ts'
import type { ServerResponse } from 'node:http'
const scrypt = promisify(derive)
const MONTH = 30 * 86400
export type Secret = { questions: string[]; firstHash: string; proofKey: string; salt: string; iv: string; tag: string; ciphertext: string; expiresAt: number; openedAt?: number; releaseKey?: string }
export interface SecretStore {
  put(code: string, record: Secret): Promise<void>
  get(code: string): Promise<Secret | null>
  remove(code: string): Promise<void>
  open(code: string, releaseKey: string): Promise<Secret | null>
  attempt(key: string, maximum: number, seconds: number): Promise<boolean>
}
export const secretStore: SecretStore = {
  async put(code, value) { await redis('SET', `robaq:kas:${code}`, JSON.stringify(value), 'EX', MONTH) },
  async get(code) { const raw = await redis<string | null>('GET', `robaq:kas:${code}`); return raw ? JSON.parse(raw) : null },
  async remove(code) { await redis('DEL', `robaq:kas:${code}`) },
  async open(code, releaseKey) {
    const raw = await redis<string | null>('EVAL', `local raw=redis.call('GET',KEYS[1]); if not raw then return nil end; local r=cjson.decode(raw); local now=tonumber(ARGV[1]); if r.expiresAt<=now then redis.call('DEL',KEYS[1]); return nil end; if not r.openedAt then r.openedAt=now; r.releaseKey=ARGV[2]; r.expiresAt=math.min(r.expiresAt,now+600000); raw=cjson.encode(r); redis.call('SET',KEYS[1],raw,'PX',r.expiresAt-now) end; return raw`, 1, `robaq:kas:${code}`, Date.now(), releaseKey)
    return raw ? JSON.parse(raw) : null
  },
  async attempt(key, max, seconds) { return await redis<number>('EVAL', "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n", 1, `robaq:kas-limit:${key}`, seconds) <= max },
}
export function memorySecretStore(): SecretStore {
  const records = new Map<string, Secret>(), limits = new Map<string, {count:number;until:number}>()
  const cleanup=setInterval(()=>{const now=Date.now();for(const [code,r] of records)if(r.expiresAt<=now)records.delete(code);for(const [key,r] of limits)if(r.until<=now)limits.delete(key)},1000);cleanup.unref()
  return {
    async put(code, record) { records.set(code,record);  },
    async get(code) { const r=records.get(code); if (!r || r.expiresAt<=Date.now()) {records.delete(code);return null} return r },
    async remove(code) { records.delete(code) },
    async open(code, releaseKey) { const r=await this.get(code); if(r&&!r.openedAt){r.openedAt=Date.now();r.releaseKey=releaseKey;r.expiresAt=Math.min(r.expiresAt,r.openedAt+600000);const timer=setTimeout(()=>records.delete(code),r.expiresAt-Date.now());timer.unref()}return r },
    async attempt(key,max,seconds){const now=Date.now();let r=limits.get(key);if(!r||r.until<=now){r={count:0,until:now+seconds*1000};limits.set(key,r)}return ++r.count<=max},
  }
}
function pair(value: unknown) {
  if(!Array.isArray(value)||value.length!==2||value.some(v=>typeof v!=='string'||!v.trim()||v.length>300))throw Error('Enter two questions and two answers.')
  return value as string[]
}
function signature(record: Secret, value: string) { return createHmac('sha256',record.proofKey).update(value).digest('hex') }
function equal(a: string, b: string) { const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y) }
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
    const firstHash=(await scrypt(answers[0],Buffer.concat([salt,Buffer.from('first')]),32) as Buffer).toString('hex')
    await store.put(code,{questions,firstHash,proofKey:randomBytes(32).toString('hex'),salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64'),expiresAt:Date.now()+MONTH*1000})
    respond(res,200,{code});return
   }
   const code=String(body.code??'').trim().toUpperCase()
   if(!/^KAS-[A-F0-9]{48}$/.test(code))throw Error('Invalid KAS code.')
   const record=await store.get(code)
   if(!record||record.expiresAt<=Date.now()){respond(res,404,{error:'This secret has expired or does not exist.'});return}
   if(body.action==='questions'){
    if(record.openedAt && record.releaseKey){
     const decipher=createDecipheriv('aes-256-gcm',Buffer.from(record.releaseKey,'base64'),Buffer.from(record.iv,'base64'));decipher.setAuthTag(Buffer.from(record.tag,'base64'))
     const text=Buffer.concat([decipher.update(Buffer.from(record.ciphertext,'base64')),decipher.final()]).toString('utf8')
     respond(res,200,{text,deleteToken:signature(record,`delete:${code}`),expiresAt:record.expiresAt,remainingMs:Math.max(0,record.expiresAt-Date.now())});return
    }
    respond(res,200,{questions:[record.questions[0]]});return
   }
   if(body.action==='delete'){
    if(typeof body.deleteToken!=='string'||!equal(body.deleteToken,signature(record,`delete:${code}`))){respond(res,403,{error:'Invalid deletion token.'});return}
    await store.remove(code);respond(res,200,{deleted:true});return
   }
   if(body.action==='verify'){
    if(!await store.attempt(`verify:${code}`,5,600)){respond(res,429,{error:'Too many attempts. Try again in 10 minutes.'});return}
    if(typeof body.answer!=='string'||body.answer.length>300)throw Error('Invalid answer.')
    const hash=(await scrypt(body.answer,Buffer.concat([Buffer.from(record.salt,'base64'),Buffer.from('first')]),32) as Buffer).toString('hex')
    if(!record.firstHash||!equal(hash,record.firstHash)){respond(res,403,{error:'The answers are incorrect.'});return}
    const expiry=Date.now()+600000;const payload=`${code}:${expiry}`
    respond(res,200,{question:record.questions[1],proof:`${expiry}.${signature(record,payload)}`});return
   }
   if(body.action!=='unlock')throw Error('Invalid KAS request.')
   if(!await store.attempt(`unlock:${code}`,5,600)){respond(res,429,{error:'Too many attempts. Try again in 10 minutes.'});return}
   const [expiry,mac]=String(body.proof??'').split('.')
   if(!mac||Number(expiry)<=Date.now()||!equal(mac,signature(record,`${code}:${expiry}`))){respond(res,403,{error:'Verification expired. Reopen the code and try again.'});return}
   const key=await scrypt(JSON.stringify(pair(body.answers)),Buffer.from(record.salt,'base64'),32) as Buffer
   const releaseKey=key.toString('base64')
   let text:string
   try{const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(record.iv,'base64'));decipher.setAuthTag(Buffer.from(record.tag,'base64'));text=Buffer.concat([decipher.update(Buffer.from(record.ciphertext,'base64')),decipher.final()]).toString('utf8')}
   catch{respond(res,403,{error:'The answers are incorrect.'});return}finally{key.fill(0)}
   const opened=await store.open(code,releaseKey)
   if(!opened){respond(res,404,{error:'This secret has expired or does not exist.'});return}
   respond(res,200,{text,deleteToken:signature(record,`delete:${code}`),expiresAt:opened.expiresAt,remainingMs:Math.max(0,opened.expiresAt-Date.now())})
  }catch{respond(res,400,{error:'KAS request failed. Check your input and connection.'})}
 }
}
