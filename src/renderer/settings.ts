import type { AppSettings } from '@shared/types'
import { LANG_OPTIONS, setLocale, t } from '@shared/i18n'
import {
  setCleanProse,
  setHighlightHeader,
  setIndentConfig,
  setSmartQuotes,
  setSpellCheck,
  setWordWrap,
} from './editor'
import { setAutoSaveDelay } from './fileTabs'
import { applyPreviewLayout, setPreviewTypographer, triggerLayoutRepaginate } from './preview'
import { refreshCustomFonts } from './fontLibrary'
import { showToast } from './toast'

let currentSettings: AppSettings | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let bindingsReady = false

const DEFAULT_PAGE_MARGIN_TOP = 76
const DEFAULT_PAGE_MARGIN_RIGHT = 83
const DEFAULT_PAGE_MARGIN_BOTTOM = 76
const DEFAULT_PAGE_MARGIN_LEFT = 83

export function initSettings(settings: AppSettings): void {
  currentSettings = { ...settings }
  applySettingsToDOM(currentSettings)
  buildSettingsPanel()
  bindGlobalSettingsEvents()
}

export function getAppSettings(): AppSettings | null {
  return currentSettings ? { ...currentSettings } : null
}

export function openSettings(): void {
  document.getElementById('settings-panel')?.classList.add('open')
  buildSettingsPanel()
}

export function openLicenseTab(): void {
  openSettings()
}

export function closeSettings(): void {
  document.getElementById('settings-panel')?.classList.remove('open')
}

export async function applyTheme(theme: AppSettings['theme']): Promise<void> {
  updateSetting('theme', theme)
}

export function updateSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
  shouldApplyToDom = true,
): void {
  if (!currentSettings) return
  currentSettings = { ...currentSettings, [key]: value }
  if (shouldApplyToDom) applySettingsToDOM(currentSettings)
  queuePersist({ [key]: value } as Partial<AppSettings>)
  buildSettingsPanel()
}

function bindGlobalSettingsEvents(): void {
  if (bindingsReady) return
  bindingsReady = true

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSettings()
  })

  window.addEventListener('i18n:changed', () => {
    if (document.getElementById('settings-panel')?.classList.contains('open')) {
      buildSettingsPanel()
    }
  })
}

function queuePersist(partial: Partial<AppSettings>): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    window.vanfolioAPI.saveSettings(partial).catch(console.error)
  }, 200)
}

function applySettingsToDOM(settings: AppSettings): void {
  const root = document.documentElement
  root.setAttribute('data-theme', settings.theme)
  root.style.setProperty('--font-ui', settings.fontFamily)
  root.style.setProperty('--font-preview', settings.previewFontFamily)
  root.style.setProperty('--font-heading', settings.previewHeadingFont)
  root.style.setProperty('--font-mono', settings.codeFontFamily || 'JetBrains Mono')
  root.style.setProperty('--editor-font-size', `${settings.fontSize}px`)
  root.style.setProperty('--editor-line-height', String(settings.lineHeight))
  root.style.setProperty('--editor-paragraph-spacing', `${settings.paragraphSpacing}em`)
  root.style.setProperty('--preview-line-height', String(settings.previewLineHeight))
  root.style.setProperty('--preview-base-size', `${settings.previewBaseFontSize}px`)
  root.style.setProperty('--paper-margin-top', `${settings.pageMarginTop ?? DEFAULT_PAGE_MARGIN_TOP}px`)
  root.style.setProperty('--paper-margin-right', `${settings.pageMarginRight ?? DEFAULT_PAGE_MARGIN_RIGHT}px`)
  root.style.setProperty('--paper-margin-bottom', `${settings.pageMarginBottom ?? DEFAULT_PAGE_MARGIN_BOTTOM}px`)
  root.style.setProperty('--paper-margin-left', `${settings.pageMarginLeft ?? DEFAULT_PAGE_MARGIN_LEFT}px`)
  root.style.setProperty('--paper-padding-v', `${settings.pageMarginTop ?? DEFAULT_PAGE_MARGIN_TOP}px`)
  root.style.setProperty('--paper-padding-h', `${settings.pageMarginLeft ?? DEFAULT_PAGE_MARGIN_LEFT}px`)
  root.style.setProperty('--preview-paragraph-spacing', `${settings.paragraphSpacing}em`)
  root.setAttribute('data-compact', String(settings.compactMode ?? false))

  setWordWrap(settings.wordWrap)
  setSpellCheck(settings.spellCheck)
  setIndentConfig(settings.indentWithTabs, settings.indentSize)
  setHighlightHeader(settings.highlightHeader)
  setSmartQuotes(settings.smartQuotes)
  setCleanProse(settings.cleanProseMode)
  setPreviewTypographer(settings.smartQuotes)
  setAutoSaveDelay(settings.autoSaveDelay)
  applyPreviewLayout(settings.paperSize, settings.paperOrientation)
  triggerLayoutRepaginate()
}

function buildSettingsPanel(): void {
  const panel = document.getElementById('settings-panel')
  const settings = currentSettings
  if (!panel || !settings) return

  panel.replaceChildren()

  const modal = createElement('div', 's-modal')
  const content = createElement('div', 's-content')
  const header = createElement('div', 's-sidenav-header')
  const title = createTextElement('h2', 's-sidenav-title', t('settings.preferences'))
  header.appendChild(title)
  content.appendChild(header)

  const body = createElement('div', 's-tab-body')
  body.appendChild(buildThemeSection(settings))
  body.appendChild(buildLanguageSection(settings))
  body.appendChild(buildEditorSection(settings))
  body.appendChild(buildArchiveSection(settings))
  body.appendChild(buildAiSection(settings))
  content.appendChild(body)

  const footer = createElement('div', 'modal-footer')
  const closeBtn = createTextElement('button', 'btn-primary', t('about.close'))
  closeBtn.addEventListener('click', closeSettings)
  footer.appendChild(closeBtn)
  content.appendChild(footer)

  modal.appendChild(content)
  panel.appendChild(modal)
}

