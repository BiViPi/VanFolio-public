// ─────────────────────────────────────────────────────────────────────────────
// Sidebar Module — Icon sidebar (52px) + Secondary sidebar (220px)
// Phase 3.2 Plan 02: SVG icons, editor mode, collapse, header action buttons
// ─────────────────────────────────────────────────────────────────────────────

import type { FileTreeNode, OpenFolderResult, LicenseTier } from '@shared/types'
import { createNewTab, openFileInTab } from './fileTabs'
import { openSettings } from './settings'
import { t } from '@shared/i18n'
import { bindFloatingTooltip } from './tooltip'

// ── T02-A: Type + SVG icon set ───────────────────────────────────────────────

type SidebarMode = 'files' | 'collections' | 'search' | 'bookmarks'

const SVG_AI_SPARKLE = '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>'

const ICON_SVGS: Record<SidebarMode | 'settings' | 'license-free' | 'license-trial' | 'license-pro', string> = {
  files: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
  collections: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  bookmarks: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  'license-free': '<circle cx="12" cy="12" r="10"/><path d="M9 12h6"/><path d="M12 9v6"/>', // Plus/Add Circle as "Free"
  'license-trial': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', // Clock for Trial
  'license-pro': '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>', // Star for Pro
}

const ICON_BUTTON_KEYS: Record<SidebarMode, string> = {
  files: 'sidebar.files',
  collections: 'sidebar.collections',
  search: 'sidebar.search',
  bookmarks: 'sidebar.bookmarks',
}

const ICON_BUTTONS: { id: SidebarMode; label: string }[] = [
  { id: 'files', label: 'Files' },
  { id: 'collections', label: 'Collections' },
  { id: 'search', label: 'Search' },
  { id: 'bookmarks', label: 'Bookmarks' },
]

// SVG paths for secondary sidebar header buttons
const SVG_NEW_FILE = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>'
const SVG_OPEN_FOLDER = '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'
const SVG_COLLAPSE = '<polyline points="15 18 9 12 15 6"/>'

// ── State ────────────────────────────────────────────────────────────────────

let currentMode: SidebarMode = 'files'
let currentTree: FileTreeNode[] | null = null
let currentFolderPath: string | null = null
let activeFilePath: string | null = null
let isSecondarySidebarCollapsed = false

// Async render stale-check token (finding #1)
let renderGeneration = 0

// One-time binding guards (finding #2)
let isActiveFileBound = false
let isOpenFolderBound = false
let isLoadFolderBound = false
let isI18nBound = false
let isLicenseBound = false

let _licenseTier: LicenseTier = 'free'
const onActiveFileEvent = (e: Event): void => {
  activeFilePath = (e as CustomEvent<{ path: string | null }>).detail.path
  syncActiveFile()

  // Refresh recents list if we are in 'files' mode so the newly opened file appears (BUG-FIX)
  if (currentMode === 'files') {
    renderSecondarySidebar()
  }
}

const onOpenFolderEvent = (): void => {
  handleOpenFolder()
}

const onLoadFolderEvent = (e: Event): void => {
  const result = (e as CustomEvent<OpenFolderResult>).detail
  if (!result) return
  currentTree = result.tree
  currentFolderPath = result.folderPath
  currentMode = 'collections'
  if (isSecondarySidebarCollapsed) {
    isSecondarySidebarCollapsed = false
    applyCollapsedState()
  }
  syncIconActive()
  renderSecondarySidebar()
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function initSidebar(): void {
  buildIconSidebar()
  renderSecondarySidebar()

  // Load initial license status without blocking sidebar render
  window.vanfolioAPI.getLicenseStatus().then((status) => {
    _licenseTier = status.tier
    updateLicenseBadge(status.tier)
  }).catch(() => { })

  if (!isActiveFileBound) {
    window.addEventListener('app:activeFile', onActiveFileEvent)
    isActiveFileBound = true
  }
  if (!isOpenFolderBound) {
    window.addEventListener('sidebar:openFolder', onOpenFolderEvent)
    isOpenFolderBound = true
  }
  if (!isLoadFolderBound) {
    window.addEventListener('sidebar:loadFolder', onLoadFolderEvent)
    isLoadFolderBound = true
  }
  if (!isI18nBound) {
    window.addEventListener('i18n:changed', () => renderSecondarySidebar())
    isI18nBound = true
  }
  if (!isLicenseBound) {
    // Listen to push events from main process (background validate, activate, deactivate)
    window.vanfolioAPI.onLicenseStatusChanged((status) => {
      if (status?.tier) {
        _licenseTier = status.tier
        updateLicenseBadge(status.tier)
      }
      // Re-dispatch as a DOM event so the settings tab can also react
      window.dispatchEvent(new CustomEvent('license:updated', { detail: status }))
    })
    // Also handle local-only events (e.g. from settings tab actions before main broadcast arrives)
    window.addEventListener('license:updated', (e: Event) => {
      const status = (e as CustomEvent).detail
      if (status?.tier && status.tier !== _licenseTier) {
        _licenseTier = status.tier
        updateLicenseBadge(status.tier)
      }
    })
    isLicenseBound = true
  }
}

// ── T02-B: SVG helper + Icon Sidebar builder ──────────────────────────────────

// Safe: pathData is a compile-time constant, never user input (G02-1)
function makeSvgIcon(pathData: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '18')
  svg.setAttribute('height', '18')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.5')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.innerHTML = pathData
  return svg
}

