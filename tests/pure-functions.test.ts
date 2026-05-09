import { describe, test, expect } from 'bun:test'
import { formatDuration, truncateText, extractMessages } from '../src/lib/helpers.js'
import { parseFileReferences, isBinaryBuffer, formatTranscript, HANDOFF_COMMAND } from '../src/lib/handoff.js'
import { extractAndStripFrontmatter } from '../src/lib/skills.js'
import { resolvePromptAppend } from '../src/lib/prompt-resolver.js'
import { formatFileChanges, diffFileSnapshots } from '../src/lib/snapshot.js'
import { formatTaskStatus } from '../src/lib/task-formatting.js'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { homedir } from 'node:os'

// ─── formatDuration ──────────────────────────────────────────────────────

describe('formatDuration', () => {
  test('undefined start returns N/A', () => {
    expect(formatDuration(undefined, new Date())).toBe('N/A')
  })

  test('both undefined end uses now', () => {
    const start = new Date()
    const result = formatDuration(start, undefined)
    // Should be a small number of ms
    expect(result).toMatch(/^\d+ms$/)
  })

  test('same start and end is 0ms', () => {
    const now = new Date()
    expect(formatDuration(now, now)).toBe('0ms')
  })

  test('sub-second duration', () => {
    const start = new Date('2024-01-01T00:00:00.000Z')
    const end = new Date('2024-01-01T00:00:00.500Z')
    expect(formatDuration(start, end)).toBe('500ms')
  })

  test('seconds duration', () => {
    const start = new Date('2024-01-01T00:00:00.000Z')
    const end = new Date('2024-01-01T00:00:05.000Z')
    expect(formatDuration(start, end)).toBe('5.0s')
  })

  test('minutes and seconds duration', () => {
    const start = new Date('2024-01-01T00:00:00.000Z')
    const end = new Date('2024-01-01T00:02:05.000Z')
    expect(formatDuration(start, end)).toBe('2m 5s')
  })

  test('exactly 60 seconds shows as 1m 0s', () => {
    const start = new Date('2024-01-01T00:00:00.000Z')
    const end = new Date('2024-01-01T00:01:00.000Z')
    expect(formatDuration(start, end)).toBe('1m 0s')
  })

  test('999ms shows as ms', () => {
    const start = new Date('2024-01-01T00:00:00.000Z')
    const end = new Date('2024-01-01T00:00:00.999Z')
    expect(formatDuration(start, end)).toBe('999ms')
  })

  test('1000ms shows as seconds', () => {
    const start = new Date('2024-01-01T00:00:00.000Z')
    const end = new Date('2024-01-01T00:00:01.000Z')
    expect(formatDuration(start, end)).toBe('1.0s')
  })
})

// ─── truncateText ────────────────────────────────────────────────────────

describe('truncateText', () => {
  test('empty string unchanged', () => {
    expect(truncateText('', 10)).toBe('')
  })

  test('short string unchanged', () => {
    expect(truncateText('hello', 10)).toBe('hello')
  })

  test('exact length unchanged', () => {
    expect(truncateText('12345', 5)).toBe('12345')
  })

  test('over max length truncated with ellipsis', () => {
    expect(truncateText('1234567890', 5)).toBe('12345…')
  })

  test('maxLength 0 truncates everything', () => {
    expect(truncateText('hello', 0)).toBe('…')
  })
})

// ─── extractMessages ─────────────────────────────────────────────────────

describe('extractMessages', () => {
  test('array input returned as-is', () => {
    const msgs = [{ id: 1 }, { id: 2 }]
    expect(extractMessages(msgs)).toBe(msgs)
  })

  test('.data array returned', () => {
    const msgs = [{ id: 1 }]
    expect(extractMessages({ data: msgs })).toEqual(msgs)
  })

  test('.data.messages array returned', () => {
    const msgs = [{ id: 1 }]
    expect(extractMessages({ data: { messages: msgs } })).toEqual(msgs)
  })

  test('.messages array returned', () => {
    const msgs = [{ id: 1 }]
    expect(extractMessages({ messages: msgs })).toEqual(msgs)
  })

  test('null returns empty array', () => {
    expect(extractMessages(null)).toEqual([])
  })

  test('undefined returns empty array', () => {
    expect(extractMessages(undefined)).toEqual([])
  })

  test('empty object returns empty array', () => {
    expect(extractMessages({})).toEqual([])
  })

  test('string returns empty array', () => {
    expect(extractMessages('hello')).toEqual([])
  })

  test('number returns empty array', () => {
    expect(extractMessages(42)).toEqual([])
  })
})

