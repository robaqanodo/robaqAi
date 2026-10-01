import { getSystemPrompt, type ChatTurn, type PendingFile } from './providers'

/** Multimodal Messages API model for browser Claude calls. */
export const CLAUDE_MODEL = 'claude-sonnet-4-5'

type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } }

type ClaudeMessage = {
  role: 'user' | 'assistant'
  content: string | ClaudeContentBlock[]
}

function isImageMime(mime: string): boolean {
  return /^image\/(jpeg|png|gif|webp)$/i.test(mime)
}

function isPdfMime(mime: string, name: string): boolean {
  return mime === 'application/pdf' || /\.pdf$/i.test(name)
}

function buildUserContent(text: string, files: PendingFile[]): string | ClaudeContentBlock[] {
  const blocks: ClaudeContentBlock[] = []
  const textChunks: string[] = []

  for (const f of files) {
    if (f.kind === 'text') {
      textChunks.push(`[Attached file: ${f.name}]\n${f.data}`)
    } else if (isImageMime(f.mimeType)) {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: f.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: f.data,
        },
      })
    } else if (isPdfMime(f.mimeType, f.name)) {
      blocks.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: f.data,
        },
      })
    } else {
      textChunks.push(
        `[Attached file: ${f.name} (${f.mimeType || 'binary'}) — binary attach not supported for this type; paste text if needed.]`,
      )
    }
  }

  const trimmed = text.trim()
  if (trimmed) textChunks.unshift(trimmed)
  else if (files.length > 0 && textChunks.length === 0) {
    textChunks.push('Please review the attached file(s).')
  }

  if (blocks.length === 0) {
    return textChunks.join('\n\n') || 'Hello'
  }

  if (textChunks.length) {
    blocks.push({ type: 'text', text: textChunks.join('\n\n') })
  }
  return blocks
}

function historyToClaude(history: ChatTurn[]): ClaudeMessage[] {
  const out: ClaudeMessage[] = []
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
  // Messages API requires first message to be user
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

export async function generateClaudeReply(
  apiKey: string,
  history: ChatTurn[],
  userText: string,
  files: PendingFile[],
): Promise<string> {
  const messages: ClaudeMessage[] = [
    ...historyToClaude(history),
    { role: 'user', content: buildUserContent(userText, files) },
  ]

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey.trim(),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: getSystemPrompt(),
      messages,
    }),
  })

  const rawText = await res.text()
  let data: {
    error?: { message?: string; type?: string }
    content?: Array<{ type?: string; text?: string }>
  } = {}
  try {
    data = JSON.parse(rawText) as typeof data
  } catch {
    /* non-JSON */
  }

  if (!res.ok) {
    const msg = data.error?.message || rawText.slice(0, 280) || `HTTP ${res.status}`
    throw new Error(msg)
  }

  const text = (data.content ?? [])
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('\n')
    .trim()
  if (!text) throw new Error('Empty response from API')
  return text
}
