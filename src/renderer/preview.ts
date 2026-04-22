// ─────────────────────────────────────────────────────────────────────────────
// Preview Module — Render markdown → paginated print-layout pages
//
// Pagination model: JS DOM measurement bins top-level blocks into page-height
// buckets. Each bucket = one <div class="preview-page"> (visual sheet of paper).
// ⚠️  Page breaks are APPROXIMATE vs PDF/PNG (Puppeteer uses browser @page
//     algorithm). Exact 1:1 parity is a known limitation — accepted trade-off
//     for clear page visual UX (same approach as Typora / Word Print Layout).
// ─────────────────────────────────────────────────────────────────────────────

import { markdownEngine } from '@engine/MarkdownEngine'
import { generateTocHtml } from '@engine/TocGenerator'
import type { AppSettings, DocTokens, ExportOptions } from '@shared/types'
import mermaid from 'mermaid'
import 'katex/dist/katex.min.css'
import { getActiveTabInfo } from './fileTabs'

// Mermaid runtime
let mermaidReady = false
function ensureMermaid(): typeof mermaid | null {
  try {
    if (!mermaidReady) {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'neutral',
        // antiscript: allows HTML labels in diagrams but strips <script> tags.
        // Safer than 'loose' (which allows script execution) while keeping
        // flowchart HTML labels working. Do NOT revert to 'loose' for Beta.
        securityLevel: 'antiscript',
      })
      mermaidReady = true
    }
    return mermaid
  } catch (err) {
    console.error('Mermaid init failed:', err)
    return null
  }
}

// Paper dimensions at 96dpi (portrait: width × height)
const PAPER_SIZES: Record<string, [number, number]> = {
  A4: [794, 1123],
  A3: [1123, 1587],
  Letter: [816, 1056],
}

// Margins aligned to PDF export: 20mm top/bottom, 22mm left/right (at 96dpi)
// 1mm = 3.7795px → 20mm ≈ 76px, 22mm ≈ 83px
const PAGE_PADDING_TB = 76
const PAGE_PADDING_LR = 83

// Last rendered markdown — needed to re-paginate when paper size changes
let _lastMarkdown = ''

// IntersectionObserver for TOC active state auto-sync
let tocObserver: IntersectionObserver | null = null

// Current active file path for relative image resolution
let _currentFilePath: string | null = null

// Current active fileKey — used to route preview updates to the correct pinned window
let _currentFileKey: string = '__untitled__'

// Prevent race conditions with async rendering
let _renderGen = 0

// T25: Debounce timer + content hash for skip-unchanged optimization
let _renderTimer: ReturnType<typeof setTimeout> | null = null
let _lastContentHash = ''
const RENDER_DEBOUNCE_MS = 150
let _mermaidSeq = 0
const PREVIEW_DEBUG_FN = '__vfPrintPreviewDebug'
const PREVIEW_DUMP_FN = '__vfDumpPreviewDebug'
const PREVIEW_TRACE_DUMP_FN = '__vfDumpPreviewTrace'
const PDF_DEBUG_DUMP_FN = '__vfDumpPdfDebug'
const PREVIEW_TOP_GAP_DEBUG_FN = '__vfInspectPreviewTopGap'
const BASELINE_CAPTURE_FN = '__vfCaptureBaseline'

// ── Hướng C / Pass 2 data model ───────────────────────────────────────────────

type SplitArtifact = 'head' | 'tail' | null

type FragmentKind =
  | 'block'
  | 'list-chunk'
  | 'continuation'
  | 'split-part'
  | 'blockquote-split'
  | 'manual-pagebreak'

interface PageFragment {
  id: string
  kind: FragmentKind
  tag: string
  html: string
  sourceIndex: number
  estimatedHeight: number
  splitArtifact: SplitArtifact
  movable: boolean
  parentKind: 'root' | 'list' | 'blockquote'
  oversized?: boolean
  orderedListStart?: number
  orderedListCount?: number
}

interface PagePlan {
  fragments: PageFragment[]
  estimatedHeight: number
  oversized?: boolean
}

interface BreakBoundary {
  pageIndex: number
  reason: 'overflow' | 'heading-orphan' | 'list-flush' | 'manual'
  prevTailId: string | null
  nextHeadId: string | null
  remainingSpaceBeforeShift: number
  remainingSpaceAfterShift?: number
  revisitCount: number
  sensitive: boolean
}

// Fragment ID counter — reset each pagination call
let _fragIdCounter = 0
function nextFragId(): string {
  return `frag-${++_fragIdCounter}`
}

function isMovable(f: Pick<PageFragment, 'splitArtifact' | 'oversized'>): boolean {
  if (f.splitArtifact === 'head') return false
  if (f.oversized) return false
  return true
}

function renderPagePlan(plan: PagePlan): { html: string; oversized?: boolean } {
  return {
    html: plan.fragments.map(f => f.html).join(''),
    oversized: plan.oversized,
  }
}

// ── Pass 2 helpers ────────────────────────────────────────────────────────────

function computePageEstimatedHeight(plan: PagePlan): number {
  return plan.fragments.reduce((s, f) => s + f.estimatedHeight, 0)
}

function computeRemainingSpace(plan: PagePlan, contentH: number): number {
  return Math.max(0, contentH - computePageEstimatedHeight(plan))
}

function findFragmentById(pagePlans: PagePlan[], fragmentId: string): PageFragment | null {
  for (const plan of pagePlans) {
    for (const frag of plan.fragments) {
      if (frag.id === fragmentId) return frag
    }
  }
  return null
}

function updateOrderedListStartHtml(html: string, start: number): string {
  if (!/^<ol\b/i.test(html.trim())) return html
  if (/\sstart=/i.test(html)) {
    return html.replace(/\sstart="[^"]*"/i, ` start="${start}"`)
  }
  return html.replace(/^<ol\b/i, `<ol start="${start}"`)
}

function countTopLevelListItems(html: string): number {
  const container = document.createElement('div')
  container.innerHTML = html.trim()
  const list = container.firstElementChild as HTMLElement | null
  if (!list || !['ul', 'ol'].includes(list.tagName.toLowerCase())) return 0
  return Array.from(list.children).filter(
    (child) => child instanceof HTMLElement && child.tagName.toLowerCase() === 'li',
  ).length
}

/**
 * Renumber ordered list fragments across pages [fromPageIdx..toPageIdx].
 * For each `ol` sourceIndex found in this range, recomputes `start` attributes
 * so numbering is continuous across page splits.
 */
function renumberOrderedListFragments(
  pagePlans: PagePlan[],
  fromPageIdx: number,
  toPageIdx: number,
): PagePlan[] {
  const result = pagePlans.slice()
  const pageRange: number[] = []
  for (let i = fromPageIdx; i <= toPageIdx; i++) {
    if (i >= 0 && i < result.length) pageRange.push(i)
  }

  const impactedSources = new Set<number>()
  pageRange.forEach((pageIdx) => {
    result[pageIdx]?.fragments.forEach((frag) => {
      if (frag.tag === 'ol' && typeof frag.orderedListStart === 'number') {
        impactedSources.add(frag.sourceIndex)
      }
    })
  })

  if (impactedSources.size === 0) return result

  impactedSources.forEach((sourceIndex) => {
    const entries: Array<{ pageIdx: number; fragIdx: number; frag: PageFragment }> = []
    pageRange.forEach((pageIdx) => {
      result[pageIdx]?.fragments.forEach((frag, fragIdx) => {
        if (frag.tag === 'ol' && frag.sourceIndex === sourceIndex) entries.push({ pageIdx, fragIdx, frag })
      })
    })
    if (entries.length <= 1) return

    let runningStart = entries.reduce((min, entry) => Math.min(min, entry.frag.orderedListStart ?? 1), Number.POSITIVE_INFINITY)
    if (!Number.isFinite(runningStart)) runningStart = 1

    entries.forEach(({ pageIdx, fragIdx, frag }) => {
      const count = Math.max(1, frag.orderedListCount ?? 1)
      const nextFrag: PageFragment = {
        ...frag,
        orderedListStart: runningStart,
        html: updateOrderedListStartHtml(frag.html, runningStart),
      }
      const nextPlan = { ...result[pageIdx], fragments: result[pageIdx].fragments.slice() }
      nextPlan.fragments[fragIdx] = nextFrag
      result[pageIdx] = rebuildPagePlan(nextPlan)
      runningStart += count
    })
  })

  return result
}

function normalizeOrderedListFragmentsAroundBoundary(
  pagePlans: PagePlan[],
  boundaryIndex: number,
): PagePlan[] {
  return renumberOrderedListFragments(pagePlans, boundaryIndex, boundaryIndex + 1)
}

// ── Pass 2 action types ───────────────────────────────────────────────────────

type Pass2ActionKind = 'move-tail-to-next' | 'pull-head-to-prev'

interface Pass2Action {
  kind: Pass2ActionKind
  boundaryIndex: number
  fragmentId: string
}

// ── C+ Measurement infrastructure (Sprint C+1) ────────────────────────────────

interface MeasurementOpts {
  paperW: number
  paperH: number
  marginTop: number
  marginRight: number
  marginBottom: number
  marginLeft: number
}

interface MeasurementRoot {
  host: HTMLElement
  page: HTMLElement
  viewport: HTMLElement
  content: HTMLElement
}

interface MeasuredPlan {
  height: number
  remaining: number
  overflow: boolean
  firstHeadingTop?: number
}

function createMeasurementRoot(opts: MeasurementOpts): MeasurementRoot {
  const { paperW, paperH, marginTop, marginRight, marginBottom, marginLeft } = opts

  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-20000px;top:-20000px;visibility:hidden;pointer-events:none;'

  const page = document.createElement('div')
  page.className = 'preview-page'
  page.style.cssText = `width:${paperW}px;height:${paperH}px;overflow:hidden;`

  const viewport = document.createElement('div')
  viewport.className = 'page-viewport'
  viewport.style.cssText = `box-sizing:border-box;width:100%;height:100%;padding:${marginTop}px ${marginRight}px ${marginBottom}px ${marginLeft}px;`

  const content = document.createElement('div')
  content.className = 'preview-page-content'
  content.style.cssText = 'display:flow-root;padding-top:0.1px;padding-bottom:0.1px;'

  viewport.appendChild(content)
  page.appendChild(viewport)
  host.appendChild(page)
  document.body.appendChild(host)

  return { host, page, viewport, content }
}

function cleanupMeasurementRoot(root: MeasurementRoot): void {
  if (root.host.parentNode) {
    root.host.parentNode.removeChild(root.host)
  }
}

function renderFragmentsIntoMeasurementRoot(
  root: MeasurementRoot,
  fragments: PageFragment[],
): void {
  root.content.innerHTML = fragments.map(f => f.html).join('')
}

function measureRenderedFragments(root: MeasurementRoot, contentH: number): MeasuredPlan {
  const rect = root.content.getBoundingClientRect()
  const height = Math.round(rect.height)
  const remaining = Math.max(0, contentH - height)
  const overflow = height > contentH

  let firstHeadingTop: number | undefined
  const heading = root.content.querySelector<HTMLElement>('h1,h2,h3,h4,h5,h6')
  if (heading) {
    const headingRect = heading.getBoundingClientRect()
    firstHeadingTop = Math.round(headingRect.top - rect.top)
  }

  return { height, remaining, overflow, firstHeadingTop }
}

/** Wait for images/mermaid to settle, up to maxMs. Returns false on timeout. */
async function waitForAsyncContent(
  root: MeasurementRoot,
  maxMs = 200,
): Promise<boolean> {
  const images = Array.from(root.content.querySelectorAll<HTMLImageElement>('img'))
  const unloaded = images.filter(img => !img.complete)
  if (unloaded.length === 0) return true

  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), maxMs)
    let pending = unloaded.length
    const done = (): void => {
      pending--
      if (pending <= 0) {
        clearTimeout(timer)
        resolve(true)
      }
    }
    unloaded.forEach(img => {
      img.addEventListener('load', done, { once: true })
      img.addEventListener('error', done, { once: true })
    })
  })
}

/**
 * Measure a PagePlan by rendering it into a hidden DOM with the correct CSS context.
 * Returns null if async content did not settle (caller should fallback to heuristic).
 * Always cleans up via try/finally.
 */
async function measurePagePlan(
  plan: PagePlan,
  opts: MeasurementOpts,
): Promise<MeasuredPlan | null> {
  const contentH = opts.paperH - opts.marginTop - opts.marginBottom
  const root = createMeasurementRoot(opts)
  try {
    renderFragmentsIntoMeasurementRoot(root, plan.fragments)
    const hasAsync =
      root.content.querySelector('img') !== null ||
      root.content.querySelector('.mermaid') !== null
    if (hasAsync) {
      const settled = await waitForAsyncContent(root)
      if (!settled) return null
    }
    return measureRenderedFragments(root, contentH)
  } catch {
    return null
  } finally {
    cleanupMeasurementRoot(root)
  }
}

// ── C+ Candidate engine (Sprint C+2) ─────────────────────────────────────────

interface BoundaryCandidate {
  boundaryIndex: number
  kind: 'keep-as-is' | 'move-tail-to-next' | 'pull-head-to-prev'
  movedFragmentIds: string[]
}

interface MeasuredBoundaryResult {
  candidate: BoundaryCandidate
  pageNHeight: number
  pageN1Height: number
  pageNOverflow: boolean
  pageN1Overflow: boolean
  pageNRemaining: number
  pageN1Remaining: number
  pageNFirstHeadingTop?: number
  pageN1FirstHeadingTop?: number
  score: number
}

interface ScoringContext {
  contentH: number
  pass1PageCount: number
}

// ── C+ Hard constants (Sprint C+5 — consolidated) ────────────────────────────
// Propagation: page N overflow → always enqueue next boundary
const PROPAGATION_OVERFLOW_THRESHOLD = 0
// Propagation: page N+1 remaining > this → consider pull-up enqueue
const PROPAGATION_UNDERFILL_THRESHOLD = 200
// Max consecutive boundaries propagated in a single chain
const PROPAGATION_MAX_CHAIN = 3
// Seed threshold for "tiny tail" fragment — tune after baseline diff
const TINY_TAIL_MAX_HEIGHT = 60
// Performance: warn + fallback if one boundary's measurement loop > this ms
const MEASUREMENT_BATCH_WARN_MS = 50
// Skip measured eval if remaining space < this (no room to improve)
const MIN_REMAINING_SPACE_TO_MEASURE = 24
// Cap number of candidates measured per boundary
const MAX_CANDIDATES_PER_BOUNDARY = 3

