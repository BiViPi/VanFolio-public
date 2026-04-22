// ─────────────────────────────────────────────────────────────────────────────
// File Tabs Module — Multi-document, switch, close, unsaved dot + auto-save
// Sprint 2: Full tab state, dedup, dirty confirmation, drag-drop, menu wiring
// ─────────────────────────────────────────────────────────────────────────────

import type { OpenFileResult, SessionTabState } from '@shared/types'
import { DEFAULTS, SUPPORTED_EXTENSIONS } from '@shared/constants'
import { t } from '@shared/i18n'
import { setEditorContent } from './editor'
import { hasCapability } from './licenseGate'
import { showUpgradePrompt } from './upgradePrompt'
import { showInlineConfirm } from './versionHistory'
import { bindFloatingTooltip } from './tooltip'

interface TabState {
  tabId: string         // stable UUID, created once — used as fileKey for untitled files
  path: string | null   // null = untitled (new file)
  content: string
  isDirty: boolean
  displayName: string
}

/** Returns the stable fileKey for a tab: path if saved, tabId if untitled */
export function getFileKey(tab: TabState): string {
  return tab.path ?? tab.tabId
}

/** Returns the fileKey of the currently active tab */
export function getActiveFileKey(): string {
  return getFileKey(tabs[activeIndex] ?? { tabId: '__fallback__', path: null, content: '', isDirty: false, displayName: '' })
}

let tabs: TabState[] = []
let activeIndex = 0
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
let autoSaveDelay = DEFAULTS.AUTOSAVE_DEBOUNCE_MS

export function setAutoSaveDelay(ms: number): void {
  autoSaveDelay = ms
}

// Guards against marking dirty when loading content programmatically
let suppressDirty = false

// One-time binding guards — same pattern as editor.ts to prevent duplicate listeners on re-init/HMR
let isEditorChangeBound = false
let isDragDropBound = false

// Module-level stable handler references — required for removeEventListener to work
const onEditorChangeEvent = (e: Event): void => {
  if (suppressDirty) return
  const content = (e as CustomEvent<{ content: string }>).detail.content
  markDirty(content)
}

const onDragOver = (e: DragEvent): void => {
  e.preventDefault()
  e.stopPropagation()
}

const onDrop = async (e: DragEvent): Promise<void> => {
  e.preventDefault()
  e.stopPropagation()
  const files = Array.from(e.dataTransfer?.files ?? [])
  const md = files.find(f =>
    SUPPORTED_EXTENSIONS.some(ext => f.name.toLowerCase().endsWith(ext))
  )
  if (!md) return
  const filePath = (md as File & { path?: string }).path
  if (!filePath) return
  const content = await window.vanfolioAPI.readFile(filePath)
  if (content === null) return
  openFileInTab({ path: filePath, content })
}

export function initFileTabs(): void {
  // Guard: only create the default Untitled tab on first init, not on HMR re-init
  if (tabs.length === 0) openNewTab()

  if (!isEditorChangeBound) {
    window.addEventListener('editor:change', onEditorChangeEvent)
    window.addEventListener('filetabs:newFile', () => createNewTab())
    isEditorChangeBound = true
  }

  if (!isDragDropBound) {
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('drop', onDrop)
    isDragDropBound = true
  }
}

export async function openNewTab(file?: OpenFileResult): Promise<boolean> {
  const MAX_FREE_TABS = 3
  if (tabs.length >= MAX_FREE_TABS && !(await hasCapability('tabs.unlimited'))) {
    showUpgradePrompt(t('tabs.unlimitedFeature'))
    return false
  }

  const tab: TabState = {
    tabId: crypto.randomUUID(),
    path: file?.path ?? null,
    content: file?.content ?? '',
    isDirty: false,
    displayName: file ? getFileName(file.path) : 'Untitled',
  }
  tabs.push(tab)
  activeIndex = tabs.length - 1
  renderTabs()
  return true
}

/** Create a new empty tab AND clear the editor — use this from menu/shortcut actions. */
export async function createNewTab(): Promise<void> {
  if (await openNewTab()) {
    loadIntoEditor('')
  }
}

// Open a file into a tab — focuses existing tab if path is already open
export async function openFileInTab(file: OpenFileResult): Promise<void> {
  const existing = tabs.findIndex(t => t.path === file.path)
  if (existing !== -1) {
    activeIndex = existing
    renderTabs()
    loadIntoEditor(tabs[existing].content)
    return
  }
  if (await openNewTab(file)) {
    loadIntoEditor(file.content)
  }
}

