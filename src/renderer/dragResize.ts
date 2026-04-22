// Drag Resize - Editor/Preview splitter and TOC resize handle

const EDITOR_MIN = 180
const PREVIEW_MIN = 280
const TOC_MIN = 180
const TOC_MAX = 520

let isDragBound = false

export function initDragResize(): void {
  if (isDragBound) return
  isDragBound = true

  const handle = document.getElementById('drag-handle')
  const tocHandle = document.getElementById('toc-resize-handle')
  const editorPanel = document.getElementById('editor-panel')
  const previewPanel = document.getElementById('preview-panel')
  const tocSidebar = document.getElementById('toc-sidebar')
  const panels = document.getElementById('panels')
  if (!handle || !tocHandle || !editorPanel || !previewPanel || !tocSidebar || !panels) return

  let startX = 0
  let startWidth = 0
  let dragMode: 'editor' | 'toc' | null = null

  function stopDrag(): void {
    if (!panels.classList.contains('is-dragging')) return
    handle.classList.remove('dragging')
    tocHandle.classList.remove('dragging')
    panels.classList.remove('is-dragging')
    dragMode = null
  }

  handle.addEventListener('mousedown', (e: MouseEvent) => {
    startX = e.clientX
    startWidth = editorPanel.offsetWidth
    dragMode = 'editor'
    handle.classList.add('dragging')
    panels.classList.add('is-dragging')
    e.preventDefault()
  })

  tocHandle.addEventListener('mousedown', (e: MouseEvent) => {
    if (tocSidebar.classList.contains('hidden')) return
    startX = e.clientX
    startWidth = tocSidebar.offsetWidth
    dragMode = 'toc'
    tocHandle.classList.add('dragging')
    panels.classList.add('is-dragging')
    e.preventDefault()
  })

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!panels.classList.contains('is-dragging')) return

    const panelsStyle = getComputedStyle(panels)
    const gap = parseFloat(panelsStyle.columnGap || panelsStyle.gap || '0') || 0
    const paddingLeft = parseFloat(panelsStyle.paddingLeft || '0') || 0
    const paddingRight = parseFloat(panelsStyle.paddingRight || '0') || 0
    const tocVisible = !tocSidebar.classList.contains('hidden')
    const previewVisible = !previewPanel.classList.contains('hidden')
    const editorVisible = !editorPanel.classList.contains('hidden')

    if (dragMode === 'editor') {
      const delta = e.clientX - startX
      const newWidth = startWidth + delta
      const tocWidth = tocVisible ? tocSidebar.offsetWidth : 0
      const mandatoryGaps = previewVisible ? gap * 2 : 0
      const tocGap = tocVisible ? gap : 0
      const availableWidth =
        panels.clientWidth - paddingLeft - paddingRight - handle.offsetWidth - mandatoryGaps - tocGap - tocWidth
      const maxWidth = previewVisible ? availableWidth - PREVIEW_MIN : availableWidth
      const clamped = Math.max(EDITOR_MIN, Math.min(newWidth, maxWidth))

      editorPanel.style.flex = `0 0 ${clamped}px`
      return
    }

    if (dragMode === 'toc') {
      const delta = startX - e.clientX
      const newWidth = startWidth + delta
      const editorReserve = editorVisible ? EDITOR_MIN : 0
      const editorGap = editorVisible ? gap : 0
      const handleWidth = previewVisible ? handle.offsetWidth : 0
      const handleGap = previewVisible ? gap : 0
      const previewReserve = previewVisible ? PREVIEW_MIN : 0
      const availableWidth =
        panels.clientWidth - paddingLeft - paddingRight - editorReserve - editorGap - handleWidth - handleGap
      const maxWidth = Math.min(TOC_MAX, availableWidth - previewReserve)
      const clamped = Math.max(TOC_MIN, Math.min(newWidth, maxWidth))

      tocSidebar.style.width = `${clamped}px`
      tocSidebar.style.flex = `0 0 ${clamped}px`
    }
  })

  document.addEventListener('mouseup', stopDrag)
  window.addEventListener('blur', stopDrag)
}
