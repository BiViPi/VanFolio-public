import type { FontMeta } from '@shared/types'

let customFonts: FontMeta[] = []

function getStyleEl(): HTMLStyleElement {
  let styleEl = document.getElementById('custom-fonts') as HTMLStyleElement | null
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = 'custom-fonts'
    document.head.appendChild(styleEl)
  }
  return styleEl
}

function dispatchRefresh(): void {
  window.dispatchEvent(new CustomEvent('fontLibrary:updated'))
}

async function rebuildRuntimeCss(fonts: FontMeta[]): Promise<void> {
  const blocks = await Promise.all(fonts.map(async (font) => {
    const base64 = await window.vanfolioAPI.readFontBase64(font.path)
    if (!base64) return ''
    return [
      '@font-face {',
      `  font-family: '${font.family.replace(/'/g, "\\'")}';`,
      `  src: url(data:font/${font.format === 'truetype' ? 'ttf' : 'otf'};base64,${base64}) format('${font.format}');`,
      '  font-weight: 400;',
      '  font-style: normal;',
      '  font-display: swap;',
      '}',
    ].join('\n')
  }))
  getStyleEl().textContent = blocks.filter(Boolean).join('\n\n')
}

export async function refreshCustomFonts(): Promise<void> {
  customFonts = await window.vanfolioAPI.listCustomFonts()
  await rebuildRuntimeCss(customFonts)
  dispatchRefresh()
}

export async function initFontLibrary(): Promise<void> {
  await refreshCustomFonts()
}

export function getCustomFonts(): FontMeta[] {
  return [...customFonts]
}

export function getCustomFontOptions(): Array<{ value: string; label: string }> {
  return customFonts.map((font) => ({ value: font.family, label: font.family }))
}

export async function addFontsFromPicker(): Promise<number> {
  const paths = await window.vanfolioAPI.pickFontFiles()
  if (!paths.length) return 0
  let imported = 0
  for (const sourcePath of paths) {
    const result = await window.vanfolioAPI.importFont(sourcePath)
    if (result) imported += 1
  }
  await refreshCustomFonts()
  return imported
}

export async function removeCustomFont(fontId: string): Promise<void> {
  const ok = await window.vanfolioAPI.removeCustomFont(fontId)
  if (!ok) throw new Error('Failed to remove font')
  await refreshCustomFonts()
}