function setCustomTooltip(element: HTMLElement, label: string): void {
  bindFloatingTooltip(element, label, 'right')
}

function buildIconSidebar(): void {
  const bar = document.getElementById('icon-sidebar')
  if (!bar) return
  bar.innerHTML = ''

  for (const { id, label } of ICON_BUTTONS) {
    const btn = document.createElement('button')
    btn.className = 'icon-btn'
    setCustomTooltip(btn, t(ICON_BUTTON_KEYS[id]))
    btn.dataset.mode = id
    btn.appendChild(makeSvgIcon(ICON_SVGS[id]))
    btn.addEventListener('click', () => handleIconClick(id))
    bar.appendChild(btn)
  }

  // Spacer pushes AI + divider + Settings to bottom
  const spacer = document.createElement('div')
  spacer.className = 'sb-spacer'
  bar.appendChild(spacer)

  // AI Generate button — opens AI palette (Ctrl+G)
  const aiBtn = document.createElement('button')
  aiBtn.className = 'icon-btn icon-btn-ai'
  aiBtn.id = 'btn-ai-sidebar'
  setCustomTooltip(aiBtn, t('sidebar.aiGenerate'))
  aiBtn.appendChild(makeSvgIcon(SVG_AI_SPARKLE))
  aiBtn.addEventListener('click', () => window.dispatchEvent(new CustomEvent('ai:open')))
  aiBtn.style.display = 'none' // AI locked until Phase 4.5
  bar.appendChild(aiBtn)

  // Divider immediately above Settings
  const divider = document.createElement('div')
  divider.className = 'sb-divider'
  bar.appendChild(divider)

  const settingsBtn = document.createElement('button')
  settingsBtn.className = 'icon-btn'
  settingsBtn.id = 'btn-settings'
  setCustomTooltip(settingsBtn, t('sidebar.settings'))
  settingsBtn.appendChild(makeSvgIcon(ICON_SVGS.settings))
  settingsBtn.addEventListener('click', openSettings)
  bar.appendChild(settingsBtn)

  syncIconActive()
}

function updateLicenseBadge(tier: LicenseTier): void {
  _licenseTier = tier
}

// ── T02-C: State model — editor mode + collapsed state ────────────────────────

async function handleIconClick(mode: SidebarMode): Promise<void> {
  if (mode === 'collections' && !currentTree) {
    await handleOpenFolder()
    return
  }

  // Same icon clicked while panel is open → collapse (toggle off)
  if (!isSecondarySidebarCollapsed && currentMode === mode) {
    isSecondarySidebarCollapsed = true
    applyCollapsedState()
    syncIconActive()
    return
  }

  // Different icon or panel is collapsed → expand and switch
  isSecondarySidebarCollapsed = false
  applyCollapsedState()
  currentMode = mode
  syncIconActive()
  renderSecondarySidebar()
}

function applyCollapsedState(): void {
  const sidebar = document.getElementById('secondary-sidebar')
  if (!sidebar) return
  sidebar.classList.toggle('collapsed', isSecondarySidebarCollapsed)
  window.dispatchEvent(new CustomEvent('layout:sidebar-toggled'))
}

function syncIconActive(): void {
  document.querySelectorAll<HTMLElement>('#icon-sidebar .icon-btn').forEach(btn => {
    btn.classList.toggle('active', !isSecondarySidebarCollapsed && btn.dataset.mode === currentMode)
  })
}

export function toggleSecondarySidebar(): void {
  isSecondarySidebarCollapsed = !isSecondarySidebarCollapsed
  applyCollapsedState()
  syncIconActive()
}

export function setSecondarySidebarVisible(visible: boolean): void {
  isSecondarySidebarCollapsed = !visible
  applyCollapsedState()
  syncIconActive()
}

export function isSecondarySidebarVisible(): boolean {
  return !isSecondarySidebarCollapsed
}

