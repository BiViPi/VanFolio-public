import { app, ipcMain, dialog, shell, BrowserWindow, session, powerMonitor } from 'electron'
import { basename, extname, join, resolve } from 'path'
import { promises as fs } from 'fs'
import log from 'electron-log/main'

// Fail-fast guard: catch wrong launch mode early (e.g. ELECTRON_RUN_AS_NODE=1)
if (process.type !== 'browser' || typeof app?.whenReady !== 'function') {
  console.error('[VanFolio] FATAL: Not running as Electron main process.')
  console.error(`  process.type = ${(process as NodeJS.Process & { type?: string }).type}`)
  console.error(`  ELECTRON_RUN_AS_NODE = ${process.env.ELECTRON_RUN_AS_NODE}`)
  console.error('  Fix: unset ELECTRON_RUN_AS_NODE, then run npm run dev:clean')
  process.exit(1)
}
import { createWindow, getMainWindow, openPreviewWindowForFile, closePreviewWindowForFile, togglePreviewWindowForFile, renamePreviewWindowKey, getPreviewWindowForFile, closeAllPreviewWindows, getAllPreviewFileKeys } from './windowManager'
import { buildAppMenu } from './menuManager'
import { getSettings, saveSettings, getRecentFiles, removeRecentFile, DEFAULT_SETTINGS, getSessionState, saveSessionState, clearSessionState, isOnboardingDone, markOnboardingDone, getVaultPath, setVaultPath, isDiscoveryDone, markDiscoveryDone, getSessionRecoveryPending, setSessionRecoveryPending } from './storeManager'
import { saveKey, hasKey, deleteKey } from './securityManager'
import { initAiManager } from './aiManager'
import { openFile, openFolder, openFolderByPath, readFile, saveFile, saveFileAs, readImageAsBase64, copyAsset } from './fileManager'
import { createSnapshot, listSnapshots, getSnapshotContent, deleteSnapshot, clearAllSnapshots, cleanupExpired, getLastSnapshotTimestamp, getHistorySize } from './versionManager'
import { runBackup, stopScheduler, restartSchedulerIfNeeded, getLastBackupTimestamp, getStorageUsage } from './backupManager'
import { importFont, listFonts, removeFont, readFontAsBase64, buildCustomFontCss } from './fontManager'
import { initLicenseManager, stopLicenseManager, getLicenseStatus, getCapabilities, hasCapability } from './licenseManager'
import { updateManager } from './updateManager'
import { HtmlBuilder } from '../engine/HtmlBuilder'
import { normalizeLocale, initI18n, t } from '../shared/i18n/index'
// T23: Exporters lazy-loaded on first use — shaves ~200ms off startup
// import { PdfExporter } from '../engine/PdfExporter'
// import { PngExporter } from '../engine/PngExporter'
// import { DocxExporter } from '../engine/DocxExporter'
// import { HtmlExporter } from '../engine/HtmlExporter'
import type { AppSettings, ExportOptions, SessionState } from '@shared/types'
import { IPC } from '@shared/constants'

// ─────────────────────────────────────────────────────────────────────────────
// VanFolio — Main Process Entry Point
// ─────────────────────────────────────────────────────────────────────────────

// ── Logging hardening (S7-3) ───────────────────────────────────────────────
// Bound log file growth to 5 MB to avoid unbounded disk use
log.transports.file.maxSize = 5 * 1024 * 1024
log.info('App starting...')
log.info('Log file:', log.transports.file.getFile().path)

