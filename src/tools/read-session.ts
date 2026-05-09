// ─── read_session Tool ─────────────────────────────────────────────────────

import { tool } from '@opencode-ai/plugin'
import { z } from 'zod'
import { extractMessages } from '../lib/helpers.js'
import { formatTranscript } from '../lib/handoff.js'
import type { ToolDeps } from './deps.js'

export function createReadSessionTool(deps: ToolDeps) {
  const { client } = deps
  return tool({
    description: 'Read the conversation transcript from a previous session. Use when you need specific information from the source session not in the handoff summary.',
    args: {
      sessionID: z.string().describe('The full session ID (e.g., sess_01jxyz...)'),
      limit: z.number().optional().describe('Maximum number of messages to read (defaults to 100, max 500)'),
    },
    async execute(args: any) {
      const limit = Math.min(args.limit ?? 100, 500)
      try {
        const response = await client.session.messages({
          path: { id: args.sessionID },
          query: { limit }
        })
        const messages = extractMessages(response)
        if (!messages.length) return 'Session has no messages or does not exist.'
        return formatTranscript(messages, limit)
      } catch (error) {
        return `Could not read session ${args.sessionID}: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  })
}
