---
name: bdd-implement
description: BDD-first implementation skill. Validate behavior over implementation — visual inspection for UI, integration/e2e tests for non-UI. Build task graphs for parallel execution efficiency. MANDATORY after PRD approval.
---

# BDD Implement

## Core Principle

**Validate behavior, not implementation.** Tests should confirm *what the system does* from the user's perspective, not *how the code is structured internally.*

- **UI work:** Visual inspection before/after (screenshots, accessibility snapshots)
- **Non-UI work:** Integration or end-to-end tests that exercise real behavior paths
- **Never:** Unit tests that mock internals to verify code structure

## When to Use

**MANDATORY** — invoke this skill in these cases:

- Immediately after a PRD is approved, before any implementation begins
- After `interview` for standard small changes (<1 day) — interview output is the spec
- Any feature that changes observable behavior
- When scoping implementation work into parallel execution waves

**Do NOT use for:**
- **Bugs** — use `diagnose` instead. It owns the fix and regression test.
- **Trivial changes** (<1h, fully specified, ≤2 files) — implement directly, skip to `advisor-gate`.

**You do not have a choice.** If a PRD has been approved and implementation is starting, this skill must be followed.

## Two Modes of Operation

### Feature Mode (after PRD approval)

Full Task Graph with dependency analysis, wave assignment, critical path, and resource conflict detection. This is the heavyweight path for ≥1 day features.

### Small-Change Mode (after interview for <1 day work)

Lightweight decomposition into 2-3 parallel tasks. No formal Task Graph needed — just identify independent work units and launch them simultaneously.

**Decision rule:** If a PRD exists with a Task Graph → Feature Mode. Otherwise → Small-Change Mode.

## Task Graph (Feature Mode)

Before implementing, decompose work into a **task dependency graph** for maximum parallelism:

1. **List atomic tasks** — each with a clear "done" definition
2. **Map dependencies** — hard ordering (A must finish before B) vs soft preferences
3. **Assign waves** — Wave 0 has no predecessors; Wave k requires all predecessors in waves < k
4. **Identify critical path** — longest chain that determines total time
5. **Flag resource conflicts** — tasks touching the same file/service must serialize despite parallel eligibility
6. **Maximize wave width** — if a wave has only 1 task, look harder for decomposition. Every wave should have ≥2 tasks unless the critical path genuinely has no parallelism.

Execute waves in order; **within a wave, launch ALL tasks in parallel via the builtin `task` tool with `agent: "coder"`**. Do not serialize tasks that can run concurrently — this is a hard requirement, not a suggestion.

## Small-Change Decomposition

For work without a PRD Task Graph, decompose into independent parallel tasks:

**Pattern:** Most small changes follow a 3-part structure:
1. **Foundation** — types, constants, data structures, interfaces
2. **Logic** — functions, composables, services, business rules
3. **Surface** — components, UI, API endpoints, CLI output

Tasks 1→2→3 are sequential. But within each layer, parallelize:
- If foundation has types + constants → 2 parallel tasks
- If surface has component A + component B → 2 parallel tasks

**Mental model:**
```
Wave 0: types.ts + constants.ts (parallel)
Wave 1: composable.ts (depends on types)
Wave 2: ComponentA.vue + ComponentB.vue (parallel, both depend on composable)
```

**Minimum decomposition:** Even a "simple" change should produce ≥2 parallel tasks. If you can't decompose, the change is probably trivial (use the Trivial path instead).

## Parallel Coder Delegation

When launching a wave, send all wave tasks to `coder` agents simultaneously:

```
# Good: parallel launch of Wave 0
task(description="Implement auth endpoint", prompt="...", agent="coder")
task(description="Add database schema", prompt="...", agent="coder")
task(description="Write integration tests", prompt="...", agent="coder")

# Bad: sequential delegation — never do this
task(...) → wait → task(...) → wait → ...
```

Each `coder` prompt must be **fully self-contained**: include file paths, requirements, acceptance criteria, and any context the coder needs. The coder has no shared context with you.

## Workflow

### 1. Capture Before State

- **UI work:** `playwright_browser_snapshot` + `playwright_browser_take_screenshot` → `before-<description>.png`
- **Non-UI work:** Run existing integration/e2e tests for baseline. Note what passes/fails.
- **Skip if:** Non-UI work with no existing tests AND the change is purely additive (no risk of breaking existing behavior). Document why you skipped.

### 2. Build Task Graph & Launch Wave 0

- **Feature Mode:** Use the Task Graph from the PRD. Launch all Wave 0 tasks in parallel.
- **Small-Change Mode:** Decompose into 2-3 tasks following the foundation→logic→surface pattern. Launch the first wave.

### 3. Execute Remaining Waves

After each wave completes (all task results retrieved), launch the next wave in parallel. Update `todowrite` state after each wave.

### 4. Capture After State

Same tools as Step 1. Label: `after-<description>.png` or after-state test results.

### 5. Validate

- **UI:** Side-by-side comparison — does visual output match requirement? Any unexpected changes? Accessibility tree correct?
- **Non-UI:** Do integration/e2e tests pass? Does observed behavior match the requirement?
- **Both:** If unexpected changes — stop, diagnose, fix, re-validate.

### 6. Completion Gate

Invoke `advisor-gate` with: before state, after state, what changed, what requirement is met.

**Do not declare done without this gate. This step is non-negotiable.**
