// ─────────────────────────────────────────────────────────────────────────────
// VanFolio — AI Manager (Sprint 4)
// Supports Gemini (primary) + Anthropic Claude (secondary)
// Pattern: invoke AI_GENERATE → main streams AI_STREAM_CHUNK events → AI_STREAM_END
// ─────────────────────────────────────────────────────────────────────────────

import { ipcMain, WebContents } from 'electron'
import { IPC } from '@shared/constants'
import type { AIGenerateRequest } from '@shared/types'
import { getKey } from './securityManager'

// Track active requests: requestId → aborted flag
const cancelledRequests = new Set<string>()

export function initAiManager(): void {
  ipcMain.handle(IPC.AI_GENERATE, async (event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return { error: 'Invalid payload' }
    }
    const req = payload as Partial<AIGenerateRequest>
    if (
      typeof req.requestId !== 'string' ||
      typeof req.prompt !== 'string' ||
      typeof req.provider !== 'string'
    ) {
      return { error: 'Missing required fields' }
    }

    const { requestId, provider } = req

    // Retrieve API key from safeStorage
    let apiKey: string | null = null
    try {
      apiKey = getKey(provider)
    } catch {
      event.sender.send(IPC.AI_STREAM_ERROR, { requestId, error: 'Failed to retrieve API key' })
      return { ok: false }
    }

    if (!apiKey) {
      event.sender.send(IPC.AI_STREAM_ERROR, {
        requestId,
        error: `No API key configured for ${provider}. Go to Settings → AI to add your key.`,
      })
      return { ok: false }
    }

    if (provider === 'gemini') {
      await streamGemini(req as AIGenerateRequest, apiKey, event.sender)
    } else if (provider === 'anthropic') {
      await streamAnthropic(req as AIGenerateRequest, apiKey, event.sender)
    } else {
      event.sender.send(IPC.AI_STREAM_ERROR, {
        requestId,
        error: `Provider "${provider}" is not yet supported.`,
      })
    }

    cancelledRequests.delete(requestId)
    return { ok: true }
  })

  ipcMain.on(IPC.AI_CANCEL, (_event, payload: unknown) => {
    if (payload && typeof payload === 'object' && 'requestId' in payload) {
      cancelledRequests.add((payload as { requestId: string }).requestId)
    }
  })
}

async function streamGemini(
  req: AIGenerateRequest,
  apiKey: string,
  sender: WebContents,
): Promise<void> {
  const { requestId, prompt, contextBefore, contextAfter } = req

  // Lazy-import to avoid loading at app startup
  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

  const fullPrompt = buildPrompt(prompt, contextBefore, contextAfter)

  try {
    const result = await model.generateContentStream(fullPrompt)

    for await (const chunk of result.stream) {
      if (cancelledRequests.has(requestId)) {
        break
      }
      const text = chunk.text()
      if (text) {
        if (!sender.isDestroyed()) {
          sender.send(IPC.AI_STREAM_CHUNK, { text, requestId })
        }
      }
    }

    if (!sender.isDestroyed()) {
      sender.send(IPC.AI_STREAM_END, { requestId })
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    if (!sender.isDestroyed()) {
      sender.send(IPC.AI_STREAM_ERROR, {
        requestId,
        error: formatGeminiError(errorMessage),
      })
    }
  }
}

async function streamAnthropic(
  req: AIGenerateRequest,
  apiKey: string,
  sender: WebContents,
): Promise<void> {
  const { requestId, prompt, contextBefore, contextAfter } = req

  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey })

  const fullPrompt = buildPrompt(prompt, contextBefore, contextAfter)

  try {
    const stream = client.messages.stream({
      model: 'claude-opus-4-5',
      max_tokens: 2048,
      messages: [{ role: 'user', content: fullPrompt }],
    })

    for await (const event of stream) {
      if (cancelledRequests.has(requestId)) break

      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        const text = event.delta.text
        if (text && !sender.isDestroyed()) {
          sender.send(IPC.AI_STREAM_CHUNK, { text, requestId })
        }
      }
    }

    if (!sender.isDestroyed()) {
      sender.send(IPC.AI_STREAM_END, { requestId })
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    if (!sender.isDestroyed()) {
      sender.send(IPC.AI_STREAM_ERROR, {
        requestId,
        error: formatAnthropicError(errorMessage),
      })
    }
  }
}

function formatAnthropicError(raw: string): string {
  if (raw.includes('401') || raw.includes('invalid x-api-key') || raw.includes('authentication')) {
    return 'Anthropic API key is invalid. Please update it in Settings → AI.'
  }
  if (raw.includes('529') || raw.includes('overloaded')) {
    return 'Anthropic API is overloaded. Please try again in a moment.'
  }
  if (raw.includes('rate_limit') || raw.includes('429')) {
    return 'Anthropic rate limit reached. Please wait a moment and try again.'
  }
  return `AI error: ${raw}`
}

function buildPrompt(userPrompt: string, contextBefore: string, contextAfter: string): string {
  const hasContext = contextBefore || contextAfter
  if (!hasContext) {
    return userPrompt
  }

  const parts: string[] = []
  parts.push('You are a professional writing assistant embedded in a Markdown editor.')
  parts.push('Respond with only the generated/modified text. Do not include explanations, markdown fences, or prefixes.')
  parts.push('')

  if (contextBefore) {
    parts.push(`Context before cursor:\n${contextBefore}`)
  }
  if (contextAfter) {
    parts.push(`Context after cursor:\n${contextAfter}`)
  }

  parts.push('')
  parts.push(`Task: ${userPrompt}`)

  return parts.join('\n')
}

function formatGeminiError(raw: string): string {
  if (raw.includes('API_KEY_INVALID') || raw.includes('API key not valid')) {
    return 'API key is invalid. Please update it in Settings → AI.'
  }
  if (raw.includes('quota') || raw.includes('RESOURCE_EXHAUSTED')) {
    return 'API quota exceeded. Please check your Gemini quota.'
  }
  if (raw.includes('PERMISSION_DENIED')) {
    return 'API key does not have permission. Check your Gemini API settings.'
  }
  return `AI error: ${raw}`
}
