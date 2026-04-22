// ─────────────────────────────────────────────────────────────────────────────
// Toolbar Module — Preview floating toolbar (zoom)
// Sprint 1: Static editor toolbar removed entirely. Slash Command replaces it.
// ─────────────────────────────────────────────────────────────────────────────

let isZoomBound = false

let currentZoom = 1.0
const ZOOM_MIN = 0.5
const ZOOM_MAX = 2.0
const ZOOM_STEP = 0.1

export function initToolbar(): void {
  initPreviewToolbarCentering()
  initZoom()
  // ⚠️ Export buttons are wired in renderer/main.ts (sole owner)
}

function initZoom(): void {
  if (isZoomBound) return
  isZoomBound = true

  const zoomOut = document.getElementById('btn-zoom-out')
  const zoomIn  = document.getElementById('btn-zoom-in')
  const label   = document.getElementById('btn-zoom-label')
  const content = document.getElementById('preview-content')
  const panel   = document.getElementById('preview-panel')
  if (!zoomOut || !zoomIn || !content) return

  zoomOut.addEventListener('click', () => {
    currentZoom = Math.max(ZOOM_MIN, +(currentZoom - ZOOM_STEP).toFixed(1))
    applyZoom(content, label)
  })

  zoomIn.addEventListener('click', () => {
    currentZoom = Math.min(ZOOM_MAX, +(currentZoom + ZOOM_STEP).toFixed(1))
    applyZoom(content, label)
  })

  // Ctrl+Scroll → zoom preview
  panel?.addEventListener('wheel', (e: WheelEvent) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP
    currentZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(currentZoom + delta).toFixed(1)))
    applyZoom(content, label)
  }, { passive: false })
}

function applyZoom(content: HTMLElement, label: HTMLElement | null): void {
  // Use CSS zoom (not transform: scale) so layout flow is preserved and scrolling works correctly
  ;(content.style as CSSStyleDeclaration & { zoom: string }).zoom = String(currentZoom)
  if (label) label.textContent = `${Math.round(currentZoom * 100)}%`
  window.vanfolioAPI.sendPreviewSettings({ zoom: currentZoom })
}

// ── Preview Toolbar Centering ─────────────────────────────────────────────────

function initPreviewToolbarCentering(): void {
  // CSS `left: 50%; transform: translateX(-50%)` handles centering automatically since
  // #preview-toolbar is position:absolute inside #preview-panel (position:relative).
  // No JS override needed — CSS recenters whenever the panel resizes or TOC toggles.
}
