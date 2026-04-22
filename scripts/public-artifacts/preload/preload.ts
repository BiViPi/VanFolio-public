import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/constants'
import type {
  AppSettings,
  ExportOptions,
  ExportResult,
  ExportFormat,
  OpenFileResult,
  SaveAsResult,
  OpenFolderResult,
  CopyAssetResult,
  SessionState,
  AIGenerateRequest,
  AIStreamChunk,
  AIStreamEnd,
  AIStreamError,
  SnapshotMeta,
  BackupResult,
  StorageUsage,
  FontMeta,
  PreviewSnapshot,
  LicenseStatus,
  Capability,
} from '@shared/types'

// Public artifact: preload bridge trimmed to the retained public contract.
// Removed APIs:
// - activateLicense
// - deactivateLicense
// - openPurchasePage

contextBridge.exposeInMainWorld('vanfolioAPI', {
  openFile: (): Promise<OpenFileResult | null> => ipcRenderer.invoke(IPC.FILE_OPEN),
  openFolder: (): Promise<OpenFolderResult | null> => ipcRenderer.invoke(IPC.FILE_OPEN_FOLDER),
  readFile: (path: string): Promise<string | null> => ipcRenderer.invoke(IPC.FILE_READ, { path }),
  readImageAsBase64: (path: string): Promise<string | null> => ipcRenderer.invoke(IPC.FILE_READ_IMAGE_B64, { path }),
  saveFile: (path: string, content: string): Promise<boolean> => ipcRenderer.invoke(IPC.FILE_SAVE, { path, content }),
  saveFileAs: (content: string): Promise<SaveAsResult | null> => ipcRenderer.invoke(IPC.FILE_SAVE_AS, { content }),
  getRecentFiles: (): Promise<string[]> => ipcRenderer.invoke(IPC.APP_GET_RECENT),
  removeRecentFile: (path: string): Promise<void> => ipcRenderer.invoke(IPC.APP_REMOVE_RECENT, { path }),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.APP_GET_SETTINGS),
  saveSettings: (settings: Partial<AppSettings>): Promise<void> => ipcRenderer.invoke(IPC.APP_SAVE_SETTINGS, settings),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke(IPC.APP_VERSION),

  createSnapshot: (filePath: string, content: string): Promise<SnapshotMeta | null> =>
    ipcRenderer.invoke(IPC.VERSION_CREATE_SNAPSHOT, { filePath, content }),
  listSnapshots: (filePath: string): Promise<SnapshotMeta[]> => ipcRenderer.invoke(IPC.VERSION_LIST, { filePath }),
  getSnapshotContent: (filePath: string, snapshotId: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.VERSION_GET_CONTENT, { filePath, snapshotId }),
  deleteSnapshot: (filePath: string, snapshotId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.VERSION_DELETE, { filePath, snapshotId }),
  clearAllSnapshots: (): Promise<number> => ipcRenderer.invoke(IPC.VERSION_CLEAR_ALL),
  cleanupSnapshots: (): Promise<number> => ipcRenderer.invoke(IPC.VERSION_CLEANUP),
  getLastSnapshotTimestamp: (): Promise<number | null> => ipcRenderer.invoke(IPC.VERSION_LAST_TIMESTAMP),

  runBackupNow: (): Promise<BackupResult> => ipcRenderer.invoke(IPC.BACKUP_RUN_NOW),
  pickBackupPath: (): Promise<string | null> => ipcRenderer.invoke(IPC.BACKUP_PICK_PATH),
  getLastBackupTimestamp: (): Promise<number | null> => ipcRenderer.invoke(IPC.BACKUP_LAST_TIMESTAMP),
  getStorageUsage: (): Promise<StorageUsage> => ipcRenderer.invoke(IPC.STORAGE_GET_USAGE),

  pickFontFiles: (): Promise<string[]> => ipcRenderer.invoke(IPC.FONT_PICK),
  importFont: (sourcePath: string): Promise<FontMeta | null> => ipcRenderer.invoke(IPC.FONT_IMPORT, { sourcePath }),
  listCustomFonts: (): Promise<FontMeta[]> => ipcRenderer.invoke(IPC.FONT_LIST),
  removeCustomFont: (fontId: string): Promise<boolean> => ipcRenderer.invoke(IPC.FONT_REMOVE, { fontId }),
  readFontBase64: (fontPath: string): Promise<string | null> => ipcRenderer.invoke(IPC.FONT_READ_B64, { fontPath }),

  exportPdf: (options: ExportOptions): Promise<ExportResult> => ipcRenderer.invoke(IPC.EXPORT_PDF, options),
  buildPdfDebugHtml: (options: ExportOptions): Promise<string> => ipcRenderer.invoke(IPC.EXPORT_DEBUG_PDF_HTML, options),
  exportDocx: (options: ExportOptions): Promise<ExportResult> => ipcRenderer.invoke(IPC.EXPORT_DOCX, options),
  exportHtml: (options: ExportOptions): Promise<ExportResult> => ipcRenderer.invoke(IPC.EXPORT_HTML, options),
  exportPng: (options: ExportOptions): Promise<ExportResult> => ipcRenderer.invoke(IPC.EXPORT_PNG, options),
  copyAsset: (sourcePath: string, mdFilePath: string): Promise<CopyAssetResult> =>
    ipcRenderer.invoke(IPC.FILE_COPY_ASSET, sourcePath, mdFilePath),

  openInExplorer: (path: string): void => {
    ipcRenderer.invoke(IPC.SHELL_OPEN_FOLDER, { path }).catch((err) => console.error('[preload] openInExplorer error:', err))
  },
  openExternal: (url: string): void => {
    ipcRenderer.invoke(IPC.SHELL_OPEN_EXTERNAL, { url }).catch((err) => console.error('[preload] openExternal error:', err))
  },
  minimizeWindow: (): void => ipcRenderer.send(IPC.WIN_MINIMIZE),
  maximizeWindow: (): void => ipcRenderer.send(IPC.WIN_MAXIMIZE),
  closeWindow: (): void => ipcRenderer.send(IPC.WIN_CLOSE),

  saveApiKey: (provider: string, key: string): Promise<boolean> => ipcRenderer.invoke(IPC.SECURITY_SAVE_KEY, { provider, key }),
  hasApiKey: (provider: string): Promise<boolean> => ipcRenderer.invoke(IPC.SECURITY_HAS_KEY, { provider }),
  deleteApiKey: (provider: string): Promise<void> => ipcRenderer.invoke(IPC.SECURITY_DELETE_KEY, { provider }),

  onMenuOpenFile: (callback: () => void) => {
    ipcRenderer.on(IPC.MENU_OPEN_FILE, callback)
    return () => ipcRenderer.removeListener(IPC.MENU_OPEN_FILE, callback)
  },
  onMenuSave: (callback: () => void) => {
    ipcRenderer.on(IPC.MENU_SAVE, callback)
    return () => ipcRenderer.removeListener(IPC.MENU_SAVE, callback)
  },
  onMenuSaveAs: (callback: () => void) => {
    ipcRenderer.on(IPC.MENU_SAVE_AS, callback)
    return () => ipcRenderer.removeListener(IPC.MENU_SAVE_AS, callback)
  },
  onMenuExport: (callback: (format: ExportFormat) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, format: ExportFormat) => callback(format)
    ipcRenderer.on(IPC.MENU_EXPORT, wrapped)
    return () => ipcRenderer.removeListener(IPC.MENU_EXPORT, wrapped)
  },
  onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, isMaximized: boolean) => callback(isMaximized)
    ipcRenderer.on(IPC.WIN_MAXIMIZED_CHANGED, wrapped)
    return () => ipcRenderer.removeListener(IPC.WIN_MAXIMIZED_CHANGED, wrapped)
  },

  onAppQueryDirty: (callback: () => boolean) => {
    const wrapped = () => {
      const dirty = callback()
      ipcRenderer.invoke(IPC.APP_REPLY_DIRTY, dirty).catch(console.error)
    }
    ipcRenderer.on(IPC.APP_QUERY_DIRTY, wrapped)
    return () => ipcRenderer.removeListener(IPC.APP_QUERY_DIRTY, wrapped)
  },
  onAppConfirmClose: (callback: () => boolean | Promise<boolean>) => {
    const wrapped = async () => {
      const confirmed = await callback()
      return ipcRenderer.invoke(IPC.APP_REPLY_CONFIRM_CLOSE, confirmed)
    }
    ipcRenderer.on(IPC.APP_CONFIRM_CLOSE, wrapped)
    return () => ipcRenderer.removeListener(IPC.APP_CONFIRM_CLOSE, wrapped)
  },

  saveSession: (state: SessionState): Promise<boolean> => ipcRenderer.invoke(IPC.SESSION_SAVE, state),
  restoreSession: (): Promise<SessionState | null> => ipcRenderer.invoke(IPC.SESSION_RESTORE),
  clearSession: (): Promise<void> => ipcRenderer.invoke(IPC.SESSION_CLEAR),
  getSessionRecoveryPending: (): Promise<boolean> => ipcRenderer.invoke(IPC.SESSION_GET_RECOVERY_PENDING),
  getSystemLocale: (): Promise<import('@shared/types').Locale> => ipcRenderer.invoke(IPC.I18N_GET_LOCALE),

  aiGenerate: (request: AIGenerateRequest): Promise<{ ok: boolean } | { error: string }> => ipcRenderer.invoke(IPC.AI_GENERATE, request),
  cancelAiGenerate: (requestId: string): void => ipcRenderer.send(IPC.AI_CANCEL, { requestId }),
  onAiChunk: (callback: (chunk: AIStreamChunk) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, chunk: AIStreamChunk) => callback(chunk)
    ipcRenderer.on(IPC.AI_STREAM_CHUNK, wrapped)
    return () => ipcRenderer.removeListener(IPC.AI_STREAM_CHUNK, wrapped)
  },
  onAiEnd: (callback: (payload: AIStreamEnd) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: AIStreamEnd) => callback(payload)
    ipcRenderer.on(IPC.AI_STREAM_END, wrapped)
    return () => ipcRenderer.removeListener(IPC.AI_STREAM_END, wrapped)
  },
  onAiError: (callback: (payload: AIStreamError) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: AIStreamError) => callback(payload)
    ipcRenderer.on(IPC.AI_STREAM_ERROR, wrapped)
    return () => ipcRenderer.removeListener(IPC.AI_STREAM_ERROR, wrapped)
  },

  checkOnboarding: (): Promise<boolean> => ipcRenderer.invoke(IPC.ONBOARDING_CHECK),
  markOnboardingDone: (): Promise<void> => ipcRenderer.invoke(IPC.ONBOARDING_DONE),
  pickVaultPath: (): Promise<string | null> => ipcRenderer.invoke(IPC.ONBOARDING_PICK_VAULT),
  getVaultPath: (): Promise<string | null> => ipcRenderer.invoke(IPC.VAULT_GET),
  setVaultPath: (path: string): Promise<void> => ipcRenderer.invoke(IPC.VAULT_SET, path),
  openVault: (): Promise<OpenFolderResult | null> => ipcRenderer.invoke(IPC.VAULT_OPEN),
  checkDiscovery: (): Promise<boolean> => ipcRenderer.invoke(IPC.DISCOVERY_CHECK),
  markDiscoveryDone: (): Promise<void> => ipcRenderer.invoke(IPC.DISCOVERY_DONE),

  openPreviewFile: (snapshot: PreviewSnapshot): void => ipcRenderer.send(IPC.PREVIEW_OPEN_FILE, snapshot),
  closePreviewFile: (fileKey: string): void => ipcRenderer.send(IPC.PREVIEW_CLOSE_FILE, { fileKey }),
  togglePreviewFile: (snapshot: PreviewSnapshot): void => ipcRenderer.send(IPC.PREVIEW_TOGGLE_FILE, snapshot),
  renamePreviewFile: (oldKey: string, newKey: string, newTitle: string): void =>
    ipcRenderer.send(IPC.PREVIEW_RENAME_FILE, { oldKey, newKey, newTitle }),
  isPreviewFileDetached: (fileKey: string): Promise<boolean> => ipcRenderer.invoke(IPC.PREVIEW_IS_DETACHED, { fileKey }),
  getDetachedFileKeys: (): Promise<string[]> => ipcRenderer.invoke(IPC.PREVIEW_GET_DETACHED),
  sendPreviewUpdate: (payload: { html: string; fileKey: string }): void => ipcRenderer.send(IPC.PREVIEW_UPDATE, payload),
  sendPreviewScroll: (payload: { scrollRatio: number; fileKey: string }): void => ipcRenderer.send(IPC.PREVIEW_SCROLL, payload),
  sendPreviewSettings: (payload: Record<string, unknown>): void => ipcRenderer.send(IPC.PREVIEW_SETTINGS, payload),
  onPreviewBootstrap: (callback: (snapshot: PreviewSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: PreviewSnapshot) => callback(snapshot)
    ipcRenderer.on(IPC.PREVIEW_BOOTSTRAP, handler)
    return () => ipcRenderer.removeListener(IPC.PREVIEW_BOOTSTRAP, handler)
  },
  onPreviewUpdate: (callback: (payload: { html: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { html: string }) => callback(payload)
    ipcRenderer.on(IPC.PREVIEW_UPDATE, handler)
    return () => ipcRenderer.removeListener(IPC.PREVIEW_UPDATE, handler)
  },
  onPreviewScroll: (callback: (payload: { scrollRatio: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { scrollRatio: number }) => callback(payload)
    ipcRenderer.on(IPC.PREVIEW_SCROLL, handler)
    return () => ipcRenderer.removeListener(IPC.PREVIEW_SCROLL, handler)
  },
  onPreviewSettings: (callback: (payload: Record<string, unknown>) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Record<string, unknown>) => callback(payload)
    ipcRenderer.on(IPC.PREVIEW_SETTINGS, handler)
    return () => ipcRenderer.removeListener(IPC.PREVIEW_SETTINGS, handler)
  },
  onPreviewAttached: (callback: (payload: { fileKey: string; attached: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { fileKey: string; attached: boolean }) => callback(payload)
    ipcRenderer.on(IPC.PREVIEW_ATTACHED, handler)
    return () => ipcRenderer.removeListener(IPC.PREVIEW_ATTACHED, handler)
  },

  getCapabilities: (): Promise<Capability[]> => ipcRenderer.invoke(IPC.LICENSE_GET_CAPABILITIES),
  hasCapability: (cap: Capability): Promise<boolean> => ipcRenderer.invoke(IPC.LICENSE_HAS_CAPABILITY, { cap }),
  getLicenseStatus: (): Promise<LicenseStatus> => ipcRenderer.invoke(IPC.LICENSE_GET_STATUS),
  onLicenseStatusChanged: (callback: (status: LicenseStatus) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: LicenseStatus) => callback(status)
    ipcRenderer.on(IPC.LICENSE_STATUS_CHANGED, handler)
    return () => ipcRenderer.removeListener(IPC.LICENSE_STATUS_CHANGED, handler)
  },
  getLicenseText: (): Promise<string> => ipcRenderer.invoke(IPC.APP_GET_LICENSE_TEXT),
})

export {}