function buildThemeSection(settings: AppSettings): HTMLElement {
  const section = buildSection(t('settings.general.theme'))
  const themes: AppSettings['theme'][] = ['van-ivory', 'dark-obsidian', 'van-botanical', 'van-chronicle']
  const list = createElement('div', 'settings-theme-grid')

  for (const theme of themes) {
    const button = createTextElement('button', `settings-theme-card${settings.theme === theme ? ' active' : ''}`, theme)
    button.addEventListener('click', () => {
      updateSetting('theme', theme)
    })
    list.appendChild(button)
  }

  section.appendChild(list)
  return section
}

function buildLanguageSection(settings: AppSettings): HTMLElement {
  const section = buildSection(t('settings.general.language'))
  const select = document.createElement('select')
  for (const option of LANG_OPTIONS) {
    const el = document.createElement('option')
    el.value = option.value
    el.textContent = option.label
    el.selected = option.value === settings.locale
    select.appendChild(el)
  }
  select.addEventListener('change', async () => {
    const locale = select.value as AppSettings['locale']
    await setLocale(locale)
    updateSetting('locale', locale, false)
    buildSettingsPanel()
  })
  section.appendChild(select)
  return section
}

function buildEditorSection(settings: AppSettings): HTMLElement {
  const section = buildSection(t('settings.editor.title'))
  section.appendChild(
    buildCheckboxRow(t('settings.editor.wordWrap'), settings.wordWrap, (next) => updateSetting('wordWrap', next)),
  )
  section.appendChild(
    buildCheckboxRow(t('statusbar.spellcheck'), settings.spellCheck, (next) => updateSetting('spellCheck', next)),
  )
  section.appendChild(
    buildCheckboxRow(t('menu.view.typewriter'), settings.typewriterMode, (next) => updateSetting('typewriterMode', next)),
  )
  section.appendChild(
    buildCheckboxRow(t('menu.view.fadeContext'), settings.fadeContext, (next) => updateSetting('fadeContext', next)),
  )
  section.appendChild(
    buildCheckboxRow(t('settings.editor.smartQuotes'), settings.smartQuotes, (next) => updateSetting('smartQuotes', next)),
  )
  return section
}

function buildArchiveSection(settings: AppSettings): HTMLElement {
  const section = buildSection(t('settings.archive.title'))
  const backupPath = createTextElement('p', 'settings-note', settings.autoBackupPath || t('archive.notConfigured'))
  const pickPath = createTextElement('button', 'btn-secondary', t('archive.selectFolder'))
  pickPath.addEventListener('click', async () => {
    const nextPath = await window.vanfolioAPI.pickBackupPath()
    if (!nextPath) return
    updateSetting('autoBackupPath', nextPath, false)
    backupPath.textContent = nextPath
  })

  const runBackup = createTextElement('button', 'btn-primary', t('archive.runBackupNow'))
  runBackup.addEventListener('click', async () => {
    const result = await window.vanfolioAPI.runBackupNow()
    if (result.success) {
      showToast(t('archive.backupNowSuccess'), 'success')
    } else {
      showToast(result.error || t('common.unknownError'), 'error')
    }
  })

  const note = createTextElement('p', 'settings-note', t('archive.manualOnlyNote'))
  section.appendChild(note)
  section.appendChild(backupPath)
  section.appendChild(pickPath)
  section.appendChild(runBackup)
  return section
}

function buildAiSection(settings: AppSettings): HTMLElement {
  const section = buildSection(t('settings.ai.title'))
  const providerLabel = createTextElement('p', 'settings-note', t('settings.ai.provider'))
  const provider = document.createElement('select')
  for (const option of ['gemini', 'anthropic', 'openai'] as const) {
    const el = document.createElement('option')
    el.value = option
    el.textContent = option
    el.selected = option === settings.aiProvider
    provider.appendChild(el)
  }
  provider.addEventListener('change', () => {
    updateSetting('aiProvider', provider.value as AppSettings['aiProvider'], false)
  })
  const info = createTextElement('p', 'settings-note', t('settings.ai.byokDescription'))
  section.appendChild(providerLabel)
  section.appendChild(provider)
  section.appendChild(info)
  return section
}

function buildSection(title: string): HTMLElement {
  const section = createElement('section', 'settings-section')
  const header = createTextElement('h3', 'settings-section-title', title)
  section.appendChild(header)
  return section
}

function buildCheckboxRow(label: string, checked: boolean, onChange: (value: boolean) => void): HTMLElement {
  const row = createElement('label', 'form-checkbox')
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = checked
  input.addEventListener('change', () => onChange(input.checked))
  const text = document.createElement('span')
  text.textContent = label
  row.appendChild(input)
  row.appendChild(text)
  return row
}

function createElement(tag: string, className: string): HTMLElement {
  const element = document.createElement(tag)
  element.className = className
  return element
}

function createTextElement(tag: string, className: string, text: string): HTMLElement {
  const element = createElement(tag, className)
  element.textContent = text
  return element
}

refreshCustomFonts().catch(() => {
  // Non-critical in renderer bootstrap.
})
