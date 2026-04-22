// -----------------------------------------------------------------------------
// VanFolio - Shared Types
// Shared between main / preload / renderer - do NOT import any Node API
// -----------------------------------------------------------------------------
import type { Locale } from './i18n/index'
export type { Locale }

// File system
export interface FileTreeNode {
  name: string
  type: 'file' | 'folder'
  path: string
  children?: FileTreeNode[] // only present for folders
  // Only returns .md files and folders containing .md - filtered in main process
}

// Export
export type ExportFormat = 'pdf' | 'docx' | 'html' | 'png'

export interface ExportOptions {
  markdown: string // Raw markdown content
  renderedHtml?: string // Pre-rendered/paginated HTML for WYSIWYG
  filePath: string // Source .md path
  outputPath?: string // If undefined -> show save dialog
  format: ExportFormat
  liveSettings?: Partial<AppSettings>
  paperSize?: 'A4' | 'A3' | 'Letter'
  orientation?: 'portrait' | 'landscape'
  includeToc?: boolean
  includePageNumbers?: boolean
  watermark?: string
  // PDF/PNG-specific
  colorMode?: 'color' | 'bw' // 'color' = theme colors, 'bw' = black & white
  docTokens?: DocTokens // resolved CSS var values for headless export
  // HTML-specific
  embedCss?: boolean
  embedFonts?: boolean
  selfContained?: boolean
  // PNG-specific
  scale?: 1 | 2 | 3
  transparentBg?: boolean
  pngMode?: 'single' | 'per-page'
}

/** Resolved --doc-* token values, passed from renderer to main for headless export */
export interface DocTokens {
  heading: string
  accent: string
  text: string
  bg: string // Body background
  surface: string // Document wrapper (paper) background
  border: string
  borderSubtle: string
  codeBg: string
  // Margins
  marginTop: number
  marginRight: number
  marginBottom: number
  marginLeft: number
  // Metrics - fixes scaling mismatch vs Preview
  previewBaseFontSize: number
  previewLineHeight: number
  paperWidth: number
  paperHeight: number
  previewFontFamily: string
  previewHeadingFont: string
  // Typography - direct computed values to bypass em/rem mismatch
  h1Size: string
  h2Size: string
  h3Size: string
  h4Size: string
  h5Size: string
  paragraphSpacing: string
  // Print metrics
  printBaseFontSize: string
  printLineHeight: string
  printMarginTop: string
  printMarginRight: string
  printMarginBottom: string
  printMarginLeft: string
  printH1Size: string
  printH2Size: string
  printH3Size: string
  printH4Size: string
  printH5Size: string
  printParagraphSpacing: string
}

export interface ExportResult {
  success: boolean
  path?: string
  error?: string
}

export interface SnapshotMeta {
  id: string
  filePath: string
  timestamp: number
  sizeBytes: number
}

export interface SnapshotRecord extends SnapshotMeta {
  content: string
}

export interface BackupResult {
  success: boolean
  timestamp: number
  path?: string
  error?: string
}

export interface StorageUsage {
  vaultBytes: number
  historyBytes: number
  backupBytes: number
}

export interface FontMeta {
  id: string
  family: string
  fileName: string
  format: 'truetype' | 'opentype'
  path: string
}

// Settings
export type ThemeName = 'van-ivory' | 'dark-obsidian' | 'van-botanical' | 'van-chronicle' | 'burgundy'
export type AiProvider = 'openai' | 'anthropic' | 'gemini'

export interface AppSettings {
  theme: ThemeName
  fontFamily: string // UI chrome font
  previewFontFamily: string // Preview body font
  codeFontFamily: string // Editor/code font
  fontSize: number
  wordWrap: boolean
  lineHeight: number
  paperSize: 'A4' | 'A3' | 'Letter'
  paperOrientation: 'portrait' | 'landscape'
  pageMarginTop: number
  pageMarginRight: number
  pageMarginBottom: number
  pageMarginLeft: number
  pdfColorMode: 'color' | 'bw'
  aiProvider: AiProvider
  previewBaseFontSize: number
  previewHeadingFont: string
  previewLineHeight: number
  typewriterMode: boolean
  fadeContext: boolean
  autoHideSidebar: boolean
  locale: Locale
  versionHistoryEnabled: boolean
  versionHistoryRetention: '7d' | '30d' | 'forever'
  autoBackupEnabled: boolean
  autoBackupFrequency: '1h' | '6h' | 'daily'
  autoBackupPath: string
  paragraphSpacing: number // em units, applied to editor line padding
  spellCheck: boolean
  autoSaveDelay: number // ms debounce for auto-save (0 = on change)
  compactMode: boolean
  indentWithTabs: boolean
  indentSize: 2 | 4 | 8
  smartQuotes: boolean
  highlightHeader: boolean
  cleanProseMode: boolean
  // API key not stored here - use safeStorage separately
}

