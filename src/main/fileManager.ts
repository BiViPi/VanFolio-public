import { dialog, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import { join, extname, basename, dirname } from 'path'
import log from 'electron-log/main'
import type { FileTreeNode, OpenFileResult, SaveAsResult, OpenFolderResult, CopyAssetResult } from '@shared/types'
import { SUPPORTED_EXTENSIONS } from '@shared/constants'
import { addRecentFile } from './storeManager'
import { t } from '../shared/i18n'

// ─────────────────────────────────────────────────────────────────────────────
// File operations — runs in main process
// Renderer does NOT call fs/path directly; all I/O goes through here → IPC
// ─────────────────────────────────────────────────────────────────────────────

export async function openFile(win: BrowserWindow): Promise<OpenFileResult | null> {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: t('menu.file.open'),
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      properties: ['openFile'],
    })

    if (canceled || !filePaths[0]) return null

    const filePath = filePaths[0]
    const content = await fs.readFile(filePath, 'utf-8')
    addRecentFile(filePath)
    log.info('Opened file:', filePath)
    return { path: filePath, content }
  } catch (err) {
    log.error('openFile failed:', err)
    return null
  }
}

/** Open a folder by known path — no dialog. Ensures folder exists, creates Welcome.md if empty. */
export async function openFolderByPath(folderPath: string): Promise<OpenFolderResult | null> {
  try {
    await fs.mkdir(folderPath, { recursive: true })

    // Create Welcome.md if the vault is empty (no .md files at root level)
    const entries = await fs.readdir(folderPath)
    const hasMd = entries.some((e) => e.endsWith('.md') || e.endsWith('.markdown'))
    if (!hasMd) {
      const welcomePath = join(folderPath, 'Welcome.md')
      const welcomeContent = [
        '# Welcome to VanFolio',
        '',
        'This is your vault — a single folder where all your writing lives.',
        '',
        '## Getting started',
        '',
        '- **Ctrl+N** — create a new file',
        '- **/** — slash commands (headings, tables, code blocks…)',
        '- **Ctrl+P** — toggle preview',
        '- **Ctrl+G** — open the AI writing assistant',
        '',
        'Happy writing ✦',
      ].join('\n')
      await fs.writeFile(welcomePath, welcomeContent, 'utf-8')
      addRecentFile(welcomePath)
    }

    const tree = await buildFileTree(folderPath)
    log.info('Opened vault by path:', folderPath)
    return { folderPath, tree }
  } catch (err) {
    log.error('openFolderByPath failed:', err)
    return null
  }
}

export async function openFolder(win: BrowserWindow): Promise<OpenFolderResult | null> {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: t('menu.file.openFolder'),
      properties: ['openDirectory'],
    })

    if (canceled || !filePaths[0]) return null

    const folderPath = filePaths[0]
    const tree = await buildFileTree(folderPath)
    log.info('Opened folder:', folderPath)
    return { folderPath, tree }
  } catch (err) {
    log.error('openFolder failed:', err)
    return null
  }
}

export async function readFile(filePath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    addRecentFile(filePath)
    return content
  } catch (err) {
    log.error('readFile failed:', filePath, err)
    return null
  }
}

export async function readImageAsBase64(filePath: string): Promise<string | null> {
  try {
    const ext = extname(filePath).toLowerCase().substring(1) || 'png'
    const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }
    const mime = mimeMap[ext] || 'image/png'
    const buffer = await fs.readFile(filePath)
    return `data:${mime};base64,${buffer.toString('base64')}`
  } catch (err) {
    log.warn('readImageAsBase64 failed:', filePath, String(err))
    return null
  }
}

export async function saveFile(filePath: string, content: string): Promise<boolean> {
  try {
    await fs.writeFile(filePath, content, 'utf-8')
    log.info('Saved file:', filePath)
    return true
  } catch (err) {
    log.error('Save failed:', err)
    return false
  }
}

export async function saveFileAs(win: BrowserWindow, content: string): Promise<SaveAsResult | null> {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: t('menu.file.saveAs'),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })

    if (canceled || !filePath) return null

    await fs.writeFile(filePath, content, 'utf-8')
    addRecentFile(filePath)
    log.info('Saved as:', filePath)
    return { path: filePath }
  } catch (err) {
    log.error('saveFileAs failed:', err)
    return null
  }
}

// ── Asset copy (Sprint 4 — drag-and-drop image) ────────────────────────────

const SUPPORTED_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])

export async function copyAsset(sourcePath: string, mdFilePath: string): Promise<CopyAssetResult> {
  try {
    const ext = extname(sourcePath).toLowerCase()
    if (!SUPPORTED_IMAGE_EXTS.has(ext)) {
      return { relativePath: '', success: false, error: `Unsupported format: ${ext}` }
    }

    const assetsDir = join(dirname(mdFilePath), 'assets')
    await fs.mkdir(assetsDir, { recursive: true })

    // Handle duplicate filenames by appending -1, -2, ...
    let name = basename(sourcePath)
    let destPath = join(assetsDir, name)
    let counter = 1
    while (await fileExists(destPath)) {
      const base = basename(sourcePath, ext)
      name = `${base}-${counter}${ext}`
      destPath = join(assetsDir, name)
      counter++
      if (counter > 999) return { relativePath: '', success: false, error: 'Too many duplicates' }
    }

    await fs.copyFile(sourcePath, destPath)
    log.info('Copied asset:', destPath)
    // Encode filename for safe use in markdown paths (spaces, parens, #, etc.)
    return { relativePath: `./assets/${encodeURIComponent(name)}`, success: true }
  } catch (err) {
    log.error('copyAsset failed:', err)
    return { relativePath: '', success: false, error: String(err) }
  }
}

async function fileExists(path: string): Promise<boolean> {
  try { await fs.access(path); return true } catch { return false }
}

// ── Folder tree builder ────────────────────────────────────────────────────
// Only returns .md files and folders containing .md, filtered in main process
async function buildFileTree(dirPath: string): Promise<FileTreeNode[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const nodes: FileTreeNode[] = []

  for (const entry of entries) {
    // Skip hidden files/folders
    if (entry.name.startsWith('.')) continue

    const fullPath = join(dirPath, entry.name)

    if (entry.isDirectory()) {
      const children = await buildFileTree(fullPath)
      if (children.length > 0) {
        nodes.push({ name: entry.name, type: 'folder', path: fullPath, children })
      }
    } else if (entry.isFile() && SUPPORTED_EXTENSIONS.includes(extname(entry.name) as any)) {
      nodes.push({ name: entry.name, type: 'file', path: fullPath })
    }
  }

  return nodes.sort((a, b) => {
    // Folders first, files second; alphabetical within each group
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}