// ── App lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(() => {
  const startMs = Date.now()  // S7-5: startup timing baseline
  // Init i18n for main process dialogs using saved locale (falls back to OS locale)
  const currentSettings = getSettings()
  const savedLocale = currentSettings.locale ?? normalizeLocale(app.getLocale())
  initI18n(savedLocale)
  setSessionRecoveryPending(true)
  const win = createWindow()
  buildAppMenu(win)
  initAiManager()
  initLicenseManager()
  // Clamp any Pro-only settings that may have been set manually in the config
  // file while the app was closed. Must run after initLicenseManager() so the
  // tier is known before we apply the clamp.
  const clampedStartupSettings = clampSettingsByLicense(getSettings())
  saveSettings(clampedStartupSettings)
  updateSpellChecker(savedLocale)
  // Phase 0: auto-backup scheduler disabled in public repo
  // const vaultPath = getVaultPath()
  // if (vaultPath && clampedStartupSettings.autoBackupEnabled && clampedStartupSettings.autoBackupPath.trim()) {
  //   startScheduler({
  //     frequency: clampedStartupSettings.autoBackupFrequency,
  //     vaultPath,
  //     backupPath: clampedStartupSettings.autoBackupPath,
  //   })
  // }

  win.once('ready-to-show', () => {
    log.info(`Startup time: ${Date.now() - startMs}ms`)
  })

  // Phase 0: license background validation disabled in public repo
  // powerMonitor.on('resume', () => {
  //   validateLicenseInBackground('system-resume').catch((err) => log.warn('[license] resume validate error:', err))
  // })

  // F12 → toggle DevTools (dev/debug only)
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.key === 'F12') win.webContents.toggleDevTools()
  })

  // Persistent maximize/unmaximize listeners — send state to renderer on each toggle
  win.on('maximize', () => win.webContents.send(IPC.WIN_MAXIMIZED_CHANGED, true))
  win.on('unmaximize', () => win.webContents.send(IPC.WIN_MAXIMIZED_CHANGED, false))

  app.on('activate', () => {
    if (!getMainWindow()) {
      const w = createWindow()
      buildAppMenu(w)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  setSessionRecoveryPending(false)
  clearSessionState()
  stopScheduler()
  stopLicenseManager()
  closeAllPreviewWindows()
})

// ── File IPC handlers ──────────────────────────────────────────────────────
ipcMain.handle(IPC.FILE_OPEN, async () => {
  try {
    const win = getMainWindow()!
    return openFile(win)
  } catch (err) {
    log.error('[main] FILE_OPEN error:', err)
    return null
  }
})

ipcMain.handle(IPC.FILE_OPEN_FOLDER, async () => {
  try {
    const win = getMainWindow()!
    const result = await openFolder(win)
    if (result?.folderPath) {
      setVaultPath(result.folderPath)
      const settings = getSettings()
      restartSchedulerIfNeeded(settings, settings, result.folderPath)
    }
    return result
  } catch (err) {
    log.error('[main] FILE_OPEN_FOLDER error:', err)
    return null
  }
})

ipcMain.handle(IPC.FILE_READ, async (_event, payload: unknown) => {
  if (typeof (payload as any)?.path !== 'string') return null
  const { path } = payload as { path: string }
  try {
    return readFile(path)
  } catch (err) {
    log.error('[main] FILE_READ error:', path, err)
    return null
  }
})

ipcMain.handle(IPC.FILE_READ_IMAGE_B64, async (_event, payload: unknown) => {
  if (typeof (payload as any)?.path !== 'string') return null
  const { path } = payload as { path: string }
  try {
    return readImageAsBase64(path)
  } catch (err) {
    log.error('[main] FILE_READ_IMAGE_B64 error:', path, err)
    return null
  }
})

ipcMain.handle(IPC.FILE_SAVE, async (_event, payload: unknown) => {
  const p = payload as any
  if (typeof p?.path !== 'string' || typeof p?.content !== 'string') return false
  try {
    const ok = await saveFile(p.path, p.content)
    if (!ok) return false

    const settings = { ...getSettings(), ...(p.liveSettings ?? {}) }
    const vaultPath = getVaultPath()
    if (settings.versionHistoryEnabled && vaultPath) {
      createSnapshot({ filePath: p.path, content: p.content, vaultPath })
        .then(async () => {
          await cleanupExpired({ vaultPath, retention: settings.versionHistoryRetention })
        })
        .catch((error) => log.warn('[main] snapshot background task failed:', error))
    }
    return true
  } catch (err) {
    log.error('[main] FILE_SAVE error:', p.path, err)
    return false
  }
})

ipcMain.handle(IPC.FILE_SAVE_AS, async (_event, payload: unknown) => {
  if (typeof (payload as any)?.content !== 'string') return null
  const { content } = payload as { content: string }
  try {
    const win = getMainWindow()!
    return saveFileAs(win, content)
  } catch (err) {
    log.error('[main] FILE_SAVE_AS error:', err)
    return null
  }
})

// ── App state IPC handlers ─────────────────────────────────────────────────
ipcMain.handle(IPC.APP_GET_RECENT, () => {
  try { return getRecentFiles() } catch (err) { log.error('[main] APP_GET_RECENT error:', err); return [] }
})

ipcMain.handle(IPC.APP_REMOVE_RECENT, (_event, payload: unknown) => {
  if (typeof (payload as any)?.path !== 'string') return
  try { removeRecentFile((payload as { path: string }).path) } catch (err) { log.error('[main] APP_REMOVE_RECENT error:', err) }
})

// ── Settings clamp (Phase 2) ─────────────────────────────────────────────────
// Strips Pro-only setting values from Free users.
// Called at startup and on every save so manually editing the config file
// cannot unlock retention or auto-backup.
function clampSettingsByLicense(settings: AppSettings): AppSettings {
  const clamped = { ...settings }
  let changed = false

  if (!hasCapability('history.unlimitedRetention') && clamped.versionHistoryRetention !== '7d') {
    log.info('[main] clamp: versionHistoryRetention reset to 7d (Free tier)')
    clamped.versionHistoryRetention = '7d'
    changed = true
  }
  if (!hasCapability('backup.scheduler') && clamped.autoBackupEnabled) {
    log.info('[main] clamp: autoBackupEnabled reset to false (Free tier)')
    clamped.autoBackupEnabled = false
    changed = true
  }
  // Custom fonts — Free tier cannot import fonts; reset to built-in safe defaults
  if (!hasCapability('font.import')) {
    const BUILTIN_FONT_FALLBACK = 'system-ui'
    if (clamped.previewFontFamily) {
      const knownBuiltins = [
        'system-ui', 'Georgia', 'serif', 'sans-serif', 'monospace',
        'Inter', 'Lora',
        // Heading fonts
        'Newsreader', 'Playfair Display',
        // Body fonts
        'Merriweather',
        // Code fonts
        'JetBrains Mono', 'Fira Code', 'Courier Prime', 'Roboto Mono',
      ]
      if (!knownBuiltins.some(f => clamped.previewFontFamily.startsWith(f))) {
        log.info('[main] clamp: previewFontFamily reset to system-ui (Free tier)')
        clamped.previewFontFamily = BUILTIN_FONT_FALLBACK
        changed = true
      }
    }
  }
  // Pro-only editor toggles
  if (!hasCapability('editor.typewriterMode') && clamped.typewriterMode) {
    log.info('[main] clamp: typewriterMode reset to false (Free tier)')
    clamped.typewriterMode = false
    changed = true
  }
  if (!hasCapability('editor.fadeContext') && clamped.fadeContext) {
    log.info('[main] clamp: fadeContext reset to false (Free tier)')
    clamped.fadeContext = false
    changed = true
  }
  if (!hasCapability('editor.smartQuotes') && clamped.smartQuotes) {
    log.info('[main] clamp: smartQuotes reset to false (Free tier)')
    clamped.smartQuotes = false
    changed = true
  }
  if (!hasCapability('editor.highlightHeader') && clamped.highlightHeader) {
    log.info('[main] clamp: highlightHeader reset to false (Free tier)')
    clamped.highlightHeader = false
    changed = true
  }
  if (!hasCapability('editor.cleanProseMode') && clamped.cleanProseMode) {
    log.info('[main] clamp: cleanProseMode reset to false (Free tier)')
    clamped.cleanProseMode = false
    changed = true
  }

  if (!changed) return settings
  return clamped
}

ipcMain.handle(IPC.APP_GET_SETTINGS, () => {
  try { return getSettings() } catch (err) { log.error('[main] APP_GET_SETTINGS error:', err); return DEFAULT_SETTINGS }
})

ipcMain.handle(IPC.APP_SAVE_SETTINGS, (_event, partial: Partial<AppSettings>) => {
  if (!partial || typeof partial !== 'object') return
  try {
    const previous = getSettings()
    // Merge + clamp in memory first, then persist exactly once (atomic pattern)
    const merged = { ...previous, ...partial }
    const clamped = clampSettingsByLicense(merged)
    saveSettings(clamped)
    const next = getSettings()
    // Keep main-process i18n in sync when user changes language
    if (partial.locale) {
      initI18n(partial.locale)
      updateSpellChecker(partial.locale)
    }
    restartSchedulerIfNeeded(previous, next, getVaultPath())
  } catch (err) { log.error('[main] APP_SAVE_SETTINGS error:', err) }
})

ipcMain.handle(IPC.APP_VERSION, () => {
  try { return app.getVersion() } catch (err) { log.error('[main] APP_VERSION error:', err); return '0.0.0' }
})

/**
 * Configure Electron's internal spellchecker to support app locale + English.
 * shaves off annoying red squiggles for multi-language writers.
 */
function updateSpellChecker(locale: string) {
  try {
    const languages = ['en']
    if (locale !== 'en') languages.push(locale)
    session.defaultSession.setSpellCheckerLanguages(languages)
    log.info('[main] Spellchecker languages set to:', languages)
  } catch (err) {
    log.error('[main] Failed to set spellchecker languages:', err)
  }
}

ipcMain.handle(IPC.FILE_COPY_ASSET, async (_event, sourcePath: unknown, mdFilePath: unknown) => {
  if (typeof sourcePath !== 'string' || typeof mdFilePath !== 'string') {
    return { relativePath: '', success: false, error: 'Invalid arguments' }
  }
  try { return await copyAsset(sourcePath, mdFilePath) } catch (err) { log.error('[main] FILE_COPY_ASSET error:', err); return { relativePath: '', success: false, error: String(err) } }
})

// ── Export IPC handlers ────────────────────────────────────────────────────

/**
 * Helper: show save dialog if outputPath is not provided.
 * Returns the chosen path, or null if cancelled.
 */
async function resolveSavePath(
  providedPath: string | undefined,
  title: string,
  defaultName: string,
  filters: Electron.FileFilter[]
): Promise<string | null> {
  if (providedPath) return providedPath
  const win = getMainWindow()!
  const result = await dialog.showSaveDialog(win, { title, defaultPath: defaultName, filters })
  if (result.canceled || !result.filePath) return null
  return result.filePath
}

/** Render markdown to export HTML — uses HtmlBuilder.renderMarkdown() which injects
    heading id="..." attributes required by HtmlBuilder._buildTocSection(). */
function renderMarkdown(markdown: string): string {
  return HtmlBuilder.renderMarkdown(markdown)
}

/** Derive a base filename (without extension) from the source .md path */
function baseFileName(filePath: string): string {
  return basename(filePath, extname(filePath)) || 'document'
}

/** 🌐 Centralized export error handler — shows popups for missing assets */
function handleExportError(err: any, format: string): { success: false; error: string } {
  const message = err?.message || String(err)
  log.error(`[main] EXPORT_${format.toUpperCase()} error:`, message)

  // 🛑 Image missing: hard block with popup (User Request)
  if (message.startsWith('IMAGE_NOT_FOUND:')) {
    const imgPath = message.split(':')[1]
    const win = getMainWindow()
    if (win) {
      dialog.showMessageBoxSync(win, {
        type: 'warning',
        title: t('main.exportFailedTitle'),
        message: t('main.exportFailedImageMsg', { format: format.toUpperCase() }),
        detail: `${t('main.exportFailedImageDetail', { path: imgPath })}`,
        buttons: ['OK']
      })
    }
    return { success: false, error: `Image not found: ${imgPath}` }
  }

  return { success: false, error: message }
}

// PDF ─────────────────────────────────────────────────────────────────────────
ipcMain.handle(IPC.EXPORT_PDF, async (_event, options: ExportOptions) => {
  try {
    // Free users always get watermark regardless of what renderer sends
    const effectiveWatermark = hasCapability('export.pdfNoWatermark')
      ? options.watermark
      : 'Drafted with VanFolio'

    const vaultPath = getVaultPath()
    const settings = { ...getSettings(), ...(options.liveSettings ?? {}) }
    const customFontCss = (vaultPath && hasCapability('font.import')) ? await buildCustomFontCss(vaultPath) : ''
    const renderedHtml = options.renderedHtml || renderMarkdown(options.markdown)

    const exportHtml = await HtmlBuilder.buildPdfHtml({
      markdown: options.markdown,
      html: renderedHtml,
      filePath: options.filePath,
      settings,
      includeToc: options.includeToc,
      visualToc: false, // PDF uses Bookmarks (Outline) instead of on-page TOC
      includePageNumbers: options.includePageNumbers,
      watermark: effectiveWatermark,
      colorMode: options.colorMode,
      docTokens: options.docTokens,
      format: 'pdf',
      customFontCss,
    })

    const outputPath = await resolveSavePath(
      options.outputPath,
      t('main.exportAs', { format: 'PDF' }),
      `${baseFileName(options.filePath)}.pdf`,
      [{ name: 'PDF Files', extensions: ['pdf'] }]
    )
    if (!outputPath) return { success: false }

    const { PdfExporter } = await import('../engine/PdfExporter')
    return PdfExporter.export(exportHtml, options, outputPath)
  } catch (err) {
    return handleExportError(err, 'pdf')
  }
})

ipcMain.handle(IPC.EXPORT_DEBUG_PDF_HTML, async (_event, options: ExportOptions) => {
  try {
    // Apply same watermark enforcement as EXPORT_PDF — Free users always get watermark
    const effectiveWatermark = hasCapability('export.pdfNoWatermark')
      ? options.watermark
      : 'Drafted with VanFolio'
    const vaultPath = getVaultPath()
    const settings = { ...getSettings(), ...(options.liveSettings ?? {}) }
    const customFontCss = (vaultPath && hasCapability('font.import')) ? await buildCustomFontCss(vaultPath) : ''
    const renderedHtml = options.renderedHtml || renderMarkdown(options.markdown)

    return await HtmlBuilder.buildPdfHtml({
      markdown: options.markdown,
      html: renderedHtml,
      filePath: options.filePath,
      settings,
      includeToc: options.includeToc,
      visualToc: false,
      includePageNumbers: options.includePageNumbers,
      watermark: effectiveWatermark,
      colorMode: options.colorMode,
      docTokens: options.docTokens,
      format: 'pdf',
      customFontCss,
    })
  } catch (err) {
    log.error('[main] EXPORT_DEBUG_PDF_HTML error:', err)
    throw err
  }
})

ipcMain.handle(IPC.EXPORT_DOCX, async (_event, options: ExportOptions) => {
  if (!hasCapability('export.docx')) {
    log.info('[main] EXPORT_DOCX blocked: PRO_REQUIRED')
    return { success: false, error: 'PRO_REQUIRED' }
  }
  try {
    const settings = { ...getSettings(), ...(options.liveSettings ?? {}) }
    const vaultPath = getVaultPath()
    const customFontCss = (vaultPath && hasCapability('font.import')) ? await buildCustomFontCss(vaultPath) : ''

    if (options.renderedHtml) {
      log.info('[main] Using pre-rendered HTML from editor for DOCX export')
    } else {
      log.info('[main] Falling back to fresh markdown render for DOCX export')
    }

    const renderedHtml = options.renderedHtml || renderMarkdown(options.markdown)

    const exportHtml = await HtmlBuilder.buildDocxHtml({
      markdown: options.markdown,
      html: renderedHtml,
      filePath: options.filePath,
      settings,
      includeToc: options.includeToc,
      docTokens: options.docTokens,
      customFontCss,
    })

    // DEBUG: Log the head section to see font-family and @font-face
    const headSnippet = exportHtml.slice(0, 2000)
    log.info('[main] DOCX HTML Head Snippet:', headSnippet)

    const outputPath = await resolveSavePath(
      options.outputPath,
      t('main.exportAs', { format: 'DOCX' }),
      `${baseFileName(options.filePath)}.docx`,
      [{ name: 'Word Document', extensions: ['docx'] }]
    )
    if (!outputPath) return { success: false }

    const { DocxExporter } = await import('../engine/DocxExporter')
    return DocxExporter.export(exportHtml, options, outputPath)
  } catch (err) {
    return handleExportError(err, 'docx')
  }
})

// HTML ────────────────────────────────────────────────────────────────────────
ipcMain.handle(IPC.EXPORT_HTML, async (_event, options: ExportOptions) => {
  if (!hasCapability('export.html')) {
    log.info('[main] EXPORT_HTML blocked: PRO_REQUIRED')
    return { success: false, error: 'PRO_REQUIRED' }
  }
  try {
    const settings = { ...getSettings(), ...(options.liveSettings ?? {}) }
    const customFontCss = (getVaultPath() && hasCapability('font.import')) ? await buildCustomFontCss(getVaultPath()!) : ''
    const renderedHtml = options.renderedHtml || renderMarkdown(options.markdown)

    const buildOptions = {
      markdown: options.markdown,
      html: renderedHtml,
      filePath: options.filePath,
      settings,
      includeToc: options.includeToc,
      docTokens: options.docTokens,
      customFontCss,
    }

    const outputPath = await resolveSavePath(
      options.outputPath,
      t('main.exportAs', { format: 'HTML' }),
      `${baseFileName(options.filePath)}.html`,
      [{ name: 'HTML File', extensions: ['html', 'htm'] }]
    )
    if (!outputPath) return { success: false }

    const { HtmlExporter } = await import('../engine/HtmlExporter')
    return HtmlExporter.export(buildOptions, options, outputPath)
  } catch (err) {
    return handleExportError(err, 'html')
  }
})

// PNG ─────────────────────────────────────────────────────────────────────────
ipcMain.handle(IPC.EXPORT_PNG, async (_event, options: ExportOptions) => {
  if (!hasCapability('export.png')) {
    log.info('[main] EXPORT_PNG blocked: PRO_REQUIRED')
    return { success: false, error: 'PRO_REQUIRED' }
  }
  try {
    const settings = { ...getSettings(), ...(options.liveSettings ?? {}) }
    const customFontCss = (getVaultPath() && hasCapability('font.import')) ? await buildCustomFontCss(getVaultPath()!) : ''
    const renderedHtml = options.renderedHtml || renderMarkdown(options.markdown)

    // PNG uses PDF HTML builder — same full-page layout
    const exportHtml = await HtmlBuilder.buildPdfHtml({
      markdown: options.markdown,
      html: renderedHtml,
      filePath: options.filePath,
      settings,
      includeToc: options.includeToc,
      docTokens: options.docTokens,
      colorMode: options.colorMode,
      transparent: options.transparentBg,
      format: 'png',
      customFontCss,
    })

    const win = getMainWindow()

    if (options.pngMode === 'per-page') {
      // Per-page mode: user picks a parent folder, app creates a subfolder {docName}_pages/
      const folderResult = await dialog.showOpenDialog(win!, {
        title: t('main.choosePngFolder'),
        properties: ['openDirectory', 'createDirectory'],
      })
      if (folderResult.canceled || !folderResult.filePaths[0]) return { success: false }
      const docName = baseFileName(options.filePath) || 'document'
      const subDir = join(folderResult.filePaths[0], `${docName}_pages`)
      await fs.mkdir(subDir, { recursive: true })
      const { PngExporter } = await import('../engine/PngExporter')
      const result = await PngExporter.exportPerPage(exportHtml, options, subDir)
      if (result.success && result.path) {
        shell.openPath(result.path)
      }
      return result
    } else {
      const outputPath = await resolveSavePath(
        options.outputPath,
        t('main.exportAs', { format: 'PNG' }),
        `${baseFileName(options.filePath)}.png`,
        [{ name: 'PNG Image', extensions: ['png'] }]
      )
      if (!outputPath) return { success: false }
      const { PngExporter } = await import('../engine/PngExporter')
      return PngExporter.export(exportHtml, options, outputPath)
    }
  } catch (err) {
    return handleExportError(err, 'png')
  }
})

// ── Shell IPC handlers ─────────────────────────────────────────────────────
ipcMain.handle(IPC.SHELL_OPEN_FOLDER, (_event, payload: unknown) => {
  if (typeof (payload as any)?.path !== 'string') return
  try { shell.showItemInFolder((payload as { path: string }).path) } catch (err) { log.error('[main] SHELL_OPEN_FOLDER error:', err) }
})

// ── External URL allowlist ─────────────────────────────────────────────────
// Only http: and https: are allowed. javascript:, file:, data:, etc. are denied.
const ALLOWED_EXTERNAL_SCHEMES = new Set(['http:', 'https:'])

function isSafeExternalUrl(raw: string): boolean {
  try {
    const { protocol } = new URL(raw)
    return ALLOWED_EXTERNAL_SCHEMES.has(protocol)
  } catch {
    return false
  }
}

// ── Window control IPC handlers ────────────────────────────────────────────
ipcMain.handle(IPC.SHELL_OPEN_EXTERNAL, async (_event, payload: unknown) => {
  const url = typeof (payload as any)?.url === 'string' ? (payload as { url: string }).url : null
  if (!url) return
  if (!isSafeExternalUrl(url)) {
    log.warn(`[main] SHELL_OPEN_EXTERNAL denied — unsafe scheme: ${url}`)
    return
  }
  try {
    await shell.openExternal(url)
  } catch (err) {
    log.error('[main] SHELL_OPEN_EXTERNAL error:', err)
  }
})

ipcMain.on(IPC.WIN_MINIMIZE, (event) => BrowserWindow.fromWebContents(event.sender)?.minimize())
ipcMain.on(IPC.WIN_MAXIMIZE, (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
})
ipcMain.on(IPC.WIN_CLOSE, (event) => BrowserWindow.fromWebContents(event.sender)?.close())

// ── Security IPC handlers ─────────────────────────────────────────────────
// ⚠️ All handlers receive payload: unknown — destructure only after validation
// to prevent crash when renderer sends wrong shape (review finding #1)

ipcMain.handle(IPC.SECURITY_SAVE_KEY, (_event, payload: unknown) => {
  const p = payload as any
  if (typeof p?.provider !== 'string' || typeof p?.key !== 'string') return false
  try {
    return saveKey(p.provider.trim(), p.key.trim())
  } catch (err) {
    log.error('[main] SECURITY_SAVE_KEY error:', err)
    return false
  }
})

ipcMain.handle(IPC.SECURITY_HAS_KEY, (_event, payload: unknown) => {
  if (typeof (payload as any)?.provider !== 'string') return false
  try {
    return hasKey((payload as { provider: string }).provider.trim())
  } catch (err) {
    log.error('[main] SECURITY_HAS_KEY error:', err)
    return false
  }
})

ipcMain.handle(IPC.SECURITY_DELETE_KEY, (_event, payload: unknown) => {
  if (typeof (payload as any)?.provider !== 'string') return
  try {
    deleteKey((payload as { provider: string }).provider.trim())
  } catch (err) {
    log.error('[main] SECURITY_DELETE_KEY error:', err)
  }
})

// ── Session IPC handlers ────────────────────────────────────────────────────

ipcMain.handle(IPC.SESSION_SAVE, (_event, payload: unknown) => {
  const p = payload as any
  if (!p || typeof p !== 'object' || !Array.isArray(p.openTabs) || typeof p.activeIndex !== 'number') return false
  try {
    saveSessionState(p as SessionState)
    return true
  } catch (err) {
    log.error('[main] SESSION_SAVE error:', err)
    return false
  }
})

ipcMain.handle(IPC.SESSION_RESTORE, () => {
  try {
    return getSessionState()
  } catch (err) {
    log.error('[main] SESSION_RESTORE error:', err)
    return null
  }
})

ipcMain.handle(IPC.SESSION_CLEAR, () => {
  try {
    clearSessionState()
  } catch (err) {
    log.error('[main] SESSION_CLEAR error:', err)
  }
})

ipcMain.handle(IPC.SESSION_GET_RECOVERY_PENDING, () => {
  try {
    return getSessionRecoveryPending()
  } catch (err) {
    log.error('[main] SESSION_GET_RECOVERY_PENDING error:', err)
    return false
  }
})

// ── i18n: get system locale ────────────────────────────────────────────────

ipcMain.handle(IPC.I18N_GET_LOCALE, () => {
  try {
    return normalizeLocale(app.getLocale())
  } catch {
    return 'en'
  }
})

// ── Onboarding ──────────────────────────────────────────────────────────

ipcMain.handle(IPC.ONBOARDING_CHECK, () => {
  try { return isOnboardingDone() } catch { return true }
})

ipcMain.handle(IPC.ONBOARDING_DONE, () => {
  try { markOnboardingDone() } catch (err) { log.error('[main] ONBOARDING_DONE error:', err) }
})

ipcMain.handle(IPC.ONBOARDING_PICK_VAULT, async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return null
  const result = await dialog.showOpenDialog(win, {
    title: t('main.chooseVaultFolder'),
    properties: ['openDirectory', 'createDirectory'],
  })
  return result.canceled ? null : (result.filePaths[0] ?? null)
})

