// ─────────────────────────────────────────────────────────────────────────────
// Preview Detach — Multi-window (v2)
// Main process is source of truth. Renderer caches a mirror Set to avoid IPC
// on every tab switch.
//
// Identity:
//   fileKey = tab.path  (saved file)
//   fileKey = tab.tabId (untitled)
// ─────────────────────────────────────────────────────────────────────────────

import { rerenderPreview, getCurrentPreviewHtml, getCurrentScrollRatio } from './preview'
import { getActiveFileKey, getActiveTabInfo } from './fileTabs'
import { hasCapability } from './licenseGate'
import { showUpgradePrompt } from './upgradePrompt'
import { t } from '@shared/i18n'

// Mirror of which fileKeys currently have a pinned preview window.
// Updated exclusively via handlePreviewAttachedEvent() — never mutated locally.
const _detachedFiles = new Set<string>()

export function isFileDetached(fileKey: string): boolean {
  return _detachedFiles.has(fileKey)
}

export function isPreviewDetached(): boolean {
  return _detachedFiles.size > 0
}

/**
 * Called from the PREVIEW_ATTACHED IPC handler in renderer/main.ts.
 * Main process is the source of truth — only update state from here.
 */
export function handlePreviewAttachedEvent(fileKey: string, attached: boolean): void {
  if (attached) {
    _detachedFiles.add(fileKey)
    // Detaching the active file should immediately hide the inline preview panel.
    if (fileKey === getActiveFileKey()) {
      document.getElementById('preview-panel')?.classList.add('hidden')
    }
  } else {
    _detachedFiles.delete(fileKey)
    // If this was the active file's window, restore inline preview panel
    if (fileKey === getActiveFileKey()) {
      _onReattached()
    }
  }
  _syncPinButtonForKey(fileKey)
  window.dispatchEvent(new CustomEvent('preview:detach-state-changed'))
}

/**
 * Called when switching tabs — syncs pin button to reflect the new active tab's state.
 */
export function syncPinButtonForActiveTab(): void {
  const fileKey = getActiveFileKey()
  _syncPinButtonForKey(fileKey)

  // If the newly active tab's preview is detached, hide the inline panel
  if (_detachedFiles.has(fileKey)) {
    document.getElementById('preview-panel')?.classList.add('hidden')
  } else {
    document.getElementById('preview-panel')?.classList.remove('hidden')
    rerenderPreview()
  }
  window.dispatchEvent(new CustomEvent('preview:detach-state-changed'))
}

/**
 * Hydrate _detachedFiles from main process on app init / session restore.
 * Call once during init sequence.
 */
export async function hydrateDetachedState(): Promise<void> {
  try {
    const keys = await window.vanfolioAPI.getDetachedFileKeys()
    _detachedFiles.clear()
    keys.forEach(k => _detachedFiles.add(k))
    syncPinButtonForActiveTab()
  } catch {
    // non-critical
  }
}

/**
 * Toggle pin for the currently active tab.
 * Builds snapshot from live preview state and sends to main.
 */
export async function toggleActiveFilePreview(): Promise<void> {
  if (!(await hasCapability('preview.detach'))) {
    showUpgradePrompt(t('preview.detach'))
    return
  }
  const fileKey = getActiveFileKey()
  const { path: sourcePath, displayName } = getActiveTabInfo()
  const html = getCurrentPreviewHtml()
  const scrollRatio = getCurrentScrollRatio()
  const theme = document.documentElement.getAttribute('data-theme') ?? ''
  const zoom = Number.parseFloat(
    ((document.getElementById('preview-content')?.style as CSSStyleDeclaration & { zoom?: string })?.zoom || '1').toString()
  )

  window.vanfolioAPI.togglePreviewFile({
    fileKey,
    title: displayName,
    html,
    scrollRatio,
    settings: { theme, zoom: Number.isFinite(zoom) ? zoom : 1 },
    sourcePath,
  })
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _syncPinButtonForKey(fileKey: string): void {
  // Only update the button if this fileKey matches the active tab
  if (fileKey !== getActiveFileKey()) return
  const isPinned = _detachedFiles.has(fileKey)
  document.getElementById('btn-detach-preview')?.classList.toggle('active', isPinned)
}

function _onReattached(): void {
  document.getElementById('preview-panel')?.classList.remove('hidden')
  document.getElementById('btn-detach-preview')?.classList.remove('active')
  rerenderPreview()
}
