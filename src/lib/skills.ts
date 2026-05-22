import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import yaml from 'js-yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const groundworkSkillsDir = path.resolve(__dirname, '../../skills/groundwork')

export function extractAndStripFrontmatter(content: string): { frontmatter: Record<string, any>; content: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { frontmatter: {}, content }
  const frontmatterStr = match[1]
  const body = match[2]
  let frontmatter: Record<string, any> = {}
  try {
    frontmatter = yaml.load(frontmatterStr) as Record<string, any> || {}
  } catch {
    // Malformed frontmatter: return empty frontmatter but preserve content
  }
  return { frontmatter, content: body }
}

const bootstrapContentCache = new Map<string, string | null>()

export function getBootstrapForAgent(agent: string): string | null {
  const cached = bootstrapContentCache.get(agent)
  if (cached !== undefined) return cached

  const universalPath = path.join(groundworkSkillsDir, 'use-groundwork', 'bootstrap-universal.md')
  let universalContent = ''
  let fallbackContent = ''
  let usingFallback = false

  if (existsSync(universalPath)) {
    const fullContent = readFileSync(universalPath, 'utf8')
    const { content } = extractAndStripFrontmatter(fullContent)
    universalContent = content
  } else {
    // Fallback: load the full SKILL.md (legacy behavior during migration)
    const skillPath = path.join(groundworkSkillsDir, 'use-groundwork', 'SKILL.md')
    if (!existsSync(skillPath)) {
      bootstrapContentCache.set(agent, null)
      return null
    }
    const fullContent = readFileSync(skillPath, 'utf8')
    const { content } = extractAndStripFrontmatter(fullContent)
    fallbackContent = content
    usingFallback = true
  }

  let agentContent = ''
  if (agent === 'orchestrator') {
    const agentPath = path.join(groundworkSkillsDir, 'use-groundwork', 'bootstrap-orchestrator.md')
    if (existsSync(agentPath)) {
      const fullContent = readFileSync(agentPath, 'utf8')
      const { content } = extractAndStripFrontmatter(fullContent)
      agentContent = content
    }
  } else if (agent === 'coder') {
    const agentPath = path.join(groundworkSkillsDir, 'use-groundwork', 'bootstrap-coder.md')
    if (existsSync(agentPath)) {
      const fullContent = readFileSync(agentPath, 'utf8')
      const { content } = extractAndStripFrontmatter(fullContent)
      agentContent = content
    }
  }

  const bodyContent = usingFallback
    ? fallbackContent
    : [universalContent, agentContent].filter(Boolean).join('\n\n')

  const bootstrap = `<EXTREMELY_IMPORTANT>
You have groundwork workflow skills.

**IMPORTANT: The use-groundwork skill content is included below. It is ALREADY LOADED - you are currently following it. Do NOT use the skill tool to load "use-groundwork" again.**

${bodyContent}
</EXTREMELY_IMPORTANT>`

  bootstrapContentCache.set(agent, bootstrap)
  return bootstrap
}

// Backward-compatible alias for legacy callers
export function getBootstrapContent(): string | null {
  return getBootstrapForAgent('orchestrator')
}
