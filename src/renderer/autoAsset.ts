// ─────────────────────────────────────────────────────────────────────────────
// Auto-Asset Management — Sprint 4
// Drag-and-drop images into editor → copy to ./assets/ → insert markdown
// ─────────────────────────────────────────────────────────────────────────────

import { insertAtCursor } from './editor'
import { getActiveTabInfo } from './fileTabs'
import { showToast } from './toast'
import { t } from '@shared/i18n'

const SUPPORTED_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
])

let _bound = false

export function initAutoAsset(): void {
  if (_bound) return
  _bound = true

  const editorArea = document.getElementById('editor-area')
  if (!editorArea) return

  editorArea.addEventListener('dragover', (e) => {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    editorArea.classList.add('drag-over')
  })

  editorArea.addEventListener('dragleave', (e) => {
    // Only remove when leaving the editor area entirely (not entering a child)
    if (!editorArea.contains(e.relatedTarget as Node)) {
      editorArea.classList.remove('drag-over')
    }
  })

  editorArea.addEventListener('drop', async (e) => {
    e.preventDefault()
    editorArea.classList.remove('drag-over')

    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return

    const { path: mdPath } = getActiveTabInfo()
    if (!mdPath) {
      showToast(t('autoAsset.saveFirst'), 'info')
      return
    }

    for (const file of Array.from(files)) {
      if (!SUPPORTED_TYPES.has(file.type)) {
        showToast(t('autoAsset.unsupportedFormat', { name: file.name }), 'error')
        continue
      }

      // Electron provides file.path for local files dragged from OS
      const filePath = (file as File & { path?: string }).path
      if (!filePath) {
        showToast(t('autoAsset.missingPath', { name: file.name }), 'error')
        continue
      }

      const result = await window.vanfolioAPI.copyAsset(filePath, mdPath)

      if (result.success) {
        const altText = file.name.replace(/\.[^.]+$/, '')
        insertAtCursor(`![${altText}](${result.relativePath})`)
        showToast(t('autoAsset.added', { name: file.name }), 'success')
      } else {
        showToast(t('autoAsset.failed', { error: result.error }), 'error')
      }
    }
  })
}
