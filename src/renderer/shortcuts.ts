// ─────────────────────────────────────────────────────────────────────────────
// Shortcuts Module — user-editable keyboard shortcuts with localStorage
// ─────────────────────────────────────────────────────────────────────────────

export interface ShortcutDef {
  id: string
  label: string
  group: string
  defaultKey: string
}

const STORAGE_KEY = 'vanfolio-shortcuts'

// Default shortcut definitions
export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  { id: 'new-file',      label: 'New File',            group: 'File',   defaultKey: 'Ctrl+N' },
  { id: 'open-file',     label: 'Open File',           group: 'File',   defaultKey: 'Ctrl+O' },
  { id: 'open-folder',   label: 'Open Folder',         group: 'File',   defaultKey: 'Ctrl+Shift+O' },
  { id: 'save',          label: 'Save',                group: 'File',   defaultKey: 'Ctrl+S' },
  { id: 'save-as',       label: 'Save As',             group: 'File',   defaultKey: 'Ctrl+Shift+S' },
  { id: 'export-pdf',    label: 'Export PDF',          group: 'Export', defaultKey: 'Ctrl+E' },
  { id: 'focus-mode',    label: 'Toggle Focus Mode',   group: 'View',   defaultKey: 'Ctrl+Shift+F' },
  { id: 'toc-toggle',    label: 'Toggle TOC',          group: 'View',   defaultKey: 'Ctrl+\\' },
  { id: 'typewriter',    label: 'Toggle Typewriter',   group: 'View',   defaultKey: 'Ctrl+Shift+T' },
  { id: 'fade-context',  label: 'Toggle Fade Context', group: 'View',   defaultKey: 'Ctrl+Shift+D' },
  { id: 'detach-preview', label: 'Detach Preview',     group: 'View',   defaultKey: 'Ctrl+Alt+D' },
]

// Load overrides from localStorage
function loadOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

// Save overrides to localStorage
function saveOverrides(overrides: Record<string, string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
}

// Get the current key for a shortcut (override or default)
export function getKey(id: string): string {
  const overrides = loadOverrides()
  const def = DEFAULT_SHORTCUTS.find((s) => s.id === id)
  return overrides[id] ?? def?.defaultKey ?? ''
}

// Set a custom key for a shortcut
export function setKey(id: string, key: string): void {
  const overrides = loadOverrides()
  overrides[id] = key
  saveOverrides(overrides)
}

// Reset a shortcut to default
export function resetKey(id: string): void {
  const overrides = loadOverrides()
  delete overrides[id]
  saveOverrides(overrides)
}

// Get all shortcuts with current keys
export function getAllShortcuts(): Array<ShortcutDef & { currentKey: string; isCustom: boolean }> {
  const overrides = loadOverrides()
  return DEFAULT_SHORTCUTS.map((def) => ({
    ...def,
    currentKey: overrides[def.id] ?? def.defaultKey,
    isCustom: def.id in overrides,
  }))
}

// Parse a KeyboardEvent into a key string like "Ctrl+Shift+S"
export function eventToKeyString(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) parts.push(key)
  return parts.join('+')
}

// Check if a KeyboardEvent matches a shortcut id
export function matchesShortcut(e: KeyboardEvent, id: string): boolean {
  return eventToKeyString(e) === getKey(id)
}
