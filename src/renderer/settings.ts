import type { AppSettings, LicenseStatus } from '@shared/types'
import { t, setLocale, LANG_OPTIONS } from '@shared/i18n'
import { setWordWrap, setSpellCheck, setIndentConfig, setHighlightHeader, setSmartQuotes, setCleanProse } from './editor'
import { setPreviewTypographer, applyPreviewLayout, triggerLayoutRepaginate } from './preview'
import { setAutoSaveDelay } from './fileTabs'
import { openVersionHistoryModal, showInlineConfirm } from './versionHistory'
import { hasCapability } from './licenseGate'
import { showToast } from './toast'
import { showUpgradePrompt } from './upgradePrompt'
import { bindFloatingTooltip } from './tooltip'
import {
  addFontsFromPicker,
  getCustomFontOptions,
  getCustomFonts,
  refreshCustomFonts
} from './fontLibrary'



let _settings: AppSettings | null = null
let _saveTimer: ReturnType<typeof setTimeout> | null = null
let _activeTab: TabId = 'general'
let isEscapeBound = false
let isI18nBound = false
let isFontLibraryBound = false
let isLicenseBound = false
let _appVersion = '1.0.0'
const DEFAULT_PAGE_MARGIN_TOP = 76
const DEFAULT_PAGE_MARGIN_RIGHT = 83
const DEFAULT_PAGE_MARGIN_BOTTOM = 76
const DEFAULT_PAGE_MARGIN_LEFT = 83

const BUILTIN_HEADING_FONT_OPTIONS = [
  { value: 'Newsreader', label: 'Newsreader' },
  { value: 'Playfair Display', label: 'Playfair Display' },
  { value: 'Inter', label: 'Inter' },
]

const BUILTIN_BODY_FONT_OPTIONS = [
  { value: 'Merriweather', label: 'Merriweather' },
  { value: 'Inter', label: 'Inter' },
  { value: 'Georgia', label: 'Georgia' },
]

const BUILTIN_CODE_FONT_OPTIONS = [
  { value: 'JetBrains Mono', label: 'JetBrains Mono' },
  { value: 'Fira Code', label: 'Fira Code' },
  { value: 'Courier Prime', label: 'Courier Prime' },
  { value: 'Roboto Mono', label: 'Roboto Mono' },
]

type TabId = 'general' | 'editor' | 'typography' | 'ai' | 'archive' | 'license'

const TAB_CONFIG: { id: TabId; icon: string }[] = [
  { id: 'general', icon: 'settings' },
  { id: 'editor', icon: 'edit_note' },
  { id: 'typography', icon: 'text_fields' },
  { id: 'ai', icon: 'auto_awesome' },
  { id: 'archive', icon: 'shield_lock' },
  { id: 'license', icon: 'workspace_premium' },
]

const VISIBLE_TAB_IDS: readonly TabId[] = ['general', 'editor', 'typography', 'archive']

const THEMES = [
  { id: 'van-ivory' as const, label: 'Van Ivory', colors: ['#FDFCFB', '#D4AF37'], available: true },
  { id: 'dark-obsidian' as const, label: 'Dark Obsidian', colors: ['#1B263B', '#26A69A'], available: true },
  { id: 'van-botanical' as const, label: 'Van Botanical', colors: ['#F8F3E1', '#9CAB84'], available: true },
  { id: 'van-chronicle' as const, label: 'Van Chronicle', colors: ['#0D0C0B', '#FFAA1D'], available: true },
]

const AI_PROVIDERS: { id: AppSettings['aiProvider']; label: string }[] = [
  { id: 'gemini', label: 'Gemini' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
]


export function initSettings(settings: AppSettings): void {
  _settings = {
    ...settings,
    codeFontFamily: settings.codeFontFamily || 'JetBrains Mono',
    pageMarginTop: Number.isFinite(settings.pageMarginTop) ? settings.pageMarginTop : DEFAULT_PAGE_MARGIN_TOP,
    pageMarginRight: Number.isFinite(settings.pageMarginRight) ? settings.pageMarginRight : DEFAULT_PAGE_MARGIN_RIGHT,
    pageMarginBottom: Number.isFinite(settings.pageMarginBottom) ? settings.pageMarginBottom : DEFAULT_PAGE_MARGIN_BOTTOM,
    pageMarginLeft: Number.isFinite(settings.pageMarginLeft) ? settings.pageMarginLeft : DEFAULT_PAGE_MARGIN_LEFT,
  }
  ensureFontSelectionsValid()
  applySettingsToDOM(_settings)
  buildSettingsPanel()

  if (!isEscapeBound) {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('settings-panel')?.classList.contains('open')) closeSettings()
    })
    isEscapeBound = true
  }

  if (!isI18nBound) {
    window.addEventListener('i18n:changed', () => buildSettingsPanel())
    isI18nBound = true
  }

  if (!isFontLibraryBound) {
    window.addEventListener('fontLibrary:updated', () => {
      if (!_settings) return
      ensureFontSelectionsValid()
      if (_activeTab === 'typography') switchTab('typography')
    })
    isFontLibraryBound = true
  }

  if (!isLicenseBound) {
    window.addEventListener('license:updated', () => {
      buildSettingsPanel()
      updateProBadgesAndOverlays().catch(console.error)
    })
    isLicenseBound = true
  }

  updateProBadgesAndOverlays().catch(console.error)
}

export function openSettings(): void {
  document.getElementById('settings-panel')?.classList.add('open')
  document.dispatchEvent(new CustomEvent('settings:opened'))
}

export function closeSettings(): void {
  document.getElementById('settings-panel')?.classList.remove('open')
  document.dispatchEvent(new CustomEvent('settings:closed'))
}

export async function applyTheme(theme: AppSettings['theme']): Promise<void> {
  document.documentElement.setAttribute('data-theme', theme)
  window.vanfolioAPI.sendPreviewSettings({ theme })
  await window.vanfolioAPI.saveSettings({ theme })
  if (_settings) _settings.theme = theme
}

function debouncedSave(partial: Partial<AppSettings>): void {
  if (_saveTimer) clearTimeout(_saveTimer)
  _saveTimer = setTimeout(() => window.vanfolioAPI.saveSettings(partial).catch(console.error), 300)
}

function applyPreviewScale(base: number): void {
  const r = document.documentElement
  r.style.setProperty('--preview-base-size', `${base}px`)
  r.style.setProperty('--preview-h1-size', `${(base * 2.25).toFixed(1)}px`)
  r.style.setProperty('--preview-h2-size', `${(base * 1.5).toFixed(1)}px`)
  r.style.setProperty('--preview-h3-size', `${(base * 1.25).toFixed(1)}px`)
  r.style.setProperty('--preview-h4-size', `${(base * 1.1).toFixed(1)}px`)
  r.style.setProperty('--preview-h5-size', `${(base * 1.0).toFixed(1)}px`)
  r.style.setProperty('--preview-h6-size', `${(base * 0.9).toFixed(1)}px`)
}

function applySettingsToDOM(s: AppSettings): void {
  const pageMarginTop = DEFAULT_PAGE_MARGIN_TOP
  const pageMarginRight = DEFAULT_PAGE_MARGIN_RIGHT
  const pageMarginBottom = DEFAULT_PAGE_MARGIN_BOTTOM
  const pageMarginLeft = DEFAULT_PAGE_MARGIN_LEFT
  const paragraphSpacing = Number.isFinite(s.paragraphSpacing) ? s.paragraphSpacing : 0.8  // 0.8 = safe fallback, default in store is also 0.8

  const r = document.documentElement
  r.setAttribute('data-theme', s.theme)
  r.style.setProperty('--font-ui', s.fontFamily)
  r.style.setProperty('--font-preview', s.previewFontFamily)
  r.style.setProperty('--font-heading', s.previewHeadingFont)
  r.style.setProperty('--font-mono', fontStack(s.codeFontFamily, 'monospace'))

  r.style.setProperty('--editor-font-size', `${s.fontSize}px`)
  r.style.setProperty('--editor-line-height', String(s.lineHeight))
  r.style.setProperty('--editor-paragraph-spacing', `${s.paragraphSpacing}em`)

  // UI Preview Metrics (px)
  r.style.setProperty('--preview-line-height', String(s.previewLineHeight))
  r.style.setProperty('--paper-margin-top', `${pageMarginTop}px`)
  r.style.setProperty('--paper-margin-right', `${pageMarginRight}px`)
  r.style.setProperty('--paper-margin-bottom', `${pageMarginBottom}px`)
  r.style.setProperty('--paper-margin-left', `${pageMarginLeft}px`)
  r.style.setProperty('--paper-padding-v', `${pageMarginTop}px`)
  r.style.setProperty('--paper-padding-h', `${pageMarginLeft}px`)
  r.style.setProperty('--preview-paragraph-spacing', `${paragraphSpacing}em`)

  // Print Native Metrics (pt/mm) for Alignment
  // 1px ≈ 0.264583mm at 96 DPI
  r.style.setProperty('--print-margin-top', `${(pageMarginTop * 0.2646).toFixed(2)}mm`)
  r.style.setProperty('--print-margin-right', `${(pageMarginRight * 0.2646).toFixed(2)}mm`)
  r.style.setProperty('--print-margin-bottom', `${(pageMarginBottom * 0.2646).toFixed(2)}mm`)
  r.style.setProperty('--print-margin-left', `${(pageMarginLeft * 0.2646).toFixed(2)}mm`)

  // 1px = 0.75pt (CSS absolute unit conversion: 96px = 72pt)
  const printBasePt = (s.previewBaseFontSize * 0.75).toFixed(1)
  r.style.setProperty('--print-base-size', `${printBasePt}pt`)
  r.style.setProperty('--print-line-height', String(s.previewLineHeight))
  r.style.setProperty('--print-h1-size', `${(parseFloat(printBasePt) * 2.25).toFixed(1)}pt`)
  r.style.setProperty('--print-h2-size', `${(parseFloat(printBasePt) * 1.5).toFixed(1)}pt`)
  r.style.setProperty('--print-h3-size', `${(parseFloat(printBasePt) * 1.25).toFixed(1)}pt`)
  r.style.setProperty('--print-h4-size', `${(parseFloat(printBasePt) * 1.1).toFixed(1)}pt`)
  r.style.setProperty('--print-h5-size', `${printBasePt}pt`)
  r.style.setProperty('--print-paragraph-spacing', `${paragraphSpacing}em`)

  applyPreviewScale(s.previewBaseFontSize)
  const [pw, ph] = (s.paperSize === 'A3' ? [1123, 1587] : s.paperSize === 'Letter' ? [816, 1056] : [794, 1123])
  const [width, height] = (s.paperOrientation === 'landscape' ? [ph, pw] : [pw, ph])
  document.documentElement.style.setProperty('--paper-width', `${width}px`)
  document.documentElement.style.setProperty('--paper-height', `${height}px`)
  document.documentElement.setAttribute('data-compact', String(s.compactMode ?? false))
  setWordWrap(s.wordWrap)
  setAutoSaveDelay(s.autoSaveDelay)
}

