// ─────────────────────────────────────────────────────────────────────────────
// Discovery Mode — Phase 4.1.2
// Post-onboarding hover tooltips on novel/non-obvious features.
// Activates once after onboarding is complete; persists via storeManager.
// ─────────────────────────────────────────────────────────────────────────────

import { t } from '@shared/i18n'

interface DiscoveryTarget {
  /** CSS selector for the target element */
  selector: string
  titleKey: string
  descKey: string
  shortcut?: string
  /** If true, only attach once the settings panel opens */
  inSettings?: boolean
  /** If true, show popup on click instead of hover */
  triggerOnClick?: boolean
}

const TARGETS: DiscoveryTarget[] = [
  {
    selector: '#slash-popup-trigger, .cm-editor',
    titleKey: 'discovery.slash.title',
    descKey: 'discovery.slash.desc',
    shortcut: '/',
    triggerOnClick: true,
  },
  {
    selector: '#zen-mode-toggle',
    titleKey: 'discovery.zen.title',
    descKey: 'discovery.zen.desc',
    shortcut: 'Ctrl+Shift+Z',
  },
  {
    selector: '#preview-toolbar',
    titleKey: 'discovery.previewToolbar.title',
    descKey: 'discovery.previewToolbar.desc',
  },
]

// ─────────────────────────────────────────────────────────────────────────────

let _active = false
let _popup: HTMLElement | null = null
let _hideTimer: ReturnType<typeof setTimeout> | null = null

// Stable ref so we can remove it in finishDiscovery
const _onSettingsOpened = (): void => {
  if (!_active) return
  // Small delay — settings builds its nav dynamically
  setTimeout(attachSettingsTargets, 80)
}

/**
 * Entry point — called from main.ts after maybeShowOnboarding().
 * Noop if discovery mode was already completed.
 */
export async function maybeInitDiscovery(): Promise<void> {
  const done = await window.vanfolioAPI.checkDiscovery()
  if (done) return
  _active = true
  attachGlobalTargets()
  document.addEventListener('settings:opened', _onSettingsOpened)
  // Settings panel may already be open if user opened it before discovery init
  if (document.getElementById('settings-panel')?.classList.contains('open')) {
    setTimeout(attachSettingsTargets, 80)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Attachment helpers
// ─────────────────────────────────────────────────────────────────────────────

function attachGlobalTargets(): void {
  const nonSettings = TARGETS.filter((t) => !t.inSettings)
  // Use a short delay so the DOM is fully rendered
  requestAnimationFrame(() => {
    for (const target of nonSettings) {
      const el = document.querySelector<HTMLElement>(target.selector)
      if (el) attachToElement(el, target)
    }
  })
}

function attachSettingsTargets(): void {
  if (!_active) return
  const inSettings = TARGETS.filter((t) => t.inSettings)
  for (const target of inSettings) {
    const el = document.querySelector<HTMLElement>(target.selector)
    if (el) attachToElement(el, target)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-element binding
// ─────────────────────────────────────────────────────────────────────────────

function attachToElement(el: HTMLElement, target: DiscoveryTarget): void {
  if (el.dataset.discoveryBound === '1') return
  el.dataset.discoveryBound = '1'
  el.classList.add('discovery-target')

  if (target.triggerOnClick) {
    el.addEventListener('click', () => {
      if (!_active) return
      showPopup(el, target)
    })
  } else {
    el.addEventListener('mouseenter', () => {
      if (!_active) return
      showPopup(el, target)
    })

    el.addEventListener('mouseleave', () => {
      scheduleHide()
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Popup management
// ─────────────────────────────────────────────────────────────────────────────

function showPopup(anchor: HTMLElement, target: DiscoveryTarget): void {
  clearHideTimer()

  if (!_popup) {
    _popup = document.createElement('div')
    _popup.className = 'discovery-popup'
    _popup.addEventListener('mouseenter', clearHideTimer)
    _popup.addEventListener('mouseleave', scheduleHide)

    const closeBtn = document.createElement('button')
    closeBtn.className = 'discovery-popup-close'
    closeBtn.setAttribute('aria-label', t('discovery.dismiss'))
    closeBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/></svg>`
    closeBtn.addEventListener('click', finishDiscovery)
    _popup.appendChild(closeBtn)

    document.body.appendChild(_popup)
  }

  // Update content
  const existing = _popup.querySelector('.discovery-popup-inner')
  if (existing) existing.remove()

  const inner = document.createElement('div')
  inner.className = 'discovery-popup-inner'

  const titleEl = document.createElement('div')
  titleEl.className = 'discovery-popup-title'
  titleEl.textContent = t(target.titleKey)

  const descEl = document.createElement('div')
  descEl.className = 'discovery-popup-desc'
  descEl.textContent = t(target.descKey)

  inner.appendChild(titleEl)
  inner.appendChild(descEl)

  if (target.shortcut) {
    const kbd = document.createElement('kbd')
    kbd.className = 'discovery-popup-kbd'
    kbd.textContent = target.shortcut
    inner.appendChild(kbd)
  }

  const dismiss = document.createElement('button')
  dismiss.className = 'discovery-popup-dismiss'
  dismiss.textContent = t('discovery.dismiss')
  dismiss.addEventListener('click', finishDiscovery)
  inner.appendChild(dismiss)

  _popup.appendChild(inner)

  // Position below anchor element
  positionPopup(anchor)
  _popup.classList.add('discovery-popup--visible')
}

function positionPopup(anchor: HTMLElement): void {
  if (!_popup) return

  const rect = anchor.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return

  const popupW = 260
  const popupH = 140
  const gap = 8

  // Prefer below the anchor; for large elements (editor) use top-left area + offset
  let left = rect.left
  let top = rect.bottom + gap

  // For very tall elements (cm-editor), anchor to the top instead
  if (rect.height > 100) {
    top = rect.top + gap
  }

  // Clamp to viewport
  if (left + popupW > window.innerWidth - 12) {
    left = window.innerWidth - popupW - 12
  }
  if (top + popupH > window.innerHeight - 12) {
    top = rect.top - popupH - gap
  }

  _popup.style.left = `${Math.max(8, left)}px`
  _popup.style.top = `${Math.max(8, top)}px`
}

function scheduleHide(): void {
  _hideTimer = setTimeout(() => {
    if (_popup) _popup.classList.remove('discovery-popup--visible')
  }, 600)
}

function clearHideTimer(): void {
  if (_hideTimer) {
    clearTimeout(_hideTimer)
    _hideTimer = null
  }
}

function finishDiscovery(): void {
  _active = false
  clearHideTimer()

  // Remove global listener so no new bindings happen after discovery ends
  document.removeEventListener('settings:opened', _onSettingsOpened)

  if (_popup) {
    _popup.remove()
    _popup = null
  }

  // Remove glow class and reset bound flag from all targets
  document.querySelectorAll<HTMLElement>('.discovery-target').forEach((el) => {
    el.classList.remove('discovery-target')
    delete el.dataset.discoveryBound
  })

  window.vanfolioAPI.markDiscoveryDone().catch(console.error)
}
