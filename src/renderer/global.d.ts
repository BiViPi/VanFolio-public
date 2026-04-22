import type {
  AppSettings,
  Locale,
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

declare global {
  interface Window {
    vanfolioAPI: {
      openFile(): Promise<OpenFileResult | null>
      openFolder(): Promise<OpenFolderResult | null>
      readFile(path: string): Promise<string | null>
      readImageAsBase64(path: string): Promise<string | null>
      onAppQueryDirty(callback: () => boolean): () => void
      onAppConfirmClose(callback: () => boolean | Promise<boolean>): () => void
      saveFile(path: string, content: string): Promise<boolean>
      saveFileAs(content: string): Promise<SaveAsResult | null>
      getRecentFiles(): Promise<string[]>
      removeRecentFile(path: string): Promise<void>
      getSettings(): Promise<AppSettings>
      saveSettings(settings: Partial<AppSettings>): Promise<void>
      getAppVersion(): Promise<string>
      checkForUpdates(force?: boolean): Promise<import('@shared/types').UpdateCheckResult>
      createSnapshot(filePath: string, content: string): Promise<SnapshotMeta | null>
      listSnapshots(filePath: string): Promise<SnapshotMeta[]>
      getSnapshotContent(filePath: string, snapshotId: string): Promise<string | null>
      deleteSnapshot(filePath: string, snapshotId: string): Promise<boolean>
      clearAllSnapshots(): Promise<number>
      cleanupSnapshots(): Promise<number>
      getLastSnapshotTimestamp(): Promise<number | null>
      runBackupNow(): Promise<BackupResult>
      pickBackupPath(): Promise<string | null>
      getLastBackupTimestamp(): Promise<number | null>
      getStorageUsage(): Promise<StorageUsage>
      pickFontFiles(): Promise<string[]>
      importFont(sourcePath: string): Promise<FontMeta | null>
      listCustomFonts(): Promise<FontMeta[]>
      removeCustomFont(fontId: string): Promise<boolean>
      readFontBase64(fontPath: string): Promise<string | null>
      exportPdf(options: ExportOptions): Promise<ExportResult>
      buildPdfDebugHtml(options: ExportOptions): Promise<string>
      exportDocx(options: ExportOptions): Promise<ExportResult>
      exportHtml(options: ExportOptions): Promise<ExportResult>
      exportPng(options: ExportOptions): Promise<ExportResult>
      copyAsset(sourcePath: string, mdFilePath: string): Promise<CopyAssetResult>
      openInExplorer(path: string): void
      openExternal(url: string): void
      minimizeWindow(): void
      maximizeWindow(): void
      closeWindow(): void
      saveApiKey(provider: string, key: string): Promise<boolean>
      hasApiKey(provider: string): Promise<boolean>
      deleteApiKey(provider: string): Promise<void>
      onMenuOpenFile(callback: () => void): () => void
      onMenuSave(callback: () => void): () => void
      onMenuSaveAs(callback: () => void): () => void
      onMenuExport(callback: (format: ExportFormat) => void): () => void
      onWindowMaximizedChanged(callback: (isMaximized: boolean) => void): () => void
      saveSession(state: SessionState): Promise<boolean>
      restoreSession(): Promise<SessionState | null>
      clearSession(): Promise<void>
      getSessionRecoveryPending(): Promise<boolean>
      getSystemLocale(): Promise<Locale>
      aiGenerate(request: AIGenerateRequest): Promise<{ ok: boolean } | { error: string }>
      cancelAiGenerate(requestId: string): void
      onAiChunk(callback: (chunk: AIStreamChunk) => void): () => void
      onAiEnd(callback: (payload: AIStreamEnd) => void): () => void
      onAiError(callback: (payload: AIStreamError) => void): () => void
      checkOnboarding(): Promise<boolean>
      markOnboardingDone(): Promise<void>
      pickVaultPath(): Promise<string | null>
      getVaultPath(): Promise<string | null>
      setVaultPath(path: string): Promise<void>
      openVault(): Promise<OpenFolderResult | null>
      checkDiscovery(): Promise<boolean>
      markDiscoveryDone(): Promise<void>
      openPreviewFile(snapshot: PreviewSnapshot): void
      closePreviewFile(fileKey: string): void
      togglePreviewFile(snapshot: PreviewSnapshot): void
      renamePreviewFile(oldKey: string, newKey: string, newTitle: string): void
      isPreviewFileDetached(fileKey: string): Promise<boolean>
      getDetachedFileKeys(): Promise<string[]>
      sendPreviewUpdate(payload: { html: string; fileKey: string }): void
      sendPreviewScroll(payload: { scrollRatio: number; fileKey: string }): void
      sendPreviewSettings(payload: Record<string, unknown>): void
      onPreviewBootstrap(callback: (snapshot: PreviewSnapshot) => void): () => void
      onPreviewUpdate(callback: (payload: { html: string }) => void): () => void
      onPreviewScroll(callback: (payload: { scrollRatio: number }) => void): () => void
      onPreviewSettings(callback: (payload: Record<string, unknown>) => void): () => void
      onPreviewAttached(callback: (payload: { fileKey: string; attached: boolean }) => void): () => void
      getCapabilities(): Promise<Capability[]>
      hasCapability(cap: Capability): Promise<boolean>
      getLicenseStatus(): Promise<LicenseStatus>
      onLicenseStatusChanged(callback: (status: LicenseStatus) => void): () => void
      getLicenseText(): Promise<string>
    }
  }
}

export {}
