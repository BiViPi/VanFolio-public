// ─────────────────────────────────────────────────────────────────────────────
// Floating Inline Toolbar — Sprint 2
// Shows on text selection → Bold/Italic/Strike/Code/Link
// ─────────────────────────────────────────────────────────────────────────────

import { getEditorView, wrapSelection } from './editor'
import { isPopupVisible } from './slashCommand'

let isFloatingBound = false
let selectionTimer: ReturnType<typeof setTimeout> | null = null
const toolbar = (): HTMLElement | null => document.getElementById('floating-toolbar')

// ── Action Registry ───────────────────────────────────────────────────────────

const ACTIONS: Record<string, () => void> = {
  bold: () => wrapSelection('**'),
  italic: () => wrapSelection('*'),
  strike: () => wrapSelection('~~'),
  code: () => wrapSelection('`'),
  link: () => {
    const view = getEditorView()
    if (!view) return
    const { from, to } = view.state.selection.main
    const sel = view.state.sliceDoc(from, to)
    view.dispatch({ changes: { from, to, insert: `[${sel}](url)` } })
    // Select "url" so user can type the link immediately
    const urlStart = from + sel.length + 3  // after "[sel]("
    view.dispatch({ selection: { anchor: urlStart, head: urlStart + 3 } })
    view.focus()
  },
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initFloatingToolbar(): void {
  if (isFloatingBound) return
  isFloatingBound = true

  const el = toolbar()
  if (!el) return

  // Button click — mousedown prevents losing editor selection
  el.querySelectorAll<HTMLButtonElement>('.ft-btn').forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault()  // CRITICAL: giữ editor selection không bị mất
      const action = btn.dataset.action
      if (action && ACTIONS[action]) {
        ACTIONS[action]()
      }
      hideToolbar()
    })
  })

  // Selection events từ editor.ts
  window.addEventListener('editor:selection', (e) => {
    // Slash popup takes priority — no floating toolbar while slash is open
    if (isPopupVisible()) return
    const { from } = (e as CustomEvent).detail
    if (selectionTimer) clearTimeout(selectionTimer)
    selectionTimer = setTimeout(() => showToolbar(from), 120)
  })

  window.addEventListener('editor:selectionClear', () => {
    if (selectionTimer) clearTimeout(selectionTimer)
    hideToolbar()
  })

  // Click outside → dismiss
  document.addEventListener('mousedown', (e) => {
    if (!el.contains(e.target as Node)) {
      hideToolbar()
    }
  })
}

// ── Show / Position ───────────────────────────────────────────────────────────

function showToolbar(from: number): void {
  const view = getEditorView()
  const el = toolbar()
  if (!view || !el) return

  const fromCoords = view.coordsAtPos(from)
  if (!fromCoords) return

  // Top Y: first line of selection
  const topY = fromCoords.top

  el.classList.add('visible')

  requestAnimationFrame(() => {
    const rect = el.getBoundingClientRect()

    // Position: Align Left with the selection start
    let left = fromCoords.left

    // Position: 12px above the line top
    let top = topY - rect.height - 12

    // Collision detection: Left edge (8px padding)
    if (left < 8) left = 8

    // Collision detection: Right edge
    if (left + rect.width > window.innerWidth - 8) {
      left = window.innerWidth - 8 - rect.width
    }

    // Collision detection: Top edge (if too high, flip below)
    if (top < 4) {
      const bottomY = fromCoords.bottom
      top = bottomY + 12
    }

    el.style.left = `${Math.round(left)}px`
    el.style.top = `${Math.round(top)}px`
  })
}

// ── Hide ──────────────────────────────────────────────────────────────────────

function hideToolbar(): void {
  toolbar()?.classList.remove('visible')
}
