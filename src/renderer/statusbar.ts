// ─────────────────────────────────────────────────────────────────────────────
// Statusbar — Saved/dirty state + cursor position
// Phase 3.2 Task 07
// ─────────────────────────────────────────────────────────────────────────────

import { t } from '@shared/i18n'
import { getActiveTabInfo } from './fileTabs'
import { getAppSettings, updateSetting } from './settings'
import { setSpellCheck } from './editor'

let isStatusbarBound = false
let lastActivePath: string | null = undefined as unknown as null
let lastIsDirty = false
let lastLine = 1
let lastCol = 1

export function initStatusbar(): void {
  if (isStatusbarBound) return
  isStatusbarBound = true

  // Listen dirty change from fileTabs
  window.addEventListener('filetabs:dirtyChange', (e: Event) => {
    const { isDirty } = (e as CustomEvent<{ isDirty: boolean }>).detail
    updateSavedStatus(isDirty, lastActivePath)
  })

  // Listen cursor position from editor
  window.addEventListener('editor:cursor', (e: Event) => {
    const { line, col } = (e as CustomEvent<{ line: number; col: number }>).detail
    updateCursor(line, col)
  })

  // Re-render labels when locale changes
  window.addEventListener('i18n:changed', () => {
    updateSavedStatus(lastIsDirty, lastActivePath)
    updateCursor(lastLine, lastCol)
    const s = getAppSettings()
    if (s) updateSpellcheckDisplay(s.spellCheck)
  })

  // Sync dirty state + reset cursor when active tab changes
  window.addEventListener('app:activeFile', (e: Event) => {
    const { path, isDirty } = (e as CustomEvent<{ path: string | null; isDirty: boolean }>).detail
    // Always sync dirty from source of truth (covers tab switch, markDirty re-render, etc.)
    updateSavedStatus(isDirty, path)
    // Reset cursor only when the tab actually changes
    if (path !== lastActivePath) {
      lastActivePath = path
      updateCursor(1, 1)
    }
  })

  // ── Finalize init: Sync initial state ──
  const { path, isDirty } = getActiveTabInfo()
  const s = getAppSettings()
  updateSavedStatus(isDirty, path)
  updateCursor(1, 1)
  if (s) updateSpellcheckDisplay(s.spellCheck)

  // ── Click Handlers ──
  const spellBtn = document.getElementById('status-spellcheck')
  spellBtn?.addEventListener('click', () => {
    const settings = getAppSettings()
    if (!settings) return
    const newState = !settings.spellCheck
    updateSetting('spellCheck', newState, false)
    setSpellCheck(newState)
    updateSpellcheckDisplay(newState)
  })
}

function updateSpellcheckDisplay(enabled: boolean): void {
  const el = document.getElementById('status-spellcheck-state')
  if (el) el.textContent = enabled ? t('statusbar.spellcheck.on') : t('statusbar.spellcheck.off')
}

function updateSavedStatus(isDirty: boolean, path: string | null): void {
  lastIsDirty = isDirty
  const dot = document.getElementById('status-saved-dot')
  const text = document.getElementById('status-saved-text')
  let label = isDirty ? t('statusbar.unsaved') : t('statusbar.saved')
  // Untitled (no path) + clean → "New"
  if (!path && !isDirty) label = t('statusbar.new')
  if (dot) dot.classList.toggle('dirty', isDirty)
  if (text) text.textContent = label
}

function updateCursor(line: number, col: number): void {
  lastLine = line
  lastCol = col
  const el = document.getElementById('status-cursor')
  if (el) el.textContent = `${t('statusbar.ln')} ${line}, ${t('statusbar.col')} ${col}`
}
