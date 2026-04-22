// ─────────────────────────────────────────────────────────────────────────────
// MarkdownEngine — Bundled into RENDERER (pure computation, no Node API needed)
// Imported directly in renderer, does NOT go through IPC
// Sprint 1: markdown-it with security defaults (html: false)
// ─────────────────────────────────────────────────────────────────────────────

import MarkdownIt from 'markdown-it'
import type { PluginSimple } from 'markdown-it'
import katex from 'katex'

export interface TocItem {
  level: number   // 1–6
  text: string
  id: string      // anchor id (slugified)
}

export interface RenderResult {
  html: string
  tocItems: TocItem[]
}

// ── Custom KaTeX plugin using project's katex@0.16 ────────────────────────────
// Replaces markdown-it-katex@2.0.3 which bundled katex@0.7 causing CSS mismatch.
// Supports: $inline$ and $$display$$ math syntax.
const katexPlugin: PluginSimple = (md) => {
  // ── Inline math: $...$ ──────────────────────────────────────────────────────
  md.inline.ruler.before('escape', 'math_inline', (state, silent) => {
    const src = state.src
    const pos = state.pos
    if (src[pos] !== '$') return false
    // Skip $$ (block delimiter) — avoid interfering with block rule
    if (src[pos + 1] === '$') return false
    // Require non-whitespace after opening $
    if (pos + 1 >= src.length || src[pos + 1] === ' ' || src[pos + 1] === '\n') return false

    // Find closing $, not preceded by space
    let end = pos + 1
    while (end < src.length) {
      if (src[end] === '$') {
        if (src[end - 1] !== ' ') break
      }
      end++
    }
    if (end >= src.length || src[end] !== '$') return false

    if (!silent) {
      const token = state.push('math_inline', 'math', 0)
      token.markup = '$'
      token.content = src.slice(pos + 1, end)
    }
    state.pos = end + 1
    return true
  })

  // ── Block math: $$...$$ ─────────────────────────────────────────────────────
  // Handles both:
  //   $$\ncontent\n$$        (multi-line)
  //   $$ content $$          (single-line)
  md.block.ruler.before('fence', 'math_block', (state, startLine, endLine, silent) => {
    let pos = state.bMarks[startLine] + state.tShift[startLine]
    const max = state.eMarks[startLine]

    if (pos + 1 >= max) return false
    if (state.src.charCodeAt(pos) !== 0x24 /* $ */ || state.src.charCodeAt(pos + 1) !== 0x24) return false

    if (silent) return true

    // Content on same line as opening $$
    pos += 2
    const firstLine = state.src.slice(pos, max)
    let found = false
    let lastLine = ''
    let next = startLine

    // Check: single-line $$ content $$
    if (firstLine.trim().endsWith('$$')) {
      lastLine = firstLine.trim().slice(0, -2)
      found = true
    }

    // Multi-line: scan subsequent lines for closing $$
    while (!found) {
      next++
      if (next >= endLine) break

      const lineStart = state.bMarks[next] + state.tShift[next]
      const lineEnd = state.eMarks[next]
      const lineText = state.src.slice(lineStart, lineEnd).trim()

      if (lineText === '$$') {
        found = true
        break
      }
    }

    // Build content
    let content: string
    if (found && firstLine.trim().endsWith('$$')) {
      // Single-line $$...$$ on opening line
      content = lastLine
    } else {
      // Multi-line: lines between opening $$ and closing $$
      content = (firstLine.trim() ? firstLine + '\n' : '')
        + state.getLines(startLine + 1, next, state.blkIndent, true)
    }
    content = content.trim()

    const token = state.push('math_block', 'math', 0)
    token.block = true
    token.markup = '$$'
    token.content = content
    token.map = [startLine, next]

    state.line = found ? next + 1 : next
    return true
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })

  // ── Renderers ───────────────────────────────────────────────────────────────
  md.renderer.rules['math_inline'] = (tokens, idx) => {
    try {
      return katex.renderToString(tokens[idx].content, {
        throwOnError: false,
        displayMode: false,
        output: 'htmlAndMathml', // REQUIRED: DocxExporter needs <annotation> tag for OMML conversion
      })
    } catch {
      return `<code>${tokens[idx].content}</code>`
    }
  }

  md.renderer.rules['math_block'] = (tokens, idx) => {
    try {
      return `<p class="math-block">${katex.renderToString(tokens[idx].content, {
        throwOnError: false,
        displayMode: true,
        output: 'htmlAndMathml', // REQUIRED: DocxExporter needs <annotation> tag for OMML conversion
      })}</p>\n`
    } catch {
      return `<pre><code>${tokens[idx].content}</code></pre>\n`
    }
  }
}

