// ─────────────────────────────────────────────────────────────────────────────
// Titlebar Menu Dropdowns — 100% renderer-owned (Phase 3.2 D1)
// All 5 menus: File / Edit / View / Export / Help
// ─────────────────────────────────────────────────────────────────────────────

import { t } from '@shared/i18n'
import { toggleFocusMode } from './focusMode'
import { toggleToc } from './tocToggle'
import { createNewTab, openFileInTab, saveCurrentTab, saveCurrentTabAs } from './fileTabs'
import { openExportModal } from './exportModal'
import { showToast } from './toast'
import { editorCopy, editorCut, editorPaste, setTypewriterMode, setFadeContext } from './editor'
import { isTypewriterEnabled, isFadeEnabled } from './writingModes'
import { getAllShortcuts, setKey, resetKey, eventToKeyString, matchesShortcut } from './shortcuts'
import { toggleActiveFilePreview } from './previewDetach'
import { openDocsModal, initDocsModal } from './docsModal'
import { openAboutModal, initAboutModal } from './aboutLicenseModal'
import { hasCapability } from './licenseGate'
import { showUpgradePrompt } from './upgradePrompt'

let isBound = false
let updateCheckPending = false

const closeAll = (): void => {
  document.querySelectorAll('.menu-item.open').forEach((el) => el.classList.remove('open'))
}

const onDocClick = (e: MouseEvent): void => {
  const target = e.target as HTMLElement
  if (!target.closest('.menu-item')) closeAll()
}

/** Wire a dropdown item by ID — closes menu then runs action. */
function dd(id: string, action: () => void): void {
  document.getElementById(id)?.addEventListener('click', () => {
    closeAll()
    action()
  })
}

function setUpdateCheckPending(pending: boolean): void {
  updateCheckPending = pending
  const button = document.getElementById('dd-check-updates') as HTMLButtonElement | null
  if (!button) return
  button.disabled = pending
  button.setAttribute('aria-disabled', String(pending))
}

async function performUpdateCheck(force: boolean, showCheckingToast: boolean): Promise<void> {
  if (updateCheckPending) return

  setUpdateCheckPending(true)
  if (showCheckingToast) showToast(t('update.checking'), 'info')

  try {
    const result = await window.vanfolioAPI.checkForUpdates(force)
    if (result.status === 'update-available' && result.updateInfo) {
      showToast(t('update.available', { version: result.updateInfo.version }), 'info', {
        label: t('update.btn.download'),
        onClick: () => window.vanfolioAPI.openExternal(result.updateInfo!.downloadUrl)
      })
      return
    }

    if (showCheckingToast) {
      if (result.status === 'up-to-date') showToast(t('update.upToDate'), 'success')
      else showToast(t('update.failed'), 'error')
    }
  } catch (err) {
    console.error('[menu] update check error:', err)
    if (showCheckingToast) showToast(t('update.failed'), 'error')
  } finally {
    setUpdateCheckPending(false)
  }
}

/** Update Pro badges in View menu when license status changes */
async function updateMenuProBadges(): Promise<void> {
  const typewriterItem = document.getElementById('dd-typewriter')
  const fadeItem = document.getElementById('dd-fade-context')

  if (typewriterItem) {
    const badge = typewriterItem.querySelector<HTMLElement>('.badge-pro')
    const hasAccess = await hasCapability('editor.typewriterMode')
    if (badge) badge.style.display = hasAccess ? 'none' : ''
    updateWritingModeCheck('dd-typewriter-check', hasAccess && isTypewriterEnabled())
  }

  if (fadeItem) {
    const badge = fadeItem.querySelector<HTMLElement>('.badge-pro')
    const hasAccess = await hasCapability('editor.fadeContext')
    if (badge) badge.style.display = hasAccess ? 'none' : ''
    updateWritingModeCheck('dd-fade-check', hasAccess && isFadeEnabled())
  }
}

