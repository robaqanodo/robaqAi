const DB_NAME = 'rai-offline-models-v1'
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('files')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function readFile(name: string): Promise<Blob | undefined> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('files', 'readonly')
    const request = transaction.objectStore('files').get(name)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => db.close()
    transaction.onabort = () => db.close()
  })
}
export async function writeFile(name: string, value: Blob): Promise<void> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('files', 'readwrite')
    transaction.objectStore('files').put(value, name)
    transaction.oncomplete = () => { db.close(); resolve() }
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('Unable to save the model. Check available storage.')) }
    transaction.onerror = () => { /* onabort handles failures */ }
  })
}
export async function deleteFile(name: string): Promise<void> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('files', 'readwrite')
    transaction.objectStore('files').delete(name)
    transaction.oncomplete = () => { db.close(); resolve() }
    transaction.onabort = () => { db.close(); reject(transaction.error) }
  })
}
