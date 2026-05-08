---
name: use-groundwork
description: Bootstrap skill for the groundwork workflow suite. Loaded at every conversation start. Establishes core rules, skill triggers, and the 1% escalation heuristic. ALWAYS load this first.
---

# Using Groundwork Workflow

**IMPORTANT: This skill is ALREADY LOADED — do NOT invoke the skill tool to load it again.**

## Core Rules (Non-Negotiable)

1. **Always use `question` tool** instead of ending the conversation. Never leave the user without a next step.
2. **ALWAYS use `background_task` instead of `task` or `delegate`.** Never call the `task` or `delegate` tools. For ALL subagent work — exploration, coding, research, parallel tasks — use `background_task`. Then use `background_list` to monitor progress and `background_output` to retrieve results after `<system-reminder>` notification. The ONLY exception: if you absolutely must block until the result arrives before proceeding, use `delegate` as a last resort.
3. **No worktrees.** For new work, continue in the same session OR offer `/handoff` via `session-continue` skill. User chooses.
4. **Never commit PRDs** to git. Spec docs live in `docs/prds/` but are never staged.
5. **Always use `create-prd`** before implementation of non-trivial features (≥1 day). Never start coding a feature without an approved master PRD.
6. **Steer before nesting.** Small direction changes update the master PRD via Steer Log (see `create-prd`). Only invoke `nested-prd` for architectural pivots or scope increases >1 day.
7. **`advisor-gate` is MANDATORY before declaring done.** You NEVER declare a task complete without first invoking the `advisor-gate` completion gate and receiving APPROVE. No exceptions. Confidence without verification is an anti-pattern.
8. **No self-review.** Use `advisor` subagent via `task` (with `subagent_type: "advisor"`) for any technical uncertainty, not internal reasoning loops. Advisor-gate MUST use `task`, not `background_task`.
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

## Background Task Quick Reference

```
background_task(description="...", prompt="...", agent="explore")  → Launch
background_wait(task_id="bg_xxx", timeout=3600)                     → Block until task completes (replaces polling)
background_output(task_id="bg_xxx")                                  → Get result (after notification)
background_list()                                                    → Check status (like pty_list)
background_status(task_id="bg_xxx")                                  → Detailed health info for one task
background_stream(task_id="bg_xxx", offset=0)                        → Get partial output from running task
background_cancel(task_id="bg_xxx")                                  → Cancel one
background_cancel(all=true)                                          → Cancel all
background_input(task_id="bg_xxx", data="...")                       → Send input or interrupt signal to a running background task. Useful when a task is stuck waiting for input or needs to be interrupted.
```

**Workflow:**
1. Launch with `background_task`
2. **Do NOT poll.** Choose ONE of these paths:
   - **Path A — Fire and forget**: Launch tasks, continue with other work. The system will notify you when tasks complete.
   - **Path B — Block and wait**: Use `background_wait(task_id)` when you need the result before proceeding. This blocks without spamming.
   - **Path C — Stream progress**: Use `background_stream(task_id)` for long-running tasks where you want periodic progress updates.
3. When `<system-reminder>` notification arrives, call `background_output`
4. You can launch MULTIPLE tasks in parallel for max throughput

### Background Task Status States

Tasks can be in one of the following states:

- `running` — Task is currently executing
- `completed` — Task finished successfully
- `failed` — Task encountered an error
- `cancelled` — Task was manually cancelled
- `pending` — Task is queued but not yet started

### Error Handling and Retry Patterns

When a background task fails, the result from `background_output` will include an `error` field with details about what went wrong. To handle errors effectively:

- **Check for errors**: Always inspect the `error` field in the result from `background_output` before using the output.
- **Retry vs Cancel**: Retry a task if the failure appears transient (e.g., network timeout, temporary resource unavailability). Cancel the task if the failure is persistent or indicates a fundamental issue (e.g., syntax error, missing dependency).
- **Interrupt stuck tasks**: If a task is hanging or stuck waiting for input, use `background_input(task_id="bg_xxx", data="\x03")` to send a Ctrl+C interrupt signal.

### Anti-Polling Rules (CRITICAL)

**NEVER do this:**
```
❌ while (task.running) { background_list(); background_status(); background_output(); }
```

**This is spam. It wastes tokens, burns context, and achieves nothing.**

