export type WebSource = { title: string; url: string }

export async function requestWebChat(input: {
  message: string
  locale: string
  history: { role: 'user' | 'assistant'; text: string }[]
  signal?: AbortSignal
}): Promise<{ text: string; sources: WebSource[] }> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: input.message,
      locale: input.locale,
      history: input.history.slice(-8).map(turn => ({ role: turn.role, text: turn.text.slice(0, 4000) })),
    }),
    signal: input.signal,
  })
  let data: { text?: unknown; sources?: unknown; error?: unknown } = {}
  try { data = await response.json() } catch { /* A non-JSON failure is still a short error below. */ }
  if (!response.ok || typeof data.text !== 'string' || !data.text.trim()) {
    throw new Error(data.error === 'too_long' ? 'That message is too long.' : 'Chat is unavailable right now.')
  }
  const sources: WebSource[] = []
  if (Array.isArray(data.sources)) {
    for (const item of data.sources) {
      if (!item || typeof item !== 'object') continue
      const url = (item as { url?: unknown }).url
      const title = (item as { title?: unknown }).title
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) continue
      sources.push({ url, title: typeof title === 'string' && title.trim() ? title : url })
    }
  }
  return { text: data.text.trim(), sources }
}
