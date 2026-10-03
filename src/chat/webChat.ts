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
    const errors: Record<string, string> = {
      duplicate: 'This question was already sent from this network. Check the previous reply or wait until tomorrow. No new AI request was made.',
      too_long: 'That message is too long.',
      not_configured: 'Chat is not configured on the server. Add the API key and redeploy.',
      key_invalid: 'The server API key is invalid or expired. The site owner needs to replace it.',
      access_denied: 'Google denied access to the chat API. The site owner needs to check API permissions.',
      quota: 'The chat API quota is exhausted. Please try again later.',
      model_unavailable: 'The configured chat models are unavailable.',
      timeout: 'The chat request timed out. Please try again.',
    }
    throw new Error(errors[String(data.error)] ?? 'Chat is unavailable right now.')
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