// Seed scoring penalties — values are starting points, tune after baseline diff
const SCORE_PAGE_OVERFLOW       = 1000
const SCORE_PAGE_COUNT_INCREASE = 300
const SCORE_HEADING_ORPHAN      = 120
const SCORE_TINY_TAIL           = 100
const SCORE_GAP_WITH_SMALL_HEAD = 80
const SCORE_OL_RENUMBER         = 60
const SCORE_REMAINING_OFF_BAND  = 20

// Target remaining-space band considered "Chromium-like"
const REMAINING_BAND_MIN = 24
const REMAINING_BAND_MAX = 120

function isSensitiveBoundary(boundary: BreakBoundary, plans: PagePlan[]): boolean {
  if (boundary.reason === 'manual') return false
  if (boundary.reason === 'heading-orphan') return true
  if (boundary.reason === 'list-flush') return true
  if (boundary.reason === 'overflow') {
    const tail = boundary.prevTailId ? findFragmentById(plans, boundary.prevTailId) : null
    const head = boundary.nextHeadId ? findFragmentById(plans, boundary.nextHeadId) : null
    if (tail && (/^h[1-6]$/.test(tail.tag) || tail.kind === 'list-chunk' || tail.kind === 'continuation')) return true
    if (head && (/^h[1-6]$/.test(head.tag) || head.kind === 'list-chunk' || head.kind === 'continuation')) return true
  }
  return false
}

function generateBoundaryCandidates(
  pagePlans: PagePlan[],
  boundaryIndex: number,
): BoundaryCandidate[] {
  const candidates: BoundaryCandidate[] = []
  const pageN = pagePlans[boundaryIndex]
  const pageN1 = pagePlans[boundaryIndex + 1]
  if (!pageN || !pageN1) return candidates

  // Always generate keep-as-is
  candidates.push({ boundaryIndex, kind: 'keep-as-is', movedFragmentIds: [] })

  // move-tail-to-next: tail must be movable, page must not be left empty
  const tail = pageN.fragments.at(-1)
  if (tail && tail.movable && pageN.fragments.length > 1) {
    candidates.push({ boundaryIndex, kind: 'move-tail-to-next', movedFragmentIds: [tail.id] })
  }

  // pull-head-to-prev: movable head, not a split head, page N+1 must remain non-empty
  const head = pageN1.fragments[0]
  if (head && head.movable && head.splitArtifact !== 'head' && pageN1.fragments.length > 1) {
    candidates.push({ boundaryIndex, kind: 'pull-head-to-prev', movedFragmentIds: [head.id] })
  }

  return candidates
}

/**
 * Apply a candidate mutation to local page clones and measure both pages.
 * Returns null on measurement failure — caller must fallback to heuristic.
 * Uses try/finally internally via measurePagePlan.
 */
async function measureBoundaryCandidate(
  pagePlans: PagePlan[],
  candidate: BoundaryCandidate,
  opts: MeasurementOpts,
): Promise<MeasuredBoundaryResult | null> {
  const bIdx = candidate.boundaryIndex
  if (!pagePlans[bIdx] || !pagePlans[bIdx + 1]) return null

  // Clone local state — only pages N and N+1 are affected
  let pageN: PagePlan = { ...pagePlans[bIdx], fragments: pagePlans[bIdx].fragments.slice() }
  let pageN1: PagePlan = { ...pagePlans[bIdx + 1], fragments: pagePlans[bIdx + 1].fragments.slice() }

  // Apply candidate mutation
  if (candidate.kind === 'move-tail-to-next') {
    const tail = pageN.fragments.at(-1)
    if (!tail) return null
    pageN  = rebuildPagePlan({ ...pageN,  fragments: pageN.fragments.slice(0, -1) })
    pageN1 = rebuildPagePlan({ ...pageN1, fragments: [tail, ...pageN1.fragments] })
  } else if (candidate.kind === 'pull-head-to-prev') {
    const head = pageN1.fragments[0]
    if (!head || pageN1.fragments.length <= 1) return null
    pageN  = rebuildPagePlan({ ...pageN,  fragments: [...pageN.fragments, head] })
    pageN1 = rebuildPagePlan({ ...pageN1, fragments: pageN1.fragments.slice(1) })
  }
  // keep-as-is: no mutation

  const measN  = await measurePagePlan(pageN,  opts)
  const measN1 = await measurePagePlan(pageN1, opts)
  if (!measN || !measN1) return null

  return {
    candidate,
    pageNHeight:        measN.height,
    pageN1Height:       measN1.height,
    pageNOverflow:      measN.overflow,
    pageN1Overflow:     measN1.overflow,
    pageNRemaining:     measN.remaining,
    pageN1Remaining:    measN1.remaining,
    pageNFirstHeadingTop:  measN.firstHeadingTop,
    pageN1FirstHeadingTop: measN1.firstHeadingTop,
    score: 0,
  }
}

function scoreMeasuredBoundaryResult(
  result: MeasuredBoundaryResult,
  context: ScoringContext,
): number {
  let score = 0
  const { contentH } = context

  // Overflow is the hardest penalty
  if (result.pageNOverflow)  score += SCORE_PAGE_OVERFLOW
  if (result.pageN1Overflow) score += SCORE_PAGE_OVERFLOW

  // Heading orphan: heading sitting near the bottom of page N
  if (result.pageNFirstHeadingTop !== undefined && !result.pageNOverflow) {
    const distFromBottom = contentH - result.pageNFirstHeadingTop
    if (distFromBottom < 60) score += SCORE_HEADING_ORPHAN
  }

  // Tiny tail: content too short at end of page N
  if (!result.pageNOverflow && result.pageNHeight < TINY_TAIL_MAX_HEIGHT && result.pageNRemaining > contentH * 0.15) {
    score += SCORE_TINY_TAIL
  }

  // Large gap on page N but page N+1 starts with a small fragment
  if (result.pageNRemaining > REMAINING_BAND_MAX && result.pageN1Height < TINY_TAIL_MAX_HEIGHT && !result.pageN1Overflow) {
    score += SCORE_GAP_WITH_SMALL_HEAD
  }

  // Remaining space outside target band for page N
  if (!result.pageNOverflow) {
    if (result.pageNRemaining < REMAINING_BAND_MIN || result.pageNRemaining > REMAINING_BAND_MAX * 2) {
      score += SCORE_REMAINING_OFF_BAND
    }
  }

  return score
}

/**
 * Choose the best candidate from measured results.
 * Tie-breaking: keep-as-is preferred, then move-tail-to-next, then pull-head-to-prev.
 */
function chooseBestCandidate(results: MeasuredBoundaryResult[]): MeasuredBoundaryResult {
  if (results.length === 0) throw new Error('chooseBestCandidate: empty results')
  const kindOrder = (k: BoundaryCandidate['kind']): number =>
    k === 'keep-as-is' ? 0 : k === 'move-tail-to-next' ? 1 : 2
  return results.slice().sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    return kindOrder(a.candidate.kind) - kindOrder(b.candidate.kind)
  })[0]
}

// ── Pass 2 helpers ─────────────────────────────────────────────────────────────

/** Recalculate estimatedHeight from fragment sum. No DOM re-measure. */
function rebuildPagePlan(plan: PagePlan): PagePlan {
  return {
    ...plan,
    estimatedHeight: plan.fragments.reduce((s, f) => s + f.estimatedHeight, 0),
  }
}

/**
 * Move the tail fragment of page N (identified by boundary) to the head of page N+1.
 * Returns a new pagePlans array with pages N and N+1 rebuilt.
 * Returns null if the move is not possible (fragment not movable, etc.).
 */
function moveTailFragmentToNextPage(
  pagePlans: PagePlan[],
  boundaryIndex: number,
): PagePlan[] | null {
  const pageN = pagePlans[boundaryIndex]
  const pageN1 = pagePlans[boundaryIndex + 1]
  if (!pageN || !pageN1) return null

  const tail = pageN.fragments.at(-1)
  if (!tail || !tail.movable) return null

  // Remove tail from page N, prepend to page N+1
  const newPageN = rebuildPagePlan({
    ...pageN,
    fragments: pageN.fragments.slice(0, -1),
    oversized: pageN.oversized,
  })
  const newPageN1 = rebuildPagePlan({
    ...pageN1,
    fragments: [{ ...tail }, ...pageN1.fragments],
    oversized: pageN1.oversized,
  })

  // Page N must still have at least one fragment after move
  if (newPageN.fragments.length === 0) return null

  const result = pagePlans.slice()
  result[boundaryIndex] = newPageN
  result[boundaryIndex + 1] = newPageN1
  return result
}

/**
 * Check if the first fragment of page N+1 is eligible to be pulled up to page N.
 * Local check only: fragment must be movable and fit in remaining space.
 */
function isPullUpEligible(
  pagePlans: PagePlan[],
  boundaryIndex: number,
  contentH: number,
  boundaries?: BreakBoundary[],
): boolean {
  const pageN = pagePlans[boundaryIndex]
  const pageN1 = pagePlans[boundaryIndex + 1]
  if (!pageN || !pageN1) return false
  if (boundaries?.[boundaryIndex]?.reason === 'manual') return false

  const head = pageN1.fragments[0]
  if (!head) return false
  if (!head.movable) return false
  if (head.splitArtifact === 'head') return false

  const remaining = computeRemainingSpace(pageN, contentH)
  return head.estimatedHeight <= remaining && remaining > 0
}

// ── Pass 2 rule evaluators ────────────────────────────────────────────────────

/**
 * Rule 1: keep-with-next — heuristic version.
 * @deprecated C+3: replaced by measured candidate selection in rebalanceBoundaries.
 * Kept for reference only — no longer called in production path.
 */
function evaluateKeepWithNext(
  boundary: BreakBoundary,
  plans: PagePlan[],
): Pass2Action | null {
  if (!boundary.prevTailId) return null

  const tail = findFragmentById(plans, boundary.prevTailId)
  const nextHead = boundary.nextHeadId ? findFragmentById(plans, boundary.nextHeadId) : null
  if (!tail) return null
  if (!/^h[1-3]$/.test(tail.tag)) return null
  if (!tail.movable) return null
  if (!boundary.nextHeadId || !nextHead) return null
  if (boundary.reason === 'manual') return null
  if (/^h[1-3]$/.test(nextHead.tag)) return null

  return {
    kind: 'move-tail-to-next',
    boundaryIndex: boundary.pageIndex,
    fragmentId: tail.id,
  }
}

/**
 * Rule 2: avoid-tiny-tail — heuristic version.
 * @deprecated C+4: replaced by measured candidate selection in rebalanceBoundaries.
 * Kept for reference only — no longer called in production path.
 */
function evaluateAvoidTinyTail(
  boundary: BreakBoundary,
  plans: PagePlan[],
  contentH: number,
): Pass2Action | null {
  if (!boundary.prevTailId) return null

  const page = plans[boundary.pageIndex]
  if (!page || page.fragments.length <= 1) return null

  const tail = findFragmentById(plans, boundary.prevTailId)
  if (!tail) return null
  if (tail.kind !== 'list-chunk') return null
  if (!tail.movable) return null
  if (boundary.reason === 'manual') return null

  const tailHeight = tail.estimatedHeight
  if (tailHeight <= 0) return null

  const tinyTailThreshold = Math.round(contentH * 0.15)
  const remainingSpace = computeRemainingSpace(page, contentH)
  const topLevelItemCount = countTopLevelListItems(tail.html)

  const isTinyTail = tailHeight <= tinyTailThreshold
  const isSingleItemChunk = topLevelItemCount === 1
  const pageWasTight = remainingSpace <= Math.round(contentH * 0.08)
  if (!isTinyTail) return null
  if (!isSingleItemChunk) return null
  if (!pageWasTight) return null

  return {
    kind: 'move-tail-to-next',
    boundaryIndex: boundary.pageIndex,
    fragmentId: tail.id,
  }
}

// ── Pass 2 engine ─────────────────────────────────────────────────────────────

const PASS2_MAX_GLOBAL_PASSES = 2
const PASS2_MAX_REVISIT = 3

