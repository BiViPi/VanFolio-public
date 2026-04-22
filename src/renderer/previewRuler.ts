import { updateSetting, getAppSettings } from './settings'
import { applyPreviewLayout } from './preview'

/**
 * Phase 4.2: Preview-First Margin Handles & Smart Ruler
 * Manages interactive margins directly on the preview pages.
 */

type MarginSide = 'top' | 'right' | 'bottom' | 'left'

let isDragging = false
let currentSide: MarginSide | null = null
let startPos = 0
let startValue = 0
let currentTooltip: HTMLElement | null = null

const PX_PER_MM = 3.7795

export function initPreviewRuler(): void {
    // Global drag listeners
    document.addEventListener('mousedown', (e) => {
        const target = e.target as HTMLElement
        if (target.classList.contains('margin-handle')) {
            const side = target.dataset.margin as MarginSide
            if (side) startDrag(e, side)
        }
    })

    document.addEventListener('mousemove', (e) => {
        if (isDragging) handleDrag(e)
    })

    document.addEventListener('mouseup', () => {
        if (isDragging) stopDrag()
    })

    // Watch for pagination changes to redraw ticks (MutationObserver on #preview-content)
    const previewContent = document.getElementById('preview-content')
    if (previewContent) {
        const observer = new MutationObserver(() => {
            drawAllRulerTicks()
        })
        observer.observe(previewContent, { childList: true })
    }
}

function startDrag(e: MouseEvent, side: MarginSide): void {
    isDragging = true
    currentSide = side

    const settings = getAppSettings()
    if (!settings) return

    // Get initial value from settings
    const key = `pageMargin${side.charAt(0).toUpperCase() + side.slice(1)}` as keyof typeof settings
    startValue = settings[key] as number
    startPos = (side === 'top' || side === 'bottom') ? e.clientY : e.clientX

    // Add dragging class for cursor persistence
    document.body.classList.add('is-dragging-margin')
    const handle = e.target as HTMLElement
    handle.classList.add('dragging')

    // Show tooltip
    showTooltip(e, startValue)
}

function handleDrag(e: MouseEvent): void {
    if (!currentSide) return

    const previewContent = document.getElementById('preview-content')
    const zoom = previewContent ? parseFloat((previewContent.style as any).zoom || '1') : 1

    const currentPos = (currentSide === 'top' || currentSide === 'bottom') ? e.clientY : e.clientX
    let delta = (currentPos - startPos) / zoom

    // Invert delta for right and bottom margins (dragging inwards increases margin)
    if (currentSide === 'right' || currentSide === 'bottom') {
        delta = -delta
    }

    const newValue = Math.min(140, Math.max(24, Math.round(startValue + delta)))

    // 1. Immediate visual feedback (CSS variable)
    document.documentElement.style.setProperty(`--paper-margin-${currentSide}`, `${newValue}px`)
    if (currentSide === 'top' || currentSide === 'bottom') {
        document.documentElement.style.setProperty('--paper-padding-v', `${newValue}px`)
    } else {
        document.documentElement.style.setProperty('--paper-padding-h', `${newValue}px`)
    }

    // 2. Update tooltip
    updateTooltip(e, newValue)

    // 3. Save setting (debounced in updateSetting)
    const key = `pageMargin${currentSide.charAt(0).toUpperCase() + currentSide.slice(1)}` as any
    updateSetting(key, newValue, false) // false = don't re-apply to DOM (we just did it)
}

function stopDrag(): void {
    isDragging = false
    document.body.classList.remove('is-dragging-margin')

    document.querySelectorAll('.margin-handle.dragging').forEach(h => h.classList.remove('dragging'))
    hideTooltip()

    // 4. Trigger re-pagination (final pass)
    const settings = getAppSettings()
    if (settings) {
        applyPreviewLayout(settings.paperSize, settings.paperOrientation)
    }

    currentSide = null
}

// ── Smart Ruler Ticks ─────────────────────────────────────────────────────────

function drawAllRulerTicks(): void {
    const pages = document.querySelectorAll('.preview-page')
    pages.forEach(page => {
        const hTicks = page.querySelector('.smart-ruler-h .smart-ruler-ticks') as HTMLElement
        const vTicks = page.querySelector('.smart-ruler-v .smart-ruler-ticks') as HTMLElement

        if (hTicks && hTicks.children.length === 0) drawTicks(hTicks, 'horizontal')
        if (vTicks && vTicks.children.length === 0) drawTicks(vTicks, 'vertical')
    })
}

function drawTicks(container: HTMLElement, orientation: 'horizontal' | 'vertical'): void {
    const isH = orientation === 'horizontal'
    const parent = container.closest('.preview-page') as HTMLElement
    if (!parent) return

    const size = isH ? parent.offsetWidth : parent.offsetHeight
    const mmStep = PX_PER_MM

    const fragment = document.createDocumentFragment()

    // Draw ticks every 5mm, labels every 10mm
    for (let px = 0; px <= size; px += mmStep * 5) {
        const mm = Math.round(px / mmStep)
        const isMajor = mm % 10 === 0

        const tick = document.createElement('div')
        tick.className = `tick ${isMajor ? 'major' : 'minor'}`

        if (isH) {
            tick.style.left = `${px}px`
        } else {
            tick.style.top = `${px}px`
        }

        fragment.appendChild(tick)

        if (isMajor && mm > 0 && mm % 20 === 0) {
            const label = document.createElement('div')
            label.className = 'smart-ruler-label'
            label.textContent = String(mm / 10) // show cm
            if (isH) {
                label.style.left = `${px + 2}px`
                label.style.top = '2px'
            } else {
                label.style.top = `${px + 2}px`
                label.style.left = '2px'
            }
            fragment.appendChild(label)
        }
    }

    container.appendChild(fragment)
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

function showTooltip(e: MouseEvent, value: number): void {
    if (currentTooltip) currentTooltip.remove()

    currentTooltip = document.createElement('div')
    currentTooltip.className = 'margin-tooltip'
    updateTooltip(e, value)
    document.body.appendChild(currentTooltip)
}

function updateTooltip(e: MouseEvent, value: number): void {
    if (!currentTooltip) return
    const mm = (value / PX_PER_MM).toFixed(1)
    currentTooltip.textContent = `${mm} mm`
    currentTooltip.style.left = `${e.clientX}px`
    currentTooltip.style.top = `${e.clientY}px`
}

function hideTooltip(): void {
    if (currentTooltip) {
        currentTooltip.remove()
        currentTooltip = null
    }
}
