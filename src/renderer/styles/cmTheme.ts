// ─────────────────────────────────────────────────────────────────────────────
// CodeMirror 6 Theme — VanFolio
// RULE: NO hardcoded colors. All values must reference CSS tokens via var(--...)
// ─────────────────────────────────────────────────────────────────────────────

import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

// Layout, backgrounds, cursor, gutters
export const vanfolioTheme = EditorView.theme({
  '&': {
    color: 'var(--text-primary)',
    backgroundColor: 'var(--bg-editor)',
    fontSize: 'var(--editor-font-size, 14px)',
    fontFamily: 'var(--font-mono)',
    height: '100%',
  },
  '.cm-scroller': {
    overflow: 'auto',
    lineHeight: 'var(--editor-line-height, 1.6)',
  },
  '.cm-content': {
    caretColor: 'var(--green-dark)',
    padding: '16px 20px',
  },
  '.cm-line': {
    paddingBottom: 'var(--editor-paragraph-spacing, 0)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--green-dark)',
  },
  // !important needed to override CM6 default selection styles
  '.cm-selectionBackground': {
    backgroundColor: 'var(--selection-bg) !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--selection-bg) !important',
  },
  '::selection': {
    backgroundColor: 'var(--selection-bg)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-editor)',
    color: 'var(--text-muted)',
    borderRight: 'none',
    paddingRight: '4px',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    opacity: '0.4',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  // Active line: dùng outline thay background để không che selection highlight
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '.cm-matchingBracket': {
    outline: '1px solid var(--green-mid)',
  },
})

// Syntax token colors — maps lezer tags → CSS variables
const customHighlighting = HighlightStyle.define([
  { tag: [t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6],
    color: 'var(--syn-heading)', fontWeight: 'bold' },
  { tag: t.strong,
    color: 'var(--syn-bold)', fontWeight: 'bold' },
  { tag: t.emphasis,
    color: 'var(--syn-italic)', fontStyle: 'italic' },
  { tag: [t.monospace, t.special(t.string)],
    color: 'var(--syn-code)' },
  { tag: [t.link, t.url],
    color: 'var(--syn-link)', textDecoration: 'underline' },
  { tag: t.quote,
    color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: [t.punctuation, t.bracket],
    color: 'var(--syn-punct)' },
  { tag: t.comment,
    color: 'var(--text-muted)' },
])

export const vanfolioHighlightStyle = syntaxHighlighting(customHighlighting)
