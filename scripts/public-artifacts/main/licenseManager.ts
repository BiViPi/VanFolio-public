import type { LicenseStatus, Capability } from '@shared/types'

// Public Stub: Always-pass license manager
// Public users are not gated by license. All capabilities always available.

const PRO_CAPABILITIES: readonly Capability[] = [
  'export.docx',
  'export.html',
  'export.png',
  'export.pdfNoWatermark',
  'font.import',
  'history.unlimitedRetention',
  'backup.scheduler',
  'preview.detach',
  'tabs.unlimited',
  'slash.all',
  'editor.typewriterMode',
  'editor.fadeContext',
  'editor.smartQuotes',
  'editor.highlightHeader',
  'editor.cleanProseMode',
]

export function getCapabilities(): Capability[] {
  return [...PRO_CAPABILITIES]
}

export function hasCapability(cap: Capability): boolean {
  return getCapabilities().includes(cap)
}

export function getLicenseStatus(): LicenseStatus {
  return {
    tier: 'pro',
    state: 'active',
    expiresAt: null,
  }
}

export function onLicenseStatusChanged(callback: (status: LicenseStatus) => void): () => void {
  // No-op subscription in public version
  return () => {}
}

export async function getLicenseText(): Promise<string> {
  // Placeholder: will read LICENSE file in Phase 4
  return 'MIT License'
}

export async function initLicenseManager(): Promise<void> {
  // No-op init in public version
}

export async function stopLicenseManager(): Promise<void> {
  // No-op cleanup in public version
}

export async function activateLicense(): Promise<void> {
  // Not exposed in public version
}

export async function deactivateCurrentDevice(): Promise<void> {
  // Not exposed in public version
}

export async function openPurchasePage(): Promise<void> {
  // Not exposed in public version
}

export async function validateLicenseInBackground(): Promise<void> {
  // No-op in public version
}
