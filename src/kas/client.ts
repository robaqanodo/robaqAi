export async function kasRequest(body: object, signal?: AbortSignal) {
 const response=await fetch('/api/kas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',signal})
 const data=await response.json()
 if(!response.ok)throw Error(data.error??'KAS request failed.')
 return data as {code?:string;questions?:string[];text?:string;expiresAt?:number;remainingMs?:number}
}