// ── Folder Open ──────────────────────────────────────────────────────────────

async function handleOpenFolder(): Promise<void> {
  const result = await window.vanfolioAPI.openFolder()
  if (!result) return
  currentTree = result.tree
  currentFolderPath = result.folderPath
  currentMode = 'collections'
  if (isSecondarySidebarCollapsed) {
    isSecondarySidebarCollapsed = false
    applyCollapsedState()
  }
  syncIconActive()
  renderSecondarySidebar()
}

// ── Secondary Sidebar ────────────────────────────────────────────────────────

function renderSecondarySidebar(): void {
  const panel = document.getElementById('secondary-sidebar')
  if (!panel) return
  panel.innerHTML = ''
  renderGeneration++

  if (currentMode === 'collections') {
    renderCollectionsPanel(panel)
  } else if (currentMode === 'files') {
    renderFilesPanel(panel, renderGeneration).catch(console.error)
  } else {
    renderPlaceholderPanel(panel)
  }
}

// ── T02-E: Header builder with 3 action buttons ──────────────────────────────

function makeHeaderButton(svgPath: string, label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.className = 'sidebar-action-btn'
  bindFloatingTooltip(btn, label, 'bottom')
  btn.appendChild(makeSvgIcon(svgPath))
  btn.addEventListener('click', onClick)
  return btn
}

function buildSidebarHeader(title: string, folderTitle?: string): HTMLDivElement {
  const header = document.createElement('div')
  header.className = 'sidebar-header'

  const titleEl = document.createElement('span')
  titleEl.className = 'sidebar-title'
  titleEl.textContent = title
  if (folderTitle) titleEl.title = folderTitle
  header.appendChild(titleEl)

  const actions = document.createElement('div')
  actions.className = 'sidebar-header-actions'

  const newFileBtn = makeHeaderButton(SVG_NEW_FILE, t('sidebar.newFile'), () => createNewTab())
  const openFolderBtn = makeHeaderButton(SVG_OPEN_FOLDER, t('sidebar.openFolder'), () => handleOpenFolder())
  const collapseBtn = makeHeaderButton(SVG_COLLAPSE, t('sidebar.collapse'), () => {
    isSecondarySidebarCollapsed = true
    applyCollapsedState()
    syncIconActive()
  })

  actions.appendChild(newFileBtn)
  actions.appendChild(openFolderBtn)
  actions.appendChild(collapseBtn)
  header.appendChild(actions)

  return header
}

function renderCollectionsPanel(panel: HTMLElement): void {
  const folderName = currentFolderPath ? getFolderName(currentFolderPath) : t('sidebar.collections')
  panel.appendChild(buildSidebarHeader(folderName, currentFolderPath ?? undefined))

  if (currentTree && currentTree.length > 0) {
    panel.appendChild(buildTreeList(currentTree))
  } else {
    panel.appendChild(makeEmptyMessage(
      currentTree ? t('sidebar.noMarkdownFiles') : t('sidebar.openFolderHint')
    ))
  }
}

async function renderFilesPanel(panel: HTMLElement, token: number): Promise<void> {
  panel.appendChild(buildSidebarHeader(t('sidebar.recentFiles')))

  const recents = await window.vanfolioAPI.getRecentFiles()

  // Abort if a newer render has started (finding #1)
  if (token !== renderGeneration) return

  if (!recents || recents.length === 0) {
    panel.appendChild(makeEmptyMessage(t('sidebar.noRecentFiles')))
    return
  }

  const ul = document.createElement('ul')
  ul.className = 'tree-list'
  for (const filePath of recents) {
    const li = document.createElement('li')
    li.className = 'recent-file-row'

    const btn = document.createElement('button')
    btn.className = 'tree-file'
    btn.textContent = getFileName(filePath)
    btn.dataset.filePath = filePath
    bindFloatingTooltip(btn, filePath, 'right')
    if (filePath === activeFilePath) btn.classList.add('active')
    btn.addEventListener('click', async () => {
      activeFilePath = filePath
      syncActiveFile()
      const content = await window.vanfolioAPI.readFile(filePath)
      if (content === null) return
      openFileInTab({ path: filePath, content })
    })

    const removeBtn = document.createElement('button')
    removeBtn.className = 'recent-remove'
    bindFloatingTooltip(removeBtn, t('sidebar.removeFromRecent'), 'right')
    removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation()
      await window.vanfolioAPI.removeRecentFile(filePath)
      renderSecondarySidebar()
    })

    li.appendChild(btn)
    li.appendChild(removeBtn)
    ul.appendChild(li)
  }
  panel.appendChild(ul)
}

