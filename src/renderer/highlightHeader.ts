// ─────────────────────────────────────────────────────────────────────────────
// Highlight Header Plugin — Phase 4.2 Group B
// Highlights the heading line containing the cursor
// ─────────────────────────────────────────────────────────────────────────────

import { EditorView, ViewPlugin, ViewUpdate, Decoration, type DecorationSet } from '@codemirror/view'
import { Compartment, RangeSetBuilder } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { hasCapability } from './licenseGate'

let __hasPro = false
hasCapability('editor.highlightHeader').then(h => __hasPro = h)

export const highlightHeaderCompartment = new Compartment()

const headingMark = Decoration.line({ class: 'cm-active-heading' })

const HEADING_TYPES = new Set([
    'ATXHeading1', 'ATXHeading2', 'ATXHeading3',
    'ATXHeading4', 'ATXHeading5', 'ATXHeading6',
    'SetextHeading1', 'SetextHeading2',
])

const highlightHeaderPlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet

    constructor(view: EditorView) {
        this.decorations = this.build(view)
    }

    update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet) {
            this.decorations = this.build(update.view)
        }
    }

    build(view: EditorView): DecorationSet {
        const cursorPos = view.state.selection.main.head
        const tree = syntaxTree(view.state)

        let headingFrom = -1
        let headingTo = -1

        // Optimized: resolve node at cursor with both biases to handle boundaries
        let node: any = tree.resolveInner(cursorPos, 1)
        if (node && !node.name.includes('Heading')) {
            node = tree.resolveInner(cursorPos, -1)
        }

        while (node) {
            if (HEADING_TYPES.has(node.name)) {
                headingFrom = node.from
                headingTo = node.to
                break
            }
            node = node.parent
        }

        if (headingFrom === -1) return Decoration.none

        const builder = new RangeSetBuilder<Decoration>()
        const fromLine = view.state.doc.lineAt(headingFrom)
        const toLine = view.state.doc.lineAt(headingTo)

        // Apply to all lines within the heading block (usually 1, but handles multi-line setext)
        for (let i = fromLine.number; i <= toLine.number; i++) {
            const line = view.state.doc.line(i)
            builder.add(line.from, line.from, headingMark)
        }

        return builder.finish()
    }
}, {
    decorations: (v) => v.decorations,
})

export function getHighlightHeaderExt(enabled: boolean) {
    return (enabled && __hasPro) ? highlightHeaderPlugin : []
}
