import { GoogleGenerativeAI, type Part } from '@google/generative-ai'
import { getSystemPrompt, type ChatTurn, type PendingFile } from './providers'

/** Stable multimodal model for browser Gemini calls. */
export const GEMINI_MODEL = 'gemini-3.8-flash'

function historyToGemini(
  history: ChatTurn[],
): { role: 'user' | 'model'; parts: Part[] }[] {
  const out: { role: 'user' | 'model'; parts: Part[] }[] = []
  for (const turn of history) {
    const role = turn.role === 'user' ? 'user' : 'model'
    const text = turn.text.trim()
    if (!text) continue
    const last = out[out.length - 1]
    if (last && last.role === role) {
      const prev = last.parts[0]
      if (prev && 'text' in prev && typeof prev.text === 'string') {
        last.parts[0] = { text: `${prev.text}\n\n${text}` }
      } else {
        last.parts.push({ text })
      }
    } else {
      out.push({ role, parts: [{ text }] })
    }
  }
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

function buildUserParts(text: string, files: PendingFile[]): Part[] {
  const parts: Part[] = []
  for (const f of files) {
    if (f.kind === 'text') {
      parts.push({
        text: `[Attached file: ${f.name}]\n${f.data}`,
      })
    } else {
      parts.push({
        inlineData: {
          mimeType: f.mimeType || 'application/octet-stream',
          data: f.data,
        },
      })
    }
  }
  const trimmed = text.trim()
  if (trimmed) {
    parts.push({ text: trimmed })
  } else if (files.length > 0) {
    parts.push({ text: 'Please review the attached file(s).' })
  }
  return parts
}

/**
 * Call Gemini generateContent with prior turns + the new user message/files.
 * Returns the full assistant text (caller may typewriter it).
 */
export async function generateGeminiReply(
  apiKey: string,
  history: ChatTurn[],
  userText: string,
  files: PendingFile[],
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey.trim())
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: getSystemPrompt(),
  })

  const prior = historyToGemini(history)
  const chat = model.startChat({ history: prior })
  const parts = buildUserParts(userText, files)
  const result = await chat.sendMessage(parts)
  const text = result.response.text()?.trim()
  if (!text) {
    throw new Error('Empty response from API')
  }
  return text
}
