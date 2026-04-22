import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { dirname, isAbsolute, join, resolve, sep } from 'path'
import type { AppSettings, SnapshotMeta, SnapshotRecord } from '@shared/types'

type SnapshotArgs = {
  filePath: string
  content: string
  vaultPath: string
}

type SnapshotRefArgs = {
  filePath: string
  vaultPath: string
}

type SnapshotContentArgs = SnapshotRefArgs & {
  snapshotId: string
}

const HISTORY_DIR = '.vanfolio/history'
const fileQueues = new Map<string, Promise<unknown>>()

function normalizePath(input: string): string {
  return resolve(input)
}

function isInsideDir(targetPath: string, rootPath: string): boolean {
  const target = normalizePath(targetPath)
  const root = normalizePath(rootPath)
  return target === root || target.startsWith(`${root}${sep}`)
}

function ensureAbsoluteFilePath(filePath: string): string {
  if (!isAbsolute(filePath)) {
    throw new Error(`Snapshot filePath must be absolute: ${filePath}`)
  }
  return normalizePath(filePath)
}

function getHistoryRoot(vaultPath: string): string {
  return join(normalizePath(vaultPath), HISTORY_DIR)
}

function getFileHash(filePath: string): string {
  return createHash('sha1').update(normalizePath(filePath).toLowerCase()).digest('hex')
}

function getSnapshotDir(filePath: string, vaultPath: string): string {
  return join(getHistoryRoot(vaultPath), getFileHash(filePath))
}

function getSnapshotPath(filePath: string, vaultPath: string, snapshotId: string): string {
  return join(getSnapshotDir(filePath, vaultPath), `${snapshotId}.json`)
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  await ensureDir(dirname(filePath))
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
  await fs.rename(tmpPath, filePath)
}

async function readSnapshotRecord(snapshotPath: string): Promise<SnapshotRecord | null> {
  try {
    const raw = await fs.readFile(snapshotPath, 'utf-8')
    const parsed = JSON.parse(raw) as SnapshotRecord
    if (!parsed || typeof parsed.id !== 'string' || typeof parsed.content !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

async function listSnapshotFiles(filePath: string, vaultPath: string): Promise<string[]> {
  const dir = getSnapshotDir(filePath, vaultPath)
  try {
    const entries = await fs.readdir(dir)
    return entries
      .filter((name) => name.endsWith('.json'))
      .sort((a, b) => b.localeCompare(a))
      .map((name) => join(dir, name))
  } catch {
    return []
  }
}

async function listHistoryDirs(vaultPath: string): Promise<string[]> {
  const root = getHistoryRoot(vaultPath)
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name))
  } catch {
    return []
  }
}

function retentionMs(retention: AppSettings['versionHistoryRetention']): number | null {
  if (retention === '7d') return 7 * 24 * 60 * 60 * 1000
  if (retention === '30d') return 30 * 24 * 60 * 60 * 1000
  return null
}

async function pruneEmptyDir(dirPath: string): Promise<void> {
  try {
    const entries = await fs.readdir(dirPath)
    if (entries.length === 0) await fs.rmdir(dirPath)
  } catch {
    // no-op
  }
}

function queueForFile<T>(fileKey: string, task: () => Promise<T>): Promise<T> {
  const current = fileQueues.get(fileKey) ?? Promise.resolve()
  const next = current.catch(() => undefined).then(task)
  fileQueues.set(fileKey, next.finally(() => {
    if (fileQueues.get(fileKey) === next) fileQueues.delete(fileKey)
  }))
  return next
}

function toMeta(record: SnapshotRecord): SnapshotMeta {
  return {
    id: record.id,
    filePath: record.filePath,
    timestamp: record.timestamp,
    sizeBytes: record.sizeBytes,
  }
}

export async function createSnapshot({ filePath, content, vaultPath }: SnapshotArgs): Promise<SnapshotMeta | null> {
  const absoluteFilePath = ensureAbsoluteFilePath(filePath)
  const absoluteVaultPath = normalizePath(vaultPath)
  if (!isInsideDir(absoluteFilePath, absoluteVaultPath)) return null

  const fileKey = getFileHash(absoluteFilePath)
  return queueForFile(fileKey, async () => {
    const existing = await listSnapshotFiles(absoluteFilePath, absoluteVaultPath)
    if (existing.length > 0) {
      const latest = await readSnapshotRecord(existing[0])
      if (latest?.content === content) return null
    }

    const timestamp = Date.now()
    const record: SnapshotRecord = {
      id: String(timestamp),
      filePath: absoluteFilePath,
      timestamp,
      sizeBytes: Buffer.byteLength(content, 'utf-8'),
      content,
    }

    const snapshotPath = getSnapshotPath(absoluteFilePath, absoluteVaultPath, record.id)
    await writeJsonAtomic(snapshotPath, record)
    return toMeta(record)
  })
}

