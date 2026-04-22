// ─────────────────────────────────────────────────────────────────────────────
// HtmlBuilder — Bundled into MAIN process
// Dependency of all exporters — must be complete before PDF/DOCX/PNG (Sprint 4, S4-1)
// Sprint 4 (S4-1): Full implementation — CSS inline, image path resolution, TOC, watermark
// ─────────────────────────────────────────────────────────────────────────────

import { dirname, resolve, basename, extname } from 'path'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { MarkdownEngine } from './MarkdownEngine'
import type { AppSettings, DocTokens } from '@shared/types'
import { PAPER_SIZES } from '@shared/types'

export interface BuildOptions {
  markdown: string
  html: string                // HTML already rendered by renderMarkdown()
  filePath: string            // Source .md path — to resolve relative images
  settings: Partial<AppSettings>
  includeToc?: boolean
  includePageNumbers?: boolean
  watermark?: string
  tocTitle?: string
  colorMode?: 'color' | 'bw'
  docTokens?: DocTokens
  visualToc?: boolean         // Whether to inject visual TOC block into HTML body
  transparent?: boolean       // Whether to use transparent background (PNG only)
  format?: 'pdf' | 'png' | 'html' | 'docx'
  customFontCss?: string
}

// ── Default Tokens & PDF Base CSS ──────────────────────────────────────────

const DEFAULT_DOC_TOKENS: DocTokens = {
  heading: '#775a00',
  accent: '#c59b27',
  text: '#1a1c1a',
  bg: '#fdfcfb',
  surface: '#ffffff',
  border: '#d1c5af',
  borderSubtle: 'rgba(0,0,0,0.08)',
  codeBg: '#efeeeb',
  marginTop: 76,
  marginRight: 83,
  marginBottom: 76,
  marginLeft: 83,
  // Metrics Defaults
  previewBaseFontSize: 15,
  previewLineHeight: 1.8,
  paperWidth: 794,
  paperHeight: 1123,
  previewFontFamily: "'Newsreader', 'Georgia', serif",
  previewHeadingFont: "'Newsreader', 'Georgia', serif",
  h1Size: "33.8px",
  h2Size: "22.5px",
  h3Size: "18.8px",
  h4Size: "16.5px",
  h5Size: "15px",
  paragraphSpacing: "0.8em",
  printBaseFontSize: "11pt",
  printLineHeight: "1.72",
  printMarginTop: "20mm",
  printMarginRight: "22mm",
  printMarginBottom: "20mm",
  printMarginLeft: "22mm",
  printH1Size: "25.2pt",
  printH2Size: "17pt",
  printH3Size: "13.8pt",
  printH4Size: "11pt",
  printH5Size: "10pt",
  printParagraphSpacing: "0.8em",
}

/**
 * Print-optimized CSS for PDF/PNG export (Puppeteer headless).
 * Uses --doc-* CSS vars — caller must inject :root { --doc-* } block before this.
 */
const EXPORT_PDF_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--font-preview, 'Newsreader', 'Georgia', serif);
  font-size: var(--print-base-size, 11pt) !important;
  line-height: var(--print-line-height, 1.72) !important;
}