/** Update Pro badges and overlays when license status changes */
async function updateProBadgesAndOverlays(): Promise<void> {
  const badgeEls = document.querySelectorAll<HTMLElement>(
    '#settings-panel .badge-pro[data-pro-capability], #settings-panel .badge-pro-lg[data-pro-capability]'
  )
  for (const badge of badgeEls) {
    const capability = badge.dataset.proCapability
    if (!capability) continue
    const hasAccess = await hasCapability(capability)
    badge.style.display = hasAccess ? 'none' : ''
  }

  const overlays = document.querySelectorAll<HTMLElement>('.pro-feature-overlay')
  for (const overlay of overlays) {
    const capability = overlay.dataset.proCapability
    if (!capability) continue
    const hasAccess = await hasCapability(capability)
    overlay.style.display = hasAccess ? 'none' : ''
  }
}

function buildSettingsPanel(): void {
  const panel = document.getElementById('settings-panel')
  if (!panel || !_settings) return
  panel.replaceChildren()

  const modal = el('div', 's-modal')
  modal.appendChild(buildSideNav())
  const content = el('div', 's-content')
  const body = el('div', 's-tab-body')
  body.id = 'settings-tab-body'
  content.appendChild(body)
  modal.appendChild(content)
  panel.appendChild(modal)
  switchTab(_activeTab)
  updateProBadgesAndOverlays().catch(console.error)
}

function buildSideNav(): HTMLElement {
  const aside = el('aside', 's-sidenav')
  const header = el('div', 's-sidenav-header')
  const h2 = elText('h2', t('settings.preferences'))
  h2.className = 's-sidenav-title'
  header.appendChild(h2)
  aside.appendChild(header)
  const nav = el('nav', 's-nav')
  for (const tab of TAB_CONFIG) {
    if (!VISIBLE_TAB_IDS.includes(tab.id)) continue
    const btn = el('button', 's-nav-item')
    btn.dataset.tab = tab.id
    if (tab.id === _activeTab) btn.classList.add('active')
    const iconSpan = elText('span', tab.icon)
    iconSpan.className = 's-nav-icon material-symbols-outlined'
    const textSpan = elText('span', t(`settings.tab.${tab.id}`))
    btn.append(iconSpan, textSpan)
    btn.addEventListener('click', () => switchTab(tab.id))
    nav.appendChild(btn)
  }
  aside.appendChild(nav)

  const footer = el('div', 's-sidenav-footer')
  const versionBadge = el('div', 's-version-badge')
  const dot = el('span', 's-version-dot')
  const versionText = el('span', 's-version-text')
  versionText.textContent = `VanFolio  v${_appVersion}`
  versionBadge.append(dot, versionText)
  footer.appendChild(versionBadge)
  aside.appendChild(footer)

  return aside
}

function switchTab(tabId: TabId): void {
  if (!VISIBLE_TAB_IDS.includes(tabId)) tabId = 'general'
  _activeTab = tabId
  document.querySelectorAll<HTMLElement>('.s-nav-item').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabId))
  const body = document.getElementById('settings-tab-body')
  if (!body || !_settings) return
  body.replaceChildren()

  const header = el('header', 's-tab-header')
  const title = el('h1', 's-tab-title')
  const subtitle = el('p', 's-tab-subtitle')
  title.textContent = t(`settings.tab.${tabId}.title`)
  subtitle.textContent = t(`settings.tab.${tabId}.subtitle`)
  header.append(title, subtitle)
  body.appendChild(header)

  if (tabId === 'general') body.appendChild(buildGeneralTab(_settings))
  if (tabId === 'editor') body.appendChild(buildEditorTab(_settings))
  if (tabId === 'typography') body.appendChild(buildTypographyTab(_settings))
  if (tabId === 'ai') body.appendChild(buildAiTab(_settings))
  if (tabId === 'archive') body.appendChild(buildArchiveTab(_settings))
  if (tabId === 'license') buildLicenseTab(body)

  // ── Sync luxury selects after rendering tab ──
  _initLuxurySelects(body)
  updateProBadgesAndOverlays().catch(console.error)
}

function buildGeneralTab(s: AppSettings): HTMLElement {
  const grid = el('div')
  grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:stretch;'

  const themeSection = bentoCard(sectionTitle('palette', t('settings.theme')), buildThemeList(s))

  const right = el('div')
  right.style.cssText = 'display:flex;flex-direction:column;gap:16px;height:100%;'

  const langSection = bentoCard(sectionTitle('language', t('settings.language')), buildLanguageSelect(s))
  langSection.style.flex = '1' // Kéo giãn thẻ ngôn ngữ để đều với cột trái

  const displaySection = bentoCard(sectionTitle('display_settings', t('settings.general.displayPreferences')))
  displaySection.appendChild(goldToggle(t('settings.general.compactMode'), t('settings.general.compactModeDesc'), s.compactMode ?? false, (v) => updateSetting('compactMode', v, true)))
  right.append(displaySection, langSection)

  grid.append(themeSection, right)
  return grid
}

function buildThemeList(s: AppSettings): HTMLElement {
  const list = el('div', 's-theme-list')
  for (const theme of THEMES) {
    const row = el('button', 's-theme-row')
    if (theme.id === s.theme) row.classList.add('active')
    if (!theme.available) row.classList.add('disabled')

    const circle = el('div', 's-theme-circle')
    circle.style.background = `linear-gradient(to right, ${theme.colors[0]} 50%, ${theme.colors[1]} 50%)`

    const label = elText('span', theme.label)
    label.className = 's-theme-row-label'

    const right = el('div', 's-theme-row-right')
    if (theme.id === s.theme) {
      const check = elText('span', 'check')
      check.className = 'material-symbols-outlined s-theme-row-check'
      right.appendChild(check)
    }

    row.append(circle, label, right)

    if (theme.available) {
      row.addEventListener('click', () => {
        applyTheme(theme.id).catch(console.error)
        list.querySelectorAll<HTMLElement>('.s-theme-row').forEach((r) => {
          r.classList.remove('active')
          r.querySelector('.s-theme-row-check')?.remove()
        })
        row.classList.add('active')
        const check = elText('span', 'check')
        check.className = 'material-symbols-outlined s-theme-row-check'
        row.querySelector('.s-theme-row-right')!.appendChild(check)
      })
    }

    list.appendChild(row)
  }
  return list
}

function buildLanguageSelect(s: AppSettings): HTMLElement {
  const root = el('div', 's-search-select')
  const input = el('input', 's-input') as HTMLInputElement
  input.placeholder = t('settings.searchLanguage')
  input.value = LANG_OPTIONS.find((x) => x.id === s.locale)?.label ?? 'English (US)'
  const icon = el('span', 'material-symbols-outlined s-search-icon')
  icon.textContent = 'search'
  const list = el('div', 's-search-list')
  const onDocMouseDown = (event: MouseEvent) => {
    const target = event.target as Node | null
    if (target && !root.contains(target)) hideList()
  }
  const showList = () => {
    list.style.display = 'block'
    document.addEventListener('mousedown', onDocMouseDown)
  }
  const hideList = () => {
    list.style.display = 'none'
    document.removeEventListener('mousedown', onDocMouseDown)
  }
  const render = (q: string) => {
    list.replaceChildren()
    const items = LANG_OPTIONS.filter((x) => x.label.toLowerCase().includes(q.toLowerCase()))
    items.forEach((opt) => {
      const btn = el('button', 's-search-item')
      btn.textContent = `${opt.flag} ${opt.label}${opt.supported ? '' : ' (UI only)'}`
      btn.addEventListener('click', () => {
        input.value = opt.label
        hideList()
        if (!opt.supported || !_settings) return
        const locale = opt.id as AppSettings['locale']
        _settings.locale = locale
        setLocale(locale)
        debouncedSave({ locale })
      })
      list.appendChild(btn)
    })
  }
  render('')
  input.addEventListener('focus', () => { showList(); render(input.value) })
  input.addEventListener('input', () => { showList(); render(input.value) })
  input.addEventListener('blur', () => setTimeout(hideList, 120))
  root.append(icon, input, list)
  return root
}