function renderPlaceholderPanel(panel: HTMLElement): void {
  const title = t(ICON_BUTTON_KEYS[currentMode])
  panel.appendChild(buildSidebarHeader(title))
  panel.appendChild(makeEmptyMessage(t('sidebar.comingSoon')))
}

function makeEmptyMessage(text: string): HTMLParagraphElement {
  const p = document.createElement('p')
  p.className = 'sidebar-empty'
  p.textContent = text
  return p
}

// ── Tree Builder ─────────────────────────────────────────────────────────────

function buildTreeList(nodes: FileTreeNode[]): HTMLUListElement {
  const ul = document.createElement('ul')
  ul.className = 'tree-list'

  for (const node of nodes) {
    const li = document.createElement('li')

    if (node.type === 'folder') {
      const details = document.createElement('details')

      const summary = document.createElement('summary')
      summary.className = 'tree-folder'
      summary.textContent = node.name
      details.appendChild(summary)

      if (node.children?.length) {
        details.appendChild(buildTreeList(node.children))
      }
      li.appendChild(details)
    } else {
      const btn = document.createElement('button')
      btn.className = 'tree-file'
      btn.textContent = node.name
      btn.dataset.filePath = node.path
      bindFloatingTooltip(btn, node.path, 'right')
      if (node.path === activeFilePath) btn.classList.add('active')
      btn.addEventListener('click', async () => {
        activeFilePath = node.path
        syncActiveFile()
        const content = await window.vanfolioAPI.readFile(node.path)
        if (content === null) return
        openFileInTab({ path: node.path, content })
      })
      li.appendChild(btn)
    }

    ul.appendChild(li)
  }

  return ul
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function syncActiveFile(): void {
  document.querySelectorAll<HTMLElement>('#secondary-sidebar .tree-file').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filePath === activeFilePath)
  })
}

function getFolderName(folderPath: string): string {
  return folderPath.split(/[/\\]/).filter(Boolean).pop() ?? folderPath
}

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath
}

// ── Auto-Hide Sidebar (Sprint 4) ──────────────────────────────────────────────

let _autoHideEnabled = false
let _hideTimer: ReturnType<typeof setTimeout> | null = null

export function setAutoHideSidebar(enabled: boolean): void {
  _autoHideEnabled = enabled
  const sidebar = document.getElementById('icon-sidebar')
  const trigger = document.getElementById('sidebar-hover-trigger')
  if (!sidebar || !trigger) return

  if (enabled) {
    sidebar.classList.add('auto-hidden')
    trigger.style.display = 'block'
  } else {
    sidebar.classList.remove('auto-hidden')
    trigger.style.display = 'none'
    if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null }
  }

  window.vanfolioAPI.saveSettings({ autoHideSidebar: enabled })
}

export function initAutoHideSidebar(enabled: boolean): void {
  _autoHideEnabled = enabled
  const iconSidebar = document.getElementById('icon-sidebar')
  const secondarySidebar = document.getElementById('secondary-sidebar')
  const trigger = document.getElementById('sidebar-hover-trigger')
  if (!iconSidebar || !trigger) return

  function showSidebar() {
    if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null }
    iconSidebar!.classList.remove('auto-hidden')
  }

  function scheduleHide() {
    if (!_autoHideEnabled) return
    _hideTimer = setTimeout(() => {
      iconSidebar!.classList.add('auto-hidden')
      _hideTimer = null
    }, 300)
  }

  // Hover trigger zone → show sidebar
  trigger.addEventListener('mouseenter', () => {
    if (!_autoHideEnabled) return
    showSidebar()
  })

  // Keep visible while mouse is inside icon sidebar
  iconSidebar.addEventListener('mouseenter', () => {
    if (!_autoHideEnabled) return
    showSidebar()
  })

  iconSidebar.addEventListener('mouseleave', (e) => {
    if (!_autoHideEnabled) return
    // Don't schedule hide if moving into secondary sidebar
    if (secondarySidebar && secondarySidebar.contains(e.relatedTarget as Node)) return
    scheduleHide()
  })

  // Keep visible while mouse is inside secondary sidebar (Finding 1 fix)
  if (secondarySidebar) {
    secondarySidebar.addEventListener('mouseenter', () => {
      if (!_autoHideEnabled) return
      showSidebar()
    })

    secondarySidebar.addEventListener('mouseleave', (e) => {
      if (!_autoHideEnabled) return
      // Don't schedule hide if moving back into icon sidebar
      if (iconSidebar.contains(e.relatedTarget as Node)) return
      scheduleHide()
    })
  }

  // Apply initial state
  if (enabled) {
    iconSidebar.classList.add('auto-hidden')
    trigger.style.display = 'block'
  }
}
