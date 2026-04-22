import type { SnapshotMeta } from '@shared/types'
import { getActiveTabInfo, restoreActiveTabContent } from './fileTabs'
import { showToast } from './toast'
import { t } from '@shared/i18n'

const OVERLAY_ID = 'version-history-overlay'
const CONFIRM_ID = 'version-history-confirm-overlay'

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function closeModal(): void {
  document.getElementById(OVERLAY_ID)?.remove()
}

function closeConfirm(): void {
  document.getElementById(CONFIRM_ID)?.remove()
}

export function showInlineConfirm(message: string): Promise<boolean> {
  closeConfirm()

  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.id = CONFIRM_ID
    overlay.className = 'vh-overlay'

    const modal = document.createElement('div')
    modal.className = 'vh-modal vh-confirm'

    const body = document.createElement('div')
    body.className = 'vh-body'

    const text = document.createElement('p')
    text.className = 'vh-confirm-text'
    text.textContent = message

    const actions = document.createElement('div')
    actions.className = 'vh-actions'

    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'vh-btn'
    cancelBtn.textContent = t('dialog.cancel')

    const confirmBtn = document.createElement('button')
    confirmBtn.className = 'vh-btn vh-btn-primary'
    confirmBtn.textContent = t('dialog.confirm')

    const cleanup = (value: boolean): void => {
      closeConfirm()
      resolve(value)
    }

    cancelBtn.addEventListener('click', () => cleanup(false))
    confirmBtn.addEventListener('click', () => cleanup(true))
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) cleanup(false)
    })
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') cleanup(false)
      if (event.key === 'Enter') cleanup(true)
    })

    actions.append(cancelBtn, confirmBtn)
    body.append(text, actions)
    modal.appendChild(body)
    overlay.appendChild(modal)
    document.body.appendChild(overlay)
    confirmBtn.focus()
  })
}

async function restoreSnapshot(snapshot: SnapshotMeta): Promise<void> {
  const active = getActiveTabInfo()
  if (!active.path) return
  const confirmed = await showInlineConfirm(t('versionHistory.restoreConfirm'))
  if (!confirmed) return

  const content = await window.vanfolioAPI.getSnapshotContent(active.path, snapshot.id)
  if (content === null) {
    showToast(t('versionHistory.restoreReadError'), 'error')
    return
  }

  restoreActiveTabContent(content)
  closeModal()
  showToast(t('versionHistory.restored'), 'success')
}

function createRow(snapshot: SnapshotMeta, filePath: string, refresh: () => Promise<void>): HTMLElement {
  const row = document.createElement('div')
  row.className = 'vh-row'

  const meta = document.createElement('div')
  meta.className = 'vh-meta'

  const title = document.createElement('div')
  title.className = 'vh-title'
  title.textContent = formatTime(snapshot.timestamp)

  const sub = document.createElement('div')
  sub.className = 'vh-subtitle'
  sub.textContent = `${formatBytes(snapshot.sizeBytes)} • ${snapshot.id}`

  meta.append(title, sub)

  const actions = document.createElement('div')
  actions.className = 'vh-actions'

  const restoreBtn = document.createElement('button')
  restoreBtn.className = 'vh-btn vh-btn-primary'
  restoreBtn.textContent = t('dialog.restore')
  restoreBtn.addEventListener('click', () => {
    restoreSnapshot(snapshot).catch(console.error)
  })

  const deleteBtn = document.createElement('button')
  deleteBtn.className = 'vh-btn'
  deleteBtn.textContent = t('dialog.delete')
  deleteBtn.addEventListener('click', async () => {
    if (!(await showInlineConfirm(t('versionHistory.deleteConfirm')))) return
    const ok = await window.vanfolioAPI.deleteSnapshot(filePath, snapshot.id)
    if (!ok) {
      showToast(t('versionHistory.deleteError'), 'error')
      return
    }
    showToast(t('versionHistory.deleted'), 'success')
    await refresh()
  })

  actions.append(restoreBtn, deleteBtn)
  row.append(meta, actions)
  return row
}

export async function openVersionHistoryModal(): Promise<void> {
  const active = getActiveTabInfo()
  if (!active.path) {
    showToast(t('versionHistory.openRequiresPath'), 'error')
    return
  }

  closeModal()

  const overlay = document.createElement('div')
  overlay.id = OVERLAY_ID
  overlay.className = 'vh-overlay'
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeModal()
  })

  const modal = document.createElement('div')
  modal.className = 'vh-modal'

  const header = document.createElement('div')
  header.className = 'vh-header'

  const titleWrap = document.createElement('div')
  const title = document.createElement('h3')
  title.textContent = t('versionHistory.title')
  const subtitle = document.createElement('p')
  subtitle.textContent = active.path.split(/[/\\]/).pop() ?? active.path
  titleWrap.append(title, subtitle)

  const closeBtn = document.createElement('button')
  closeBtn.className = 'vh-close'
  closeBtn.textContent = '×'
  closeBtn.addEventListener('click', closeModal)
  header.append(titleWrap, closeBtn)

  const body = document.createElement('div')
  body.className = 'vh-body'
  body.textContent = t('common.loading')

  const refresh = async (): Promise<void> => {
    const snapshots = await window.vanfolioAPI.listSnapshots(active.path!)
    body.innerHTML = ''
    if (snapshots.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'vh-empty'
      empty.textContent = t('versionHistory.empty')
      body.appendChild(empty)
      return
    }

    snapshots.forEach((snapshot) => {
      body.appendChild(createRow(snapshot, active.path!, refresh))
    })
  }

  modal.append(header, body)
  overlay.appendChild(modal)
  document.body.appendChild(overlay)
  await refresh()
}
