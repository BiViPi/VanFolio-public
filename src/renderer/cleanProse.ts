// ─────────────────────────────────────────────────────────────────────────────
// Clean Prose Plugin — Sprint 5.3-A
// Hides markdown syntax markers (# ** _ *) and applies typography styles.
// Cursor on same line → markers revealed for editing.
// ─────────────────────────────────────────────────────────────────────────────

import {
  EditorView,
  ViewPlugin,
  ViewUpdate,
  Decoration,
  type DecorationSet,
} from '@codemirror/view'
import { Compartment, RangeSetBuilder, type Extension } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { hasCapability } from './licenseGate'

let __hasPro = false
hasCapability('editor.cleanProseMode').then(h => __hasPro = h)

export const cleanProseCompartment = new Compartment()

// ── Decoration atoms ────────────────────────────────────────────────────────

/** Replaces markup characters (# / ** / _) with nothing — visually hidden */
const hideDeco = Decoration.replace({})

const headingMarks: Record<string, Decoration> = {
  ATXHeading1: Decoration.mark({ class: 'cm-clean-h1' }),
  ATXHeading2: Decoration.mark({ class: 'cm-clean-h2' }),
  ATXHeading3: Decoration.mark({ class: 'cm-clean-h3' }),
  ATXHeading4: Decoration.mark({ class: 'cm-clean-h4' }),
  ATXHeading5: Decoration.mark({ class: 'cm-clean-h5' }),
  ATXHeading6: Decoration.mark({ class: 'cm-clean-h6' }),
  SetextHeading1: Decoration.mark({ class: 'cm-clean-h1' }),
  SetextHeading2: Decoration.mark({ class: 'cm-clean-h2' }),
}

const boldMark = Decoration.mark({ class: 'cm-clean-bold' })
const italicMark = Decoration.mark({ class: 'cm-clean-italic' })

// ── Plugin class ─────────────────────────────────────────────────────────────

class CleanProsePlugin {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = this.build(view)
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.selectionSet) {
      this.decorations = this.build(update.view)
    }
  }

  build(view: EditorView): DecorationSet {
    const state = view.state
    const cursorPos = state.selection.main.head
    const cursorLine = state.doc.lineAt(state.selection.main.head).number
    const tree = syntaxTree(state)

    // Ranges are collected per-type then merged in sorted order.
    // RangeSetBuilder requires strictly ascending `from`.
    const hideRanges: { from: number; to: number }[] = []
    const markRanges: { from: number; to: number; deco: Decoration }[] = []

    tree.iterate({
      enter(node) {
        const { name, from, to } = node

        // ── Code blocks: skip entire subtree ──────────────────────────────
        if (name === 'FencedCode' || name === 'CodeBlock' || name === 'InlineCode') {
          return false
        }

        // ── ATX Headings ──────────────────────────────────────────────────
        if (name in headingMarks) {
          if (cursorPos >= from && cursorPos <= to) return

          // Mark the whole heading node with the heading class
          markRanges.push({ from, to, deco: headingMarks[name] })
          return
        }

        // ── HeaderMark (# + space) ────────────────────────────────────────
        if (name === 'HeaderMark') {
          const parent = tree.resolveInner(from, 1).parent
          if (parent && cursorPos >= parent.from && cursorPos <= parent.to) return

          const headLine = state.doc.lineAt(from).number
          if (headLine === cursorLine) return
          hideRanges.push({ from, to })
          return
        }

        // ── StrongEmphasis (**text**) ─────────────────────────────────────
        if (name === 'StrongEmphasis') {
          const emphLine = state.doc.lineAt(from).number
          if (emphLine === cursorLine) return
          markRanges.push({ from, to, deco: boldMark })
          return
        }

        // ── Emphasis (_text_ / *text*) ────────────────────────────────────
        if (name === 'Emphasis') {
          const emphLine = state.doc.lineAt(from).number
          if (emphLine === cursorLine) return
          markRanges.push({ from, to, deco: italicMark })
          return
        }

        // ── EmphasisMark (** / _ / *) ─────────────────────────────────────
        if (name === 'EmphasisMark') {
          const emphLine = state.doc.lineAt(from).number
          if (emphLine === cursorLine) return
          hideRanges.push({ from, to })
          return
        }
      },
    })

    // ── Merge and sort all ranges before building ─────────────────────────
    // RangeSetBuilder requires items in ascending `from` order.
    type AnyRange =
      | { kind: 'hide'; from: number; to: number }
      | { kind: 'mark'; from: number; to: number; deco: Decoration }

    const all: AnyRange[] = [
      ...hideRanges.map(r => ({ kind: 'hide' as const, ...r })),
      ...markRanges.map(r => ({ kind: 'mark' as const, ...r })),
    ]
    all.sort((a, b) => a.from - b.from || a.to - b.to)

    const builder = new RangeSetBuilder<Decoration>()
    for (const r of all) {
      if (r.kind === 'hide') {
        builder.add(r.from, r.to, hideDeco)
      } else {
        builder.add(r.from, r.to, r.deco)
      }
    }

    return builder.finish()
  }
}

const cleanProsePlugin = ViewPlugin.fromClass(CleanProsePlugin, {
  decorations: (v) => v.decorations,
  eventHandlers: {
    // Toggle clean-prose-active class so CSS line-height rule fires
    focus(_, view: EditorView) {
      view.dom.classList.add('clean-prose-active')
    },
  },
})

// ── Public API ───────────────────────────────────────────────────────────────

export function getCleanProseExt(enabled: boolean): Extension {
  return (enabled && __hasPro) ? cleanProsePlugin : []
}

/**
 * Reconfigure clean prose mode on a live editor view.
 * Also toggles the `.clean-prose-active` class on the editor DOM.
 */
export function applyCleanProseClass(view: EditorView, enabled: boolean): void {
  view.dom.classList.toggle('clean-prose-active', enabled)
}