// ── Vault Path ──────────────────────────────────────────────────────────

ipcMain.handle(IPC.VAULT_GET, () => {
  try { return getVaultPath() } catch { return null }
})

ipcMain.handle(IPC.VAULT_SET, (_event, path: string) => {
  try {
    setVaultPath(path)
    const settings = getSettings()
    restartSchedulerIfNeeded(settings, settings, path)
  } catch (err) { log.error('[main] VAULT_SET error:', err) }
})

ipcMain.handle(IPC.VAULT_OPEN, async () => {
  const vaultPath = getVaultPath()
  if (!vaultPath) return null
  return openFolderByPath(vaultPath)
})

// ── Discovery Mode ──────────────────────────────────────────────────────

ipcMain.handle(IPC.DISCOVERY_CHECK, () => {
  try { return isDiscoveryDone() } catch { return false }
})

ipcMain.handle(IPC.DISCOVERY_DONE, () => {
  try { markDiscoveryDone() } catch (err) { log.error('[main] DISCOVERY_DONE error:', err) }
})

ipcMain.handle(IPC.VERSION_CREATE_SNAPSHOT, async (_event, payload: unknown) => {
  const p = payload as any
  if (typeof p?.filePath !== 'string' || typeof p?.content !== 'string') return null
  const vaultPath = getVaultPath()
  const settings = getSettings()
  if (!vaultPath || !settings.versionHistoryEnabled) return null
  try {
    return await createSnapshot({ filePath: p.filePath, content: p.content, vaultPath })
  } catch (err) {
    log.error('[main] VERSION_CREATE_SNAPSHOT error:', err)
    return null
  }
})

