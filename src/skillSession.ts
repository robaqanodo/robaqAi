// Guest assets live only in this page's memory, never in the account's IndexedDB.
let persistent = false
const files = new Map<string, Map<string, Blob>>()
const preferences = new Map<string, string>()
export const persistentSkills = () => persistent
export function setPersistentSkills(value: boolean) { persistent = value; files.clear(); preferences.clear() }
export function guestFiles(scope: string) {
  let store = files.get(scope)
  if (!store) { store = new Map(); files.set(scope, store) }
  return store
}
export const skillPreferences = {
  removeItem(key:string){if(persistent)localStorage.removeItem(key);else preferences.delete(key)},
  getItem(key: string) { return persistent ? localStorage.getItem(key) : preferences.get(key) ?? null },
  setItem(key: string, value: string) { if (persistent) localStorage.setItem(key, value); else preferences.set(key, value) },
}

export function guestSkillSnapshot() {
  return { models: [...guestFiles('offline')], translations: [...guestFiles('translation')], settings: [...preferences] }
}