// ─── parseFileReferences ─────────────────────────────────────────────────

describe('parseFileReferences', () => {
  test('extracts @file paths', () => {
    const result = parseFileReferences('check @src/foo.ts and @./bar/baz.ts')
    expect(result).toContain('src/foo.ts')
    expect(result).toContain('./bar/baz.ts')
    expect(result).toHaveLength(2)
  })

  test('no refs returns empty', () => {
    expect(parseFileReferences('no refs here')).toEqual([])
  })

  test('deduplicates identical refs', () => {
    const result = parseFileReferences('@src/a.ts @src/a.ts')
    expect(result).toHaveLength(1)
  })

  test('email does not match (no path separator)', () => {
    const result = parseFileReferences('email@domain.com')
    expect(result).toEqual([])
  })

  test('parenthesized ref matches', () => {
    const result = parseFileReferences('see (@src/foo.ts)')
    expect(result).toContain('src/foo.ts')
  })

  test('multiple different paths', () => {
    const result = parseFileReferences('@src/a.ts @lib/b.ts @./c.ts')
    expect(result).toHaveLength(3)
  })

  test('no false positives on regular text', () => {
    expect(parseFileReferences('hello world')).toEqual([])
  })
})

// ─── isBinaryBuffer ──────────────────────────────────────────────────────

describe('isBinaryBuffer', () => {
  test('text buffer is not binary', () => {
    expect(isBinaryBuffer(Buffer.from('hello world'))).toBe(false)
  })

  test('null byte is binary', () => {
    expect(isBinaryBuffer(Buffer.from([0x00]))).toBe(true)
  })

  test('control char < 0x07 is binary', () => {
    expect(isBinaryBuffer(Buffer.from([0x01]))).toBe(true)
  })

  test('LF (0x0a) is not binary', () => {
    expect(isBinaryBuffer(Buffer.from([0x0a]))).toBe(false)
  })

  test('CR (0x0d) is not binary', () => {
    expect(isBinaryBuffer(Buffer.from([0x0d]))).toBe(false)
  })

  test('control char 0x1f is binary', () => {
    expect(isBinaryBuffer(Buffer.from([0x1f]))).toBe(true)
  })

  test('empty buffer is not binary', () => {
    expect(isBinaryBuffer(Buffer.alloc(0))).toBe(false)
  })

  test('UTF-8 multibyte is not binary', () => {
    expect(isBinaryBuffer(Buffer.from('héllo wörld'))).toBe(false)
  })

  test('tab (0x09) is not binary', () => {
    expect(isBinaryBuffer(Buffer.from('\t'))).toBe(false)
  })
})

// ─── extractAndStripFrontmatter ──────────────────────────────────────────

describe('extractAndStripFrontmatter', () => {
  test('parses frontmatter correctly', () => {
    const input = '---\nname: test\ndesc: foo\n---\nbody content'
    const result = extractAndStripFrontmatter(input)
    expect(result.frontmatter.name).toBe('test')
    expect(result.frontmatter.desc).toBe('foo')
    expect(result.content.trim()).toBe('body content')
  })

  test('no frontmatter returns empty object', () => {
    const result = extractAndStripFrontmatter('just content')
    expect(result.frontmatter).toEqual({})
    expect(result.content).toBe('just content')
  })

  test('strips quotes from values', () => {
    const input = '---\nname: "quoted value"\n---\nbody'
    const result = extractAndStripFrontmatter(input)
    expect(result.frontmatter.name).toBe('quoted value')
  })

  test('single-quoted values stripped', () => {
    const input = "---\nname: 'single quoted'\n---\nbody"
    const result = extractAndStripFrontmatter(input)
    expect(result.frontmatter.name).toBe('single quoted')
  })

  test('empty frontmatter section with no blank line is not parsed', () => {
    // '---\n---\nbody' has no content between the delimiters
    // The regex requires at least a \n before closing ---, so this won't match
    const input = '---\n---\nbody'
    const result = extractAndStripFrontmatter(input)
    // Without proper separation, frontmatter is not parsed
    expect(result.frontmatter).toEqual({})
  })

  test('frontmatter with blank line between delimiters', () => {
    const input = '---\n\n---\nbody'
    const result = extractAndStripFrontmatter(input)
    expect(result.frontmatter).toEqual({})
    expect(result.content.trim()).toBe('body')
  })

  test('frontmatter with colons in value', () => {
    const input = '---\nurl: https://example.com:8080\n---\nbody'
    const result = extractAndStripFrontmatter(input)
    expect(result.frontmatter.url).toBe('https://example.com:8080')
  })
})

