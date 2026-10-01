import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const result = []
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) result.push(...await walk(path))
    else if (!path.endsWith('.raipack') && !path.endsWith('/sw.js')) result.push(path)
  }
  return result
}
const files = await walk('dist')
const version = createHash('sha256').update(await readFile('dist/index.html')).digest('hex').slice(0, 12)
const urls = files.map(path => '/' + path.slice(5))
await writeFile('dist/sw.js', `const CACHE = 'rai-shell-${version}';
const FILES = ${JSON.stringify(urls)};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('rai-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
 const url = new URL(event.request.url);
 if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.endsWith('.raipack')) return;
 if (event.request.mode === 'navigate') {
   event.respondWith(fetch(event.request).catch(() => caches.match('/index.html')));
 } else if (FILES.includes(url.pathname)) {
   event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
 }
});
`)
console.log('Offline app shell generated (translation packs stay in device storage).')
