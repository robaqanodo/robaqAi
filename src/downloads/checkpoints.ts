import { persistentSkills, guestFiles } from '../skillSession'
// Resume records share the model database, but never the final-file keys.
const DATABASE='rai-model-partials-v1'
async function db(){return new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(DATABASE,1);r.onupgradeneeded=()=>r.result.createObjectStore('chunks');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
export async function partialChunk(key:string,offset:number,value?:Blob):Promise<Blob|undefined>{
 const id=`${key}:${offset}`
 if(!persistentSkills()){const m=guestFiles('partials');if(value)m.set(id,value);return m.get(id)}
 const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('chunks',value?'readwrite':'readonly'),s=t.objectStore('chunks'),r=value?s.put(value,id):s.get(id);let found:Blob|undefined;r.onsuccess=()=>{if(!value)found=r.result};t.oncomplete=()=>{d.close();resolve(value??found)};t.onabort=()=>{d.close();reject(t.error)}})
}
export async function clearPartial(key:string){
 if(!persistentSkills()){for(const k of guestFiles('partials').keys())if(k.startsWith(key+':'))guestFiles('partials').delete(k);return}
 const d=await db();await new Promise<void>((resolve,reject)=>{const t=d.transaction('chunks','readwrite'),r=t.objectStore('chunks').openCursor(IDBKeyRange.bound(key+':',key+':\uffff'));r.onsuccess=()=>{if(r.result){r.result.delete();r.result.continue()}};t.oncomplete=()=>{d.close();resolve()};t.onabort=()=>{d.close();reject(t.error)}})
}