async function rebalanceBoundaries(
  pagePlans: PagePlan[],
  boundaries: BreakBoundary[],
  contentH: number,
  opts: MeasurementOpts,
  pushTrace: (event: Omit<PaginationTraceEvent, 'page'> & { page?: number }) => void,
): Promise<PagePlan[]> {
  if (pagePlans.length <= 1 || boundaries.length === 0) return pagePlans

  // Working copies — mutated during pass 2
  let plans = pagePlans.slice()
  const pass1PageCount = pagePlans.length

  // Dirty queue: indexes into boundaries[]
  const dirtyQueue: number[] = []
  const revisitCounts = new Map<number, number>()
  let globalPassCount = 0

  // Propagation chain tracking: maps bIdx → how many consecutive propagation hops it came from.
  // 0 = seeded directly; N = enqueued by a boundary that was at chain-length N-1.
  const propagationChain = new Map<number, number>()

  const enqueue = (bIdx: number, fromChain = 0): void => {
    if (bIdx < 0 || bIdx >= boundaries.length) return
    if (fromChain > PROPAGATION_MAX_CHAIN) {
      pushTrace({
        page: bIdx + 1,
        kind: 'pass2-propagation',
        tag: '',
        text: `boundary=${bIdx} enqueue skipped: chain cap ${PROPAGATION_MAX_CHAIN} reached (fromChain=${fromChain})`,
      })
      return
    }
    if (!dirtyQueue.includes(bIdx)) dirtyQueue.push(bIdx)
    // Record max chain length seen for this boundary
    const existing = propagationChain.get(bIdx) ?? 0
    if (fromChain > existing) propagationChain.set(bIdx, fromChain)
  }

  /**
   * Apply a Pass2Action. Returns true if applied, false if rejected.
   * Handles plan mutation, boundary refresh, and propagation enqueue.
   */
  const applyAction = (action: Pass2Action): boolean => {
    if (action.kind === 'move-tail-to-next') {
      const updated = moveTailFragmentToNextPage(plans, action.boundaryIndex)
      if (!updated) return false

      plans = normalizeOrderedListFragmentsAroundBoundary(updated, action.boundaryIndex)

      // Refresh boundary record for this index
      const bIdx = action.boundaryIndex
      const planN = plans[bIdx]
      const planN1 = plans[bIdx + 1]
      if (boundaries[bIdx]) {
        const refreshed: BreakBoundary = {
          ...boundaries[bIdx],
          prevTailId: planN.fragments.at(-1)?.id ?? null,
          nextHeadId: planN1?.fragments[0]?.id ?? null,
          remainingSpaceAfterShift: computeRemainingSpace(planN, contentH),
        }
        refreshed.sensitive = isSensitiveBoundary(refreshed, plans)
        boundaries[bIdx] = refreshed
      }

      pushTrace({
        page: bIdx + 1,
        kind: 'pass2-fragment-move',
        tag: action.fragmentId,
        text: `boundary=${bIdx} moved frag ${action.fragmentId} to page ${bIdx + 2}`,
        note: `remainingAfterShift=${boundaries[bIdx]?.remainingSpaceAfterShift ?? '?'}`,
      })

      // Propagation: overflow → always enqueue next boundary
      const planN1Height = computePageEstimatedHeight(planN1)
      const currentChain = propagationChain.get(bIdx) ?? 0
      if (planN1Height > contentH + PROPAGATION_OVERFLOW_THRESHOLD && bIdx + 1 < boundaries.length) {
        enqueue(bIdx + 1, currentChain + 1)
        pushTrace({
          page: bIdx + 2,
          kind: 'pass2-propagation',
          tag: '',
          text: `boundary=${bIdx + 1} enqueued (overflow): page ${bIdx + 2} estimatedHeight=${planN1Height} > contentH (chain=${currentChain + 1})`,
        })
      } else {
        // Underfill propagation: significant space on N+1, may pull-up
        const n1Remaining = computeRemainingSpace(plans[bIdx + 1] ?? { fragments: [], estimatedHeight: 0 }, contentH)
        if (n1Remaining > PROPAGATION_UNDERFILL_THRESHOLD && bIdx + 1 < boundaries.length) {
          enqueue(bIdx + 1, currentChain + 1)
          pushTrace({
            page: bIdx + 2,
            kind: 'pass2-propagation',
            tag: '',
            text: `boundary=${bIdx + 1} enqueued (underfill): page ${bIdx + 2} remaining=${n1Remaining} > threshold (chain=${currentChain + 1})`,
          })
        }
      }

      return true
    }

    if (action.kind === 'pull-head-to-prev') {
      const pageN  = plans[action.boundaryIndex]
      const pageN1 = plans[action.boundaryIndex + 1]
      if (!pageN || !pageN1) return false

      const head = pageN1.fragments.find(f => f.id === action.fragmentId)
      if (!head || !head.movable || head.splitArtifact === 'head') return false
      // pageN1 must not become empty after pull
      if (pageN1.fragments.length <= 1) return false

      const newPageN  = rebuildPagePlan({ ...pageN,  fragments: [...pageN.fragments, head] })
      const newPageN1 = rebuildPagePlan({ ...pageN1, fragments: pageN1.fragments.filter(f => f.id !== head.id) })

      const updated = plans.slice()
      updated[action.boundaryIndex]     = newPageN
      updated[action.boundaryIndex + 1] = newPageN1

      plans = renumberOrderedListFragments(updated, action.boundaryIndex - 1, action.boundaryIndex + 1)

      const bIdx   = action.boundaryIndex
      const planN  = plans[bIdx]
      const planN1 = plans[bIdx + 1]

      if (boundaries[bIdx]) {
        const refreshed: BreakBoundary = {
          ...boundaries[bIdx],
          prevTailId: planN.fragments.at(-1)?.id ?? null,
          nextHeadId: planN1?.fragments[0]?.id ?? null,
          remainingSpaceAfterShift: computeRemainingSpace(planN, contentH),
        }
        refreshed.sensitive = isSensitiveBoundary(refreshed, plans)
        boundaries[bIdx] = refreshed
      }

      pushTrace({
        page: bIdx + 1,
        kind: 'pass2-pull-up-applied',
        tag: action.fragmentId,
        text: `boundary=${bIdx} pulled head frag ${action.fragmentId} from page ${bIdx + 2} to page ${bIdx + 1}`,
        note: `remainingAfterShift=${boundaries[bIdx]?.remainingSpaceAfterShift ?? '?'}`,
      })

      // Propagation: overflow after pull → enqueue next boundary
      const planN1Height = computePageEstimatedHeight(planN1)
      const currentChainPull = propagationChain.get(bIdx) ?? 0
      if (planN1Height > contentH + PROPAGATION_OVERFLOW_THRESHOLD && bIdx + 1 < boundaries.length) {
        enqueue(bIdx + 1, currentChainPull + 1)
        pushTrace({
          page: bIdx + 2,
          kind: 'pass2-propagation',
          tag: '',
          text: `boundary=${bIdx + 1} enqueued after pull-up (overflow): page ${bIdx + 2} estimatedHeight=${planN1Height} (chain=${currentChainPull + 1})`,
        })
      }

      return true
    }

    return false
  }

  // Seed all boundaries — rules decide per-boundary if action applies
  for (let b = 0; b < boundaries.length; b++) enqueue(b, 0)

  // ── Main loop ──────────────────────────────────────────────────────────────
  outerLoop: while (dirtyQueue.length > 0 && globalPassCount < PASS2_MAX_GLOBAL_PASSES) {
    globalPassCount++

    // Drain the queue in index order this pass
    const pass = dirtyQueue.splice(0)
    pass.sort((a, b) => a - b)

    for (const bIdx of pass) {
      if (boundaries[bIdx]?.reason === 'manual') {
        pushTrace({
          page: bIdx + 1,
          kind: 'pass2-skip-nonmovable',
          tag: '',
          text: `boundary=${bIdx} skipped because reason=manual`,
        })
        continue
      }

      // Revisit cap
      const visits = (revisitCounts.get(bIdx) ?? 0) + 1
      revisitCounts.set(bIdx, visits)

      if (visits > PASS2_MAX_REVISIT) {
        pushTrace({
          page: bIdx + 1,
          kind: 'pass2-depth-limit-hit',
          tag: '',
          text: `boundary=${bIdx} hit revisit cap (${visits} > ${PASS2_MAX_REVISIT}), skipping`,
        })
        continue
      }

      pushTrace({
        page: bIdx + 1,
        kind: 'pass2-boundary-check',
        tag: '',
        text: `boundary=${bIdx} reason=${boundaries[bIdx]?.reason} visit=${visits} sensitive=${boundaries[bIdx]?.sensitive ?? false}`,
      })

      // ── C+5 performance guards ─────────────────────────────────────────────
      // Gate 1: only measured-evaluate sensitive boundaries
      if (!boundaries[bIdx]?.sensitive) {
        pushTrace({
          page: bIdx + 1,
          kind: 'pass2-skip-nonmovable',
          tag: '',
          text: `boundary=${bIdx} skipped: not sensitive`,
        })
        continue
      }

      // Gate 2: skip if remaining space too small to improve anything
      const pageAtBoundary = plans[bIdx]
      const remainingAtBoundary = pageAtBoundary
        ? computeRemainingSpace(pageAtBoundary, contentH)
        : 0
      if (remainingAtBoundary < MIN_REMAINING_SPACE_TO_MEASURE) {
        pushTrace({
          page: bIdx + 1,
          kind: 'pass2-skip-nonmovable',
          tag: '',
          text: `boundary=${bIdx} skipped: remaining=${remainingAtBoundary} < MIN_REMAINING_SPACE_TO_MEASURE=${MIN_REMAINING_SPACE_TO_MEASURE}`,
        })
        continue
      }

      // Gate 3: skip only if neither page N tail nor page N+1 head can participate.
      const hasTailMovable = (pageAtBoundary?.fragments.at(-1)?.movable) ?? false
      const hasHeadMovable = (plans[bIdx + 1]?.fragments[0]?.movable) ?? false
      if (!hasTailMovable && !hasHeadMovable) {
        pushTrace({
          page: bIdx + 1,
          kind: 'pass2-skip-nonmovable',
          tag: '',
          text: `boundary=${bIdx} skipped: neither tail nor next-head movable`,
        })
        continue
      }

      // C+3: measured keep-with-next replaces heuristic rule 1
      // Eligibility: prevTail is h1-h3, movable, nextHead exists and is not another heading
      const isKeepWithNextEligible = (): boolean => {
        const b = boundaries[bIdx]
        if (!b?.prevTailId || b.reason === 'manual') return false
        const tail = findFragmentById(plans, b.prevTailId)
        if (!tail || !/^h[1-3]$/.test(tail.tag) || !tail.movable) return false
        if (!b.nextHeadId) return false
        const nextHead = findFragmentById(plans, b.nextHeadId)
        return !!nextHead && !/^h[1-3]$/.test(nextHead.tag)
      }

      // C+4: measured avoid-tiny-tail — list-chunk tail that is too short at page bottom
      const isAvoidTinyTailEligible = (): boolean => {
        const b = boundaries[bIdx]
        if (!b?.prevTailId || b.reason === 'manual') return false
        const page = plans[bIdx]
        if (!page || page.fragments.length <= 1) return false
        const tail = findFragmentById(plans, b.prevTailId)
        if (!tail || tail.kind !== 'list-chunk' || !tail.movable) return false
        if (countTopLevelListItems(tail.html) !== 1) return false
        const remainingSpace = computeRemainingSpace(page, contentH)
        const pageWasTight = remainingSpace <= Math.round(contentH * 0.08)
        return tail.estimatedHeight <= TINY_TAIL_MAX_HEIGHT && pageWasTight
      }

      let action: Pass2Action | null = null

      /**
       * Shared measured candidate evaluation path (used by both keep-with-next and avoid-tiny-tail).
       * Returns the chosen action or null (keep-as-is).
       * Includes batch timing guardrail and candidate-level rollback.
       */
      const runMeasuredPath = async (rule: string): Promise<Pass2Action | null> => {
        const allCandidates = generateBoundaryCandidates(plans, bIdx)
        // Cap to MAX_CANDIDATES_PER_BOUNDARY
        const candidates = allCandidates.slice(0, MAX_CANDIDATES_PER_BOUNDARY)

        pushTrace({
          page: bIdx + 1,
          kind: 'pass2-candidate-generated',
          tag: '',
          text: `boundary=${bIdx} ${rule}: ${candidates.length} candidates [${candidates.map(c => c.kind).join(', ')}]`,
        })

        const results: MeasuredBoundaryResult[] = []
        let batchTimedOut = false
        const batchStart = performance.now()

        for (const candidate of candidates) {
          // Batch timer guard: stop measured eval if over budget
          if (performance.now() - batchStart > MEASUREMENT_BATCH_WARN_MS) {
            batchTimedOut = true
            pushTrace({
              page: bIdx + 1,
              kind: 'pass2-measure-timeout',
              tag: '',
              text: `boundary=${bIdx} batch timer exceeded ${MEASUREMENT_BATCH_WARN_MS}ms after ${results.length} candidates — falling back heuristic for remainder`,
            })
            break
          }

          let r: MeasuredBoundaryResult | null = null
          try {
            r = await measureBoundaryCandidate(plans, candidate, opts)
          } catch (err) {
            pushTrace({
              page: bIdx + 1,
              kind: 'pass2-measure-fallback-async',
              tag: candidate.kind,
              text: `boundary=${bIdx} candidate=${candidate.kind} threw exception: ${String(err)}`,
            })
            r = null
          }

          if (r !== null) {
            r.score = scoreMeasuredBoundaryResult(r, { contentH, pass1PageCount })
            results.push(r)
            pushTrace({
              page: bIdx + 1,
              kind: 'pass2-candidate-measured',
              tag: candidate.kind,
              text: `boundary=${bIdx} candidate=${candidate.kind} score=${r.score} remaining=${r.pageNRemaining} overflow=${r.pageNOverflow}`,
            })
          } else {
            pushTrace({
              page: bIdx + 1,
              kind: batchTimedOut ? 'pass2-measure-timeout' : 'pass2-measure-fallback-async',
              tag: candidate.kind,
              text: `boundary=${bIdx} candidate=${candidate.kind} measure returned null (async content not settled)`,
            })
            pushTrace({
              page: bIdx + 1,
              kind: 'pass2-candidate-rejected',
              tag: candidate.kind,
              text: `boundary=${bIdx} candidate=${candidate.kind} measure failed — excluded from selection`,
            })
          }
        }

        if (results.length === 0) {
          // All measurements failed → keep-as-is (failure-level rollback)
          pushTrace({
            page: bIdx + 1,
            kind: 'pass2-rollback-keep-as-is',
            tag: '',
            text: `boundary=${bIdx} all measurements failed, keeping as-is (failure-level rollback)`,
          })
          return null
        }

        const best = chooseBestCandidate(results)
        const keepAsIsResult = results.find(r => r.candidate.kind === 'keep-as-is')

        // Candidate-level rollback: if best score ≥ keep-as-is score → prefer keep-as-is
        if (keepAsIsResult && best.score >= keepAsIsResult.score && best.candidate.kind !== 'keep-as-is') {
          pushTrace({
            page: bIdx + 1,
            kind: 'pass2-rollback-keep-as-is',
            tag: '',
            text: `boundary=${bIdx} best=${best.candidate.kind}(${best.score}) >= keep-as-is(${keepAsIsResult.score}), rolling back to keep-as-is`,
          })
          return null
        }

        pushTrace({
          page: bIdx + 1,
          kind: 'pass2-candidate-selected',
          tag: best.candidate.kind,
          text: `boundary=${bIdx} selected=${best.candidate.kind} score=${best.score}`,
          note: results.map(r => `${r.candidate.kind}=${r.score}`).join(' '),
        })

        if (best.candidate.kind === 'keep-as-is') return null

        if (best.candidate.kind === 'move-tail-to-next') {
          const frag = plans[bIdx]?.fragments.at(-1)
          if (frag) return { kind: 'move-tail-to-next', boundaryIndex: bIdx, fragmentId: frag.id }
        } else if (best.candidate.kind === 'pull-head-to-prev') {
          const head = plans[bIdx + 1]?.fragments[0]
          if (head) return { kind: 'pull-head-to-prev', boundaryIndex: bIdx, fragmentId: head.id }
        }
        return null
      }

      if (isKeepWithNextEligible()) {
        action = await runMeasuredPath('keep-with-next')
      } else if (isAvoidTinyTailEligible()) {
        action = await runMeasuredPath('avoid-tiny-tail')
      }
      // else: no applicable rule — action stays null

      if (!action) {
        pushTrace({
          page: bIdx + 1,
          kind: 'pass2-skip-nonmovable',
          tag: '',
          text: `boundary=${bIdx} no applicable rule`,
        })
        continue
      }

      const applied = applyAction(action)
      if (!applied) {
        pushTrace({
          page: bIdx + 1,
          kind: 'pass2-skip-nonmovable',
          tag: '',
          text: `boundary=${bIdx} action rejected by move helper`,
        })
      } else {
        // C+6 trace: local re-render of affected pages after committing action
        pushTrace({
          page: bIdx + 1,
          kind: 'pass2-local-rerender',
          tag: action.kind,
          text: `boundary=${bIdx} local plans updated after ${action.kind} commit (pages ${bIdx + 1}–${bIdx + 2})`,
        })
      }

      // Global cap check
      if (globalPassCount >= PASS2_MAX_GLOBAL_PASSES && dirtyQueue.length > 0) {
        pushTrace({
          page: bIdx + 1,
          kind: 'pass2-depth-limit-hit',
          tag: '',
          text: `Global pass cap (${PASS2_MAX_GLOBAL_PASSES}) reached, stopping pass 2`,
        })
        break outerLoop
      }
    }
  }

  // ── Pass-level rollback safety net (C+5) ──────────────────────────────────
  // If pass 2 created more than 2 extra pages vs pass 1 → revert to pass 1 plans
  if (plans.length > pass1PageCount + 2) {
    pushTrace({
      page: plans.length,
      kind: 'pass2-rollback-pass1',
      tag: '',
      text: `pass2 pageCount=${plans.length} > pass1 pageCount=${pass1PageCount} + 2 — rolling back to pass 1`,
    })
    return pagePlans // return original pass 1 plans
  }

  return plans
}

