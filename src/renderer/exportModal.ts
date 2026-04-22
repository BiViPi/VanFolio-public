// ─────────────────────────────────────────────────────────────────────────────
// Export Modal — Renderer module
// Sprint 4 (S4-5): Format tabs, per-format options, submit, toast feedback
// ─────────────────────────────────────────────────────────────────────────────
// Pattern: listener leak prevention (same as editor.ts / sidebar.ts / fileTabs.ts)

import { t } from '@shared/i18n'
import { getActiveTabInfo } from './fileTabs'
import { showToast } from './toast'
import { getMasterHtml, getPaginatedHtml } from './preview'
import { getAppSettings } from './settings'
import { hasCapability } from './licenseGate'
import { showUpgradePrompt } from './upgradePrompt'
import type { AppSettings, DocTokens, ExportFormat, ExportOptions, ExportResult } from '@shared/types'

// ── Module state ──────────────────────────────────────────────────────────────
let isModalBound = false
let isLicenseBound = false
let activeFormat: ExportFormat = 'pdf'
let _defaultPaperSize: 'A4' | 'A3' | 'Letter' = 'A4'
let _defaultOrientation: 'portrait' | 'landscape' = 'portrait'
const LOCKED_EXPORT_FORMATS: ExportFormat[] = ['html', 'docx', 'png']

// ── Public API ────────────────────────────────────────────────────────────────

export function initExportModal(): void {
  if (isModalBound) return

  const overlay = document.getElementById('export-modal-overlay')
  const closeBtn = document.getElementById('modal-close')

  // Close on overlay backdrop click
  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) _closeModal()
  })

  // Close button
  closeBtn?.addEventListener('click', () => _closeModal())

  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') _closeModal()
  })

  // Tab switching
  document.querySelectorAll('.modal-tab').forEach((tab) => {
    tab.addEventListener('click', async () => {
      const format = (tab as HTMLElement).dataset.format as ExportFormat
      if (format) {
        // Locked formats are docx, html, png
        if (['docx', 'html', 'png'].includes(format) && !(await hasCapability(`export.${format}`))) {
          showUpgradePrompt(t('main.exportAs', { format: format.toUpperCase() }))
          return
        }
        await _switchTab(format)
      }
    })
  })

  // Submit button
  document.getElementById('btn-export-submit')?.addEventListener('click', () => {
    _submitExport().catch(console.error)
  })

  // Transform native selects to luxury custom selects
  _initLuxurySelects()

  if (!isLicenseBound) {
    window.addEventListener('license:updated', async () => {
      const overlayEl = document.getElementById('export-modal-overlay')
      if (!overlayEl?.classList.contains('open')) return
      if (LOCKED_EXPORT_FORMATS.includes(activeFormat) && !(await hasCapability(`export.${activeFormat}`))) {
        await _switchTab('pdf')
        return
      }
      _switchTab(activeFormat).catch(console.error)
    })
    isLicenseBound = true
  }

  isModalBound = true
}

export function setExportDefaults(
  paperSize: 'A4' | 'A3' | 'Letter',
  orientation: 'portrait' | 'landscape',
): void {
  _defaultPaperSize = paperSize
  _defaultOrientation = orientation
}

export function openExportModal(format: ExportFormat = 'pdf'): void {
  const overlay = document.getElementById('export-modal-overlay')
  if (!overlay) return
  _hydrateExportDefaults()
  _switchTab(format).catch(console.error)
  overlay.classList.add('open')
}

export function closeExportModal(): void {
  _closeModal()
}