function buildEditorTab(s: AppSettings): HTMLElement {
  const container = el('div')

  const topRow = el('div')
  topRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:stretch;margin-bottom:12px;'

  const metrics = bentoCard(sectionTitle('straighten', t('settings.editor.textMetrics')))
  metrics.style.cssText += 'display:flex;flex-direction:column;'
  const slidersWrap = el('div')
  slidersWrap.style.cssText = 'display:flex;flex-direction:column;justify-content:space-between;flex:1;'
  slidersWrap.appendChild(goldSlider({ settingsKey: 'fontSize', label: t('settings.editor.fontSize'), min: 8, max: 24, step: 1, value: s.fontSize, unit: 'px', markers: ['8px', '16px', '24px'], onChange: (v) => updateSetting('fontSize', v, true) }))
  slidersWrap.appendChild(goldSlider({ settingsKey: 'lineHeight', label: t('settings.editor.lineHeight'), min: 1, max: 2, step: 0.1, value: s.lineHeight, markers: [t('settings.editor.lineHeightTight'), t('settings.editor.lineHeightOptimal'), t('settings.editor.lineHeightLoose')], onChange: (v) => updateSetting('lineHeight', v, true) }))
  slidersWrap.appendChild(goldSlider({ settingsKey: 'paragraphSpacing', label: t('settings.editor.paragraphSpacing'), min: 0, max: 1, step: 0.1, value: s.paragraphSpacing, unit: 'em', onChange: (v) => updateSetting('paragraphSpacing', v, true) }))
  metrics.appendChild(slidersWrap)

  const behavior = bentoCard(sectionTitle('edit_note', t('settings.editor.writingBehavior')))
  behavior.appendChild(goldToggle(t('settings.editor.wordWrap'), t('settings.editor.wordWrapDesc'), s.wordWrap, (v) => {
    updateSetting('wordWrap', v, true)
    setWordWrap(v)
  }))
  behavior.appendChild(goldToggle(t('settings.editor.spellCheck'), t('settings.editor.spellCheckDesc'), s.spellCheck, (v) => {
    updateSetting('spellCheck', v, false)
    setSpellCheck(v)
  }))
  const tHighlightHeader = goldToggle(t('settings.editor.highlightHeader'), t('settings.editor.highlightHeaderDesc'), s.highlightHeader ?? false, (v) => {
    updateSetting('highlightHeader', v, false)
    setHighlightHeader(v)
  })
  behavior.appendChild(tHighlightHeader)
  bindProToggle(tHighlightHeader, 'editor.highlightHeader', t('settings.editor.highlightHeader'), (enabled) => {
    updateSetting('highlightHeader', enabled, false)
    setHighlightHeader(enabled)
  })

  const tCleanProse = goldToggle(t('settings.editor.cleanProseMode'), t('settings.editor.cleanProseModeDesc'), s.cleanProseMode ?? true, (v) => {
    updateSetting('cleanProseMode', v, false)
    setCleanProse(v)
  })
  behavior.appendChild(tCleanProse)
  bindProToggle(tCleanProse, 'editor.cleanProseMode', t('settings.editor.cleanProseMode'), (enabled) => {
    updateSetting('cleanProseMode', enabled, false)
    setCleanProse(enabled)
  })

  const tFadeContext = goldToggle(t('settings.editor.focusMode'), t('settings.editor.focusModeDesc'), s.fadeContext, (v) => updateSetting('fadeContext', v, false))
  behavior.appendChild(tFadeContext)
  bindProToggle(tFadeContext, 'editor.fadeContext', t('settings.editor.focusMode'), (enabled) => {
    updateSetting('fadeContext', enabled, false)
  })

  const addProBadge = (row: HTMLElement) => {
    const strong = row.querySelector('strong')
    if (strong) {
      const badge = document.createElement('span')
      badge.className = 'badge-pro'
      badge.dataset.proCapability = row.dataset.proCapability ?? ''
      badge.style.marginLeft = '8px'
      badge.textContent = 'PRO'
      strong.appendChild(badge)
    }
  }
  tHighlightHeader.dataset.proCapability = 'editor.highlightHeader'
  tCleanProse.dataset.proCapability = 'editor.cleanProseMode'
  tFadeContext.dataset.proCapability = 'editor.fadeContext'
  addProBadge(tHighlightHeader)
  addProBadge(tCleanProse)
  addProBadge(tFadeContext)
  behavior.appendChild(compactRow(t('settings.editor.tabBehavior'), [
    compactSelect([{ value: 'spaces', label: t('settings.editor.indentSpaces') }, { value: 'tabs', label: t('settings.editor.indentTabs') }], s.indentWithTabs ? 'tabs' : 'spaces', (v) => {
      const useTabs = v === 'tabs'
      updateSetting('indentWithTabs', useTabs, false)
      setIndentConfig(useTabs, s.indentSize ?? 4)
    }),
    compactSelect([{ value: '2', label: '2' }, { value: '4', label: '4' }, { value: '8', label: '8' }], String(s.indentSize ?? 4), (v) => {
      const size = Number(v) as 2 | 4 | 8
      updateSetting('indentSize', size, false)
      setIndentConfig(s.indentWithTabs ?? false, size)
    }),
  ]))

  topRow.append(metrics, behavior)

  container.appendChild(topRow)
  return container
}

const TYPO_INTRO_KEY = 'vanfolio.typoBannerDismissed'

function buildTypographyIntro(): HTMLElement | null {
  if (localStorage.getItem(TYPO_INTRO_KEY)) return null

  const banner = el('div', 's-typo-intro')

  const content = el('div', 's-typo-intro-content')

  const iconEl = el('span', 'material-symbols-outlined s-typo-intro-icon')
  iconEl.textContent = 'auto_awesome'

  const textEl = el('div', 's-typo-intro-text')
  const title = el('strong')
  title.textContent = t('settings.typography.introTitle')
  const desc = el('p')
  desc.textContent = t('settings.typography.introDesc')
  textEl.append(title, desc)

  content.append(iconEl, textEl)

  const closeBtn = el('button', 's-typo-intro-close')
  const closeBtnSpan = elText('span', 'close')
  closeBtnSpan.className = 'material-symbols-outlined'
  closeBtn.appendChild(closeBtnSpan)
  bindFloatingTooltip(closeBtn, t('settings.typography.gotIt'), 'bottom')
  closeBtn.addEventListener('click', () => {
    localStorage.setItem(TYPO_INTRO_KEY, '1')
    banner.style.opacity = '0'
    banner.style.maxHeight = '0'
    banner.style.marginBottom = '0'
    banner.style.padding = '0'
    setTimeout(() => banner.remove(), 300)
  })

  banner.append(content, closeBtn)
  return banner
}

function buildTypographyTab(s: AppSettings): HTMLElement {
  const wrapper = el('div')
  const intro = buildTypographyIntro()
  if (intro) wrapper.appendChild(intro)

  // Custom Fonts — full-width, above everything (prerequisite for dropdowns below)
  const customFonts = buildCustomFontsCard()
  customFonts.style.padding = '12px 15px'
  customFonts.style.marginBottom = '12px'
  wrapper.appendChild(customFonts)

  const grid = el('div')
  grid.style.cssText = 'display:grid;grid-template-columns:1.1fr 0.9fr;gap:12px;align-items:stretch;'
  wrapper.appendChild(grid)

  const leftCol = el('div')
  leftCol.style.cssText = 'display:flex;flex-direction:column;gap:0px;'

  const rightArea = el('div')
  rightArea.style.cssText = 'display:flex;flex-direction:column;'

  // Fill Left
  const typeface = buildTypefaceCard(s)
  typeface.style.padding = '12px 15px'
  typeface.style.display = 'flex'
  typeface.style.flexDirection = 'column'
  typeface.style.gap = '4px'
  leftCol.appendChild(typeface)

  const fineTuning = buildFineTuningCard(s)
  fineTuning.style.padding = '12px 15px'
  fineTuning.style.display = 'flex'
  fineTuning.style.flexDirection = 'column'
  fineTuning.style.gap = '4px'
  leftCol.appendChild(fineTuning)

  const pageLayout = buildPageConfigCard(s)
  pageLayout.style.padding = '12px 15px'
  pageLayout.style.display = 'flex'
  pageLayout.style.flexDirection = 'column'
  pageLayout.style.gap = '4px'
  leftCol.appendChild(pageLayout)

  // Fill Right — Live Preview sticky
  const previewCard = buildTypoPreview()
  previewCard.style.flex = '1'
  rightArea.appendChild(previewCard)

  grid.append(leftCol, rightArea)
  return wrapper
}

function buildFontSelect(
  builtinOptions: Array<{ value: string; label: string }>,
  current: string,
  onChange: (v: string) => void
): HTMLSelectElement {
  const customOptions = getCustomFontOptions()
  const sel = el('select', 's-compact-select') as HTMLSelectElement

  const builtinGroup = document.createElement('optgroup')
  builtinGroup.label = 'Built-in'
  builtinOptions.forEach((opt) => {
    const node = document.createElement('option')
    node.value = opt.value
    node.textContent = opt.label
    node.selected = opt.value === current
    builtinGroup.appendChild(node)
  })
  sel.appendChild(builtinGroup)

  if (customOptions.length > 0) {
    const customGroup = document.createElement('optgroup')
    customGroup.label = t('settings.typography.customFonts')
    customOptions.forEach((opt) => {
      const node = document.createElement('option')
      node.value = opt.value
      node.textContent = opt.label
      node.selected = opt.value === current
      customGroup.appendChild(node)
    })
    sel.appendChild(customGroup)
  }

  sel.addEventListener('change', () => onChange(sel.value))
  return sel
}

function buildTypefaceCard(s: AppSettings): HTMLElement {
  const title = sectionTitle('format_size', t('settings.typography.typefaceSelection'))
  title.style.marginBottom = '8px'
  const card = bentoCard(title)

  const r1 = compactRow(t('settings.typography.headingFont'), [buildFontSelect(BUILTIN_HEADING_FONT_OPTIONS, s.previewHeadingFont, (v) => updateSetting('previewHeadingFont', v, true))])
  r1.style.padding = '2px 0'
  card.appendChild(r1)

  const r2 = compactRow(t('settings.typography.bodyFont'), [buildFontSelect(BUILTIN_BODY_FONT_OPTIONS, s.previewFontFamily, (v) => updateSetting('previewFontFamily', v, true))])
  r2.style.padding = '2px 0'
  card.appendChild(r2)

  const r3 = compactRow(t('settings.typography.codeFont'), [buildFontSelect(BUILTIN_CODE_FONT_OPTIONS, s.codeFontFamily || 'JetBrains Mono', (v) => updateSetting('codeFontFamily', v, true))])
  r3.style.padding = '2px 0'
  card.appendChild(r3)
  return card
}

function buildFineTuningCard(s: AppSettings): HTMLElement {
  const title = sectionTitle('tune', t('settings.typography.fineTuning'))
  title.style.marginBottom = '8px'
  const card = bentoCard(title)

  const r1 = goldSlider({
    settingsKey: 'previewBaseFontSize',
    label: t('settings.typography.previewFontSize'),
    min: 12, max: 24, step: 1,
    value: s.previewBaseFontSize,
    unit: `px / ${(s.previewBaseFontSize * 0.75).toFixed(1)}pt`,
    onChange: (v) => updateSetting('previewBaseFontSize', v, true)
  })
  r1.style.padding = '4px 0'
  card.appendChild(r1)

  const r2 = goldSlider({ settingsKey: 'previewLineHeight', label: t('settings.typography.lineHeight'), min: 1, max: 2, step: 0.1, value: s.previewLineHeight, onChange: (v) => updateSetting('previewLineHeight', v, true) })
  r2.style.padding = '4px 0'
  card.appendChild(r2)

  const r3 = goldSlider({
    settingsKey: 'paragraphSpacing',
    label: t('settings.typography.paragraphSpacing'), min: 0, max: 2, step: 0.1, value: Number.isFinite(s.paragraphSpacing) ? s.paragraphSpacing : 0.8, unit: 'em', onChange: (v) => {
      updateSetting('paragraphSpacing', v, true)
    }
  })
  r3.style.padding = '4px 0'
  card.appendChild(r3)

  const t1 = goldToggle(t('settings.typography.ligatures'), t('settings.typography.ligaturesDesc'), true, (v) => {
    document.documentElement.style.setProperty('--preview-ligatures', v ? '"liga" 1, "kern" 1' : '"liga" 0, "kern" 0')
  })
  t1.style.padding = '4px 0'
  card.appendChild(t1)

  const t2 = goldToggle(t('settings.typography.smartQuotes'), t('settings.typography.smartQuotesDesc'), s.smartQuotes ?? true, (v) => {
    updateSetting('smartQuotes', v, false)
    setSmartQuotes(v)
    setPreviewTypographer(v)
  })
  t2.style.padding = '4px 0'
  bindProToggle(t2, 'editor.smartQuotes', t('settings.typography.smartQuotes'), (enabled) => {
    updateSetting('smartQuotes', enabled, false)
    setSmartQuotes(enabled)
    setPreviewTypographer(enabled)
  })
  const strong = t2.querySelector('strong')
  if (strong) {
    const badge = document.createElement('span')
    badge.className = 'badge-pro'
    badge.dataset.proCapability = 'editor.smartQuotes'
    badge.style.marginLeft = '8px'
    badge.textContent = 'PRO'
    strong.appendChild(badge)
  }
  card.appendChild(t2)

  return card
}

