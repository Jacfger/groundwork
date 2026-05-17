// ─── Groundwork Plugin — Entry Point ────────────────────────────────────────
// Wires all extracted modules into the plugin export.
// This is the single entry point for tsdown bundling.

import path from 'node:path'
import fsPromises from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Singletons — shared across all tools
import { manager } from './lib/singletons.js'
import { persistence } from './lib/singletons.js'

// Re-export resolvePromptAppend for external consumers (e.g., oh-my-opencode)
export { resolvePromptAppend } from './lib/prompt-resolver.js'

// Helpers used directly in the entry point
import { getBootstrapContent } from './lib/skills.js'
import { parseFileReferences, buildSyntheticFileParts, HANDOFF_COMMAND } from './lib/handoff.js'

// Tool factories
import { createBackgroundTaskTool } from './tools/background-task.js'
import { createBackgroundWaitTool } from './tools/background-wait.js'
import { createBackgroundOutputTool } from './tools/background-output.js'
import { createBackgroundListTool } from './tools/background-list.js'
import { createBackgroundCancelTool } from './tools/background-cancel.js'
import { createBackgroundInputTool } from './tools/background-input.js'
import { createBackgroundStatusTool } from './tools/background-status.js'
import { createBackgroundStreamTool } from './tools/background-stream.js'
import { createHandoffSessionTool } from './tools/handoff-session.js'
import { createReadSessionTool } from './tools/read-session.js'
import { createRobustReadTool } from './tools/robust-read.js'
import { createRobustWriteTool } from './tools/robust-write.js'
import type { ToolDeps } from './tools/deps.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const groundworkSkillsDir = path.resolve(__dirname, '..', 'skills', 'groundwork')

const handoffProcessedSessions = new Set<string>()

// ─── Plugin Export ──────────────────────────────────────────────────────────

export const GroundworkPlugin = async ({ client, directory }: { client: any; directory: string }) => {
  // Initialize singletons
  manager.client = client
  manager.directory = directory

  // Shared tool deps
  const deps: ToolDeps = { client, directory }

  return {
    config: async (config: any) => {
      config.skills = config.skills || {}
      config.skills.paths = config.skills.paths || []
      if (!config.skills.paths.includes(groundworkSkillsDir)) {
        config.skills.paths.push(groundworkSkillsDir)
      }
      config.command = config.command || {}
      config.command['handoff'] = {
        description: 'Create a focused handoff prompt for a new session',
        template: HANDOFF_COMMAND,
      }
      try {
        const gitignorePath = path.join(directory, '.gitignore')
        const OPENCODE_IGNORE = '.opencode/background-tasks/'
        let gitignore = ''
        try { gitignore = await fsPromises.readFile(gitignorePath, 'utf8') } catch {}
        if (!gitignore.includes(OPENCODE_IGNORE)) {
          const newContent = gitignore ? (gitignore.endsWith('\n') ? gitignore : gitignore + '\n') + OPENCODE_IGNORE + '\n' : OPENCODE_IGNORE + '\n'
          await fsPromises.writeFile(gitignorePath, newContent, 'utf8')
        }
      } catch {}
    },

    'experimental.chat.messages.transform': async (_input: any, output: any) => {
      const bootstrap = getBootstrapContent()
      if (!bootstrap || !output.messages.length) return
      const firstUser = output.messages.find((m: any) => m.info.role === 'user')
      if (!firstUser || !firstUser.parts.length) return
      if (firstUser.parts.some((p: any) => p.type === 'text' && p.text.includes('EXTREMELY_IMPORTANT'))) return
      const ref = firstUser.parts[0]
      firstUser.parts.unshift({ ...ref, type: 'text', text: bootstrap })
    },

    tool: {
      background_task: createBackgroundTaskTool(deps),
      background_wait: createBackgroundWaitTool(deps),
      background_output: createBackgroundOutputTool(deps),
      background_list: createBackgroundListTool(deps),
      background_cancel: createBackgroundCancelTool(deps),
      background_input: createBackgroundInputTool(deps),
      background_status: createBackgroundStatusTool(deps),
      background_stream: createBackgroundStreamTool(deps),
      handoff_session: createHandoffSessionTool(deps),
      read_session: createReadSessionTool(deps),
      read: createRobustReadTool(deps),
      write: createRobustWriteTool(deps),
    },

    event: async ({ event }: { event: any }) => {
      manager.handleEvent(event)
      if (event.type === 'session.deleted') {
        const id = event.properties?.info?.id
        if (typeof id === 'string') handoffProcessedSessions.delete(id)
      }
    },

    'chat.message': async (_input: any, output: any) => {
      manager.injectPendingNotifications(output.parts, _input.sessionID)
      const sessionID = output.message.sessionID ?? _input.sessionID
      if (handoffProcessedSessions.has(sessionID)) return
      const text = output.parts
        .filter((p: any) => p.type === 'text' && !p.synthetic && typeof p.text === 'string')
        .map((p: any) => p.text)
        .join('\n')
      if (!text.includes('Continuing work from session')) return
      handoffProcessedSessions.add(sessionID)
      const fileRefs = parseFileReferences(text)
      if (fileRefs.length === 0) return
      const fileParts = await buildSyntheticFileParts(directory, fileRefs)
      if (fileParts.length === 0) return
      await client.session.prompt({
        path: { id: sessionID },
        body: {
          noReply: true,
          model: output.message.model,
          agent: output.message.agent,
          parts: fileParts,
        },
      })
    },

    'experimental.session.compacting': async ({ sessionID }: { sessionID: string }) => {
      try {
        return manager.compactionContext(sessionID)
      } catch { return null }
    },
  }
}

export default GroundworkPlugin
