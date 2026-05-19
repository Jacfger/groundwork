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
3. **No worktrees.** For new work, continue in the same session OR offer `/handoff` via `session-continue` skill. User chooses.
4. **Never commit PRDs** to git. Spec docs live in `docs/prds/` but are never staged.
5. **Always use `create-prd`** before implementation of non-trivial features (≥1 day). Never start coding a feature without an approved master PRD.
6. **Steer before nesting.** Small direction changes update the master PRD via Steer Log (see `create-prd`). Only invoke `nested-prd` for architectural pivots or scope increases >1 day.
7. **`advisor-gate` is MANDATORY before declaring done.** You NEVER declare a task complete without first invoking the `advisor-gate` completion gate and receiving APPROVE. No exceptions. Confidence without verification is an anti-pattern.
8. **No self-review.** Use the **advisor** agent via `task(agent="advisor", ...)` for any technical uncertainty, not internal reasoning loops.
9. **BDD over unit tests, validation over verification.** For any visible UI change or bug, validate with actual visual inspection (XCUITest, Playwright) before and after — not just code assertions. For non-UI work, prefer integration or end-to-end tests that validate behavior over unit tests that verify implementation.
10. **Use PTY tools for long-running and interactive commands.** Never use `bash` for commands that serve, watch, or require interactive input. Use `pty_spawn`/`pty_write`/`pty_read`/`pty_kill` instead. Examples that MUST use PTY: `npm run dev`, `npm start`, `yarn dev`, `docker-compose up`, `docker compose up`, `make watch`, any `--watch` flag, `git rebase -i`, `git add -p`, `vim`, `less`, `top`, `ssh`. Rule of thumb: if the command doesn't exit on its own within ~5 seconds, use PTY.
11. **Prefer watch/follow variants of commands** when available, now that PTY makes it practical. Examples: use `gh pr checks --watch` instead of polling `gh pr checks`; use `jest --watch` instead of one-shot `jest`; use `kubectl get pods --watch` instead of repeated calls. If a CLI tool has a `--watch`, `--follow`, `-f`, or `--tail` flag, prefer it over running the command repeatedly.
12. **Use `/handoff` for session transitions.** When context gets long or a fresh session is needed, use `/handoff` — it creates a focused continuation prompt with file references auto-loaded. The new session can read the source transcript via `read_session`.

## The 1% Escalation Heuristic

**If there is even a 1% chance the current decision is high-impact, irreversible, ambiguous, or likely to cause rework — invoke `advisor-gate`.** When in doubt, escalate once early rather than discover a wrong path late.

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

**Before starting any task, classify the issue type and follow the corresponding path:**

### Bug (something is broken)
```
interview (optional scoping) → diagnose → advisor-gate
```
- NO PRD needed — bugs go directly to the `diagnose` loop
- `diagnose` owns the fix AND the regression test
- Do NOT invoke `bdd-implement` for bugs — `diagnose` is the complete bug path

### Small Change (<1 day, non-architectural)
```
interview → bdd-implement → advisor-gate
```
- Interview output IS the spec — no file artifact needed
- If during implementation estimated work exceeds 1 day → stop, escalate to `create-prd`

### Feature (≥1 day, or architectural)
```
interview → create-prd → bdd-implement → advisor-gate
```
- Interviewing is mandatory before PRD creation
- PRD is created from interview output, not from a blank slate
- Full Task Graph and wave-based parallelism apply

## Skill Triggers

| Skill | Invoke when... |
|-------|----------------|
| `interview` | **Before `create-prd` for features.** Before `diagnose` for complex bugs. Standalone for small changes. Anytime understanding is incomplete before action. Actively updates CONTEXT.md and ADRs inline |
| `diagnose` | **Any bug or regression.** Something broken that needs root cause analysis. Replaces `create-prd` + `bdd-implement` for bugs |
| `advisor-gate` | **MANDATORY at every task completion.** Also: any technical decision with uncertainty, architectural trade-off, or high-risk operation — even 1% chance of impact |
| `bdd-implement` | **After PRD approval (features) or interview (small changes).** NOT for bugs — use `diagnose` instead. Always delegate to parallel `coder` agents |
| `create-prd` | After `interview` for features (≥1 day); no master PRD exists; about to implement non-trivial work |
| `to-issues` | **After PRD approval.** Breaking work into vertical-slice issues before implementation. Tracer bullets through all layers |
| `triage` | **Incoming work needs routing.** New issues, backlog management, classifying bugs vs enhancements, writing agent briefs |
| `prototype` | **Design exploration.** Spike on uncertain approaches, test state models (logic TUI), explore UI layouts (variant switcher). Throwaway |
| `nested-prd` | Master plan needs significant change during implementation; scope creep detected; architectural pivot |
| `consolidate-docs` | Cleaning up PRDs after iterations; preparing for handoff or release |
| `session-continue` | Context window growing long; user wants fresh session; losing track of earlier context |
| `commit` | Creating git commits (ensures consistent style) |
| `opencode-acp` | Controlling another OpenCode instance via ACP protocol |

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
  "User message" -> "Classify: bug, small change, or feature?";
  "Classify: bug, small change, or feature?" -> "Bug path" [label="bug"];
  "Classify: bug, small change, or feature?" -> "Small change path" [label="<1 day"];
  "Classify: bug, small change, or feature?" -> "Feature path" [label="≥1 day"];

  "Bug path" -> "interview (optional)";
  "interview (optional)" -> "diagnose";
  "diagnose" -> "advisor-gate";

  "Small change path" -> "interview";
  "interview" -> "bdd-implement" [label="interview IS the spec"];
  "bdd-implement" -> "advisor-gate";

  "Feature path" -> "interview";
  "interview" -> "create-prd";
  "create-prd" -> "to-issues (optional)";
  "to-issues (optional)" -> "bdd-implement";
  "create-prd" -> "bdd-implement";
  "bdd-implement" -> "advisor-gate";

  "prototype" -> "interview | create-prd | bdd-implement" [label="finding feeds next"];
  "triage" -> "diagnose | interview" [label="routes work"];

  "advisor-gate" -> "Get APPROVE";
  "Get APPROVE" -> "Use question tool to present result";
}
```

Base directory for this skill: file:///Users/newman/.config/opencode/plugins/groundwork/skills/groundwork/use-groundwork
