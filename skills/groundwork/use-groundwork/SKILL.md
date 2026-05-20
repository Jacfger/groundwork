---
name: use-groundwork
description: Bootstrap skill for the groundwork workflow suite. Loaded at every conversation start. Establishes core rules, skill triggers, and the 1% escalation heuristic. ALWAYS load this first.
---

# Using Groundwork Workflow

**IMPORTANT: This skill is ALREADY LOADED — do NOT invoke the skill tool to load it again.**

## Bootstrap Integrity

This skill is injected at conversation start. If you notice the core rules, routing, or skill triggers are missing from your context (e.g., after context compression), re-invoke this skill to reload the bootstrap content.

## Core Rules (Non-Negotiable)

1. **Always use `question` tool** instead of ending the conversation. Never leave the user without a next step.
2. **ALWAYS use the builtin `task` tool for ALL subagent work.** For ALL subagent work — exploration, coding, research, parallel tasks, AND advisor — use `task` with `agent` parameter. Then wait for the result directly.
    - **Advisor**: Use `task(agent="advisor", description="...", prompt="...")` and wait for the response directly.
3. **No worktrees.** For new work, continue in the same session OR use `/handoff`. User chooses.
4. **Never commit PRDs** to git. Spec docs live in `docs/prds/` but are never staged.
5. **Always use `create-prd`** before implementation of non-trivial features (≥1 day). Never start coding a feature without an approved master PRD.
6. **Steer via interview.** Small direction changes update the master PRD via Steer Log (see `create-prd`). Significant architectural pivots get re-interviewed and the PRD rewritten.
7. **`advisor-gate` is MANDATORY before declaring done.** You NEVER declare a task complete without first invoking the `advisor-gate` completion gate and receiving APPROVE. No exceptions. Confidence without verification is an anti-pattern.
8. **No self-review.** Use the **advisor** agent via `task(agent="advisor", ...)` for any technical uncertainty, not internal reasoning loops.
9. **BDD over unit tests, validation over verification.** For any visible UI change or bug, validate with actual visual inspection (XCUITest, Playwright) before and after — not just code assertions. For non-UI work, prefer integration or end-to-end tests that validate behavior over unit tests that verify implementation.
10. **Use PTY tools for long-running and interactive commands.** Never use `bash` for commands that serve, watch, or require interactive input. Use `pty_spawn`/`pty_write`/`pty_read`/`pty_kill` instead. Examples that MUST use PTY: `npm run dev`, `npm start`, `yarn dev`, `docker-compose up`, `docker compose up`, `make watch`, any `--watch` flag, `git rebase -i`, `git add -p`, `vim`, `less`, `top`, `ssh`. Rule of thumb: if the command doesn't exit on its own within ~5 seconds, use PTY.
11. **Prefer watch/follow variants of commands** when available, now that PTY makes it practical. Examples: use `gh pr checks --watch` instead of polling `gh pr checks`; use `jest --watch` instead of one-shot `jest`; use `kubectl get pods --watch` instead of repeated calls. If a CLI tool has a `--watch`, `--follow`, `-f`, or `--tail` flag, prefer it over running the command repeatedly.
12. **Use `/handoff` for session transitions.** When context gets long or a fresh session is needed, use `/handoff` — it creates a focused continuation prompt with file references auto-loaded. The new session can read the source transcript via `read_session`.
13. **MANDATORY skill tool invocation.** When issue-type routing names a skill, you MUST invoke the `skill` tool to load it. Do NOT implement directly when a routing path specifies a skill — the skill contains instructions not present in this bootstrap. The only exceptions are `Trivial` and `Docs-Only` paths.

## The 1% Escalation Heuristic

**If there is even a 1% chance the current decision is high-impact, irreversible, ambiguous, or likely to cause rework — invoke `advisor-gate`.** When in doubt, escalate once early rather than discover a wrong path late.

**If the issue-type routing names a skill, you MUST invoke the `skill` tool — no exceptions except Trivial and Docs-Only paths.** This is the single most important compliance rule. The most common failure mode is: agent classifies correctly → skips skill invocation → implements directly → loses workflow discipline.

This applies to:
- Any skill listed in the Skill Triggers table below
- Any architectural trade-off or destructive operation
- **ALWAYS at task completion** — the advisor-gate completion gate is never optional

Invoke the relevant skill tool BEFORE any response or action. 1% chance = invoke it. **No exceptions at completion.**

## Subagent Task Quick Reference

Use the builtin `task` tool to delegate work to subagents:

```
task(description="...", prompt="...", agent="explore")  → Launch and wait for result
```

