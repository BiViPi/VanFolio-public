// ─────────────────────────────────────────────────────────────────────────────
// PdfExporter — Bundled into MAIN process (uses puppeteer-core, Node API)
// Sprint 4 (S4-2): Combined with PngExporter — shared Puppeteer setup via puppeteerHelper
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ CRITICAL GOTCHA (G1): Windows path bug
//   await page.goto(`file:///${tmpFile.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0' })
//   MUST use 3 slashes + forward slash — do NOT use path.join for this URL

import { tmpdir } from 'os'
import { join } from 'path'
import { promises as fs } from 'fs'
import log from 'electron-log/main'
import { launchBrowser } from '../main/puppeteerHelper'
import type { ExportOptions, ExportResult } from '@shared/types'

export class PdfExporter {
  /**
   * Export HTML content to PDF via Puppeteer.
   * @param html    Full export-ready HTML (from HtmlBuilder.buildPdfHtml)
   * @param options Original export options (for paperSize, orientation)
   * @param outputPath Absolute path to write the PDF file
   */
  static async export(html: string, options: ExportOptions, outputPath: string): Promise<ExportResult> {
    const tmpFile = join(tmpdir(), `vanfolio-pdf-${Date.now()}.html`)
    let browser: import('puppeteer-core').Browser | null = null

    try {
      // 1. Write HTML to temp file
      await fs.writeFile(tmpFile, html, 'utf-8')
      // 2. Launch browser
      browser = await launchBrowser()
      const page = await browser.newPage()
      // ⚠️ CRITICAL: match screen media to match the Renderer's view y hệt preview.
      await page.emulateMediaType('screen')

      // Determine if this is a WYSIWYG paginated export
      const isPaginated = /class\s*=\s*["'][^"']*\bpreview-page\b/i.test(html)
      const tokens = options.docTokens
      const pageW = tokens?.paperWidth || 816
      const pageH = tokens?.paperHeight || 1056

      // For WYSIWYG paginated mode: set viewport to EXACTLY match paper px dimensions
      // This guarantees 1px in preview == 1px in Puppeteer render
      if (isPaginated) {
        await page.setViewport({ width: Math.ceil(pageW), height: Math.ceil(pageH), deviceScaleFactor: 1 })
      }

      // 3. Load temp file
      // ⚠️ Windows path: must be file:/// with 3 slashes + forward slashes — do NOT use path.join
      const fileUrl = `file:///${tmpFile.replace(/\\/g, '/')}`
      await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30_000 })
      await page.evaluate(async () => {
        if ('fonts' in document) {
          await document.fonts.ready
        }
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      })

      const metrics = await page.evaluate(() => {
        const pages = Array.from(document.querySelectorAll<HTMLElement>('.preview-page'))
        return {
          fontStatus: 'fonts' in document ? document.fonts.status : 'unsupported',
          pageCount: pages.length,
          viewportMetrics: pages.slice(0, 2).map((page, index) => {
            const viewport = page.querySelector<HTMLElement>('.page-viewport')
            return {
              page: index + 1,
              clientHeight: viewport?.clientHeight ?? 0,
              scrollHeight: viewport?.scrollHeight ?? 0,
              textTail: viewport?.innerText?.trim().slice(-140) ?? '',
            }
          }),
        }
      })

      // 4. Export as PDF
      const paperSize = options.paperSize ?? 'A4'
      const isLandscape = options.orientation === 'landscape'

      if (isPaginated && tokens?.paperWidth && tokens?.paperHeight) {
        // WYSIWYG mode: use exact px dimensions via CSS @page override
        // This bypasses Puppeteer's own scale calculation and uses pixel-perfect layout
        await page.addStyleTag({
          content: `@page { size: ${pageW}px ${pageH}px; margin: 0 !important; }`
        })

        await page.pdf({
          path: outputPath,
          width: `${pageW}px`,
          height: `${pageH}px`,
          printBackground: true,
          outline: !!options.includeToc,
          margin: { top: '0', right: '0', bottom: '0', left: '0' },
        })
      } else {
        // Standard mode: use named paper size
        await page.pdf({
          path: outputPath,
          format: paperSize,
          landscape: isLandscape,
          printBackground: true,
          outline: !!options.includeToc,
          margin: { top: '0', right: '0', bottom: '0', left: '0' },
        })
      }

      return { success: true, path: outputPath }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[PdfExporter] Export failed:', message)
      return { success: false, error: message }
    } finally {
      if (browser) {
        try { await browser.close() } catch { /* ignore cleanup errors */ }
      }
      try { await fs.unlink(tmpFile) } catch { /* ignore if file doesn't exist */ }
    }
  }
}
