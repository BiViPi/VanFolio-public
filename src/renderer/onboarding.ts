// ─────────────────────────────────────────────────────────────────────────────
// Onboarding Modal — Phase 4.1.2
// 4-step flow: Theme → Vault → Anatomy → Summary
// Shows on first launch only; persists flag via storeManager
// ─────────────────────────────────────────────────────────────────────────────

import { applyTheme } from './settings'
import { t, setLocale, getLocale, LANG_OPTIONS } from '@shared/i18n'
import type { AppSettings } from '@shared/types'

const TOTAL_STEPS = 4

// Theme definitions — name/desc resolved at render time via t()
const THEMES: {
  id: AppSettings['theme']
  nameKey: string
  descKey: string
  bg: string
  accent: string
  tokens: {
    bg: string
    surface: string
    border: string
    text: string
    textSub: string
    accent: string
    accentFg: string
  }
}[] = [
  {
    id: 'van-ivory',
    nameKey: 'Van Ivory',
    descKey: 'onboarding.theme.light',
    bg: '#FDFCFB',
    accent: '#D4AF37',
    tokens: { bg: '#F5EFE0', surface: '#EDE5D0', border: 'rgba(180,155,90,0.25)', text: '#2C2410', textSub: '#7A6840', accent: '#D4AF37', accentFg: '#fff' },
  },
  {
    id: 'dark-obsidian',
    nameKey: 'Dark Obsidian',
    descKey: 'onboarding.theme.dark',
    bg: '#0E1111',
    accent: '#26A69A',
    tokens: { bg: '#141A1A', surface: '#1E2828', border: 'rgba(38,166,154,0.2)', text: '#E0ECEB', textSub: '#7AADAA', accent: '#26A69A', accentFg: '#0E1111' },
  },
  {
    id: 'van-botanical',
    nameKey: 'Van Botanical',
    descKey: 'onboarding.theme.botanical',
    bg: '#F8F3E1',
    accent: '#9CAB84',
    tokens: { bg: '#EFF5E8', surface: '#E3EDD9', border: 'rgba(120,150,90,0.2)', text: '#1E2B18', textSub: '#5A7848', accent: '#7A9A60', accentFg: '#fff' },
  },
  {
    id: 'van-chronicle',
    nameKey: 'Van Chronicle',
    descKey: 'onboarding.theme.chronicle',
    bg: '#EFE6D5',
    accent: '#FBBF24',
    tokens: { bg: '#EDE0C8', surface: '#E2D4B4', border: 'rgba(180,140,60,0.25)', text: '#2A1E08', textSub: '#7A5E28', accent: '#D4960A', accentFg: '#fff' },
  },
]

// Anatomy items — title/desc resolved at render time via t()
const ANATOMY_ITEMS: { icon: string; titleKey: string; descKey: string; selector: string }[] = [
  {
    icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    titleKey: 'onboarding.anatomy.sidebar.title',
    descKey: 'onboarding.anatomy.sidebar.desc',
    selector: '#icon-sidebar',
  },
  {
    icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
    titleKey: 'onboarding.anatomy.editor.title',
    descKey: 'onboarding.anatomy.editor.desc',
    selector: '.cm-editor',
  },
  {
    icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
    titleKey: 'onboarding.anatomy.preview.title',
    descKey: 'onboarding.anatomy.preview.desc',
    selector: '#preview-toolbar',
  },
  {
    icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    titleKey: 'onboarding.anatomy.slash.title',
    descKey: 'onboarding.anatomy.slash.desc',
    selector: '#slash-popup',
  },
]

/**
 * Entry point — called from main.ts.
 * Resolves when onboarding is dismissed (theme chosen, vault set).
 */
export async function maybeShowOnboarding(currentTheme: AppSettings['theme']): Promise<void> {
  const done = await window.vanfolioAPI.checkOnboarding()
  if (done) return
  return showOnboardingModal(currentTheme)
}

