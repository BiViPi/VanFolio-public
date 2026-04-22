// ─────────────────────────────────────────────────────────────────────────────
// VanFolio — IPC Channel Constants
// Shared between main / preload / renderer — avoids scattered magic strings
// ─────────────────────────────────────────────────────────────────────────────

// File operations (renderer → main)
export const IPC = {
  FILE_OPEN: 'file:open',
  FILE_SAVE: 'file:save',
  FILE_SAVE_AS: 'file:saveAs',
  FILE_READ: 'file:read',
  FILE_READ_IMAGE_B64: 'file:readImageB64',
  FILE_OPEN_FOLDER: 'file:openFolder',
  FILE_COPY_ASSET: 'file:copyAsset',

  // App state (renderer → main)
  APP_GET_RECENT: 'app:getRecentFiles',
  APP_REMOVE_RECENT: 'app:removeRecentFile',
  APP_GET_SETTINGS: 'app:getSettings',
  APP_SAVE_SETTINGS: 'app:saveSettings',
  APP_VERSION: 'app:getVersion',

  // Export (renderer → main)
  EXPORT_PDF: 'export:pdf',
  EXPORT_DOCX: 'export:docx',
  EXPORT_HTML: 'export:html',
  EXPORT_PNG: 'export:png',
  EXPORT_DEBUG_PDF_HTML: 'export:debugPdfHtml',

  // Shell (renderer → main)
  SHELL_OPEN_FOLDER: 'shell:openFolder',
  SHELL_OPEN_EXTERNAL: 'shell:openExternal',

  // Window controls (renderer → main)
  WIN_MINIMIZE: 'win:minimize',
  WIN_MAXIMIZE: 'win:maximize',
  WIN_CLOSE: 'win:close',

  // Window state (main → renderer)
  WIN_MAXIMIZED_CHANGED: 'win:maximizedChanged',

  // Security (renderer → main)
  SECURITY_SAVE_KEY: 'security:saveApiKey',
  SECURITY_HAS_KEY: 'security:hasApiKey',
  SECURITY_DELETE_KEY: 'security:deleteApiKey',

  // Menu events (main → renderer)
  MENU_OPEN_FILE: 'menu:openFile',
  MENU_SAVE: 'menu:save',
  MENU_SAVE_AS: 'menu:saveAs',
  MENU_EXPORT: 'menu:export',

  // App-close safety (main → renderer → main, async round-trip)
  APP_QUERY_DIRTY: 'app:queryDirty',
  APP_REPLY_DIRTY: 'app:replyDirty',
  APP_CONFIRM_CLOSE: 'app:confirmClose',
  APP_REPLY_CONFIRM_CLOSE: 'app:replyConfirmClose',

  // Session restore (renderer → main)
  SESSION_SAVE: 'session:save',
  SESSION_RESTORE: 'session:restore',
  SESSION_CLEAR: 'session:clear',
  SESSION_GET_RECOVERY_PENDING: 'session:get-recovery-pending',

  // i18n locale (renderer → main)
  I18N_GET_LOCALE: 'i18n:getLocale',

  // AI Engine (renderer → main, main → renderer)
  AI_GENERATE: 'ai:generate',
  AI_CANCEL: 'ai:cancel',
  AI_STREAM_CHUNK: 'ai:streamChunk',
  AI_STREAM_END: 'ai:streamEnd',
  AI_STREAM_ERROR: 'ai:streamError',

  // Onboarding (renderer → main)
  ONBOARDING_CHECK: 'onboarding:check',
  ONBOARDING_DONE: 'onboarding:done',
  ONBOARDING_PICK_VAULT: 'onboarding:pickVault',

  // Vault path (renderer → main)
  VAULT_GET: 'vault:get',
  VAULT_SET: 'vault:set',
  VAULT_OPEN: 'vault:open',

  // Discovery Mode (renderer → main)
  DISCOVERY_CHECK: 'discovery:check',
  DISCOVERY_DONE: 'discovery:done',
  VERSION_CREATE_SNAPSHOT: 'version:createSnapshot',
  VERSION_LIST: 'version:list',
  VERSION_GET_CONTENT: 'version:getContent',
  VERSION_DELETE: 'version:delete',
  VERSION_CLEAR_ALL: 'version:clearAll',
  VERSION_LAST_TIMESTAMP: 'version:lastTimestamp',
  VERSION_CLEANUP: 'version:cleanup',
  BACKUP_RUN_NOW: 'backup:runNow',
  BACKUP_PICK_PATH: 'backup:pickPath',
  BACKUP_LAST_TIMESTAMP: 'backup:lastTimestamp',
  STORAGE_GET_USAGE: 'storage:getUsage',
  FONT_PICK: 'font:pick',
  FONT_IMPORT: 'font:import',
  FONT_LIST: 'font:list',
  FONT_REMOVE: 'font:remove',
  FONT_READ_B64: 'font:readB64',

  // License (Phase 1)
  LICENSE_GET_CAPABILITIES: 'license:get-capabilities',
  LICENSE_HAS_CAPABILITY: 'license:has-capability',
  LICENSE_GET_STATUS: 'license:get-status',
  LICENSE_STATUS_CHANGED: 'license:status-changed',  // main → renderer push

  // Preview Detach — Multi-window (Phase 5.4 → v2)
  // renderer → main
  PREVIEW_OPEN_FILE: 'preview:openFile',      // pin a file's preview
  PREVIEW_CLOSE_FILE: 'preview:closeFile',     // unpin explicitly
  PREVIEW_TOGGLE_FILE: 'preview:toggleFile',    // toggle (UI button)
  PREVIEW_RENAME_FILE: 'preview:renameFile',    // after Save As
  PREVIEW_GET_DETACHED: 'preview:getDetached',   // query all pinned fileKeys
  // main → renderer (shared channel, payload differs by direction)
  PREVIEW_UPDATE: 'preview:update',        // { html, fileKey }
  PREVIEW_SCROLL: 'preview:scroll',        // { scrollRatio, fileKey }
  PREVIEW_SETTINGS: 'preview:settings',      // global broadcast, no fileKey
  PREVIEW_ATTACHED: 'preview:attached',      // { fileKey, attached }
  PREVIEW_IS_DETACHED: 'preview:isDetached',    // invoke: { fileKey } → boolean
  // main → preview-only window
  PREVIEW_BOOTSTRAP: 'preview:bootstrap',     // PreviewSnapshot (initial hydration)

  // Update & License (Phase 3)
  APP_CHECK_FOR_UPDATES: 'app:checkForUpdates',
  APP_GET_LICENSE_TEXT: 'app:getLicenseText',
} as const

