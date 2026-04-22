// ─────────────────────────────────────────────────────────────────────────────
// Writing Modes — Sprint 3
// Typewriter: keep cursor line at vertical center
// Fade Context: dim all paragraphs except the one containing cursor
// ─────────────────────────────────────────────────────────────────────────────

import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet, scrollPastEnd } from '@codemirror/view'
import { Compartment, RangeSetBuilder } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { AppSettings } from '@shared/types'
import { hasCapability } from './licenseGate'

// ── State ─────────────────────────────────────────────────────────────────────

let _typewriterEnabled = false
let _fadeEnabled = false
let isLicenseBound = false

export function isTypewriterEnabled(): boolean { return _typewriterEnabled }
export function isFadeEnabled(): boolean { return _fadeEnabled }
export function setTypewriterEnabled(v: boolean): void { _typewriterEnabled = v }
export function setFadeEnabled(v: boolean): void { _fadeEnabled = v }

// ── Compartments (exported for editor.ts) ─────────────────────────────────────

export const typewriterCompartment = new Compartment()
export const fadeCompartment = new Compartment()

// ── Typewriter Plugin ─────────────────────────────────────────────────────────
// Uses ViewPlugin + requestMeasure for correct CM6 layout read/write cycle.
// Anchor: lineBlockAt(pos) — stable visual line block, not cursor boundary.
// Scroll space: scrollPastEnd() bundled in getTypewriterExtension().

const typewriterPlugin = ViewPlugin.fromClass(class {
  update(update: ViewUpdate) {
    if (!update.selectionSet && !update.docChanged) return

    // Schedule measure in CM6's layout cycle — avoids race with DOM layout
    update.view.requestMeasure({
      read(view) {
        const pos = view.state.selection.main.head
        // lineBlockAt: stable visual block anchor (handles line-start, empty lines)
        const block = view.lineBlockAt(pos)
        const targetTop = block.top + block.height / 2 - view.scrollDOM.clientHeight / 2
        return { targetTop, currentTop: view.scrollDOM.scrollTop }
      },
      write({ targetTop, currentTop }, view) {
        const clamped = Math.max(0, targetTop)
        if (Math.abs(currentTop - clamped) < 4) return
        // Smooth only for large jumps (mouse click / page jump), instant for typing
        const behavior = Math.abs(currentTop - clamped) > 200 ? 'smooth' : 'auto'
        view.scrollDOM.scrollTo({ top: clamped, behavior })
      },
    })
  }
})

// ── Fade Context Plugin ───────────────────────────────────────────────────────

// Block-level node types from Lezer markdown parser
const BLOCK_TYPES = new Set([
  'Paragraph',
  'ATXHeading1', 'ATXHeading2', 'ATXHeading3',
  'ATXHeading4', 'ATXHeading5', 'ATXHeading6',
  'SetextHeading1', 'SetextHeading2',
  'FencedCode', 'Blockquote',
  'BulletList', 'OrderedList',
  'HorizontalRule', 'HTMLBlock',
])

const fadeMark = Decoration.line({ class: 'cm-faded-line' })

const fadePlugin = ViewPlugin.fromClass(class {
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

    // Find block node containing cursor
    let activeFrom = -1
    let activeTo = -1

    tree.iterate({
      enter(node) {
        if (BLOCK_TYPES.has(node.name)) {
          if (cursorPos >= node.from && cursorPos <= node.to) {
            activeFrom = node.from
            activeTo = node.to
            return false  // stop deeper traversal for this node
          }
        }
      }
    })

    // Cursor on blank line (no block found) → show full doc unfaded
    if (activeFrom === -1) {
      return Decoration.none
    }

    // Mark all lines OUTSIDE the active block as faded
    const builder = new RangeSetBuilder<Decoration>()
    for (let i = 1; i <= view.state.doc.lines; i++) {
      const line = view.state.doc.line(i)
      if (line.from < activeFrom || line.from > activeTo) {
        builder.add(line.from, line.from, fadeMark)
      }
    }
    return builder.finish()
  }
}, {
  decorations: (v) => v.decorations,
})

// ── Extension getters ─────────────────────────────────────────────────────────

export function getTypewriterExtension(enabled: boolean) {
  // scrollPastEnd() allows first/last lines to be centered (adds virtual scroll space)
  return enabled ? [typewriterPlugin, scrollPastEnd()] : []
}

export function getFadeExtension(enabled: boolean) {
  return enabled ? fadePlugin : []
}

// ── Init (called from main.ts) ────────────────────────────────────────────────

export function initWritingModes(settings: AppSettings): void {
  _typewriterEnabled = settings.typewriterMode ?? false
  _fadeEnabled = settings.fadeContext ?? false

  hasCapability('editor.typewriterMode').then((has) => {
    if (!has && _typewriterEnabled) _typewriterEnabled = false
  })
  hasCapability('editor.fadeContext').then((has) => {
    if (!has && _fadeEnabled) _fadeEnabled = false
  })

  if (!isLicenseBound) {
    window.addEventListener('license:updated', () => {
      hasCapability('editor.typewriterMode').then((has) => {
        if (!has && _typewriterEnabled) {
          import('./editor').then(({ setTypewriterMode }) => {
            setTypewriterMode(false)
            window.vanfolioAPI.saveSettings({ typewriterMode: false }).catch(console.error)
          }).catch(console.error)
        }
      }).catch(console.error)

      hasCapability('editor.fadeContext').then((has) => {
        if (!has && _fadeEnabled) {
          import('./editor').then(({ setFadeContext }) => {
            setFadeContext(false)
            window.vanfolioAPI.saveSettings({ fadeContext: false }).catch(console.error)
          }).catch(console.error)
        }
      }).catch(console.error)
    })
    isLicenseBound = true
  }
}