// Asset copy
export interface CopyAssetResult {
  relativePath: string // "./assets/image-name.png"
  success: boolean
  error?: string
}

// App state helpers
export interface OpenFileResult {
  path: string
  content: string
}

export interface SaveAsResult {
  path: string
}

export interface OpenFolderResult {
  folderPath: string
  tree: FileTreeNode[]
}

// Session
export interface SessionTabState {
  path: string | null // null = Untitled
  content: string
  displayName: string
  isDirty: boolean
}

export interface SessionState {
  openTabs: SessionTabState[]
  activeIndex: number
}

export interface SessionFlags {
  recoveryPending: boolean
}

// AI
export type AIScope = 'fix-grammar' | 'translate' | 'expand' | 'summarize' | 'continue' | 'explain' | 'freeform'

export interface AIGenerateRequest {
  prompt: string
  scope: AIScope
  contextBefore: string // up to 500 chars before cursor
  contextAfter: string // up to 500 chars after cursor
  provider: string // 'gemini' | 'anthropic' | 'openai'
  requestId: string // uuid for cancel/chunk matching
}

export interface AIStreamChunk {
  text: string
  requestId: string
}

export interface AIStreamEnd {
  requestId: string
}

export interface AIStreamError {
  requestId: string
}

// Preview window bootstrap snapshot - full state needed to hydrate a new pinned window
export interface PreviewSnapshot {
  fileKey: string // path (saved) or tabId (untitled)
  title: string // window title
  html: string // current paginated HTML
  scrollRatio: number // 0-1 scroll position
  settings: Record<string, unknown> // theme, zoom, etc.
  sourcePath: string | null // source .md path for image resolution
}

// Capability
export type Capability =
  | 'export.docx'
  | 'export.html'
  | 'export.png'
  | 'export.pdfNoWatermark'
  | 'font.import'
  | 'history.unlimitedRetention'
  | 'backup.scheduler'
  | 'preview.detach'
  | 'tabs.unlimited'
  | 'slash.all'
  | 'editor.typewriterMode'
  | 'editor.fadeContext'
  | 'editor.smartQuotes'
  | 'editor.highlightHeader'
  | 'editor.cleanProseMode'

// Licensing
export type LicenseTier = 'free' | 'trial' | 'pro'

export type LicenseState =
  | 'inactive'
  | 'active'
  | 'trial-active'
  | 'trial-expired'
  | 'disabled'
  | 'invalid'
  | 'network-error'
  | 'local-corrupted'
  | 'clock-tamper-suspected'

export interface LicenseStatus {
  tier: LicenseTier
  state: LicenseState
  expiresAt?: string
  customerEmailMasked?: string
  deviceLabel?: string
  lastValidatedAt?: number
  validationErrorCode?: string
  activationsUsed?: number
  activationsLimit?: number
  trialMigrationWarning?: 'fingerprint-unavailable' | 'fingerprint-low-confidence'
}

export interface LicenseUsage {
  activationsUsed: number
  activationsLimit: number
}

export interface ActivateLicenseInput {
  licenseKey: string
}

export type LicenseActivationErrorCode =
  | 'invalid-key'
  | 'wrong-product'
  | 'device-limit-reached'
  | 'ghost-instance-suspected'
  | 'license-disabled'
  | 'license-expired'
  | 'network-error'
  | 'invalid-response'
  | 'unknown'

export interface ActivateLicenseResult {
  success: boolean
  status?: LicenseStatus
  usage?: LicenseUsage
  errorCode?: LicenseActivationErrorCode
  errorMessage?: string
}

export interface DeactivateLicenseResult {
  success: boolean
  errorCode?: 'network-error' | 'not-activated' | 'unknown'
  errorMessage?: string
}

// Paper dimensions at 96dpi (portrait: width x height)
export const PAPER_SIZES: Record<'A4' | 'A3' | 'Letter', [number, number]> = {
  A4: [794, 1123],
  A3: [1123, 1587],
  Letter: [816, 1056],
}

// Update check
export interface UpdateInfo {
  version: string
  downloadUrl: string
  releaseNotesUrl?: string
  publishedAt?: string
}

export type UpdateStatus = 'up-to-date' | 'update-available' | 'check-failed' | 'checking'

export interface UpdateCheckResult {
  status: UpdateStatus
  latestVersion?: string
  updateInfo?: UpdateInfo
  error?: string
}