function buildPageConfigCard(s: AppSettings): HTMLElement {
  const title = sectionTitle('description', t('settings.typography.pageLayout'))
  title.style.marginBottom = '8px'
  const card = bentoCard(title)

  const r1 = compactRow(t('settings.paperSize'), [compactSelect([{ value: 'A4', label: 'A4' }, { value: 'Letter', label: 'Letter' }, { value: 'A3', label: 'A3' }], s.paperSize || 'A4', (v) => {
    const size = v as 'A4' | 'A3' | 'Letter'
    updateSetting('paperSize', size, true)
    applyPreviewLayout(size, _settings?.paperOrientation || 'portrait')
  })])
  r1.style.padding = '2px 0'
  card.appendChild(r1)

  const r2 = compactRow(t('settings.orientation'), [compactSelect([{ value: 'portrait', label: t('settings.portrait') }, { value: 'landscape', label: t('settings.landscape') }], s.paperOrientation || 'portrait', (v) => {
    const orientation = v as 'portrait' | 'landscape'
    updateSetting('paperOrientation', orientation, true)
    applyPreviewLayout((_settings?.paperSize as 'A4' | 'A3' | 'Letter') || 'A4', orientation)
  })])
  r2.style.padding = '2px 0'
  card.appendChild(r2)

  return card
}