// ─────────────────────────────────────────────────────────────────────────────

interface PaginationTraceEvent {
  page: number
  kind: string
  tag: string
  top?: number
  bottom?: number
  relBottom?: number
  spaceLeft?: number
  contentH?: number
  success?: boolean
  text: string
  note?: string
  meta?: string
}

interface PaginationTrace {
  generatedAt: string
  paperWidth: number
  paperHeight: number
  contentHeight: number
  margins: {
    top: number
    right: number
    bottom: number
    left: number
  }
  totalPages: number
  events: PaginationTraceEvent[]
}

let _lastPaginationTrace: PaginationTrace | null = null
let _lastPages: Array<{ html: string; oversized?: boolean }> = []

// ── Public API ────────────────────────────────────────────────────────────────

export function applyPreviewLayout(
  paperSize: 'A4' | 'A3' | 'Letter',
  orientation: 'portrait' | 'landscape',
): void {
  const [pw, ph] = PAPER_SIZES[paperSize] ?? PAPER_SIZES['A4']
  const [width, height] = orientation === 'landscape' ? [ph, pw] : [pw, ph]
  const root = document.documentElement
  root.style.setProperty('--paper-width', `${width}px`)
  root.style.setProperty('--paper-height', `${height}px`)

  // Re-paginate with new dimensions if content already rendered (bypass debounce)
  if (_lastMarkdown) {
    _lastContentHash = '' // force re-render
    renderAndPaginate(_lastMarkdown)
  }
}

export function setPreviewTypographer(enabled: boolean): void {
  markdownEngine.setTypographer(enabled)
  if (_lastMarkdown) {
    _lastContentHash = ''
    renderAndPaginate(_lastMarkdown)
  }
}

export function initPreview(settings: AppSettings): void {
  // Set initial typographer state
  markdownEngine.setTypographer(settings.smartQuotes ?? true)
  installPreviewDebugHook()

  const previewPanel = document.getElementById('preview-panel')
  previewPanel?.addEventListener('scroll', () => {
    const maxScrollTop = Math.max(previewPanel.scrollHeight - previewPanel.clientHeight, 0)
    const scrollRatio = maxScrollTop === 0 ? 0 : previewPanel.scrollTop / maxScrollTop
    window.vanfolioAPI.sendPreviewScroll({ scrollRatio, fileKey: _currentFileKey })
  }, { passive: true })

  // Listen for active file changes to update base path for images and fileKey routing
  window.addEventListener('app:activeFile', (e: Event) => {
    const detail = (e as CustomEvent<{ path: string | null; fileKey: string | null }>).detail
    _currentFilePath = detail.path
    if (detail.fileKey) _currentFileKey = detail.fileKey
    // If content exists, re-render to apply new base path to images (bypass debounce)
    if (_lastMarkdown) {
      _lastContentHash = ''
      renderAndPaginate(_lastMarkdown)
    }
  })
}