export function initTitlebarMenu(): void {
  if (isBound) return
  isBound = true

  // Toggle open/close on menu button click
  document.querySelectorAll('.menu-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const item = (btn as HTMLElement).closest('.menu-item')
      if (!item) return
      const isOpen = item.classList.contains('open')
      closeAll()
      if (!isOpen) item.classList.add('open')
    })
  })

  // Outside-click dismiss
  document.addEventListener('click', onDocClick)

  // ── File menu ──────────────────────────────────────────────────────────────
  dd('dd-new-file', () => createNewTab())
  dd('dd-open-file', () => {
    window.vanfolioAPI.openFile().then((result) => {
      if (result) openFileInTab(result)
    }).catch(console.error)
  })
  dd('dd-open-folder', () => window.dispatchEvent(new CustomEvent('sidebar:openFolder')))
  dd('dd-save', () => saveCurrentTab().catch(console.error))
  dd('dd-save-as', () => saveCurrentTabAs().catch(console.error))
  dd('dd-exit', () => window.vanfolioAPI.closeWindow())

  // ── Edit menu ──────────────────────────────────────────────────────────────
  dd('dd-undo', () => window.dispatchEvent(new CustomEvent('editor:undo')))
  dd('dd-redo', () => window.dispatchEvent(new CustomEvent('editor:redo')))
  dd('dd-cut', editorCut)
  dd('dd-copy', editorCopy)
  dd('dd-paste', editorPaste)

  // ── View menu ──────────────────────────────────────────────────────────────
  dd('dd-focus-mode', toggleFocusMode)
  dd('dd-toc-toggle', toggleToc)

  const toggleTypewriter = async () => {
    if (!(await hasCapability('editor.typewriterMode'))) {
      showUpgradePrompt(t('menu.view.typewriter'))
      return
    }
    const enabled = !isTypewriterEnabled()
    setTypewriterMode(enabled)
    updateWritingModeCheck('dd-typewriter-check', enabled)
    window.vanfolioAPI.saveSettings({ typewriterMode: enabled })
  }

  const toggleFade = async () => {
    if (!(await hasCapability('editor.fadeContext'))) {
      showUpgradePrompt(t('menu.view.fadeContext'))
      return
    }
    const enabled = !isFadeEnabled()
    setFadeContext(enabled)
    updateWritingModeCheck('dd-fade-check', enabled)
    window.vanfolioAPI.saveSettings({ fadeContext: enabled })
  }

  dd('dd-typewriter', toggleTypewriter)
  dd('dd-fade-context', toggleFade)

  // ── Export menu ────────────────────────────────────────────────────────────
  dd('dd-export-pdf', () => openExportModal('pdf'))
  dd('dd-export-docx', () => openExportModal('docx'))
  dd('dd-export-html', () => openExportModal('html'))
  dd('dd-export-png', () => openExportModal('png'))

  // ── Help menu ──────────────────────────────────────────────────────────────
  initDocsModal()
  initAboutModal()
  dd('dd-docs', () => { openDocsModal().catch(console.error) })
  dd('dd-shortcuts', openShortcutsModal)
  // Re-render shortcuts modal title on language change
  window.addEventListener('i18n:changed', () => {
    const title = document.getElementById('shortcuts-title')
    if (title) title.textContent = t('shortcuts.title')
  })

  dd('dd-check-updates', async () => {
    await performUpdateCheck(true, true)
  })

  dd('dd-about', () => {
    openAboutModal().catch(console.error)
  })

  // Shortcuts modal close
  document.getElementById('shortcuts-close')?.addEventListener('click', closeShortcutsModal)
  document.getElementById('shortcuts-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeShortcutsModal()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeShortcutsModal()
  })

  // ── License listener: Update Pro badges in View menu ────────────────────
  window.addEventListener('license:updated', () => {
    updateMenuProBadges().catch(console.error)
  })

  updateMenuProBadges().catch(console.error)

  // ── Keyboard shortcuts (replace native accelerators) ────────────────────
  document.addEventListener('keydown', onKeyDown)
}

export async function runStartupUpdateCheck(): Promise<void> {
  await performUpdateCheck(false, false)
}

// ── Shortcuts Modal ────────────────────────────────────────────────────────
let editingId: string | null = null

function openShortcutsModal(): void {
  // Update title and hint with current locale
  const titleEl = document.querySelector('#shortcuts-modal h2')
  if (titleEl) titleEl.textContent = t('shortcuts.modalTitle')
  const hintEl = document.querySelector('.shortcuts-hint')
  if (hintEl) {
    const editWord = `<strong>${t('shortcuts.edit')}</strong>`
    hintEl.innerHTML = t('shortcuts.hint', { edit: editWord })
  }
  renderShortcutsTable()
  document.getElementById('shortcuts-overlay')?.classList.add('open')
}

function closeShortcutsModal(): void {
  cancelEdit()
  document.getElementById('shortcuts-overlay')?.classList.remove('open')
}

