import { formatDuration, truncateText, sleep, extractMessages, extractFailureContext } from './helpers.js'
import { formatFileChanges } from './snapshot.js'

const STUCK_THRESHOLD_MS = 60_000

export function formatTaskStatus(task: any): string {
  const duration = task.status === 'pending' || task.status === 'waiting'
    ? formatDuration(task.queuedAt, undefined)
    : formatDuration(task.startedAt, task.completedAt)
  const statusNote = task.completing ? 'completing...'
    : task.status === 'pending' ? 'queued'
    : task.status === 'waiting' ? 'waiting'
    : task.status === 'running' ? 'running'
    : task.status === 'error' ? 'failed'
    : task.status === 'interrupt' ? 'interrupted'
    : task.status
  return `Task ${task.id}: ${task.description} [${task.agent}] — ${statusNote} (${duration})`
}

export function formatFailureContext(task: any, messages: any[]): string {
  if (!messages || messages.length === 0) return ''

  const lines: string[] = []
  lines.push('=== Failure Context ===')
  lines.push('')

  // Task progress info
  if (task.progress) {
    lines.push(`Tool calls made: ${task.progress.toolCalls || 0}`)
    if (task.progress.lastTool) {
      lines.push(`Last tool used: ${task.progress.lastTool}`)
    }
  }

  // Last messages
  const lastMessages = messages.slice(-5)
  for (const msg of lastMessages) {
    const role = msg.info?.role || 'unknown'
    const timestamp = msg.info?.timestamp || msg.info?.created_at || ''

    if (role === 'assistant') {
      lines.push(`[${timestamp}] Assistant:`)
      for (const part of msg.parts || []) {
        if (part.type === 'text' && part.text) {
          lines.push(`  ${truncateText(part.text, 200)}`)
        } else if (part.type === 'tool' && part.state) {
          if (part.state.status === 'error') {
            lines.push(`  [Tool ERROR: ${part.tool}] ${part.state.title || 'unknown error'}`)
          } else {
            lines.push(`  [Tool: ${part.tool}] ${part.state.title || ''}`)
          }
        }
      }
    } else if (role === 'tool') {
      lines.push(`[${timestamp}] Tool result:`)
      for (const part of msg.parts || []) {
        if (part.type === 'text' && part.text) {
          lines.push(`  ${truncateText(part.text, 200)}`)
        }
      }
    }
    lines.push('')
  }

  // Summary
  lines.push('=== End Failure Context ===')

  return lines.join('\n')
}