function summarizeText(text: string, max = 120): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}…`
}

function downloadTextFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function downloadHtmlFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function getDocTokenCssValue(name: string): string | undefined {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || undefined
}

function getDocTokenNumber(name: string, fallback: number): number {
  const raw = getDocTokenCssValue(name)
  const parsed = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

function resolveCurrentDocTokens(): DocTokens {
  return {
    heading: getDocTokenCssValue('--doc-heading') ?? '#775a00',
    accent: getDocTokenCssValue('--doc-accent') ?? '#c59b27',
    text: getDocTokenCssValue('--doc-text') ?? getDocTokenCssValue('--text-ink') ?? '#1a1c1a',
    bg: getDocTokenCssValue('--doc-bg') ?? getDocTokenCssValue('--bg-app') ?? '#fdfcfb',
    surface: getDocTokenCssValue('--doc-surface') ?? getDocTokenCssValue('--cream') ?? '#ffffff',
    border: getDocTokenCssValue('--doc-border') ?? '#d1c5af',
    borderSubtle: getDocTokenCssValue('--doc-border-subtle') ?? 'rgba(0,0,0,0.08)',
    codeBg: getDocTokenCssValue('--doc-code-bg') ?? '#efeeeb',
    marginTop: getDocTokenNumber('--paper-margin-top', 76),
    marginRight: getDocTokenNumber('--paper-margin-right', 83),
    marginBottom: getDocTokenNumber('--paper-margin-bottom', 76),
    marginLeft: getDocTokenNumber('--paper-margin-left', 83),
    previewBaseFontSize: getDocTokenNumber('--preview-base-size', 15),
    previewLineHeight: parseFloat(getDocTokenCssValue('--preview-line-height') ?? '1.8'),
    paperWidth: getDocTokenNumber('--paper-width', 794),
    paperHeight: getDocTokenNumber('--paper-height', 1123),
    previewFontFamily: getDocTokenCssValue('--font-preview') ?? "'Newsreader', 'Georgia', serif",
    previewHeadingFont: getDocTokenCssValue('--font-heading') ?? getDocTokenCssValue('--font-preview') ?? "'Newsreader', 'Georgia', serif",
    h1Size: getDocTokenCssValue('--preview-h1-size') ?? '33.8px',
    h2Size: getDocTokenCssValue('--preview-h2-size') ?? '22.5px',
    h3Size: getDocTokenCssValue('--preview-h3-size') ?? '18.8px',
    h4Size: getDocTokenCssValue('--preview-h4-size') ?? '16.5px',
    h5Size: getDocTokenCssValue('--preview-h5-size') ?? '15px',
    paragraphSpacing: getDocTokenCssValue('--preview-paragraph-spacing') ?? '0.8em',
    printBaseFontSize: getDocTokenCssValue('--print-base-size') ?? '11pt',
    printLineHeight: getDocTokenCssValue('--print-line-height') ?? '1.72',
    printMarginTop: getDocTokenCssValue('--print-margin-top') ?? '20mm',
    printMarginRight: getDocTokenCssValue('--print-margin-right') ?? '22mm',
    printMarginBottom: getDocTokenCssValue('--print-margin-bottom') ?? '20mm',
    printMarginLeft: getDocTokenCssValue('--print-margin-left') ?? '22mm',
    printH1Size: getDocTokenCssValue('--print-h1-size') ?? '22pt',
    printH2Size: getDocTokenCssValue('--print-h2-size') ?? '17pt',
    printH3Size: getDocTokenCssValue('--print-h3-size') ?? '13pt',
    printH4Size: getDocTokenCssValue('--print-h4-size') ?? '11pt',
    printH5Size: getDocTokenCssValue('--print-h5-size') ?? '10pt',
    printParagraphSpacing: getDocTokenCssValue('--print-paragraph-spacing') ?? '0.8em',
  }
}

async function resolvePdfDebugOptions(): Promise<ExportOptions | null> {
  const { path: filePath, markdown } = getActiveTabInfo()
  if (!filePath || !markdown.trim()) return null

  const settings = await window.vanfolioAPI.getSettings()
  const liveSettings: Partial<AppSettings> = {
    ...settings,
    previewBaseFontSize: getDocTokenNumber('--preview-base-size', settings.previewBaseFontSize ?? 15),
    previewLineHeight: parseFloat(getDocTokenCssValue('--preview-line-height') ?? `${settings.previewLineHeight ?? 1.8}`),
    paragraphSpacing: parseFloat((getDocTokenCssValue('--preview-paragraph-spacing') ?? `${settings.paragraphSpacing ?? 0.8}em`).replace(/em$/i, '')),
    paperSize: settings.paperSize,
    paperOrientation: settings.paperOrientation,
    pageMarginTop: getDocTokenNumber('--paper-margin-top', settings.pageMarginTop ?? 20),
    pageMarginRight: getDocTokenNumber('--paper-margin-right', settings.pageMarginRight ?? 22),
    pageMarginBottom: getDocTokenNumber('--paper-margin-bottom', settings.pageMarginBottom ?? 20),
    pageMarginLeft: getDocTokenNumber('--paper-margin-left', settings.pageMarginLeft ?? 22),
  }

  return {
    markdown,
    renderedHtml: getMasterHtml(),
    filePath,
    format: 'pdf',
    liveSettings,
    includeToc: false,
    includePageNumbers: false,
    colorMode: 'color',
    docTokens: resolveCurrentDocTokens(),
  }
}

async function analyzePdfHtmlInIframe(
  html: string,
  options: {
    selector: string
    includeLines: boolean
    pageHeight: number
    pageWidth: number
    marginTop: number
    marginBottom: number
    marginLeft: number
    marginRight: number
  },
): Promise<string> {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = `position:fixed;left:-20000px;top:-20000px;width:${options.pageWidth}px;height:${options.pageHeight}px;visibility:hidden;pointer-events:none;`
  document.body.appendChild(iframe)

  try {
    const loaded = new Promise<void>((resolve, reject) => {
      iframe.onload = () => resolve()
      iframe.onerror = () => reject(new Error('PDF debug iframe load failed'))
    })
    iframe.srcdoc = html
    await loaded

    const doc = iframe.contentDocument
    const win = iframe.contentWindow
    if (!doc || !win) throw new Error('PDF debug iframe document unavailable')

    if ('fonts' in doc) {
      await doc.fonts.ready
    }

    await new Promise(resolve => win.requestAnimationFrame(() => resolve(undefined)))

    const root = doc.querySelector<HTMLElement>('.chromium-truth-content') ?? doc.body
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(options.selector))
    const lines: string[] = []
    const contentHeight = options.pageHeight - options.marginTop - options.marginBottom

    lines.push('VanFolio PDF Debug Dump')
    lines.push(`Generated: ${new Date().toISOString()}`)
    lines.push(`Selector: ${options.selector}`)
    lines.push(`page.width=${options.pageWidth} page.height=${options.pageHeight}`)
    lines.push(`margins.top=${options.marginTop} margins.right=${options.marginRight} margins.bottom=${options.marginBottom} margins.left=${options.marginLeft}`)
    lines.push(`content.height=${contentHeight}`)
    lines.push(`blocks=${blocks.length}`)
    lines.push('')

    const rootRect = root.getBoundingClientRect()
    blocks.forEach((block, blockIndex) => {
      const rect = block.getBoundingClientRect()
      const top = Math.round(rect.top - rootRect.top)
      const bottom = Math.round(rect.bottom - rootRect.top)
      const pageStart = Math.floor(top / contentHeight) + 1
      const pageEnd = Math.floor(Math.max(bottom - 1, top) / contentHeight) + 1
      lines.push(`[BLOCK ${blockIndex}] <${block.tagName.toLowerCase()}> top=${top} bottom=${bottom} height=${Math.round(rect.height)} pageStart=${pageStart} pageEnd=${pageEnd}`)
      lines.push(`text=${(block.textContent ?? '').replace(/\s+/g, ' ').trim()}`)

      if (options.includeLines) {
        const range = doc.createRange()
        range.selectNodeContents(block)
        const rects = Array.from(range.getClientRects())
        lines.push(`lineRects=${rects.length}`)
        rects.forEach((r, lineIndex) => {
          const lineTop = Math.round(r.top - rootRect.top)
          const lineBottom = Math.round(r.bottom - rootRect.top)
          const linePage = Math.floor(lineTop / contentHeight) + 1
          lines.push(`  [line ${lineIndex}] top=${lineTop} bottom=${lineBottom} height=${Math.round(r.height)} width=${Math.round(r.width)} page=${linePage}`)
        })
      }

      lines.push('')
    })

    return lines.join('\n')
  } finally {
    document.body.removeChild(iframe)
  }
}

function installPreviewDebugHook(): void {
  ; (window as Window & Record<string, unknown>)[PREVIEW_DEBUG_FN] = (options?: {
    page?: number
    selector?: string
    includeLines?: boolean
  }) => {
    const pageIndex = Math.max(1, options?.page ?? 1) - 1
    const selector = options?.selector ?? 'p, li, blockquote, h1, h2, h3, h4, h5, h6'
    const includeLines = options?.includeLines ?? true

    const previewContent = document.getElementById('preview-content')
    if (!previewContent) {
      console.warn('[PreviewDebug] #preview-content not found')
      return null
    }

    const pages = Array.from(previewContent.querySelectorAll<HTMLElement>('.preview-page'))
    const page = pages[pageIndex]
    if (!page) {
      console.warn(`[PreviewDebug] page ${pageIndex + 1} not found; total pages = ${pages.length}`)
      return null
    }

    const viewport = page.querySelector<HTMLElement>('.page-viewport')
    const content = page.querySelector<HTMLElement>('.preview-page-content')
    if (!viewport || !content) {
      console.warn('[PreviewDebug] page viewport/content missing')
      return null
    }

    const viewportRect = viewport.getBoundingClientRect()
    const contentRect = content.getBoundingClientRect()
    const blocks = Array.from(content.querySelectorAll<HTMLElement>(selector))

    const blockSummaries = blocks.map((block, i) => {
      const rect = block.getBoundingClientRect()
      const top = Math.round(rect.top - viewportRect.top)
      const bottom = Math.round(rect.bottom - viewportRect.top)
      const height = Math.round(rect.height)
      const text = (block.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)

      let lineRects: Array<{ top: number; bottom: number; height: number; width: number }> | undefined
      if (includeLines) {
        const range = document.createRange()
        range.selectNodeContents(block)
        const rects = Array.from(range.getClientRects())
        lineRects = rects.map((r) => ({
          top: Math.round(r.top - viewportRect.top),
          bottom: Math.round(r.bottom - viewportRect.top),
          height: Math.round(r.height),
          width: Math.round(r.width),
        }))
      }

      return {
        index: i,
        tag: block.tagName.toLowerCase(),
        top,
        bottom,
        height,
        lines: lineRects?.length ?? 0,
        text,
        lineRects,
      }
    })

    const result = {
      page: pageIndex + 1,
      totalPages: pages.length,
      selector,
      viewport: {
        height: Math.round(viewportRect.height),
        width: Math.round(viewportRect.width),
      },
      content: {
        height: Math.round(contentRect.height),
        overflowVsViewport: Math.round(contentRect.height - viewportRect.height),
      },
      blocks: blockSummaries,
    }

    console.groupCollapsed(`[PreviewDebug] page=${result.page}/${result.totalPages} blocks=${result.blocks.length}`)
    console.table(result.blocks.map((b) => ({
      index: b.index,
      tag: b.tag,
      top: b.top,
      bottom: b.bottom,
      height: b.height,
      lines: b.lines,
      text: b.text,
    })))
    if (includeLines) {
      result.blocks.forEach((b) => {
        if (!b.lineRects || b.lineRects.length === 0) return
        console.groupCollapsed(`[PreviewDebug] block #${b.index} <${b.tag}> lines=${b.lineRects.length}`)
        console.table(b.lineRects.map((line, lineIndex) => ({ line: lineIndex, ...line })))
        console.groupEnd()
      })
    }
    console.groupEnd()

    return result
  }

  console.info(`[PreviewDebug] DevTools command ready: window.${PREVIEW_DEBUG_FN}({ page: 1, selector: 'p, li, blockquote', includeLines: true })`)

  ; (window as Window & Record<string, unknown>)[PREVIEW_DUMP_FN] = (options?: {
    selector?: string
    includeLines?: boolean
    download?: boolean
  }) => {
    const selector = options?.selector ?? 'p, li, blockquote, h1, h2, h3, h4, h5, h6'
    const includeLines = options?.includeLines ?? true
    const shouldDownload = options?.download ?? true

    const previewContent = document.getElementById('preview-content')
    if (!previewContent) {
      console.warn('[PreviewDebug] #preview-content not found')
      return null
    }

    const pages = Array.from(previewContent.querySelectorAll<HTMLElement>('.preview-page'))
    const lines: string[] = []
    lines.push('VanFolio Preview Debug Dump')
    lines.push(`Generated: ${new Date().toISOString()}`)
    lines.push(`Total pages: ${pages.length}`)
    lines.push(`Selector: ${selector}`)
    lines.push('')

    pages.forEach((page, pageIndex) => {
      const viewport = page.querySelector<HTMLElement>('.page-viewport')
      const content = page.querySelector<HTMLElement>('.preview-page-content')
      if (!viewport || !content) return

      const viewportRect = viewport.getBoundingClientRect()
      const contentRect = content.getBoundingClientRect()
      const blocks = Array.from(content.querySelectorAll<HTMLElement>(selector))

      lines.push(`=== PAGE ${pageIndex + 1}/${pages.length} ===`)
      lines.push(`viewport.height=${Math.round(viewportRect.height)} viewport.width=${Math.round(viewportRect.width)}`)
      lines.push(`content.height=${Math.round(contentRect.height)} overflowVsViewport=${Math.round(contentRect.height - viewportRect.height)}`)
      lines.push(`blocks=${blocks.length}`)
      lines.push('')

      blocks.forEach((block, blockIndex) => {
        const rect = block.getBoundingClientRect()
        const top = Math.round(rect.top - viewportRect.top)
        const bottom = Math.round(rect.bottom - viewportRect.top)
        const height = Math.round(rect.height)
        const text = (block.textContent ?? '').replace(/\s+/g, ' ').trim()
        lines.push(`[BLOCK ${blockIndex}] <${block.tagName.toLowerCase()}> top=${top} bottom=${bottom} height=${height}`)
        lines.push(text ? `text=${text}` : 'text=')

        if (includeLines) {
          const range = document.createRange()
          range.selectNodeContents(block)
          const rects = Array.from(range.getClientRects())
          lines.push(`lineRects=${rects.length}`)
          rects.forEach((r, lineIndex) => {
            lines.push(
              `  [line ${lineIndex}] top=${Math.round(r.top - viewportRect.top)} bottom=${Math.round(r.bottom - viewportRect.top)} height=${Math.round(r.height)} width=${Math.round(r.width)}`
            )
          })
        }

        lines.push('')
      })
    })

    const output = lines.join('\n')

    if (shouldDownload) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      downloadTextFile(output, `vanfolio-preview-debug-${stamp}.txt`)
      console.info(`[PreviewDebug] Dump downloaded via window.${PREVIEW_DUMP_FN}()`)
    } else {
      console.info(`[PreviewDebug] Dump generated without download via window.${PREVIEW_DUMP_FN}({ download: false })`)
    }

    return output
  }

  console.info(`[PreviewDebug] DevTools dump ready: window.${PREVIEW_DUMP_FN}({ selector: 'p, li, blockquote', includeLines: true })`)

  ; (window as Window & Record<string, unknown>)[PREVIEW_TOP_GAP_DEBUG_FN] = (options?: {
    page?: number
  }) => {
    const pageIndex = Math.max(1, options?.page ?? 1) - 1
    const previewContent = document.getElementById('preview-content')
    if (!previewContent) {
      console.warn('[PreviewDebug] #preview-content not found')
      return null
    }

    const pages = Array.from(previewContent.querySelectorAll<HTMLElement>('.preview-page'))
    const page = pages[pageIndex]
    if (!page) {
      console.warn(`[PreviewDebug] page ${pageIndex + 1} not found; total pages = ${pages.length}`)
      return null
    }

    const viewport = page.querySelector<HTMLElement>('.page-viewport')
    const content = page.querySelector<HTMLElement>('.preview-page-content')
    if (!viewport || !content) {
      console.warn('[PreviewDebug] page viewport/content missing')
      return null
    }

    const viewportRect = viewport.getBoundingClientRect()
    const contentRect = content.getBoundingClientRect()
    const children = Array.from(content.children) as HTMLElement[]
    const firstElement = children[0] ?? null
    const firstRect = firstElement?.getBoundingClientRect()
    const topGap = firstRect ? Math.round(firstRect.top - viewportRect.top) : Math.round(contentRect.top - viewportRect.top)

    const serializeStyle = (el: HTMLElement | null) => {
      if (!el) return null
      const style = getComputedStyle(el)
      return {
        tag: el.tagName.toLowerCase(),
        className: el.className,
        top: Math.round(el.getBoundingClientRect().top - viewportRect.top),
        bottom: Math.round(el.getBoundingClientRect().bottom - viewportRect.top),
        height: Math.round(el.getBoundingClientRect().height),
        marginTop: style.marginTop,
        marginBottom: style.marginBottom,
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        borderTopWidth: style.borderTopWidth,
        display: style.display,
        position: style.position,
        listStyleType: style.listStyleType,
        text: summarizeText(el.textContent ?? '', 140),
      }
    }

    const precedingNodes = firstElement
      ? Array.from(content.childNodes)
          .slice(0, Array.from(content.childNodes).indexOf(firstElement))
          .map((node, index) => {
            if (node.nodeType === Node.TEXT_NODE) {
              return {
                index,
                type: 'text',
                text: summarizeText(node.textContent ?? '', 120),
                length: node.textContent?.length ?? 0,
              }
            }
            if (node instanceof HTMLElement) {
              return {
                index,
                type: 'element',
                tag: node.tagName.toLowerCase(),
                className: node.className,
                text: summarizeText(node.textContent ?? '', 120),
              }
            }
            return {
              index,
              type: `nodeType-${node.nodeType}`,
            }
          })
      : []

    const ancestorChain: Array<Record<string, unknown>> = []
    let current: HTMLElement | null = firstElement
    while (current && current !== content) {
      ancestorChain.push(serializeStyle(current) as Record<string, unknown>)
      current = current.parentElement
    }

    const result = {
      page: pageIndex + 1,
      totalPages: pages.length,
      viewportHeight: Math.round(viewportRect.height),
      contentHeight: Math.round(contentRect.height),
      topGap,
      firstElement: serializeStyle(firstElement),
      contentStyle: serializeStyle(content),
      precedingNodes,
      ancestorChain,
    }

    console.groupCollapsed(`[PreviewDebug] top-gap page=${result.page}/${result.totalPages} topGap=${result.topGap}`)
    console.log(result)
    if (result.firstElement) console.table([result.firstElement])
    if (result.precedingNodes.length > 0) console.table(result.precedingNodes)
    if (result.ancestorChain.length > 0) console.table(result.ancestorChain)
    console.groupEnd()

    return result
  }

  console.info(`[PreviewDebug] Top-gap inspector ready: window.${PREVIEW_TOP_GAP_DEBUG_FN}({ page: 6 })`)

  ; (window as Window & Record<string, unknown>)[PREVIEW_TRACE_DUMP_FN] = (options?: {
    download?: boolean
  }) => {
    if (!_lastPaginationTrace) {
      console.warn('[PreviewDebug] No pagination trace available yet')
      return null
    }

    const shouldDownload = options?.download ?? true
    const trace = _lastPaginationTrace
    const lines: string[] = []
    lines.push('VanFolio Preview Pagination Trace')
    lines.push(`Generated: ${trace.generatedAt}`)
    lines.push(`paper.width=${trace.paperWidth} paper.height=${trace.paperHeight} content.height=${trace.contentHeight}`)
    lines.push(`margins.top=${trace.margins.top} margins.right=${trace.margins.right} margins.bottom=${trace.margins.bottom} margins.left=${trace.margins.left}`)
    lines.push(`totalPages=${trace.totalPages}`)
    lines.push(`events=${trace.events.length}`)
    lines.push('')

    trace.events.forEach((event, index) => {
      lines.push(`[EVENT ${index}] page=${event.page} kind=${event.kind} tag=<${event.tag}> success=${event.success ?? ''}`)
      if (typeof event.top === 'number') lines.push(`top=${event.top}`)
      if (typeof event.bottom === 'number') lines.push(`bottom=${event.bottom}`)
      if (typeof event.relBottom === 'number') lines.push(`relBottom=${event.relBottom}`)
      if (typeof event.spaceLeft === 'number') lines.push(`spaceLeft=${event.spaceLeft}`)
      if (typeof event.contentH === 'number') lines.push(`contentH=${event.contentH}`)
      if (event.note) lines.push(`note=${event.note}`)
      if (event.meta) lines.push(`meta=${event.meta}`)
      lines.push(`text=${event.text}`)
      lines.push('')
    })

    const output = lines.join('\n')
    if (shouldDownload) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      downloadTextFile(output, `vanfolio-preview-trace-${stamp}.txt`)
      console.info(`[PreviewDebug] Trace downloaded via window.${PREVIEW_TRACE_DUMP_FN}()`)
    }

    return output
  }

  console.info(`[PreviewDebug] Paginator trace ready: window.${PREVIEW_TRACE_DUMP_FN}()`)

  ; (window as Window & Record<string, unknown>)[PDF_DEBUG_DUMP_FN] = async (options?: {
    selector?: string
    includeLines?: boolean
    download?: boolean
    downloadHtml?: boolean
  }) => {
    const selector = options?.selector ?? 'p, li, blockquote, h1, h2, h3, h4, h5, h6'
    const includeLines = options?.includeLines ?? true
    const shouldDownload = options?.download ?? true
    const shouldDownloadHtml = options?.downloadHtml ?? true

    const exportOptions = await resolvePdfDebugOptions()
    if (!exportOptions) {
      console.warn('[PreviewDebug] No active markdown file available for PDF debug dump')
      return null
    }

    const html = await window.vanfolioAPI.buildPdfDebugHtml(exportOptions)
    const tokens = exportOptions.docTokens ?? resolveCurrentDocTokens()
    const pageWidth = tokens.paperWidth ?? 794
    const pageHeight = tokens.paperHeight ?? 1123
    const marginTop = tokens.marginTop ?? 76
    const marginRight = tokens.marginRight ?? 83
    const marginBottom = tokens.marginBottom ?? 76
    const marginLeft = tokens.marginLeft ?? 83

    const analysis = await analyzePdfHtmlInIframe(html, {
      selector,
      includeLines,
      pageHeight,
      pageWidth,
      marginTop,
      marginRight,
      marginBottom,
      marginLeft,
    })

    if (shouldDownload) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      downloadTextFile(analysis, `vanfolio-pdf-debug-${stamp}.txt`)
      if (shouldDownloadHtml) {
        downloadHtmlFile(html, `vanfolio-pdf-export-${stamp}.html`)
      }
      console.info(`[PreviewDebug] PDF debug dump downloaded via window.${PDF_DEBUG_DUMP_FN}()`)
    }

    return analysis
  }

  console.info(`[PreviewDebug] PDF dump ready: window.${PDF_DEBUG_DUMP_FN}({ selector: 'p, li, blockquote', includeLines: true })`)

  // ── Baseline capture ───────────────────────────────────────────────────────
  // Usage: window.__vfCaptureBaseline('changelog')
  // Downloads pages.json and trace.json for the current pagination state.
  // Run pdf debug separately: window.__vfDumpPdfDebug({ download: true })
  ;(window as Window & Record<string, unknown>)[BASELINE_CAPTURE_FN] = (docName?: string) => {
    const name = docName ?? 'doc'
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')

    if (_lastPages.length === 0 && !_lastPaginationTrace) {
      console.warn('[PreviewDebug] No pagination data available yet. Open a document first.')
      return
    }

    // pages.json
    const pagesData = {
      capturedAt: stamp,
      pageCount: _lastPages.length,
      pages: _lastPages.map(p => ({ html: p.html, oversized: p.oversized ?? false })),
    }
    downloadTextFile(JSON.stringify(pagesData, null, 2), `${name}.pages.json`)

    // trace.json
    if (_lastPaginationTrace) {
      downloadTextFile(JSON.stringify(_lastPaginationTrace, null, 2), `${name}.trace.json`)
    }

    console.info(`[PreviewDebug] Baseline captured for "${name}". Also run: window.${PDF_DEBUG_DUMP_FN}({ download: true }) and rename to ${name}.pdf-debug.txt`)
  }

  console.info(`[PreviewDebug] Baseline capture ready: window.${BASELINE_CAPTURE_FN}('changelog')`)
}

/** Returns the current paginated HTML from the preview panel (used to build bootstrap snapshot) */
export function getCurrentPreviewHtml(): string {
  return document.getElementById('preview-content')?.innerHTML ?? ''
}

/** Returns current scroll ratio of the preview panel (used to build bootstrap snapshot) */
export function getCurrentScrollRatio(): number {
  const panel = document.getElementById('preview-panel')
  if (!panel) return 0
  const maxScrollTop = Math.max(panel.scrollHeight - panel.clientHeight, 0)
  return maxScrollTop === 0 ? 0 : panel.scrollTop / maxScrollTop
}

