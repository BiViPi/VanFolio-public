// ─────────────────────────────────────────────────────────────────────────────
// TocGenerator — Bundled into RENDERER
// Receives tocItems from MarkdownEngine, generates HTML TOC sidebar
// Sprint 1 (S1-5): Ported from extension
// ─────────────────────────────────────────────────────────────────────────────

import type { TocItem } from './MarkdownEngine'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function generateTocHtml(items: TocItem[]): string {
  if (items.length === 0) return '<p class="toc-empty">No headings found</p>'

  // TODO Sprint 1: build nested <ul> structure from items
  // Stub: flat list
  const listItems = items
    .map((item) => `<li class="toc-item toc-h${item.level}">
      <a href="#${item.id}" class="toc-link">${escapeHtml(item.text)}</a>
    </li>`)
    .join('\n')

  return `<ul class="toc-list">${listItems}</ul>`
}

export function generateTocMarkdown(items: TocItem[]): string {
  return items
    .map((item) => `${'  '.repeat(item.level - 1)}- [${item.text}](#${item.id})`)
    .join('\n')
}