**Instead:**
- **Waiting on one task?** Use `background_wait(task_id)` — it blocks efficiently with a 2s polling interval internally.
- **Waiting on multiple tasks?** Launch them all, then do other work. The system notifies you when each completes.
- **Need progress updates?** Use `background_stream(task_id)` for periodic snapshots without spam.
- **Just checking if done?** Wait for the `<system-reminder>` notification, then call `background_output` ONCE.

### When to Use Each Tool

| Scenario | Tool | Why |
|----------|------|-----|
| Need result before continuing | `background_wait` | Blocks efficiently, returns result directly |
| Task completed, get output | `background_output` | One-shot retrieval after notification |
| Monitor long-running task | `background_stream` | Get partial output without blocking |
| Check if task is stuck | `background_status` | Health check: duration, tool calls, last activity |
| See all active tasks | `background_list` | Quick status overview |
| Cancel stuck/hanging task | `background_cancel` | Clean termination |
| Send input to running task | `background_input` | Interactive input or Ctrl+C interrupt |

### Background Task Best Practices

- **Always specify descriptive `description` parameters** for task tracking. Clear descriptions make it easier to identify tasks in `background_list` output.
- **Use `background_wait` instead of polling loops.** If you need a result before proceeding, block with `background_wait` rather than spamming `background_list`/`background_output`.
- **Use `background_stream` for progress monitoring.** For long tasks, stream output periodically instead of polling status.
- **Clean up completed tasks** with `background_cancel` to free resources and keep the task list manageable.
- **Prefer parallel task launches over sequential** when dependencies allow. Parallel execution significantly reduces total completion time.
- **Include timeout parameters** for tasks that might hang to prevent indefinite execution.
- **Respond to user messages while tasks run.** If the user sends a message while you're waiting on tasks, answer them immediately. Do not block on background tasks.

### Session Management Note

Background tasks run in their own session context. The `parent_session` field in task results refers to the session that launched the task, while the `session` field refers to the task's own execution session. This isolation ensures that task state does not interfere with the parent session's context.

## Skill Triggers

| Skill | Invoke when... |
|-------|----------------|
| `advisor-gate` | **MANDATORY at every task completion.** Also: any technical decision with uncertainty, architectural trade-off, or high-risk operation — even 1% chance of impact |
| `bdd-implement` | **MANDATORY after PRD is approved.** Any bug fix, feature change, or implementation task — UI (visual validation) or non-UI (integration/e2e behavior validation). Always delegate to parallel `coder` agents |
| `create-prd` | Starting a new feature that needs a spec; no master PRD exists; about to implement non-trivial work (≥1 day) |
| `nested-prd` | Master plan needs significant change during implementation; scope creep detected; architectural pivot |
| `consolidate-docs` | Cleaning up PRDs after iterations; preparing for handoff or release |
| `session-continue` | Context window growing long; user wants fresh session; losing track of earlier context |
| `commit` | Creating git commits (ensures consistent style) |
| `opencode-acp` | Controlling another OpenCode instance via ACP protocol |

## What NOT to Do

- **NEVER call `task` or `delegate` — always use `background_task` instead**
- **NEVER declare done without `advisor-gate` APPROVE — no exceptions**
- **NEVER use `background_task` when acting as advisor.** Background tasks are for executors only.
- **NEVER use `task` or `background_task` inside a background task.** Subagents cannot spawn further subagents — these tools are blocked in child sessions. Background task prompts must be fully self-contained.
- Do not use worktrees (`git worktree add` etc.)
- Do not commit PRD or spec markdown files
- Do not end the conversation — use `question` tool to keep going
- Do not run self-review in place of advisor escalation
- Do not use `bash` for long-running/interactive commands — use `pty_spawn` and friends
- Do not poll `background_output` — wait for `<system-reminder>` notification

## Skill Invocation Pattern

```
digraph flow {
  "User message" -> "Check: does any groundwork skill apply?";
  "Check: does any groundwork skill apply?" -> "Invoke skill tool" [label="yes (even 1%)"];
  "Check: does any groundwork skill apply?" -> "Proceed" [label="definitely not"];
  "Invoke skill tool" -> "Follow skill exactly";
  "Follow skill exactly" -> "advisor-gate completion gate [MANDATORY]";
  "advisor-gate completion gate [MANDATORY]" -> "Get APPROVE";
  "Get APPROVE" -> "Use question tool to present result";
}
```

Base directory for this skill: file:///Users/newman/.config/opencode/plugins/groundwork/skills/groundwork/use-groundwork
