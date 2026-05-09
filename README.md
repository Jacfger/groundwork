# Groundwork

Workflow plugin for OpenCode providing structured development practices: PRD-driven development, advisor gates, BDD implementation, parallel background tasks, and context management.

## Install

Add to `opencode.json`:

```json
{
  "plugin": [
    "opencode-pty",
    "groundwork@git+https://github.com/IniZio/groundwork.git"
  ]
}
```

Restart OpenCode. Skills auto-discover.

## Tools

| Tool | Purpose |
|------|---------|
| `background_task` | Launch parallel background tasks |
| `background_wait` | Block until task completes |
| `background_output` | Get task result |
| `background_list` | List active tasks |
| `background_cancel` | Cancel task(s) |
| `background_input` | Send steering/interrupt to running task |
| `background_status` | Task health info |
| `background_stream` | Partial output from running task |
| `read` | Enhanced file read with retry+fallbacks |
| `handoff_session` | Create focused continuation prompt |
| `read_session` | Read prior session transcript |

## Skills

| Skill | Trigger |
|-------|---------|
| `use-groundwork` | Every session start — core rules |
| `create-prd` | Starting non-trivial features |
| `advisor-gate` | Before declaring done |
| `bdd-implement` | After PRD approval |
| `nested-prd` | Scope/architecture pivots |
| `consolidate-docs` | Cleaning up PRDs |
| `session-continue` | Context handoff |

## Rules

1. PRD-first for features ≥1 day
2. Advisor gate before declaring done
3. Background tasks for parallel work
4. No PRD commits to git
5. PTY tools for long-running commands

## Dev

```bash
bun test        # run tests
```

TypeScript source in `src/`. Bun loads TS natively — no build needed.
