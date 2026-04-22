import Store from 'electron-store'
import { app } from 'electron'
import type { AppSettings, SessionState } from '@shared/types'
import { normalizeLocale, isLocale } from '../shared/i18n/index'
import type { Locale } from '../shared/i18n/index'

// ─────────────────────────────────────────────────────────────────────────────
// Settings persistence via electron-store
// API key NOT stored here — use safeStorage separately (Phase 4.5)
// ─────────────────────────────────────────────────────────────────────────────

/** Maps a raw OS locale string to our Locale type. Delegates to shared normalizeLocale. */
function detectLocale(): Locale {
  try {
    return normalizeLocale(app.getLocale())
  } catch {
    return 'en'
  }
}

/**
 * Sanitizes an unknown value from store to a valid Locale.
 * Protects against stale/invalid locale values after app updates or manual edits.
 */
export function sanitizeLocale(value: unknown): Locale {
  if (typeof value === 'string' && isLocale(value)) return value
  return 'en'
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'van-ivory',
  fontFamily: 'Inter',
  previewFontFamily: 'Merriweather',
  codeFontFamily: 'JetBrains Mono',
  fontSize: 13,
  wordWrap: true,
  lineHeight: 1.8,
  paperSize: 'A4',
  paperOrientation: 'portrait',
  pageMarginTop: 76,
  pageMarginRight: 83,
  pageMarginBottom: 76,
  pageMarginLeft: 83,
  pdfColorMode: 'color',
  aiProvider: 'anthropic',
  previewBaseFontSize: 15,
  previewHeadingFont: 'Newsreader',
  previewLineHeight: 1.8,
  typewriterMode: false,
  fadeContext: false,
  autoHideSidebar: true,
  locale: 'en',  // overridden below on first run via detectLocale()
  versionHistoryEnabled: true,
  versionHistoryRetention: '30d',
  autoBackupEnabled: false,
  autoBackupFrequency: 'daily',
  paragraphSpacing: 0.8,
  spellCheck: false,
  autoSaveDelay: 2000,
  autoBackupPath: '',
  compactMode: false,
  indentWithTabs: false,
  indentSize: 4,
  smartQuotes: true,
  highlightHeader: false,
  cleanProseMode: true,
}

export interface InternalStoreSchema {
  settings: AppSettings
  recentFiles: string[]
  session: SessionState | null
  sessionRecoveryPending: boolean
  onboardingDone: boolean
  discoveryDone: boolean
  vaultPath: string | null
  'update.lastCheckAt'?: number
  'update.lastNotifiedVersion'?: string
}

const store = new Store<InternalStoreSchema>({
  defaults: {
    settings: { ...DEFAULT_SETTINGS, locale: detectLocale() },
    recentFiles: [],
    session: null,
    sessionRecoveryPending: false,
    onboardingDone: false,
    discoveryDone: false,
    vaultPath: null,
  },
})

  // ── Migration: rename legacy theme IDs (light-sage → van-ivory, dark-forest → dark-obsidian) ──
  ; (() => {
    const THEME_RENAMES: Record<string, AppSettings['theme']> = {
      'light-sage': 'van-ivory',
      'dark-forest': 'dark-obsidian',
    }
    const s = store.get('settings')
    const renamed = THEME_RENAMES[s.theme as string]
    if (renamed) {
      store.set('settings', { ...s, theme: renamed })
    }
  })()

export function getSettings(): AppSettings {
  const stored = store.get('settings')
  // Merge with DEFAULT_SETTINGS to handle fields added after initial save (backward compat)
  const merged = { ...DEFAULT_SETTINGS, ...stored }
  // Sanitize locale — guard against stale/invalid values from old installs
  merged.locale = sanitizeLocale(merged.locale)
  return merged
}

export function saveSettings(partial: Partial<AppSettings>): void {
  const current = getSettings()
  store.set('settings', { ...current, ...partial })
}

export function getRecentFiles(): string[] {
  return store.get('recentFiles') || []
}

export function addRecentFile(filePath: string): void {
  const recent = getRecentFiles().filter((p) => p !== filePath)
  recent.unshift(filePath)
  store.set('recentFiles', recent.slice(0, 20)) // max 20 entries
}

export function removeRecentFile(filePath: string): void {
  store.set('recentFiles', getRecentFiles().filter((p) => p !== filePath))
}

// ── Session persistence ────────────────────────────────────────────────────

export function getSessionState(): SessionState | null {
  return store.get('session') ?? null
}

export function saveSessionState(state: SessionState): void {
  store.set('session', state)
}

export function clearSessionState(): void {
  store.set('session', null)
}

export function getSessionRecoveryPending(): boolean {
  return store.get('sessionRecoveryPending') ?? false
}

export function setSessionRecoveryPending(value: boolean): void {
  store.set('sessionRecoveryPending', value)
}

// ── Onboarding ──────────────────────────────────────────────────────────

export function isOnboardingDone(): boolean {
  return store.get('onboardingDone') ?? false
}

export function markOnboardingDone(): void {
  store.set('onboardingDone', true)
}

// ── Vault Path ──────────────────────────────────────────────────────────

export function getVaultPath(): string | null {
  return store.get('vaultPath') ?? null
}

export function setVaultPath(path: string): void {
  store.set('vaultPath', path)
}

// ── Discovery Mode ──────────────────────────────────────────────────────

export function isDiscoveryDone(): boolean {
  return store.get('discoveryDone') ?? false
}

export function markDiscoveryDone(): void {
  store.set('discoveryDone', true)
}

/**
 * Exposes the underlying electron-store instance for internal managers.
 */
export function getInternalStore(): Store<InternalStoreSchema> {
  return store
}