export async function listSnapshots({ filePath, vaultPath }: SnapshotRefArgs): Promise<SnapshotMeta[]> {
  const absoluteFilePath = ensureAbsoluteFilePath(filePath)
  const absoluteVaultPath = normalizePath(vaultPath)
  if (!isInsideDir(absoluteFilePath, absoluteVaultPath)) return []

  const files = await listSnapshotFiles(absoluteFilePath, absoluteVaultPath)
  const records = await Promise.all(files.map(readSnapshotRecord))
  return records.filter((record): record is SnapshotRecord => Boolean(record)).map(toMeta)
}

export async function getSnapshotContent({ filePath, snapshotId, vaultPath }: SnapshotContentArgs): Promise<string | null> {
  const absoluteFilePath = ensureAbsoluteFilePath(filePath)
  const absoluteVaultPath = normalizePath(vaultPath)
  if (!isInsideDir(absoluteFilePath, absoluteVaultPath)) return null
  const record = await readSnapshotRecord(getSnapshotPath(absoluteFilePath, absoluteVaultPath, snapshotId))
  if (!record || record.filePath !== absoluteFilePath) return null
  return record.content
}

export async function deleteSnapshot({ filePath, snapshotId, vaultPath }: SnapshotContentArgs): Promise<boolean> {
  const absoluteFilePath = ensureAbsoluteFilePath(filePath)
  const absoluteVaultPath = normalizePath(vaultPath)
  if (!isInsideDir(absoluteFilePath, absoluteVaultPath)) return false

  const fileKey = getFileHash(absoluteFilePath)
  return queueForFile(fileKey, async () => {
    try {
      await fs.unlink(getSnapshotPath(absoluteFilePath, absoluteVaultPath, snapshotId))
      await pruneEmptyDir(getSnapshotDir(absoluteFilePath, absoluteVaultPath))
      return true
    } catch {
      return false
    }
  })
}

export async function clearAllSnapshots({ vaultPath }: { vaultPath: string }): Promise<number> {
  const root = getHistoryRoot(vaultPath)
  try {
    const hasSnapshots = (await getHistorySize({ vaultPath })) > 0
    await fs.rm(root, { recursive: true, force: true })
    return hasSnapshots ? 1 : 0
  } catch {
    return 0
  }
}

export async function cleanupExpired({
  vaultPath,
  retention,
}: {
  vaultPath: string
  retention: AppSettings['versionHistoryRetention']
}): Promise<number> {
  const cutoffWindow = retentionMs(retention)
  if (cutoffWindow === null) return 0

  const now = Date.now()
  const dirs = await listHistoryDirs(vaultPath)
  let deleted = 0

  for (const dir of dirs) {
    let files: string[] = []
    try {
      files = (await fs.readdir(dir))
        .filter((name) => name.endsWith('.json'))
        .sort((a, b) => b.localeCompare(a))
        .map((name) => join(dir, name))
    } catch {
      continue
    }

    for (const filePath of files.slice(1)) {
      const record = await readSnapshotRecord(filePath)
      if (!record) continue
      if (now - record.timestamp <= cutoffWindow) continue
      try {
        await fs.unlink(filePath)
        deleted += 1
      } catch {
        // no-op
      }
    }

    await pruneEmptyDir(dir)
  }

  return deleted
}

export async function getLastSnapshotTimestamp({ vaultPath }: { vaultPath: string }): Promise<number | null> {
  const dirs = await listHistoryDirs(vaultPath)
  let latest: number | null = null

  for (const dir of dirs) {
    let files: string[] = []
    try {
      files = (await fs.readdir(dir))
        .filter((name) => name.endsWith('.json'))
        .sort((a, b) => b.localeCompare(a))
    } catch {
      continue
    }
    if (files.length === 0) continue
    const record = await readSnapshotRecord(join(dir, files[0]))
    if (!record) continue
    latest = latest === null ? record.timestamp : Math.max(latest, record.timestamp)
  }

  return latest
}

async function getDirSize(dirPath: string): Promise<number> {
  let total = 0
  let entries: Awaited<ReturnType<typeof fs.readdir>> = []
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    return 0
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      total += await getDirSize(fullPath)
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

export async function getHistorySize({ vaultPath }: { vaultPath: string }): Promise<number> {
  return getDirSize(getHistoryRoot(vaultPath))
}
