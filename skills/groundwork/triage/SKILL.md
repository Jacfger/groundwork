---
name: triage
description: Triage incoming work through a lightweight state machine. Classify as bug or enhancement, determine if ready for agent (AFK) or human (HITL), write agent briefs or close with reason. Use for incoming issues and requests.
---

# Triage

## Core Principle

**Route work to the right path.** Every incoming item gets classified and routed — not left in limbo. Bugs go to `diagnose`. Enhancements get scoped and routed to `interview` → `create-prd` or closed.

## When to Use

- New issues or requests arrive
- User asks "what needs attention", "triage this", "look at issue #NN"
- Starting a session with a backlog of work
- Managing `.scratch/` issue files

## State Machine

Every triaged item carries **exactly one category + one state**.

**Categories:**
- `bug` — something is broken
- `enhancement` — new feature or improvement

**States:**
- `needs-triage` — awaiting evaluation
- `needs-info` — waiting on more information from reporter
- `ready-for-agent` — fully specified, AFK-ready (agent can pick up with no human context)
- `ready-for-human` — needs human implementation or decision
- `wontfix` — will not be actioned

```
Unlabeled → needs-triage → needs-info (↻ back when reporter replies)
                          → ready-for-agent
                          → ready-for-human
                          → wontfix
```

## Workflow

### 1. Gather

Collect items needing attention:
- Files in `.scratch/*/issues/` with no status or `needs-triage`
- User-mentioned requests not yet tracked
- Items with `needs-info` that have new context

### 2. For Each Item

**Step 1 — Classify:** Bug or enhancement?

**Step 2 — Assess completeness:**
- Is the problem clearly described?
- Are acceptance criteria defined?
- Is there enough context for implementation?

**Step 3 — Route:**

| Category | Complete? | Action |
|----------|-----------|--------|
| Bug | Yes | Set `ready-for-agent`, route to `diagnose` |
| Bug | No | Set `needs-info`, ask reporter for specifics |
| Enhancement | Yes | Set `ready-for-agent` or `ready-for-human`, route to `interview` |
| Enhancement | No | Run `interview` to scope it, then re-triage |
| Any | Won't fix | Set `wontfix`, write reason to issue |

### 3. Agent Briefs (for `ready-for-agent` items)

Write a brief that is:
- **Durable** — no file paths, no line numbers, no assumptions about current code structure
- **Behavioral** — describe WHAT the system should do, not HOW
- **Complete** — each criterion independently verifiable
- **Scoped** — explicit about what's out of scope

**Brief template (append to issue file):**
```markdown
## Agent Brief

### Current Behavior
<What the system does now>

### Desired Behavior
<What the system should do after the fix/change>

### Acceptance Criteria
- [ ] <each independently verifiable>

### Out of Scope
<What this issue does NOT cover>

### Context
<Any domain knowledge needed to implement correctly>
```

### 4. Wontfix Handling

For enhancements that won't be pursued, write reason directly in the issue. If the same concept has been rejected before, reference prior decision.

## What NOT to Do

- Do NOT leave items in `needs-triage` without attempting classification
- Do NOT set `ready-for-agent` without a complete agent brief
- Do NOT include file paths or line numbers in agent briefs — they go stale
- Do NOT triage without reading the issue body and any existing context
- Do NOT skip the bug/enhancement classification
