export type AccountResponse = {
  user: { id: string; email: string; firstName: string; lastName: string }
  keyVault?: { iv: string; data: string } | null
  ok?: boolean
}
export const usesOnlineAccounts = () => location.hostname !== 'localhost' && location.hostname !== '127.0.0.1' && location.protocol === 'https:'
export async function accountRequest(action: string, data: object = {}) {
  const response = await fetch('/api/account', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, action }), signal: AbortSignal.timeout(12000) })
  const result = await response.json().catch(() => ({ error: 'Account service is unavailable. Please try again.' }))
  if (!response.ok) throw Object.assign(new Error(result.error ?? 'Account service is unavailable. Please try again.'), { status: response.status })
  return result as AccountResponse
}
