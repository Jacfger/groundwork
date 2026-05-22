// ─── handoff_session Tool ──────────────────────────────────────────────────

import { tool } from '@opencode-ai/plugin'
import { z } from 'zod'
import { readGoal, writeGoal } from '../lib/goal.js'
import type { ToolDeps } from './deps.js'

export function createHandoffSessionTool(deps: ToolDeps) {
  const { client, directory } = deps
  return tool({
    description: 'Create a new session with the handoff prompt as an editable draft. Called after /handoff command generates the summary.',
    args: {
      prompt: z.string().describe('The generated handoff prompt'),
      files: z.array(z.string()).optional().describe('Array of file paths to load into the new session context'),
    },
    async execute(args: any, context: any) {
      const sessionID = context?.sessionID
      if (!sessionID) {
        return 'Error: No session ID available. Cannot perform handoff.'
      }

      const sessionReference = `Continuing work from session ${sessionID}. When you lack specific information you can use read_session to get it.`
      const fileRefs = args.files?.length
        ? args.files.map((f: string) => `@${f.replace(/^@/, '')}`).join(' ')
        : ''

      const currentGoal = readGoal(directory, sessionID)

      const goalSection = currentGoal
        ? `Current goal: ${currentGoal.objective}\nAcceptance Criteria:\n${currentGoal.acceptanceCriteria.map((c: string, i: number) => `${i + 1}. ${c}`).join('\n')}`
        : ''

      let fullPrompt = fileRefs
        ? `${sessionReference}\n\n${fileRefs}\n\n${args.prompt}`
        : `${sessionReference}\n\n${args.prompt}`

      if (goalSection) {
        fullPrompt += `\n\n${goalSection}`
      }

      // Create a new session via the API to get its ID
      const result = await client.session.create({
        body: { parentID: sessionID },
        query: { directory }
      })

      if (!result.data) {
        return 'Error: Failed to create new session for handoff.'
      }

      const newSessionID = result.data.id

      // Copy the goal to the new session
      if (currentGoal) {
        writeGoal(directory, newSessionID, currentGoal)
      }

      // Navigate to the new session and append the prompt
      client.tui.route.navigate('session', { sessionID: newSessionID })
      await client.tui.appendPrompt({ body: { text: fullPrompt } })
      await client.tui.showToast({
        body: { title: 'Handoff Ready', message: 'Review and edit the draft, then send', variant: 'success', duration: 4000 }
      })

      if (currentGoal) {
        return `Handoff prompt created in new session (ID: ${newSessionID}). Goal copied successfully. Review and edit before sending.`
      }
      return `Handoff prompt created in new session (ID: ${newSessionID}). Review and edit before sending.`
    }
  })
}
