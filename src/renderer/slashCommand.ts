// ─────────────────────────────────────────────────────────────────────────────
// Slash Command Module — Sprint 1
// / trigger → popup at cursor → filter → keyboard nav → execute
// Also exports: smartListKeymap (Smart Enter/Tab for list editing)
// ─────────────────────────────────────────────────────────────────────────────

import { keymap } from '@codemirror/view'
import { EditorView } from 'codemirror'
import { wrapSelection, prependLines, insertAtCursor, getEditorView } from './editor'
import { hasCapability } from './licenseGate'
import { showUpgradePrompt } from './upgradePrompt'
import { t } from '@shared/i18n'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SlashItem {
  id: string
  labelKey: string
  shortcut: string
  icon: string
  category: string
  action: () => void
}

// ── Command Registry ──────────────────────────────────────────────────────────

const SLASH_COMMANDS: SlashItem[] = [
  // Headings
  { id: 'h1', labelKey: 'slash.heading1', shortcut: '/h1', icon: 'H1', category: 'heading', action: () => prependLines('# ') },
  { id: 'h2', labelKey: 'slash.heading2', shortcut: '/h2', icon: 'H2', category: 'heading', action: () => prependLines('## ') },
  { id: 'h3', labelKey: 'slash.heading3', shortcut: '/h3', icon: 'H3', category: 'heading', action: () => prependLines('### ') },

  // Lists
  { id: 'bullet', labelKey: 'slash.bulletList', shortcut: '/bullet', icon: '•', category: 'block', action: () => prependLines('- ') },
  { id: 'numbered', labelKey: 'slash.numberedList', shortcut: '/numbered', icon: '1.', category: 'block', action: () => prependLines('1. ') },
  { id: 'todo', labelKey: 'slash.todoList', shortcut: '/todo', icon: '☑', category: 'block', action: () => prependLines('- [ ] ') },

  // Blocks
  { id: 'quote', labelKey: 'slash.blockquote', shortcut: '/quote', icon: '"', category: 'block', action: () => prependLines('> ') },
  { id: 'codeblock', labelKey: 'slash.codeBlock', shortcut: '/codeblock', icon: '{}', category: 'block', action: () => insertCodeBlock() },
  { id: 'table', labelKey: 'slash.table', shortcut: '/table', icon: '⊞', category: 'block', action: () => insertTable() },
  { id: 'hr', labelKey: 'slash.divider', shortcut: '/hr', icon: '—', category: 'block', action: () => insertAtCursor('\n---\n') },

  // Inline
  { id: 'code', labelKey: 'slash.inlineCode', shortcut: '/code', icon: '`', category: 'inline', action: () => wrapSelection('`') },
  { id: 'link', labelKey: 'slash.link', shortcut: '/link', icon: '🔗', category: 'inline', action: () => insertAtCursor('[text](url)') },
  { id: 'image', labelKey: 'slash.image', shortcut: '/image', icon: '🖼', category: 'inline', action: () => insertAtCursor('![alt](url)') },

  // Advanced
  { id: 'mermaid', labelKey: 'slash.mermaid', shortcut: '/mermaid', icon: '◇', category: 'advanced', action: () => insertMermaid() },
  { id: 'katex', labelKey: 'slash.math', shortcut: '/katex', icon: '∑', category: 'advanced', action: () => insertAtCursor('$$\n\n$$') },
  { id: 'pagebreak', labelKey: 'slash.pageBreak', shortcut: '/pagebreak', icon: '⊟', category: 'advanced', action: () => insertAtCursor('\n<!-- pagebreak -->\n') },
]

function getSlashLabel(item: SlashItem): string {
  return t(item.labelKey)
}

function insertCodeBlock(): void {
  insertAtCursor('\n```\n\n```\n')
}

function insertTable(): void {
  insertAtCursor('\n| Col 1 | Col 2 |\n|---|---|\n| Cell | Cell |\n')
}

function insertMermaid(): void {
  insertAtCursor('\n```mermaid\ngraph TD\n  A --> B\n```\n')
}

// ── Popup State ───────────────────────────────────────────────────────────────

let slashStartPos = -1
let highlightIndex = 0
let currentFiltered: SlashItem[] = []

export function isPopupVisible(): boolean {
  const popup = document.getElementById('slash-popup')
  return popup?.classList.contains('visible') ?? false
}

// ── License Listener ──────────────────────────────────────────────────────────

export function initSlashCommandLicenseListener(): void {
  window.addEventListener('license:updated', () => {
    // Re-render slash popup if it's visible (badges may need to hide if user activated trial/pro)
    if (isPopupVisible() && currentFiltered.length > 0) {
      renderItems(currentFiltered).catch(console.error)
    }
  })
}

// ── Show / Hide ───────────────────────────────────────────────────────────────

