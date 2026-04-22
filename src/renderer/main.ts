// ─────────────────────────────────────────────────────────────────────────────
// VanFolio Renderer — Entry Point
// Initializes app, loads settings, wires modules
// ─────────────────────────────────────────────────────────────────────────────

import { initI18n, t } from '@shared/i18n'
import { initEditor, getEditorContent, focusEditor } from './editor'
import { initPreview, applyPreviewLayout } from './preview'
import { initToolbar } from './toolbar'
import { initSlashCommand, initSlashCommandLicenseListener } from './slashCommand'
import { initFloatingToolbar } from './floatingToolbar'
import { initWritingModes } from './writingModes'
import { initSidebar, initAutoHideSidebar } from './sidebar'
import { initLicenseGate } from './licenseGate'
import { initAutoAsset } from './autoAsset'
import { initFileTabs, openFileInTab, saveCurrentTab, saveCurrentTabAs, syncInitialContent, hasDirtyTabs, getTabsState, restoreTabs } from './fileTabs'
import { initFocusMode } from './focusMode'
import { initExportModal, openExportModal, setExportDefaults } from './exportModal'
import { initSettings } from './settings'
import { initFontLibrary } from './fontLibrary'
// import { initAiPalette } from './aiPalette'
import { initTocToggle } from './tocToggle'
import { initTitlebarMenu, runStartupUpdateCheck } from './titlebarMenu'
import { initDragResize } from './dragResize'
import { initStatusbar } from './statusbar'
import { initPanelToggles } from './panelToggles'
import { initPreviewRuler } from './previewRuler'
import { maybeShowOnboarding } from './onboarding'
import { maybeInitDiscovery } from './discovery'
import { handlePreviewAttachedEvent, hydrateDetachedState, syncPinButtonForActiveTab } from './previewDetach'
import { syncFloatingTooltips } from './tooltip'

