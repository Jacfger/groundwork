// ─── Goal Persistence ──────────────────────────────────────────────────────
// Reads/writes a single active goal at .opencode/goals/<sessionID>.json per
// session. Goals are session-scoped and isolated. On first access, a legacy
// .opencode/goal.json is auto-migrated to the current session's path.
// Survives context compression, session restarts, and /clear.

import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs'
import path from 'node:path'

export interface Goal {
  objective: string
  acceptanceCriteria: string[]
  status: 'active' | 'paused' | 'achieved'
  createdAt: string
  updatedAt: string
}

export function goalPath(directory: string, sessionID: string): string {
  return path.join(directory, '.opencode', 'goals', `${sessionID}.json`)
}

export function migrateLegacyGoal(directory: string, sessionID: string): boolean {
  const legacyPath = path.join(directory, '.opencode', 'goal.json')
  if (!existsSync(legacyPath)) return false
  const targetPath = goalPath(directory, sessionID)
  if (existsSync(targetPath)) return false
  const targetDir = path.join(directory, '.opencode', 'goals')
  mkdirSync(targetDir, { recursive: true })
  const raw = readFileSync(legacyPath, 'utf8')
  writeFileSync(targetPath, raw, 'utf8')
  unlinkSync(legacyPath)
  return true
}

export function readGoal(directory: string, sessionID: string): Goal | null {
  migrateLegacyGoal(directory, sessionID)
  const fp = goalPath(directory, sessionID)
  if (!existsSync(fp)) return null
  try {
    const raw = readFileSync(fp, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function writeGoal(directory: string, sessionID: string, goal: Goal): void {
  migrateLegacyGoal(directory, sessionID)
  const fp = goalPath(directory, sessionID)
  const dir = path.dirname(fp)
  mkdirSync(dir, { recursive: true })
  goal.updatedAt = new Date().toISOString()
  writeFileSync(fp, JSON.stringify(goal, null, 2) + '\n', 'utf8')
}

export function clearGoal(directory: string, sessionID: string): boolean {
  migrateLegacyGoal(directory, sessionID)
  const fp = goalPath(directory, sessionID)
  if (!existsSync(fp)) return false
  unlinkSync(fp)
  return true
}

export function goalReminder(goal: Goal): string {
  const criteria = goal.acceptanceCriteria
    .map((c, i) => `  ${i + 1}. ${c}`)
    .join('\n')
  return `<ACTIVE_GOAL>
Goal: ${goal.objective}
Status: ${goal.status}
Acceptance Criteria:
${criteria}
IMPORTANT: Check progress against these criteria after every major action. Do NOT declare this goal achieved without running advisor-gate with all criteria verified.
</ACTIVE_GOAL>`
}
