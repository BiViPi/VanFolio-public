// ─────────────────────────────────────────────────────────────────────────────
// Editor Module — CodeMirror 6
// Sprint 1: CM6 with markdown mode, vanfolioTheme (CSS vars only), 300ms debounce
// ─────────────────────────────────────────────────────────────────────────────

import { EditorState, Compartment, type Extension } from '@codemirror/state'
import { EditorView, basicSetup } from 'codemirror'
import { keymap } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { indentUnit } from '@codemirror/language'
import { undo, redo, indentWithTab } from '@codemirror/commands'
import { vanfolioTheme, vanfolioHighlightStyle } from './styles/cmTheme'
import type { AppSettings } from '@shared/types'
import { DEFAULTS } from '@shared/constants'
import { t } from '@shared/i18n'
import { triggerPreviewUpdate } from './preview'
import { slashKeymap, smartListKeymap, slashUpdateListener } from './slashCommand'
import {
  typewriterCompartment, fadeCompartment,
  getTypewriterExtension, getFadeExtension,
  setTypewriterEnabled, setFadeEnabled,
} from './writingModes'
import { highlightHeaderCompartment, getHighlightHeaderExt } from './highlightHeader'
import { smartQuotesCompartment, getSmartQuotesExt } from './smartQuotes'
import { cleanProseCompartment, getCleanProseExt, applyCleanProseClass } from './cleanProse'

let editorView: EditorView | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
const lineWrappingCompartment = new Compartment()
const spellCheckCompartment = new Compartment()
const indentCompartment = new Compartment()

function buildIndentExt(useTabs: boolean, size: 2 | 4 | 8): Extension {
  return [
    indentUnit.of(useTabs ? '\t' : ' '.repeat(size)),
    EditorState.tabSize.of(size),
  ]
}

// Module-level handler — stable reference allows removeEventListener on re-init
const onEditorChangeEvent = (e: Event): void => {
  const content = (e as CustomEvent<{ content: string }>).detail.content
  onContentChange(content)
}
let isEditorChangeBound = false
let isEditorI18nBound = false

function syncRangeSelectionClass(view: EditorView): void {
  const hasRangeSelection = view.state.selection.ranges.some((range) => !range.empty)
  view.dom.classList.toggle('has-range-selection', hasRangeSelection)
}

