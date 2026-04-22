type TooltipPlacement = 'right' | 'bottom'

let floatingTooltipEl: HTMLDivElement | null = null
let floatingTooltipArrowEl: HTMLDivElement | null = null

function ensureFloatingTooltip(): { bubble: HTMLDivElement; arrow: HTMLDivElement } {
  if (!floatingTooltipEl || !floatingTooltipArrowEl) {
    const bubble = document.createElement('div')
    bubble.className = 'floating-tooltip'
    bubble.setAttribute('aria-hidden', 'true')

    const arrow = document.createElement('div')
    arrow.className = 'floating-tooltip-arrow'
    arrow.setAttribute('aria-hidden', 'true')

    document.body.appendChild(bubble)
    document.body.appendChild(arrow)

    floatingTooltipEl = bubble
    floatingTooltipArrowEl = arrow
  }

  return { bubble: floatingTooltipEl, arrow: floatingTooltipArrowEl }
}

export function hideFloatingTooltip(): void {
  floatingTooltipEl?.classList.remove('visible')
  floatingTooltipArrowEl?.classList.remove('visible')
}

export function showFloatingTooltip(anchor: HTMLElement, label: string, placement: TooltipPlacement = 'right'): void {
  const { bubble, arrow } = ensureFloatingTooltip()
  bubble.textContent = label
  bubble.dataset.placement = placement
  bubble.classList.add('visible')
  arrow.classList.add('visible')

  const rect = anchor.getBoundingClientRect()
  const bubbleRect = bubble.getBoundingClientRect()
  const gap = 10
  const arrowSize = 8
  const viewportPadding = 8

  if (placement === 'bottom') {
    const left = Math.round(rect.left + rect.width / 2 - bubbleRect.width / 2)
    const top = Math.round(rect.bottom + gap)
    const clampedLeft = Math.max(viewportPadding, Math.min(left, window.innerWidth - bubbleRect.width - viewportPadding))
    bubble.style.left = `${clampedLeft}px`
    bubble.style.top = `${top}px`
    arrow.style.left = `${Math.round(rect.left + rect.width / 2 - arrowSize / 2)}px`
    arrow.style.top = `${Math.round(rect.bottom + 4)}px`
    arrow.dataset.placement = 'bottom'
    return
  }

  const left = Math.round(rect.right + gap)
  const top = Math.round(rect.top + rect.height / 2 - bubbleRect.height / 2)
  const clampedLeft = Math.min(left, window.innerWidth - bubbleRect.width - viewportPadding)
  bubble.style.left = `${Math.max(viewportPadding, clampedLeft)}px`
  bubble.style.top = `${Math.max(viewportPadding, top)}px`
  arrow.style.left = `${Math.round(rect.right + 4)}px`
  arrow.style.top = `${Math.round(rect.top + rect.height / 2 - arrowSize / 2)}px`
  arrow.dataset.placement = 'right'
}

export function bindFloatingTooltip(element: HTMLElement, label: string, placement: TooltipPlacement = 'right'): void {
  element.dataset.tooltipLabel = label
  element.dataset.tooltipPlacement = placement
  element.setAttribute('aria-label', label)
  element.removeAttribute('title')
  if (element.dataset.tooltipBound === 'true') return
  element.dataset.tooltipBound = 'true'
  element.addEventListener('mouseenter', () => {
    const tooltipLabel = element.dataset.tooltipLabel?.trim()
    if (!tooltipLabel) return
    showFloatingTooltip(element, tooltipLabel, (element.dataset.tooltipPlacement as TooltipPlacement) || placement)
  })
  element.addEventListener('focus', () => {
    const tooltipLabel = element.dataset.tooltipLabel?.trim()
    if (!tooltipLabel) return
    showFloatingTooltip(element, tooltipLabel, (element.dataset.tooltipPlacement as TooltipPlacement) || placement)
  })
  element.addEventListener('mouseleave', hideFloatingTooltip)
  element.addEventListener('blur', hideFloatingTooltip)
}

export function syncFloatingTooltips(selector: string, placement: TooltipPlacement = 'bottom'): void {
  document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    const label = el.getAttribute('title')?.trim()
    if (!label) return
    bindFloatingTooltip(el, label, placement)
  })
}