**Workflow:**
1. Launch with `task` — the tool blocks until the subagent completes and returns the result directly
2. You can launch MULTIPLE tasks in parallel for max throughput by calling `task` multiple times without waiting

### Task Status States

Tasks can be in one of the following states:

- `running` — Task is currently executing
- `completed` — Task finished successfully
- `failed` — Task encountered an error

### Error Handling and Retry Patterns

When a task fails:

- **Check for errors**: Always inspect the result for error details before using the output
- **Retry vs Cancel**: Retry a task if the failure appears transient (e.g., network timeout, temporary resource unavailability). Cancel if the failure is persistent or indicates a fundamental issue

### Best Practices

- **Always specify descriptive `description` parameters** for task tracking
- **Prefer parallel task launches over sequential** when dependencies allow. Parallel execution significantly reduces total completion time
- **Include timeout parameters** for tasks that might hang to prevent indefinite execution
- **Respond to user messages while tasks run.** If the user sends a message while you're waiting on tasks, answer them immediately

## Issue-Type Routing

**Before starting any task, classify the issue type and scope, then follow the corresponding path.** Classification is based on three dimensions: **type** (what), **scope** (how much), and **specificity** (how clear the requirements are).

### MANDATORY SKILL INVOCATION

When a routing path names a skill (e.g., `interview`, `diagnose`, `create-prd`, `bdd-implement`, `advisor-gate`, `prototype`), you **MUST invoke the `skill` tool** to load it. These are NOT optional suggestions — they are mandatory workflow steps.

```
WRONG:  Read routing path → classify → skip skill → implement directly
RIGHT:  Read routing path → classify → invoke skill tool → follow skill's instructions
```

**Why this is mandatory:** Each skill contains domain-specific instructions (question strategies, debugging loops, decomposition patterns) that are NOT included in this bootstrap. Without loading the skill, you lose critical workflow discipline.

**Exception:** Only the `Trivial` and `Docs-Only` paths skip skill invocation entirely. Every other path requires at least one skill load.

**Anti-pattern — the trivial escape hatch:** Do NOT re-classify a feature or small change as "trivial" just because the user described it clearly. A clearly described feature is still a feature. A clearly described small change is still a small change. The trivial path is only for changes that modify ≤1 file, ≤10 lines, and add no new behavior.

### Trivial (fully specified, <1h, ≤1 file, ≤10 lines)
```
implement directly → invoke skill "advisor-gate"
```
- The user's message contains everything needed — no ambiguity, no exploration required
- **Strict criteria — ALL must be true**: ≤1 file changed, ≤10 lines, no new behavior, no new dependencies
- Examples: fix a typo, rename a variable, update a dependency version, change a color value
- **Skip**: interview, bdd-implement, PRD — all overhead here
- **NOT trivial**: adding features, creating components, changing user-facing behavior — even if well-described

### Bug (something is broken)

**Trivial bug** (obvious cause, ≤1 file fix):
```
invoke skill "diagnose" → abbreviated mode (Phase 1+2+5+6) → invoke skill "advisor-gate"
```
- Skip Phase 3 (hypothesise) and Phase 4 (instrument) — cause is already known
- Write regression test, apply fix, verify

**Standard bug** (cause unclear, needs investigation):
```
invoke skill "diagnose" → full 6-phase loop → invoke skill "advisor-gate"
```
- NO PRD needed — `diagnose` owns the fix AND the regression test
- Do NOT invoke `bdd-implement` for bugs — `diagnose` is the complete bug path

**Complex bug** (multi-system, unclear boundaries, might be a design issue):
```
invoke skill "interview" (scoping) → invoke skill "diagnose" → invoke skill "advisor-gate"
```
- Interview resolves scope before debugging begins
- If the bug reveals an architectural issue, note it in the post-mortem

### Small Change (<1 day, non-architectural)

**Trivial small change** (strict criteria — ALL must be true):
```
implement directly → invoke skill "advisor-gate"
```
- **≤1 file changed**, **≤10 lines added/modified**, **no new behavior** (only adjusts existing behavior)
- Examples: change a color, adjust padding, rename a prop, update a config value, fix a CSS rule
- **NOT trivial** (even if well-described): adding a new feature, creating a new component, adding new user-facing behavior, touching >1 file, adding >10 lines
- If it adds or changes user-facing behavior → it is a **standard small change**, use the path below