export function initEditor(_settings: AppSettings): void {
  const editorArea = document.getElementById('editor-area')
  if (!editorArea) return

  // Cleanup previous instance to avoid memory leak and stale DOM (finding #2)
  if (editorView) {
    editorView.destroy()
    editorView = null
  }
  editorArea.innerHTML = ''

  const initialContent = '# Welcome to VanFolio\n\nStart typing your markdown here...\n\n- **Bold**, *italic*, `code`\n- [Links](https://example.com)\n\n```js\nconsole.log("Hello VanFolio")\n```\n'

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.selectionSet) {
      syncRangeSelectionClass(update.view)
    }
    if (update.docChanged) {
      const content = update.state.doc.toString()
      // Dispatch event bus contract — other modules subscribe via window
      window.dispatchEvent(new CustomEvent('editor:change', { detail: { content } }))
    }
    if (update.docChanged || update.selectionSet) {
      const pos = update.state.selection.main.head
      const line = update.state.doc.lineAt(pos)
      const col = pos - line.from + 1
      window.dispatchEvent(new CustomEvent('editor:cursor', { detail: { line: line.number, col } }))
    }
    if (update.selectionSet) {
      const { from, to } = update.state.selection.main
      if (from !== to) {
        window.dispatchEvent(new CustomEvent('editor:selection', { detail: { from, to } }))
      } else {
        window.dispatchEvent(new CustomEvent('editor:selectionClear'))
      }
    }
  })

  // Guard: bind editor:change listener only once (finding #1)
  if (!isEditorChangeBound) {
    window.addEventListener('editor:change', onEditorChangeEvent)
    window.addEventListener('editor:undo', () => { if (editorView) undo(editorView) })
    window.addEventListener('editor:redo', () => { if (editorView) redo(editorView) })
    isEditorChangeBound = true
  }
  if (!isEditorI18nBound) {
    window.addEventListener('i18n:changed', () => {
      if (editorView) updateStatusbar(editorView.state.doc.toString())
    })
    isEditorI18nBound = true
  }

  const state = EditorState.create({
    doc: initialContent,
    extensions: [
      // Slash Command + Smart List keymaps MUST be before basicSetup to override default Enter/Tab
      slashKeymap,
      smartListKeymap,
      slashUpdateListener,
      basicSetup,
      markdown(),
      vanfolioTheme,
      vanfolioHighlightStyle,
      lineWrappingCompartment.of(_settings.wordWrap ? EditorView.lineWrapping : []),
      spellCheckCompartment.of(EditorView.contentAttributes.of({ spellcheck: String(_settings.spellCheck ?? false) })),
      typewriterCompartment.of(getTypewriterExtension(_settings.typewriterMode ?? false)),
      fadeCompartment.of(getFadeExtension(_settings.fadeContext ?? false)),
      indentCompartment.of(buildIndentExt(_settings.indentWithTabs ?? false, _settings.indentSize ?? 4)),
      highlightHeaderCompartment.of(getHighlightHeaderExt(_settings.highlightHeader ?? false)),
      smartQuotesCompartment.of(getSmartQuotesExt(_settings.smartQuotes ?? true)),
      cleanProseCompartment.of(getCleanProseExt(_settings.cleanProseMode ?? true)),
      keymap.of([indentWithTab]),
      updateListener,
    ],
  })

  editorView = new EditorView({ state, parent: editorArea })
  syncRangeSelectionClass(editorView)

  // Apply clean-prose class if enabled at init
  if (_settings.cleanProseMode ?? true) {
    applyCleanProseClass(editorView, true)
  }

  // Trigger initial preview render + statusbar word count
  triggerPreviewUpdate(initialContent)
  updateStatusbar(initialContent)
}

export function getEditorContent(): string {
  return editorView?.state.doc.toString() ?? ''
}

export function setTypewriterMode(enabled: boolean): void {
  if (!editorView) return
  setTypewriterEnabled(enabled)
  editorView.dom.classList.toggle('typewriter-active', enabled)
  editorView.dispatch({
    effects: typewriterCompartment.reconfigure(getTypewriterExtension(enabled))
  })
}

export function setFadeContext(enabled: boolean): void {
  if (!editorView) return
  setFadeEnabled(enabled)
  editorView.dispatch({
    effects: fadeCompartment.reconfigure(getFadeExtension(enabled))
  })
}

export function setWordWrap(enabled: boolean): void {
  if (!editorView) return
  editorView.dispatch({
    effects: lineWrappingCompartment.reconfigure(enabled ? EditorView.lineWrapping : []),
  })
}

export function setSpellCheck(enabled: boolean): void {
  if (!editorView) return
  editorView.dispatch({
    effects: spellCheckCompartment.reconfigure(
      EditorView.contentAttributes.of({ spellcheck: String(enabled) })
    ),
  })
}

export function setIndentConfig(useTabs: boolean, size: 2 | 4 | 8): void {
  if (!editorView) return
  editorView.dispatch({
    effects: indentCompartment.reconfigure(buildIndentExt(useTabs, size)),
  })
}

export function setHighlightHeader(enabled: boolean): void {
  if (!editorView) return
  editorView.dispatch({
    effects: highlightHeaderCompartment.reconfigure(getHighlightHeaderExt(enabled)),
  })
}

export function setSmartQuotes(enabled: boolean): void {
  if (!editorView) return
  editorView.dispatch({
    effects: smartQuotesCompartment.reconfigure(getSmartQuotesExt(enabled)),
  })
}

export function setCleanProse(enabled: boolean): void {
  if (!editorView) return
  editorView.dispatch({
    effects: cleanProseCompartment.reconfigure(getCleanProseExt(enabled)),
  })
  applyCleanProseClass(editorView, enabled)
}

