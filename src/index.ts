import path from 'node:path'
import fsPromises from 'node:fs/promises'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { PluginInput } from '@opencode-ai/plugin'

import { manager } from './lib/singletons.js'
import { LoopMonitor } from './lib/loop-monitor.js'

export { resolvePromptAppend } from './lib/prompt-resolver.js'

import { getBootstrapContent, getBootstrapForAgent, extractAndStripFrontmatter } from './lib/skills.js'
import { parseFileReferences, buildSyntheticFileParts, HANDOFF_COMMAND } from './lib/handoff.js'

import { createHandoffSessionTool } from './tools/handoff-session.js'
import { createSetGoalTool } from './tools/set-goal.js'
import type { ToolDeps } from './tools/deps.js'
import { readGoal, goalReminder } from './lib/goal.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const groundworkSkillsDir = path.resolve(__dirname, '..', 'skills', 'groundwork')
const groundworkAgentsDir = path.resolve(__dirname, '..', 'agents')

const AGENT_DEFAULTS: Record<string, { temperature?: number }> = {
  advisor: { temperature: 0.1 },
  coder: { temperature: 0.2 },
  explore: { temperature: 0.1 },
  designer: { temperature: 0.7 },
  observer: { temperature: 0.1 },
}

function isPlainObject(value: any): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepMergeDefaults(target: Record<string, any>, source: Record<string, any>): void {
  for (const [key, value] of Object.entries(source)) {
    if (target[key] === undefined) {
      target[key] = value
    } else if (isPlainObject(target[key]) && isPlainObject(value)) {
      deepMergeDefaults(target[key], value)
    }
    // If target already has the key (scalar or array), keep target's value
  }
}

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
          if (AGENT_DEFAULTS[name]?.temperature !== undefined && config.agent[name].temperature === undefined) {
            config.agent[name].temperature = AGENT_DEFAULTS[name].temperature
          }
          if (frontmatter.permission) {
            config.agent[name].permission = config.agent[name].permission || {}
            deepMergeDefaults(config.agent[name].permission, frontmatter.permission)
          }
        }
      }
      try {
        const gitignorePath = path.join(directory, '.gitignore')
        const OPENCODE_IGNORE = '.opencode/goal.json'
        let gitignore = ''
        try { gitignore = await fsPromises.readFile(gitignorePath, 'utf8') } catch {}
        if (!gitignore.includes(OPENCODE_IGNORE)) {
          const newContent = gitignore ? (gitignore.endsWith('\n') ? gitignore : gitignore + '\n') + OPENCODE_IGNORE + '\n' : OPENCODE_IGNORE + '\n'
          await fsPromises.writeFile(gitignorePath, newContent, 'utf8')
        }
      } catch {}
    },

    'experimental.chat.messages.transform': async (_input: any, output: any) => {
      if (!output.messages.length) return
      const firstUser = output.messages.find((m: any) => m.info.role === 'user')
      if (!firstUser || !firstUser.parts.length) return

      // Select bootstrap based on agent type
      const agent = firstUser.info?.agent
      const bootstrap = agent
        ? getBootstrapForAgent(agent)
        : getBootstrapContent()
      if (!bootstrap) return

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
      handoff_session: createHandoffSessionTool(deps),
      set_goal: createSetGoalTool(deps),
    },

    event: async ({ event }: { event: any }) => {
      loopMonitor.handleEvent(event)
      if (event.type === 'session.deleted') {
        const id = event.properties?.info?.id
        if (typeof id === 'string') handoffProcessedSessions.delete(id)
      }
    },

    'chat.message': async (_input: any, output: any) => {
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


  }
}

export default GroundworkPlugin
