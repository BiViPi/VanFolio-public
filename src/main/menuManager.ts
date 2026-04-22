import { Menu, BrowserWindow } from 'electron'
import { IPC } from '@shared/constants'

// ─────────────────────────────────────────────────────────────────────────────
// App Menu — builds native menu and sends IPC events to renderer
// Sprint 2: File → Open, Save, Save As
// ─────────────────────────────────────────────────────────────────────────────

// D1 (Phase 3.2): Menu ownership transferred 100% to renderer.
// Native menu removed — all File/Edit/View/Export/Help menus now live in
// src/renderer/index.html + titlebarMenu.ts.
export function buildAppMenu(_win: BrowserWindow): void {
  Menu.setApplicationMenu(null)
}