async function init(): Promise<void> {
  // 1. Load settings and apply theme
  const settings = await window.vanfolioAPI.getSettings()
  document.documentElement.setAttribute('data-theme', settings.theme)

  // 1a. Init i18n — use saved locale from settings (auto-detected on first run by storeManager)
  initI18n(settings.locale ?? 'en')
  applyDataI18n()
  window.addEventListener('i18n:changed', applyDataI18n)

  // 2. Initialize modules in dependency order
  // ⚠️ BUG-4 fix: initPreview MUST come before initFileTabs/restoreTabs
  // so the app:activeFile listener is registered before tabs dispatch the event.
  // Otherwise _currentFilePath stays null → images don't resolve.
  initPreview(settings)
  initLicenseGate()

  initFileTabs()
  initEditor(settings)
  // Sync editor's welcome-text into the Untitled tab so Save captures what's on screen (finding #2)
  syncInitialContent(getEditorContent())

  // 2a. Session restore — ask user if previous session found
  // ⚠️ window.confirm() is a native dialog that steals OS-level focus from
  // the Electron renderer process. Use a custom in-page dialog instead so
  // the WebContents never lose focus and the editor stays typeable.
  try {
    const shouldPromptRecovery = await window.vanfolioAPI.getSessionRecoveryPending()
    const session = await window.vanfolioAPI.restoreSession()
    if (shouldPromptRecovery && session && session.openTabs.length > 0) {
      const count = session.openTabs.length
      const msg = count === 1
        ? t('session.restorePrompt').replace('{count}', '1')
        : t('session.restorePromptPlural').replace('{count}', String(count))
      const shouldRestore = await showInPageConfirm(msg)
      if (shouldRestore) {
        restoreTabs(session)
        focusEditor()
      } else {
        await window.vanfolioAPI.clearSession()
      }
    }
  } catch (err) {
    console.error('[session] restore error:', err)
  }

  // 2b. Auto-persist session every 30s
  const persistSession = (): void => {
    const state = getTabsState()
    window.vanfolioAPI.saveSession(state).catch(console.error)
  }
  setInterval(persistSession, 30_000)

  // 2c. Persist session before page unload
  window.addEventListener('beforeunload', persistSession)
  // ── Critical path: remaining UI must be ready before first paint ──
  initToolbar()
  initSidebar()
  initPanelToggles()
  initDragResize()
  applyPreviewLayout(settings.paperSize, settings.paperOrientation)

  // ── Deferred init (T24): non-critical modules after first paint ──
  requestAnimationFrame(() => {
    initSlashCommand()
    initSlashCommandLicenseListener()
    initFloatingToolbar()
    initWritingModes(settings)
    initAutoHideSidebar(settings.autoHideSidebar ?? true)
    initAutoAsset()
    initFocusMode()
    // initAiPalette() — disabled: AI features locked until Phase 4.5
    initTocToggle()
    initTitlebarMenu()
    initStatusbar()
    initExportModal()
    setExportDefaults(settings.paperSize, settings.paperOrientation)
    initFontLibrary()
      .catch((error) => {
        console.error('[fontLibrary] init failed:', error)
      })
      .then(() => {
        initSettings(settings)
        initPreviewRuler()
        // initRuler() — removed in Phase 4.2

        // Show onboarding on first launch, then start Discovery Mode
        return maybeShowOnboarding(settings.theme)
          .then(() => maybeInitDiscovery())
      })
      .then(() => hydrateDetachedState().catch(() => { /* non-critical */ }))
      .then(() => runStartupUpdateCheck())
      .catch(console.error)
  })

  // 3. Wire menu events from main process
  window.vanfolioAPI.onMenuOpenFile(async () => {
    const result = await window.vanfolioAPI.openFile()
    if (result) openFileInTab(result)
  })

  window.vanfolioAPI.onMenuSave(() => {
    saveCurrentTab()
  })

  window.vanfolioAPI.onMenuSaveAs(() => {
    saveCurrentTabAs()
  })

  window.vanfolioAPI.onMenuExport((format) => {
    openExportModal(format)
  })

  // 4. Wire window controls (⚠️ GOTCHA G7: must go through API, not ipcRenderer)
  document.getElementById('btn-minimize')?.addEventListener('click', () =>
    window.vanfolioAPI.minimizeWindow()
  )
  document.getElementById('btn-maximize')?.addEventListener('click', () =>
    window.vanfolioAPI.maximizeWindow()
  )
  // Swap maximize icon based on actual window state from main process
  window.vanfolioAPI.onWindowMaximizedChanged((isMaximized) => {
    document.getElementById('btn-maximize')?.classList.toggle('is-maximized', isMaximized)
  })
  document.getElementById('btn-close')?.addEventListener('click', () =>
    window.vanfolioAPI.closeWindow()
  )

  // 5. Wire preview toolbar export buttons
  document.getElementById('btn-export-pdf')?.addEventListener('click', () => openExportModal('pdf'))
  document.getElementById('btn-export-html')?.addEventListener('click', () => openExportModal('html'))
  document.getElementById('btn-export-png')?.addEventListener('click', () => openExportModal('png'))
  document.getElementById('btn-export-docx')?.addEventListener('click', () => openExportModal('docx'))

  // 6. Register app-close dirty-state query (S7-2)
  window.vanfolioAPI.onAppQueryDirty(() => hasDirtyTabs())
  window.vanfolioAPI.onAppConfirmClose(() => showInPageConfirm(
    t('main.unsavedChangesMessage'),
    t('main.discardClose')
  ))

  // Main notifies renderer when a pinned window opens or closes
  window.vanfolioAPI.onPreviewAttached(({ fileKey, attached }) => {
    handlePreviewAttachedEvent(fileKey, attached)
  })

  // Listen for tab switches to sync the pin button
  window.addEventListener('app:activeFile', () => {
    syncPinButtonForActiveTab()
  })

  console.log('VanFolio renderer initialized')
}

// ── Preview-only mode detection ───────────────────────────────────────────────
// When opened as a detached preview window (?mode=preview-only), skip all
// editor/sidebar/settings modules and only init the preview pane.
const _urlParams = new URLSearchParams(window.location.search)
if (_urlParams.get('mode') === 'preview-only') {
  initPreviewOnlyMode()
} else {
  init().catch(console.error)
}

