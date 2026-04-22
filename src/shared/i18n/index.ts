// ─────────────────────────────────────────────────────────────────────────────
// VanFolio — Lightweight i18n Engine
// No external libraries — pure TypeScript, ~40 lines
// Usage: t('menu.file'), t('toast.saved'), t('modal.title', { name: 'doc' })
// ─────────────────────────────────────────────────────────────────────────────

import vi from './vi.json'
import en from './en.json'
import ja from './ja.json'
import ko from './ko.json'
import de from './de.json'
import zhCN from './zh-CN.json'
import ptBR from './pt-BR.json'
import fr from './fr.json'
import ru from './ru.json'
import es from './es.json'

export type Translations = typeof en

// ── Locale Contract ─────────────────────────────────────────────────────────
// SUPPORTED_LOCALES is the single source of truth for all valid locale codes.
// T08/T09/T10 will add imports + catalog entries as JSON files are created.

export const SUPPORTED_LOCALES = ['en', 'vi', 'ja', 'ko', 'de', 'zh-CN', 'pt-BR', 'fr', 'ru', 'es'] as const
export type Locale = typeof SUPPORTED_LOCALES[number]

/** Type guard: checks if a string is a valid Locale. */
export function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/**
 * Maps an Electron/OS locale string (e.g. 'ja-JP', 'zh-Hans-CN') to our Locale type.
 * Falls back to 'en' for any unrecognised locale.
 */
export function normalizeLocale(raw: string): Locale {
  if (raw.startsWith('vi')) return 'vi'
  if (raw.startsWith('ja')) return 'ja'
  if (raw.startsWith('ko')) return 'ko'
  if (raw.startsWith('de')) return 'de'
  if (raw.startsWith('zh')) return 'zh-CN'
  if (raw === 'pt-BR' || raw.startsWith('pt')) return 'pt-BR'
  if (raw.startsWith('fr')) return 'fr'
  if (raw.startsWith('ru')) return 'ru'
  if (raw.startsWith('es')) return 'es'
  return 'en'
}

// catalogs: en, vi (Phase B), ja, ko, de (Phase C — T08), zh-CN, pt-BR, fr (Phase D — T09), ru, es (Phase E — T10)
const catalogs: Partial<Record<Locale, Record<string, string>>> = { en, vi, ja, ko, de, 'zh-CN': zhCN, 'pt-BR': ptBR, fr, ru, es }

let _locale: Locale = 'en'

/** Initialize locale (call once at startup). */
export function initI18n(locale: Locale): void {
  _locale = locale
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('lang', locale)
  }
}

/** Switch locale at runtime — dispatches 'i18n:changed' event for listeners (renderer only). */
export function setLocale(locale: Locale): void {
  _locale = locale
  if (typeof window !== 'undefined') {
    document.documentElement.setAttribute('lang', locale)
    window.dispatchEvent(new CustomEvent('i18n:changed', { detail: { locale } }))
  }
}

export function getLocale(): Locale {
  return _locale
}

/**
 * Translate a dot-notation key, with optional param interpolation.
 * Falls back to English, then the key itself if not found.
 * @example t('menu.file') → "Tệp" (vi) / "File" (en)
 * @example t('toast.saved', { name: 'doc.md' }) → "Đã lưu doc.md"
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const catalog = catalogs[_locale] ?? catalogs['en']
  let result = catalog[key] ?? catalogs['en']![key] ?? key

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      result = result.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }

  return result
}

export const LANG_OPTIONS = [
  { id: 'vi', label: 'Tiếng Việt', flag: '🇻🇳', supported: true },
  { id: 'en', label: 'English (US)', flag: '🇺🇸', supported: true },
  { id: 'ja', label: '日本語', flag: '🇯🇵', supported: true },
  { id: 'ko', label: '한국어', flag: '🇰🇷', supported: true },
  { id: 'de', label: 'Deutsch', flag: '🇩🇪', supported: true },
  { id: 'zh-CN', label: '中文（简体）', flag: '🇨🇳', supported: true },
  { id: 'pt-BR', label: 'Português (BR)', flag: '🇧🇷', supported: true },
  { id: 'fr', label: 'Français', flag: '🇫🇷', supported: true },
  { id: 'ru', label: 'Русский', flag: '🇷🇺', supported: true },
  { id: 'es', label: 'Español', flag: '🇪🇸', supported: true },
]
