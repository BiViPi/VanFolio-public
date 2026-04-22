import { BrowserWindow, shell, Menu, MenuItem, ipcMain } from 'electron'
import { join } from 'path'
import log from 'electron-log/main'
import { IPC } from '@shared/constants'
import type { PreviewSnapshot } from '@shared/types'
import { t } from '../shared/i18n/index'

let mainWindow: BrowserWindow | null = null

// ── Multi preview window registry ────────────────────────────────────────────
// key = fileKey (path for saved files, tabId for untitled)
const _previewWindows = new Map<string, BrowserWindow>()
// Pending bootstrap snapshots — sent to window after did-finish-load
const _pendingSnapshots = new Map<string, PreviewSnapshot>()
// Tracks the CURRENT fileKey for each BrowserWindow. Needed because Save As
// can rename a pinned preview from an untitled tabId → real path.
const _windowKeys = new WeakMap<BrowserWindow, string>()

export function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    // Custom titlebar — renderer handles Min/Max/Close via IPC
    frame: false,
    // ⚠️ SECURITY: contextIsolation + nodeIntegration:false are mandatory
    // sandbox: defaults to true since Electron 20+ — no need to declare
    // electron-store is only used in main process (storeManager.ts), not preload
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: join(__dirname, '../../resources/icon.png'),
    backgroundColor: '#C2D9C8', // van-ivory --bg-app default
  })

  // Load renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    log.info('Window ready')
  })

  // ── Unsaved-changes guard on window close ────────────────────────────────
  // Pattern: preventDefault synchronously → send APP_QUERY_DIRTY to renderer
  // → renderer replies via APP_REPLY_DIRTY invoke → show dialog if dirty.
  // ⚠️ preventDefault MUST happen synchronously in 'close' handler.
  let isClosing = false
  let pendingCloseDecision: Promise<void> | null = null
  mainWindow.on('close', (event) => {
    if (isClosing) return  // already confirmed — let it proceed
    event.preventDefault()
    if (pendingCloseDecision) return // ignore repeated close attempts while one check is in flight

    pendingCloseDecision = (async () => {
      // Ask renderer whether any tab is dirty via async round-trip
      let isDirty = false
      try {
        isDirty = await new Promise<boolean>((resolve) => {
          let settled = false
          const settle = (value: boolean) => {
            if (settled) return
            settled = true
            ipcMain.removeHandler(IPC.APP_REPLY_DIRTY)
            resolve(value)
          }
          const timeout = setTimeout(() => settle(false), 500) // fallback: allow close if renderer unresponsive
          ipcMain.handle(IPC.APP_REPLY_DIRTY, (_e, dirty: boolean) => {
            clearTimeout(timeout)
            settle(!!dirty)
          })
          mainWindow!.webContents.send(IPC.APP_QUERY_DIRTY)
        })
      } catch {
        isDirty = false
        ipcMain.removeHandler(IPC.APP_REPLY_DIRTY)
      }

      if (!isDirty) {
        isClosing = true
        mainWindow?.destroy()
        return
      }

      let shouldClose = false
      try {
        shouldClose = await new Promise<boolean>((resolve) => {
          let settled = false
          const settle = (value: boolean) => {
            if (settled) return
            settled = true
            ipcMain.removeHandler(IPC.APP_REPLY_CONFIRM_CLOSE)
            resolve(value)
          }
          const timeout = setTimeout(() => settle(false), 2000)
          ipcMain.handle(IPC.APP_REPLY_CONFIRM_CLOSE, (_e, confirmed: boolean) => {
            clearTimeout(timeout)
            settle(!!confirmed)
          })
          mainWindow!.webContents.send(IPC.APP_CONFIRM_CLOSE)
        })
      } catch {
        shouldClose = false
        ipcMain.removeHandler(IPC.APP_REPLY_CONFIRM_CLOSE)
      }

      if (shouldClose) {
        isClosing = true
        mainWindow?.destroy()
      }
      // Cancel / timeout → do nothing, window stays open
    })().finally(() => {
      pendingCloseDecision = null
    })
  })

  // Only allow http/https through shell.openExternal — deny everything else
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const { protocol } = new URL(url)
      if (protocol === 'http:' || protocol === 'https:') {
        shell.openExternal(url).catch((err) => log.warn('[window] openExternal failed:', err))
      } else {
        log.warn(`[window] setWindowOpenHandler denied — unsafe scheme: ${url}`)
      }
    } catch {
      log.warn(`[window] setWindowOpenHandler denied — invalid URL: ${url}`)
    }
    return { action: 'deny' }
  })

  // ── Context Menu — Spellcheck suggestions & Edit commands (S4.2) ──────────
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu()

    // 1. Spellcheck suggestions
    for (const suggestion of params.dictionarySuggestions) {
      menu.append(new MenuItem({
        label: suggestion,
        click: () => mainWindow?.webContents.replaceMisspelling(suggestion)
      }))
    }

    // 2. Add to Dictionary
    if (params.misspelledWord) {
      menu.append(new MenuItem({
        label: t('main.addToDictionary', { word: params.misspelledWord }),
        click: () => mainWindow?.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      }))
      menu.append(new MenuItem({ type: 'separator' }))
    }

    // 3. Standard Edit Commands
    menu.append(new MenuItem({ label: t('menu.edit.cut'), role: 'cut', enabled: params.editFlags.canCut }))
    menu.append(new MenuItem({ label: t('menu.edit.copy'), role: 'copy', enabled: params.editFlags.canCopy }))
    menu.append(new MenuItem({ label: t('menu.edit.paste'), role: 'paste', enabled: params.editFlags.canPaste }))
    menu.append(new MenuItem({ type: 'separator' }))
    menu.append(new MenuItem({ label: t('menu.edit.selectAll'), role: 'selectAll' }))

    menu.popup()
  })

  return mainWindow
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

