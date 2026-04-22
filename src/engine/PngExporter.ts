// ─────────────────────────────────────────────────────────────────────────────
// PngExporter — Bundled into MAIN process (uses puppeteer-core)
// Sprint 4 (S4-2): Combined with PdfExporter — shared Puppeteer setup via puppeteerHelper
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ CRITICAL GOTCHA (G1): Windows path — same fix as PdfExporter
//   file:/// with 3 slashes + forward slashes

import { tmpdir } from 'os'
import { join } from 'path'
import { promises as fs } from 'fs'
import log from 'electron-log/main'
import { launchBrowser } from '../main/puppeteerHelper'
import type { ExportOptions, ExportResult } from '@shared/types'
import { PAPER_SIZES } from '@shared/types'

export class PngExporter {
  private static async renderMermaidOnPage(page: import('puppeteer-core').Page): Promise<void> {
    const mermaidPath = require.resolve('mermaid/dist/mermaid.min.js')
    await page.addScriptTag({ path: mermaidPath })

    await page.evaluate(async () => {
      const m = (window as any).mermaid
      if (!m) return

      const blocks = Array.from(
        document.querySelectorAll<HTMLElement>(
          'pre > code.language-mermaid, pre > code.lang-mermaid, pre > code[class*="mermaid"]',
        ),
      )
      if (blocks.length === 0) return

      m.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' })
      let seq = 0
      for (const code of blocks) {
        const pre = code.closest('pre') ?? code
        const source = (code.textContent ?? '').trim()
        if (!source) continue

        const host = document.createElement('div')
        host.className = 'mermaid'
        pre.replaceWith(host)

        try {
          const out = await m.render(`vf-png-mermaid-${seq++}`, source)
          host.innerHTML = out?.svg ?? ''
        } catch (err) {
          console.error('[PngExporter] Mermaid render failed:', err)
        }
      }
    })
  }

  /**
   * Export HTML content to PNG screenshot via Puppeteer.
   * @param html    Full export-ready HTML (from HtmlBuilder.buildPdfHtml)
   * @param options Original export options (for scale, transparentBg)
   * @param outputPath Absolute path to write the PNG file
   */
  static async export(html: string, options: ExportOptions, outputPath: string): Promise<ExportResult> {
    const tmpFile = join(tmpdir(), `vanfolio-png-${Date.now()}.html`)
    let browser: import('puppeteer-core').Browser | null = null

    try {
      // 1. Write HTML to temp file
      await fs.writeFile(tmpFile, html, 'utf-8')
      log.info('[PngExporter] Temp HTML written to:', tmpFile)

      // 2. Launch browser
      browser = await launchBrowser()
      const page = await browser.newPage()
      await page.emulateMediaType('screen')

      const paperSize = options.paperSize || 'A4'
      const orientation = options.orientation || 'portrait'
      const [pw, ph] = PAPER_SIZES[paperSize] || PAPER_SIZES['A4']
      const [pageW] = orientation === 'landscape' ? [ph, pw] : [pw, ph]

      // 3. Set initial viewport — will be resized after page load
      const scaleFactor = Number(options.scale ?? 2)
      await page.setViewport({
        width: pageW,
        height: 900,
        deviceScaleFactor: scaleFactor,
      })

      // 4. Load temp file
      // ⚠️ Windows path: must be file:/// with 3 slashes + forward slashes
      const fileUrl = `file:///${tmpFile.replace(/\\/g, '/')}`
      await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30_000 })
      await this.renderMermaidOnPage(page)
      await page.waitForTimeout(120)

      // 4b. Resize viewport to actual content height (avoids cropping long documents)
      const bodyHeight = await page.evaluate(() => document.body.scrollHeight)
      await page.setViewport({ width: pageW, height: bodyHeight, deviceScaleFactor: scaleFactor })

      // 5. Screenshot full page (Workstation Snapshot)
      await page.screenshot({
        path: outputPath,
        fullPage: true,
        omitBackground: options.transparentBg ?? false,
        type: 'png',
      })

