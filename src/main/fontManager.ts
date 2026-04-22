import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { basename, extname, join, resolve } from 'path'
import type { FontMeta } from '@shared/types'

const FONT_DIR = '.vanfolio/fonts'
async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizePath(input: string): string {
  return resolve(input)
}

function getFontsDir(vaultPath: string): string {
  return join(normalizePath(vaultPath), FONT_DIR)
}

function detectFormat(fileName: string): FontMeta['format'] | null {
  const ext = extname(fileName).toLowerCase()
  if (ext === '.ttf') return 'truetype'
  if (ext === '.otf') return 'opentype'
  return null
}

function familyFromFileName(fileName: string): string {
  // 1. Remove extension
  const base = basename(fileName, extname(fileName))
  // 2. Remove common weight/style suffixes (e.g. -Bold, -Regular)
  const raw = base.replace(/[-_](thin|extralight|light|regular|book|medium|semibold|demibold|bold|extrabold|black|italic|oblique|bolditalic|boldoblique)$/i, '')
  // 3. Convert CamelCase to Space Case (if no spaces/dashes exist)
  // e.g. "MarkoOne" -> "Marko One"
  // But don't mess with it if it already has spaces/dashes
  let formatted = raw
  if (!/[-_\s]/.test(raw)) {
    formatted = raw.replace(/([a-z])([A-Z])/g, '$1 $2')
  }
  // 4. Finally replace dashes/underscores with spaces
  return formatted.replace(/[-_]+/g, ' ').trim() || base
}

async function ensureFontsDir(vaultPath: string): Promise<string> {
  const dir = getFontsDir(vaultPath)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

function toFontMeta(fileName: string, vaultPath: string): FontMeta | null {
  const format = detectFormat(fileName)
  if (!format) return null
  const path = join(getFontsDir(vaultPath), fileName)
  return {
    id: createHash('sha1').update(fileName).digest('hex').slice(0, 12),
    family: familyFromFileName(fileName),
    fileName,
    format,
    path,
  }
}

export async function importFont(sourcePath: string, vaultPath: string): Promise<FontMeta | null> {
  const format = detectFormat(sourcePath)
  if (!format) return null

  const fontDir = await ensureFontsDir(vaultPath)
  const ext = extname(sourcePath).toLowerCase()
  const base = basename(sourcePath, ext)
  let fileName = `${base}${ext}`
  let destination = join(fontDir, fileName)
  let counter = 1

  while (await fileExists(destination)) {
    fileName = `${base}-${counter}${ext}`
    destination = join(fontDir, fileName)
    counter += 1
  }

  await fs.copyFile(sourcePath, destination)
  return toFontMeta(fileName, vaultPath)
}

export async function listFonts(vaultPath: string): Promise<FontMeta[]> {
  const fontDir = await ensureFontsDir(vaultPath)
  let entries: string[] = []
  try {
    entries = await fs.readdir(fontDir)
  } catch {
    return []
  }

  return entries
    .map((fileName) => toFontMeta(fileName, vaultPath))
    .filter((font): font is FontMeta => Boolean(font))
    .sort((a, b) => a.family.localeCompare(b.family) || a.fileName.localeCompare(b.fileName))
}

export async function removeFont(fontId: string, vaultPath: string): Promise<boolean> {
  const fonts = await listFonts(vaultPath)
  const font = fonts.find((entry) => entry.id === fontId)
  if (!font) {
    console.error(`[fontManager] removeFont failed: Font ID ${fontId} not found in vault ${vaultPath}`)
    return false
  }

  // Windows Retry Logic (GDRIVE/OS Sync locking)
  let attempts = 0
  while (attempts < 3) {
    try {
      await fs.unlink(font.path)
      return true
    } catch (err: any) {
      if (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES') {
        attempts++
        console.warn(`[fontManager] font busy, retry ${attempts}/3 for ${font.fileName}...`)
        await delay(300)
        continue
      }
      console.error(`[fontManager] removeFont failed for ${font.fileName}:`, err.code, err.message)
      return false
    }
  }
  return false
}

export async function readFontAsBase64(fontPath: string): Promise<string | null> {
  try {
    const buffer = await fs.readFile(fontPath)
    return buffer.toString('base64')
  } catch {
    return null
  }
}

export async function buildCustomFontCss(vaultPath: string): Promise<string> {
  const fonts = await listFonts(vaultPath)
  const blocks = await Promise.all(fonts.map(async (font) => {
    const base64 = await readFontAsBase64(font.path)
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

  return blocks.filter(Boolean).join('\n')
}

export async function getCustomFontDebugInfo(vaultPath: string): Promise<Array<{
  family: string
  fileName: string
  format: FontMeta['format']
  path: string
  sizeBytes: number
}>> {
  const fonts = await listFonts(vaultPath)
  return Promise.all(fonts.map(async (font) => {
    let sizeBytes = 0
    try {
      const stat = await fs.stat(font.path)
      sizeBytes = stat.size
    } catch {
      sizeBytes = 0
    }
    return {
      family: font.family,
      fileName: font.fileName,
      format: font.format,
      path: font.path,
      sizeBytes,
    }
  }))
}