// ─── resolvePromptAppend ─────────────────────────────────────────────────

describe('resolvePromptAppend', () => {
  test('non-file:// returned as-is', () => {
    expect(resolvePromptAppend('just a string')).toBe('just a string')
  })

  test('empty string returned as-is', () => {
    expect(resolvePromptAppend('')).toBe('')
  })

  test('file:// with missing file returns warning', () => {
    const result = resolvePromptAppend('file:///nonexistent/path/to/file.txt')
    expect(result).toContain('WARNING')
    expect(result).toContain('Could not resolve')
  })

  test('file:// reads existing file', () => {
    const tmpFile = join(tmpdir(), `test-prompt-${Date.now()}.txt`)
    writeFileSync(tmpFile, 'test content')
    try {
      const result = resolvePromptAppend(`file://${tmpFile}`)
      expect(result).toBe('test content')
    } finally {
      rmSync(tmpFile)
    }
  })

  test('file:// with ~ resolves to home', () => {
    // This tests the tilde expansion path - the file may or may not exist
    const result = resolvePromptAppend('file://~/.nonexistent_test_file_xyz.txt')
    // Should either resolve and find it, or return a warning with the expanded home path
    expect(result).toContain(homedir())
  })

  test('malformed URI returns warning', () => {
    // Use %ZZ which is invalid URI encoding
    const result = resolvePromptAppend('file:///%ZZbad')
    expect(result).toContain('WARNING')
  })
})

// ─── diffFileSnapshots ───────────────────────────────────────────────────

describe('diffFileSnapshots', () => {
  // Now uses DirectorySnapshot type properly: { files: FileRecord[], directories: string[], timestamp: string }
  // Returns FileChange[] with { path: string, type: 'added' | 'removed' | 'modified' }
  test('detects created files', () => {
    const before: any = { files: [{ path: 'a.ts', size: 100, mtime: '2024-01-01' }] }
    const after: any = { files: [{ path: 'a.ts', size: 100, mtime: '2024-01-01' }, { path: 'b.ts', size: 50, mtime: '2024-01-02' }] }
    const changes = diffFileSnapshots(before, after)
    expect(changes).toHaveLength(1)
    expect(changes[0].path).toBe('b.ts')
    expect(changes[0].type).toBe('added')
  })

  test('detects modified files (size change)', () => {
    const before: any = { files: [{ path: 'a.ts', size: 100, mtime: '2024-01-01' }] }
    const after: any = { files: [{ path: 'a.ts', size: 200, mtime: '2024-01-01' }] }
    const changes = diffFileSnapshots(before, after)
    expect(changes).toHaveLength(1)
    expect(changes[0].path).toBe('a.ts')
    expect(changes[0].type).toBe('modified')
  })

  test('detects modified files (mtime change)', () => {
    const before: any = { files: [{ path: 'a.ts', size: 100, mtime: '2024-01-01' }] }
    const after: any = { files: [{ path: 'a.ts', size: 100, mtime: '2024-01-02' }] }
    const changes = diffFileSnapshots(before, after)
    expect(changes).toHaveLength(1)
    expect(changes[0].type).toBe('modified')
  })

  test('detects deleted files', () => {
    const before: any = { files: [{ path: 'a.ts', size: 100, mtime: '2024-01-01' }, { path: 'c.ts', size: 80, mtime: '2024-01-01' }] }
    const after: any = { files: [{ path: 'a.ts', size: 100, mtime: '2024-01-01' }] }
    const changes = diffFileSnapshots(before, after)
    expect(changes).toHaveLength(1)
    expect(changes[0].path).toBe('c.ts')
    expect(changes[0].type).toBe('removed')
  })

  test('unchanged files produce no changes', () => {
    const before: any = { files: [{ path: 'a.ts', size: 100, mtime: '2024-01-01' }] }
    const after: any = { files: [{ path: 'a.ts', size: 100, mtime: '2024-01-01' }] }
    const changes = diffFileSnapshots(before, after)
    expect(changes).toHaveLength(0)
  })

  test('both empty returns no changes', () => {
    const before: any = { files: [] }
    const after: any = { files: [] }
    const changes = diffFileSnapshots(before, after)
    expect(changes).toHaveLength(0)
  })

  test('mixed changes', () => {
    const before: any = { files: [{ path: 'a.ts', size: 100, mtime: '2024-01-01' }, { path: 'c.ts', size: 80, mtime: '2024-01-01' }] }
    const after: any = { files: [{ path: 'a.ts', size: 200, mtime: '2024-01-02' }, { path: 'b.ts', size: 50, mtime: '2024-01-02' }] }
    const changes = diffFileSnapshots(before, after)
    expect(changes).toHaveLength(3) // a.ts modified, b.ts added, c.ts removed
    expect(changes.some(c => c.path === 'a.ts' && c.type === 'modified')).toBe(true)
    expect(changes.some(c => c.path === 'b.ts' && c.type === 'added')).toBe(true)
    expect(changes.some(c => c.path === 'c.ts' && c.type === 'removed')).toBe(true)
  })
})

