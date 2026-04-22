// ─────────────────────────────────────────────────────────────────────────────
// aboutLicenseModal.ts — About VanFolio & License Modal
// Triggered by: Help → About VanFolio
// ─────────────────────────────────────────────────────────────────────────────

let isBound = false
import MarkdownIt from 'markdown-it'

/**
 * Opens the About modal and loads the app version and license text.
 */
export async function openAboutModal(): Promise<void> {
    const version = await window.vanfolioAPI.getAppVersion()
    const license = await window.vanfolioAPI.getLicenseText()

    const versionEl = document.getElementById('about-version-text')
    if (versionEl) versionEl.textContent = version

    const licenseEl = document.getElementById('about-license-text')
    if (licenseEl) {
        const md = new MarkdownIt({ breaks: true })
        licenseEl.innerHTML = md.render(license)
    }

    document.getElementById('about-overlay')?.classList.add('open')
}

/**
 * Closes the About modal.
 */
export function closeAboutModal(): void {
    document.getElementById('about-overlay')?.classList.remove('open')
}

/**
 * Initializes listeners for the About modal.
 */
export function initAboutModal(): void {
    if (isBound) return
    isBound = true

    const closeBtn = document.getElementById('about-close')
    const closeFooterBtn = document.getElementById('about-close-btn')
    const overlay = document.getElementById('about-overlay')

    closeBtn?.addEventListener('click', closeAboutModal)
    closeFooterBtn?.addEventListener('click', closeAboutModal)

    overlay?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeAboutModal()
    })

    window.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            if (overlay?.classList.contains('open')) {
                e.stopPropagation()
                closeAboutModal()
            }
        }
    })
}
