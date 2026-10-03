// Run once after deploying, with the server's Redis variables securely provided.
const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
if (!url || !token) throw new Error('Server Redis environment variables are required.')
async function command(...args) {
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error('Redis migration request failed.')
  const result = await response.json()
  if (result.error) throw new Error('Redis rejected the migration command.')
  return result.result
}
let cursor = '0', preserved = 0
 do {
  const page = await command('SCAN', cursor, 'MATCH', 'robaq:answers:v1:*', 'COUNT', 100)
  cursor = String(page[0])
  for (const key of page[1]) {
    // Never persist visitor sets, refresh leases or other session data.
    if (/^robaq:answers:v1:[a-f0-9]{64}$/.test(key)) preserved += Number(await command('PERSIST', key))
  }
} while (cursor !== '0')
console.log(`Removed expiration from ${preserved} answer records.`)
