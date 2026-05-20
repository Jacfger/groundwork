import path from 'node:path'
import fsPromises from 'node:fs/promises'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { PluginInput } from '@opencode-ai/plugin'

import { manager } from './lib/singletons.js'
import { persistence } from './lib/singletons.js'
import { LoopMonitor } from './lib/loop-monitor.js'

export { resolvePromptAppend } from './lib/prompt-resolver.js'

import { getBootstrapContent, extractAndStripFrontmatter } from './lib/skills.js'
import { parseFileReferences, buildSyntheticFileParts, HANDOFF_COMMAND } from './lib/handoff.js'

import { createBackgroundTaskTool } from './tools/background-task.js'
import { createBackgroundWaitTool } from './tools/background-wait.js'
import { createBackgroundOutputTool } from './tools/background-output.js'
import { createBackgroundListTool } from './tools/background-list.js'
import { createBackgroundCancelTool } from './tools/background-cancel.js'
import { createBackgroundInputTool } from './tools/background-input.js'
import { createBackgroundStatusTool } from './tools/background-status.js'
import { createBackgroundStreamTool } from './tools/background-stream.js'
import { createHandoffSessionTool } from './tools/handoff-session.js'
import { createSetGoalTool } from './tools/set-goal.js'
// import { createReadSessionTool } from './tools/read-session.js'
// import { createRobustReadTool } from './tools/robust-read.js'
import type { ToolDeps } from './tools/deps.js'
import { readGoal, goalReminder } from './lib/goal.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const groundworkSkillsDir = path.resolve(__dirname, '..', 'skills', 'groundwork')
const groundworkAgentsDir = path.resolve(__dirname, '..', 'agents')

const handoffProcessedSessions = new Set<string>()

export const GroundworkPlugin = async (input: PluginInput) => {
  const { client, directory } = input

  manager.client = client
  manager.directory = directory

  const loopMonitor = new LoopMonitor(client, { enabled: true })
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
      config.command['goal'] = {
        description: 'Set, check, pause, resume, or clear the active project goal',
        template: 'Use the set_goal tool to manage the project goal based on the user\'s request.',
      }

      config.agent = config.agent || {}
      if (existsSync(groundworkAgentsDir)) {
        for (const file of readdirSync(groundworkAgentsDir)) {
          if (!file.endsWith('.md')) continue
          const agentName = path.basename(file, '.md')
          const agentPath = path.join(groundworkAgentsDir, file)
          const raw = readFileSync(agentPath, 'utf8')
          const { frontmatter, content } = extractAndStripFrontmatter(raw)
          const name = frontmatter.name || agentName
          if (config.agent[name]?.disable) continue
          config.agent[name] = config.agent[name] || {}
          if (frontmatter.description && !config.agent[name].description) {
            config.agent[name].description = frontmatter.description
          }
          if (!config.agent[name].prompt) {
            config.agent[name].prompt = content.trim()
          }
        }
      }
      try {
        const gitignorePath = path.join(directory, '.gitignore')
        const OPENCODE_IGNORE = '.opencode/background-tasks/\n.opencode/goal.json'
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

      // Inject bootstrap into first user message (once)
      if (!firstUser.parts.some((p: any) => p.type === 'text' && p.text.includes('EXTREMELY_IMPORTANT'))) {
        const ref = firstUser.parts[0]
        firstUser.parts.unshift({ ...ref, type: 'text', text: bootstrap })
      }

      // Inject active goal reminder into last user message
      const goal = readGoal(directory)
      if (goal && goal.status === 'active') {
        const lastUser = output.messages.filter((m: any) => m.info.role === 'user').pop()
        if (lastUser && lastUser.parts.length) {
          const reminder = goalReminder(goal)
          if (!lastUser.parts.some((p: any) => p.type === 'text' && p.text.includes('ACTIVE_GOAL'))) {
            const ref = lastUser.parts[0]
            lastUser.parts.push({ ...ref, type: 'text', text: reminder })
          }
        }
      }
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
      set_goal: createSetGoalTool(deps),
//      read_session: createReadSessionTool(deps),
//      read: createRobustReadTool(deps),
    },

    event: async ({ event }: { event: any }) => {
      loopMonitor.handleEvent(event)
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

    'experimental.session.compacting': async ({ sessionID }: { sessionID: string }, output: { context: string[]; prompt?: string }) => {
      try {
        const ctx = manager.compactionContext(sessionID)
        if (ctx) {
          output.context.push(JSON.stringify(ctx))
        }
      } catch {}
    },
  }
}

export default GroundworkPlugin