// Sync editor's initial content into the active tab without marking dirty.
// Call once after initEditor() to eliminate the startup state mismatch (finding #2).
export function syncInitialContent(content: string): void {
  if (tabs[activeIndex] && !tabs[activeIndex].isDirty) {
    tabs[activeIndex].content = content
  }
}

/** Returns true if any open tab has unsaved changes. Used by app-close guard (S7-2). */
export function hasDirtyTabs(): boolean {
  return tabs.some(t => t.isDirty)
}

export function markDirty(content: string): void {
  if (tabs[activeIndex]) {
    tabs[activeIndex].content = content
    tabs[activeIndex].isDirty = true
    renderTabs()
    if (tabs[activeIndex].path) scheduleAutoSave()  // Untitled (path=null) không autosave
    window.dispatchEvent(new CustomEvent('filetabs:dirtyChange', { detail: { isDirty: true } }))
  }
}

function appendNewTabButton(container: HTMLElement): void {
  document.getElementById('btn-new-tab')?.remove()
  const btn = document.createElement('button')
  btn.id = 'btn-new-tab'
  btn.className = 'file-tabs-new'
  btn.textContent = '+'
  bindFloatingTooltip(btn, t('tabs.newFileTooltip'), 'bottom')
  btn.addEventListener('click', () => createNewTab())
  container.appendChild(btn)
}

// Save active tab — saves in-place if path known, else prompts Save As
export async function saveCurrentTab(): Promise<void> {
  const tab = tabs[activeIndex]
  if (!tab) return

  if (tab.path) {
    const ok = await window.vanfolioAPI.saveFile(tab.path, tab.content)
    if (ok) {
      tab.isDirty = false
      renderTabs()
      window.dispatchEvent(new CustomEvent('filetabs:dirtyChange', { detail: { isDirty: false } }))
    }
  } else {
    await saveCurrentTabAs()
  }
}

// Always prompt Save As dialog — lets user rename or duplicate any tab.
// If the chosen path is already open in another tab, that tab is closed first
// (its file on disk was just overwritten) to preserve the dedup invariant.
export async function saveCurrentTabAs(): Promise<void> {
  const tab = tabs[activeIndex]
  if (!tab) return
  const result = await window.vanfolioAPI.saveFileAs(tab.content)
  if (!result) return

  // Close any other tab that already has this path — it points to stale disk content
  const duplicate = tabs.findIndex((t, i) => i !== activeIndex && t.path === result.path)
  if (duplicate !== -1) {
    tabs.splice(duplicate, 1)
    if (activeIndex > duplicate) activeIndex--
  }

  const oldKey = getFileKey(tab)
  tab.path = result.path
  tab.displayName = getFileName(result.path)
  tab.isDirty = false
  const newKey = getFileKey(tab)  // now equals result.path
  // If this tab had a pinned preview window, migrate it to the new fileKey
  if (oldKey !== newKey) {
    window.vanfolioAPI.renamePreviewFile(oldKey, newKey, tab.displayName)
  }
  renderTabs()
  window.dispatchEvent(new CustomEvent('filetabs:dirtyChange', { detail: { isDirty: false } }))
}

// Load content into editor without triggering dirty state
function loadIntoEditor(content: string): void {
  suppressDirty = true
  setEditorContent(content)
  // setEditorContent dispatches synchronously, safe to reset flag immediately
  suppressDirty = false
}

function scheduleAutoSave(): void {
  // Auto-save debounce 2s — Untitled (path=null) is never auto-saved
  // Capture tabIndex NOW so the timer saves the tab that triggered the edit,
  // not whatever tab happens to be active when the 2s fires (finding #1)
  const tabIndex = activeIndex
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(async () => {
    const tab = tabs[tabIndex]
    if (tab?.path && tab.isDirty) {
      const ok = await window.vanfolioAPI.saveFile(tab.path, tab.content)
      if (ok) {
        tab.isDirty = false
        renderTabs()
        window.dispatchEvent(new CustomEvent('filetabs:dirtyChange', { detail: { isDirty: false } }))
      }
    }
  }, autoSaveDelay)
}


