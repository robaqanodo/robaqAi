/** Preserve existing preferences when upgrading from Birdoff to Smartass. */
export function migrateBrandPreferences() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('birdoff-')) continue
      const replacement = key.replace(/^birdoff-/, 'ostra-')
      if (localStorage.getItem(replacement) === null) {
        localStorage.setItem(replacement, localStorage.getItem(key)!)
      }
      localStorage.removeItem(key)
    }
  } catch { /* Keep existing data if storage is unavailable or full. */ }
}