ipcMain.handle(IPC.VERSION_LIST, async (_event, payload: unknown) => {
  if (typeof (payload as any)?.filePath !== 'string') return []
  const vaultPath = getVaultPath()
  if (!vaultPath) return []
  try {
    return await listSnapshots({ filePath: (payload as { filePath: string }).filePath, vaultPath })
  } catch (err) {
    log.error('[main] VERSION_LIST error:', err)
    return []
  }
})

ipcMain.handle(IPC.VERSION_GET_CONTENT, async (_event, payload: unknown) => {
  const p = payload as any
  if (typeof p?.filePath !== 'string' || typeof p?.snapshotId !== 'string') return null
  const vaultPath = getVaultPath()
  if (!vaultPath) return null
  try {
    return await getSnapshotContent({ filePath: p.filePath, snapshotId: p.snapshotId, vaultPath })
  } catch (err) {
    log.error('[main] VERSION_GET_CONTENT error:', err)
    return null
  }
})

ipcMain.handle(IPC.VERSION_DELETE, async (_event, payload: unknown) => {
  const p = payload as any
  if (typeof p?.filePath !== 'string' || typeof p?.snapshotId !== 'string') return false
  const vaultPath = getVaultPath()
  if (!vaultPath) return false
  try {
    return await deleteSnapshot({ filePath: p.filePath, snapshotId: p.snapshotId, vaultPath })
  } catch (err) {
    log.error('[main] VERSION_DELETE error:', err)
    return false
  }
})

