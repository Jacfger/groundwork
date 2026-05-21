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
| `handoff_session` | Create focused continuation prompt |

## Skills

| Skill | Trigger |
|-------|---------|
| `use-groundwork` | Every session start — core rules, issue-type routing |
| `interview` | Before PRD creation; standalone for small changes and bug scoping; updates CONTEXT.md + ADRs |
| `diagnose` | Bugs and regressions — replaces PRD + BDD for bug path |
| `create-prd` | After interviewing for features (≥1 day) |
| `advisor-gate` | Before declaring done |
| `bdd-implement` | After PRD approval (features) or interviewing (small changes) |
| `prototype` | Design exploration — logic TUI or UI variants, throwaway |
| `goal` | Persistent project goal — survives compression and restarts |

## Agents

| Agent | Model recommendation | Temperature | Purpose |
|-------|---------------------|-------------|---------|
| `advisor` | `openai/gpt-5.4` | 0.1 | Strategic decisions, architecture, code review |
| `coder` | `kimi-for-coding/k2.6` | 0.2 | Fast implementation, tests, build verification |
| `explore` | `openai/gpt-5.4-mini` | 0.1 | Codebase search, pattern discovery |
| `designer` | `kimi-for-coding/k2.6` | 0.7 | UI/UX, styling, responsive design, visual polish |
| `observer` | `openai/gpt-5.4-mini` | 0.1 | Screenshot analysis, visual comparison, PDF interpretation |

Configure models in `opencode.json`:

```json
{
  "agent": {
    "advisor": { "model": "openai/gpt-5.4" },
    "coder": { "model": "kimi-for-coding/k2.6" },
    "explore": { "model": "openai/gpt-5.4-mini" },
    "designer": { "model": "kimi-for-coding/k2.6" },
    "observer": { "model": "openai/gpt-5.4-mini" }
  }
}
```

Temperature defaults are set automatically. Override in agent config if needed.

## Rules

1. Issue-type routing: bug → diagnose, small change → interview + bdd-implement, feature → interview + create-prd + bdd-implement
2. Advisor gate before declaring done
3. No PRD commits to git
4. PTY tools for long-running commands
5. Interview before PRD — understanding before synthesis

## Dev

```bash
bun test        # run tests
```

TypeScript source in `src/`. Bun loads TS natively — no build needed.
