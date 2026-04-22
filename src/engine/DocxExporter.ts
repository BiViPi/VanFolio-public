// ─────────────────────────────────────────────────────────────────────────────
// DocxExporter — Bundled into MAIN process
// Sprint 4 (S4-3): html-to-docx + _fixOoxmlCompat via jszip
// Mermaid (S4-M) & KaTeX (S4-K) support ported from markdown-folio
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import log from 'electron-log/main'
import katex from 'katex'
import type { ExportOptions, ExportResult } from '@shared/types'
import { launchBrowser } from '../main/puppeteerHelper'
import { MathMlToOmml } from './MathMlToOmml'

type OmmlMap = Map<number, { omml: string; isDisplay: boolean }>

// Paper size dimensions in twips (twentieths of a point) — standard OOXML units
const PAGE_SIZES: Record<string, { width: number; height: number }> = {
  A4: { width: 11906, height: 16838 },
  A3: { width: 16838, height: 23811 },
  Letter: { width: 12240, height: 15840 },
}

export class DocxExporter {
  /**
   * Export HTML content to DOCX via html-to-docx.
   * @param html       DOCX-friendly HTML (from HtmlBuilder.buildDocxHtml)
   * @param options    Original export options
   * @param outputPath Absolute path to write the .docx file
   */
  static async export(html: string, options: ExportOptions, outputPath: string): Promise<ExportResult> {
    try {
      // 1. Preprocess: Mermaid -> PNG, KaTeX -> OMML Markers
      log.info('[DocxExporter] Preprocessing HTML (Mermaid & KaTeX)...')
      const { processed, ommlMap } = await this._preprocess(html)

      // 2. Import html-to-docx
      log.info('[DocxExporter] Attempting to import html-to-docx...')
      const { default: htmlToDocx } = await import('html-to-docx') as { default: (html: string, headerHtml: null, opts: Record<string, unknown>) => Promise<Buffer | ArrayBuffer | Blob> }

      const paperSize = options.paperSize ?? 'A4'
      const dims = PAGE_SIZES[paperSize] ?? PAGE_SIZES.A4
      const isLandscape = options.orientation === 'landscape'

      const docxBuffer = await htmlToDocx(processed, null, {
        table: { row: { cantSplit: true } },
        footer: options.includePageNumbers === true,
        pageNumber: options.includePageNumbers === true,
        pageSize: {
          width: isLandscape ? dims.height : dims.width,
          height: isLandscape ? dims.width : dims.height,
        },
        margins: {
          top: 1440,    // 1 inch
          right: 1440,
          bottom: 1440,
          left: 1440,
        },
      })

      // Convert to Buffer regardless of what html-to-docx returns
      let buffer: Buffer
      if (Buffer.isBuffer(docxBuffer)) {
        buffer = docxBuffer
      } else if (docxBuffer instanceof ArrayBuffer) {
        buffer = Buffer.from(docxBuffer)
      } else {
        buffer = Buffer.from(await (docxBuffer as Blob).arrayBuffer())
      }

      // ⚠️ REQUIRED — Word 365 rejects file if this patch is skipped
      // Pass 'html' to scan for font definitions
      const patched = await this._fixOoxmlCompat(buffer, ommlMap, html)

      await fs.writeFile(outputPath, patched)
      log.info('[DocxExporter] DOCX written to:', outputPath)
      return { success: true, path: outputPath }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[DocxExporter] Export failed:', message)
      log.error('[DocxExporter] Stack:', err instanceof Error ? err.stack : 'no stack')
      return { success: false, error: message }
    }
  }

