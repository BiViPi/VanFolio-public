import { promises as fs } from 'fs'
import { join, resolve, sep } from 'path'
import log from 'electron-log/main'
import type { AppSettings, BackupResult, StorageUsage } from '@shared/types'

const META_FILE = '.vanfolio/backup-meta.json'
let scheduler: NodeJS.Timeout | null = null
let schedulerKey = ''
let backupRun: Promise<BackupResult> | null = null

function normalizePath(input: string): string {
  return resolve(input)
}

function isInsideDir(targetPath: string, rootPath: string): boolean {
  const target = normalizePath(targetPath)
  const root = normalizePath(rootPath)
  return target === root || target.startsWith(`${root}${sep}`)
}

function frequencyMs(frequency: AppSettings['autoBackupFrequency']): number {
  if (frequency === '1h') return 60 * 60 * 1000
  if (frequency === '6h') return 6 * 60 * 60 * 1000
  return 24 * 60 * 60 * 1000
}

function formatStamp(timestamp: number): string {
  const date = new Date(timestamp)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}_${hh}${min}`
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

async function writeMeta(vaultPath: string, result: BackupResult): Promise<void> {
  const metaPath = join(normalizePath(vaultPath), META_FILE)
  await ensureDir(join(normalizePath(vaultPath), '.vanfolio'))
  await fs.writeFile(metaPath, JSON.stringify(result, null, 2), 'utf-8')
}

async function copyVaultContents(sourceDir: string, targetDir: string, backupRoot: string): Promise<void> {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true })
  await ensureDir(targetDir)

  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name)
    const targetPath = join(targetDir, entry.name)

    if (entry.isDirectory()) {
      if (entry.name === '.vanfolio') {
        const childEntries = await fs.readdir(sourcePath, { withFileTypes: true })
        await ensureDir(targetPath)
        for (const child of childEntries) {
          const childSource = join(sourcePath, child.name)
          const childTarget = join(targetPath, child.name)
          if (child.name === 'history') continue
          if (isInsideDir(childSource, backupRoot)) continue
          if (child.isDirectory()) {
            await copyVaultContents(childSource, childTarget, backupRoot)
          } else if (child.isFile()) {
            await fs.copyFile(childSource, childTarget)
          }
        }
        continue
      }

      if (isInsideDir(sourcePath, backupRoot)) continue
      await copyVaultContents(sourcePath, targetPath, backupRoot)
      continue
    }

    if (!entry.isFile()) continue
    await fs.copyFile(sourcePath, targetPath)
  }
}

export async function runBackup({
  vaultPath,
  backupPath,
}: {
  vaultPath: string
  backupPath: string
}): Promise<BackupResult> {
  if (backupRun) return backupRun

  backupRun = (async () => {
    const absoluteVaultPath = normalizePath(vaultPath)
    const absoluteBackupRoot = normalizePath(backupPath)
    const timestamp = Date.now()

    try {
      if (!backupPath.trim()) {
        return { success: false, timestamp, error: 'Missing backup path' }
      }

      if (isInsideDir(absoluteBackupRoot, absoluteVaultPath)) {
        return { success: false, timestamp, error: 'Backup path must be outside the vault' }
      }

      await ensureDir(absoluteBackupRoot)
      const destination = join(absoluteBackupRoot, `VanFolio_Backup_${formatStamp(timestamp)}`)
      await copyVaultContents(absoluteVaultPath, destination, absoluteBackupRoot)

      const result: BackupResult = { success: true, timestamp, path: destination }
      await writeMeta(absoluteVaultPath, result)
      return result
    } catch (error) {
      log.error('[backupManager] runBackup failed:', error)
      const result: BackupResult = { success: false, timestamp, error: error instanceof Error ? error.message : String(error) }
      try {
        await writeMeta(absoluteVaultPath, result)
      } catch {
        // no-op
      }
      return result
    } finally {
      backupRun = null
    }
  })()

  return backupRun
}

export function stopScheduler(): void {
  if (scheduler) clearInterval(scheduler)
  scheduler = null
  schedulerKey = ''
}

export function startScheduler({
  frequency,
  vaultPath,
  backupPath,
}: {
  frequency: AppSettings['autoBackupFrequency']
  vaultPath: string
  backupPath: string
}): void {
  stopScheduler()
}

export function restartSchedulerIfNeeded(
  oldSettings: AppSettings,
  newSettings: AppSettings,
  vaultPath: string | null,
): void {
  stopScheduler()
}

export async function getLastBackupTimestamp({ vaultPath }: { vaultPath: string }): Promise<number | null> {
  const metaPath = join(normalizePath(vaultPath), META_FILE)
  try {
    const raw = await fs.readFile(metaPath, 'utf-8')
    const parsed = JSON.parse(raw) as BackupResult
    return typeof parsed.timestamp === 'number' ? parsed.timestamp : null
  } catch {
    return null
  }
}

async function getDirSize(dirPath: string, skipPaths: Set<string> = new Set()): Promise<number> {
  let total = 0
  let entries: Awaited<ReturnType<typeof fs.readdir>> = []
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    return 0
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name)
    if (skipPaths.has(normalizePath(fullPath))) continue
    if (entry.isDirectory()) {
      total += await getDirSize(fullPath, skipPaths)
      continue
    }
    if (!entry.isFile()) continue
    try {
      total += (await fs.stat(fullPath)).size
    } catch {
      // no-op
    }
  }

  return total
}

export async function getBackupSize({ backupPath }: { backupPath: string }): Promise<number> {
  return backupPath.trim() ? getDirSize(normalizePath(backupPath)) : 0
}

export async function getVaultSize({ vaultPath }: { vaultPath: string }): Promise<number> {
  const absoluteVaultPath = normalizePath(vaultPath)
  return getDirSize(absoluteVaultPath, new Set([normalizePath(join(absoluteVaultPath, '.vanfolio', 'history'))]))
}

export async function getStorageUsage({
  vaultPath,
  backupPath,
  historyBytes,
}: {
  vaultPath: string
  backupPath: string
  historyBytes: number
}): Promise<StorageUsage> {
  const [vaultBytes, backupBytes] = await Promise.all([
    getVaultSize({ vaultPath }),
    backupPath.trim() ? getBackupSize({ backupPath }) : Promise.resolve(0),
  ])

  return {
    vaultBytes,
    historyBytes,
    backupBytes,
  }
}