      log.info('[PngExporter] PNG written to:', outputPath)
      return { success: true, path: outputPath }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[PngExporter] Export failed:', message)
      return { success: false, error: message }
    } finally {
      if (browser) {
        try { await browser.close() } catch { /* ignore cleanup errors */ }
      }
      try { await fs.unlink(tmpFile) } catch { /* ignore if file doesn't exist */ }
    }
  }

  /**
   * Export each A4 page as a separate PNG file.
   * Uses .preview-page elements to determine clip regions.
   * @param html      Full export-ready HTML (from HtmlBuilder.buildPdfHtml)
   * @param options   Export options (scale, transparentBg)
   * @param outputDir Directory to write page-01.png, page-02.png, ...
   */
  static async exportPerPage(
    html: string,
    options: ExportOptions,
    outputDir: string,
  ): Promise<ExportResult> {
    const tmpFile = join(tmpdir(), `vanfolio-png-pp-${Date.now()}.html`)
    let browser: import('puppeteer-core').Browser | null = null

    try {
      await fs.writeFile(tmpFile, html, 'utf-8')
      log.info('[PngExporter] Per-page temp HTML written to:', tmpFile)

      browser = await launchBrowser()
      const page = await browser.newPage()

      const scaleFactor = Number(options.scale ?? 2)

      const paperSize = options.paperSize || 'A4'
      const orientation = options.orientation || 'portrait'
      const [pw, ph] = PAPER_SIZES[paperSize] || PAPER_SIZES['A4']
      const [PAGE_W, PAGE_H] = orientation === 'landscape' ? [ph, pw] : [pw, ph]

      // Match the preview page viewport, then capture each rendered .preview-page.
      await page.setViewport({ width: PAGE_W, height: PAGE_H, deviceScaleFactor: scaleFactor })
      const fileUrl = `file:///${tmpFile.replace(/\\/g, '/')}`
      await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30_000 })
      await this.renderMermaidOnPage(page)
      await page.evaluate(async () => {
        if ('fonts' in document) {
          await document.fonts.ready
        }
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      })

      const pageMetrics = await page.evaluate(() => {
        return Array.from(document.querySelectorAll<HTMLElement>('.preview-page')).map((el, index) => {
          const rect = el.getBoundingClientRect()
          return {
            index: index + 1,
            x: Math.max(0, Math.round(rect.left)),
            y: Math.max(0, Math.round(rect.top)),
            width: Math.max(1, Math.round(rect.width)),
            height: Math.max(1, Math.round(rect.height)),
            classes: el.className,
          }
        })
      })

      if (pageMetrics.length === 0) {
        throw new Error('PNG_PER_PAGE_NO_PREVIEW_PAGES')
      }

      const totalPages = pageMetrics.length
      log.info('[PngExporter] Per-page metrics:', pageMetrics)

      // Ensure output directory exists
      await fs.mkdir(outputDir, { recursive: true })

      const exportedPaths: string[] = []

      for (const metric of pageMetrics) {
        const pageNum = String(metric.index).padStart(2, '0')
        const outPath = join(outputDir, `page-${pageNum}.png`)

        await page.screenshot({
          path: outPath,
          clip: {
            x: metric.x,
            y: metric.y,
            width: metric.width,
            height: metric.height,
          },
          captureBeyondViewport: true,
          omitBackground: options.transparentBg ?? false,
          type: 'png',
        })

        exportedPaths.push(outPath)
        log.info(`[PngExporter] Per-page: wrote page-${pageNum}.png`)
      }

      log.info(`[PngExporter] Per-page complete: ${totalPages} pages → ${outputDir}`)
      return { success: true, path: outputDir }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[PngExporter] Per-page export failed:', message)
      return { success: false, error: message }
    } finally {
      if (browser) {
        try { await browser.close() } catch { /* ignore cleanup errors */ }
      }
      try { await fs.unlink(tmpFile) } catch { /* ignore if file doesn't exist */ }
    }
  }
}
