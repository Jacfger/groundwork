import fsPromises from 'node:fs/promises'
import path from 'node:path'
import fs from 'node:fs'

const FILE_REGEX = /(?:^|[\s(])@(\.{0,2}\/[^\s,;)"'`]+|[a-zA-Z][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9._-]+){1,}(?:\.[a-zA-Z0-9]+))/g

export function parseFileReferences(text: string): string[] {
  const fileRefs = new Set<string>()
  for (const match of text.matchAll(FILE_REGEX)) {
    if (match[1]) fileRefs.add(match[1])
  }
  return Array.from(fileRefs)
}

export function isBinaryBuffer(buffer: Buffer): boolean {
  for (let i = 0; i < Math.min(buffer.length, 8192); i++) {
    const byte = buffer[i]
    if (byte === 0) return true
    if (byte < 0x07) return true
    if (byte > 0x0d && byte < 0x20) return true
  }
  return false
}

export async function buildSyntheticFileParts(directory: string, refs: string[]): Promise<any[]> {
  const parts: any[] = []
  for (const ref of refs) {
    const filepath = path.resolve(directory, ref)
    try {
      const stats = await fsPromises.stat(filepath)
      if (!stats.isFile()) continue
      const buffer = await fsPromises.readFile(filepath)
      if (isBinaryBuffer(buffer)) continue
      const content = buffer.toString('utf-8')
      const lines = content.split('\n')
      const numbered = lines.map((line, i) => `${i + 1}: ${line}`).join('\n')
      parts.push({ type: 'text', synthetic: true, text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: filepath })}` })
      parts.push({ type: 'text', synthetic: true, text: `<path>${filepath}</path>\n<type>file</type>\n<content>\n${numbered}\n</content>` })
    } catch {}
  }
  return parts
}

export function formatTranscript(messages: any[], limit?: number): string {
  const lines: string[] = []
  for (const msg of messages) {
    if (msg.info.role === 'user') {
      lines.push('## User')
      for (const part of msg.parts) {
        if (part.type === 'text' && !part.ignored) lines.push(part.text)
        if (part.type === 'file') lines.push(`[Attached: ${part.filename || 'file'}]`)
      }
      lines.push('')
    }
    if (msg.info.role === 'assistant') {
      lines.push('## Assistant')
      for (const part of msg.parts) {
        if (part.type === 'text') lines.push(part.text)
        if (part.type === 'tool' && part.state?.status === 'completed') lines.push(`[Tool: ${part.tool}] ${part.state.title}`)
      }
      lines.push('')
    }
  }
  const output = lines.join('\n').trim()
  if (messages.length >= (limit ?? 100)) return output + `\n\n(Showing ${messages.length} most recent messages. Use a higher 'limit' to see more.)`
  return output + `\n\n(End of session - ${messages.length} messages)`
}

export const HANDOFF_COMMAND = `GOAL: You are creating a handoff message to continue work in a new session.

When an AI assistant starts a fresh session, it spends significant time exploring the codebase before it can begin actual work. A good handoff frontloads everything the next session needs so it can start implementing immediately.

Analyze this conversation and extract what matters for continuing the work.

1. Identify all relevant files that should be loaded into the next session's context. Include files that will be edited, dependencies being touched, relevant tests, configs, and key reference docs. Target 8-15 files, up to 20 for complex work.

2. Draft the context and goal description. Describe what we're working on and provide whatever context helps continue the work. Preserve decisions, constraints, user preferences, technical patterns. Exclude conversation back-and-forth, dead ends, meta-commentary.

USER: $ARGUMENTS

---

After generating the handoff message, IMMEDIATELY call handoff_session with your prompt and files:
\`handoff_session(prompt="...", files=["src/foo.ts", "src/bar.ts", ...])\``