async function showPopup(view: EditorView, pos: number): Promise<void> {
  const coords = view.coordsAtPos(pos)
  if (!coords) return

  const popup = document.getElementById('slash-popup')
  if (!popup) return

  highlightIndex = 0
  currentFiltered = [...SLASH_COMMANDS]
  await renderItems(currentFiltered)

  popup.classList.add('visible')

  // Position ngay dưới cursor line (after render so we have height)
  requestAnimationFrame(() => {
    const rect = popup.getBoundingClientRect()
    let left = coords.left
    let top = coords.bottom + 4  // 4px gap

    // Viewport collision detection
    if (left + rect.width > window.innerWidth - 8) {
      left = window.innerWidth - 8 - rect.width
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = coords.top - rect.height - 4  // flip lên trên
    }

    popup.style.left = `${left}px`
    popup.style.top = `${top}px`
  })
}

function hidePopup(): void {
  const popup = document.getElementById('slash-popup')
  if (!popup) return
  popup.classList.remove('visible')
  slashStartPos = -1
  currentFiltered = []
  highlightIndex = 0
}

// ── Render Items ──────────────────────────────────────────────────────────────

async function renderItems(items: SlashItem[]): Promise<void> {
  const popup = document.getElementById('slash-popup')
  if (!popup) return

  if (items.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'slash-empty'
    empty.textContent = t('slash.noCommands')
    popup.replaceChildren(empty)
    return
  }

  const FREE_COMMAND_IDS = ['h1', 'h2', 'bullet', 'numbered', 'hr']
  const hasPro = await hasCapability('slash.all')

  popup.replaceChildren()

  items.forEach((item, i) => {
    const isLocked = !hasPro && !FREE_COMMAND_IDS.includes(item.id)

    const div = document.createElement('div')
    div.className = `slash-item ${i === highlightIndex ? 'active' : ''} ${isLocked ? 'locked' : ''}`
    div.dataset.index = String(i)
    div.dataset.id = item.id

    const iconSpan = document.createElement('span')
    iconSpan.className = 'slash-item-icon'
    iconSpan.textContent = item.icon

    const labelSpan = document.createElement('span')
    labelSpan.className = 'slash-item-label'
    labelSpan.textContent = getSlashLabel(item)

    div.appendChild(iconSpan)
    div.appendChild(labelSpan)

    if (isLocked) {
      const badge = document.createElement('span')
      badge.className = 'badge-pro'
      badge.style.cssText = 'margin-left:auto;margin-right:8px;'
      badge.textContent = 'PRO'
      div.appendChild(badge)
    }

    const shortcutSpan = document.createElement('span')
    shortcutSpan.className = 'slash-item-shortcut'
    shortcutSpan.textContent = item.shortcut
    div.appendChild(shortcutSpan)

    popup.appendChild(div)
  })

  // Mouse click handler (mousedown để giữ editor focus)
  popup.querySelectorAll('.slash-item').forEach(el => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()  // giữ editor focus
      const id = (el as HTMLElement).dataset.id
      const cmd = SLASH_COMMANDS.find(c => c.id === id)
      if (cmd) {
        if (el.classList.contains('locked')) {
          showUpgradePrompt(getSlashLabel(cmd))
          hidePopup()
          return
        }
        deleteSlashQuery()
        cmd.action()
        hidePopup()
      }
    })
  })
}

// ── Filter ────────────────────────────────────────────────────────────────────

function filterCommands(query: string): void {
  const q = query.toLowerCase()
  currentFiltered = SLASH_COMMANDS.filter(cmd =>
    cmd.shortcut.toLowerCase().startsWith('/' + q) ||
    getSlashLabel(cmd).toLowerCase().startsWith(q) ||
    cmd.id.startsWith(q)
  )
  highlightIndex = 0
  renderItems(currentFiltered)
}

// ── Navigation helpers ────────────────────────────────────────────────────────

function moveHighlight(delta: number): void {
  if (currentFiltered.length === 0) return
  highlightIndex = (highlightIndex + delta + currentFiltered.length) % currentFiltered.length
  renderItems(currentFiltered)
}

function deleteSlashQuery(): void {
  const view = getEditorView()
  if (!view || slashStartPos < 0) return
  const pos = view.state.selection.main.head
  view.dispatch({ changes: { from: slashStartPos, to: pos, insert: '' } })
}

function executeHighlighted(view: EditorView): void {
  if (currentFiltered.length === 0) return
  const item = currentFiltered[highlightIndex]
  if (!item) return

  const popup = document.getElementById('slash-popup')
  const el = popup?.querySelector(`[data-index="${highlightIndex}"]`)
  if (el?.classList.contains('locked')) {
    showUpgradePrompt(getSlashLabel(item))
    hidePopup()
    return
  }

  deleteSlashQuery()
  item.action()
  hidePopup()
  view.focus()
}

// ── CM6 Update Listener — Trigger Detection ───────────────────────────────────

