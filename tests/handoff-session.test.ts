// ─── Handoff Session Tool Tests ─────────────────────────────────────────────

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHandoffSessionTool } from '../src/tools/handoff-session.js'
import type { Goal } from '../src/lib/goal.js'

const tmpDir = path.join(os.tmpdir(), 'groundwork-handoff-test')
const oldSessionID = 'sess_old_123'
const newSessionID = 'sess_new_456'

function mockClient(overrides: any = {}) {
  return {
    session: {
      create: overrides.sessionCreate || (async () => ({ data: { id: newSessionID } })),
    },
    tui: {
      route: {
        navigate: overrides.navigate || (() => {}),
      },
      appendPrompt: overrides.appendPrompt || (async () => {}),
      showToast: overrides.showToast || (async () => {}),
    }
  }
}

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true })
  mkdirSync(path.join(tmpDir, '.opencode', 'goals'), { recursive: true })
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('createHandoffSessionTool', () => {
  test('includes goal in prompt when goal exists', async () => {
    const goal: Goal = {
      objective: 'Complete the handoff feature',
      acceptanceCriteria: ['Read current goal', 'Copy to new session'],
      status: 'active',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
    }
    const goalPath = path.join(tmpDir, '.opencode', 'goals', `${oldSessionID}.json`)
    mkdirSync(path.dirname(goalPath), { recursive: true })
    writeFileSync(goalPath, JSON.stringify(goal, null, 2))

    let capturedPrompt = ''
    const client = mockClient({
      appendPrompt: async ({ body }: any) => {
        capturedPrompt = body.text
      }
    })

    const tool = createHandoffSessionTool({ client, directory: tmpDir })
    await tool.execute({ prompt: 'Handoff summary here' }, { sessionID: oldSessionID })

    expect(capturedPrompt).toContain('Current goal: Complete the handoff feature')
    expect(capturedPrompt).toContain('1. Read current goal')
    expect(capturedPrompt).toContain('2. Copy to new session')
    expect(capturedPrompt).toContain('Handoff summary here')
  })

  test('copies goal to new session', async () => {
    const goal: Goal = {
      objective: 'Migrate goal to new session',
      acceptanceCriteria: ['Goal file created for new session'],
      status: 'active',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
    }
    const goalPath = path.join(tmpDir, '.opencode', 'goals', `${oldSessionID}.json`)
    mkdirSync(path.dirname(goalPath), { recursive: true })
    writeFileSync(goalPath, JSON.stringify(goal, null, 2))

    const client = mockClient()

    const tool = createHandoffSessionTool({ client, directory: tmpDir })
    const result = await tool.execute({ prompt: 'Handoff' }, { sessionID: oldSessionID })

    const newGoalPath = path.join(tmpDir, '.opencode', 'goals', `${newSessionID}.json`)
    expect(existsSync(newGoalPath)).toBe(true)
    const newGoal = JSON.parse(readFileSync(newGoalPath, 'utf8'))
    expect(newGoal.objective).toBe('Migrate goal to new session')
    expect(result).toContain('Goal copied successfully')
  })

  test('navigates to new session', async () => {
    const goal: Goal = {
      objective: 'Test navigation',
      acceptanceCriteria: ['Navigate to new session'],
      status: 'active',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
    }
    const goalPath = path.join(tmpDir, '.opencode', 'goals', `${oldSessionID}.json`)
    mkdirSync(path.dirname(goalPath), { recursive: true })
    writeFileSync(goalPath, JSON.stringify(goal, null, 2))

    let navigatedTo = ''
    const client = mockClient({
      navigate: (_name: string, params: any) => {
        navigatedTo = params.sessionID
      }
    })

    const tool = createHandoffSessionTool({ client, directory: tmpDir })
    await tool.execute({ prompt: 'Handoff' }, { sessionID: oldSessionID })

    expect(navigatedTo).toBe(newSessionID)
  })

  test('works normally when no goal exists', async () => {
    let capturedPrompt = ''
    const client = mockClient({
      appendPrompt: async ({ body }: any) => {
        capturedPrompt = body.text
      }
    })

    const tool = createHandoffSessionTool({ client, directory: tmpDir })
    const result = await tool.execute({ prompt: 'Handoff without goal' }, { sessionID: oldSessionID })

    expect(capturedPrompt).toContain('Handoff without goal')
    expect(capturedPrompt).not.toContain('Current goal:')
    expect(result).not.toContain('Goal copied successfully')
  })

  test('includes file refs and goal in prompt together', async () => {
    const goal: Goal = {
      objective: 'Test file refs + goal',
      acceptanceCriteria: ['Both present'],
      status: 'active',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
    }
    const goalPath = path.join(tmpDir, '.opencode', 'goals', `${oldSessionID}.json`)
    mkdirSync(path.dirname(goalPath), { recursive: true })
    writeFileSync(goalPath, JSON.stringify(goal, null, 2))

    let capturedPrompt = ''
    const client = mockClient({
      appendPrompt: async ({ body }: any) => {
        capturedPrompt = body.text
      }
    })

    const tool = createHandoffSessionTool({ client, directory: tmpDir })
    await tool.execute(
      { prompt: 'Summary', files: ['src/a.ts', 'src/b.ts'] },
      { sessionID: oldSessionID }
    )

    expect(capturedPrompt).toContain('@src/a.ts')
    expect(capturedPrompt).toContain('@src/b.ts')
    expect(capturedPrompt).toContain('Current goal: Test file refs + goal')
  })

  test('fails when session creation fails', async () => {
    const client = mockClient({
      sessionCreate: async () => ({ data: null })
    })

    const tool = createHandoffSessionTool({ client, directory: tmpDir })
    const result = await tool.execute({ prompt: 'Handoff' }, { sessionID: oldSessionID })

    expect(result).toContain('Error: Failed to create new session')
  })

  test('fails when no sessionID in context', async () => {
    const client = mockClient()
    const tool = createHandoffSessionTool({ client, directory: tmpDir })
    const result = await tool.execute({ prompt: 'Handoff' }, {})

    expect(result).toContain('Error: No session ID available')
  })
})
