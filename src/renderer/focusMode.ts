import { getEditorContent } from './editor'
import { openSettings } from './settings'
import { getActiveTabName } from './fileTabs'
import { t } from '@shared/i18n'

let isZenMode = false
let currentSubMode: 'editor' | 'preview' = 'editor'

// Keep track of the elements we move
let originalEditorParent: HTMLElement | null = null
let originalPreviewParent: HTMLElement | null = null

let _focusBound = false
export function initFocusMode(): void {
  if (_focusBound) return
  _focusBound = true
  // Bind events for Zen Mode overlay
  const closeBtn = document.getElementById('zen-close-btn')
  const tabEditor = document.getElementById('zen-tab-editor')
  const tabPreview = document.getElementById('zen-tab-preview')

  closeBtn?.addEventListener('click', () => { if (isZenMode) toggleFocusMode() })

  const settingsBtn = document.getElementById('zen-settings-btn')
  settingsBtn?.addEventListener('click', () => {
    // Open the main app settings modal directly
    openSettings()
  })

  tabEditor?.addEventListener('click', () => setSubMode('editor'))
  tabPreview?.addEventListener('click', () => setSubMode('preview'))

  // Listen for content changes to update word count & reading time
  window.addEventListener('editor:change', (e: Event) => {
    const { content } = (e as CustomEvent<{ content: string }>).detail
    updateZenStats(content)
  })

  // Re-render zen stats and tab labels when locale changes
  window.addEventListener('i18n:changed', () => {
    updateZenStats(getEditorContent())
    const tabEditorEl = document.getElementById('zen-tab-editor')
    const tabPreviewEl = document.getElementById('zen-tab-preview')
    if (tabEditorEl) tabEditorEl.textContent = t('zen.tabEditor')
    if (tabPreviewEl) tabPreviewEl.textContent = t('zen.tabPreview')
  })

  // ESC to exit Zen Mode — yield to overlays that should close first (BUG-2 fix)
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && isZenMode) {
      // Let other ESC handlers close their overlays first
      if (document.getElementById('ai-palette')?.classList.contains('visible')) return
      if (document.getElementById('settings-panel')?.classList.contains('open')) return
      if (document.getElementById('export-modal-overlay')?.classList.contains('visible')) return
      toggleFocusMode()
    }
  })
}

function updateZenStats(content: string) {
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0
  const readingTime = Math.max(1, Math.ceil(wordCount / 200))

  const countEl = document.getElementById('zen-word-count')
  const timeEl = document.getElementById('zen-read-time')

  if (countEl) countEl.textContent = `${wordCount} ${t('editor.words')}`
  if (timeEl) timeEl.textContent = t('zen.readingTime', { time: String(readingTime) })
}

export function toggleFocusMode(): void {
  isZenMode = !isZenMode

  const overlay = document.getElementById('zen-overlay')
  if (!overlay) return

  if (isZenMode) {
    applyTheme()
    overlay.style.display = 'block'
    document.body.classList.add('zen-mode-active')

    // Move AI palette to body so it's not hidden by `#app { display: none }` (BUG-5)
    const aiPalette = document.getElementById('ai-palette')
    if (aiPalette) document.body.appendChild(aiPalette)

    // Move settings panel to body so it's not hidden by `#app { display: none }` (BUG-6)
    const settingsPanel = document.getElementById('settings-panel')
    if (settingsPanel) document.body.appendChild(settingsPanel)

    // Initial stats and title
    const titleEl = document.getElementById('zen-title')
    if (titleEl) titleEl.textContent = getActiveTabName()

    updateZenStats(getEditorContent())

    // Defer DOM moves to ensure display block has taken effect
    setTimeout(() => {
      moveEditorNodes(true)
      setSubMode(currentSubMode)
    }, 10)
  } else {
    // Exit Zen Mode
    moveEditorNodes(false)
    overlay.style.display = 'none'
    document.body.classList.remove('zen-mode-active')

    // Restore AI palette back into preview panel (BUG-5)
    const aiPalette = document.getElementById('ai-palette')
    const previewPanel = document.getElementById('preview-panel')
    if (aiPalette && previewPanel) previewPanel.appendChild(aiPalette)

    // Restore settings panel back into #app (BUG-6)
    const settingsPanel = document.getElementById('settings-panel')
    const appEl = document.getElementById('app')
    if (settingsPanel && appEl) appEl.appendChild(settingsPanel)
  }
}

function applyTheme() {
  const theme = document.documentElement.getAttribute('data-theme') ?? ''
  let zenTheme: string
  if (theme === 'van-chronicle') {
    zenTheme = 'chronicle'
  } else if (theme === 'van-botanical') {
    zenTheme = 'botanical'
  } else if (theme.startsWith('dark')) {
    zenTheme = 'dark'
  } else {
    zenTheme = 'light'
  }
  document.documentElement.setAttribute('data-zen-theme', zenTheme)
}

function setSubMode(mode: 'editor' | 'preview') {
  currentSubMode = mode

  const editorView = document.getElementById('zen-editor-view')
  const previewView = document.getElementById('zen-preview-view')
  const tabEditor = document.getElementById('zen-tab-editor')
  const tabPreview = document.getElementById('zen-tab-preview')

  if (!editorView || !previewView || !tabEditor || !tabPreview) return

  if (mode === 'editor') {
    editorView.style.display = 'block'
    previewView.style.display = 'none'
    tabEditor.classList.add('active')
    tabPreview.classList.remove('active')
  } else {
    editorView.style.display = 'none'
    previewView.style.display = 'block'
    tabEditor.classList.remove('active')
    tabPreview.classList.add('active')
  }
}

function moveEditorNodes(enterZen: boolean) {
  const editorArea = document.getElementById('editor-area')
  const previewContent = document.getElementById('preview-content')
  const zenEditorView = document.getElementById('zen-editor-view')
  const zenPreviewView = document.getElementById('zen-preview-view')

  if (!editorArea || !previewContent || !zenEditorView || !zenPreviewView) return

  if (enterZen) {
    originalPreviewParent = previewContent.parentElement
    originalEditorParent = editorArea.parentElement

    if (editorArea) zenEditorView.appendChild(editorArea)
    if (previewContent) zenPreviewView.appendChild(previewContent)
  } else {
    // Restore
    if (originalEditorParent && editorArea) {
      originalEditorParent.appendChild(editorArea)
    }
    if (originalPreviewParent && previewContent) {
      originalPreviewParent.appendChild(previewContent)
    }

    originalEditorParent = null
    originalPreviewParent = null
  }
}
