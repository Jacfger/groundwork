// ─── Goal Persistence Tests ─────────────────────────────────────────────────

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { readGoal, writeGoal, clearGoal, goalReminder, injectGoalAndBootstrap, type Goal, type InjectionParams } from '../src/lib/goal.js'

// ─── Regression: Goal & Bootstrap Injection via injectGoalAndBootstrap ──────
// Tests the shared pure function used by the actual transform hook. This
// eliminates mirror-testing and catches real regressions in the injection logic.

function makeMessage(role: string, text: string, info?: Record<string, any>) {
  return { info: { role, ...info }, parts: text ? [{ type: 'text', text }] : [] }
}

describe('injectGoalAndBootstrap', () => {
  const bootstrapText = 'EXTREMELY_IMPORTANT\nBootstrap content here'
  const goalReminderText = '<ACTIVE_GOAL>\nGoal: Fix the bug\n</ACTIVE_GOAL>'

  test('injects bootstrap into first user message with synthetic: true', () => {
    const messages = [makeMessage('user', 'Hello world')]
    injectGoalAndBootstrap(messages, { bootstrap: bootstrapText, goalReminder: null })
    const firstPart = messages[0].parts[0]
    expect(firstPart).toEqual({ type: 'text', text: bootstrapText, synthetic: true })
  })

  test('injects goal reminder into last user message with synthetic: true', () => {
    const messages = [
      makeMessage('user', 'First message'),
      makeMessage('assistant', 'Response'),
      makeMessage('user', 'Last message'),
    ]
    injectGoalAndBootstrap(messages, { bootstrap: null, goalReminder: goalReminderText })
    const lastUser = messages.filter((m: any) => m.info.role === 'user').pop()!
    const lastPart = lastUser.parts[lastUser.parts.length - 1]
    expect(lastPart).toEqual({ type: 'text', text: goalReminderText, synthetic: true })
  })

  test('both bootstrap and goal are injected in the same call', () => {
    const messages = [
      makeMessage('user', 'First message'),
      makeMessage('assistant', 'Response'),
      makeMessage('user', 'Last message'),
    ]
    injectGoalAndBootstrap(messages, { bootstrap: bootstrapText, goalReminder: goalReminderText })
    // Bootstrap in first user
    const firstPart = messages[0].parts[0]
    expect(firstPart).toEqual({ type: 'text', text: bootstrapText, synthetic: true })
    // Goal in last user
    const lastUser = messages[2]
    const lastPart = lastUser.parts[lastUser.parts.length - 1]
    expect(lastPart).toEqual({ type: 'text', text: goalReminderText, synthetic: true })
  })

  test('injected parts have exactly 3 keys: type, text, synthetic', () => {
    const messages = [makeMessage('user', 'Hi')]
    injectGoalAndBootstrap(messages, { bootstrap: bootstrapText, goalReminder: goalReminderText })
    const injectedPart = messages[0].parts[0]
    expect(Object.keys(injectedPart).sort()).toEqual(['synthetic', 'text', 'type'])
  })

  test('does not double-inject bootstrap (idempotent)', () => {
    const messages = [makeMessage('user', 'EXTREMELY_IMPORTANT\nAlready injected')]
    injectGoalAndBootstrap(messages, { bootstrap: bootstrapText, goalReminder: null })
    // The "EXTREMELY_IMPORTANT" guard should prevent re-injection
    expect(messages[0].parts).toHaveLength(1)
    expect(messages[0].parts[0].text).toBe('EXTREMELY_IMPORTANT\nAlready injected')
  })

  test('does not double-inject goal reminder (idempotent)', () => {
    const messages = [
      makeMessage('user', 'Already has ACTIVE_GOAL'),
    ]
    injectGoalAndBootstrap(messages, { bootstrap: null, goalReminder: goalReminderText })
    // The "ACTIVE_GOAL" guard should prevent re-injection
    expect(messages[0].parts).toHaveLength(1)
    expect(messages[0].parts[0].text).toBe('Already has ACTIVE_GOAL')
  })

  test('no-op on empty messages', () => {
    const messages: any[] = []
    injectGoalAndBootstrap(messages, { bootstrap: bootstrapText, goalReminder: goalReminderText })
    expect(messages).toHaveLength(0)
  })

  test('no-op when no user messages exist', () => {
    const messages = [makeMessage('assistant', 'System response')]
    injectGoalAndBootstrap(messages, { bootstrap: bootstrapText, goalReminder: goalReminderText })
    expect(messages[0].parts).toHaveLength(1)
    expect(messages[0].parts[0].synthetic).toBeUndefined()
  })

  test('no-op when bootstrap is null and goalReminder is null', () => {
    const messages = [makeMessage('user', 'Hello')]
    injectGoalAndBootstrap(messages, { bootstrap: null, goalReminder: null })
    expect(messages[0].parts).toHaveLength(1)
    expect(messages[0].parts[0].text).toBe('Hello')
  })

  test('only goal is injected when bootstrap is null', () => {
    const messages = [
      makeMessage('user', 'First message'),
      makeMessage('user', 'Last message'),
    ]
    injectGoalAndBootstrap(messages, { bootstrap: null, goalReminder: goalReminderText })
    // First user should not have bootstrap
    expect(messages[0].parts[0].text).toBe('First message')
    // Last user should have goal
    const lastUser = messages[1]
    expect(lastUser.parts[1]).toEqual({ type: 'text', text: goalReminderText, synthetic: true })
  })

  test('only bootstrap is injected when goalReminder is null', () => {
    const messages = [
      makeMessage('user', 'First message'),
      makeMessage('user', 'Last message'),
    ]
    injectGoalAndBootstrap(messages, { bootstrap: bootstrapText, goalReminder: null })
    // First user gets bootstrap
    expect(messages[0].parts[0]).toEqual({ type: 'text', text: bootstrapText, synthetic: true })
    // Last user gets no goal
    expect(messages[1].parts).toHaveLength(1)
    expect(messages[1].parts[0].text).toBe('Last message')
  })

  test('goal injected on last user if same message is first and last', () => {
    const messages = [makeMessage('user', 'Only message')]
    injectGoalAndBootstrap(messages, { bootstrap: bootstrapText, goalReminder: goalReminderText })
    // Both bootstrap (unshifted to front) and goal (pushed to back)
    expect(messages[0].parts).toHaveLength(3)
    expect(messages[0].parts[0]).toEqual({ type: 'text', text: bootstrapText, synthetic: true })
    expect(messages[0].parts[1].text).toBe('Only message')
    expect(messages[0].parts[2]).toEqual({ type: 'text', text: goalReminderText, synthetic: true })
  })

  test('no-op when first user has empty parts array', () => {
    const messages = [makeMessage('user', '')]
    injectGoalAndBootstrap(messages, { bootstrap: bootstrapText, goalReminder: goalReminderText })
    // parts is empty, so injection is skipped
    expect(messages[0].parts).toHaveLength(0)
  })
})

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
