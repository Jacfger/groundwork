// ─── Goal Persistence Tests ─────────────────────────────────────────────────

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { readGoal, writeGoal, clearGoal, goalReminder, type Goal } from '../src/lib/goal.js'

const tmpDir = path.join(os.tmpdir(), 'groundwork-goal-test')
const sessionID = 'sess_test_123'

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true })
  mkdirSync(path.join(tmpDir, '.opencode', 'goals'), { recursive: true })
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('Goal Persistence', () => {
  test('readGoal returns null when no goal file exists', () => {
    expect(readGoal(tmpDir, sessionID)).toBeNull()
  })

  test('writeGoal + readGoal roundtrip', () => {
    const goal: Goal = {
      objective: 'Test all routing paths',
      acceptanceCriteria: ['Path 1 works', 'Path 2 works'],
      status: 'active',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
    }
    writeGoal(tmpDir, sessionID, goal)
    const read = readGoal(tmpDir, sessionID)
    expect(read).not.toBeNull()
    expect(read!.objective).toBe('Test all routing paths')
    expect(read!.acceptanceCriteria).toEqual(['Path 1 works', 'Path 2 works'])
    expect(read!.status).toBe('active')
  })

  test('writeGoal updates updatedAt', () => {
    const goal: Goal = {
      objective: 'Test',
      acceptanceCriteria: ['Criterion'],
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    writeGoal(tmpDir, sessionID, goal)
    const read = readGoal(tmpDir, sessionID)
    expect(read!.updatedAt).not.toBe('2026-01-01T00:00:00.000Z')
  })

  test('clearGoal removes the goal file', () => {
    const goal: Goal = {
      objective: 'Test',
      acceptanceCriteria: ['Criterion'],
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    writeGoal(tmpDir, sessionID, goal)
    expect(readGoal(tmpDir, sessionID)).not.toBeNull()
    expect(clearGoal(tmpDir, sessionID)).toBe(true)
    expect(readGoal(tmpDir, sessionID)).toBeNull()
  })

  test('clearGoal returns false when no goal exists', () => {
    expect(clearGoal(tmpDir, sessionID)).toBe(false)
  })

  test('readGoal returns null on malformed JSON', () => {
    writeFileSync(path.join(tmpDir, '.opencode', 'goals', `${sessionID}.json`), 'not json{{{')
    expect(readGoal(tmpDir, sessionID)).toBeNull()
  })

  test('goalReminder produces ACTIVE_GOAL block', () => {
    const goal: Goal = {
      objective: 'Build the thing',
      acceptanceCriteria: ['Criterion A', 'Criterion B'],
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const reminder = goalReminder(goal)
    expect(reminder).toContain('<ACTIVE_GOAL>')
    expect(reminder).toContain('</ACTIVE_GOAL>')
    expect(reminder).toContain('Build the thing')
    expect(reminder).toContain('1. Criterion A')
    expect(reminder).toContain('2. Criterion B')
    expect(reminder).toContain('advisor-gate')
  })

  test('migrateLegacyGoal migrates legacy goal.json to session-scoped file', () => {
    const legacyGoal: Goal = {
      objective: 'Legacy goal',
      acceptanceCriteria: ['Migrate me'],
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    writeFileSync(path.join(tmpDir, '.opencode', 'goal.json'), JSON.stringify(legacyGoal, null, 2))
    const read = readGoal(tmpDir, sessionID)
    expect(read).not.toBeNull()
    expect(read!.objective).toBe('Legacy goal')
    expect(existsSync(path.join(tmpDir, '.opencode', 'goal.json'))).toBe(false)
    expect(existsSync(path.join(tmpDir, '.opencode', 'goals', `${sessionID}.json`))).toBe(true)
  })

  test('migrateLegacyGoal does not overwrite existing session goal', () => {
    const sessionGoal: Goal = {
      objective: 'Session goal',
      acceptanceCriteria: ['Do not overwrite'],
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const legacyGoal: Goal = {
      objective: 'Legacy goal',
      acceptanceCriteria: ['Migrate me'],
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    writeFileSync(path.join(tmpDir, '.opencode', 'goals', `${sessionID}.json`), JSON.stringify(sessionGoal, null, 2))
    writeFileSync(path.join(tmpDir, '.opencode', 'goal.json'), JSON.stringify(legacyGoal, null, 2))
    const read = readGoal(tmpDir, sessionID)
    expect(read).not.toBeNull()
    expect(read!.objective).toBe('Session goal')
    expect(existsSync(path.join(tmpDir, '.opencode', 'goal.json'))).toBe(true)
  })

  test('writeGoal does not overwrite existing session goal with legacy file present', () => {
    const sessionGoal: Goal = {
      objective: 'Session goal',
      acceptanceCriteria: ['Do not overwrite'],
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const legacyGoal: Goal = {
      objective: 'Legacy goal',
      acceptanceCriteria: ['Migrate me'],
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    writeFileSync(path.join(tmpDir, '.opencode', 'goals', `${sessionID}.json`), JSON.stringify(sessionGoal, null, 2))
    writeFileSync(path.join(tmpDir, '.opencode', 'goal.json'), JSON.stringify(legacyGoal, null, 2))
    const newGoal: Goal = {
      objective: 'New goal',
      acceptanceCriteria: ['Write me'],
      status: 'active',
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    }
    writeGoal(tmpDir, sessionID, newGoal)
    const read = readGoal(tmpDir, sessionID)
    expect(read).not.toBeNull()
    expect(read!.objective).toBe('New goal')
  })
})