**Standard small change** (any small change that doesn't meet ALL trivial criteria):
```
invoke skill "interview" (quick: 3-4 questions) → invoke skill "bdd-implement" (decompose into 2-3 parallel tasks) → invoke skill "advisor-gate"
```
- This is the DEFAULT small-change path. Use it unless the change is truly single-file, ≤10 lines, no new behavior.
- Interview output IS the spec — no file artifact needed
- Quick interview: cover only the unclear aspects, skip what's obvious
- If during implementation estimated work exceeds 1 day → stop, escalate to `create-prd`

### Feature (≥1 day, or architectural)
```
invoke skill "interview" (full: 8-10 questions) → invoke skill "create-prd" → invoke skill "bdd-implement" (vertical-slice decomposition) → invoke skill "advisor-gate"
```
- Interviewing is mandatory before PRD creation
- PRD is created from interview spec, not from a blank slate
- bdd-implement decomposes into vertical tracer-bullet slices (not horizontal layers)
- PRD uses modular template — only sections the feature needs

### Spike / Design Exploration
```
invoke skill "prototype" → feed findings into next skill
```
- When the approach is uncertain and needs validation before committing
- Prototype findings inform interview or PRD

### Refactor
```
If <1d: invoke skill "interview" → invoke skill "bdd-implement" → invoke skill "advisor-gate"
If ≥1d: invoke skill "interview" → invoke skill "create-prd" → invoke skill "bdd-implement" → invoke skill "advisor-gate"
```
- Refactoring follows the same paths — scope determines the branch

### Docs-Only Change
```
implement directly → invoke skill "advisor-gate"
```
- README updates, comment fixes, documentation changes
- No testing needed beyond visual review

## Skill Triggers

| Skill | Invoke when... |
|-------|----------------|
| `interview` | **Before `create-prd` for features.** Before `diagnose` for complex bugs. Standalone for small changes. Anytime understanding is incomplete before action. Actively updates CONTEXT.md and ADRs inline |
| `diagnose` | **Any bug or regression.** Something broken that needs root cause analysis. Replaces `create-prd` + `bdd-implement` for bugs |
| `advisor-gate` | **MANDATORY at every task completion.** Also: any technical decision with uncertainty, architectural trade-off, or high-risk operation — even 1% chance of impact |
| `bdd-implement` | **After PRD approval (features) or interview (small changes).** NOT for bugs — use `diagnose` instead. Always delegate to parallel `coder` agents |
| `create-prd` | After `interview` for features (≥1 day); no master PRD exists; about to implement non-trivial work |
| `prototype` | **Design exploration.** Spike on uncertain approaches, test state models (logic TUI), explore UI layouts (variant switcher). Throwaway |
| `commit` | Creating git commits (ensures consistent style) |
| `opencode-acp` | Controlling another OpenCode instance via ACP protocol |
| `goal` | **Multi-step work needing focus tracking.** Set before testing multiple flows, multi-wave implementation, or any task where losing the objective causes rework. Persisted across sessions |

## Session Conventions

### Session Goal

**For multi-step work, use the `goal` skill (`set_goal` tool).** It persists across context compression and session restarts, and injects a reminder into every message.

For quick in-session tracking, pin the goal as the **first `todowrite` item**. Derived from the PRD's Acceptance Criteria or the interview spec's resolutions.

**When to use `set_goal` vs todowrite:**
- `set_goal`: Testing multiple flows, multi-wave features, any work where losing focus across compression/restart has consequences
- `todowrite`: Quick in-session task tracking within a single unbroken session

### Learnings (docs/learnings.md)

Capture non-obvious gotchas discovered during any work session. Lazy-created at project root. Append-only.

**Add learnings when:**
- Surprising framework behavior encountered
- Non-obvious configuration required
- Integration pitfall discovered
- Test setup complexity that would trip up future sessions
- Anything that made you say "I didn't expect that"

**Format:**
```markdown
# Learnings

- **<topic>**: <gotcha description — what happened, why it's surprising, what to do instead>
```

**Rules:**
- Lazy creation — only create when there's genuinely non-obvious knowledge to capture
- One bullet per gotcha — keep it scannable
- Only genuinely surprising things — not routine findings
- Never committed to git (lives alongside PRDs)

### Domain Glossary (CONTEXT.md)

See `interview` skill for CONTEXT.md format and rules. Created and maintained during interview sessions.

## Task Scoping for Subagent Tasks

**Rules for decomposing work into subagent tasks:**

1. **Max 3 files per task.** If a task needs to create/modify >3 files, split it into multiple tasks.
2. **Max ~200 LOC per task.** If a single file needs >200 lines, consider if it can be split or if the coder prompt should include the full content inline (not via file reads).
3. **One responsibility per task.** "Create types.ts" is good. "Create all lib files" is bad — it creates a mega-task that will run for 20+ minutes and likely fail.
4. **Embed source in prompts.** Subagent tasks cannot reliably read large source files. If a coder needs reference material, embed it directly in the prompt text. Do NOT tell the coder to "read file X" — it may fail.
5. **Verify task output immediately.** After a task completes, check the result. If it says `(No text output)` or the wrong files were created, relaunch the task with corrections before giving up on it.

### Failed Task Recovery

When a subagent task fails or produces wrong output:

1. **Relaunch with corrected prompt** — Include lessons learned and clearer instructions
2. **Only after relaunch fails**, do the work yourself — Explain to user WHY you're doing it directly

## What NOT to Do

- **NEVER declare done without `advisor-gate` APPROVE — no exceptions**
- **NEVER skip skill tool invocation when routing names a skill.** If the path says `invoke skill "diagnose"`, you MUST call the `skill` tool with `name: "diagnose"`. Implementing directly when a skill is specified is the most common compliance failure.
- **NEVER use `task` when acting as advisor.** Subagent tasks are for executors only.
- **NEVER use `task` inside a subagent task.** Subagents cannot spawn further subagents — these tools are blocked in child sessions. Subagent prompts must be fully self-contained.
- **NEVER use `question` tool in subagents.** Subagents must not ask questions — they must make decisions and do the work. The executor handles all user-facing questions.
- **NEVER do implementation work directly when a coder fails.** Always relaunch with corrected prompt first. Only do the work yourself after relaunch fails — and even then, explain why to the user.
- Do not use worktrees (`git worktree add` etc.)
- Do not commit PRD or spec markdown files
- Do not end the conversation — use `question` tool to keep going
- Do not run self-review in place of advisor escalation
- Do not use `bash` for long-running/interactive commands — use `pty_spawn` and friends

## Subagent Task Auto-Preamble

Every subagent task automatically gets a preamble prepended: `[SUBAGENT TASK RULES — MANDATORY]` telling the agent:
- Never call `question` or tools that wait for user input
- Never call `task` or `delegate` tools — they are blocked in child sessions
- Make decisions autonomously
- Return final result in last message

This is the **soft prevention** layer. The **hard deny** layer in `opencode.json` (`"question": "deny"` for coder/explore/advisor agents) catches any agent that ignores the preamble.

## Skill Invocation Pattern

```
digraph flow {
  "User message" -> "Classify: type + scope + specificity";
  "Classify: type + scope + specificity" -> "Trivial" [label="fully specified, <1h"];
  "Classify: type + scope + specificity" -> "Bug path" [label="something broken"];
  "Classify: type + scope + specificity" -> "Small change path" [label="<1 day"];
  "Classify: type + scope + specificity" -> "Feature path" [label="≥1 day"];
  "Classify: type + scope + specificity" -> "Spike" [label="uncertain approach"];

  "Trivial" -> "implement directly";
  "implement directly" -> "invoke skill advisor-gate";

  "Bug path" -> "Trivial bug" [label="obvious cause"];
  "Bug path" -> "Standard bug" [label="needs investigation"];
  "Bug path" -> "Complex bug" [label="multi-system"];
  "Trivial bug" -> "invoke skill diagnose (abbreviated)";
  "Standard bug" -> "invoke skill diagnose (full)";
  "Complex bug" -> "invoke skill interview (scoping)";
  "invoke skill interview (scoping)" -> "invoke skill diagnose (full)";
  "invoke skill diagnose (abbreviated)" -> "invoke skill advisor-gate";
  "invoke skill diagnose (full)" -> "invoke skill advisor-gate";

  "Small change path" -> "Trivial SC" [label="fully specified"];
  "Small change path" -> "Standard SC" [label="needs design"];
  "Trivial SC" -> "implement directly";
  "Standard SC" -> "invoke skill interview (quick: 3-4 Q)";
  "invoke skill interview (quick: 3-4 Q)" -> "invoke skill bdd-implement (2-3 parallel tasks)";
  "invoke skill bdd-implement (2-3 parallel tasks)" -> "invoke skill advisor-gate";

  "Feature path" -> "invoke skill interview (full: 8-10 Q)";
  "invoke skill interview (full: 8-10 Q)" -> "invoke skill create-prd";
  "invoke skill create-prd" -> "invoke skill bdd-implement (vertical slices)";
  "invoke skill bdd-implement (vertical slices)" -> "invoke skill advisor-gate";

  "Spike" -> "invoke skill prototype";
  "invoke skill prototype" -> "invoke skill interview | create-prd | bdd-implement" [label="findings feed next"];

  "invoke skill advisor-gate" -> "Get APPROVE";
  "Get APPROVE" -> "Use question tool to present result";
}
```

Base directory for this skill: file:///Users/newman/.config/opencode/plugins/groundwork/skills/groundwork/use-groundwork