  // ── OOXML Compatibility Patch ─────────────────────────────────────────────
  // ⚠️ REQUIRED — Word 365 rejects file if missing
  private static async _fixOoxmlCompat(buffer: Buffer, ommlMap: OmmlMap, originalHtml: string): Promise<Buffer> {
    try {
      const JSZip = (await import('jszip')).default
      const zip = await JSZip.loadAsync(buffer)

      // 1. Read and patch [Content_Types].xml
      const ctFile = zip.file('[Content_Types].xml')
      if (ctFile) {
        let ctXml = await ctFile.async('string')
        const requiredOverrides: Array<{ partName: string; contentType: string }> = [
          { partName: '/word/document.xml', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml' },
          { partName: '/word/styles.xml', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml' },
          { partName: '/word/settings.xml', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml' },
          { partName: '/word/webSettings.xml', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.webSettings+xml' },
        ]
        for (const override of requiredOverrides) {
          const zipEntry = zip.file(override.partName.replace(/^\//, ''))
          if (zipEntry && !ctXml.includes(`PartName="${override.partName}"`)) {
            const entry = `<Override PartName="${override.partName}" ContentType="${override.contentType}"/>`
            ctXml = ctXml.replace('</Types>', `  ${entry}\n</Types>`)
          }
        }
        zip.file('[Content_Types].xml', ctXml)
      }

      // 1.5 Patch word/fontTable.xml to include custom fonts
      await this._patchFontTable(zip, originalHtml)

      // 2. Patch word/document.xml
      const docFile = zip.file('word/document.xml')
      if (docFile) {
        let docXml = await docFile.async('string')

        // Fix: w:conformance="transitional"
        if (!docXml.includes('w:conformance')) {
          docXml = docXml.replace('<w:document ', '<w:document w:conformance="transitional" ')
        }

        // Fix: xmlns:ve → xmlns:mc
        docXml = docXml.replace(
          'xmlns:ve="http://schemas.openxmlformats.org/markup-compatibility/2006"',
          'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"'
        )
        docXml = docXml.replace(/\bve:/g, 'mc:')

        // Fix: Move <w:sectPr> from start to end of <w:body>
        const sectPrRegex = /(<w:body>)\s*(<w:sectPr[\s\S]*?<\/w:sectPr>)\s*/
        const sectPrMatch = docXml.match(sectPrRegex)
        if (sectPrMatch) {
          const sectPr = sectPrMatch[2]
          docXml = docXml.replace(sectPrRegex, '$1\n')
          docXml = docXml.replace('</w:body>', `  ${sectPr}\n</w:body>`)
        }

        // Fix: Strip "undefined" attributes
        docXml = docXml.replace(/\s+\w+:\w+="undefined"/g, '')

        // Fix: Images dimensions
        const relsFile = zip.file('word/_rels/document.xml.rels')
        if (relsFile) {
          const relsXml = await relsFile.async('string')
          const rIdToFile = new Map<string, string>()
          const relRe = /Id="(rId\d+)"[^>]*Type="[^"]*\/image"[^>]*Target="([^"]+)"/g
          let rm: RegExpExecArray | null
          while ((rm = relRe.exec(relsXml)) !== null) { rIdToFile.set(rm[1], rm[2]) }

          const rIdToDims = new Map<string, { cx: number; cy: number }>()
          for (const [rId, imgPath] of rIdToFile) {
            const imgFile = zip.file(`word/${imgPath}`)
            if (!imgFile) continue
            const imgBuf = await imgFile.async('nodebuffer')
            if (imgBuf[0] === 0x89 && imgBuf[1] === 0x50) {
              const w = imgBuf.readUInt32BE(16)
              const h = imgBuf.readUInt32BE(20)
              rIdToDims.set(rId, { cx: w * 9525, cy: h * 9525 })
            }
          }

          docXml = docXml.replace(/<w:drawing>[\s\S]*?<\/w:drawing>/g, (drawingXml) => {
            const blipM = drawingXml.match(/r:embed="(rId\d+)"/)
            if (!blipM) return drawingXml
            const dims = rIdToDims.get(blipM[1])
            if (!dims) return drawingXml
            return drawingXml
              .replace('<wp:extent/>', `<wp:extent cx="${dims.cx}" cy="${dims.cy}"/>`)
              .replace('<a:ext/>', `<a:ext cx="${dims.cx}" cy="${dims.cy}"/>`)
          })
        }

        // Fix: Inject OMML formulas
        if (ommlMap.size > 0) {
          if (!docXml.includes('xmlns:m=')) {
            docXml = docXml.replace(
              '<w:document ',
              '<w:document xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" '
            )
          }
          for (const [id, { omml, isDisplay }] of ommlMap) {
            docXml = this._injectOmml(docXml, `OMML_MARKER_${id}`, omml, isDisplay)
          }
        }

        zip.file('word/document.xml', docXml)
      }

      // 3. Patch word/settings.xml
      const settingsFile = zip.file('word/settings.xml')
      if (settingsFile) {
        let settingsXml = await settingsFile.async('string')
        if (!settingsXml.includes('w:compat')) {
          const compatBlock = `<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>`
          settingsXml = settingsXml.replace('</w:settings>', `  ${compatBlock}\n</w:settings>`)
          zip.file('word/settings.xml', settingsXml)
        }
      }

      return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    } catch (err) {
      log.error('[DocxExporter] _fixOoxmlCompat failed:', err)
      return buffer
    }
  }

  /**
   * Scans HTML for font-family names and injects them into word/fontTable.xml
   * This is critical for Word to recognize and apply non-standard fonts.
   */
  private static async _patchFontTable(zip: any, html: string): Promise<void> {
    try {
      const fontFile = zip.file('word/fontTable.xml')
      if (!fontFile) return
      let fontXml = await fontFile.async('string')

      // Find font families in CSS or HTML attributes
      // e.g. font-family: 'Marko One';
      const fontRegex = /font-family:\s*['"]?([^'";,]+)['"]?/gi
      const foundFonts = new Set<string>()
      let m: RegExpExecArray | null
      while ((m = fontRegex.exec(html)) !== null) {
        const name = m[1].trim()
        if (name && !['Calibri', 'Arial', 'sans-serif', 'serif', 'monospace', 'inherit'].includes(name)) {
          foundFonts.add(name)
        }
      }

      if (foundFonts.size === 0) return
      log.info(`[DocxExporter] Patching fontTable.xml with: ${Array.from(foundFonts).join(', ')}`)

      for (const fontName of foundFonts) {
        if (!fontXml.includes(`w:name="${fontName}"`)) {
          // Construct entry (minimalist for compatibility)
          const entry = `
  <w:font w:name="${fontName}">
    <w:panose1 w:val="020B0604020202020204"/>
    <w:charset w:val="00"/>
    <w:family w:val="roman"/>
    <w:pitch w:val="variable"/>
    <w:sig w:usb0="E00002FF" w:usb1="40000000" w:usb2="00000000" w:usb3="00000000" w:csb0="000001FF" w:csb1="00000000"/>
  </w:font>`
          fontXml = fontXml.replace('</w:fonts>', `${entry}\n</w:fonts>`)
        }
      }

      zip.file('word/fontTable.xml', fontXml)
    } catch (err) {
      log.warn('[DocxExporter] _patchFontTable failed:', err)
    }
  }

  // ── Preprocessing & Injection ─────────────────────────────────────────────

  private static async _preprocess(html: string): Promise<{ processed: string; ommlMap: OmmlMap }> {
    let processed = html
    processed = await this._replaceMermaidWithImages(processed)
    const { processed: withMarkers, ommlMap } = this._replaceKatexWithOmml(processed)
    return { processed: withMarkers, ommlMap }
  }

  private static _replaceKatexWithOmml(html: string): { processed: string; ommlMap: OmmlMap } {
    const ommlMap: OmmlMap = new Map()
    const entries: { start: number; end: number; id: number; omml: string; isDisplay: boolean }[] = []
    let nextId = 0
    let i = 0

    while (i < html.length) {
      const spanStart = html.indexOf('<span', i)
      if (spanStart === -1) break
      const tagEnd = html.indexOf('>', spanStart)
      if (tagEnd === -1) break
      const openTag = html.slice(spanStart, tagEnd + 1)

      if (/class="[^"]*\bkatex\b/.test(openTag) &&
        !/class="[^"]*katex-html/.test(openTag) &&
        !/class="[^"]*katex-mathml/.test(openTag)) {

        const isDisplay = /class="[^"]*katex-display/.test(openTag)
        let depth = 1, j = tagEnd + 1
        while (j < html.length && depth > 0) {
          const nextOpen = html.indexOf('<span', j)
          const nextClose = html.indexOf('</span>', j)
          if (nextClose === -1) { j = html.length; break }
          if (nextOpen !== -1 && nextOpen < nextClose) { depth++; j = nextOpen + 5 }
          else { depth--; j = nextClose + 7 }
        }

        const spanContent = html.slice(spanStart, j)
        const annoMatch = spanContent.match(/<annotation[^>]*encoding="application\/x-tex"[^>]*>([\s\S]*?)<\/annotation>/)

        if (annoMatch) {
          const latex = annoMatch[1].trim()
          let omml = ''
          try {
            const mmlResult = katex.renderToString(latex, { output: 'mathml', throwOnError: false })
            omml = MathMlToOmml.convert(mmlResult)
          } catch { /* skip */ }
          const id = nextId++
          entries.push({ start: spanStart, end: j, id, omml, isDisplay })
          ommlMap.set(id, { omml, isDisplay })
        }
        i = j
      } else {
        i = tagEnd + 1
      }
    }

    if (entries.length === 0) return { processed: html, ommlMap }

    let processed = html
    for (let k = entries.length - 1; k >= 0; k--) {
      const { start, end, id, isDisplay } = entries[k]
      const marker = `OMML_MARKER_${id}`
      const replacement = isDisplay
        ? `<p><code>${marker}</code></p>`
        : `<code>${marker}</code>`
      processed = processed.slice(0, start) + replacement + processed.slice(end)
    }
    return { processed, ommlMap }
  }

  private static _injectOmml(xml: string, marker: string, omml: string, isDisplay: boolean): string {
    const markerIdx = xml.indexOf(marker)
    if (markerIdx === -1) return xml

    if (isDisplay) {
      const before = xml.slice(0, markerIdx)
      const pStart = Math.max(before.lastIndexOf('<w:p>'), before.lastIndexOf('<w:p '))
      const pEnd = xml.indexOf('</w:p>', markerIdx) + 6
      if (pStart === -1 || pEnd < 6) return xml
      const replacement = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><m:oMathPara><m:oMath>${omml}</m:oMath></m:oMathPara></w:p>`
      return xml.slice(0, pStart) + replacement + xml.slice(pEnd)
    } else {
      const before = xml.slice(0, markerIdx)
      const rStart = Math.max(before.lastIndexOf('<w:r>'), before.lastIndexOf('<w:r '))
      const rEnd = xml.indexOf('</w:r>', markerIdx) + 6
      if (rStart === -1 || rEnd < 6) return xml
      return xml.slice(0, rStart) + `<m:oMath>${omml}</m:oMath>` + xml.slice(rEnd)
    }
  }

  static async _replaceMermaidWithImages(html: string): Promise<string> {
    // Revert to non-spanning regex from reference mf-extension to avoid eating multiple blocks.
    // Group 1: content within <pre>...<code>...</code></pre>
    // Group 2: content within <div class="mermaid">...</div>
    const blockRegex = /(?:<pre[^>]*>\s*<code[^>]*class\s*=\s*["'][^"']*\bmermaid\b[^"']*["'][^>]*>([\s\S]*?)<\/code>\s*<\/pre>)|(?:<div[^>]*class\s*=\s*["'][^"']*\bmermaid\b[^"']*["'][^>]*>([\s\S]*?)<\/div>)/gi
    const sources: string[] = []
    let m: RegExpExecArray | null
    while ((m = blockRegex.exec(html)) !== null) {
      sources.push((m[1] || m[2] || '').trim())
    }

    if (sources.length === 0) {
      log.info('[DocxExporter] No Mermaid diagrams found in HTML.')
      return html
    }

    log.info(`[DocxExporter] Found ${sources.length} Mermaid diagram(s). Rendering via Puppeteer...`)

    let browser: import('puppeteer-core').Browser | null = null
    const images: (string | null)[] = []

    try {
      browser = await launchBrowser()
      const { app } = await import('electron')
      const mermaidPath = join(app.getAppPath(), 'node_modules', 'mermaid', 'dist', 'mermaid.min.js').replace(/\\/g, '/')
      log.info(`[DocxExporter] Using mermaid.min.js from: ${mermaidPath}`)

      for (let i = 0; i < sources.length; i++) {
        const source = sources[i]

        const pageHtml = `<!DOCTYPE html><html><head><style>
                    body { margin: 0; padding: 8px; background: white; }
                    .mermaid { display: inline-block; }
                    .mermaid svg { display: block; max-width: 100%; height: auto; }
                </style></head><body>
                    <div class="mermaid">${source}</div>
                    <script src="file:///${mermaidPath}"><\/script>
                    <script>
                        window._done = false;
                        mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
                        mermaid.run({ querySelector: '.mermaid' })
                            .then(function() { window._done = true; })
                            .catch(function() { window._done = true; });
                    <\/script>
                </body></html>`

        const tmpFile = join(tmpdir(), `vf-mermaid-${Date.now()}-${i}.html`)
        writeFileSync(tmpFile, pageHtml, 'utf-8')

        const page = await browser.newPage()
        await page.setViewport({ width: 900, height: 600 })

        try {
          await page.goto(`file:///${tmpFile.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0' })
          await page.waitForFunction('window._done === true', { timeout: 15000 })

          const svgEl = await page.$('.mermaid svg')
          const captureEl = svgEl ?? await page.$('.mermaid')
          const bbox = captureEl ? await captureEl.boundingBox() : null

          if (bbox && bbox.width > 0 && bbox.height > 0) {
            const buf = await page.screenshot({
              type: 'png',
              clip: {
                x: Math.max(0, bbox.x),
                y: Math.max(0, bbox.y),
                width: Math.ceil(bbox.width),
                height: Math.ceil(bbox.height),
              },
            })
            images.push(`data:image/png;base64,${Buffer.from(buf).toString('base64')}`)
            log.info(`[DocxExporter] Mermaid diagram ${i + 1}/${sources.length} rendered successfully. Size: ${buf.length} bytes`)
          } else {
            log.warn(`[DocxExporter] Mermaid element not found or zero size for diagram ${i + 1}.`)
            images.push(null)
          }
        } catch (err) {
          log.error(`[DocxExporter] Error rendering Mermaid diagram ${i + 1}:`, err)
          images.push(null)
        } finally {
          await page.close()
          try { unlinkSync(tmpFile) } catch { /* ignore */ }
        }
      }
    } catch (err) {
      log.error('[DocxExporter] Mermaid browser launch failed:', err)
      return html
    } finally {
      if (browser) await browser.close()
    }

    let idx = 0
    blockRegex.lastIndex = 0
    const finalHtml = html.replace(blockRegex, () => {
      const imgSrc = images[idx++]
      if (imgSrc) {
        return `<img src="${imgSrc}" style="max-width:100%;display:block;margin:8px 0;">`
      } else {
        return '<p><em>[Mermaid Diagram Render Error]</em></p>'
      }
    })
    log.info(`[DocxExporter] Mermaid replacement complete. Html length: ${html.length} -> ${finalHtml.length}`)
    return finalHtml
  }
}