function initPreviewOnlyMode(): void {
  // Single data attribute — CSS handles hiding all chrome via scoped selector
  document.body.dataset.windowMode = 'preview-only'

  // Read the pinned fileKey from query param — this window only reacts to its own file
  const pinnedFileKey = _urlParams.get('fileKey') ?? null

  // Apply system locale best-effort (no full i18n init needed for preview-only)
  window.vanfolioAPI.getSystemLocale()
    .then((locale) => { initI18n(locale) })
    .catch(() => { /* non-critical */ })

  // Wire win controls for the frameless preview window
  document.getElementById('btn-minimize')?.addEventListener('click', () => window.vanfolioAPI.minimizeWindow())
  document.getElementById('btn-maximize')?.addEventListener('click', () => window.vanfolioAPI.maximizeWindow())
  document.getElementById('btn-close')?.addEventListener('click', () => window.vanfolioAPI.closeWindow())
  document.getElementById('titlebar')?.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).closest('button, .titlebar-menu, .titlebar-logo')) return
    window.vanfolioAPI.maximizeWindow()
  })

  // Bootstrap: receive full initial state from main process after did-finish-load
  window.vanfolioAPI.onPreviewBootstrap((snapshot) => {
    const container = document.getElementById('preview-content')
    if (container) {
      container.innerHTML = snapshot.html
    }
    // Set title in custom titlebar
    const titleEl = document.getElementById('preview-title')
    if (titleEl) titleEl.textContent = snapshot.title
    // Apply initial settings
    if (typeof snapshot.settings.theme === 'string') {
      document.documentElement.setAttribute('data-theme', snapshot.settings.theme)
    }
    if (typeof snapshot.settings.zoom === 'number') {
      const container2 = document.getElementById('preview-content')
      if (container2) {
        ; (container2.style as CSSStyleDeclaration & { zoom: string }).zoom = String(snapshot.settings.zoom)
      }
    }
    // Apply initial scroll
    const scroller = document.getElementById('preview-panel')
    if (scroller && snapshot.scrollRatio > 0) {
      // Defer until layout is ready
      requestAnimationFrame(() => {
        const maxScrollTop = Math.max(scroller.scrollHeight - scroller.clientHeight, 0)
        scroller.scrollTop = snapshot.scrollRatio * maxScrollTop
      })
    }
  })

  // Listen: receive HTML updates — only apply if this is our pinned file
  window.vanfolioAPI.onPreviewUpdate(({ html }) => {
    // Main already routed this to the correct window — just apply
    const container = document.getElementById('preview-content')
    if (container) container.innerHTML = html
  })

  // Listen: sync scroll position
  window.vanfolioAPI.onPreviewScroll(({ scrollRatio }) => {
    const scroller = document.getElementById('preview-panel')
    if (scroller) {
      const maxScrollTop = Math.max(scroller.scrollHeight - scroller.clientHeight, 0)
      scroller.scrollTop = scrollRatio * maxScrollTop
    }
  })

  // Listen: settings changes (theme, zoom) — broadcast to all windows
  window.vanfolioAPI.onPreviewSettings((payload) => {
    if (typeof payload.theme === 'string') {
      document.documentElement.setAttribute('data-theme', payload.theme)
    }
    if (typeof payload.zoom === 'number') {
      const container = document.getElementById('preview-content')
      if (container) {
        ; (container.style as CSSStyleDeclaration & { zoom: string }).zoom = String(payload.zoom)
      }
    }
  })

  console.log(`VanFolio preview-only mode initialized (fileKey: ${pinnedFileKey ?? 'unknown'})`)
}


/**
 * Scan all [data-i18n] elements and update textContent.
 * Scan all [data-i18n-placeholder] inputs and update placeholder.
 * Called on init and on 'i18n:changed'.
 */
function applyDataI18n(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n!
    el.textContent = t(key)
  })
  document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((el) => {
    const key = el.dataset.i18nPlaceholder!
    el.placeholder = t(key)
  })
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const key = el.dataset.i18nTitle!
    el.title = t(key)
  })
  syncFloatingTooltips('#titlebar-toggles button[title], #win-controls button[title], #preview-toolbar button[title], #floating-toolbar button[title], #zen-settings-btn[title], #zen-close-btn[title], #ai-cancel[title]', 'bottom')
}

/**
 * In-page confirm dialog — avoids window.confirm() which steals OS-level
 * focus from the Electron renderer, making the editor non-typeable.
 * Resolves true (OK) or false (Cancel).
 */
function showInPageConfirm(message: string, confirmLabel = t('dialog.restore')): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'in-page-confirm-overlay'

    const box = document.createElement('div')
    box.className = 'in-page-confirm-box'

    const msg = document.createElement('p')
    msg.textContent = message

    const btns = document.createElement('div')
    btns.className = 'in-page-confirm-btns'

    const cancel = document.createElement('button')
    cancel.className = 'btn-confirm-cancel'
    cancel.textContent = t('dialog.cancel')

    const ok = document.createElement('button')
    ok.className = 'btn-confirm-ok'
    ok.textContent = confirmLabel

    const cleanup = (result: boolean): void => {
      overlay.remove()
      resolve(result)
    }

    cancel.addEventListener('click', () => cleanup(false))
    ok.addEventListener('click', () => cleanup(true))

    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); cleanup(true) }
      if (e.key === 'Escape') { e.preventDefault(); cleanup(false) }
    })

    btns.appendChild(cancel)
    btns.appendChild(ok)
    box.appendChild(msg)
    box.appendChild(btns)
    overlay.appendChild(box)
    document.body.appendChild(overlay)

    ok.focus()
  })
}

