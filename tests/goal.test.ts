// ─── Goal Persistence Tests ─────────────────────────────────────────────────

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { readGoal, writeGoal, clearGoal, goalReminder, type Goal } from '../src/lib/goal.js'

const tmpDir = path.join(os.tmpdir(), 'groundwork-goal-test')

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true })
  mkdirSync(path.join(tmpDir, '.opencode'), { recursive: true })
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('Goal Persistence', () => {
  test('readGoal returns null when no goal file exists', () => {
    expect(readGoal(tmpDir)).toBeNull()
  })

  test('writeGoal + readGoal roundtrip', () => {
    const goal: Goal = {
      objective: 'Test all routing paths',
      acceptanceCriteria: ['Path 1 works', 'Path 2 works'],
      status: 'active',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
    }
    writeGoal(tmpDir, goal)
    const read = readGoal(tmpDir)
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
    writeGoal(tmpDir, goal)
    const read = readGoal(tmpDir)
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
    writeGoal(tmpDir, goal)
    expect(readGoal(tmpDir)).not.toBeNull()
    expect(clearGoal(tmpDir)).toBe(true)
    expect(readGoal(tmpDir)).toBeNull()
  })

  test('clearGoal returns false when no goal exists', () => {
    expect(clearGoal(tmpDir)).toBe(false)
  })

  test('readGoal returns null on malformed JSON', () => {
    const { writeFileSync } = require('node:fs')
    writeFileSync(path.join(tmpDir, '.opencode', 'goal.json'), 'not json{{{')
    expect(readGoal(tmpDir)).toBeNull()
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
})
