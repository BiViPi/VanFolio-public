// ─────────────────────────────────────────────────────────────────────────────
// Smart Quotes Plugin — Phase 4.2 Group B
// Replaces straight quotes with typographic quotes based on document context.
// ─────────────────────────────────────────────────────────────────────────────

import { EditorView } from '@codemirror/view'
import { Compartment, type Extension } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { hasCapability } from './licenseGate'

let __hasPro = false
hasCapability('editor.smartQuotes').then(h => __hasPro = h)

export const smartQuotesCompartment = new Compartment()

// Lezer nodes where we should NOT apply smart quotes (code, formulas, etc)
const CODE_CONTEXTS = new Set([
    'FencedCode',
    'CodeBlock',
    'CodeText',
    'InlineCode',
    'Comment',
    'Link', // Usually part of URL or title
    'HTMLTag',
])

const smartQuotesPlugin = EditorView.inputHandler.of((view, from, to, insert) => {
    // Only handle single double/single quote insertions
    if (insert !== '"' && insert !== "'") return false

    const pos = from
    const tree = syntaxTree(view.state)
    let skip = false

    // Check if current position is inside a code-like node
    tree.iterate({
        from: pos,
        to: pos,
        enter(node) {
            if (CODE_CONTEXTS.has(node.name)) {
                skip = true
                return false
            }
            return true
        }
    })

    if (skip) return false

    // Logic to determine opening vs closing quote
    // Look at the character before the cursor
    const before = pos > 0 ? view.state.doc.sliceString(pos - 1, pos) : ''
    const isOpening = before === '' || /\s|[\(\[\{\-\/]/.test(before)

    let replacement = insert
    if (insert === '"') {
        replacement = isOpening ? '\u201c' : '\u201d' // “ and ”
    } else if (insert === "'") {
        replacement = isOpening ? '\u2018' : '\u2019' // ‘ and ’
    }

    // Effect the change
    view.dispatch({
        changes: { from, to, insert: replacement },
        selection: { anchor: from + replacement.length },
        userEvent: 'input.smartQuotes'
    })

    return true
})

export function getSmartQuotesExt(enabled: boolean): Extension {
    return (enabled && __hasPro) ? smartQuotesPlugin : []
}