ipcMain.handle(IPC.VERSION_CLEAR_ALL, async () => {
  const vaultPath = getVaultPath()
  if (!vaultPath) return 0
  try {
    return await clearAllSnapshots({ vaultPath })
  } catch (err) {
    log.error('[main] VERSION_CLEAR_ALL error:', err)
    return 0
  }
})

// ── Update & License (Phase 3) ─────────────────────────────────────────────

ipcMain.handle(IPC.APP_CHECK_FOR_UPDATES, async (_event, payload: unknown) => {
  const force = (payload as { force?: boolean })?.force ?? false
  const result = await updateManager.checkForUpdates(force)

  // If update is available, mark this version as notified so we don't show it again on startup
  if (result.status === 'update-available' && result.latestVersion) {
    updateManager.markAsNotified(result.latestVersion)
  }

  return result
})

  ipcMain.handle(IPC.APP_GET_LICENSE_TEXT, async () => {
    try {
      const licensePath = app.isPackaged
        ? join(process.resourcesPath, 'LICENSE')
        : join(app.getAppPath(), 'LICENSE')
      return await fs.readFile(licensePath, 'utf8')
    } catch (err) {
      log.error('[main] APP_GET_LICENSE_TEXT error:', err)
      return 'License text not available.'
  }
})

ipcMain.handle(IPC.VERSION_LAST_TIMESTAMP, async () => {
  const vaultPath = getVaultPath()
  if (!vaultPath) return null
  try {
    return await getLastSnapshotTimestamp({ vaultPath })
  } catch (err) {
    log.error('[main] VERSION_LAST_TIMESTAMP error:', err)
    return null
  }
})