function renderShortcutsTable(): void {
  const tbody = document.getElementById('shortcuts-tbody')
  if (!tbody) return

  const shortcuts = getAllShortcuts()
  const groups = [...new Set(shortcuts.map((s) => s.group))]

  tbody.innerHTML = ''
  groups.forEach((group) => {
    // Group header row
    const headerRow = document.createElement('tr')
    const headerCell = document.createElement('td')
    headerCell.colSpan = 3
    headerCell.className = 'shortcuts-group'
    headerCell.textContent = t(`shortcuts.group.${group.toLowerCase()}`)
    headerRow.appendChild(headerCell)
    tbody.appendChild(headerRow)

    // Shortcut rows
    shortcuts.filter((s) => s.group === group).forEach((s) => {
      const row = document.createElement('tr')
      row.dataset.id = s.id
      row.className = 'shortcuts-row'

      const labelCell = document.createElement('td')
      labelCell.textContent = t(`shortcuts.label.${s.id}`)

      const keyCell = document.createElement('td')
      keyCell.className = 'shortcuts-key-cell'
      const kbd = document.createElement('kbd')
      kbd.textContent = s.currentKey
      if (s.isCustom) kbd.classList.add('is-custom')
      keyCell.appendChild(kbd)

      const actionsCell = document.createElement('td')
      actionsCell.className = 'shortcuts-actions'

      const editBtn = document.createElement('button')
      editBtn.className = 'shortcuts-edit-btn'
      editBtn.textContent = t('shortcuts.edit')
      editBtn.addEventListener('click', () => startEdit(s.id, row))
      actionsCell.appendChild(editBtn)

      if (s.isCustom) {
        const resetBtn = document.createElement('button')
        resetBtn.className = 'shortcuts-reset-btn'
        resetBtn.textContent = t('shortcuts.reset')
        resetBtn.addEventListener('click', () => {
          resetKey(s.id)
          renderShortcutsTable()
        })
        actionsCell.appendChild(resetBtn)
      }

      row.appendChild(labelCell)
      row.appendChild(keyCell)
      row.appendChild(actionsCell)
      tbody.appendChild(row)
    })
  })
}

function startEdit(id: string, row: HTMLTableRowElement): void {
  // Cancel any existing edit
  cancelEdit()
  editingId = id

  row.classList.add('editing')
  const keyCell = row.querySelector('.shortcuts-key-cell')
  if (!keyCell) return

  const hint = document.createElement('span')
  hint.className = 'shortcuts-capture-hint'
  hint.textContent = t('titlebar.pressNewShortcut')
  keyCell.innerHTML = ''
  keyCell.appendChild(hint)

  const onCapture = (e: KeyboardEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      cancelEdit()
      renderShortcutsTable()
      document.removeEventListener('keydown', onCapture, true)
      return
    }
    const keyStr = eventToKeyString(e)
    if (!keyStr || ['Ctrl', 'Alt', 'Shift'].includes(keyStr)) return
    setKey(id, keyStr)
    editingId = null
    document.removeEventListener('keydown', onCapture, true)
    renderShortcutsTable()
  }
  document.addEventListener('keydown', onCapture, true)
}

function cancelEdit(): void {
  if (editingId) {
    editingId = null
  }
}

// ── Keyboard shortcuts (replace native accelerators) ────────────────────────
const onKeyDown = async (e: KeyboardEvent): Promise<void> => {
  const ctrl = e.ctrlKey || e.metaKey
  if (!ctrl) return

  const tag = (e.target as HTMLElement).tagName
  const inInput = tag === 'INPUT' || tag === 'TEXTAREA'

  if (matchesShortcut(e, 'new-file') && !inInput) { e.preventDefault(); createNewTab() }
  if (matchesShortcut(e, 'open-file') && !inInput) {
    e.preventDefault()
    window.vanfolioAPI.openFile().then((result) => {
      if (result) openFileInTab(result)
    }).catch(console.error)
  }
  if (matchesShortcut(e, 'open-folder') && !inInput) {
    e.preventDefault()
    window.dispatchEvent(new CustomEvent('sidebar:openFolder'))
  }
  if (matchesShortcut(e, 'save')) { e.preventDefault(); saveCurrentTab().catch(console.error) }
  if (matchesShortcut(e, 'save-as')) { e.preventDefault(); saveCurrentTabAs().catch(console.error) }
  if (matchesShortcut(e, 'export-pdf') && !inInput) { e.preventDefault(); openExportModal('pdf') }
  if (matchesShortcut(e, 'focus-mode') && !inInput) { e.preventDefault(); toggleFocusMode() }
  if (matchesShortcut(e, 'toc-toggle') && !inInput) { e.preventDefault(); toggleToc() }
  if (matchesShortcut(e, 'typewriter') && !inInput) {
    e.preventDefault()
    if (!(await hasCapability('editor.typewriterMode'))) {
      showUpgradePrompt(t('menu.view.typewriter'))
      return
    }
    const enabled = !isTypewriterEnabled()
    setTypewriterMode(enabled)
    updateWritingModeCheck('dd-typewriter-check', enabled)
    window.vanfolioAPI.saveSettings({ typewriterMode: enabled })
  }
  if (matchesShortcut(e, 'fade-context') && !inInput) {
    e.preventDefault()
    if (!(await hasCapability('editor.fadeContext'))) {
      showUpgradePrompt(t('menu.view.fadeContext'))
      return
    }
    const enabled = !isFadeEnabled()
    setFadeContext(enabled)
    updateWritingModeCheck('dd-fade-check', enabled)
    window.vanfolioAPI.saveSettings({ fadeContext: enabled })
  }
  if (matchesShortcut(e, 'detach-preview') && !inInput) {
    e.preventDefault()
    toggleActiveFilePreview()
  }
}

function updateWritingModeCheck(id: string, enabled: boolean): void {
  const el = document.getElementById(id)
  if (el) el.style.visibility = enabled ? 'visible' : 'hidden'
}