function buildCustomFontsCard(): HTMLElement {
  const card = bentoCard(sectionTitle('font_download', t('settings.typography.customFonts')))
  const desc = el('p')
  desc.textContent = t('settings.typography.customFontsDesc')
  desc.style.cssText = 'margin:0 0 16px;color:var(--s-text-sub);line-height:1.6;font-size:13px;'
  card.appendChild(desc)

  const actions = el('div')
  actions.style.cssText = 'display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px;'

  const importBtn = el('button', 's-btn-primary')
  importBtn.textContent = `${t('settings.typography.importFonts')} `


  importBtn.addEventListener('click', async () => {
    const has = await hasCapability('font.import')
    if (!has) {
      showUpgradePrompt(t('settings.typography.customFonts'))
      return
    }
    try {
      const imported = await addFontsFromPicker()
      if (imported > 0) {
        showToast(t('settings.typography.importedFonts', { count: String(imported) }), 'success')
      }
    } catch (error) {
      console.error('[settings] import fonts failed:', error)
      showToast(t('settings.typography.importFontsFailed'), 'error')
    }
  })

  const reloadBtn = el('button', 's-btn-ghost')
  const syncIcon = elText('span', 'sync')
  syncIcon.className = 'material-symbols-outlined'
  syncIcon.style.cssText = 'font-size:18px;vertical-align:middle;margin-right:6px;'
  const reloadText = document.createTextNode(t('settings.typography.reloadFonts'))
  reloadBtn.append(syncIcon, reloadText)
  reloadBtn.style.cssText = 'display:flex;align-items:center;padding:8px 14px;border:1px solid rgba(var(--s-primary-rgb), 0.2);'
  reloadBtn.addEventListener('click', async () => {
    try {
      await refreshCustomFonts()
      showToast(t('settings.typography.reloadFontsSuccess'), 'success')
    } catch (error) {
      console.error('[settings] reload fonts failed:', error)
      showToast(t('settings.typography.reloadFontsFailed'), 'error')
    }
  })

  actions.append(importBtn, reloadBtn)
  card.appendChild(actions)

  const status = el('div')
  const count = getCustomFonts().length
  status.style.cssText = 'display:flex;align-items:center;gap:8px;padding:12px 14px;background:rgba(var(--s-primary-rgb), 0.05);border-radius:10px;border:0.5px solid rgba(var(--s-primary-rgb), 0.1);'

  const dot = el('span')
  dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${count > 0 ? 'var(--s-success)' : 'var(--s-text-muted)'};`

  const text = el('span')
  text.textContent = count > 0
    ? t('settings.typography.fontsLoaded', { count: String(count) })
    : t('settings.typography.noFontsLoaded')
  text.style.cssText = 'font-size:12px;color:var(--s-text-sub);font-weight:500;'

  status.append(dot, text)
  card.appendChild(status)

  hasCapability('font.import').then(has => {
    if (!has) {
      card.style.position = 'relative'
      const overlay = document.createElement('div')
      overlay.className = 'pro-feature-overlay'
      overlay.dataset.proCapability = 'font.import'
      overlay.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);border-radius:12px;display:flex;align-items:center;justify-content:center;z-index:10;'
      const proBadge = document.createElement('span')
      proBadge.className = 'badge-pro-lg'
      proBadge.textContent = 'PRO'
      overlay.appendChild(proBadge)
      overlay.addEventListener('click', (e) => {
        e.stopPropagation()
        showUpgradePrompt(t('settings.typography.customFonts'))
      })
      card.appendChild(overlay)
    }
  })

  return card
}

function buildTypoPreview(): HTMLElement {
  const card = bentoCard(sectionTitle('visibility', t('settings.typography.livePreview')))
  const frame = el('div', 's-preview-frame')
  const previewHead = el('div', 's-preview-head')
  const previewDots = el('div', 's-preview-dots')
  const dot1 = el('span')
  dot1.style.background = '#ff6b6b'
  const dot2 = el('span')
  dot2.style.background = '#feca57'
  const dot3 = el('span')
  dot3.style.background = '#48dbfb'
  previewDots.append(dot1, dot2, dot3)
  const previewName = elText('span', 'philosophy_of_archive.md')
  const previewBtn = elText('button', t('settings.typography.enlarge'))
  previewBtn.className = 's-btn-ghost'
  previewHead.append(previewDots, previewName, previewBtn)

  const previewBody = el('div', 's-preview-body')
  previewBody.appendChild(elText('h1', t('settings.typography.previewH1')))
  previewBody.appendChild(elText('h2', t('settings.typography.previewH2')))
  previewBody.appendChild(elText('p', t('settings.typography.previewPara1')))
  previewBody.appendChild(elText('blockquote', t('settings.typography.previewQuote')))
  previewBody.appendChild(elText('p', t('settings.typography.previewPara2')))
  const pre = el('pre')
  pre.textContent = 'const archive = createSnapshot(draft)\nstore.save(archive)'
  previewBody.appendChild(pre)
  previewBody.appendChild(elText('p', t('settings.typography.previewPara3')))

  frame.append(previewHead, previewBody)
  card.appendChild(frame)
  return card
}

function buildAiTab(s: AppSettings): HTMLElement {
  const outer = el('div', 's-coming-soon-wrap')
  const overlay = el('div', 's-coming-soon-overlay')
  const badge = el('div', 's-coming-soon-badge')
  const icon = elText('span', 'rocket_launch')
  icon.className = 'material-symbols-outlined'
  const text = el('div')
  const title = elText('strong', t('settings.ai.comingSoonTitle'))
  const sub = elText('p', t('settings.ai.comingSoonSubtitle'))
  text.append(title, sub)
  badge.append(icon, text)
  overlay.appendChild(badge)

  const container = el('div')
  container.style.cssText = 'pointer-events:none;opacity:0.35;'
  const providers = bentoCard(sectionTitle('auto_awesome', t('settings.ai.provider')))
  const row = el('div')
  row.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:10px;'
  for (const p of AI_PROVIDERS) {
    const card = el('button', 's-btn-ghost')
    card.style.padding = '14px'
    card.textContent = p.label
    if (p.id === s.aiProvider) {
      card.style.borderColor = 'var(--s-primary-bright)'
      card.style.boxShadow = 'var(--s-active-glow)'
    }
    card.addEventListener('click', () => {
      if (!_settings) return
      _settings.aiProvider = p.id
      window.vanfolioAPI.saveSettings({ aiProvider: p.id }).catch(console.error)
      switchTab('ai')
      refreshKeyStatus(p.id)
    })
    row.appendChild(card)
  }
  providers.appendChild(row)
  const keyCard = bentoCard(sectionTitle('vpn_key', t('settings.ai.apiKey')))
  const keyInput = el('input', 's-input') as HTMLInputElement
  keyInput.type = 'password'
  keyInput.placeholder = t('settings.apiKeyPlaceholder')
  keyInput.style.width = '100%'
  keyInput.id = 'api-key-input'
  const saveBtn = el('button', 's-btn-primary')
  saveBtn.textContent = t('settings.apiKeySave')
  saveBtn.style.marginTop = '10px'
  saveBtn.addEventListener('click', async () => {
    if (!_settings) return
    const key = keyInput.value.trim()
    if (!key) return
    const ok = await window.vanfolioAPI.saveApiKey(_settings.aiProvider, key)
    keyInput.value = ''
    setKeyStatus(ok ? 'saved' : 'error')
  })
  const status = el('div', 's-api-key-status')
  status.id = 'api-key-status'
  keyCard.append(keyInput, saveBtn, status)
  container.append(providers, keyCard)
  outer.append(container, overlay)
  return outer
}

const ARCHIVE_INTRO_KEY = 'vanfolio.archiveBannerDismissed'

function buildArchiveIntro(): HTMLElement | null {
  if (localStorage.getItem(ARCHIVE_INTRO_KEY)) return null

  const banner = el('div', 's-typo-intro')

  const content = el('div', 's-typo-intro-content')

  const iconEl = el('span', 'material-symbols-outlined s-typo-intro-icon')
  iconEl.textContent = 'shield'

  const textEl = el('div', 's-typo-intro-text')
  const title = el('strong')
  title.textContent = t('archive.yourWritingIsSafe')
  const desc = el('p')
  desc.textContent = t('archive.versionHistoryDesc')
  textEl.append(title, desc)

  content.append(iconEl, textEl)

  const closeBtn = el('button', 's-typo-intro-close')
  const closeBtnSpan = elText('span', 'close')
  closeBtnSpan.className = 'material-symbols-outlined'
  closeBtn.appendChild(closeBtnSpan)
  bindFloatingTooltip(closeBtn, t('discovery.dismiss'), 'bottom')
  closeBtn.addEventListener('click', () => {
    localStorage.setItem(ARCHIVE_INTRO_KEY, '1')
    banner.style.opacity = '0'
    banner.style.maxHeight = '0'
    banner.style.marginBottom = '0'
    banner.style.padding = '0'
    setTimeout(() => banner.remove(), 300)
  })

  banner.append(content, closeBtn)
  return banner
}

function buildArchiveTab(s: AppSettings): HTMLElement {
  const container = el('div')
  const intro = buildArchiveIntro()
  if (intro) container.appendChild(intro)
  const grid = el('div', 's-bento-grid')

  // ── Version History card ────────────────────────────────────
  const version = bentoCard()
  const vHead = el('div', 's-card-header')
  const vIcon = elText('span', 'history')
  vIcon.className = 'material-symbols-outlined s-card-icon'
  const vTitleWrap = el('div')
  const vTitle = elText('h3', t('archive.versionHistory'))
  vTitle.className = 's-card-title'
  const vBadge = elText('span', t('archive.autoSaveOn'))
  vBadge.className = 's-card-badge'
  vBadge.style.display = 'inline-block'
  vBadge.style.marginTop = '4px'
  vBadge.style.marginBottom = '8px'
  vTitleWrap.append(vTitle, vBadge)
  vHead.append(vIcon, vTitleWrap)
  version.appendChild(vHead)
  version.appendChild(elText('p', t('archive.versionDesc')))
  version.querySelector('p')!.className = 's-card-desc'
  version.appendChild(goldToggle(t('archive.enableVersionHistory'), '', s.versionHistoryEnabled, (v) => updateSetting('versionHistoryEnabled', v, false)))

  const AUTOSAVE_OPTIONS = [
    { value: '500', label: t('settings.editor.autoSave.onChange') },
    { value: '30000', label: t('settings.editor.autoSave.every30s') },
    { value: '60000', label: t('settings.editor.autoSave.every1min') },
    { value: '300000', label: t('settings.editor.autoSave.every5min') },
  ]
  const currentDelay = String(s.autoSaveDelay ?? 60000)
  const currentOpt = AUTOSAVE_OPTIONS.find(o => o.value === currentDelay)?.value ?? '60000'
  const autoSaveRow = compactRow(t('settings.editor.autoSaveFrequency'), [compactSelect(AUTOSAVE_OPTIONS, currentOpt, (v) => {
    const ms = Number(v)
    updateSetting('autoSaveDelay', ms, false)
    setAutoSaveDelay(ms)
  })])
  version.appendChild(autoSaveRow)

  const retLabel = elText('div', t('archive.keepVersionsFor'))
  retLabel.className = 's-field-label'
  const retSel = el('select', 's-full-select') as HTMLSelectElement
    ;[{ value: '7d', label: t('archive.retention.7days') }, { value: '30d', label: t('archive.retention.30days') }, { value: 'forever', label: t('archive.retention.forever') }].forEach(o => {
      const opt = document.createElement('option'); opt.value = o.value; opt.textContent = o.label
      if (o.value === s.versionHistoryRetention) opt.selected = true
      retSel.appendChild(opt)
    })
  retSel.addEventListener('change', () => updateSetting('versionHistoryRetention', retSel.value as AppSettings['versionHistoryRetention'], false))
  version.append(retLabel, retSel)

  const snapRow = el('div', 's-snapshot-row')
  const snapCheck = elText('span', 'check_circle')
  snapCheck.className = 'material-symbols-outlined s-snap-icon'
  const snapshotText = elText('span', t('archive.lastSnapshot', { time: t('common.loading') }))
  snapRow.append(snapCheck, snapshotText)
  version.appendChild(snapRow)

  const browseBtn = el('button', 's-btn-full-ghost')
  const browseIcon = elText('span', 'manage_search')
  browseIcon.className = 'material-symbols-outlined'
  browseBtn.append(browseIcon, elText('span', t('archive.browseVersionHistory')))
  browseBtn.addEventListener('click', () => {
    openVersionHistoryModal().catch(console.error)
  })
  version.appendChild(browseBtn)

  // ── Local Backup card ────────────────────────────────────────
  const backup = bentoCard()
  const bHead = el('div', 's-card-header')
  const bIcon = elText('span', 'folder_zip')
  bIcon.className = 'material-symbols-outlined s-card-icon'
  const bTitle = elText('h3', t('archive.localBackup'))
  bTitle.className = 's-card-title'
  bHead.append(bIcon, bTitle)
  backup.appendChild(bHead)
  const bDesc = elText('p', t('archive.backupDesc'))
  bDesc.className = 's-card-desc'
  backup.appendChild(bDesc)
  backup.appendChild(goldToggle(t('archive.autoBackup'), '', s.autoBackupEnabled, (v) => updateSetting('autoBackupEnabled', v, false)))
  backup.appendChild(goldToggle(t('settings.editor.backupOnExport'), t('settings.editor.backupOnExportDesc'), s.backupOnExport ?? false, (v) => updateSetting('backupOnExport', v, false)))

  const freqLabel = elText('div', t('archive.backupFrequency'))
  freqLabel.className = 's-field-label'
  const freqSel = el('select', 's-full-select') as HTMLSelectElement
    ;[{ value: '1h', label: t('archive.frequency.1h') }, { value: '6h', label: t('archive.frequency.6h') }, { value: 'daily', label: t('archive.frequency.daily') }].forEach(o => {
      const opt = document.createElement('option'); opt.value = o.value; opt.textContent = o.label
      if (o.value === s.autoBackupFrequency) opt.selected = true
      freqSel.appendChild(opt)
    })
  freqSel.addEventListener('change', () => updateSetting('autoBackupFrequency', freqSel.value as AppSettings['autoBackupFrequency'], false))
  backup.append(freqLabel, freqSel)

  const pathLabel = elText('div', t('archive.backupPath'))
  pathLabel.className = 's-field-label'
  const pathRow = el('div', 's-path-row')
  const pathText = elText('span', s.autoBackupPath || t('archive.notConfigured'))
  pathText.className = 's-path-text'
  const changeBtn = el('button', 's-btn-ghost')
  changeBtn.textContent = t('archive.backupPathChange')
  changeBtn.addEventListener('click', async () => {
    const nextPath = await window.vanfolioAPI.pickBackupPath()
    if (!nextPath) return
    pathText.textContent = nextPath
    updateSetting('autoBackupPath', nextPath, false)
    openFolder.style.opacity = '1'
    await refreshArchiveMetrics()
    showToast(t('archive.backupPathUpdated'), 'success')
  })
  pathRow.append(pathText, changeBtn)
  backup.append(pathLabel, pathRow)

  const backupNowBtn = el('button', 's-btn-full-gold')
  const backupIcon = elText('span', 'cloud_upload')
  backupIcon.className = 'material-symbols-outlined'
  backupNowBtn.append(backupIcon, elText('span', t('archive.backUpNow')))
  backupNowBtn.addEventListener('click', async () => {
    backupNowBtn.setAttribute('disabled', 'true')
    const result = await window.vanfolioAPI.runBackupNow()
    backupNowBtn.removeAttribute('disabled')
    if (!result.success) {
      showToast(t('archive.backupFailed', { error: result.error ?? t('common.unknownError') }), 'error')
      return
    }
    await refreshArchiveMetrics()
    showToast(t('archive.backupSuccess'), 'success')
  })
  backup.appendChild(backupNowBtn)

  hasCapability('history.unlimitedRetention').then(has => {
    if (!has) {
      Array.from(retSel.options).forEach(opt => {
        if (opt.value !== '7d') {
          opt.disabled = true
          opt.textContent += ' (PRO)'
        }
      })
      if (retSel.value !== '7d') {
        retSel.value = '7d'
        updateSetting('versionHistoryRetention', '7d', false)
      }
      // Force luxury select refresh
      retSel.dispatchEvent(new Event('options:updated'))
    }
  })
  hasCapability('backup.scheduler').then(has => {
    if (!has) {
      backup.style.position = 'relative'
      const overlay = document.createElement('div')
      overlay.className = 'pro-feature-overlay'
      overlay.dataset.proCapability = 'backup.scheduler'
      overlay.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);border-radius:12px;display:flex;align-items:center;justify-content:center;z-index:10;'
      const proBadge = document.createElement('span')
      proBadge.className = 'badge-pro-lg'
      proBadge.textContent = 'PRO'
      overlay.appendChild(proBadge)
      overlay.addEventListener('click', (e) => {
        e.stopPropagation()
        showUpgradePrompt(t('archive.autoBackup'))
      })
      backup.appendChild(overlay)
    }
  })

  grid.append(version, backup)
  container.appendChild(grid)

  // ── Storage & Health card ────────────────────────────────────
  const health = bentoCard()

  // Top row: title left | backup time right
  const healthTop = el('div', 's-health-top')
  const hLeft = el('div', 's-card-header-left')
  const hIcon = elText('span', 'monitoring')
  hIcon.className = 'material-symbols-outlined s-card-icon'
  const hTitle = elText('h3', t('archive.storageHealth'))
  hTitle.className = 's-card-title'
  hLeft.append(hIcon, hTitle)

  const healthRight = el('div', 's-health-top-right')
  const backupMeta = elText('div', t('archive.lastSuccessfulBackup'))
  backupMeta.className = 's-field-label'
  backupMeta.style.marginTop = '0'
  const backupTime = elText('div', t('common.loading'))
  backupTime.className = 's-backup-time'
  const healthyBadge = elText('span', t('archive.statusHealthy'))
  healthyBadge.className = 's-status-badge s-status-badge--healthy'
  healthRight.append(backupMeta, backupTime, healthyBadge)

  healthTop.append(hLeft, healthRight)
  health.appendChild(healthTop)

  // Storage bar (full-width)
  const healthBody = el('div', 's-health-body')
  const storageLabel = elText('div', t('archive.localStorageUsed'))
  storageLabel.className = 's-storage-label'
  const storageCount = elText('div', t('common.loading'))
  storageCount.className = 's-storage-count'
  const progress = el('div', 's-progress-bar')
  const fill = el('div', 's-progress-fill')
  fill.style.width = '14%'
  progress.appendChild(fill)
  healthBody.append(storageLabel, storageCount, progress)
  health.appendChild(healthBody)

  const healthLinks = el('div', 's-health-links')
  const openFolder = el('button', 's-link-btn')
  if (!s.autoBackupPath) openFolder.style.opacity = '0.4'
  openFolder.addEventListener('click', () => {
    const backupPath = _settings?.autoBackupPath ?? ''
    if (backupPath) window.vanfolioAPI.openInExplorer(backupPath)
  })
  const openIcon = elText('span', 'folder_open')
  openIcon.className = 'material-symbols-outlined'
  openFolder.append(openIcon, elText('span', t('archive.openBackupFolder')))
  const clearBtn = el('button', 's-link-btn')
  const clearIcon = elText('span', 'delete_sweep')
  clearIcon.className = 'material-symbols-outlined'
  clearBtn.append(clearIcon, elText('span', t('archive.clearOldVersions')))
  clearBtn.addEventListener('click', async () => {
    if (!(await showInlineConfirm(t('archive.cleanupConfirm')))) return
    const deleted = await window.vanfolioAPI.cleanupSnapshots()
    await refreshArchiveMetrics()
    showToast(deleted > 0 ? t('archive.cleanupDeleted', { count: String(deleted) }) : t('archive.cleanupNone'), 'success')
  })
  healthLinks.append(openFolder, clearBtn)
  health.appendChild(healthLinks)
  container.appendChild(health)

  // ── Privacy footer ────────────────────────────────────────────
  const privacyFooter = el('div', 's-privacy-footer')
  const privIcon = elText('span', 'shield_lock')
  privIcon.className = 'material-symbols-outlined'
  privacyFooter.append(privIcon, elText('span', t('archive.privacyNote')))
  container.appendChild(privacyFooter)

  const refreshArchiveMetrics = async (): Promise<void> => {
    const [lastSnapshot, lastBackup, usage] = await Promise.all([
      window.vanfolioAPI.getLastSnapshotTimestamp(),
      window.vanfolioAPI.getLastBackupTimestamp(),
      window.vanfolioAPI.getStorageUsage(),
    ])

    snapshotText.textContent = t('archive.lastSnapshot', { time: lastSnapshot ? formatTimestamp(lastSnapshot) : t('archive.never') })
    backupTime.textContent = lastBackup ? formatTimestamp(lastBackup) : t('archive.never')

    const total = usage.vaultBytes + usage.historyBytes + usage.backupBytes
    const historyShare = total > 0 ? Math.max(4, Math.round((usage.historyBytes / total) * 100)) : 0
    storageCount.textContent = `${formatBytes(total)} ${t('archive.storageTotal')} • ${t('archive.storageHistory')} ${formatBytes(usage.historyBytes)} • ${t('archive.storageBackup')} ${formatBytes(usage.backupBytes)}`
    fill.style.width = `${historyShare}%`
  }

  refreshArchiveMetrics().catch(console.error)

  return container
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function setKeyStatus(state: 'configured' | 'saved' | 'none' | 'error'): void {
  const badge = document.getElementById('api-key-status')
  if (!badge) return
  badge.className = `s-api-key-status s-api-key-status--${state}`
  const msg: Record<string, string> = {
    configured: t('settings.keyConfigured'),
    saved: t('settings.keySaved'),
    none: t('settings.keyNone'),
    error: t('settings.keyError'),
  }
  badge.textContent = msg[state] ?? ''
}

function refreshKeyStatus(provider: string): void {
  window.vanfolioAPI.hasApiKey(provider).then((has) => setKeyStatus(has ? 'configured' : 'none')).catch(console.error)
}


function bentoCard(...children: HTMLElement[]): HTMLElement {
  const card = el('div', 's-bento-card')
  children.forEach((c) => card.appendChild(c))
  return card
}

function sectionTitle(icon: string, label: string): HTMLElement {
  const title = el('div', 's-section-title')
  const iconWrap = el('div', 's-section-icon')
  const iconNode = el('span', 'material-symbols-outlined')
  iconNode.style.fontSize = '20px'
  iconNode.textContent = icon
  iconWrap.appendChild(iconNode)
  const textNode = document.createTextNode(label)
  title.append(iconWrap, textNode)
  return title
}

function goldToggle(label: string, desc: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const row = el('div', 's-row')
  const meta = el('div', 's-row-meta')
  const strong = elText('strong', label)
  const descNode = elText('p', desc)
  meta.append(strong, descNode)
  const toggle = el('label', 's-gold-toggle')
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = checked
  toggle.dataset.initialChecked = checked ? 'true' : 'false'
  input.addEventListener('change', () => onChange(input.checked))
  const track = el('span', 's-toggle-track')
  toggle.append(input, track)
  row.append(meta, toggle)
  return row
}

function bindProToggle(
  row: HTMLElement,
  capability: 'editor.highlightHeader' | 'editor.cleanProseMode' | 'editor.fadeContext' | 'editor.smartQuotes',
  featureName: string,
  applyValue: (enabled: boolean) => void
): void {
  const toggle = row.querySelector<HTMLElement>('.s-gold-toggle')
  const input = row.querySelector<HTMLInputElement>('input[type="checkbox"]')
  if (!toggle || !input) return

  toggle.classList.add('is-pro')
  toggle.setAttribute('aria-busy', 'true')
  input.disabled = true

  hasCapability(capability).then((has) => {
    toggle.setAttribute('aria-busy', 'false')
    toggle.classList.toggle('is-pro-locked', !has)
    input.disabled = !has

    if (!has) {
      if (input.checked) {
        input.checked = false
        applyValue(false)
      }
      toggle.addEventListener('click', onLockedClick)
      return
    }

    toggle.removeEventListener('click', onLockedClick)
  }).catch(() => {
    toggle.setAttribute('aria-busy', 'false')
    toggle.classList.add('is-pro-locked')
    input.disabled = true
    input.checked = false
    applyValue(false)
    toggle.addEventListener('click', onLockedClick)
  })

  function onLockedClick(e: Event): void {
    e.preventDefault()
    e.stopPropagation()
    showUpgradePrompt(featureName)
  }
}

function goldSlider(opts: {
  label: string
  min: number
  max: number
  step: number
  value: number
  unit?: string
  markers?: string[]
  onChange: (v: number) => void
  settingsKey?: string
}): HTMLElement {
  const wrap = el('div', 's-slider-wrap')
  const head = el('div', 's-slider-head')
  const label = el('span')
  label.textContent = opts.label
  const value = el('span', 's-slider-value')
  const format = (v: number) => `${v}${opts.unit ?? ''}`
  value.textContent = format(opts.value)
  head.append(label, value)

  const range = document.createElement('input')
  range.type = 'range'
  range.className = 's-gold-slider'
  range.min = String(opts.min)
  range.max = String(opts.max)
  range.step = String(opts.step)
  range.value = String(opts.value)

  range.addEventListener('input', () => {
    const val = Number(range.value)
    opts.onChange(val)
    value.textContent = format(val)
  })

  // React to external updates (e.g. from Preview Ruler)
  if (opts.settingsKey) {
    document.addEventListener('settings:updated', (e: any) => {
      if (e.detail.key === opts.settingsKey) {
        const newVal = e.detail.value
        range.value = String(newVal)
        value.textContent = format(newVal)
      }
    })
  }

  wrap.append(head, range)

  if (opts.markers) {
    const marks = el('div', 's-slider-markers')
    opts.markers.forEach((m) => {
      const span = elText('span', m)
      marks.appendChild(span)
    })
    wrap.appendChild(marks)
  }

  return wrap
}

function compactSelect(options: { value: string; label: string }[], current: string, onChange: (v: string) => void): HTMLElement {
  const sel = el('select', 's-compact-select') as HTMLSelectElement
  options.forEach((opt) => {
    const node = document.createElement('option')
    node.value = opt.value
    node.textContent = opt.label
    node.selected = opt.value === current
    sel.appendChild(node)
  })
  sel.addEventListener('change', () => onChange(sel.value))
  return sel
}

function compactRow(label: string, controls: HTMLElement[]): HTMLElement {
  const row = el('div', 's-row')
  const left = elText('div', label)
  left.className = 's-row-meta'
  const right = el('div')
  right.style.cssText = 'display:flex;gap:8px;align-items:center;'
  controls.forEach((c) => right.appendChild(c))
  row.append(left, right)
  return row
}

export function getAppSettings(): AppSettings | null { return _settings }

const LAYOUT_TYPOGRAPHY_KEYS = new Set<keyof AppSettings>([
  'previewLineHeight', 'paragraphSpacing', 'previewBaseFontSize',
  'previewFontFamily', 'previewHeadingFont',
])

export function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K], applyToDom: boolean): void {
  if (!_settings) return
  _settings[key] = value
  debouncedSave({ [key]: value } as Partial<AppSettings>)
  if (applyToDom) {
    applySettingsToDOM(_settings)
    if (LAYOUT_TYPOGRAPHY_KEYS.has(key)) triggerLayoutRepaginate()
  }
  document.dispatchEvent(new CustomEvent('settings:updated', { detail: { key, value } }))
}

function mergeFontOptions(
  baseOptions: Array<{ value: string; label: string }>,
  extraOptions: Array<{ value: string; label: string }>
): Array<{ value: string; label: string }> {
  const merged = [...baseOptions]
  const seen = new Set(baseOptions.map((item) => item.value))
  for (const option of extraOptions) {
    if (seen.has(option.value)) continue
    seen.add(option.value)
    merged.push(option)
  }
  return merged
}

function ensureFontSelectionsValid(): void {
  if (!_settings) return
  const headingFamilies = new Set(mergeFontOptions(BUILTIN_HEADING_FONT_OPTIONS, getCustomFontOptions()).map((item) => item.value))
  const bodyFamilies = new Set(mergeFontOptions(BUILTIN_BODY_FONT_OPTIONS, getCustomFontOptions()).map((item) => item.value))
  const codeFamilies = new Set(mergeFontOptions(BUILTIN_CODE_FONT_OPTIONS, getCustomFontOptions()).map((item) => item.value))

  if (!headingFamilies.has(_settings.previewHeadingFont)) updateSetting('previewHeadingFont', BUILTIN_HEADING_FONT_OPTIONS[0].value, true)
  if (!bodyFamilies.has(_settings.previewFontFamily)) updateSetting('previewFontFamily', BUILTIN_BODY_FONT_OPTIONS[0].value, true)
  if (!codeFamilies.has(_settings.codeFontFamily)) updateSetting('codeFontFamily', BUILTIN_CODE_FONT_OPTIONS[0].value, true)
}

function fontStack(fontFamily: string, genericFallback: string): string {
  const normalized = fontFamily.trim()
  if (!normalized) return genericFallback
  if (normalized.includes(',')) return normalized
  return `'${normalized.replace(/'/g, "\\'")}', ${genericFallback}`
}