/** Re-render using the last markdown (used when re-attaching preview window) */
export function rerenderPreview(): void {
  if (!_lastMarkdown) return
  _lastContentHash = ''  // force re-render even if content unchanged
  renderAndPaginate(_lastMarkdown)
}

/** Force repagination when typography layout metrics change (line-height, paragraph spacing, font size, font family). */
export function triggerLayoutRepaginate(): void {
  if (!_lastMarkdown) return
  _lastContentHash = ''
  renderAndPaginate(_lastMarkdown)
}

export function triggerPreviewUpdate(markdown: string): void {
  _lastMarkdown = markdown

  // T25: Skip if content unchanged (fast path)
  if (markdown === _lastContentHash) return
  _lastContentHash = markdown

  // T25: Debounce rapid keystrokes — 150ms settles typing bursts
  if (_renderTimer) clearTimeout(_renderTimer)
  _renderTimer = setTimeout(() => renderAndPaginate(markdown), RENDER_DEBOUNCE_MS)
}

/** Returns the fully rendered but un-paginated HTML (used for DOCX/HTML export) */
export function getMasterHtml(): string {
  const previewContent = document.getElementById('preview-content')
  return previewContent?.dataset.masterHtml || ''
}

/** Returns the currently visible paginated HTML (used for PDF/PNG WYSIWYG export) */
export function getPaginatedHtml(): string {
  const previewContent = document.getElementById('preview-content')
  if (!previewContent) return ''

  const clone = previewContent.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.margin-handle-overlay, .smart-ruler, .margin-handle').forEach((el) => el.remove())

  const pages = clone.querySelectorAll<HTMLElement>('.preview-page')
  const pageMetrics = Array.from(pages).map((page, index) => {
    const viewport = page.querySelector<HTMLElement>('.page-viewport')
    return {
      page: index + 1,
      clientHeight: viewport?.clientHeight ?? 0,
      scrollHeight: viewport?.scrollHeight ?? 0,
    }
  })
  console.info('[Preview] Exporting paginated HTML metrics:', pageMetrics)

  return clone.innerHTML
}

// ── Core render + paginate ────────────────────────────────────────────────────

function renderAndPaginate(markdown: string): void {
  const gen = ++_renderGen

  const previewContent = document.getElementById('preview-content')
  const tocContent = document.getElementById('toc-content')
  if (!previewContent) return

  // Pre-process: preserve <!-- pagebreak --> through markdown-it (html:false strips HTML comments)
  const PAGEBREAK_SENTINEL_TOKEN = 'VANFOLIO_PAGEBREAK_7f3a9b'
  const markdownWithPlaceholders = markdown.replace(/<!--\s*pagebreak\s*-->/gi, `\n\n${PAGEBREAK_SENTINEL_TOKEN}\n\n`)
  const { html: rawHtml, tocItems } = markdownEngine.render(markdownWithPlaceholders)
  // markdown-it wraps standalone text in <p>; restore pagebreak markers
  const html = rawHtml.replace(new RegExp(`<p>${PAGEBREAK_SENTINEL_TOKEN}</p>`, 'g'), '<!-- pagebreak -->')

  // Update TOC immediately (fast path)
  if (tocContent) tocContent.innerHTML = generateTocHtml(tocItems)

  // Launch async heavy lifting: get base64 images to bypass Electron strict CSP
  // ⚠️ Important: Since getting base64 via IPC takes a few ms, we MUST check `gen`
  // after `await` to avoid updating the DOM with stale render HTML if the user types fast.
  void (async () => {
    const resolvedHtml = await _resolveImagePaths(html)
    if (gen !== _renderGen) return // Abort: a newer render started while waiting
    const htmlWithMermaid = await _renderMermaidInMasterHtml(resolvedHtml, gen)
    if (gen !== _renderGen) return

    // T25: Batch DOM write into rAF for smoother rendering
    requestAnimationFrame(() => {
      if (gen !== _renderGen) return
      void (async () => {
        previewContent.dataset.masterHtml = htmlWithMermaid
        previewContent.innerHTML = await paginateIntoPages(htmlWithMermaid)
        if (gen !== _renderGen) return
        window.vanfolioAPI.sendPreviewUpdate({ html: previewContent.innerHTML, fileKey: _currentFileKey })
        initTocActiveSync()

      // Late layout changes (webfonts, async image decode) can change content height
        // after first pagination pass. Re-paginate once when those async assets settle.
        if ('fonts' in document) {
          void document.fonts.ready.then(() => repaginateFromCurrentMaster(previewContent, gen))
        }
        watchMasterImagesAndRepaginate(previewContent, gen)
        scheduleLateRepagination(previewContent, gen)
      })()
    })
  })()
}

async function _renderMermaidInMasterHtml(html: string, gen: number): Promise<string> {
  const m = ensureMermaid()
  if (!m) return html
  if (gen !== _renderGen) return html

  const sandbox = document.createElement('div')
  sandbox.setAttribute('aria-hidden', 'true')
  sandbox.style.cssText = 'position:fixed;left:-99999px;top:-99999px;visibility:hidden;pointer-events:none;'
  sandbox.innerHTML = html
  document.body.appendChild(sandbox)

  try {
    const mermaidEls = sandbox.querySelectorAll<HTMLElement>(
      'pre > code.language-mermaid, pre > code.lang-mermaid, pre > code[class*="mermaid"]'
    )
    if (mermaidEls.length === 0) return html

    for (const el of Array.from(mermaidEls)) {
      if (gen !== _renderGen) break
      const pre = el.closest('pre') ?? el
      const source = (el.textContent ?? '').trim()
      if (!source) continue

      const host = document.createElement('div')
      host.className = 'mermaid'
      pre.replaceWith(host)

      try {
        const renderId = `vf-mermaid-${Date.now()}-${_mermaidSeq++}`
        const rendered = await m.render(renderId, source)
        host.innerHTML = typeof rendered === 'string' ? rendered : rendered.svg
      } catch (err) {
        console.error('Mermaid render failed:', err)
      }
    }

    return sandbox.innerHTML
  } finally {
    document.body.removeChild(sandbox)
  }
}

async function repaginateFromCurrentMaster(
  previewContent: HTMLElement,
  gen: number,
  overrideHtml?: string,
): Promise<void> {
  if (gen !== _renderGen) return
  const html = overrideHtml ?? previewContent.dataset.masterHtml
  if (!html) return
  previewContent.dataset.masterHtml = html
  previewContent.innerHTML = await paginateIntoPages(html)
  initTocActiveSync()
}

function watchMasterImagesAndRepaginate(previewContent: HTMLElement, gen: number): void {
  const images = Array.from(previewContent.querySelectorAll<HTMLImageElement>('img'))
  if (images.length === 0) return

  let remaining = images.length
  if (remaining === 0) return

  const done = (): void => {
    remaining -= 1
    if (remaining === 0) void repaginateFromCurrentMaster(previewContent, gen)
  }

  images.forEach(img => {
    if (!img.complete) {
      img.addEventListener('load', done, { once: true })
      img.addEventListener('error', done, { once: true })
      return
    }

    // `complete === true` does not always mean layout has settled.
    // decode() resolves after the image is ready to render at final dimensions.
    if (typeof img.decode === 'function') {
      void img.decode().catch(() => { }).finally(done)
    } else {
      done()
    }
  })
}

function scheduleLateRepagination(previewContent: HTMLElement, gen: number): void {
  // Catch late reflow sources that may land after first pass (async styles, decode timing).
  // Two spaced passes are cheap and prevent clipped trailing sections.
  window.setTimeout(() => { void repaginateFromCurrentMaster(previewContent, gen) }, 250)
  window.setTimeout(() => { void repaginateFromCurrentMaster(previewContent, gen) }, 1200)
}

// ── Sub-block split helper ─────────────────────────────────────────────────────
//
// Splits a prose element (p, li) at the last line that fits above targetY.
// Uses Range API + getClientRects() — no line-height estimation needed.
// Returns { first: outerHTML, second: outerHTML } or null if split not possible.

function splitElementAtY(
  element: HTMLElement,
  targetY: number,
): { first: string; second: string } | null {
  // Collect all text nodes in document order
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  let node: Node | null
  while ((node = walker.nextNode())) {
    if ((node as Text).nodeValue?.trim()) textNodes.push(node as Text)
  }
  if (textNodes.length === 0) return null

  // Binary search: find the last character offset where rect.bottom <= targetY
  // We test the range from start of element to each candidate position
  const range = document.createRange()
  range.setStart(element, 0)

  let splitNode: Text | null = null
  let splitOffset = 0
  let found = false

  for (let t = 0; t < textNodes.length; t++) {
    const tn = textNodes[t]
    const len = tn.nodeValue?.length ?? 0

    // Binary search within this text node
    let lo = 0
    let hi = len
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2)
      range.setEnd(tn, mid)
      const rects = range.getClientRects()
      const lastRect = rects[rects.length - 1]
      if (!lastRect) { lo = mid + 1; continue }

      if (lastRect.bottom <= targetY) {
        splitNode = tn
        splitOffset = mid
        found = true
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }

    // If the entire text node is past targetY already, stop
    range.setEnd(tn, 0)
    const startRects = range.getClientRects()
    if (startRects.length > 0 && startRects[startRects.length - 1].bottom > targetY) break
  }

  if (!found || !splitNode) return null

  // Ensure at least one full line fits on each side
  // Check: is there at least some content after the split?
  const lastTextNode = textNodes[textNodes.length - 1]
  const lastLen = lastTextNode.nodeValue?.length ?? 0
  if (splitNode === lastTextNode && splitOffset >= lastLen) return null // nothing for second part

  // Trim split to word boundary (scan backward for space)
  const text = splitNode.nodeValue ?? ''
  let boundary = splitOffset
  while (boundary > 0 && text[boundary - 1] !== ' ' && text[boundary - 1] !== '\n') {
    boundary--
  }
  if (boundary === 0) boundary = splitOffset // no word boundary found, use char boundary

  const firstRange = document.createRange()
  firstRange.selectNodeContents(element)
  firstRange.setEnd(splitNode, boundary)

  const secondRange = document.createRange()
  secondRange.selectNodeContents(element)
  secondRange.setStart(splitNode, boundary)

  const firstClone = element.cloneNode(false) as HTMLElement
  firstClone.appendChild(firstRange.cloneContents())

  const secondClone = element.cloneNode(false) as HTMLElement
  secondClone.appendChild(secondRange.cloneContents())

  function trimEdgeWhitespace(root: HTMLElement): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const texts: Text[] = []
    let n: Node | null
    while ((n = walker.nextNode())) texts.push(n as Text)
    if (texts.length === 0) return
    texts[0].nodeValue = texts[0].nodeValue?.replace(/^\s+/, '') ?? ''
    const last = texts[texts.length - 1]
    last.nodeValue = last.nodeValue?.replace(/\s+$/, '') ?? ''
  }

  trimEdgeWhitespace(firstClone)
  trimEdgeWhitespace(secondClone)

  const firstHtml = firstClone.outerHTML
  const secondHtml = secondClone.outerHTML

  // Sanity: both parts must have non-empty text content
  if (!firstClone.textContent?.trim() || !secondClone.textContent?.trim()) return null

  return { first: firstHtml, second: secondHtml }
}

function createElementFromHtml<T extends HTMLElement>(html: string): T | null {
  const container = document.createElement('div')
  container.innerHTML = html.trim()
  return (container.firstElementChild as T | null)
}

function canSplitListItemForContinuation(li: HTMLElement): boolean {
  const directChildren = Array.from(li.children) as HTMLElement[]
  const blockChildren = directChildren.filter((child) => {
    const tag = child.tagName.toLowerCase()
    return ['blockquote', 'pre', 'table', 'figure', 'div'].includes(tag)
  })
  const directNestedLists = directChildren.filter((child) => ['ul', 'ol'].includes(child.tagName.toLowerCase()))
  if (blockChildren.length > 0) return false
  if (directNestedLists.length > 1) return false
  return true
}

function splitNestedListItemForContinuation(li: HTMLElement, targetY: number): { first: string; second: string } | null {
  const directChildren = Array.from(li.childNodes)
  const nestedList = directChildren.find((node) => node instanceof HTMLElement && ['ul', 'ol'].includes(node.tagName.toLowerCase())) as HTMLElement | undefined
  if (!nestedList) return null

  const nestedItems = Array.from(nestedList.children) as HTMLElement[]
  if (nestedItems.length === 0) return null

  const liRect = li.getBoundingClientRect()
  const prefixNodes = directChildren.slice(0, directChildren.indexOf(nestedList))
  const suffixNodes = directChildren.slice(directChildren.indexOf(nestedList) + 1)
  const prefixBottom = prefixNodes.length > 0
    ? Math.max(...prefixNodes.map((node) => {
        if (node instanceof HTMLElement) return node.getBoundingClientRect().bottom
        const range = document.createRange()
        range.selectNodeContents(node)
        return range.getBoundingClientRect().bottom
      }))
    : liRect.top

  let splitIndex = -1
  for (let i = 0; i < nestedItems.length; i++) {
    const item = nestedItems[i]
    const itemBottom = item.getBoundingClientRect().bottom
    if (itemBottom <= targetY) splitIndex = i
    else break
  }

  const canSplitBeforeFirstNestedItem = prefixNodes.length > 0 && prefixBottom <= targetY
  if (splitIndex < 0 && !canSplitBeforeFirstNestedItem) return null
  if (splitIndex >= nestedItems.length - 1) return null

  const firstClone = li.cloneNode(false) as HTMLElement
  const secondClone = li.cloneNode(false) as HTMLElement
  const firstNested = nestedList.cloneNode(false) as HTMLElement
  const secondNested = nestedList.cloneNode(false) as HTMLElement
  const firstNestedCutoff = splitIndex

  directChildren.forEach((node) => {
    if (node === nestedList) {
      nestedItems.forEach((item, idx) => {
        if (idx <= firstNestedCutoff) firstNested.appendChild(item.cloneNode(true))
        else secondNested.appendChild(item.cloneNode(true))
      })
      if (firstNested.childNodes.length > 0) firstClone.appendChild(firstNested)
      if (secondNested.childNodes.length > 0) secondClone.appendChild(secondNested)
      return
    }

    const clone = node.cloneNode(true)
    if (prefixNodes.includes(node)) {
      firstClone.appendChild(clone)
      return
    }

    if (suffixNodes.includes(node)) {
      secondClone.appendChild(clone)
    }
  })

  if (!firstClone.textContent?.trim() || !secondClone.textContent?.trim()) return null
  return { first: firstClone.outerHTML, second: secondClone.outerHTML }
}

