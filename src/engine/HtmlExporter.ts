// ─────────────────────────────────────────────────────────────────────────────
// HtmlExporter — Bundled into MAIN process
// Sprint 4 (S4-4): HtmlBuilder.buildSelfContainedHtml() + write file
// ─────────────────────────────────────────────────────────────────────────────
//
// selfContained: true  → local images inlined as base64 data URLs (fully portable)
// selfContained: false → local images kept as file:/// paths (machine-local)
// embedCss: true (default) → CSS included in <style> block
// embedCss: false → bare HTML without styles (user's choice)

import { promises as fs } from 'fs'
import log from 'electron-log/main'
import { HtmlBuilder, type BuildOptions } from './HtmlBuilder'
import type { ExportOptions, ExportResult } from '@shared/types'

export class HtmlExporter {
  /**
   * Export self-contained HTML.
   * @param buildOptions Options for HtmlBuilder (markdown, html, filePath, settings)
   * @param options      Original ExportOptions (for embedCss, embedFonts, selfContained)
   * @param outputPath   Absolute path to write the .html file
   */
  static async export(
    buildOptions: BuildOptions,
    options: ExportOptions,
    outputPath: string
  ): Promise<ExportResult> {
    try {
      const html = await HtmlBuilder.buildSelfContainedHtml({
        ...buildOptions,
        embedFonts: options.embedFonts ?? false,
        selfContained: options.selfContained ?? true,
        embedCss: options.embedCss ?? true,
      })

      await fs.writeFile(outputPath, html, 'utf-8')
      log.info('[HtmlExporter] HTML written to:', outputPath)
      return { success: true, path: outputPath }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[HtmlExporter] Export failed:', message)
      return { success: false, error: message }
    }
  }
}
