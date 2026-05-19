---
name: to-issues
description: Break a PRD or plan into vertical-slice implementation issues. Each issue is a tracer bullet cutting through ALL layers end-to-end. Classify as HITL (human-in-the-loop) or AFK (autonomous). Use after PRD approval before bdd-implement.
---

# To Issues

## Core Principle

**Vertical slicing.** Each issue is a thin tracer bullet cutting through ALL integration layers end-to-end — schema, API, UI, tests — NOT a horizontal layer. Prefer many thin slices over few thick ones.

## When to Use

- After `create-prd` approval, before `bdd-implement`
- Breaking a plan into independently-grabbable work items
- When asked to "break this down", "create issues", "slice this up"

## Workflow

### 1. Gather Context

Work from the approved PRD or plan. Use the project's domain glossary vocabulary from `CONTEXT.md` if it exists.

### 2. Draft Vertical Slices

Each issue must:
- Cut through ALL layers end-to-end (schema → API → UI → tests)
- Deliver a narrow but complete path through the system
- Be independently implementable and verifiable

**Bad (horizontal):** "Create database schema", "Build API endpoints", "Add UI components"
**Good (vertical):** "User can create a todo and see it persisted", "User can filter todos by status"

### 3. Classify Autonomy

For each issue, classify:

- **AFK (Away From Keyboard)** — can be implemented and merged without human interaction. Prefer AFK.
- **HITL (Human-in-the-loop)** — requires human review mid-implementation (design decisions, visual review, API sign-off).

### 4. Map Dependencies

Order issues so blockers come first. Use dependency references between issues.

### 5. Present to User

Show proposed breakdown via `question` tool. For each slice: Title, Type (HITL/AFK), Blocked by, What it delivers. Iterate until approved.

### 6. Publish

Write issues to `.scratch/<feature-slug>/issues/` as markdown files:

```
.scratch/<feature-slug>/
├── PRD.md                          # Reference to PRD location
└── issues/
    ├── 01-<slug>.md
    ├── 02-<slug>.md
    └── ...
```

**Issue template:**
```markdown
---
status: ready
type: AFK | HITL
blocked_by: [] | [issue-number]
parent_prd: <path-to-prd>
---

# <Title>

## What to Build

<End-to-end behavior description. No file paths — they go stale. Describe interfaces, types, behavioral contracts.>

## Acceptance Criteria

- [ ] <criterion 1>
- [ ] <criterion 2>
- [ ] <each criterion independently verifiable>

## Blocked By

None | Issue #NN — <reason>
```

## Durability Rules

- **No file paths or line numbers** in issue bodies — they go stale
- Describe **what the system should do**, not how to implement it
- Each acceptance criterion must be **independently verifiable**
- State what is **explicitly out of scope**

## What NOT to Do

- Do NOT create horizontal slices (all schema, then all API, then all UI)
- Do NOT include file paths or code snippets in issues
- Do NOT create more than ~8 issues per PRD — if you need more, group related slices
- Do NOT skip user review of the breakdown
- Do NOT make all issues HITL — prefer AFK where possible