function splitListItemForContinuation(li: HTMLElement, targetY: number): { first: string; second: string } | null {
  const nestedDirectList = Array.from(li.children).find((child) => ['ul', 'ol'].includes(child.tagName.toLowerCase())) as HTMLElement | undefined
  if (nestedDirectList) return splitNestedListItemForContinuation(li, targetY)
  return splitElementAtY(li, targetY)
}

function summarizeListItemStructure(li: HTMLElement): string {
  const directChildren = Array.from(li.children) as HTMLElement[]
  const childTags = directChildren.map((child) => child.tagName.toLowerCase())
  const hasNestedList = !!li.querySelector(':scope > ul, :scope > ol')
  const hasAnyNestedList = !!li.querySelector('ul, ol')
  const inlineTags = Array.from(li.querySelectorAll('strong, em, code, a, span, b, i'))
    .map((el) => el.tagName.toLowerCase())
  const uniqueInlineTags = Array.from(new Set(inlineTags))
  return [
    `childTags=[${childTags.join(',')}]`,
    `hasDirectNestedList=${hasNestedList}`,
    `hasAnyNestedList=${hasAnyNestedList}`,
    `inlineTags=[${uniqueInlineTags.join(',')}]`,
    `innerHTML=${summarizeText(li.innerHTML.replace(/\s+/g, ' '), 220)}`,
  ].join(' | ')
}

function markListItemContinuation(li: HTMLElement, orderedValue?: number): HTMLElement {
  li.classList.add('list-continuation')
  li.setAttribute('data-list-continuation', 'true')
  if (typeof orderedValue === 'number') {
    li.setAttribute('value', String(orderedValue))
  }
  return li
}

// ── Pagination engine ─────────────────────────────────────────────────────────
//
// Strategy:
//   1. Render the full HTML into an off-screen measuring root.
//   2. Build real page DOMs and append content incrementally.
//   3. After each append, check overflow against the actual page viewport.
//   4. If a node overflows, move that node to the next page.
//   5. Lists are appended per <li>, so a single overflowing item moves cleanly.
//   6. <p> that overflow may get sub-block split via splitElementAtY().

async function paginateIntoPages(html: string): Promise<string> {
  const root = document.documentElement
  const rootStyle = getComputedStyle(root)
  const previewContentNode = document.getElementById('preview-content') || document.body

  const paperW = parseInt(rootStyle.getPropertyValue('--paper-width').trim() || '794', 10)
  const paperH = parseInt(rootStyle.getPropertyValue('--paper-height').trim() || '1123', 10)
  const marginTop = parseInt(rootStyle.getPropertyValue('--paper-margin-top').trim() || '76', 10)
  const marginRight = parseInt(rootStyle.getPropertyValue('--paper-margin-right').trim() || '83', 10)
  const marginBottom = parseInt(rootStyle.getPropertyValue('--paper-margin-bottom').trim() || '76', 10)
  const marginLeft = parseInt(rootStyle.getPropertyValue('--paper-margin-left').trim() || '83', 10)

  const safeMarginTop = Number.isFinite(marginTop) ? marginTop : PAGE_PADDING_TB
  const safeMarginRight = Number.isFinite(marginRight) ? marginRight : PAGE_PADDING_LR
  const safeMarginBottom = Number.isFinite(marginBottom) ? marginBottom : PAGE_PADDING_TB
  const safeMarginLeft = Number.isFinite(marginLeft) ? marginLeft : PAGE_PADDING_LR

  const contentH = Math.max(120, paperH - safeMarginTop - safeMarginBottom)
  const traceEvents: PaginationTraceEvent[] = []
  const pushTrace = (event: Omit<PaginationTraceEvent, 'page'> & { page?: number }): void => {
    traceEvents.push({
      page: event.page ?? (pages.length + 1),
      ...event,
    })
  }

  const rulerContainer = document.createElement('div')
  rulerContainer.setAttribute('aria-hidden', 'true')
  rulerContainer.style.cssText = `position:absolute;top:-9999px;left:-9999px;width:${paperW}px;visibility:hidden;pointer-events:none;`

  const rulerPage = document.createElement('div')
  rulerPage.className = 'preview-page'
  rulerPage.style.cssText = `width:${paperW}px;height:auto;overflow:visible;`

  const viewport = document.createElement('div')
  viewport.className = 'page-viewport'
  viewport.style.cssText = `box-sizing:border-box;width:100%;height:100%;padding:${safeMarginTop}px ${safeMarginRight}px ${safeMarginBottom}px ${safeMarginLeft}px;`

  const measureRoot = document.createElement('div')
  measureRoot.className = 'preview-page-content'
  measureRoot.style.cssText = 'display: flow-root; padding-top: 0.1px; padding-bottom: 0.1px;'
  // Replace <!-- pagebreak --> markers with sentinel elements before DOM insertion
  measureRoot.innerHTML = html.replace(/<!--\s*pagebreak\s*-->/gi, '<div class="__pagebreak-sentinel__" aria-hidden="true"></div>')

  const dummy = document.createElement('div')
  dummy.style.cssText = 'height: 1px; clear: both; margin-top: -1px;'
  measureRoot.appendChild(dummy)

  viewport.appendChild(measureRoot)
  rulerPage.appendChild(viewport)
  rulerContainer.appendChild(rulerPage)
  previewContentNode.appendChild(rulerContainer)

  let pages: Array<{ html: string; oversized?: boolean }> = []
  const pagePlans: PagePlan[] = []
  const planReasons: BreakBoundary['reason'][] = []

  try {
    const blocks = Array.from(measureRoot.children) as HTMLElement[]
    const realBlocks = blocks.filter(b => b !== dummy)

    if (realBlocks.length === 0) {
      return html.trim() ? renderPageShell({ html: html.trim() }, 0) : ''
    }

    // Sprint 2/3: fragment-based page assembly + boundary metadata
    _fragIdCounter = 0
    let currentPageFragments: PageFragment[] = []
    const rootRect = measureRoot.getBoundingClientRect()
    let currentPageStartOffset = realBlocks[0].getBoundingClientRect().top - rootRect.top

    const flushPage = (oversized: boolean | undefined, reason: BreakBoundary['reason']): void => {
      if (currentPageFragments.length === 0) return
      const plan: PagePlan = {
        fragments: currentPageFragments,
        estimatedHeight: currentPageFragments.reduce((s, f) => s + f.estimatedHeight, 0),
        oversized,
      }
      pagePlans.push(plan)
      planReasons.push(reason)
      currentPageFragments = []
    }

    const addFrag = (frag: PageFragment): void => {
      currentPageFragments.push(frag)
    }

    // Helper: true if currentPageFragments has any non-empty html
    const hasContent = (): boolean => currentPageFragments.some(f => f.html.trim().length > 0)

    for (let i = 0; i < realBlocks.length; i++) {
      const block = realBlocks[i]
      const nextBlock = blocks[i + 1]
      const tag = block.tagName.toLowerCase()
      const isList = (tag === 'ol' || tag === 'ul')

      // MANUAL PAGE BREAK sentinel — user inserted <!-- pagebreak --> via slash command
      if (block.classList.contains('__pagebreak-sentinel__')) {
        pushTrace({
          kind: 'manual-pagebreak',
          tag: 'pagebreak',
          top: Math.round(block.getBoundingClientRect().top - rootRect.top),
          bottom: Math.round(block.getBoundingClientRect().bottom - rootRect.top),
          text: '<!-- pagebreak -->',
          note: 'Forced page flush from slash command sentinel',
        })
        if (hasContent()) flushPage(false, 'manual')
        const nextReal = realBlocks[i + 1]
        currentPageStartOffset = nextReal
          ? (nextReal.getBoundingClientRect().top - rootRect.top)
          : (block.getBoundingClientRect().bottom - rootRect.top)
        continue
      }

      const blockTop = block.getBoundingClientRect().top - rootRect.top
      const blockRectBottom = block.getBoundingClientRect().bottom - rootRect.top
      const blockFlowBottom = nextBlock.getBoundingClientRect().top - rootRect.top
      const blockH = Math.max(0, blockFlowBottom - blockTop)
      const relBottom = blockRectBottom - currentPageStartOffset

      // KEEP-WITH-NEXT: only pre-push a heading when the heading block itself is
      // almost out of room. Do not use nextBlock.top here, because that bakes in
      // the whitespace before the following block and pushes headings earlier than Chromium.
      const headingRelBottom = blockRectBottom - currentPageStartOffset
      const HEADING_ORPHAN_BUFFER = 8
      const shouldProtectHeading = /^h[1-3]$/.test(tag)
      if (shouldProtectHeading && hasContent() && headingRelBottom > contentH - HEADING_ORPHAN_BUFFER) {
        pushTrace({
          kind: 'heading-orphan-push',
          tag,
          top: Math.round(blockTop),
          bottom: Math.round(blockRectBottom),
          relBottom: Math.round(headingRelBottom),
          contentH,
          text: summarizeText(block.textContent ?? ''),
          note: `Heading moved to next page because headingRelBottom>${contentH - HEADING_ORPHAN_BUFFER}`,
        })
        flushPage(false, 'heading-orphan')
        addFrag({
          id: nextFragId(), kind: 'block', tag, html: block.outerHTML,
          sourceIndex: i, estimatedHeight: blockH, splitArtifact: null,
          movable: true, parentKind: 'root',
        })
        currentPageStartOffset = blockTop
        continue
      }

      // BREAK DECISION - NORMAL BLOCKS
      if (relBottom > contentH && !isList) {
        pushTrace({
          kind: 'overflow',
          tag,
          top: Math.round(blockTop),
          bottom: Math.round(blockRectBottom),
          relBottom: Math.round(relBottom),
          contentH,
          text: summarizeText(block.textContent ?? ''),
          note: 'Normal block exceeded available page height',
        })
        // Try child-level split for <blockquote> (contains <p> children)
        if (tag === 'blockquote' && block.children.length > 0) {
          const bqChildren = Array.from(block.children) as HTMLElement[]
          let bqClone = block.cloneNode(false) as HTMLElement
          let splitHappened = false

          for (let k = 0; k < bqChildren.length; k++) {
            const child = bqChildren[k]
            const nextChild = bqChildren[k + 1]
            const childTop = child.getBoundingClientRect().top - rootRect.top
            const childBottom = nextChild
              ? (nextChild.getBoundingClientRect().top - rootRect.top)
              : (child.getBoundingClientRect().bottom - rootRect.top)
            const childRelBottom = childBottom - currentPageStartOffset

            if (childRelBottom > contentH) {
              // Try <p> split within blockquote
              const spaceLeft = contentH - (childTop - currentPageStartOffset)
              const childTargetY = rootRect.top + currentPageStartOffset + contentH
              const split = (child.tagName.toLowerCase() === 'p' && spaceLeft > 10)
                ? splitElementAtY(child, childTargetY)
                : null
              const blockquoteHeadHeight = Math.max(1, Math.min(blockH, contentH - (blockTop - currentPageStartOffset)))
              const blockquoteTailHeight = Math.max(1, blockH - blockquoteHeadHeight)

              if (split) {
                pushTrace({
                  kind: 'blockquote-child-split',
                  tag,
                  top: Math.round(childTop),
                  bottom: Math.round(childBottom),
                  relBottom: Math.round(childRelBottom),
                  spaceLeft: Math.round(spaceLeft),
                  contentH,
                  success: true,
                  text: summarizeText(child.textContent ?? ''),
                })
                const bqFirst = block.cloneNode(false) as HTMLElement
                bqFirst.innerHTML = bqClone.innerHTML
                const tmp = document.createElement('div'); tmp.innerHTML = split.first
                if (tmp.firstElementChild) bqFirst.appendChild(tmp.firstElementChild)
                addFrag({
                  id: nextFragId(), kind: 'blockquote-split', tag,
                  html: bqFirst.outerHTML,
                  sourceIndex: i, estimatedHeight: blockquoteHeadHeight, splitArtifact: 'head',
                  movable: false, parentKind: 'blockquote',
                })
                flushPage(false, 'overflow')
                currentPageStartOffset = currentPageStartOffset + contentH
                bqClone = block.cloneNode(false) as HTMLElement
                const tmp2 = document.createElement('div'); tmp2.innerHTML = split.second
                if (tmp2.firstElementChild) bqClone.appendChild(tmp2.firstElementChild)
              } else {
                pushTrace({
                  kind: 'blockquote-child-split',
                  tag,
                  top: Math.round(childTop),
                  bottom: Math.round(childBottom),
                  relBottom: Math.round(childRelBottom),
                  spaceLeft: Math.round(spaceLeft),
                  contentH,
                  success: false,
                  text: summarizeText(child.textContent ?? ''),
                  note: 'Split failed; blockquote child moved to next page',
                })
                // No split possible: flush current bq content and start new page
                if (bqClone.children.length > 0) {
                  addFrag({
                    id: nextFragId(), kind: 'blockquote-split', tag,
                    html: bqClone.outerHTML,
                    sourceIndex: i, estimatedHeight: Math.max(1, childTop - blockTop), splitArtifact: 'head',
                    movable: false, parentKind: 'blockquote',
                  })
                }
                flushPage(false, 'overflow')
                currentPageStartOffset = childTop
                bqClone = block.cloneNode(false) as HTMLElement
                bqClone.appendChild(child.cloneNode(true))
              }
              splitHappened = true
              // Add remaining children to new bqClone
              for (let m = k + 1; m < bqChildren.length; m++) {
                bqClone.appendChild(bqChildren[m].cloneNode(true))
              }
              break
            }

            bqClone.appendChild(child.cloneNode(true))
          }

          if (splitHappened) {
            if (bqClone.children.length > 0) {
              addFrag({
                id: nextFragId(), kind: 'blockquote-split', tag,
                html: bqClone.outerHTML,
                sourceIndex: i, estimatedHeight: blockquoteTailHeight, splitArtifact: 'tail',
                movable: true, parentKind: 'blockquote',
              })
            }
            continue
          }
          // Fall through to normal block handling if no split happened
        }

        // Try sub-block split for <p> blocks with multiple lines
        if (tag === 'p') {
          const spaceLeft = contentH - (blockTop - currentPageStartOffset)
          const targetY = rootRect.top + currentPageStartOffset + contentH
          const split = spaceLeft > 10 ? splitElementAtY(block, targetY) : null
          const paragraphHeadHeight = Math.max(1, Math.min(blockH, Math.max(spaceLeft, 1)))
          const paragraphTailHeight = Math.max(1, blockH - paragraphHeadHeight)
          pushTrace({
            kind: 'paragraph-split',
            tag,
            top: Math.round(blockTop),
            bottom: Math.round(blockRectBottom),
            relBottom: Math.round(relBottom),
            spaceLeft: Math.round(spaceLeft),
            contentH,
            success: !!split,
            text: summarizeText(block.textContent ?? ''),
            note: split ? 'Paragraph split at last fitting line' : 'Paragraph split unavailable; fallback to next page',
          })
          if (split) {
            addFrag({
              id: nextFragId(), kind: 'split-part', tag,
              html: split.first,
              sourceIndex: i, estimatedHeight: paragraphHeadHeight, splitArtifact: 'head',
              movable: false, parentKind: 'root',
            })
            flushPage(false, 'overflow')
            addFrag({
              id: nextFragId(), kind: 'split-part', tag,
              html: split.second,
              sourceIndex: i, estimatedHeight: paragraphTailHeight, splitArtifact: 'tail',
              movable: true, parentKind: 'root',
            })
            // New page virtual offset: advance by contentH from current page start
            currentPageStartOffset = currentPageStartOffset + contentH
            continue
          }
        }

        if (hasContent()) {
          pushTrace({
            kind: 'flush-current-page',
            tag,
            top: Math.round(blockTop),
            bottom: Math.round(blockRectBottom),
            relBottom: Math.round(relBottom),
            contentH,
            text: summarizeText(block.textContent ?? ''),
            note: 'Current page flushed before carrying block to next page',
          })
          flushPage(false, 'overflow')
          currentPageStartOffset = blockTop
        }
        if (blockRectBottom - blockTop > contentH) {
          pushTrace({
            kind: 'oversized-block',
            tag,
            top: Math.round(blockTop),
            bottom: Math.round(blockRectBottom),
            relBottom: Math.round(relBottom),
            contentH,
            text: summarizeText(block.textContent ?? ''),
            note: 'Single block taller than page content area',
          })
          // Oversized block gets its own page plan
          const oversizedFrag: PageFragment = {
            id: nextFragId(), kind: 'block', tag,
            html: block.outerHTML,
            sourceIndex: i, estimatedHeight: blockH, splitArtifact: null,
            movable: false, parentKind: 'root', oversized: true,
          }
          const oversizedPlan: PagePlan = {
            fragments: [oversizedFrag],
            estimatedHeight: blockH,
            oversized: true,
          }
          pagePlans.push(oversizedPlan)
          planReasons.push('overflow')
          currentPageStartOffset = nextBlock.getBoundingClientRect().top - rootRect.top
        } else {
          addFrag({
            id: nextFragId(), kind: 'block', tag,
            html: block.outerHTML,
            sourceIndex: i, estimatedHeight: blockH, splitArtifact: null,
            movable: true, parentKind: 'root',
          })
        }
        continue
      }

      // SPLITTABLE LISTS
      if (isList && block.children.length > 0) {
        const items = Array.from(block.children) as HTMLElement[]
        const ordered = tag === 'ol'
        let runningStart = getOrderedListStart(block)
        let listClone = block.cloneNode(false) as HTMLElement
        let listChunkStart = runningStart
        let listChunkCount = 0
        let listChunkEstimatedHeight = 0

        for (let j = 0; j < items.length; j++) {
          const li = items[j]
          const nextLi = items[j + 1]

          const liTop = li.getBoundingClientRect().top - rootRect.top
          const liBottom = nextLi
            ? (nextLi.getBoundingClientRect().top - rootRect.top)
            : (li.getBoundingClientRect().bottom - rootRect.top)
          const liRelBottom = liBottom - currentPageStartOffset

          if (liRelBottom > contentH) {
            const liHeight = liBottom - liTop
            const spaceLeft = contentH - (liTop - currentPageStartOffset)
            const targetY = rootRect.top + currentPageStartOffset + contentH
            const shouldAttemptContinuation = liHeight > spaceLeft && spaceLeft > 10
            const canContinue = shouldAttemptContinuation && canSplitListItemForContinuation(li)
            const split = canContinue ? splitListItemForContinuation(li, targetY) : null

            if (split) {
              const firstPart = createElementFromHtml<HTMLElement>(split.first)
              const secondPart = createElementFromHtml<HTMLElement>(split.second)

              if (firstPart && secondPart) {
                pushTrace({
                  kind: 'list-item-continuation',
                  tag: 'li',
                  top: Math.round(liTop),
                  bottom: Math.round(liBottom),
                  relBottom: Math.round(liRelBottom),
                    spaceLeft: Math.round(spaceLeft),
                    contentH,
                    success: true,
                    text: summarizeText(li.textContent ?? ''),
                    note: 'List item split into visual continuation without creating a new bullet marker',
                    meta: summarizeListItemStructure(li),
                  })

                listClone.appendChild(firstPart)
                if (listClone.children.length > 0) {
                  addFrag({
                    id: nextFragId(), kind: 'continuation', tag,
                    html: listClone.outerHTML,
                    sourceIndex: i, estimatedHeight: Math.max(1, Math.min(liHeight, Math.max(spaceLeft, 1))), splitArtifact: 'head',
                    movable: false, parentKind: 'list',
                    orderedListStart: ordered ? listChunkStart : undefined,
                    orderedListCount: ordered ? listChunkCount + 1 : undefined,
                  })
                }
                flushPage(false, 'list-flush')
                currentPageStartOffset = currentPageStartOffset + contentH

                listClone = block.cloneNode(false) as HTMLElement
                if (ordered) listClone.setAttribute('start', String(runningStart))
                listClone.appendChild(markListItemContinuation(secondPart, ordered ? runningStart : undefined))
                listChunkStart = runningStart
                listChunkCount = 1
                listChunkEstimatedHeight = Math.max(1, liHeight - Math.max(1, Math.min(liHeight, Math.max(spaceLeft, 1))))
                runningStart++
                continue
              }
            }

            if (liHeight > spaceLeft && spaceLeft > 10) {
              const failureReason = !canContinue
                ? 'continuation-safety-gate-rejected'
                : 'continuation-split-returned-null'
              pushTrace({
                kind: 'list-item-whole-move',
                tag: 'li',
                top: Math.round(liTop),
                bottom: Math.round(liBottom),
                relBottom: Math.round(liRelBottom),
                spaceLeft: Math.round(spaceLeft),
                contentH,
                success: false,
                text: summarizeText(li.textContent ?? ''),
                note: `List item continuation unavailable (${failureReason}); item will move as a whole`,
                meta: summarizeListItemStructure(li),
              })
            }

            if (hasContent() || listClone.children.length > 0) {
              pushTrace({
                kind: 'flush-list-page',
                tag: 'li',
                top: Math.round(liTop),
                bottom: Math.round(liBottom),
                relBottom: Math.round(liRelBottom),
                contentH,
                text: summarizeText(li.textContent ?? ''),
                note: 'List container flushed before moving overflowing item',
              })
              if (listClone.children.length > 0) {
                addFrag({
                  id: nextFragId(), kind: 'list-chunk', tag,
                  html: listClone.outerHTML,
                  sourceIndex: i, estimatedHeight: Math.max(1, listChunkEstimatedHeight), splitArtifact: null,
                  movable: true, parentKind: 'list',
                  orderedListStart: ordered ? listChunkStart : undefined,
                  orderedListCount: ordered ? listChunkCount : undefined,
                })
              }
              flushPage(false, 'list-flush')
            }
            currentPageStartOffset = liTop
            listClone = block.cloneNode(false) as HTMLElement
            if (ordered) listClone.setAttribute('start', String(runningStart))
            listChunkStart = runningStart
            listChunkCount = 0
            listChunkEstimatedHeight = 0
          }
          listClone.appendChild(li.cloneNode(true))
          listChunkCount++
          listChunkEstimatedHeight += Math.max(1, liBottom - liTop)
          runningStart++
        }
        // Remaining list items go into current page fragments
        addFrag({
          id: nextFragId(), kind: 'list-chunk', tag,
          html: listClone.outerHTML,
          sourceIndex: i, estimatedHeight: Math.max(1, listChunkEstimatedHeight), splitArtifact: null,
          movable: true, parentKind: 'list',
          orderedListStart: ordered ? listChunkStart : undefined,
          orderedListCount: ordered ? listChunkCount : undefined,
        })
        continue
      }

      // NORMAL BLOCK FITS
      addFrag({
        id: nextFragId(), kind: 'block', tag,
        html: block.outerHTML,
        sourceIndex: i, estimatedHeight: blockH, splitArtifact: null,
        movable: true, parentKind: 'root',
      })
    }

    if (hasContent()) {
      flushPage(false, 'overflow') // final flush — reason only used if another page follows
    }
  } finally {
    if (rulerContainer.parentNode) {
      rulerContainer.parentNode.removeChild(rulerContainer)
    }
  }

  // Sprint 3: derive BreakBoundary records from pagePlans post-hoc
  const boundaries: BreakBoundary[] = pagePlans.slice(0, -1).map((plan, idx) => {
    const b: BreakBoundary = {
      pageIndex: idx,
      reason: planReasons[idx],
      prevTailId: plan.fragments.at(-1)?.id ?? null,
      nextHeadId: pagePlans[idx + 1]?.fragments[0]?.id ?? null,
      remainingSpaceBeforeShift: computeRemainingSpace(plan, contentH),
      revisitCount: 0,
      sensitive: false,
    }
    b.sensitive = isSensitiveBoundary(b, pagePlans)
    return b
  })

  // C+3: build MeasurementOpts from resolved paper dimensions
  const measureOpts: MeasurementOpts = {
    paperW,
    paperH,
    marginTop: safeMarginTop,
    marginRight: safeMarginRight,
    marginBottom: safeMarginBottom,
    marginLeft: safeMarginLeft,
  }

  // Pass 2 engine — now async (C+3: measured candidate selection for keep-with-next)
  const rebalancedPlans = await rebalanceBoundaries(pagePlans, boundaries, contentH, measureOpts, pushTrace)

  // Render final plans → pages output contract
  pages = rebalancedPlans.map(p => renderPagePlan(p))

  _lastPaginationTrace = {
    generatedAt: new Date().toISOString(),
    paperWidth: paperW,
    paperHeight: paperH,
    contentHeight: contentH,
    margins: {
      top: safeMarginTop,
      right: safeMarginRight,
      bottom: safeMarginBottom,
      left: safeMarginLeft,
    },
    totalPages: pages.length,
    events: traceEvents,
  }
  _lastPages = pages.slice()

  return pages.map((p, i) => renderPageShell(p, i)).join('')
}