export async function formatTaskResult(task: any, client: any): Promise<string> {
  if (!task.sessionID) return 'Error: Task has no sessionID'
  const maxAttempts = 5
  const duration = formatDuration(task.startedAt ?? new Date(), task.completedAt)
  const header = `Task Result\n\nTask ID: ${task.id}\nDescription: ${task.description}\nDuration: ${duration}\nSession ID: ${task.sessionID}\n\n---\n\n`
  const fileChangesSection = task.fileChanges ? `\n\n---\n\n📁 File Changes\n${formatFileChanges(task.fileChanges)}` : ''
  let prevMsgCount = -1
  let bestContent = ''
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Longer wait on first attempt to give session API time to commit messages
      if (attempt === 0) await sleep(3000)
      else if (attempt > 0) await sleep(2000 * attempt)
      const resp = await client.session.messages({ path: { id: task.sessionID } })
      const messages = extractMessages(resp)
      if (!messages.length) {
        if (attempt < maxAttempts - 1) continue
        break
      }
      const msgCount = messages.length
      const relevant = messages.filter((m: any) => m.info?.role === 'assistant' || m.info?.role === 'tool')
      if (!relevant.length) {
        // No assistant messages yet — retry unless this is the last attempt
        if (attempt < maxAttempts - 1) continue
        break
      }
      const extracted: string[] = []
      for (const msg of relevant) {
        for (const part of msg.parts ?? []) {
          if (part.type === 'text' && part.text) {
            extracted.push(part.text)
          } else if (part.type === 'reasoning' && part.text) {
            extracted.push(part.text)
          } else if (part.type === 'thinking' && part.text) {
            extracted.push(part.text)
          } else if (part.type === 'tool' && part.state) {
            if (part.state.status === 'completed' && part.state.title) {
              extracted.push(`[Tool: ${part.tool}] ${part.state.title}`)
            } else if (part.state.status === 'error') {
              extracted.push(`[Tool: ${part.tool}] ERROR: ${part.state.title || 'unknown error'}`)
            }
          }
        }
      }
      const content = extracted.filter(t => t.length > 0).join('\n\n')

      // For failed tasks, append failure context
      let failureContext = ''
      if (task.status === 'error' || task.status === 'interrupt') {
        failureContext = await extractFailureContext(task, client) as string || ''
      }

      const fullContent = failureContext
        ? content + '\n\n' + failureContext
        : content

      if (fullContent.length > bestContent.length) bestContent = fullContent
      // Only return early if we have real content (not just tool call markers)
      if (msgCount === prevMsgCount && bestContent.length > 50) return header + bestContent + fileChangesSection
      prevMsgCount = msgCount
      if (attempt >= maxAttempts - 1) return header + (bestContent || '(No text output)') + fileChangesSection
    } catch (err) {
      if (attempt >= maxAttempts - 1) {
        if (bestContent) return header + bestContent + fileChangesSection
        return `${header}Error extracting task result: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }
  return header + (bestContent || '(No text output)') + fileChangesSection
}

export function buildNotificationText({ task, duration, statusText, allComplete, remainingCount, completedTasks, artifactPath }: {
  task: any
  duration: string
  statusText: string
  allComplete: boolean
  remainingCount: number
  completedTasks: any[]
  artifactPath?: string
}): string {
  const desc = task.description || task.id
  const isFailed = task.status === 'error' || task.status === 'interrupt' || task.status === 'cancelled'

  if (allComplete) {
    const succeeded = completedTasks.filter((t: any) => t.status === 'completed')
    const failed = completedTasks.filter((t: any) => t.status !== 'completed')
    const lines: string[] = []
    if (succeeded.length) lines.push(...succeeded.map((t: any) => `✓ ${t.id}: ${t.description}`))
    if (failed.length) lines.push(...failed.map((t: any) => `✗ ${t.id}: ${t.description} [${t.status}]`))
    if (!lines.length) lines.push(`${task.id}: ${desc} [${task.status}]`)
    return `<system-reminder>\n[ALL DONE]\n${lines.join('\n')}${artifactPath ? `\nArtifact: ${artifactPath}` : ''}\n</system-reminder>`
  }

  // Build failure context for single task notification
  let failureContext = ''
  if (task.status === 'error' || task.status === 'interrupt') {
    const toolCalls = task.progress?.toolCalls || 0
    const lastTool = task.progress?.lastTool
    const parts: string[] = []
    if (toolCalls > 0) parts.push(`after ${toolCalls} tool calls`)
    if (lastTool) parts.push(`last: ${lastTool}`)
    if (parts.length) failureContext = ` — ${parts.join(', ')}`
    failureContext += artifactPath ? `\nCheck artifact for full details: ${artifactPath}` : ''
  }

  return `<system-reminder>\n[${statusText}] ${task.id}: ${desc} (${duration})${task.error ? ` — ${task.error}` : ''}${failureContext}${remainingCount > 0 ? ` — ${remainingCount} remaining` : ''}\n</system-reminder>`
}

export function formatActivityTime(lastUpdate: Date | undefined): string {
  if (!lastUpdate) return ''
  const ms = Date.now() - lastUpdate.getTime()
  if (ms < 5000) return 'active now'
  if (ms < 60_000) return `active ${Math.floor(ms / 1000)}s ago`
  if (ms < 3600_000) return `active ${Math.floor(ms / 60_000)}m ago`
  return `active ${Math.floor(ms / 3600_000)}h ago`
}

export function isTaskStuck(task: any): boolean {
  if (task.status !== 'running') return false
  const lastUpdate = task.progress?.lastUpdate ?? task.startedAt
  if (!lastUpdate) return false
  return Date.now() - lastUpdate.getTime() > STUCK_THRESHOLD_MS
}

export function formatTaskList(tasks: any[], sessionID: string, options: any = {}): string {
  if (!tasks.length) return `No background tasks for ${sessionID}.`

  // Group tasks by status
  const groups = {
    running: tasks.filter((t: any) => t.status === 'running'),
    pending: tasks.filter((t: any) => t.status === 'pending'),
    waiting: tasks.filter((t: any) => t.status === 'waiting'),
    completed: tasks.filter((t: any) => t.status === 'completed'),
    error: tasks.filter((t: any) => t.status === 'error' || t.status === 'interrupt'),
    cancelled: tasks.filter((t: any) => t.status === 'cancelled'),
  }

  const totalRunning = groups.running.length
  const totalPending = groups.pending.length
  const totalWaiting = groups.waiting.length
  const totalCompleted = groups.completed.length
  const totalError = groups.error.length
  const totalCancelled = groups.cancelled.length
  const totalActive = totalRunning + totalPending + totalWaiting

  // Build header summary
  const headerParts: string[] = []
  if (totalActive > 0) headerParts.push(`${totalActive} active`)
  if (totalWaiting > 0) headerParts.push(`${totalWaiting} waiting`)
  if (totalCompleted > 0) headerParts.push(`${totalCompleted} completed`)
  if (totalError > 0) headerParts.push(`${totalError} failed`)
  if (totalCancelled > 0) headerParts.push(`${totalCancelled} cancelled`)

  const lines: string[] = []
  lines.push(`Background tasks for ${sessionID} — ${tasks.length} total${headerParts.length ? ` (${headerParts.join(', ')})` : ''}`)
  lines.push('')

  // Helper to format a single task with enhanced info
  const formatTask = (task: any, isCompact = false) => {
    const status = task.status === 'running' ? 'run' : task.status === 'pending' ? 'q' : task.status === 'completed' ? 'done' : task.status === 'error' ? 'err' : task.status === 'cancelled' ? 'x' : task.status === 'interrupt' ? '!' : task.status
    const duration = task.status === 'pending' ? formatDuration(task.queuedAt, undefined) : formatDuration(task.startedAt, task.completedAt)

    if (isCompact) {
      return `${task.id}: ${task.description} [${task.agent}] ${status} (${duration})`
    }

    let line = `${task.id}: ${task.description} [${task.agent}] ${status} (${duration})`

    // Add progress indicators for running tasks
    if (task.status === 'running') {
      const stuck = isTaskStuck(task)
      const activity = formatActivityTime(task.progress?.lastUpdate)
      const toolCalls = task.progress?.toolCalls ?? 0
      const lastTool = task.progress?.lastTool

      const indicators: string[] = []
      if (stuck) indicators.push('⚠️ STUCK')
      if (toolCalls > 0) indicators.push(`${toolCalls} tools`)
      if (lastTool) indicators.push(`last: ${lastTool}`)
      if (activity) indicators.push(activity)

      if (indicators.length) {
        line += ` — ${indicators.join(' | ')}`
      }
    }

    return line
  }

  // Running tasks
  if (groups.running.length > 0) {
    lines.push(`▶ Running (${groups.running.length}):`)
    for (const task of groups.running) {
      lines.push(`  ${formatTask(task)}`)
    }
    lines.push('')
  }

  // Pending tasks
  if (groups.pending.length > 0) {
    lines.push(`⏳ Pending (${groups.pending.length}):`)
    for (const task of groups.pending) {
      lines.push(`  ${formatTask(task)}`)
    }
    lines.push('')
  }

  // Completed tasks
  if (groups.completed.length > 0) {
    lines.push(`✓ Completed (${groups.completed.length}):`)
    for (const task of groups.completed) {
      lines.push(`  ${formatTask(task)}`)
    }
    lines.push('')
  }

  // Error tasks
  if (groups.error.length > 0) {
    lines.push(`✗ Failed (${groups.error.length}):`)
    for (const task of groups.error) {
      lines.push(`  ${formatTask(task)}`)
    }
    lines.push('')
  }

  // Cancelled tasks
  if (groups.cancelled.length > 0) {
    lines.push(`⊘ Cancelled (${groups.cancelled.length}):`)
    for (const task of groups.cancelled) {
      lines.push(`  ${formatTask(task)}`)
    }
    lines.push('')
  }

  // Completion summary when include_completed is true
  if (options.include_completed && (groups.completed.length > 0 || groups.error.length > 0)) {
    const finishedTasks = [...groups.completed, ...groups.error]
    const successCount = groups.completed.length
    const failureCount = groups.error.length

    let totalDurationMs = 0
    let durationCount = 0
    for (const task of finishedTasks) {
      if (task.startedAt && task.completedAt) {
        totalDurationMs += task.completedAt.getTime() - task.startedAt.getTime()
        durationCount++
      }
    }

    lines.push('─'.repeat(50))
    lines.push('Summary:')
    lines.push(`  Success: ${successCount} | Failed: ${failureCount} | Total: ${finishedTasks.length}`)
    if (durationCount > 0) {
      const avgDuration = formatDuration(new Date(0), new Date(Math.round(totalDurationMs / durationCount)))
      lines.push(`  Average duration: ${avgDuration}`)
    }
    lines.push('')
  }

  return lines.join('\n').trim()
}
