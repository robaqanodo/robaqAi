import {afterAll,beforeAll,expect,test} from 'vitest'
import {createServer,type Server} from 'node:http'
import {mkdtemp,mkdir,writeFile,open,access,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {desktopAI} from '../server/desktop-ai'
import manifest from '../src/offline/nllb-manifest.json'
let root:string,server:Server,url:string
beforeAll(async()=>{
 root=await mkdtemp(join(tmpdir(),'ostra-model-test-'))
 const folder=join(root,'offline-assets/nllb-200-3.3b');await mkdir(folder,{recursive:true})
 await mkdir(join(root,'offline-assets/translation-env/bin'),{recursive:true})
 await writeFile(join(root,'offline-assets/translation-env/bin/python'),'')
 await writeFile(join(root,'keep.txt'),'unrelated file')
 for(const file of manifest.files){const handle=await open(join(folder,file.name),'w');await handle.truncate(file.size);await handle.close()}
 await writeFile(join(folder,'installed.json'),JSON.stringify({revision:manifest.revision}))
 const plugin=desktopAI()
 ;(plugin.configResolved as Function)({root})
 ;(plugin.configureServer as Function)({middlewares:{use(handler:Function){server=createServer((req,res)=>handler(req,res,()=>{res.statusCode=404;res.end()}))}}})
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 const address=server.address() as {port:number};url=`http://127.0.0.1:${address.port}/api/desktop-ai`
})
afterAll(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));if(root)await rm(root,{recursive:true,force:true})})
test('cross-origin Delete is rejected without removing model files',async()=>{
 const response=await fetch(`${url}/delete`,{method:'POST',headers:{Origin:'https://other.example','X-Ostra-Local':'1'},body:JSON.stringify({model:'nllb-200-3.3b'})})
 expect(response.status).toBe(403)
 expect((await (await fetch(`${url}/status`)).json()).installed).toEqual(['nllb-200-3.3b'])
})
test('Delete removes installation and preserves unrelated files',async()=>{
 const response=await fetch(`${url}/delete`,{method:'POST',headers:{'X-Ostra-Local':'1'},body:JSON.stringify({model:'nllb-200-3.3b'})})
 expect(response.status).toBe(200)
 expect((await (await fetch(`${url}/status`)).json()).installed).toEqual([])
 await expect(access(join(root,'keep.txt'))).resolves.toBeUndefined()
 await expect(access(join(root,'offline-assets/nllb-200-3.3b'))).rejects.toThrow()
})
