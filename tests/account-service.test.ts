import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ data: new Map<string,string>(), commands: [] as unknown[][] }))
vi.mock('../server/redis.ts', async importOriginal => ({
  ...await importOriginal<object>(), limit: async () => true,
  redis: async (...args: unknown[]) => {
    state.commands.push(args)
    const [cmd,key,value,...rest] = args as string[]
    if(cmd==='GET')return state.data.get(key)??null
    if(cmd==='SET'){if(rest.includes('NX')&&state.data.has(key))return null;state.data.set(key,value);return 'OK'}
    if(cmd==='DEL'){for(const k of args.slice(1))state.data.delete(String(k));return 1}
    if(cmd==='EVAL'){
      const count=Number(args[2]), keys=args.slice(3,3+count).map(String), params=args.slice(3+count).map(String)
      const old=state.data.get(keys[0]);const matches=old&&JSON.parse(old).generation===params[0]
      if(key.includes("redis.call('DEL',KEYS[2])")){if(matches)state.data.delete(keys[0]);state.data.delete(keys[1]);return 1}
      if(!matches)return 0;state.data.set(keys[0],params[1]);return 1
    }
    throw Error('Unexpected command')
  }
}))
import handler from '../api/account'
async function call(action:string, data:object={},cookie=''){
  const req={method:'POST',headers:{origin:'https://robaq.app',host:'robaq.app',cookie},body:{action,...data}}
  const res={status:0,body:'',cookie:'',writeHead(n:number){this.status=n},end(s:string){this.body=s},setHeader(_k:string,v:string){this.cookie=v}}
  await handler(req as never,res as never)
  return {status:res.status,body:JSON.parse(res.body),cookie:res.cookie.split(';')[0]}
}
const credentials={email:'test@example.com',password:'correct-test-password'}
beforeEach(()=>{state.data.clear();state.commands=[]})
it('stores accounts without expiry and passwords only as salted hashes',async()=>{
  const result=await call('register',credentials)
  expect(result.status).toBe(200)
  const command=state.commands.find(c=>c[0]==='SET'&&String(c[1]).startsWith('robaq:account:'))!
  expect(command.slice(3)).toEqual(['NX'])
  const account=JSON.parse(String(command[2]))
  expect(account.hash).not.toBe(credentials.password);expect(account.salt).toBeTruthy()
  expect(JSON.stringify(result.body)).not.toContain(account.hash)
  expect((await call('register',credentials)).status).toBe(409)
  expect((await call('login',{...credentials,password:'wrong-password'})).status).toBe(401)
})
it('logout and session expiry preserve accounts, permitting a later login',async()=>{
  const registered=await call('register',credentials)
  expect((await call('logout',{},registered.cookie)).status).toBe(200)
  expect((await call('me',{},registered.cookie)).status).toBe(401)
  const login=await call('login',{...credentials,remember:true})
  expect(login.status).toBe(200)
  for(const key of state.data.keys())if(key.startsWith('robaq:login:'))state.data.delete(key)
  expect((await call('login',credentials)).status).toBe(200)
  expect([...state.data.keys()].filter(k=>k.startsWith('robaq:account:'))).toHaveLength(1)
})
it('delete needs authentication and revokes all sessions even after re-registration',async()=>{
  const first=await call('register',credentials),second=await call('login',credentials)
  expect((await call('delete')).status).toBe(401)
  expect((await call('delete',{},first.cookie)).status).toBe(200)
  expect((await call('me',{},second.cookie)).status).toBe(401)
  expect((await call('login',credentials)).status).toBe(404)
  expect((await call('register',credentials)).status).toBe(200)
  expect((await call('profile',{firstName:'stale'},second.cookie)).status).toBe(401)
})