// ── HTML Sanitizer ────────────────────────────────────────────────────────────
// markdown-it runs with html:false so raw HTML blocks are already escaped.
// This layer targets the linkify output which converts plain URLs to <a> tags —
// it could produce javascript: hrefs or on* attributes from malicious content.
//
// Strategy: regex-replace dangerous href values and on* attributes.
// NOT a full DOM sanitizer — kept minimal to avoid bundle size impact.
// If full sanitization is ever needed, add DOMPurify.
function sanitizeHtml(html: string): string {
  return html
    // Block javascript: / vbscript: / data: URIs in href and src
    .replace(/(<a\s[^>]*href\s*=\s*["'])(?:javascript|vbscript|data):[^"']*/gi,
      '$1about:blank')
    // Block on* event handler attributes (onclick, onload, onerror, …)
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
    // Ensure all <a> tags open in a safe context (no target="_self" to parent)
    .replace(/<a(\s[^>]*)>/gi, (match, attrs) => {
      if (/rel\s*=/i.test(attrs)) return match
      return `<a${attrs} rel="noopener noreferrer">`
    })
}

export class MarkdownEngine {
  private md: MarkdownIt
  private _tocItems: TocItem[] = []
  private _slugCount: Map<string, number> = new Map()

  constructor() {
    this.md = new MarkdownIt({
      html: false,       // Security: disallow raw HTML (Sprint 1 — add sanitizer before enabling)
      breaks: true,      // Single newline → <br>
      linkify: true,     // Auto-linkify URLs
      typographer: true, // Smart quotes, dashes
    })

    this.md.use(katexPlugin)
    this._installTocCollector()
  }

  setTypographer(enabled: boolean): void {
    this.md.set({ typographer: enabled })
  }

  render(markdown: string): RenderResult {
    this._tocItems = []
    this._slugCount = new Map()
    const raw = this.md.render(markdown.normalize('NFC'))
    const html = sanitizeHtml(raw)
    return { html, tocItems: [...this._tocItems] }
  }

  // Collect headings during render to build TOC without a second pass
  private _installTocCollector(): void {
    this.md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
      const token = tokens[idx]
      const level = parseInt(token.tag.slice(1), 10)
      const inlineToken = tokens[idx + 1]
      const text = inlineToken?.children
        ?.filter(t => t.type === 'text' || t.type === 'code_inline')
        .map(t => t.content)
        .join('') ?? ''
      const id = this._uniqueSlug(text)

      // Inject id attribute for anchor links
      token.attrSet('id', id)

      if (text) {
        this._tocItems.push({ level, text, id })
      }

      return self.renderToken(tokens, idx, options)
    }
  }

  // Slugify with Unicode normalization + deduplication counter
  private _uniqueSlug(text: string): string {
    // Normalize: decompose accented chars (é → e + ́) then strip combining marks
    const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const base = normalized
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      || 'section'

    const count = this._slugCount.get(base) ?? 0
    this._slugCount.set(base, count + 1)
    return count === 0 ? base : `${base}-${count + 1}`
  }
}

// Singleton — reuse across the renderer lifecycle
export const markdownEngine = new MarkdownEngine()
