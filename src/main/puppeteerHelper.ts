// ─────────────────────────────────────────────────────────────────────────────
// puppeteerHelper — Shared browser discovery + launch for PdfExporter / PngExporter
// Bundled into MAIN process
// Sprint 4 (S4-2): Detect local Chrome/Edge on Windows — avoids bundling Chromium
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync } from 'fs'
import { join } from 'path'
import log from 'electron-log/main'

// Windows search order: Chrome x64 → Chrome x86 → Edge x64 → Edge x86 → Chrome LOCALAPPDATA
const WINDOWS_CHROME_PATHS: string[] = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  join(process.env.LOCALAPPDATA ?? 'C:\\Users\\Default\\AppData\\Local', 'Google\\Chrome\\Application\\chrome.exe'),
]

/**
 * Returns the path to the first available local Chrome or Edge executable.
 * Returns null if none are found — caller should surface a user-facing error.
 */
export function getLocalChromePath(): string | null {
  for (const p of WINDOWS_CHROME_PATHS) {
    if (existsSync(p)) {
      log.info('[puppeteerHelper] Found browser at:', p)
      return p
    }
  }
  log.warn('[puppeteerHelper] No local Chrome/Edge found — searched:', WINDOWS_CHROME_PATHS)
  return null
}

/**
 * Launch a headless Puppeteer browser using the locally detected executable.
 * Throws a descriptive error if no browser is available so the caller can
 * return { success: false, error: message } to the renderer.
 */
export async function launchBrowser(): Promise<import('puppeteer-core').Browser> {
  const executablePath = getLocalChromePath()
  if (!executablePath) {
    throw new Error(
      'No local Chrome or Edge found. Please install Google Chrome or Microsoft Edge to use PDF/PNG export.'
    )
  }

  const puppeteer = await import('puppeteer-core')
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=none',
    ],
  })

  log.info('[puppeteerHelper] Browser launched:', executablePath)
  return browser
}
