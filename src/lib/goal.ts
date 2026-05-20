// ─── Goal Persistence ──────────────────────────────────────────────────────
// Reads/writes a single active goal at .opencode/goal.json per project.
// Survives context compression, session restarts, and /clear.

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import path from 'node:path'

export interface Goal {
  objective: string
  acceptanceCriteria: string[]
  status: 'active' | 'paused' | 'achieved'
  createdAt: string
  updatedAt: string
}

const GOAL_FILE = '.opencode/goal.json'

export function goalPath(directory: string): string {
  return path.join(directory, GOAL_FILE)
}

export function readGoal(directory: string): Goal | null {
  const fp = goalPath(directory)
  if (!existsSync(fp)) return null
  try {
    const raw = readFileSync(fp, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function writeGoal(directory: string, goal: Goal): void {
  const fp = goalPath(directory)
  goal.updatedAt = new Date().toISOString()
  writeFileSync(fp, JSON.stringify(goal, null, 2) + '\n', 'utf8')
}

export function clearGoal(directory: string): boolean {
  const fp = goalPath(directory)
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
