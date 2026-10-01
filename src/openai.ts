import { getSystemPrompt, type ChatTurn, type PendingFile } from './providers'

/** Multimodal chat model for browser OpenAI calls. */
export const OPENAI_MODEL = 'gpt-4o'

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | OpenAIContentPart[]
}

function isImageMime(mime: string): boolean {
  return /^image\//i.test(mime)
}

function buildUserContent(text: string, files: PendingFile[]): string | OpenAIContentPart[] {
  const parts: OpenAIContentPart[] = []
  const textChunks: string[] = []

  for (const f of files) {
    if (f.kind === 'text') {
      textChunks.push(`[Attached file: ${f.name}]\n${f.data}`)
    } else if (isImageMime(f.mimeType)) {
      const mime = f.mimeType || 'image/png'
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${f.data}` },
      })
    } else {
      // PDF / other binary: note in text (Chat Completions vision is image-focused)
      textChunks.push(
        `[Attached file: ${f.name} (${f.mimeType || 'binary'}) — preview as base64 not sent; describe from filename or paste text if needed.]`,
      )
    }
  }

  const trimmed = text.trim()
  if (trimmed) textChunks.unshift(trimmed)
  else if (files.length > 0 && textChunks.length === 0 && parts.length > 0) {
    textChunks.push('Please review the attached file(s).')
  } else if (files.length > 0 && textChunks.length === 0) {
    textChunks.push('Please review the attached file(s).')
  }

  if (parts.length === 0) {
    return textChunks.join('\n\n') || 'Hello'
  }

  if (textChunks.length) {
    parts.unshift({ type: 'text', text: textChunks.join('\n\n') })
  }
  return parts
}

function historyToOpenAI(history: ChatTurn[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = []
  for (const turn of history) {
    const text = turn.text.trim()
    if (!text) continue
    const role = turn.role === 'user' ? 'user' : 'assistant'
    const last = out[out.length - 1]
    if (last && last.role === role && typeof last.content === 'string') {
      last.content = `${last.content}\n\n${text}`
    } else {
      out.push({ role, content: text })
    }
  }
  return out
}

export async function generateOpenAIReply(
  apiKey: string,
  history: ChatTurn[],
  userText: string,
  files: PendingFile[],
): Promise<string> {
  const messages: OpenAIMessage[] = [
    { role: 'system', content: getSystemPrompt() },
    ...historyToOpenAI(history),
    { role: 'user', content: buildUserContent(userText, files) },
  ]

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.7,
    }),
  })

  const rawText = await res.text()
  let data: {
    error?: { message?: string }
    choices?: Array<{ message?: { content?: string | null } }>
  } = {}
  try {
    data = JSON.parse(rawText) as typeof data
  } catch {
    /* non-JSON body */
  }

  if (!res.ok) {
    const msg = data.error?.message || rawText.slice(0, 280) || `HTTP ${res.status}`
    throw new Error(msg)
  }

  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('Empty response from API')
  return text
}
