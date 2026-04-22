// ─────────────────────────────────────────────────────────────────────────────
// TOC Toggle Module — Ctrl+\ and #btn-toggle-toc
// Sprint 6 (S6-1)
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ Listener leak guard — module-level stable references

let isBound = false

export function initTocToggle(): void {
  if (isBound) return
  isBound = true
  const toc = document.getElementById('toc-sidebar')
  const btn = document.getElementById('btn-toggle-toc')
  if (toc && btn) btn.classList.toggle('active', !toc.classList.contains('hidden'))
}

export function toggleToc(): void {
  const toc = document.getElementById('toc-sidebar')
  if (!toc) return
  toc.classList.toggle('hidden')

  // Reflect active state on the toggle button
  const btn = document.getElementById('btn-toggle-toc')
  if (btn) btn.classList.toggle('active', !toc.classList.contains('hidden'))

  // Notify toolbar so ResizeObserver recalculates centering
  window.dispatchEvent(new CustomEvent('toc:toggled'))
}
