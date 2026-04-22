// ─────────────────────────────────────────────────────────────────────────────
// Toast — shared renderer utility
// Sprint 7 (S7-1c): extracted from exportModal.ts so any renderer module can
// show a toast without importing the export modal.
// ⚠️ There is ONE #toast-container in index.html — do not create another.
// ─────────────────────────────────────────────────────────────────────────────

export function showToast(
  message: string,
  type: 'success' | 'error' | 'info' = 'info',
  action?: { label: string; onClick: () => void }
): void {
  const container = document.getElementById('toast-container')
  if (!container) return

  const toast = document.createElement('div')
  toast.className = `toast toast-${type}`

  const msgSpan = document.createElement('span')
  msgSpan.className = 'toast-message'
  msgSpan.textContent = message
  toast.appendChild(msgSpan)

  if (action) {
    const btn = document.createElement('button')
    btn.className = 'toast-action'
    btn.textContent = action.label
    btn.addEventListener('click', () => {
      action.onClick()
      toast.remove()
    })
    toast.appendChild(btn)
  }

  const dismissBtn = document.createElement('button')
  dismissBtn.className = 'toast-dismiss'
  dismissBtn.textContent = '✕'
  dismissBtn.addEventListener('click', () => toast.remove())
  toast.appendChild(dismissBtn)

  container.appendChild(toast)

  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.classList.add('toast-fade')
      setTimeout(() => toast.remove(), 300)
    }
  }, 5000)
}