// Keep backward compat with any callers that used the old runExport signature
export async function runExport(options: ExportOptions): Promise<void> {
  let result: ExportResult | undefined

  switch (options.format) {
    case 'pdf': result = await window.vanfolioAPI.exportPdf(options); break
    case 'docx': result = await window.vanfolioAPI.exportDocx(options); break
    case 'html': result = await window.vanfolioAPI.exportHtml(options); break
    case 'png': result = await window.vanfolioAPI.exportPng(options); break
  }

  if (result?.success) {
    showToast(t('export.completedFormat', { format: options.format.toUpperCase() }), 'success')
    _closeModal()
  } else {
    showToast(t('toast.exportFailed', { error: result?.error ?? t('common.unknownError') }), 'error')
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _hydrateExportDefaults(): void {
  const paperSelects = ['pdf-paper-size', 'docx-paper-size', 'png-paper-size'] as const
  const orientationSelects = ['pdf-orientation', 'docx-orientation', 'png-orientation'] as const
  for (const id of paperSelects) {
    const el = document.getElementById(id) as HTMLSelectElement | null
    if (el) {
      el.value = _defaultPaperSize
      el.dispatchEvent(new Event('change'))
    }
  }
  for (const id of orientationSelects) {
    const el = document.getElementById(id) as HTMLSelectElement | null
    if (el) {
      el.value = _defaultOrientation
      el.dispatchEvent(new Event('change'))
    }
  }
}

function _closeModal(): void {
  document.getElementById('export-modal-overlay')?.classList.remove('open')
}

async function _switchTab(format: ExportFormat): Promise<void> {
  activeFormat = format

  // Update tab active state
  for (const tab of document.querySelectorAll('.modal-tab')) {
    const el = tab as HTMLElement
    const tabFormat = el.dataset.format as ExportFormat | undefined
    el.classList.toggle('active', el.dataset.format === format)
    const isLocked = !!tabFormat && LOCKED_EXPORT_FORMATS.includes(tabFormat)
    el.classList.toggle('modal-tab-locked', isLocked)
    el.setAttribute('aria-disabled', isLocked ? 'true' : 'false')

    // Add Pro badge only if format is locked AND user doesn't have capability
    if (isLocked && tabFormat) {
      const hasAccess = await hasCapability(`export.${tabFormat}`)
      const badgeExists = el.querySelector('.badge-pro')

      if (!hasAccess && !badgeExists) {
        const badge = document.createElement('span')
        badge.className = 'badge-pro'
        badge.textContent = 'PRO'
        badge.style.marginLeft = '4px'
        el.appendChild(badge)
      } else if (hasAccess && badgeExists) {
        // Remove badge if user now has access (e.g., activated trial key)
        badgeExists.remove()
      }
    }
  }

  // Show correct panel
  document.querySelectorAll('.export-panel').forEach((panel) => {
    const el = panel as HTMLElement
    el.classList.toggle('active', el.id === `export-panel-${format}`)
  })

  _syncWatermarkNote().catch(console.error)
}

async function _syncWatermarkNote(): Promise<void> {
  const submitBtn = document.getElementById('btn-export-submit')
  const submitWrap = submitBtn?.parentElement
  if (!submitBtn || !submitWrap) return

  submitWrap.querySelectorAll('.watermark-note').forEach(note => note.remove())

  if (activeFormat !== 'pdf') return

  const hasNoWatermark = await hasCapability('export.pdfNoWatermark')
  if (hasNoWatermark) return

  const note = document.createElement('p')
  note.className = 'watermark-note'
  note.textContent = t('export.watermarkNote')
  submitWrap.insertBefore(note, submitBtn)
}

async function _submitExport(): Promise<void> {
  const { path: filePath, markdown } = getActiveTabInfo()

  if (LOCKED_EXPORT_FORMATS.includes(activeFormat) && !(await hasCapability(`export.${activeFormat}`))) {
    showUpgradePrompt(t('main.exportAs', { format: activeFormat.toUpperCase() }))
    await _switchTab('pdf')
    return
  }

  if (!markdown.trim()) {
    showToast(t('export.emptyDoc'), 'error')
    return
  }

  // Build ExportOptions from form values
  const options: ExportOptions = {
    markdown,
    renderedHtml: (activeFormat === 'docx')
      ? undefined
      : (activeFormat === 'png' ? getPaginatedHtml() : getMasterHtml()),
    filePath: filePath ?? '',
    format: activeFormat,
    liveSettings: _resolveLiveSettings(),
  }

  // Per-format options
  if (activeFormat === 'pdf') {
    options.paperSize = _selectValue<'A4' | 'A3' | 'Letter'>('pdf-paper-size', 'A4')
    options.orientation = _selectValue<'portrait' | 'landscape'>('pdf-orientation', 'portrait')
    options.includeToc = _checked('pdf-toc')
    options.includePageNumbers = _checked('pdf-page-numbers')
    options.colorMode = _radioValue<'color' | 'bw'>('pdf-color-mode', 'color')
    options.docTokens = _resolveDocTokens()
    options.watermark = _inputValue('pdf-watermark') || undefined
  } else if (activeFormat === 'docx') {
    options.paperSize = _selectValue<'A4' | 'A3' | 'Letter'>('docx-paper-size', 'A4')
    options.orientation = _selectValue<'portrait' | 'landscape'>('docx-orientation', 'portrait')
    options.includeToc = _checked('docx-toc')
    options.includePageNumbers = _checked('docx-page-numbers')
    options.docTokens = _resolveDocTokens()
  } else if (activeFormat === 'html') {
    options.embedCss = _checked('html-embed-css')
    options.selfContained = _checked('html-self-contained')
    options.includeToc = _checked('html-toc')
    options.docTokens = _resolveDocTokens()
  } else if (activeFormat === 'png') {
    options.paperSize = _selectValue<'A4' | 'A3' | 'Letter'>('png-paper-size', 'A4')
    options.orientation = _selectValue<'portrait' | 'landscape'>('png-orientation', 'portrait')
    const scaleRaw = _selectValue<string>('png-scale', '2')
    options.scale = (parseInt(scaleRaw, 10) || 2) as 1 | 2 | 3
    options.transparentBg = _checked('png-transparent')
    options.pngMode = _radioValue<'single' | 'per-page'>('png-mode', 'single')
    options.colorMode = 'color' // PNG always follows theme color unless transparent
    options.docTokens = _resolveDocTokens()
  }

  // Disable submit while exporting
  const submitBtn = document.getElementById('btn-export-submit') as HTMLButtonElement | null
  if (submitBtn) {
    submitBtn.disabled = true
    submitBtn.textContent = t('export.exporting')
  }

  try {
    let result: ExportResult

    switch (activeFormat) {
      case 'pdf': result = await window.vanfolioAPI.exportPdf(options); break
      case 'docx': result = await window.vanfolioAPI.exportDocx(options); break
      case 'html': result = await window.vanfolioAPI.exportHtml(options); break
      case 'png': result = await window.vanfolioAPI.exportPng(options); break
    }

    if (result.success && result.path) {
      _closeModal()
      showToast(
        t('export.successShort', { path: _shortPath(result.path) }),
        'success',
        {
          label: t('export.openFolder'),
          onClick: () => window.vanfolioAPI.openInExplorer(result.path!),
        }
      )
    } else if (!result.success && result.error) {
      showToast(t('toast.exportFailed', { error: result.error }), 'error')
    }
    // success=false & no error = user cancelled save dialog — silent
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false
      submitBtn.textContent = t('export.submit')
    }
  }
}

// ── Luxury Select Transformation ─────────────────────────────────────────────

function _initLuxurySelects(): void {
  const modal = document.getElementById('export-modal')
  if (!modal) return

  const selects = modal.querySelectorAll('select')
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
      optionsContainer.innerHTML = ''
      Array.from(select.options).forEach((opt, idx) => {
        const item = document.createElement('div')
        item.className = 'lux-option'
        if (idx === select.selectedIndex) item.classList.add('active')
        item.textContent = opt.textContent || ''
        item.addEventListener('click', (e) => {
          e.stopPropagation()
          select.selectedIndex = idx
          select.dispatchEvent(new Event('change'))
          valueDisplay.textContent = opt.textContent || ''
          wrapper.classList.remove('open')
          // Refresh active state
          optionsContainer.querySelectorAll('.lux-option').forEach(li => li.classList.remove('active'))
          item.classList.add('active')
        })
        optionsContainer.appendChild(item)
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
      document.querySelectorAll('.export-panel').forEach(p => p.classList.remove('lux-active-pane'))

      if (!isOpen) {
        wrapper.classList.add('open')
        // Promote parent pane
        const pane = wrapper.closest('.export-panel')
        if (pane) pane.classList.add('lux-active-pane')
      }
    })

    // Sync if native select changes (e.g. via defaults)
    select.addEventListener('change', () => {
      valueDisplay.textContent = select.options[select.selectedIndex]?.textContent || ''
      updateOptions()
    })
  })

  // Close when clicking outside
  document.addEventListener('click', () => {
    document.querySelectorAll('.lux-select').forEach(s => s.classList.remove('open'))
    document.querySelectorAll('.export-panel').forEach(p => p.classList.remove('lux-active-pane'))
  })
}