function renderTabs(): void {
  const bar = document.getElementById('file-tabs-scroll') ?? document.getElementById('file-tabs-bar')
  if (!bar) return

  bar.replaceChildren()
  tabs.forEach((tab, i) => {
    const div = document.createElement('div')
    div.className = `file-tab ${i === activeIndex ? 'active' : ''}`
    div.dataset.index = String(i)

    if (tab.isDirty) {
      const dot = document.createElement('span')
      dot.className = 'unsaved-dot'
      div.appendChild(dot)
    }

    const name = document.createElement('span')
    name.className = 'tab-name'
    name.textContent = tab.displayName + (tab.isDirty ? ' \u2022' : '')
    div.appendChild(name)

    const closeBtn = document.createElement('button')
    closeBtn.className = 'tab-close'
    closeBtn.dataset.index = String(i)
    closeBtn.textContent = '\u2715'
    div.appendChild(closeBtn)

    bar.appendChild(div)
  })

  // Wire tab click — switch active tab and load its content
  bar.querySelectorAll('.file-tab').forEach((el) => {
    el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      if (target.classList.contains('tab-close')) return
      const idx = parseInt(el.getAttribute('data-index')!, 10)
      if (idx === activeIndex) return
      activeIndex = idx
      renderTabs()
      loadIntoEditor(tabs[idx].content)
    })
  })

  // Wire close button
  bar.querySelectorAll('.tab-close').forEach((el) => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.getAttribute('data-index')!, 10)
      closeTab(idx)
    })
  })

  // Notify sidebar (and toolbar) that the active file changed
  const activeTab = tabs[activeIndex]
  window.dispatchEvent(new CustomEvent('app:activeFile', {
    detail: {
      path: activeTab?.path ?? null,
      isDirty: activeTab?.isDirty ?? false,
      fileKey: activeTab ? getFileKey(activeTab) : null,
    },
  }))

  // Append + button (idempotent — removes old one first)
  appendNewTabButton(bar)
}

async function closeTab(idx: number): Promise<void> {
  const tab = tabs[idx]
  if (!tab) return
  if (tab.isDirty) {
    const ok = await showInlineConfirm(t('tabs.closeUnsaved', { name: tab.displayName }))
    if (!ok) return
  }
  // Explicitly close pinned preview window for this tab (not toggle — always close)
  window.vanfolioAPI.closePreviewFile(getFileKey(tab))
  tabs.splice(idx, 1)
  if (tabs.length === 0) {
    openNewTab()
    loadIntoEditor('')
  } else {
    if (activeIndex >= tabs.length) activeIndex = tabs.length - 1
    renderTabs()
    loadIntoEditor(tabs[activeIndex].content)
  }
}

/**
 * Returns the active tab's file path and markdown content.
 * Used by exportModal to build ExportOptions without coupling to internal tab state.
 */
export function getActiveTabName(): string {
  return tabs[activeIndex]?.displayName ?? 'Untitled'
}

export function getActiveTabInfo(): { path: string | null; markdown: string; isDirty: boolean; displayName: string } {
  const tab = tabs[activeIndex]
  return {
    path: tab?.path ?? null,
    markdown: tab?.content ?? '',
    isDirty: tab?.isDirty ?? false,
    displayName: tab?.displayName ?? 'Untitled',
  }
}

export function restoreActiveTabContent(content: string): void {
  const tab = tabs[activeIndex]
  if (!tab) return
  tab.content = content
  tab.isDirty = true
  renderTabs()
  loadIntoEditor(content)
  window.dispatchEvent(new CustomEvent('filetabs:dirtyChange', { detail: { isDirty: true } }))
}

/**
 * Returns snapshot of all tabs for session persistence.
 * Used by renderer/main.ts to call saveSession() periodically.
 */
export function getTabsState(): { openTabs: SessionTabState[]; activeIndex: number } {
  return {
    openTabs: tabs.map(t => ({
      path: t.path,
      content: t.content,
      displayName: t.displayName,
      isDirty: t.isDirty,
    })),
    activeIndex,
  }
}

/**
 * Restores tabs from a saved SessionState.
 * Call after initFileTabs() and before loadIntoEditor().
 */
export function restoreTabs(state: { openTabs: SessionTabState[]; activeIndex: number }): void {
  if (!state.openTabs || state.openTabs.length === 0) return
  // Replace the default Untitled tab with restored tabs
  tabs = state.openTabs.map(t => ({
    tabId: crypto.randomUUID(),
    path: t.path,
    content: t.content,
    displayName: t.displayName,
    isDirty: t.isDirty,
  }))
  activeIndex = Math.min(state.activeIndex, tabs.length - 1)
  renderTabs()
  loadIntoEditor(tabs[activeIndex]?.content ?? '')
}

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