// App defaults
export const DEFAULTS = {
  PREVIEW_DEBOUNCE_MS: 300,
  AUTOSAVE_DEBOUNCE_MS: 2000,
  SIDEBAR_WIDTH_PX: 220,
  ICON_SIDEBAR_WIDTH_PX: 52,
  TOC_SIDEBAR_WIDTH_PX: 220,
  FOCUS_IDLE_MS: 2000,
  UPDATE_CHECK_TIMEOUT_MS: 5000,
} as const

// ─────────────────────────────────────────────────────────────────────────────
// External URL config — overridable via env at build time
// Set VANFOLIO_UPDATE_FEED_URL in .env or CI to
// target staging / beta endpoints without changing app logic.
// ─────────────────────────────────────────────────────────────────────────────
function requireUrl(envKey: string, fallback: string): string {
  const val = (typeof process !== 'undefined' && process.env[envKey]) || fallback
  if (!val) throw new Error(`[config] Missing required URL: ${envKey}`)
  return val
}

export const APP_URLS = {
  UPDATE_FEED: requireUrl('VANFOLIO_UPDATE_FEED_URL', 'https://vanfolio.app/version.json'),
  LANDING: requireUrl('VANFOLIO_LANDING_URL', 'https://vanfolio.app'),
  SUPPORT: requireUrl('VANFOLIO_SUPPORT_URL', 'https://vanfolio.app/support'),
} as const

// Supported file types
export const SUPPORTED_EXTENSIONS = ['.md', '.markdown'] as const

// AI provider allowlist — shared between main (IPC validation) and renderer (UI)
export const ALLOWED_AI_PROVIDERS = ['gemini', 'anthropic', 'openai'] as const
export type AllowedAiProvider = typeof ALLOWED_AI_PROVIDERS[number]