function getOrderedListStart(listEl: HTMLElement): number {
  const raw = listEl.getAttribute('start')
  const parsed = raw ? parseInt(raw, 10) : 1
  return Number.isFinite(parsed) ? parsed : 1
}

function renderPageShell(page: { html: string; oversized?: boolean }, i: number): string {
  const pageClass = page.oversized ? 'preview-page oversized' : 'preview-page'
  return `<div class="${pageClass}" data-page-index="${i}"><div class="page-viewport"><div class="preview-page-content">${page.html.trim()}</div></div></div>`
}

/**
 * Replace relative/absolute image src with base64 data URIs via Main process.
 * ⚠️ Bypasses Same-Origin / file:// restrictive security policy in Chromium.
 */
async function _resolveImagePaths(html: string): Promise<string> {
  if (!_currentFilePath) return html

  // Extract directory from path
  const dir = _currentFilePath.replace(/[\\\/][^\\\/]+$/, '')

  // 1. Collect all src to avoid calling IPC sequentially
  const srcSet = new Set<string>()
  const imgRe = /<img[^>]*\ssrc="([^"]+)"[^>]*>/g
  let m: RegExpExecArray | null
  while ((m = imgRe.exec(html)) !== null) {
    if (!/^(https?:|data:|file:)/i.test(m[1])) {
      srcSet.add(m[1])
    }
  }

  // 2. Resolve paths and load base64 — parallel for performance (BUG-3 fix)
  const dict = new Map<string, string>()
  const entries = Array.from(srcSet).map((src) => {
    let absPath: string

    const isAbsolute = /^[A-Z]:[\\\/]/i.test(src) || src.startsWith('/') || src.startsWith('\\')
    if (isAbsolute) {
      absPath = src
    } else {
      absPath = `${dir}/${src}`
    }

    // Fix slashes
    absPath = absPath.replace(/\\/g, '/').replace(/\/+/g, '/')

    return { src, absPath }
  })

  const results = await Promise.all(
    entries.map(async ({ src, absPath }) => {
      const base64 = await window.vanfolioAPI.readImageAsBase64(absPath)
      return { src, base64 }
    })
  )

  for (const { src, base64 } of results) {
    if (base64) dict.set(src, base64)
  }

  // 3. Inject base64 into HTML
  return html.replace(/<img([^>]*)\ssrc="([^"]+)"([^>]*>)/gi, (match, before, src, after) => {
    const b64 = dict.get(src)
    if (b64) return `<img${before} src="${b64}"${after}`
    return match
  })
}

// ── TOC Active State (IntersectionObserver) ───────────────────────────────────

function initTocActiveSync(): void {
  // Cleanup observer cũ để tránh leak (G06-4)
  tocObserver?.disconnect()

  const previewContent = document.getElementById('preview-content')
  if (!previewContent) return

  const headings = previewContent.querySelectorAll<HTMLElement>('h1, h2, h3, h4')
  if (headings.length === 0) return

  // TocGenerator outputs <li class="toc-hN"><a class="toc-link" href="#id">
  const tocLinks = document.querySelectorAll<HTMLAnchorElement>('#toc-content a[href]')
  if (tocLinks.length === 0) return

  // Map: heading id → toc link element
  const headingToLink = new Map<string, HTMLAnchorElement>()
  tocLinks.forEach(link => {
    const id = link.getAttribute('href')?.replace('#', '')
    if (id) headingToLink.set(id, link)
  })

  // Track currently-intersecting heading IDs; pick topmost (DOM order) for stable active state
  const visibleIds = new Set<string>()

  // ⚠️ G06-2: root phải là #preview-panel (scrollable), không phải #preview-content
  tocObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).id
        if (entry.isIntersecting) {
          visibleIds.add(id)
        } else {
          visibleIds.delete(id)
        }
      }
      // Pick the first heading (DOM order) that is currently visible — deterministic
      let activeId: string | null = null
      for (const h of headings) {
        if (visibleIds.has(h.id)) {
          activeId = h.id
          break
        }
      }
      updateActiveTocLink(activeId, headingToLink)
    },
    {
      root: document.getElementById('preview-panel'),
      rootMargin: '-10% 0px -80% 0px',
      threshold: 0,
    }
  )

  headings.forEach(h => tocObserver!.observe(h))
}

function updateActiveTocLink(activeId: string | null, map: Map<string, HTMLAnchorElement>): void {
  map.forEach((link, id) => {
    link.classList.toggle('toc-active', id === activeId)
  })
}