// ── Toast notification ────────────────────────────────────────────────────────
// Implementation lives in toast.ts (shared renderer utility — Sprint 7 S7-1c)
export { showToast } from './toast'

// ── HTML option interlock ─────────────────────────────────────────────────────

/**
 * When "Self-contained" is checked, disable "Google Fonts" checkbox (and uncheck it).
 * A Google Fonts <link> tag requires network access — contradicts offline portability.
 * Mirrors the server-side policy in HtmlBuilder.buildSelfContainedHtml().
 */

// ── DOM helpers ───────────────────────────────────────────────────────────────

function _selectValue<T>(id: string, fallback: T): T {
  const el = document.getElementById(id) as HTMLSelectElement | null
  return el ? (el.value as unknown as T) : fallback
}

function _checked(id: string): boolean {
  const el = document.getElementById(id) as HTMLInputElement | null
  return el?.checked ?? false
}

function _inputValue(id: string): string {
  const el = document.getElementById(id) as HTMLInputElement | null
  return el?.value.trim() ?? ''
}

function _shortPath(fullPath: string): string {
  return fullPath.split(/[/\\]/).slice(-2).join('/')
}

function _radioValue<T>(name: string, fallback: T): T {
  const el = document.querySelector(`input[name="${name}"]:checked`) as HTMLInputElement | null
  return el ? (el.value as unknown as T) : fallback
}

