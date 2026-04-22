// ─────────────────────────────────────────────────────────────────────────────
// AI Palette Module — Sprint 4
// Ctrl+G opens palette → user types prompt (or picks chip) → generate streams
// text into editor at cursor position via typing effect.
// ─────────────────────────────────────────────────────────────────────────────

import { insertAtCursor, getContextAroundCursor } from './editor'
import { showToast } from './toast'
import type { AIStreamChunk, AIStreamEnd, AIStreamError, AIScope } from '@shared/types'

// ── Listener leak guard ───────────────────────────────────────────────────────
let isBound = false

// Active generation state
let activeRequestId: string | null = null
let cleanupChunkListener: (() => void) | null = null
let cleanupEndListener: (() => void) | null = null
let cleanupErrorListener: (() => void) | null = null

// Typing effect state: buffered chunks queued for insertion
let typingQueue: string[] = []
let isTyping = false
let typingTimer: ReturnType<typeof setTimeout> | null = null
const TYPING_INTERVAL_MS = 20

const onKeyDown = (e: KeyboardEvent): void => {
  const palette = document.getElementById('ai-palette')
  if (e.ctrlKey && e.key === 'g') {
    e.preventDefault()
    openPalette()
  }
  if (e.key === 'Escape' && palette?.classList.contains('visible')) {
    cancelGeneration()
    closePalette()
  }
}

export function initAiPalette(): void {
  if (isBound) return
  isBound = true

  const input = document.getElementById('ai-input') as HTMLTextAreaElement | null
  const btnGenerate = document.getElementById('ai-generate') as HTMLButtonElement | null
  const btnCancel = document.getElementById('ai-cancel') as HTMLButtonElement | null
  const btnClose = document.getElementById('ai-close') as HTMLButtonElement | null

  // ai:open dispatched by CM6 high-priority keymap (when editor focused)
  window.addEventListener('ai:open', () => openPalette())
  // document-level: handles Ctrl+G when editor not focused
  document.addEventListener('keydown', onKeyDown)

  btnGenerate?.addEventListener('click', () => {
    const prompt = input?.value.trim() ?? ''
    if (prompt) {
      triggerGenerate(prompt)
    }
  })

  btnCancel?.addEventListener('click', () => {
    cancelGeneration()
  })

  btnClose?.addEventListener('click', () => {
    cancelGeneration()
    closePalette()
  })

  // Enter to submit, Shift+Enter / Ctrl+Enter for newline
  input?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (e.shiftKey || e.ctrlKey) return
      e.preventDefault()
      btnGenerate?.click()
    }
  })

  // Auto-grow textarea
  input?.addEventListener('input', () => {
    if (input) {
      input.style.height = 'auto'
      input.style.height = `${input.scrollHeight}px`
    }
  })

  // Prompt gallery chips
  document.querySelectorAll('.ai-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const prompt = (chip as HTMLElement).dataset.prompt ?? ''
      if (!prompt) return
      if (input) {
        input.value = prompt
        input.style.height = 'auto'
        input.style.height = `${input.scrollHeight}px`
      }
      triggerGenerate(prompt)
    })
  })

  setupDraggable()
}

async function triggerGenerate(prompt: string): Promise<void> {
  if (activeRequestId) return // already generating

  // Derive scope from prompt text
  const scope = deriveScope(prompt)

  // Get context around cursor (500 chars each side)
  const { before, after } = getContextAroundCursor(500)

  // Get current AI provider from settings (fallback to gemini)
  const settings = await window.vanfolioAPI.getSettings()
  const provider = settings.aiProvider ?? 'gemini'

  const requestId = generateId()
  activeRequestId = requestId

  setGeneratingState(true)

  // Register stream listeners — store cleanup refs to avoid leaks
  cleanupChunkListener = window.vanfolioAPI.onAiChunk((chunk: AIStreamChunk) => {
    if (chunk.requestId !== activeRequestId) return
    queueTypingChunk(chunk.text)
  })

  cleanupEndListener = window.vanfolioAPI.onAiEnd((payload: AIStreamEnd) => {
    if (payload.requestId !== activeRequestId) return
    cleanupListeners()
    activeRequestId = null
    setGeneratingState(false)
  })

  cleanupErrorListener = window.vanfolioAPI.onAiError((payload: AIStreamError) => {
    if (payload.requestId !== activeRequestId) return
    cleanupListeners()
    activeRequestId = null
    setGeneratingState(false)
    stopTyping()
    showToast(payload.error, 'error')
  })

  // Kick off generation
  const result = await window.vanfolioAPI.aiGenerate({
    prompt,
    scope,
    contextBefore: before,
    contextAfter: after,
    provider,
    requestId,
  })

  // If invoke itself returned an error (sync failure path)
  if ('error' in result) {
    cleanupListeners()
    activeRequestId = null
    setGeneratingState(false)
    showToast(result.error, 'error')
  }
}

