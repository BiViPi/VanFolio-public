import { isSecondarySidebarVisible, toggleSecondarySidebar } from './sidebar'
import { toggleToc } from './tocToggle'
import { isPreviewDetached, toggleActiveFilePreview } from './previewDetach'

let isBound = false

export function initPanelToggles(): void {
  if (isBound) return
  isBound = true

  window.addEventListener('layout:sidebar-toggled', syncToggleStates)
  // Sync drag-handle + button states when detach state changes
  window.addEventListener('preview:detach-state-changed', syncToggleStates)

  document.getElementById('btn-toggle-sidebar')?.addEventListener('click', () => {
    toggleSecondarySidebar()
    syncToggleStates()
  })

  document.getElementById('btn-toggle-toc')?.addEventListener('click', () => {
    toggleToc()
    syncToggleStates()
  })

  document.getElementById('btn-toggle-editor')?.addEventListener('click', () => {
    togglePanel('editor')
  })

  document.getElementById('btn-toggle-preview')?.addEventListener('click', () => {
    togglePanel('preview')
  })

  // Detach/pin button: toggles pinned preview for the active tab
  // State update comes back via PREVIEW_ATTACHED event — button icon synced there
  document.getElementById('btn-detach-preview')?.addEventListener('click', () => {
    toggleActiveFilePreview()
  })

  syncToggleStates()
}

function togglePanel(target: 'editor' | 'preview'): void {
  // Block preview toggle while detached — user must re-attach first
  if (target === 'preview' && isPreviewDetached()) return

  const editor = document.getElementById('editor-panel')
  const preview = document.getElementById('preview-panel')
  if (!editor || !preview) return

  if (target === 'editor') {
    const editorVisible = !editor.classList.contains('hidden')
    const previewVisible = !preview.classList.contains('hidden')
    if (editorVisible && !previewVisible) return
    editor.classList.toggle('hidden')
  } else {
    const editorVisible = !editor.classList.contains('hidden')
    const previewVisible = !preview.classList.contains('hidden')
    if (previewVisible && !editorVisible) return
    preview.classList.toggle('hidden')
  }

  syncToggleStates()
}

function syncToggleStates(): void {
  const editor = document.getElementById('editor-panel')
  const preview = document.getElementById('preview-panel')
  const toc = document.getElementById('toc-sidebar')
  const dragHandle = document.getElementById('drag-handle')

  const editorVisible = !!editor && !editor.classList.contains('hidden')
  const previewVisible = !!preview && !preview.classList.contains('hidden')
  const tocVisible = !!toc && !toc.classList.contains('hidden')
  const sidebarVisible = isSecondarySidebarVisible()

  setButtonState('btn-toggle-sidebar', sidebarVisible)
  setButtonState('btn-toggle-editor', editorVisible)
  setButtonState('btn-toggle-preview', previewVisible)
  setButtonState('btn-toggle-toc', tocVisible)

  if (dragHandle) {
    const showHandle = editorVisible && previewVisible
    dragHandle.style.display = showHandle ? '' : 'none'
  }

  if (!editorVisible && !previewVisible) {
    if (editor) editor.classList.remove('hidden')
    if (preview) preview.classList.remove('hidden')
  }

}

function setButtonState(buttonId: string, isVisible: boolean): void {
  const button = document.getElementById(buttonId)
  if (!button) return
  button.classList.toggle('active', isVisible)
  button.classList.toggle('panel-hidden', !isVisible)
}