/** Read resolved --doc-* CSS var values from the live document (theme-aware). */
function _resolveDocTokens(): DocTokens {
  const style = getComputedStyle(document.documentElement)
  const get = (v: string) => style.getPropertyValue(v).trim() || undefined
  const getNum = (v: string) => parseInt(style.getPropertyValue(v).trim() || '0', 10)

  return {
    heading: get('--doc-heading') ?? '#775a00',
    accent: get('--doc-accent') ?? '#c59b27',
    text: get('--doc-text') ?? get('--text-ink') ?? '#1a1c1a',
    bg: get('--doc-bg') ?? get('--bg-app') ?? '#fdfcfb',
    surface: get('--doc-surface') ?? get('--cream') ?? '#ffffff',
    border: get('--doc-border') ?? '#d1c5af',
    borderSubtle: get('--doc-border-subtle') ?? 'rgba(0,0,0,0.08)',
    codeBg: get('--doc-code-bg') ?? '#efeeeb',
    // Margins (New)
    marginTop: getNum('--paper-margin-top') || 76,
    marginRight: getNum('--paper-margin-right') || 83,
    marginBottom: getNum('--paper-margin-bottom') || 76,
    marginLeft: getNum('--paper-margin-left') || 83,
    // Metrics (New) — Essential for 1:1 scaling
    previewBaseFontSize: getNum('--preview-base-size') || 15,
    previewLineHeight: parseFloat(get('--preview-line-height') || '1.8'),
    paperWidth: getNum('--paper-width') || 794,
    paperHeight: getNum('--paper-height') || 1123,
    previewFontFamily: get('--font-preview') || "'Newsreader', 'Georgia', serif",
    previewHeadingFont: get('--font-heading') || get('--font-preview') || "'Newsreader', 'Georgia', serif",
    h1Size: get('--preview-h1-size') || '33.8px',
    h2Size: get('--preview-h2-size') || '22.5px',
    h3Size: get('--preview-h3-size') || '18.8px',
    h4Size: get('--preview-h4-size') || '16.5px',
    h5Size: get('--preview-h5-size') || '15px',
    paragraphSpacing: get('--preview-paragraph-spacing') || '0.8em',
    // Print metrics (New)
    printBaseFontSize: get('--print-base-size') || '11pt',
    printLineHeight: get('--print-line-height') || '1.72',
    printMarginTop: get('--print-margin-top') || '20mm',
    printMarginRight: get('--print-margin-right') || '22mm',
    printMarginBottom: get('--print-margin-bottom') || '20mm',
    printMarginLeft: get('--print-margin-left') || '22mm',
    printH1Size: get('--print-h1-size') || '22pt',
    printH2Size: get('--print-h2-size') || '17pt',
    printH3Size: get('--print-h3-size') || '13pt',
    printH4Size: get('--print-h4-size') || '11pt',
    printH5Size: get('--print-h5-size') || '10pt',
    printParagraphSpacing: get('--print-paragraph-spacing') || '0.8em',
  }
}

function _resolveLiveSettings(): Partial<AppSettings> {
  const settings = getAppSettings()
  if (!settings) return {}
  return {
    theme: settings.theme,
    fontFamily: settings.fontFamily,
    previewFontFamily: settings.previewFontFamily,
    previewHeadingFont: settings.previewHeadingFont,
    codeFontFamily: settings.codeFontFamily,
    previewBaseFontSize: settings.previewBaseFontSize,
    previewLineHeight: settings.previewLineHeight,
    paragraphSpacing: settings.paragraphSpacing,
    paperSize: settings.paperSize,
    paperOrientation: settings.paperOrientation,
    pageMarginTop: settings.pageMarginTop,
    pageMarginRight: settings.pageMarginRight,
    pageMarginBottom: settings.pageMarginBottom,
    pageMarginLeft: settings.pageMarginLeft,
  }
}