export function setEditorContent(content: string): void {
  if (!editorView) return
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: content },
    selection: { anchor: 0 },
  })
}

function onContentChange(content: string): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    triggerPreviewUpdate(content)
    updateStatusbar(content)
  }, DEFAULTS.PREVIEW_DEBOUNCE_MS)
}

function updateStatusbar(content: string): void {
  const words = content.trim() ? content.trim().split(/\s+/).length : 0
  const readTime = Math.ceil(words / 200)
  const wordsEl = document.getElementById('status-words')
  const readEl = document.getElementById('status-read-time')
  if (wordsEl) wordsEl.textContent = `${words} ${t('editor.words')}`
  if (readEl) readEl.textContent = `${readTime} ${t('editor.minRead')}`
}

// ── Public view accessor (used by slashCommand.ts) ────────────────────────
export function getEditorView(): EditorView | null {
  return editorView
}

/** Get text surrounding cursor position — used for AI context-aware generation */
export function getContextAroundCursor(chars = 500): { before: string; after: string } {
  if (!editorView) return { before: '', after: '' }
  const pos = editorView.state.selection.main.head
  const doc = editorView.state.doc.toString()
  return {
    before: doc.slice(Math.max(0, pos - chars), pos),
    after: doc.slice(pos, Math.min(doc.length, pos + chars)),
  }
}

export function focusEditor(): void {
  editorView?.focus()
}

// ── Toolbar insert/wrap helpers (T03-B) ────────────────────────────────────

/** Wrap selected text with prefix + suffix. If no selection, inserts at cursor. */
export function wrapSelection(prefix: string, suffix: string = prefix): void {
  const view = getEditorView()
  if (!view) return
  const { state } = view
  const changes = state.selection.ranges.map(range => {
    const selected = state.sliceDoc(range.from, range.to)
    return { from: range.from, to: range.to, insert: `${prefix}${selected}${suffix}` }
  })
  view.dispatch({ changes, scrollIntoView: true })
  view.focus()
}

/** Prepend each selected line with prefix (headings, lists). */
export function prependLines(prefix: string): void {
  const view = getEditorView()
  if (!view) return
  const { state } = view
  const changes = state.selection.ranges.map(range => {
    const from = state.doc.lineAt(range.from).from
    const to = state.doc.lineAt(range.to).to
    const text = state.sliceDoc(from, to)
    const newText = text.split('\n').map(line => `${prefix}${line}`).join('\n')
    return { from, to, insert: newText }
  })
  view.dispatch({ changes, scrollIntoView: true })
  view.focus()
}

/** Insert text at cursor position. */
export function insertAtCursor(text: string): void {
  const view = getEditorView()
  if (!view) return
  const pos = view.state.selection.main.head
  view.dispatch({ changes: { from: pos, insert: text }, scrollIntoView: true })
  view.focus()
}

export function editorUndo(): void {
  const view = getEditorView()
  if (view) undo(view)
}

export function editorRedo(): void {
  const view = getEditorView()
  if (view) redo(view)
}

// ── Clipboard helpers for menu Edit > Cut / Copy / Paste ──────────────────
export function editorCopy(): void {
  if (!editorView) return
  const { state } = editorView
  const selected = state.sliceDoc(state.selection.main.from, state.selection.main.to)
  if (selected) navigator.clipboard.writeText(selected).catch(console.error)
}

export function editorCut(): void {
  if (!editorView) return
  const { state } = editorView
  const { from, to } = state.selection.main
  const selected = state.sliceDoc(from, to)
  if (!selected) return
  navigator.clipboard.writeText(selected).catch(console.error)
  editorView.dispatch({ changes: { from, to, insert: '' } })
  editorView.focus()
}

export function editorPaste(): void {
  if (!editorView) return
  navigator.clipboard.readText().then((text) => {
    if (!text || !editorView) return
    const { from, to } = editorView.state.selection.main
    editorView.dispatch({ changes: { from, to, insert: text } })
    editorView.focus()
  }).catch(console.error)
}
