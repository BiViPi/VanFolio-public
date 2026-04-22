import type { Capability } from '@shared/types'

const PUBLIC_CAPABILITIES: Capability[] = [
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

export async function getCapabilities(): Promise<Capability[]> {
  return [...PUBLIC_CAPABILITIES]
}

export async function hasCapability(_cap: string): Promise<boolean> {
  return true
}

export function initLicenseGate(): void {
  document.body.setAttribute('data-watermark-enabled', 'false')
}