function el(tag: string, className?: string): HTMLElement {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

function elText(tag: string, text: string): HTMLElement {
  const node = document.createElement(tag)
  node.textContent = text
  return node
}

// ── Luxury Select Transformation ─────────────────────────────────────────────

/**
 * Transforms all native <select> elements within a container into Luxury Custom Selects.
 * Shared logic with exportModal.ts to ensure 100% "Quiet Luxury" aesthetic.
 */
function _initLuxurySelects(container: HTMLElement): void {
  const selects = container.querySelectorAll('select')
  selects.forEach((select) => {
    if (select.parentElement?.classList.contains('lux-select')) return

    // 1. Create Wrapper
    const wrapper = document.createElement('div')
    wrapper.className = 'lux-select'
    select.parentNode?.insertBefore(wrapper, select)
    wrapper.appendChild(select)

    // 2. Create Trigger
    const trigger = document.createElement('div')
    trigger.className = 'lux-trigger'
    const valueDisplay = document.createElement('span')
    valueDisplay.className = 'lux-value'
    valueDisplay.textContent = select.options[select.selectedIndex]?.textContent || ''

    const icon = document.createElement('span')
    icon.className = 'lux-icon material-symbols-outlined'
    icon.textContent = 'expand_more'

    trigger.appendChild(valueDisplay)
    trigger.appendChild(icon)
    wrapper.appendChild(trigger)

    // 3. Create Options Container
    const optionsContainer = document.createElement('div')
    optionsContainer.className = 'lux-options'

    const updateOptions = () => {
      optionsContainer.replaceChildren()
      const appendOptionItem = (opt: HTMLOptionElement) => {
        const item = document.createElement('div')
        item.className = 'lux-option'
        if (opt.disabled) item.classList.add('disabled')
        item.dataset.value = opt.value
        if (opt.value === select.value) item.classList.add('active')
        item.textContent = opt.textContent || ''

        if (!opt.disabled) {
          item.addEventListener('click', (e) => {
            e.stopPropagation()
            select.value = opt.value
            select.dispatchEvent(new Event('change'))
            valueDisplay.textContent = opt.textContent || ''
            wrapper.classList.remove('open')
            // Refresh active state
            optionsContainer.querySelectorAll('.lux-option').forEach(li => li.classList.remove('active'))
            item.classList.add('active')
          })
        }

        optionsContainer.appendChild(item)
      }

      Array.from(select.children).forEach((child) => {
        if (child instanceof HTMLOptGroupElement) {
          const groupLabel = document.createElement('div')
          groupLabel.className = 'lux-option-group'
          groupLabel.textContent = child.label
          optionsContainer.appendChild(groupLabel)

          Array.from(child.children).forEach((groupChild) => {
            if (groupChild instanceof HTMLOptionElement) appendOptionItem(groupChild)
          })
          return
        }

        if (child instanceof HTMLOptionElement) appendOptionItem(child)
      })
    }

    updateOptions()
    wrapper.appendChild(optionsContainer)

    // 4. Listeners
    trigger.addEventListener('click', (e) => {
      e.stopPropagation()
      const isOpen = wrapper.classList.contains('open')
      // Close all others first
      document.querySelectorAll('.lux-select').forEach(s => s.classList.remove('open'))
      document.querySelectorAll('.s-bento-card').forEach(c => c.classList.remove('lux-active-card'))

      if (!isOpen) {
        wrapper.classList.add('open')
        // Promote parent card
        const card = wrapper.closest('.s-bento-card')
        if (card) card.classList.add('lux-active-card')
      }
    })

    // Sync if native select changes
    select.addEventListener('change', () => {
      valueDisplay.textContent = select.options[select.selectedIndex]?.textContent || ''
      updateOptions()
    })
  })

  // Close when clicking outside (attach once to document if not already)
  if (!(window as any)._isLuxGlobalBound) {
    document.addEventListener('click', () => {
      document.querySelectorAll('.lux-select').forEach(s => s.classList.remove('open'))
      document.querySelectorAll('.s-bento-card').forEach(c => c.classList.remove('lux-active-card'))
    })
      ; (window as any)._isLuxGlobalBound = true
  }
}

// ── License Tab ───────────────────────────────────────────────────────────────

// Activation cooldown state
let _activateCooldownTimer: ReturnType<typeof setTimeout> | null = null
let _activateFailCount = 0
let _activateCooldownUntil = 0
let _activateCooldownMode: 'short' | 'long' = 'short'

/** Open Settings and switch to the License tab. */
export function openLicenseTab(): void {
  openSettings()
  switchTab('general')
}

function formatLicenseState(status: LicenseStatus): string {
  switch (status.state) {
    case 'active':
      return status.lastValidatedAt
        ? t('license.status.active') + ' — ' + t('license.lastChecked', { time: formatRelativeTime(status.lastValidatedAt) })
        : t('license.status.active')
    case 'trial-active':
      return t('license.status.trialActive', { date: status.expiresAt ? formatDate(status.expiresAt) : '?' })
    case 'trial-expired': return t('license.status.trialExpired')
    case 'disabled': return t('license.status.disabled')
    case 'invalid': return t('license.status.invalid')
    case 'network-error': return t('license.status.networkError')
    case 'local-corrupted': return t('license.status.localCorrupted')
    case 'clock-tamper-suspected': return t('license.status.clockTamperSuspected')
    case 'inactive': return t('license.status.inactive')
    default: return t('license.status.free')
  }
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString() } catch { return iso }
}

function formatRelativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function errorCodeToI18nKey(code: string | undefined): string {
  const map: Record<string, string> = {
    'invalid-key': 'license.error.invalidKey',
    'wrong-product': 'license.error.wrongProduct',
    'device-limit-reached': 'license.error.deviceLimit',
    'ghost-instance-suspected': 'license.error.ghostInstance',
    'license-disabled': 'license.error.disabled',
    'license-expired': 'license.error.expired',
    'network-error': 'license.error.networkError',
    'invalid-response': 'license.error.invalidResponse',
    'clock-rollback': 'license.clockTamper.description',
    // Phase 2 — trial backend error codes
    'not-trial-key': 'license.error.notTrialKey',
    'unknown-variant': 'license.error.unknownVariant',
    'device-trial-consumed': 'license.error.deviceTrialConsumed',
    'device-mismatch': 'license.error.deviceMismatch',
    'trial-not-deactivatable': 'license.error.trialNotDeactivatable',
    'trial-backend-unreachable': 'license.error.networkError',
    'trial-temporarily-unavailable': 'license.error.trialTemporarilyUnavailable',
    'fingerprint-unavailable': 'license.error.fingerprintUnavailable',
    'fingerprint-low-confidence': 'license.error.fingerprintLowConfidence',
    'instance-stale': 'license.error.instanceStale',
    'activation-limit-reached': 'license.error.activationExhausted',
    'lemon-unreachable': 'license.error.networkError',
    'rate-limited': 'license.error.rateLimited',
    'environment-unsupported': 'license.error.environmentUnsupported',
  }
  return map[code ?? ''] ?? 'license.error.unknown'
}

function buildLicenseTab(body: HTMLElement): void {
  // Load status async without blocking render
  window.vanfolioAPI.getLicenseStatus().then((status) => {
    renderLicenseTab(body, status)
  }).catch(() => {
    renderLicenseTab(body, { tier: 'free', state: 'inactive' })
  })
}

function renderLicenseTab(body: HTMLElement, status: LicenseStatus): void {
  const container = el('div')
  container.style.cssText = 'display:flex;flex-direction:column;gap:16px;'

  // ── Status card ──────────────────────────────────────────────────────────
  const statusCard = bentoCard(sectionTitle('workspace_premium', t('settings.tab.license.title')))
  statusCard.id = 'license-status-card'

  const stateRow = el('div', 's-row')
  const stateMeta = el('div', 's-row-meta')
  const stateStrong = elText('strong', formatLicenseState(status))
  stateStrong.id = 'license-state-text'
  stateMeta.appendChild(stateStrong)

  if (status.tier !== 'free' && status.tier !== undefined) {
    if (status.customerEmailMasked) {
      const emailEl = elText('p', t('license.emailMasked', { email: status.customerEmailMasked }))
      stateMeta.appendChild(emailEl)
    }
    if (status.expiresAt && status.state === 'trial-active') {
      const expEl = elText('p', t('license.expiresOn', { date: formatDate(status.expiresAt) }))
      stateMeta.appendChild(expEl)
    }
  }
  stateRow.appendChild(stateMeta)

  // Tier badge pill
  const tierBadge = el('div', `license-tier-badge tier-${status.tier}`)
  tierBadge.textContent = status.tier.toUpperCase()
  stateRow.appendChild(tierBadge)
  statusCard.appendChild(stateRow)

  // ── Error / warning notices ──────────────────────────────────────────────
  if (status.state === 'local-corrupted') {
    const notice = elText('p', t('license.status.localCorrupted'))
    notice.className = 'license-notice license-notice-warn'
    statusCard.appendChild(notice)
  }
  if (status.state === 'network-error') {
    const notice = elText('p', t('license.error.networkError'))
    notice.className = 'license-notice license-notice-warn'
    statusCard.appendChild(notice)
  }
  if (status.state === 'clock-tamper-suspected') {
    const notice = elText('p', t('license.clockTamper.description'))
    notice.className = 'license-notice license-notice-warn'
    statusCard.appendChild(notice)
  }
  if (status.state === 'disabled' || status.state === 'invalid') {
    const errorKey = status.state === 'disabled' ? 'license.error.disabled' : errorCodeToI18nKey(status.validationErrorCode)
    const notice = elText('p', t(errorKey))
    notice.className = 'license-notice license-notice-error'
    notice.textContent = t(errorKey)
    statusCard.appendChild(notice)
  }
  // Phase 2 — grandfather migration banner
  if (status.trialMigrationWarning) {
    const bannerKey = status.trialMigrationWarning === 'fingerprint-unavailable'
      ? 'license.trial.grandfatherFingerprintUnavailable'
      : 'license.trial.grandfatherFingerprintLowConfidence'
    const banner = elText('p', t(bannerKey))
    banner.className = 'license-notice license-notice-warn'
    statusCard.appendChild(banner)
  }

  container.appendChild(statusCard)

  // ── Activation card ──────────────────────────────────────────────────────
  if (
    status.state === 'inactive' ||
    status.state === 'trial-active' ||
    status.state === 'trial-expired' ||
    status.state === 'invalid' ||
    status.state === 'local-corrupted'
  ) {
    container.appendChild(buildActivateCard(body, status))
  }

  // ── Active license management card ──────────────────────────────────────
  if (status.state === 'active' || status.state === 'trial-active' || status.state === 'network-error') {
    container.appendChild(buildManageCard(body, status))
  }

  // ── Buy / Upgrade card ──────────────────────────────────────────────────
  if (status.tier === 'free' || status.state === 'trial-active' || status.state === 'trial-expired') {
    container.appendChild(buildUpgradeCard(status))
  }

  body.appendChild(container)
}

