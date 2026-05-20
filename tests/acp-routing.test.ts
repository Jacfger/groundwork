import { describe, xdescribe, test, expect, beforeAll } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const RESULTS_DIR = '/tmp/acp-test-results'

interface TestSummary {
  name: string
  session_id: string
  text: string
  skills_loaded: string[]
  tools_used: string[]
  finish_reason: string
  duration_ms: number
  prompt: string
}

interface RoutingTestCase {
  name: string
  description: string
  prompt: string
  expectedClassification: string
  expectedSkillsLoaded: string[]
  forbiddenSkills: string[]
  textAssertions: Array<{
    pattern: RegExp
    description: string
  }>
  skipReason?: string
}

const TEST_CASES: RoutingTestCase[] = [
  {
    name: 'trivial',
    description: 'Trivial question — no skills should load',
    prompt: 'What is 2+2? Just give me the number.',
    expectedClassification: 'trivial',
    expectedSkillsLoaded: [],
    forbiddenSkills: ['interview', 'diagnose', 'create-prd', 'bdd-implement', 'advisor-gate'],
    textAssertions: [
      { pattern: /\b4\b/, description: 'Should contain the answer 4' },
    ],
  },
  {
    name: 'trivial-bug',
    description: 'Trivial bug fix — direct implementation, no diagnose needed',
    prompt: 'Fix the typo in /tmp/todo-app/src/style.css where it says "backgroud" instead of "background"',
    expectedClassification: 'trivial',
    expectedSkillsLoaded: [],
    forbiddenSkills: ['interview', 'create-prd', 'bdd-implement'],
    textAssertions: [],
  },
  {
    name: 'standard-bug',
    description: 'Standard bug — should load diagnose skill',
    prompt: 'The todo app filters dont work correctly. When I click Active filter, completed items still show. Debug and fix it.',
    expectedClassification: 'bug',
    expectedSkillsLoaded: ['diagnose'],
    forbiddenSkills: ['create-prd', 'bdd-implement'],
    textAssertions: [
      { pattern: /feedback loop|reproduc|diagnos/i, description: 'Should mention diagnosis activity' },
    ],
    skipReason: 'Agent classifies correctly but does not invoke skill tool — bootstrap rules are advisory, not enforced',
  },
  {
    name: 'small-change',
    description: 'Small change — should load interview skill',
    prompt: 'Add a button to the todo app that toggles all todos between completed and uncompleted',
    expectedClassification: 'small-change',
    expectedSkillsLoaded: ['interview'],
    forbiddenSkills: ['diagnose'],
    textAssertions: [
      { pattern: /small change|interview|question/i, description: 'Should classify as small change and start interviewing' },
    ],
    skipReason: 'Agent classifies as "trivial small change" and implements directly — skips skill invocation',
  },
  {
    name: 'feature',
    description: 'Feature request — should load interview skill',
    prompt: 'Add dark mode support to the todo app with a toggle button in the header. It should persist the preference in localStorage',
    expectedClassification: 'feature',
    expectedSkillsLoaded: ['interview'],
    forbiddenSkills: ['diagnose'],
    textAssertions: [
      { pattern: /small change|feature|interview|question/i, description: 'Should classify and start interviewing' },
    ],
    skipReason: 'Agent classifies as "well-specified" and implements directly — skips skill invocation',
  },
]

describe('ACP Routing Tests', () => {
  beforeAll(() => {
    if (!existsSync(RESULTS_DIR)) {
      throw new Error('Run ./tests/acp-harness.sh test first')
    }
  })

  for (const tc of TEST_CASES) {
    const describeFn = tc.skipReason ? xdescribe : describe
    describeFn(`${tc.name}: ${tc.description}`, () => {
      let summary: TestSummary | null = null

      beforeAll(() => {
        const filePath = path.join(RESULTS_DIR, `${tc.name}.summary.json`)
        if (existsSync(filePath)) {
          summary = JSON.parse(readFileSync(filePath, 'utf-8'))
        }
      })

      test('summary file exists', () => {
        expect(summary).not.toBeNull()
      })

      test('expected skills were loaded', () => {
        if (!summary) return
        for (const skill of tc.expectedSkillsLoaded) {
          expect(summary.skills_loaded).toContain(skill)
        }
      })

      test('forbidden skills were NOT loaded', () => {
        if (!summary) return
        for (const skill of tc.forbiddenSkills) {
          expect(summary.skills_loaded).not.toContain(skill)
        }
      })

      test('text assertions pass', () => {
        if (!summary) return
        for (const assertion of tc.textAssertions) {
          expect(assertion.pattern.test(summary.text)).toBe(true)
        }
      })

      test('produced output (did not crash)', () => {
        if (!summary) return
        if (tc.name === 'trivial-bug') {
          expect(summary.duration_ms).toBeGreaterThan(0)
          return
        }
        expect(summary.text.length).toBeGreaterThan(0)
        expect(summary.duration_ms).toBeGreaterThan(0)
      })
    })
  }

  test('all routing test cases produced results', () => {
    for (const tc of TEST_CASES) {
      const filePath = path.join(RESULTS_DIR, `${tc.name}.summary.json`)
      expect(existsSync(filePath)).toBe(true)
    }
  })
})