// ─────────────────────────────────────────────────────────────────────────────

function showOnboardingModal(initialTheme: AppSettings['theme']): Promise<void> {
  return new Promise((resolve) => {
    let step = 0
    let chosenTheme: AppSettings['theme'] = initialTheme
    let vaultPath: string | null = null

    // Pre-populate vault path from store (user may have set it before)
    window.vanfolioAPI.getVaultPath().then((p) => { if (p) vaultPath = p }).catch(() => { })

    // ── Build skeleton ──
    const overlay = document.createElement('div')
    overlay.className = 'onboarding-overlay'

    const modal = document.createElement('div')
    modal.className = 'onboarding-modal'
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')

    // Progress bar
    const progressBar = document.createElement('div')
    progressBar.className = 'onboarding-progress-bar'
    const progressFill = document.createElement('div')
    progressFill.className = 'onboarding-progress-fill'
    progressBar.appendChild(progressFill)

    // Body
    const body = document.createElement('div')
    body.className = 'onboarding-body'

    // Footer
    const footer = document.createElement('div')
    footer.className = 'onboarding-footer'

    const dotsEl = document.createElement('div')
    dotsEl.className = 'onboarding-dots'
    for (let i = 0; i < TOTAL_STEPS; i++) {
      const dot = document.createElement('span')
      dot.className = 'onboarding-dot'
      dotsEl.appendChild(dot)
    }

    const actions = document.createElement('div')
    actions.className = 'onboarding-footer-actions'

    const prevBtn = document.createElement('button')
    prevBtn.className = 'onboarding-btn onboarding-btn--ghost'
    prevBtn.textContent = t('onboarding.prev')

    const nextBtn = document.createElement('button')
    nextBtn.className = 'onboarding-btn onboarding-btn--primary'
    nextBtn.textContent = t('onboarding.next')

    actions.appendChild(prevBtn)
    actions.appendChild(nextBtn)
    footer.appendChild(dotsEl)
    footer.appendChild(actions)

    modal.appendChild(progressBar)
    modal.appendChild(body)
    modal.appendChild(footer)
    overlay.appendChild(modal)

    // ── Theme tokens ──

    function applyModalTheme(themeId: AppSettings['theme']): void {
      const theme = THEMES.find(t => t.id === themeId)
      if (!theme) return
      const s = modal.style
      s.setProperty('--ob-bg', theme.tokens.bg)
      s.setProperty('--ob-surface', theme.tokens.surface)
      s.setProperty('--ob-border', theme.tokens.border)
      s.setProperty('--ob-text', theme.tokens.text)
      s.setProperty('--ob-text-sub', theme.tokens.textSub)
      s.setProperty('--ob-accent', theme.tokens.accent)
      s.setProperty('--ob-accent-fg', theme.tokens.accentFg)
    }

    // Apply initial theme tokens immediately
    applyModalTheme(chosenTheme)

    // ── Render ──

    function updateChrome(): void {
      // Progress fill
      progressFill.style.width = `${((step + 1) / TOTAL_STEPS) * 100}%`

      // Dots
      dotsEl.querySelectorAll<HTMLElement>('.onboarding-dot').forEach((d, i) => {
        d.classList.toggle('done', i < step)
        d.classList.toggle('active', i === step)
      })

      prevBtn.style.visibility = step === 0 ? 'hidden' : 'visible'
      nextBtn.textContent = step === TOTAL_STEPS - 1 ? t('onboarding.done') : t('onboarding.next')
    }

    function renderStep(): void {
      body.innerHTML = ''
      body.classList.remove('step-theme', 'step-vault', 'step-anatomy', 'step-summary')

      if (step === 0) {
        body.classList.add('step-theme')
        renderThemeStep()
      } else if (step === 1) {
        body.classList.add('step-vault')
        renderVaultStep()
      } else if (step === 2) {
        body.classList.add('step-anatomy')
        renderAnatomyStep()
      } else {
        body.classList.add('step-summary')
        renderSummaryStep()
      }

      updateChrome()
    }

    // ── Step 1: Theme ──

    function renderThemeStep(): void {
      addStepLabel(t('onboarding.step1.label'))

      // Header with Title + Language Selector
      const header = document.createElement('div')
      header.className = 'onboarding-header-row'
      const title = document.createElement('h1')
      title.className = 'onboarding-title'
      title.textContent = t('onboarding.step1.title')
      header.appendChild(title)

      header.appendChild(buildLanguageSelect())
      body.appendChild(header)

      addSubtitle(t('onboarding.step1.subtitle'))

      const workspace = document.createElement('div')
      workspace.className = 'onboarding-theme-workspace'

      // Left: Mockup Preview
      const preview = document.createElement('div')
      preview.className = 'onboarding-theme-preview'
      const updatePreview = (themeId: AppSettings['theme']) => {
        const theme = THEMES.find(t => t.id === themeId)
        if (!theme) return
        preview.innerHTML = `
          <div class="ob-mockup" style="--m-bg: ${theme.bg}; --m-accent: ${theme.accent}">
            <div class="ob-mockup-sidebar">
              <div class="ob-mockup-dot" style="background:#ff5f57"></div>
              <div class="ob-mockup-dot" style="background:#febc2e"></div>
              <div class="ob-mockup-dot" style="background:#28c840"></div>
              <div class="ob-mockup-line" style="margin-top:20px; width:80%"></div>
              <div class="ob-mockup-line" style="width:60%"></div>
              <div class="ob-mockup-line" style="width:70%"></div>
            </div>
            <div class="ob-mockup-main">
              <div class="ob-mockup-title"></div>
              <div class="ob-mockup-p"></div>
              <div class="ob-mockup-p" style="width:85%"></div>
              <div class="ob-mockup-p" style="width:90%"></div>
              <div class="ob-mockup-accent-block"></div>
            </div>
          </div>
        `
      }
      workspace.appendChild(preview)

      // Right: Theme Selection
      const grid = document.createElement('div')
      grid.className = 'onboarding-theme-grid'

      for (const theme of THEMES) {
        const card = document.createElement('button')
        card.className = 'onboarding-theme-card'
        if (theme.id === chosenTheme) card.classList.add('active')

        const swatch = document.createElement('div')
        swatch.className = 'onboarding-swatch'
        swatch.style.background = theme.bg

        const accentBar = document.createElement('div')
        accentBar.className = 'onboarding-swatch-accent'
        accentBar.style.background = theme.accent
        swatch.appendChild(accentBar)

        const name = document.createElement('div')
        name.className = 'onboarding-theme-name'
        name.textContent = theme.nameKey

        card.appendChild(swatch)
        card.appendChild(name)

        card.addEventListener('click', () => {
          chosenTheme = theme.id
          applyTheme(theme.id).catch(console.error)
          applyModalTheme(theme.id)
          grid.querySelectorAll('.onboarding-theme-card').forEach((c) => c.classList.remove('active'))
          card.classList.add('active')
          updatePreview(theme.id)
        })

        grid.appendChild(card)
      }

      workspace.appendChild(grid)
      body.appendChild(workspace)

      updatePreview(chosenTheme)
    }

    function buildLanguageSelect(): HTMLElement {
      const wrapper = document.createElement('div')
      wrapper.className = 'ob-lang-select'

      const currentLocale = getLocale()
      const currentOpt = LANG_OPTIONS.find(o => o.id === currentLocale) || LANG_OPTIONS[1] // fallback to EN

      const trigger = document.createElement('button')
      trigger.className = 'ob-lang-trigger'
      trigger.innerHTML = `<span class="ob-lang-flag">${currentOpt.flag}</span> <span class="ob-lang-label">${currentOpt.label}</span> <span class="material-symbols-outlined">expand_more</span>`

      const list = document.createElement('div')
      list.className = 'ob-lang-list'

      for (const opt of LANG_OPTIONS) {
        const item = document.createElement('button')
        item.className = 'ob-lang-item'
        if (opt.id === currentLocale) item.classList.add('active')
        item.innerHTML = `<span>${opt.flag} ${opt.label}</span>`

        item.addEventListener('click', () => {
          setLocale(opt.id as any)
          trigger.querySelector('.ob-lang-flag')!.textContent = opt.flag
          trigger.querySelector('.ob-lang-label')!.textContent = opt.label
          list.classList.remove('open')
          renderStep() // Re-render everything with new language
        })
        list.appendChild(item)
      }

      trigger.addEventListener('click', () => {
        list.classList.toggle('open')
      })

      // Close on click outside
      document.addEventListener('mousedown', (e) => {
        if (!wrapper.contains(e.target as Node)) {
          list.classList.remove('open')
        }
      }, { once: true })

      wrapper.appendChild(trigger)
      wrapper.appendChild(list)
      return wrapper
    }

    // ── Step 2: Vault ──

    function renderVaultStep(): void {
      addStepLabel(t('onboarding.step2.label'))
      addTitle(t('onboarding.step2.title'))
      addSubtitle(t('onboarding.step2.subtitle'))

      const block = document.createElement('div')
      block.className = 'onboarding-vault-block'

      const iconEl = document.createElement('div')
      iconEl.className = 'onboarding-vault-icon'
      iconEl.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`

      const info = document.createElement('div')
      info.className = 'onboarding-vault-info'

      const pathEl = document.createElement('div')
      pathEl.className = 'onboarding-vault-path'

      const hintEl = document.createElement('div')
      hintEl.className = 'onboarding-vault-hint'

      const updateVaultDisplay = (): void => {
        if (vaultPath) {
          pathEl.textContent = vaultPath
          hintEl.textContent = t('onboarding.step2.vaultHint')
        } else {
          pathEl.textContent = t('onboarding.step2.noFolder')
          hintEl.textContent = t('onboarding.step2.noFolderHint')
        }
      }
      updateVaultDisplay()

      info.appendChild(pathEl)
      info.appendChild(hintEl)

      const changeBtn = document.createElement('button')
      changeBtn.className = 'onboarding-vault-change'
      changeBtn.textContent = vaultPath ? t('onboarding.step2.change') : t('onboarding.step2.chooseFolder')

      changeBtn.addEventListener('click', async () => {
        const picked = await window.vanfolioAPI.pickVaultPath()
        if (picked) {
          vaultPath = picked
          await window.vanfolioAPI.setVaultPath(picked)
          updateVaultDisplay()
          changeBtn.textContent = t('onboarding.step2.change')
        }
      })

      block.appendChild(iconEl)
      block.appendChild(info)
      block.appendChild(changeBtn)
      body.appendChild(block)
    }

    // ── Step 3: Anatomy ──

    function renderAnatomyStep(): void {
      addStepLabel(t('onboarding.step3.label'))
      addTitle(t('onboarding.step3.title'))
      addSubtitle(t('onboarding.step3.subtitle'))

      const grid = document.createElement('div')
      grid.className = 'onboarding-anatomy-grid'

      for (const item of ANATOMY_ITEMS) {
        const el = document.createElement('div')
        el.className = 'onboarding-anatomy-item'

        const iconWrap = document.createElement('div')
        iconWrap.className = 'onboarding-anatomy-icon'
        iconWrap.innerHTML = item.icon

        const text = document.createElement('div')
        text.className = 'onboarding-anatomy-text'
        text.innerHTML = `<h3>${t(item.titleKey)}</h3><p>${t(item.descKey)}</p>`

        el.appendChild(iconWrap)
        el.appendChild(text)

        // Spotlight: highlight real DOM element on hover
        el.addEventListener('mouseenter', () => {
          const target = document.querySelector<HTMLElement>(item.selector)
          if (!target) return
          const rect = target.getBoundingClientRect()
          if (rect.width === 0 && rect.height === 0) return
          target.classList.add('ob-spotlight')
        })
        el.addEventListener('mouseleave', () => {
          document.querySelector<HTMLElement>(item.selector)?.classList.remove('ob-spotlight')
        })

        grid.appendChild(el)
      }

      body.appendChild(grid)
    }

    // ── Step 4: Summary ──

    function renderSummaryStep(): void {
      addStepLabel(t('onboarding.step4.label'))
      addTitle(t('onboarding.step4.title'))
      addSubtitle(t('onboarding.step4.subtitle'))

      const themeInfo = THEMES.find((th) => th.id === chosenTheme)

      const summary = document.createElement('div')
      summary.className = 'onboarding-summary'

      summary.appendChild(makeSummaryRow(
        `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>`,
        t('onboarding.step4.themeLabel'),
        themeInfo?.nameKey ?? chosenTheme,
      ))

      summary.appendChild(makeSummaryRow(
        `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
        t('onboarding.step4.vaultLabel'),
        vaultPath ?? t('onboarding.step4.vaultNotSet'),
      ))

      summary.appendChild(makeSummaryRow(
        `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
        t('onboarding.step4.discoveryLabel'),
        t('onboarding.step4.discoveryValue'),
      ))

      body.appendChild(summary)
    }

    // ── Helpers ──

    function addStepLabel(text: string): void {
      const el = document.createElement('div')
      el.className = 'onboarding-step-label'
      el.textContent = text
      body.appendChild(el)
    }

    function addTitle(text: string): void {
      const el = document.createElement('h1')
      el.className = 'onboarding-title'
      el.textContent = text
      body.appendChild(el)
    }

    function addSubtitle(text: string): void {
      const el = document.createElement('p')
      el.className = 'onboarding-subtitle'
      el.textContent = text
      body.appendChild(el)
    }

    function makeSummaryRow(iconSvg: string, label: string, value: string): HTMLElement {
      const row = document.createElement('div')
      row.className = 'onboarding-summary-row'

      const icon = document.createElement('div')
      icon.className = 'onboarding-summary-icon'
      icon.innerHTML = iconSvg

      const textBlock = document.createElement('div')
      const labelEl = document.createElement('div')
      labelEl.className = 'onboarding-summary-label'
      labelEl.textContent = label
      const valueEl = document.createElement('div')
      valueEl.className = 'onboarding-summary-value'
      valueEl.textContent = value
      textBlock.appendChild(labelEl)
      textBlock.appendChild(valueEl)

      row.appendChild(icon)
      row.appendChild(textBlock)
      return row
    }

    // ── Navigation ──

    async function dismiss(): Promise<void> {
      document.removeEventListener('keydown', onKey)
      overlay.classList.add('onboarding-fade-out')
      overlay.addEventListener('transitionend', () => {
        overlay.remove()
        window.vanfolioAPI.markOnboardingDone().catch(console.error)
        // Open vault in sidebar (creates Welcome.md if empty)
        window.vanfolioAPI.openVault().then((result) => {
          if (result) {
            window.dispatchEvent(new CustomEvent('sidebar:loadFolder', { detail: result }))
          }
        }).catch(console.error)
        resolve()
      }, { once: true })
    }

    function goNext(): void {
      if (step < TOTAL_STEPS - 1) {
        step++
        renderStep()
      } else {
        dismiss().catch(console.error)
      }
    }

    function goPrev(): void {
      if (step > 0) {
        step--
        renderStep()
      }
    }

    prevBtn.addEventListener('click', goPrev)
    nextBtn.addEventListener('click', goNext)

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight' || (e.key === 'Enter' && e.target === nextBtn)) {
        e.preventDefault()
        goNext()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
      }
      // No Escape — onboarding is mandatory on first launch
    }

    document.addEventListener('keydown', onKey)
    document.body.appendChild(overlay)
    renderStep()
    nextBtn.focus()
  })
}