function buildActivateCard(body: HTMLElement, status: LicenseStatus): HTMLElement {
  const card = bentoCard(sectionTitle('key', t('license.activate.title')))

  const errorEl = el('p', 'license-error-msg')
  errorEl.style.display = 'none'
  const ghostHintEl = el('div', 'license-notice license-notice-warn')
  ghostHintEl.style.display = 'none'

  if (status.state === 'trial-active') {
    const notice = elText('p', 'Already on Trial. Paste a Pro key here to replace the current trial on this device.')
    notice.className = 'license-notice license-notice-info'
    card.appendChild(notice)
  }

  const inputRow = el('div')
  inputRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:8px;'

  const input = document.createElement('input') as HTMLInputElement
  input.type = 'text'
  input.className = 's-input license-key-input'
  input.placeholder = t('license.activate.placeholder')
  input.autocomplete = 'off'
  input.spellcheck = false

  const btn = el('button', 's-action-btn') as HTMLButtonElement
  btn.textContent = t('license.activate.btn')

  inputRow.append(input, btn)
  card.append(inputRow, errorEl, ghostHintEl)

  const cooldownEl = elText('p', '')
  cooldownEl.className = 'license-cooldown-msg'
  cooldownEl.style.display = 'none'
  card.appendChild(cooldownEl)

  resumeActivateCooldown(btn, cooldownEl)

  btn.addEventListener('click', async () => {
    const key = input.value.trim()
    if (!key) return

    // Short cooldown after each attempt
    btn.disabled = true
    btn.textContent = t('license.activate.activating')
    errorEl.style.display = 'none'
    ghostHintEl.style.display = 'none'
    ghostHintEl.replaceChildren()

    let result
    try {
      result = await window.vanfolioAPI.activateLicense({ licenseKey: key })
    } catch {
      result = {
        success: false,
        errorCode: 'network-error',
        errorMessage: t('license.error.networkError'),
      }
    }

    if (result.success && result.status) {
      clearActivateCooldown()
      _activateFailCount = 0
      errorEl.style.display = 'none'

      // Broadcast update and refresh tab
      window.dispatchEvent(new CustomEvent('license:updated', { detail: result.status }))
      body.replaceChildren()
      renderLicenseTab(body, result.status)
      return
    }

    // Failed - apply cooldown
    _activateFailCount++
    const i18nKey = errorCodeToI18nKey(result.errorCode)
    errorEl.textContent = t(i18nKey)
    errorEl.style.display = 'block'
    if (result.errorCode === 'ghost-instance-suspected') {
      const ghostMsg = elText('p', t('license.error.ghostInstance'))
      const supportLine = elText('p', `${t('license.support')}: ${t('license.supportEmail')}`)
      ghostHintEl.replaceChildren(ghostMsg, supportLine)
      ghostHintEl.style.display = 'block'
    }

    if (_activateFailCount >= 3) {
      // Long cooldown: 30s
      const SEC = 30
      startCooldown(btn, cooldownEl, SEC, 'long', () => { _activateFailCount = 0 })
    } else {
      // Short cooldown: 4s
      startCooldown(btn, cooldownEl, 4, 'short', () => { })
    }
  })

  return card
}

function startCooldown(
  btn: HTMLButtonElement,
  msgEl: HTMLElement,
  seconds: number,
  mode: 'short' | 'long',
  onDone: () => void,
): void {
  _activateCooldownMode = mode
  _activateCooldownUntil = Date.now() + seconds * 1000
  btn.disabled = true
  btn.textContent = t('license.activate.btn')
  msgEl.textContent = mode === 'long'
    ? t('license.activate.tooManyFails', { sec: String(seconds) })
    : t('license.activate.cooldown', { sec: String(seconds) })
  msgEl.style.display = 'block'

  let remaining = seconds
  const tick = () => {
    remaining--
    if (remaining <= 0) {
      btn.disabled = false
      msgEl.style.display = 'none'
      clearActivateCooldown()
      onDone()
      return
    }
    msgEl.textContent = mode === 'long'
      ? t('license.activate.tooManyFails', { sec: String(remaining) })
      : t('license.activate.cooldown', { sec: String(remaining) })
    _activateCooldownTimer = setTimeout(tick, 1000)
  }
  if (_activateCooldownTimer) clearTimeout(_activateCooldownTimer)
  _activateCooldownTimer = setTimeout(tick, 1000)
}

function clearActivateCooldown(): void {
  if (_activateCooldownTimer) {
    clearTimeout(_activateCooldownTimer)
    _activateCooldownTimer = null
  }
  _activateCooldownUntil = 0
  _activateCooldownMode = 'short'
}

function resumeActivateCooldown(btn: HTMLButtonElement, msgEl: HTMLElement): void {
  const remainingMs = _activateCooldownUntil - Date.now()
  if (remainingMs <= 0) {
    clearActivateCooldown()
    return
  }

  const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000))
  startCooldown(btn, msgEl, remainingSeconds, _activateCooldownMode, () => {
    if (_activateCooldownMode === 'long') _activateFailCount = 0
  })
}

function buildManageCard(body: HTMLElement, status: LicenseStatus): HTMLElement {
  const card = bentoCard(sectionTitle('manage_accounts', t('license.manageLicense')))

  if (status.lastValidatedAt) {
    const checkedEl = elText('p', t('license.lastChecked', { time: formatRelativeTime(status.lastValidatedAt) }))
    checkedEl.className = 'license-meta-row'
    card.appendChild(checkedEl)
  }

  if (status.activationsUsed !== undefined && status.activationsLimit !== undefined) {
    const usageEl = elText('p', t('license.devicesUsed', {
      used: String(status.activationsUsed),
      limit: String(status.activationsLimit),
    }))
    usageEl.className = 'license-meta-row'
    card.appendChild(usageEl)
  }

  if (status.deviceLabel) {
    const labelEl = elText('p', t('license.deviceLabel', { label: status.deviceLabel }))
    labelEl.className = 'license-meta-row'
    card.appendChild(labelEl)
  }

  // Trial licenses are device-bound — no deactivate flow
  if (status.tier === 'trial') {
    const boundNotice = elText('p', t('license.trial.deviceBound'))
    boundNotice.className = 'license-notice license-notice-info'
    card.appendChild(boundNotice)
    return card
  }

  const deactivateBtn = el('button', 's-action-btn s-action-btn-ghost') as HTMLButtonElement
  deactivateBtn.textContent = t('license.deactivate.btn')
  deactivateBtn.style.marginTop = '12px'

  // Confirmation dialog (native <dialog> element)
  const dialog = document.createElement('dialog')
  dialog.className = 'license-deactivate-dialog'

  const dialogTitle = elText('h3', t('license.deactivate.btn'))
  const dialogMsg = elText('p', t('license.deactivate.confirm'))
  const dialogError = elText('p', '')
  dialogError.className = 'dialog-error'
  dialogError.style.display = 'none'

  const confirmYes = el('button', 's-action-btn') as HTMLButtonElement
  confirmYes.textContent = t('license.deactivate.btn')
  const confirmNo = el('button', 's-action-btn s-action-btn-ghost') as HTMLButtonElement
  confirmNo.textContent = t('dialog.cancel')

  const dialogActions = el('div', 'dialog-actions')
  dialogActions.append(confirmNo, confirmYes)

  dialog.append(dialogTitle, dialogMsg, dialogError, dialogActions)
  document.body.appendChild(dialog)

  deactivateBtn.addEventListener('click', () => {
    dialogError.style.display = 'none'
    dialogError.textContent = ''
    confirmYes.disabled = false
    confirmNo.disabled = false
    confirmYes.textContent = t('license.deactivate.btn')
    dialog.showModal()
  })

  confirmNo.addEventListener('click', () => {
    dialog.close()
  })

  dialog.addEventListener('cancel', (e) => {
    // Prevent accidental Esc close while deactivating
    if (confirmYes.disabled) e.preventDefault()
  })

  confirmYes.addEventListener('click', async () => {
    confirmYes.disabled = true
    confirmNo.disabled = true
    confirmYes.textContent = t('license.deactivate.inProgress')
    dialogError.style.display = 'none'
    dialogError.textContent = ''

    let result
    try {
      result = await window.vanfolioAPI.deactivateLicense()
    } catch {
      result = {
        success: false,
        errorCode: 'network-error' as const,
        errorMessage: t('license.error.networkError'),
      }
    }

    if (result.success) {
      dialog.close()
      dialog.remove()
      const newStatus: LicenseStatus = { tier: 'free', state: 'inactive' }
      window.dispatchEvent(new CustomEvent('license:updated', { detail: newStatus }))
      body.replaceChildren()
      renderLicenseTab(body, newStatus)
    } else {
      confirmYes.disabled = false
      confirmNo.disabled = false
      confirmYes.textContent = t('license.deactivate.btn')
      dialogError.textContent = result.errorMessage ?? t('license.error.unknown')
      dialogError.style.display = 'block'
    }
  })

  card.append(deactivateBtn)
  return card
}

function buildUpgradeCard(status: LicenseStatus): HTMLElement {
  const isTrial = status.tier === 'trial'
  const card = bentoCard(sectionTitle('star', isTrial ? t('license.upgradeFromTrial') : t('license.buyPro')))
  const desc = elText('p', t('license.upgradeComingSoon'))
  desc.style.cssText = 'font-size:13px;color:var(--text-secondary);margin:4px 0 12px;'
  const buyBtn = el('button', 's-action-btn') as HTMLButtonElement
  buyBtn.textContent = isTrial ? t('license.upgradeFromTrial') : t('license.buyPro')
  buyBtn.disabled = true
  buyBtn.style.cssText = 'opacity:0.45;cursor:not-allowed;'
  card.append(desc, buyBtn)
  return card
}

window.vanfolioAPI.getAppVersion().then((v) => { _appVersion = v }).catch(() => { })