/* Base doc wrapper styling */
.doc-wrapper {
  margin: 0 auto;
  box-sizing: border-box;
}
h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-heading, var(--font-preview, 'Newsreader', 'Georgia', serif));
  color: var(--doc-heading);
  margin: 1.5em 0 0.5em;
  line-height: 1.3;
}
h1 { font-size: var(--print-h1-size, 22pt); font-weight: 700; line-height: 1.2; border-bottom: 2px solid var(--doc-heading); padding-bottom: 0.3em; margin-top: 0; }
h2 { font-size: var(--print-h2-size, 17pt); font-weight: 700; border-bottom: 1px solid var(--doc-heading); padding-bottom: 0.2em; }
h3 { font-size: var(--print-h3-size, 13pt); }
h4 { font-size: var(--print-h4-size, 11pt); }
h5, h6 { font-size: var(--print-h5-size, 10pt); }
p { margin: var(--print-paragraph-spacing, 0.8em) 0; line-height: inherit; }
a { color: var(--doc-accent); text-decoration: underline; }
strong { font-weight: 700; }
em { font-style: italic; }
code {
  font-family: var(--font-mono, 'JetBrains Mono', 'Consolas', 'Courier New', monospace);
  background: var(--doc-code-bg);
  padding: 2px 5px;
  border-radius: 3px;
  font-size: 0.875em;
  color: var(--doc-accent);
}
pre {
  background: var(--doc-code-bg);
  border: 1px solid var(--doc-border-subtle);
  border-radius: 6px;
  padding: 14px 16px;
  overflow-x: auto;
  margin: 1em 0;
  page-break-inside: avoid;
}
pre code {
  background: none;
  padding: 0;
  font-size: 0.875em;
  color: var(--doc-heading, #1a1c1a);
}
blockquote {
  font-family: var(--font-preview);
  border-left: 4px solid var(--doc-accent);
  background: rgba(var(--doc-accent-rgb, 0,0,0), 0.05);
  padding: 14px 24px;
  color: inherit;
  margin: 1.5em 0;
  font-style: italic;
  border-radius: 2px;
  line-height: inherit;
}
ul, ol { margin: 1em 0; padding-left: 1.5em; }
li { margin-bottom: 0.4em; padding-left: 0.2em; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; page-break-inside: avoid; border: 1px solid var(--doc-heading); }
th, td { border: 1px solid var(--doc-heading); padding: 8px 12px; text-align: left; font-size: 11pt; }
th { background: var(--doc-code-bg); font-weight: 600; color: var(--doc-heading); }
img { max-width: 100%; height: auto; display: block; margin: 1em auto; }
hr { border: none; border-top: 1px solid var(--doc-heading); margin: 2em 0; }
.__pagebreak-sentinel__ { break-before: page; page-break-before: always; height: 0; margin: 0; padding: 0; border: none; }
.toc-section { margin-bottom: 2em; page-break-after: always; }
.toc-section h2 { font-size: 14pt; margin-bottom: 1em; }
.toc-list { list-style: none; padding: 0; }
.toc-item { margin: 0.3em 0; }
.toc-link { color: var(--doc-accent); text-decoration: none; font-size: 11pt; }
.toc-h2 .toc-link { padding-left: 1.2em; }
.toc-h3 .toc-link { padding-left: 2.4em; }
.toc-h4 .toc-link, .toc-h5 .toc-link, .toc-h6 .toc-link { padding-left: 3.6em; color: var(--doc-accent); }
`

// ─────────────────────────────────────────────────────────────────────────────

export class HtmlBuilder {
  // ── Markdown rendering ─────────────────────────────────────────────────────

  /**
   * Render markdown to HTML for export.
   */
  static renderMarkdown(markdown: string): string {
    const engine = new MarkdownEngine()
    return engine.render(markdown).html
  }

  // ── Public build API ───────────────────────────────────────────────────────

  /**
   * Build full HTML document for PDF/PNG export.
   */
  static async buildPdfHtml(options: BuildOptions): Promise<string> {
    const { html, filePath, includeToc, includePageNumbers, watermark, colorMode, docTokens, settings, transparent, customFontCss = '' } = options
    const isPaginated = this._containsPreviewPages(html)

    // Replace <!-- pagebreak --> markers with sentinel divs for PDF page breaking
    const htmlWithSentinels = html.replace(/<!--\s*pagebreak\s*-->/gi, '<div class="__pagebreak-sentinel__"></div>')
    const resolvedHtml = this._resolveImagePathsForPuppeteer(htmlWithSentinels, filePath)
    const tocHtml = includeToc ? this._buildTocSection(htmlWithSentinels, options.tocTitle) : ''
    const pageNumberCss = includePageNumbers ? this._pageNumberCss() : ''
    const watermarkCss = watermark ? this._watermarkCss(watermark) : ''
    const watermarkAttr = watermark ? ` data-watermark="${this._escapeAttr(watermark)}"` : ''
    const inlineFonts = this._getInlineFontsCss(settings)
    const fontImport = inlineFonts
      ? ''
      : `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,700;1,6..72,400&family=Merriweather:wght@400;700&display=swap">`

    const tokens = colorMode === 'bw' ? null : (docTokens || DEFAULT_DOC_TOKENS)
    const tokenCss = colorMode === 'bw' ? this._bwOverrideCss(settings) : this._docTokenCss(tokens!, settings)

    // Calculate background colors based on mode
    const isBW = colorMode === 'bw'
    const finalBg = isBW ? 'white' : (tokens?.bg || 'white')
    const finalSurface = isBW ? 'white' : (tokens?.surface || 'white')
    const exportCanvasBg = isPaginated ? finalSurface : finalBg

    // Paper dimension calculation (96 DPI)
    const paperSize = settings.paperSize || 'A4'
    const orientation = settings.paperOrientation || 'portrait'
    const [pwDefault, phDefault] = PAPER_SIZES[paperSize] || PAPER_SIZES['A4']
    const [pageWDefault, pageHDefault] = orientation === 'landscape' ? [phDefault, pwDefault] : [pwDefault, phDefault]

    // Use tokens for dimensions if available (WYSIWYG)
    const pageW = tokens?.paperWidth || pageWDefault
    const pageH = tokens?.paperHeight || pageHDefault

    // Theme-driven Atmosphere CSS
    let atmosphereCss = `
      html, body { 
        margin: 0; padding: 0; min-height: 100vh;
        background: #000000 !important; /* Global dark fallback */
        background: ${exportCanvasBg} !important; 
        background-size: cover; 
        background-attachment: fixed;
        color: ${isBW ? '#1a1c1a' : (tokens?.text || 'inherit')};
        -webkit-print-color-adjust: exact;
      }

      @page {
        size: ${paperSize} ${orientation};
        margin: ${isPaginated ? '0' : 'var(--print-margin-top, 20mm) var(--print-margin-right, 22mm) var(--print-margin-bottom, 20mm) var(--print-margin-left, 22mm)'};
      }

      .doc-wrapper {
        background: ${isPaginated ? 'transparent' : finalSurface} !important;
        max-width: ${isPaginated ? `${pageW}px` : '100%'};
        width: 100%;
        margin: 0 auto; 
        padding: ${isPaginated ? 'var(--print-margin-top, 20mm) var(--print-margin-right, 22mm) var(--print-margin-bottom, 20mm) var(--print-margin-left, 22mm)' : '0'};
        box-sizing: border-box;
        border: ${isBW || !isPaginated ? 'none' : `1px solid ${tokens?.borderSubtle || 'rgba(255,255,255,0.1)'}`} !important;
        box-shadow: ${isBW || !isPaginated ? 'none' : '0 10px 40px rgba(0,0,0,0.1)'} !important;
        min-height: ${isPaginated ? '100vh' : 'auto'};
      }
      
      /* Paginated WYSIWYG Mode (Legacy/PNG) */
      .preview-page {
        width: ${pageW}px !important;
        height: ${pageH}px !important;
        background: ${finalSurface} !important;
        position: relative;
        overflow: hidden;
        page-break-after: always;
        margin: 0 auto;
        border-radius: 0 !important;
        box-shadow: none !important;
        border: none !important;
      }
      .page-viewport {
        padding: var(--print-margin-top, 20mm) var(--print-margin-right, 22mm) var(--print-margin-bottom, 20mm) var(--print-margin-left, 22mm) !important;
        width: 100% !important;
        height: 100% !important;
        box-sizing: border-box !important;
        position: relative;
      }
      
      /* Chromium Truth: Automatic pagination helper */
      .chromium-truth-content {
        display: block;
        width: 100%;
      }

      /* Print specific break-logic */
      h1, h2, h3 { page-break-after: avoid; break-after: avoid; }
      pre, blockquote, table, img, .mermaid { page-break-inside: avoid; break-inside: avoid; }
      
      ${transparent ? 'body, .doc-wrapper, .preview-page { background: transparent !important; box-shadow: none !important; border: none !important; }' : ''}
    `

    // Resolve images for Snapshot Vibe (Content + Atmosphere)
    let resolvedCss = EXPORT_PDF_CSS
    if (isPaginated) {
      resolvedCss += `\n${this._getPreviewCss()}\n`
    }
    if (!isBW) {
      resolvedCss = await this._resolveCssImagesBase64(resolvedCss, filePath)
      atmosphereCss = await this._resolveCssImagesBase64(atmosphereCss, filePath)
    }

    return `<!DOCTYPE html>
<head>
  <meta charset="UTF-8">
  <title>${basename(filePath, extname(filePath)) || 'document'}</title>
  ${fontImport}
  <style>
${this._getKatexCss()}
${atmosphereCss}
${tokenCss}
${inlineFonts}
${customFontCss}
${resolvedCss}
${pageNumberCss}
${watermarkCss}
  </style>
</head>
<body${watermarkAttr} data-mode="${isPaginated ? 'paginated' : 'standard'}">
  <div class="doc-wrapper">
    ${isPaginated ? resolvedHtml : `<div class="chromium-truth-content">${options.includeToc && options.visualToc !== false ? tocHtml : ''}${resolvedHtml}</div>`}
  </div>
</body>
</html>`
  }

  /**
   * Build HTML for DOCX conversion.
   */
  static async buildDocxHtml(options: BuildOptions): Promise<string> {
    const { html, filePath, includeToc, docTokens, settings } = options
    const tokens = docTokens || DEFAULT_DOC_TOKENS

    const resolvedHtml = await this._resolveImagePathsBase64(html, filePath)
    const docxReadyHtml = this._inlineDocxFontStyles(resolvedHtml, tokens, settings)
    const tocHtml = includeToc ? this._inlineDocxFontStyles(this._buildTocSection(html, options.tocTitle), tokens, settings) : ''

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
${options.customFontCss || ''}
${this._buildDocxCss(tokens)}
  </style>
</head>
<body>
${tocHtml}
${docxReadyHtml}
</body>
</html>`
  }

  /**
   * Build self-contained HTML export.
   */
  static async buildSelfContainedHtml(
    options: BuildOptions & { embedFonts?: boolean; selfContained?: boolean; embedCss?: boolean }
  ): Promise<string> {
    const { html, filePath, includeToc, embedFonts = true, selfContained = true, embedCss = true, docTokens } = options
    const tokens = docTokens || DEFAULT_DOC_TOKENS

    const resolvedHtml = selfContained
      ? await this._resolveImagePathsBase64(html, filePath)
      : this._resolveImagePathsForPuppeteer(html, filePath)

    const tocHtml = includeToc ? this._buildTocSection(html, options.tocTitle) : ''

    const inlineFonts = embedFonts ? this._getInlineFontsCss(options.settings) : ''
    const fontImport = (embedFonts && !inlineFonts)
      ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,700;1,6..72,400&family=Merriweather:wght@400;700&display=swap">\n  `
      : ''

    const katexCss = this._getKatexCss()
    const rawCss = `${katexCss}\n${inlineFonts}\n${options.customFontCss || ''}\n${this._buildHtmlCss(tokens, options.settings)}`

    const styleBlock = embedCss
      ? `<style>\n${rawCss}\n  </style>`
      : ''

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${basename(filePath, extname(filePath)) || 'document'}</title>
  ${fontImport}${styleBlock}
</head>
<body>
<div class="app-container">
  ${tocHtml ? `<aside class="sidebar-toc"><div class="sidebar-inner">${tocHtml}</div></aside>` : ''}
  <main class="content-wrapper">
    <div class="doc-wrapper">
      ${resolvedHtml}
    </div>
  </main>
</div>
</body>
</html>`
  }

  // ── Private CSS Builders ──────────────────────────────────────────────────

  private static _buildHtmlCss(tokens: DocTokens, settings: Partial<AppSettings>): string {
    const fontBody = settings.previewFontFamily || 'Newsreader'
    const fontHeader = settings.previewHeadingFont || fontBody
    const fontCode = this._fontStack(settings.codeFontFamily || 'JetBrains Mono', "'JetBrains Mono', 'Consolas', 'Courier New', monospace")
    const bodyStack = this._fontStack(fontBody, "'Georgia', serif")
    const headingStack = this._fontStack(fontHeader, bodyStack)
    const lineH = settings.previewLineHeight ?? tokens.previewLineHeight ?? 1.8
    const paragraphSpacing = Number.isFinite(settings.paragraphSpacing)
      ? `${settings.paragraphSpacing}em`
      : (tokens.paragraphSpacing || '0.8em')

    return `
* { box-sizing: border-box; }
:root {
  --font-mono: ${fontCode};
}
body {
  font-family: ${bodyStack};
  font-size: 15px;
  line-height: ${lineH};
  color: ${tokens.text};
  background: ${tokens.bg};
  margin: 0;
  padding: 0;
}
.app-container {
  display: flex;
  min-height: 100vh;
}
.sidebar-toc {
  width: 300px;
  background: ${tokens.surface};
  border-right: 1px solid ${tokens.borderSubtle};
  padding: 60px 30px;
  position: sticky;
  top: 0;
  height: 100vh;
  flex-shrink: 0;
}
.sidebar-inner h2 {
  font-size: 1.1em !important;
  margin-top: 0 !important;
  text-transform: uppercase;
  color: ${tokens.accent};
  letter-spacing: 0.05em;
  border-bottom: 2px solid ${tokens.accent} !important;
  padding-bottom: 10px;
}
.sidebar-inner ul {
  padding-left: 0;
  list-style: none;
}
.sidebar-inner li {
  margin: 10px 0;
  font-size: 0.95em;
  line-height: 1.4;
}
.toc-h1 { font-weight: 700; margin-top: 1.5em !important; }
.toc-h2 { margin-left: 0; }
.toc-h3 { margin-left: 15px; font-size: 0.9em; opacity: 0.9; }
.toc-h4 { margin-left: 30px; font-size: 0.85em; opacity: 0.8; }
.sidebar-inner a {
  text-decoration: none;
  color: ${tokens.text};
  opacity: 0.7;
  transition: all 0.2s;
}
.sidebar-inner a:hover {
  color: ${tokens.accent};
  opacity: 1;
}
.content-wrapper {
  flex: 1;
  padding: 60px 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.doc-wrapper {
  max-width: 820px;
  width: 100%;
  margin: 0 auto;
  background: ${tokens.surface};
  padding: 80px 96px;
  box-shadow: 0 4px 30px rgba(0,0,0,0.08); /* Lighter shadow for mobile/web performance */
  border-radius: 8px;
  border: 1px solid ${tokens.borderSubtle};
  color: ${tokens.text};
}
@media (max-width: 1100px) {
  .app-container { flex-direction: column; }
  .sidebar-toc { 
    width: 100%; 
    height: auto; 
    position: static; 
    border-right: none; 
    border-bottom: 1px solid ${tokens.borderSubtle}; 
    padding: 30px 20px;
  }
  .content-wrapper { padding: 30px 10px; }
}
h1, h2, h3, h4, h5, h6 {
  font-family: ${headingStack};
  color: ${tokens.heading};
  margin: 1.5em 0 0.5em;
  line-height: 1.3;
}
h1 { font-size: 2.25em; border-bottom: 2px solid ${tokens.border}; padding-bottom: 0.3em; margin-top: 0; }
h2 { font-size: 1.5em; border-bottom: 1px solid ${tokens.borderSubtle}; padding-bottom: 0.2em; }
h3 { font-size: 1.25em; }
h4, h5, h6 { font-size: 1.1em; }
p { margin: ${paragraphSpacing} 0; line-height: inherit; }
a { color: ${tokens.accent}; text-decoration: underline; }
code {
  font-family: var(--font-mono, 'JetBrains Mono', 'Consolas', 'Courier New', monospace);
  background: ${tokens.codeBg};
  padding: 2px 5px;
  border-radius: 3px;
  font-size: 0.875em;
  color: ${tokens.accent};
}
pre {
  background: ${tokens.codeBg};
  border: 1px solid ${tokens.borderSubtle};
  border-radius: 6px;
  padding: 16px;
  overflow-x: auto;
  margin: 1em 0;
}
pre code { background: none; padding: 0; font-size: 0.88em; color: inherit; }
blockquote {
  border-left: 3px solid ${tokens.accent};
  padding: 8px 20px;
  color: #4a4035; /* Soft charcoal brown */
  background: rgba(var(--s-primary-rgb, 212, 175, 55), 0.03);
  margin: 1.5em 0;
  font-style: italic;
  border-radius: 0 4px 4px 0;
}
ul, ol { margin: 0.75em 0; padding-left: 2em; }
li { margin: 0.3em 0; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { border: 1px solid ${tokens.border}; padding: 8px 12px; text-align: left; }
th { background: ${tokens.codeBg}; font-weight: 600; }
img { max-width: 100%; height: auto; display: block; margin: 1em auto; }
hr { border: none; border-top: 1px solid ${tokens.border}; margin: 2em 0; }
.toc-section { margin-bottom: 2em; padding-bottom: 1.5em; border-bottom: 2px solid ${tokens.border}; }
.toc-section h2 { font-size: 1.3em; margin-bottom: 0.75em; }
.toc-list { list-style: none; padding: 0; }
.toc-item { margin: 0.25em 0; }
.toc-link { color: ${tokens.accent}; text-decoration: none; font-size: 0.9em; }
.toc-link:hover { text-decoration: underline; }
.toc-h2 .toc-link { padding-left: 1.2em; }
.toc-h3 .toc-link { padding-left: 2.4em; }
.toc-h4 .toc-link, .toc-h5 .toc-link, .toc-h6 .toc-link { padding-left: 3.6em; color: #807663; }
`
  }

  private static _buildDocxCss(tokens: DocTokens): string {
    const mainFont = tokens.previewFontFamily || 'Calibri, Arial, sans-serif'
    const headingFont = tokens.previewHeadingFont || mainFont

    return `
body { font-family: ${mainFont}; font-size: ${tokens.printBaseFontSize || '11pt'}; color: ${tokens.text || '#1a1c1a'}; }
h1 { font-family: ${headingFont}; font-size: 20pt; color: ${tokens.heading}; }
h2 { font-family: ${headingFont}; font-size: 16pt; color: ${tokens.heading}; }
h3 { font-family: ${headingFont}; font-size: 13pt; color: ${tokens.heading}; }
h4, h5, h6 { font-family: ${headingFont}; font-size: 11pt; color: #4e4635; }
code { font-family: Consolas, monospace; background-color: rgba(27, 38, 59, 0.4); padding: 2px 4px; color: ${tokens.accent}; }
pre { background-color: ${tokens.codeBg}; padding: 12px; border: 1px solid ${tokens.borderSubtle}; }
blockquote { border-left: 3px solid ${tokens.accent}; padding-left: 12px; color: #4e4635; font-style: italic; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid ${tokens.border}; padding: 6px 10px; }
th { background-color: ${tokens.codeBg}; font-weight: bold; }
`
  }

  // ── Private image path helpers ─────────────────────────────────────────────


  private static _inlineDocxFontStyles(html: string, tokens: DocTokens, settings: Partial<AppSettings>): string {
    if (!html.trim()) return html

    const bodyFont = tokens.previewFontFamily || 'Calibri, Arial, sans-serif'
    const headingFont = tokens.previewHeadingFont || bodyFont
    const codeFont = this._fontStack(settings.codeFontFamily || 'Consolas', "'Courier New', monospace")

    let patched = html
    patched = this._applyInlineFontToTags(patched, ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'], headingFont)
    patched = this._applyInlineFontToTags(patched, ['code', 'pre'], codeFont)
    patched = this._applyInlineFontToTags(
      patched,
      ['p', 'div', 'span', 'li', 'blockquote', 'td', 'th', 'a', 'figcaption'],
      bodyFont
    )

    return patched
  }

  private static _applyInlineFontToTags(html: string, tags: string[], fontFamily: string): string {
    const escapedTags = tags.map((tag) => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    const tagRegex = new RegExp(`<(${escapedTags})(\\s[^>]*?)?>`, 'gi')

    return html.replace(tagRegex, (match, tagName: string, rawAttrs?: string) => {
      const attrs = rawAttrs || ''
      const styleMatch = attrs.match(/\sstyle=(['"])([\s\S]*?)\1/i)
      if (styleMatch) {
        if (/font-family\s*:/i.test(styleMatch[2])) return match
        const quote = styleMatch[1]
        const existingStyle = styleMatch[2].trim().replace(/;?\s*$/, ';')
        return match.replace(styleMatch[0], ` style=${quote}${existingStyle} font-family: ${fontFamily};${quote}`)
      }
      return `<${tagName}${attrs} style="font-family: ${fontFamily};">`
    })
  }

  private static _resolveImagePathsForPuppeteer(html: string, filePath: string): string {
    const dir = dirname(filePath)
    return html.replace(/<img([^>]*)\ssrc="([^"]+)"([^>]*>)/g, (_match, before, src, after) => {
      if (/^(https?:|data:|file:)/.test(src)) return _match
      const absPath = resolve(dir, src)
      if (!existsSync(absPath)) throw new Error(`IMAGE_NOT_FOUND:${src}`)
      const fileUrl = `file:///${absPath.replace(/\\/g, '/')}`
      return `<img${before} src="${fileUrl}"${after}`
    })
  }

  private static async _resolveImagePathsBase64(html: string, filePath: string): Promise<string> {
    const dir = dirname(filePath)
    const srcSet = new Set<string>()
    const imgRe = /<img[^>]*\ssrc="([^"]+)"[^>]*>/g
    let m: RegExpExecArray | null
    while ((m = imgRe.exec(html)) !== null) srcSet.add(m[1])

    const replacements = new Map<string, string>()
    for (const src of srcSet) {
      if (/^data:/.test(src)) continue
      if (/^file:/.test(src)) continue

      if (/^https?:\/\//.test(src)) {
        const dataUrl = await this._fetchRemoteImageAsBase64(src)
        if (dataUrl) replacements.set(src, dataUrl)
      } else {
        const absPath = resolve(dir, src)
        if (!existsSync(absPath)) throw new Error(`IMAGE_NOT_FOUND:${src}`)
        try {
          const ext = absPath.split('.').pop()?.toLowerCase() ?? 'png'
          const mime = this._MIME_MAP[ext] ?? 'image/png'
          const b64 = readFileSync(absPath).toString('base64')
          replacements.set(src, `data:${mime};base64,${b64}`)
        } catch {
          replacements.set(src, `file:///${absPath.replace(/\\/g, '/')}`)
        }
      }
    }

    return html.replace(/<img([^>]*)\ssrc="([^"]+)"([^>]*>)/g, (_match, before, src, after) => {
      const replacement = replacements.get(src)
      return replacement ? `<img${before} src="${replacement}"${after}` : _match
    })
  }

  private static async _fetchRemoteImageAsBase64(url: string): Promise<string | null> {
    try {
      const response = await fetch(url)
      if (!response.ok) return null
      const contentType = response.headers.get('content-type') ?? 'image/png'
      const mime = contentType.split(';')[0].trim()
      const buffer = await response.arrayBuffer()
      const b64 = Buffer.from(buffer).toString('base64')
      return `data:${mime};base64,${b64}`
    } catch {
      return null
    }
  }

  private static readonly _MIME_MAP: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  }

  // ── TOC helpers ────────────────────────────────────────────────────────────

  private static _extractHeadings(html: string): Array<{ level: number; text: string; id: string }> {
    const headings: Array<{ level: number; text: string; id: string }> = []
    const headingRe = /<h([1-6])[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h[1-6]>/g
    let match: RegExpExecArray | null
    while ((match = headingRe.exec(html)) !== null) {
      headings.push({
        level: parseInt(match[1], 10),
        id: match[2],
        text: match[3].replace(/<[^>]+>/g, '').trim(),
      })
    }
    return headings
  }

  private static _buildTocSection(html: string, tocTitle?: string): string {
    const headings = this._extractHeadings(html)
    if (headings.length === 0) return ''
    const items = headings
      .map(h => `  <li class="toc-item toc-h${h.level}"><a class="toc-link" href="#${h.id}">${this._escapeText(h.text)}</a></li>`)
      .join('\n')
    const title = tocTitle || 'Table of Contents'
    return `<div class="toc-section">\n  <h2>${title}</h2>\n  <ul class="toc-list">\n${items}\n  </ul>\n</div>`
  }

  /**
   * Resolves url(...) in CSS to Base64 inlined data URIs.
   * Scans for relative paths and attempts to find them relative to assets or file.
   */
  private static async _resolveCssImagesBase64(css: string, filePath: string): Promise<string> {
    const dir = dirname(filePath)
    const assetDir = resolve(process.cwd(), 'src', 'renderer', 'assets')

    // Find all url(...) patterns
    const regex = /url\(['"]?([^'")]+)['"]?\)/g
    let match
    const urls = new Set<string>()
    while ((match = regex.exec(css)) !== null) {
      urls.add(match[1])
    }

    let resolvedCss = css
    for (const url of urls) {
      if (url.startsWith('data:')) continue

      let absPath: string | null = null
      if (url.startsWith('http')) {
        const b64 = await this._fetchRemoteImageAsBase64(url)
        if (b64) resolvedCss = resolvedCss.replace(new RegExp(this._escapeRegex(url), 'g'), b64)
        continue
      }

      // Try resolving relative to doc OR assets
      const tryPath1 = resolve(dir, url)
      const tryPath2 = resolve(assetDir, url.replace('../assets/', ''))

      if (existsSync(tryPath1)) absPath = tryPath1
      else if (existsSync(tryPath2)) absPath = tryPath2

      if (absPath) {
        const b64 = this._fileToBase64(absPath)
        const mime = this._MIME_MAP[extname(absPath).slice(1).toLowerCase()] || 'image/png'
        const dataUri = `data:${mime};base64,${b64}`
        resolvedCss = resolvedCss.replace(new RegExp(this._escapeRegex(url), 'g'), dataUri)
      }
    }

    return resolvedCss
  }

  private static _escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  // ── Doc token CSS helpers ──────────────────────────────────────────────────

  private static _docTokenCss(tokens: DocTokens, settings: Partial<AppSettings>): string {
    const fBody = tokens.previewFontFamily || "'Newsreader', 'Georgia', serif"
    const fHead = tokens.previewHeadingFont || fBody
    const mono = this._fontStack(settings.codeFontFamily || 'JetBrains Mono', "'JetBrains Mono', 'Consolas', 'Courier New', monospace")

    // Support blockquote background transparency if accent is hex
    let accentRgb = '0,0,0';
    if (tokens.accent.startsWith('#')) {
      const r = parseInt(tokens.accent.slice(1, 3), 16);
      const g = parseInt(tokens.accent.slice(3, 5), 16);
      const b = parseInt(tokens.accent.slice(5, 7), 16);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) accentRgb = `${r},${g},${b}`;
    }

    return `
:root {
  --doc-heading:       ${tokens.heading};
  --doc-accent:        ${tokens.accent};
  --doc-accent-rgb:    ${accentRgb};
  --doc-border:        ${tokens.border};
  --doc-border-subtle: ${tokens.borderSubtle};
  --doc-code-bg:       ${tokens.codeBg};
  --font-preview:      ${fBody};
  --font-heading:      ${fHead};
  --font-mono:         ${mono};
  --paper-margin-top:    ${tokens.marginTop ?? 76}px;
  --paper-margin-right:  ${tokens.marginRight ?? 83}px;
  --paper-margin-bottom: ${tokens.marginBottom ?? 76}px;
  --paper-margin-left:   ${tokens.marginLeft ?? 83}px;
  --preview-base-size:   ${tokens.previewBaseFontSize ?? 15}px;
  --preview-line-height: ${tokens.previewLineHeight ?? 1.8};
  --paper-width:         ${tokens.paperWidth ?? 794}px;
  --paper-height:        ${tokens.paperHeight ?? 1123}px;
  --preview-h1-size:     ${tokens.h1Size ?? '33.8px'};
  --preview-h2-size:     ${tokens.h2Size ?? '22.5px'};
  --preview-h3-size:     ${tokens.h3Size ?? '18.8px'};
  --preview-h4-size:     ${tokens.h4Size ?? '16.5px'};
  --preview-h5-size:     ${tokens.h5Size ?? '15px'};
  --preview-paragraph-spacing: ${tokens.paragraphSpacing ?? '0.8em'};
  
  --print-base-size:     ${tokens.printBaseFontSize ?? '11pt'};
  --print-line-height:   ${tokens.printLineHeight ?? '1.72'};
  --print-margin-top:    ${tokens.printMarginTop ?? '20mm'};
  --print-margin-right:  ${tokens.printMarginRight ?? '22mm'};
  --print-margin-bottom: ${tokens.printMarginBottom ?? '20mm'};
  --print-margin-left:   ${tokens.printMarginLeft ?? '22mm'};
  --print-h1-size:       ${tokens.printH1Size ?? '22pt'};
  --print-h2-size:       ${tokens.printH2Size ?? '17pt'};
  --print-h3-size:       ${tokens.printH3Size ?? '13pt'};
  --print-h4-size:       ${tokens.printH4Size ?? '11pt'};
  --print-h5-size:       ${tokens.printH5Size ?? '10pt'};
  --print-paragraph-spacing: ${tokens.printParagraphSpacing ?? '0.8em'};
}
`
  }

  private static _pageNumberCss(): string {
    return `@page { @bottom-center { content: counter(page) " / " counter(pages); font-size: 9pt; color: #807663; } } `
  }

  /**
   * B&W override: same print-native token system as color mode but with monochrome palette.
   * Ensures consistent 0.75pt scaling across all export modes.
   */
  private static _bwOverrideCss(settings: Partial<AppSettings>): string {
    const fBody = this._fontStack(settings.previewFontFamily || 'Newsreader', "'Georgia', serif")
    const fHead = this._fontStack(settings.previewHeadingFont || settings.previewFontFamily || 'Newsreader', fBody)
    const mono = this._fontStack(settings.codeFontFamily || 'JetBrains Mono', "'JetBrains Mono', 'Consolas', 'Courier New', monospace")
    const basePx = settings.previewBaseFontSize ?? 15
    const scaleFactor = 0.75
    const basePt = Math.round(basePx * scaleFactor * 10) / 10
    return `
:root {
  --doc-heading:       #1a1c1a;
  --doc-accent:        #3a3a3a;
  --doc-accent-rgb:    58,58,58;
  --doc-border:        #888888;
  --doc-border-subtle: rgba(0,0,0,0.15);
  --doc-code-bg:       #f0f0f0;
  --font-preview:      ${fBody};
  --font-heading:      ${fHead};
  --font-mono:         ${mono};
  --preview-base-size:          ${basePx}px;
  --preview-line-height:        ${settings.previewLineHeight ?? 1.8};
  --preview-paragraph-spacing:  ${settings.paragraphSpacing ?? 0.8}em;
  --print-base-size:            ${basePt}pt;
  --print-line-height:          ${settings.previewLineHeight ?? 1.8};
  --print-paragraph-spacing:    ${settings.paragraphSpacing ?? 0.8}em;
  --print-margin-top:    20mm;
  --print-margin-right:  22mm;
  --print-margin-bottom: 20mm;
  --print-margin-left:   22mm;
  --print-h1-size:       ${Math.round(basePt * 2.25 * 10) / 10}pt;
  --print-h2-size:       ${Math.round(basePt * 1.5 * 10) / 10}pt;
  --print-h3-size:       ${Math.round(basePt * 1.25 * 10) / 10}pt;
  --print-h4-size:       ${Math.round(basePt * 1.1 * 10) / 10}pt;
  --print-h5-size:       ${basePt}pt;
}
`
  }

  private static _watermarkCss(text: string): string {
    const escaped = text.replace(/'/g, "\\'")
    return `
    body::after {
      content: '${escaped}';
      position: fixed;
      bottom: 12px;
      right: 20px;
      font-size: 8pt;
      font-family: Arial, sans-serif;
      font-weight: 600;
      color: #000;
      opacity: 0.15;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      pointer-events: none;
      z-index: 9999;
    }
    `
  }

  private static _fontStack(primary: string, fallback: string): string {
    const normalized = primary.trim()
    if (!normalized) return fallback
    if (normalized.includes(',')) return normalized
    return `'${normalized.replace(/'/g, "\\'")}', ${fallback}`
  }


  private static _getInlineFontsCss(_settings: Partial<AppSettings>): string {
    // We try to find local font files for these in the app's resources/fonts folder
    // This folder is defined in package.json extraResources
    const devPath = resolve(process.cwd(), 'app', 'resources', 'fonts')
    const rootPath = resolve(process.cwd(), 'resources', 'fonts')
    const prodPath = process.resourcesPath ? resolve(process.resourcesPath, 'fonts') : ''
    let fontDir = rootPath
    if (prodPath && existsSync(prodPath)) fontDir = prodPath
    else if (existsSync(devPath)) fontDir = devPath

    let css = '/* ── Local Embedded Fonts (Plan E) ── */\n'

    const fontFiles = [
      { family: 'Inter', file: 'Inter-Variable.ttf', weight: '100 900' },
      { family: 'Merriweather', file: 'Merriweather-Variable.ttf', weight: '300 900' },
      { family: 'Newsreader', file: 'Newsreader-Variable.ttf', weight: '200 800' },
      { family: 'Newsreader', file: 'Newsreader-Italic-Variable.ttf', weight: '200 800', style: 'italic' },
      { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf' },
    ]

    let foundAny = false
    for (const font of fontFiles) {
      const path = resolve(fontDir, font.file)
      if (!existsSync(path)) continue
      if (!this._isValidFontFile(path)) {
        console.warn('[HtmlBuilder] Skipping invalid font asset:', path)
        continue
      }

      const { base64, format } = this._fileToBase64(path)
      if (!base64) continue

      css += `
    @font-face {
      font-family: '${font.family}';
      src: url(data:font/${format};base64,${base64}) format('${this._cssFormat(format)}');
      font-weight: ${font.weight || 400};
      font-style: ${font.style || 'normal'};
      font-display: swap;
    }\n`
      foundAny = true
    }

    return foundAny ? css : ''
  }

  private static _fileToBase64(path: string): { base64: string; format: 'ttf' | 'otf' | 'woff' | 'woff2' } {
    try {
      const buffer = readFileSync(path)
      return {
        base64: buffer.toString('base64'),
        format: this._detectFontFormat(buffer),
      }
    } catch (e) {
      console.error('[HtmlBuilder] File to base64 failed:', path, e)
      return { base64: '', format: 'ttf' }
    }
  }

  private static _isValidFontFile(path: string): boolean {
    try {
      const buffer = readFileSync(path)
      return this._detectFontFormat(buffer) !== 'ttf' || buffer.readUInt32BE(0) === 0x00010000
    } catch {
      return false
    }
  }

  private static _detectFontFormat(buffer: Buffer): 'ttf' | 'otf' | 'woff' | 'woff2' {
    if (buffer.length < 4) return 'ttf'
    const signature = buffer.subarray(0, 4).toString('ascii')
    if (signature === 'OTTO') return 'otf'
    if (signature === 'wOFF') return 'woff'
    if (signature === 'wOF2') return 'woff2'
    return 'ttf'
  }

  private static _cssFormat(format: 'ttf' | 'otf' | 'woff' | 'woff2'): string {
    switch (format) {
      case 'otf':
        return 'opentype'
      case 'woff':
        return 'woff'
      case 'woff2':
        return 'woff2'
      default:
        return 'truetype'
    }
  }

  private static _containsPreviewPages(html: string): boolean {
    return /class\s*=\s*["'][^"']*\bpreview-page\b/i.test(html)
  }

  private static _getKatexCss(inline: boolean = false): string {
    try {
      const cssPath = require.resolve('katex/dist/katex.min.css')
      const cssDir = dirname(cssPath)
      let css = readFileSync(cssPath, 'utf8')

      if (inline) {
        // Find and inline all KATE_SIZE... relative URLs in the CSS
        // Note: Full KaTeX inlining is complex, for now we just fix the URLs for PDF
        // or provide the CSS. For true self-contained HTML, more assets required.
      }

      const fontsPath = cssDir.replace(/\\/g, '/')
      css = css.replace(/url\(fonts\//g, `url(file:///${fontsPath}/fonts/`)

      return css
    } catch (e) {
      console.error('[HtmlBuilder] KaTeX CSS resolve failed:', e)
      return '/* KaTeX CSS missing */'
    }
  }

  private static _escapeText(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  private static _escapeAttr(text: string): string {
    return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }

  private static _getPreviewCss(): string {
    try {
      const candidatePaths = [
        resolve(process.cwd(), 'src/renderer/styles/preview.css'),
        resolve(process.cwd(), 'app/src/renderer/styles/preview.css'),
        resolve(__dirname, '../../src/renderer/styles/preview.css'),
        resolve(__dirname, '../renderer/styles/preview.css')
      ]

      for (const cssPath of candidatePaths) {
        if (!existsSync(cssPath)) continue
        const css = this._stripPreviewFontDefaults(readFileSync(cssPath, 'utf8'))
        return css
      }

      const assetDirs = [
        resolve(process.cwd(), 'out/renderer/assets'),
        resolve(process.cwd(), 'app/out/renderer/assets'),
        resolve(__dirname, '../renderer/assets')
      ]

      for (const dirPath of assetDirs) {
        if (!existsSync(dirPath)) continue
        const cssAssets = readdirSync(dirPath)
          .filter((name) => /^index-.*\.css$/i.test(name))
          .map((name) => {
            const fullPath = resolve(dirPath, name)
            return { fullPath, mtimeMs: statSync(fullPath).mtimeMs }
          })
          .sort((a, b) => b.mtimeMs - a.mtimeMs)

        if (cssAssets.length === 0) continue

        const css = this._stripPreviewFontDefaults(readFileSync(cssAssets[0].fullPath, 'utf8'))
        return css
      }

      return ''
    } catch (e) {
      return ''
    }
  }

  private static _stripPreviewFontDefaults(css: string): string {
    return css
      .replace(/--font-preview\s*:\s*[^;}{]+;/g, '')
      .replace(/--font-heading\s*:\s*[^;}{]+;/g, '')
      .replace(/--font-mono\s*:\s*[^;}{]+;/g, '')
  }
}