// ── Typing effect ──────────────────────────────────────────────────────────────

function queueTypingChunk(text: string): void {
  // Split text into individual chars for smooth typing
  for (const char of text) {
    typingQueue.push(char)
  }
  if (!isTyping) {
    startTyping()
  }
}

function startTyping(): void {
  isTyping = true
  scheduleNextChar()
}

function scheduleNextChar(): void {
  if (typingQueue.length === 0) {
    isTyping = false
    return
  }
  typingTimer = setTimeout(() => {
    const char = typingQueue.shift()
    if (char !== undefined) {
      insertAtCursor(char)
    }
    scheduleNextChar()
  }, TYPING_INTERVAL_MS)
}

function stopTyping(): void {
  if (typingTimer) {
    clearTimeout(typingTimer)
    typingTimer = null
  }
  typingQueue = []
  isTyping = false
}

// ── Cancel ─────────────────────────────────────────────────────────────────────

function cancelGeneration(): void {
  if (!activeRequestId) return
  window.vanfolioAPI.cancelAiGenerate(activeRequestId)
  cleanupListeners()
  stopTyping()
  activeRequestId = null
  setGeneratingState(false)
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function cleanupListeners(): void {
  cleanupChunkListener?.()
  cleanupEndListener?.()
  cleanupErrorListener?.()
  cleanupChunkListener = null
  cleanupEndListener = null
  cleanupErrorListener = null
}

function setGeneratingState(generating: boolean): void {
  const btnGenerate = document.getElementById('ai-generate') as HTMLButtonElement | null
  const btnCancel = document.getElementById('ai-cancel') as HTMLButtonElement | null
  const chips = document.getElementById('ai-chips')

  if (generating) {
    if (btnGenerate) btnGenerate.style.display = 'none'
    if (btnCancel) btnCancel.style.display = 'flex'
    if (chips) chips.classList.add('disabled')
  } else {
    if (btnGenerate) btnGenerate.style.display = ''
    if (btnCancel) btnCancel.style.display = 'none'
    if (chips) chips.classList.remove('disabled')
  }
}

function deriveScope(prompt: string): AIScope {
  const lower = prompt.toLowerCase()
  if (lower.includes('grammar') || lower.includes('spelling')) return 'fix-grammar'
  if (lower.includes('translate')) return 'translate'
  if (lower.includes('expand') || lower.includes('elaborate')) return 'expand'
  if (lower.includes('summarize') || lower.includes('summary')) return 'summarize'
  if (lower.includes('continue')) return 'continue'
  if (lower.includes('explain')) return 'explain'
  return 'freeform'
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// ── Palette open/close ──────────────────────────────────────────────────────────

function openPalette(): void {
  document.getElementById('ai-palette')?.classList.add('visible')
  const input = document.getElementById('ai-input') as HTMLTextAreaElement | null
  input?.focus()
}

function closePalette(): void {
  const palette = document.getElementById('ai-palette')
  if (palette) {
    palette.classList.remove('visible')
    // Reset draggable overrides to default CSS
    palette.style.bottom = ''
    palette.style.top = ''
    palette.style.left = ''
    palette.style.transform = ''
    palette.style.width = ''
    palette.style.margin = ''
  }
  const input = document.getElementById('ai-input') as HTMLTextAreaElement | null
  if (input) {
    input.value = ''
    input.style.height = 'auto'
  }
}

// ── Draggable ──────────────────────────────────────────────────────────────────

function setupDraggable(): void {
  const palette = document.getElementById('ai-palette')
  if (!palette) return

  let isDragging = false
  let startX = 0, startY = 0
  let initialLeft = 0, initialTop = 0

  palette.addEventListener('mousedown', (e) => {
    const target = e.target as HTMLElement
    if (
      target.closest('#ai-input') ||
      target.closest('#ai-generate') ||
      target.closest('#ai-cancel') ||
      target.closest('#ai-close') ||
      target.closest('.ai-chip')
    ) return

    isDragging = true
    palette.classList.add('dragging')

    const rect = palette.getBoundingClientRect()
    startX = e.clientX
    startY = e.clientY
    initialLeft = rect.left
    initialTop = rect.top

    palette.style.width = `${rect.width}px`
    palette.style.left = `${rect.left}px`
    palette.style.top = `${rect.top}px`
    palette.style.bottom = 'auto'
    palette.style.transform = 'none'
    palette.style.margin = '0'

    e.preventDefault()
  })

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    palette.style.left = `${initialLeft + dx}px`
    palette.style.top = `${initialTop + dy}px`
  })

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false
      palette.classList.remove('dragging')
    }
  })
}
