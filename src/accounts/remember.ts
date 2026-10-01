import type { Session } from './vault'
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('robaq-device-session', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('session')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function deviceSession(value?: Session | null): Promise<Session | null> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('session', value === undefined ? 'readonly' : 'readwrite')
    const store = tx.objectStore('session')
    const request = value === undefined ? store.get('current') : value === null ? store.delete('current') : store.put(value, 'current')
    let result: Session | null = null
    request.onsuccess = () => { if (value === undefined) result = request.result ?? null }
    tx.oncomplete = () => { db.close(); resolve(result) }
    tx.onabort = () => { db.close(); reject(tx.error) }
  })
}