ipcMain.handle(IPC.VERSION_CLEANUP, async () => {
  const vaultPath = getVaultPath()
  if (!vaultPath) return 0
  try {
    return await cleanupExpired({ vaultPath, retention: getSettings().versionHistoryRetention })
  } catch (err) {
    log.error('[main] VERSION_CLEANUP error:', err)
    return 0
  }
})

ipcMain.handle(IPC.BACKUP_RUN_NOW, async () => {
  const vaultPath = getVaultPath()
  const settings = getSettings()
  if (!vaultPath || !settings.autoBackupPath.trim()) {
    return { success: false, timestamp: Date.now(), error: 'Missing vault path or backup path' }
  }
  try {
    return await runBackup({ vaultPath, backupPath: settings.autoBackupPath })
  } catch (err) {
    log.error('[main] BACKUP_RUN_NOW error:', err)
    return { success: false, timestamp: Date.now(), error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle(IPC.BACKUP_PICK_PATH, async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return null
  try {
    const result = await dialog.showOpenDialog(win, {
      title: t('main.chooseBackupFolder'),
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  } catch (err) {
    log.error('[main] BACKUP_PICK_PATH error:', err)
    return null
  }
})

ipcMain.handle(IPC.BACKUP_LAST_TIMESTAMP, async () => {
  const vaultPath = getVaultPath()
  if (!vaultPath) return null
  try {
    return await getLastBackupTimestamp({ vaultPath })
  } catch (err) {
    log.error('[main] BACKUP_LAST_TIMESTAMP error:', err)
    return null
  }
})

ipcMain.handle(IPC.STORAGE_GET_USAGE, async () => {
  const vaultPath = getVaultPath()
  if (!vaultPath) return { vaultBytes: 0, historyBytes: 0, backupBytes: 0 }
  try {
    const settings = getSettings()
    const historyBytes = await getHistorySize({ vaultPath })
    return await getStorageUsage({
      vaultPath,
      backupPath: settings.autoBackupPath,
      historyBytes,
    })
  } catch (err) {
    log.error('[main] STORAGE_GET_USAGE error:', err)
    return { vaultBytes: 0, historyBytes: 0, backupBytes: 0 }
  }
})

ipcMain.handle(IPC.FONT_PICK, async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return []
  try {
    const result = await dialog.showOpenDialog(win, {
      title: t('main.chooseFontFiles'),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Fonts', extensions: ['ttf', 'otf'] }],
    })
    return result.canceled ? [] : result.filePaths
  } catch (err) {
    log.error('[main] FONT_PICK error:', err)
    return []
  }
})

ipcMain.handle(IPC.FONT_IMPORT, async (_event, payload: unknown) => {
  if (!hasCapability('font.import')) {
    log.info('[main] FONT_IMPORT blocked: PRO_REQUIRED')
    return null
  }
  if (typeof (payload as any)?.sourcePath !== 'string') return null
  const vaultPath = getVaultPath()
  if (!vaultPath) return null
  try {
    return await importFont((payload as { sourcePath: string }).sourcePath, vaultPath)
  } catch (err) {
    log.error('[main] FONT_IMPORT error:', err)
    return null
  }
})

ipcMain.handle(IPC.FONT_LIST, async () => {
  // Free tier: return empty list — imported fonts are not accessible after downgrade
  if (!hasCapability('font.import')) return []
  const vaultPath = getVaultPath()
  if (!vaultPath) return []
  try {
    return await listFonts(vaultPath)
  } catch (err) {
    log.error('[main] FONT_LIST error:', err)
    return []
  }
})

ipcMain.handle(IPC.FONT_REMOVE, async (_event, payload: unknown) => {
  if (typeof (payload as any)?.fontId !== 'string') return false
  const vaultPath = getVaultPath()
  if (!vaultPath) return false
  try {
    return await removeFont((payload as { fontId: string }).fontId, vaultPath)
  } catch (err) {
    log.error('[main] FONT_REMOVE error:', err)
    return false
  }
})

ipcMain.handle(IPC.FONT_READ_B64, async (_event, payload: unknown) => {
  // Free tier: deny serving font data — closes the "use what's already inside" path
  if (!hasCapability('font.import')) return null
  if (typeof (payload as any)?.fontPath !== 'string') return null
  const vaultPath = getVaultPath()
  const fontPath = (payload as { fontPath: string }).fontPath
  const fontsRoot = vaultPath ? resolve(vaultPath, '.vanfolio', 'fonts') : ''
  const normalizedFontPath = resolve(fontPath)
  const fontPrefix = fontsRoot ? `${fontsRoot}${process.platform === 'win32' ? '\\' : '/'}` : ''
  if (!vaultPath || (normalizedFontPath !== fontsRoot && !normalizedFontPath.startsWith(fontPrefix))) return null
  try {
    return await readFontAsBase64(normalizedFontPath)
  } catch (err) {
    log.error('[main] FONT_READ_B64 error:', err)
    return null
  }
})

// ── Multi preview window IPC ──────────────────────────────────────────────────

ipcMain.on(IPC.PREVIEW_OPEN_FILE, (_event, snapshot) => {
  if (!hasCapability('preview.detach')) {
    log.info('[main] PREVIEW_OPEN_FILE blocked: PRO_REQUIRED')
    return
  }
  if (snapshot?.fileKey) openPreviewWindowForFile(snapshot)
})

ipcMain.on(IPC.PREVIEW_CLOSE_FILE, (_event, payload) => {
  if (payload?.fileKey) closePreviewWindowForFile(payload.fileKey)
})

ipcMain.on(IPC.PREVIEW_TOGGLE_FILE, (_event, snapshot) => {
  if (!hasCapability('preview.detach')) {
    log.info('[main] PREVIEW_TOGGLE_FILE blocked: PRO_REQUIRED')
    return
  }
  if (snapshot?.fileKey) togglePreviewWindowForFile(snapshot)
})

ipcMain.on(IPC.PREVIEW_RENAME_FILE, (_event, payload) => {
  if (payload?.oldKey && payload?.newKey) {
    renamePreviewWindowKey(payload.oldKey, payload.newKey, payload.newTitle ?? '')
  }
})

// Route HTML update → correct window by fileKey
ipcMain.on(IPC.PREVIEW_UPDATE, (_event, payload) => {
  if (!payload?.fileKey) return
  // If capability was lost mid-session, close the window instead of updating it
  if (!hasCapability('preview.detach')) {
    closeAllPreviewWindows()
    return
  }
  const win = getPreviewWindowForFile(payload.fileKey)
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.PREVIEW_UPDATE, { html: payload.html })
  }
})

// Route scroll → correct window by fileKey
ipcMain.on(IPC.PREVIEW_SCROLL, (_event, payload) => {
  if (!payload?.fileKey) return
  const win = getPreviewWindowForFile(payload.fileKey)
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.PREVIEW_SCROLL, { scrollRatio: payload.scrollRatio })
  }
})