// ── Preview Detach Window — Multi-window ─────────────────────────────────────

export function openPreviewWindowForFile(snapshot: PreviewSnapshot): BrowserWindow {
  const existing = getPreviewWindowForFile(snapshot.fileKey)
  if (existing) {
    existing.focus()
    return existing
  }

  const win = new BrowserWindow({
    width: 900,
    height: 1100,
    minWidth: 600,
    minHeight: 700,
    title: snapshot.title,
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: join(__dirname, '../../resources/icon.png'),
    backgroundColor: '#F8F4EC',
  })

  _previewWindows.set(snapshot.fileKey, win)
  _pendingSnapshots.set(snapshot.fileKey, snapshot)
  _windowKeys.set(win, snapshot.fileKey)

  // Load index.html with mode=preview-only and fileKey so the renderer knows which file to pin
  const main = getMainWindow()
  if (main) {
    const mainUrl = main.webContents.getURL()
    const previewUrl = new URL(mainUrl)
    previewUrl.searchParams.set('mode', 'preview-only')
    previewUrl.searchParams.set('fileKey', snapshot.fileKey)
    win.loadURL(previewUrl.toString())
  }

  win.webContents.once('did-finish-load', () => {
    // Send bootstrap snapshot — hydrates the preview-only window with initial state
    const pending = _pendingSnapshots.get(snapshot.fileKey)
    if (pending && !win.isDestroyed()) {
      win.webContents.send(IPC.PREVIEW_BOOTSTRAP, pending)
      _pendingSnapshots.delete(snapshot.fileKey)
    }
    // Notify main renderer that this file is now pinned
    const mainWin = getMainWindow()
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send(IPC.PREVIEW_ATTACHED, { fileKey: snapshot.fileKey, attached: true })
    }
  })

  // Lifecycle: main window closed → close all preview windows
  getMainWindow()?.once('closed', () => {
    if (!win.isDestroyed()) win.close()
  })

  // When this preview window is closed → clean up and notify renderer
  win.on('closed', () => {
    const currentKey = _windowKeys.get(win) ?? snapshot.fileKey
    _previewWindows.delete(currentKey)
    _pendingSnapshots.delete(currentKey)
    const mainWin = getMainWindow()
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send(IPC.PREVIEW_ATTACHED, { fileKey: currentKey, attached: false })
    }
  })

  win.setMenu(null)
  log.info(`[preview] window opened for fileKey: ${snapshot.fileKey}`)
  return win
}

export function closePreviewWindowForFile(fileKey: string): void {
  const win = getPreviewWindowForFile(fileKey)
  if (win && !win.isDestroyed()) win.close()
  // Map entry is removed in the 'closed' handler above
}

export function togglePreviewWindowForFile(snapshot: PreviewSnapshot): void {
  const existing = getPreviewWindowForFile(snapshot.fileKey)
  if (existing) {
    closePreviewWindowForFile(snapshot.fileKey)
  } else {
    openPreviewWindowForFile(snapshot)
  }
}

export function renamePreviewWindowKey(oldKey: string, newKey: string, newTitle: string): void {
  const win = getPreviewWindowForFile(oldKey)
  if (!win) return
  _previewWindows.delete(oldKey)
  _previewWindows.set(newKey, win)
  _windowKeys.set(win, newKey)
  const pending = _pendingSnapshots.get(oldKey)
  if (pending) {
    _pendingSnapshots.delete(oldKey)
    _pendingSnapshots.set(newKey, { ...pending, fileKey: newKey, title: newTitle || pending.title })
  }
  win.setTitle(newTitle)
  log.info(`[preview] window rekey: ${oldKey} → ${newKey}`)

  const mainWin = getMainWindow()
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send(IPC.PREVIEW_ATTACHED, { fileKey: oldKey, attached: false })
    mainWin.webContents.send(IPC.PREVIEW_ATTACHED, { fileKey: newKey, attached: true })
  }
}

export function getPreviewWindowForFile(fileKey: string): BrowserWindow | null {
  const win = _previewWindows.get(fileKey)
  if (!win) return null
  if (win.isDestroyed()) {
    _previewWindows.delete(fileKey)
    return null
  }
  return win
}

export function closeAllPreviewWindows(): void {
  for (const [, win] of _previewWindows) {
    if (!win.isDestroyed()) win.close()
  }
  _previewWindows.clear()
  _pendingSnapshots.clear()
}

export function getAllPreviewFileKeys(): string[] {
  const keys: string[] = []
  for (const [key, win] of _previewWindows) {
    if (win.isDestroyed()) {
      _previewWindows.delete(key)
    } else {
      keys.push(key)
    }
  }
  return keys
}
