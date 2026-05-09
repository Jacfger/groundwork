import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { FileChange } from '../types.js'

/** Internal snapshot format — flat arrays of file records */
interface FileRecord {
  path: string
  size: number
  mtime: string
}

interface DirectorySnapshot {
  files: FileRecord[]
  directories: string[]
  timestamp: string
}

export async function captureFileSnapshot(directory: string, maxDepth = 3): Promise<DirectorySnapshot> {
  const snapshot: DirectorySnapshot = { files: [], directories: [], timestamp: new Date().toISOString() }

  async function walk(dir: string, depth: number) {
    if (depth > maxDepth) return
    try {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        const relativePath = path.relative(directory, fullPath)

        // Skip node_modules, .git, and hidden directories
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue

        if (entry.isDirectory()) {
          snapshot.directories.push(relativePath)
          await walk(fullPath, depth + 1)
        } else if (entry.isFile()) {
          try {
            const stats = await fsPromises.stat(fullPath)
            snapshot.files.push({
              path: relativePath,
              size: stats.size,
              mtime: stats.mtime.toISOString(),
            })
          } catch {
            // Skip files we can't stat
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  await walk(directory, 0)
  return snapshot
}

export function diffFileSnapshots(before: DirectorySnapshot, after: DirectorySnapshot): FileChange[] {
  const changes: FileChange[] = []

  const beforeMap = new Map(before.files.map(f => [f.path, f]))
  const afterMap = new Map(after.files.map(f => [f.path, f]))

  // Find created and modified files
  for (const [filePath, afterFile] of afterMap) {
    const beforeFile = beforeMap.get(filePath)
    if (!beforeFile) {
      changes.push({ path: filePath, type: 'added' })
    } else if (beforeFile.mtime !== afterFile.mtime || beforeFile.size !== afterFile.size) {
      changes.push({ path: filePath, type: 'modified' })
    }
  }

  // Find deleted files
  for (const [filePath] of beforeMap) {
    if (!afterMap.has(filePath)) {
      changes.push({ path: filePath, type: 'removed' })
    }
  }

  return changes
}

export function formatFileChanges(changes: FileChange[]): string {
  const lines: string[] = []
  const created = changes.filter(c => c.type === 'added')
  const modified = changes.filter(c => c.type === 'modified')
  const deleted = changes.filter(c => c.type === 'removed')

  if (created.length > 0) {
    lines.push(`\n📁 Files created (${created.length}):`)
    for (const file of created) {
      lines.push(`  + ${file.path}`)
    }
  }

  if (modified.length > 0) {
    lines.push(`\n✏️  Files modified (${modified.length}):`)
    for (const file of modified) {
      lines.push(`  ~ ${file.path}`)
    }
  }

  if (deleted.length > 0) {
    lines.push(`\n🗑️  Files deleted (${deleted.length}):`)
    for (const file of deleted) {
      lines.push(`  - ${file.path}`)
    }
  }

  if (lines.length === 0) {
    lines.push('\n✓ No file changes detected')
  }

  return lines.join('\n')
}
