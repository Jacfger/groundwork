import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const groundworkSkillsDir = path.resolve(__dirname, '../../skills/groundwork')

export function extractAndStripFrontmatter(content: string): { frontmatter: Record<string, string>; content: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { frontmatter: {}, content }
  const frontmatterStr = match[1]
  const body = match[2]
  const frontmatter: Record<string, string> = {}
  for (const line of frontmatterStr.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '')
      frontmatter[key] = value
    }
  }
  return { frontmatter, content: body }
}

let bootstrapContentCache: string | null | undefined

export function getBootstrapContent(): string | null {
  if (bootstrapContentCache !== undefined) return bootstrapContentCache

  const skillPath = path.join(groundworkSkillsDir, 'use-groundwork', 'SKILL.md')
  if (!existsSync(skillPath)) {
    bootstrapContentCache = null
    return null
  }
  const fullContent = readFileSync(skillPath, 'utf8')
  const { content } = extractAndStripFrontmatter(fullContent)
  bootstrapContentCache = `<EXTREMELY_IMPORTANT>
You have groundwork workflow skills.

**IMPORTANT: The use-groundwork skill content is included below. It is ALREADY LOADED - you are currently following it. Do NOT use the skill tool to load "use-groundwork" again.**

${content}
</EXTREMELY_IMPORTANT>`
  return bootstrapContentCache
}
