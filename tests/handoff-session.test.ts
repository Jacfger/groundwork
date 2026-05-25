// ─── Handoff Session Tool Tests ─────────────────────────────────────────────

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHandoffSessionTool } from '../src/tools/handoff-session.js'

const tmpDir = path.join(os.tmpdir(), 'groundwork-handoff-test')
const oldSessionID = 'sess_old_123'

function mockClient(overrides: any = {}) {
  return {
    tui: {
      executeCommand: overrides.executeCommand || (async () => {}),
      appendPrompt: overrides.appendPrompt || (async () => {}),
      showToast: overrides.showToast || (async () => {}),
    }
  }
}

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('createHandoffSessionTool', () => {
  test('creates new session and appends prompt', async () => {
    let commandExecuted: any = null
    let capturedPrompt = ''
    let toastShown: any = null

    const client = mockClient({
      executeCommand: async (args: any) => {
        commandExecuted = args
      },
      appendPrompt: async ({ body }: any) => {
        capturedPrompt = body.text
      },
      showToast: async ({ body }: any) => {
        toastShown = body
      }
    })

    const tool = createHandoffSessionTool({ client, directory: tmpDir })
    const result = await tool.execute({ prompt: 'Handoff summary here' }, { sessionID: oldSessionID })

    expect(commandExecuted).toEqual({ body: { command: 'session_new' } })
    expect(capturedPrompt).toContain('Continuing work from session sess_old_123')
    expect(capturedPrompt).toContain('Handoff summary here')
    expect(toastShown).toEqual({
      title: 'Handoff Ready',
      message: 'Review and edit the draft, then send',
      variant: 'success',
      duration: 4000
    })
    expect(result).toBe('Handoff prompt created in new session. Review and edit before sending.')
  })

  test('includes file refs in prompt', async () => {
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
    expect(capturedPrompt).toContain('Summary')
  })

  test('fails when no sessionID in context', async () => {
    const client = mockClient()
    const tool = createHandoffSessionTool({ client, directory: tmpDir })
    const result = await tool.execute({ prompt: 'Handoff' }, {})

    expect(result).toContain('Error: No session ID available')
  })
})
