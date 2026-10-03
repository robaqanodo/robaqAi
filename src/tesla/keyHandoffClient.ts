const known = new Set([
  'This code has expired.',
  'This code was already used.',
  'Enter a valid API key.',
  'Could not start a phone link. Try again.',
  'Phone link is not configured on this server.',
  'Too many codes. Wait a few minutes.',
  'Too many attempts. Wait a few minutes.',
  'Same-origin requests only.',
])

export async function handoffRequest(body: object) {
  const response = await fetch('/api/key-handoff', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const result = await response.json().catch(() => ({ error: 'Could not start a phone link. Try again.' })) as { error?: string }
  if (!response.ok) throw new Error(result.error && known.has(result.error) ? result.error : 'Could not start a phone link. Try again.')
  return result as { code?: string; claim?: string; expiresAt?: number; status?: string; apiKey?: string; provider?: string; ok?: boolean }
}