// Settings: broadcast to ALL preview windows (settings are app-wide)
ipcMain.on(IPC.PREVIEW_SETTINGS, (_event, payload) => {
  if (!hasCapability('preview.detach')) {
    closeAllPreviewWindows()
    return
  }
  for (const fileKey of getAllPreviewFileKeys()) {
    const win = getPreviewWindowForFile(fileKey)
    if (win && !win.isDestroyed()) win.webContents.send(IPC.PREVIEW_SETTINGS, payload)
  }
})

// Query: is a specific file currently pinned?
ipcMain.handle(IPC.PREVIEW_IS_DETACHED, (_event, payload) => {
  if (!payload?.fileKey) return false
  return !!getPreviewWindowForFile(payload.fileKey)
})

// Query: return all currently pinned fileKeys
ipcMain.handle(IPC.PREVIEW_GET_DETACHED, () => {
  return getAllPreviewFileKeys()
})

// ── License IPC handlers (Phase 3 — read-only) ──────────────────────────────

ipcMain.handle(IPC.LICENSE_GET_STATUS, () => {
  try {
    return getLicenseStatus()
  } catch (err) {
    log.error('[main] LICENSE_GET_STATUS error:', err)
    return { tier: 'free', state: 'inactive' }
  }
})

ipcMain.handle(IPC.LICENSE_GET_CAPABILITIES, () => {
  try {
    return getCapabilities()
  } catch (err) {
    log.error('[main] LICENSE_GET_CAPABILITIES error:', err)
    return []
  }
})

ipcMain.handle(IPC.LICENSE_HAS_CAPABILITY, (_event, payload: unknown) => {
  try {
    const cap = (payload as any)?.cap
    if (typeof cap !== 'string') return false
    return hasCapability(cap as import('@shared/types').Capability)
  } catch (err) {
    log.error('[main] LICENSE_HAS_CAPABILITY error:', err)
    return false
  }
})
