// ─── background_wait Tool ──────────────────────────────────────────────────

import { tool } from '@opencode-ai/plugin'
import { z } from 'zod'
import { manager, persistence } from '../lib/singletons.js'
import { formatTaskResult, formatTaskStatus } from '../lib/task-formatting.js'
import { formatDuration } from '../lib/helpers.js'
import type { ToolDeps } from './deps.js'

export function createBackgroundWaitTool(deps: ToolDeps) {
  const { client } = deps
  return tool({
    description: 'Block until a background task completes and return its result. Use instead of polling background_output/background_list.',
    args: {
      task_id: z.string().describe('Task ID to wait for'),
      timeout: z.number().optional().describe('Max wait time in seconds (default: 3600 = 1 hour, max: 7200 = 2 hours)'),
    },
    async execute(args: any) {
      try {
        let task = manager.getTask(args.task_id)
        if (!task) {
          await manager.recoverStateForTask(args.task_id)
          task = manager.getTask(args.task_id)
        }
        if (!task) return `Task not found: ${args.task_id}`

        const timeoutMs = Math.min((args.timeout ?? 3600) * 1000, 7200000)
        const isActive = (t: any) => t.status === 'pending' || t.status === 'running' || t.status === 'waiting' || t.completing
        const start = Date.now()

        while (isActive(task) && Date.now() - start < timeoutMs) {
          await new Promise(r => setTimeout(r, 2000))
          const current = manager.getTask(args.task_id)
          if (!current) return `Task was deleted: ${args.task_id}`
          task = current
        }

        if (isActive(task)) {
          return `Task ${args.task_id} still ${task.status} after ${formatDuration(new Date(start), new Date())}. Use background_output to check.`
        }

        manager.markRead(task.id)
        const persisted = await persistence.read(task.id, task.parentSessionID, manager.directory)
        if (persisted && !persisted.endsWith('(No text output)') && !persisted.endsWith('(No messages found)') && !persisted.endsWith('(No assistant or tool response found)')) return persisted
        if (task.status === 'completed') {
          const freshResult = await formatTaskResult(task, client)
          if (freshResult && !freshResult.includes('(No text output)')) {
            void manager.persistResult(task).catch(() => {})
          }
          return freshResult
        }
        return formatTaskStatus(task)
      } catch (error) {
        return `Error waiting for task: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  })
}
