export function formatDuration(start: Date | undefined, end: Date | undefined): string {
  if (!start) return 'N/A'
  const ms = (end ?? new Date()).getTime() - start.getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '…'
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function extractMessages(response: any): any[] {
  if (Array.isArray(response)) return response
  if (Array.isArray(response?.data)) return response.data
  if (Array.isArray(response?.data?.messages)) return response.data.messages
  if (Array.isArray(response?.messages)) return response.messages
  return []
}

export async function extractFailureContext(task: any, client: any, maxMessages: number = 10): Promise<any> {
  if (!task.sessionID) return null
  try {
    const resp = await client.session.messages({ path: { id: task.sessionID } })
    const messages = extractMessages(resp)
    if (!messages.length) return null

    const lastMessages = messages.slice(-maxMessages)
    const context = []

    for (const msg of lastMessages) {
      const role = msg.info?.role || 'unknown'
      const parts = msg.parts || []
      const msgContent = []

      for (const part of parts) {
        if (part.type === 'text' && part.text) {
          msgContent.push(part.text)
        } else if (part.type === 'reasoning' && part.text) {
          msgContent.push(`[Reasoning] ${part.text}`)
        } else if (part.type === 'thinking' && part.text) {
          msgContent.push(`[Thinking] ${part.text}`)
        } else if (part.type === 'tool' && part.state) {
          if (part.state.status === 'error') {
            msgContent.push(`[Tool Error: ${part.tool}] ${part.state.title || 'unknown error'}`)
          } else if (part.state.status === 'completed') {
            msgContent.push(`[Tool: ${part.tool}] ${part.state.title || 'completed'}`)
          }
        }
      }

      if (msgContent.length > 0) {
        context.push({
          role,
          content: msgContent.join('\n'),
          timestamp: msg.info?.timestamp || msg.info?.created_at || null
        })
      }
    }

    return {
      taskId: task.id,
      status: task.status,
      error: task.error || null,
      messageCount: messages.length,
      contextMessages: context,
      extractedAt: new Date().toISOString()
    }
  } catch (err) {
    return {
      taskId: task.id,
      status: task.status,
      error: task.error || null,
      extractionError: err instanceof Error ? err.message : String(err),
      extractedAt: new Date().toISOString()
    }
  }
}