export const slashUpdateListener = EditorView.updateListener.of((update) => {
  if (!update.docChanged) return

  // Chỉ detect khi user gõ (không phải paste/undo)
  const isUserInput = update.transactions.some(tr =>
    tr.isUserEvent('input.type')
  )
  if (!isUserInput) {
    // Nếu popup đang mở và doc thay đổi qua non-type (undo/redo/paste) → dismiss
    if (isPopupVisible()) hidePopup()
    return
  }

  const pos = update.state.selection.main.head
  const charBefore = update.state.sliceDoc(pos - 1, pos)

  // Nếu popup đang mở → update filter hoặc dismiss
  if (isPopupVisible()) {
    // Dismiss nếu cursor ra ngoài range
    if (pos < slashStartPos || pos > slashStartPos + 25) {
      hidePopup()
      return
    }
    const query = update.state.sliceDoc(slashStartPos + 1, pos)
    // Dismiss nếu có space hoặc newline trong query
    if (/[\s\n]/.test(query)) {
      hidePopup()
      return
    }
    filterCommands(query)
    return
  }

  // Trigger: '/' được gõ và trước nó là whitespace/newline/start-of-document
  if (charBefore === '/') {
    const twoBack = pos >= 2 ? update.state.sliceDoc(pos - 2, pos - 1) : ''
    if (pos === 1 || twoBack === '' || /[\s\n]/.test(twoBack)) {
      slashStartPos = pos - 1  // vị trí của '/'
      showPopup(update.view, pos)
    }
  }
})

// ── CM6 Keymap — Arrow/Enter/Escape navigation ────────────────────────────────

export const slashKeymap = keymap.of([
  {
    key: 'ArrowDown',
    run: () => {
      if (!isPopupVisible()) return false
      moveHighlight(1)
      return true
    },
  },
  {
    key: 'ArrowUp',
    run: () => {
      if (!isPopupVisible()) return false
      moveHighlight(-1)
      return true
    },
  },
  {
    key: 'Enter',
    run: (view) => {
      if (view.composing) return false  // IME composition active — don't intercept
      if (!isPopupVisible()) return false
      executeHighlighted(view)
      return true
    },
  },
  {
    key: 'Escape',
    run: () => {
      if (!isPopupVisible()) return false
      hidePopup()
      return true
    },
  },
])

// ── CM6 Keymap — Smart Enter/Tab for list editing ─────────────────────────────

export const smartListKeymap = keymap.of([
  {
    key: 'Enter',
    run: (view) => {
      if (view.composing) return false  // IME composition active — don't intercept
      // Don't intercept if slash popup is active (slashKeymap handles it first)
      const line = view.state.doc.lineAt(view.state.selection.main.head)
      const text = line.text

      // Empty list item (only marker remains) → exit list
      if (/^(\s*)([-*+]|\d+\.)(?: \[[ x]\])? $/.test(text)) {
        view.dispatch({ changes: { from: line.from, to: line.to, insert: '' } })
        return true
      }

      // Checkbox list → continue unchecked
      const checkMatch = text.match(/^(\s*)- \[[ x]\] /)
      if (checkMatch) {
        const [, indent] = checkMatch
        view.dispatch({
          changes: { from: view.state.selection.main.head, insert: `\n${indent}- [ ] ` },
          scrollIntoView: true,
        })
        return true
      }

      // Bullet list → continue
      const bulletMatch = text.match(/^(\s*)([-*+]) /)
      if (bulletMatch) {
        const [, indent, marker] = bulletMatch
        view.dispatch({
          changes: { from: view.state.selection.main.head, insert: `\n${indent}${marker} ` },
          scrollIntoView: true,
        })
        return true
      }

      // Numbered list → increment
      const numMatch = text.match(/^(\s*)(\d+)\. /)
      if (numMatch) {
        const [, indent, num] = numMatch
        view.dispatch({
          changes: { from: view.state.selection.main.head, insert: `\n${indent}${parseInt(num) + 1}. ` },
          scrollIntoView: true,
        })
        return true
      }

      return false  // fallthrough to default Enter
    },
  },
  {
    key: 'Tab',
    run: (view) => {
      if (view.composing) return false  // IME composition active — don't intercept
      const line = view.state.doc.lineAt(view.state.selection.main.head)
      if (/^\s*([-*+]|\d+\.|- \[[ x]\]) /.test(line.text)) {
        view.dispatch({ changes: { from: line.from, insert: '  ' } })
        return true
      }
      return false
    },
  },
  {
    key: 'Shift-Tab',
    run: (view) => {
      if (view.composing) return false  // IME composition active — don't intercept
      const line = view.state.doc.lineAt(view.state.selection.main.head)
      if (/^  /.test(line.text) && /^\s*([-*+]|\d+\.|- \[[ x]\]) /.test(line.text)) {
        view.dispatch({ changes: { from: line.from, to: line.from + 2, insert: '' } })
        return true
      }
      return false
    },
  },
])

// ── Init ──────────────────────────────────────────────────────────────────────

export function initSlashCommand(): void {
  // Keymaps + updateListener are wired into CM6 extensions via editor.ts
  // This function exists for any future DOM-level init needs
}