// ─── formatFileChanges ───────────────────────────────────────────────────

describe('formatFileChanges', () => {
  test('created files', () => {
    const changes = [{ path: 'new.ts', type: 'added' as const }]
    const result = formatFileChanges(changes)
    expect(result).toContain('Files created')
    expect(result).toContain('+ new.ts')
  })

  test('modified files', () => {
    const changes = [{ path: 'mod.ts', type: 'modified' as const }]
    const result = formatFileChanges(changes)
    expect(result).toContain('Files modified')
    expect(result).toContain('~ mod.ts')
  })

  test('deleted files', () => {
    const changes = [{ path: 'old.ts', type: 'removed' as const }]
    const result = formatFileChanges(changes)
    expect(result).toContain('Files deleted')
    expect(result).toContain('- old.ts')
  })

  test('no changes detected', () => {
    const result = formatFileChanges([])
    expect(result).toContain('No file changes detected')
  })

  test('mixed changes', () => {
    const changes = [
      { path: 'new.ts', type: 'added' as const },
      { path: 'mod.ts', type: 'modified' as const },
      { path: 'old.ts', type: 'removed' as const },
    ]
    const result = formatFileChanges(changes)
    expect(result).toContain('Files created')
    expect(result).toContain('Files modified')
    expect(result).toContain('Files deleted')
    expect(result).toContain('+ new.ts')
    expect(result).toContain('~ mod.ts')
    expect(result).toContain('- old.ts')
  })
})

// ─── formatTaskStatus ────────────────────────────────────────────────────

describe('formatTaskStatus', () => {
  test('pending task shows queued', () => {
    const task = { id: 't1', status: 'pending', description: 'test task', queuedAt: new Date(), agent: 'coder' }
    const result = formatTaskStatus(task)
    expect(result).toContain('t1')
    expect(result).toContain('queued')
  })

  test('running task shows running', () => {
    const task = { id: 't2', status: 'running', description: 'active task', startedAt: new Date(), agent: 'coder' }
    const result = formatTaskStatus(task)
    expect(result).toContain('running')
  })

  test('completed task shows duration', () => {
    const task = {
      id: 't3', status: 'completed', description: 'done task', agent: 'coder',
      startedAt: new Date('2024-01-01T00:00:00Z'),
      completedAt: new Date('2024-01-01T00:00:05Z')
    }
    const result = formatTaskStatus(task)
    expect(result).toContain('completed')
    expect(result).toContain('5.0s')
  })

  test('failed task shows failed', () => {
    const task = {
      id: 't4', status: 'failed', description: 'bad task', agent: 'coder',
      error: 'something went wrong',
      startedAt: new Date('2024-01-01T00:00:00Z'),
      completedAt: new Date('2024-01-01T00:00:02Z')
    }
    const result = formatTaskStatus(task)
    expect(result).toContain('failed')
  })

  test('cancelled task', () => {
    const task = { id: 't5', status: 'cancelled', description: 'stopped task', agent: 'coder' }
    const result = formatTaskStatus(task)
    expect(result).toContain('cancelled')
  })

  test('interrupted task', () => {
    const task = { id: 't6', status: 'interrupt', description: 'interrupted task', agent: 'coder' }
    const result = formatTaskStatus(task)
    expect(result).toContain('interrupted')
  })

  test('waiting task', () => {
    const task = { id: 't7', status: 'waiting', description: 'waiting task', agent: 'coder' }
    const result = formatTaskStatus(task)
    expect(result).toContain('waiting')
  })

  test('error status maps to failed', () => {
    const task = { id: 't8', status: 'error', description: 'error task', agent: 'coder', startedAt: new Date() }
    const result = formatTaskStatus(task)
    expect(result).toContain('failed')
  })
})
