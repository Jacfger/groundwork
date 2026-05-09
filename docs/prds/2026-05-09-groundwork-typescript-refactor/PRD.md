---
type: master
feature_area: groundwork-typescript-refactor
date: 2026-05-09
status: active
child_prds: []
---

# Groundwork TypeScript Refactor + file:// Prompt Resolution

## Overview

This system refactors the groundwork plugin from a monolithic 2182-line JavaScript file into a modular TypeScript project with files under ~500 LOC each. It also extracts the `file://` URI prompt resolution logic from oh-my-opencode into a shared utility within the groundwork plugin, enabling agents to use `file://` URIs in their `prompt_append` configuration without depending on oh-my-opencode's internal implementation.

The refactor preserves all existing behavior exactly — same plugin exports, same tool definitions, same runtime semantics. Only the code organization and language change. The TypeScript compilation target is the existing `.opencode/plugins/groundwork.js` output location so that the plugin continues to load without any opencode configuration changes.

## Architecture

### Current State

```
plugins/groundwork/
├── .opencode/plugins/groundwork.js    # 2182 lines, monolithic
├── .opencode/package.json             # @opencode-ai/plugin 1.4.7
├── package.json                       # name: opencode-groundwork
├── opencode.json                      # agent configs
├── agents/advisor.md                  # advisor system prompt
└── skills/groundwork/                 # SKILL.md files
```

### Target State

```
plugins/groundwork/
├── .opencode/plugins/groundwork.js    # compiled output (single entry)
├── .opencode/package.json             # same
├── src/
│   ├── index.ts                       # Plugin entry point (~150 LOC)
│   ├── background-manager.ts          # BackgroundManager class (~600 LOC)
│   ├── lib/
│   │   ├── snapshot.ts               # Filesystem snapshot helpers (~100 LOC)
│   │   ├── skills.ts                 # Skills injection helpers (~40 LOC)
│   │   ├── helpers.ts                # formatDuration, truncateText, sleep, etc. (~120 LOC)
│   │   ├── task-formatting.ts        # Task result formatting (~250 LOC)
│   │   ├── handoff.ts                # Handoff helpers (~100 LOC)
│   │   ├── persistence.ts            # PersistenceLayer class (~60 LOC)
│   │   ├── concurrency.ts            # ConcurrencyManager class (~50 LOC)
│   │   ├── prompt-resolver.ts        # file:// URI resolution (extracted) (~40 LOC)
│   │   └── preamble.ts               # Auto-preamble generation (~20 LOC)
│   ├── tools/
│   │   ├── background-task.ts        # background_task tool definition (~80 LOC)
│   │   ├── background-wait.ts        # background_wait tool (~50 LOC)
│   │   ├── background-output.ts      # background_output tool (~50 LOC)
│   │   ├── background-list.ts        # background_list tool (~30 LOC)
│   │   ├── background-cancel.ts      # background_cancel tool (~30 LOC)
│   │   ├── background-input.ts       # background_input tool (~200 LOC)
│   │   ├── background-status.ts      # background_status tool (~80 LOC)
│   │   ├── background-stream.ts      # background_stream tool (~80 LOC)
│   │   └── session.ts                # handoff_session + read_session (~60 LOC)
│   └── types.ts                      # Shared TypeScript interfaces (~80 LOC)
├── tsconfig.json
├── package.json                       # Updated with dev dependencies
└── ...rest unchanged
```

### Compilation Pipeline

```
src/index.ts → tsc → .opencode/plugins/groundwork.js
```

The `tsconfig.json` will be configured to:
- Output a single bundled file (or use a bundler like `esbuild`)
- Target ES2022 modules (ESM)
- Output to `.opencode/plugins/groundwork.js`
- Preserve the same module interface

**Build strategy**: Use `tsdown` for bundling since it produces a single file output from TypeScript modules, which is what the plugin system expects. No external dependencies — everything bundled into one `.js` file. `tsdown` is built on rolldown (Rust-based) for fast builds.

### Module Boundaries

Each module has a clear single responsibility:

| Module | Responsibility |
|--------|---------------|
| `types.ts` | Shared interfaces: `TaskInfo`, `TaskResult`, `Notification`, `FileSnapshot`, etc. |
| `lib/snapshot.ts` | `captureFileSnapshot`, `diffFileSnapshots`, `formatFileChanges` |
| `lib/skills.ts` | `extractAndStripFrontmatter`, `getBootstrapContent` |
| `lib/helpers.ts` | `formatDuration`, `truncateText`, `sleep`, `extractMessages`, `extractFailureContext` |
| `lib/task-formatting.ts` | `formatTaskStatus`, `formatFailureContext`, `formatTaskResult`, `buildNotificationText`, `formatActivityTime`, `isTaskStuck`, `formatTaskList` |
| `lib/handoff.ts` | `parseFileReferences`, `isBinaryBuffer`, `buildSyntheticFileParts`, `formatTranscript`, `HANDOFF_COMMAND` |
| `lib/persistence.ts` | `PersistenceLayer` class |
| `lib/concurrency.ts` | `ConcurrencyManager` class |
| `lib/prompt-resolver.ts` | `resolvePromptAppend` — extracted from oh-my-opencode |
| `lib/preamble.ts` | `BACKGROUND_TASK_PREAMBLE` constant + `buildAutoPreamble()` |
| `tools/background-*.ts` | Individual tool definitions using `@opencode-ai/plugin`'s `tool()` |
| `tools/session.ts` | `handoff_session` and `read_session` tool definitions |
| `background-manager.ts` | `BackgroundManager` class — core state machine |
| `index.ts` | `GroundworkPlugin` export, wires everything together |

## Data Model

### Types (types.ts)

```typescript
interface TaskInfo {
  id: string;
  session: string;
  parent_session: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupt';
  prompt: string;
  agent?: string;
  description?: string;
  depends_on?: string[];
  timeout?: number;
  created_at: number;
  started_at?: number;
  completed_at?: number;
  poll_count: number;
  last_poll_at?: number;
  last_activity_at?: number;
  result?: TaskResult;
  error?: string;
}

interface TaskResult {
  output?: string;
  error?: string;
  session: string;
  parent_session: string;
  duration_ms: number;
  artifact_paths?: string[];
}

interface FileSnapshot {
  path: string;
  mtime: number;
  size: number;
  type: 'file' | 'directory';
}

interface FileChange {
  path: string;
  type: 'added' | 'removed' | 'modified';
}

interface Notification {
  task_id: string;
  session_id: string;
  parent_session_id: string;
  text: string;
  status: string;
  timestamp: number;
}
```

## API / Interface

### Plugin Exports (unchanged)

The plugin exports remain identical:

```typescript
export default async function GroundworkPlugin(client: Client, directory: string) {
  return {
    config: ...,
    'experimental.chat.messages.transform': ...,
    tool: {
      background_task, background_wait, background_output,
      background_list, background_cancel, background_input,
      background_status, background_stream, handoff_session, read_session
    },
    event: ...,
    'chat.message': ...,
    'experimental.session.compacting': ...
  };
}
```

### New: prompt-resolver.ts

```typescript
export function resolvePromptAppend(promptAppend: string, configDir?: string): string
```

Extracted from oh-my-opencode's `resolvePromptAppend()`. Takes a string that may be a `file://` URI, resolves it to a file path (expanding `~`, resolving relative paths against `configDir`), reads the file, and returns its content. Returns warning strings for malformed URIs, missing files, or read errors.

## Error Handling

All error handling remains identical to the current implementation. The TypeScript refactor is purely structural — no behavioral changes.

For `prompt-resolver.ts`, the error handling matches oh-my-opencode's pattern:
- Malformed file URI → `[WARNING: Malformed file URI...]`
- File not found → `[WARNING: Could not resolve file URI...]`
- Read error → `[WARNING: Could not read file...]`

## Known Limitations

- **BackgroundManager is ~600 LOC** — slightly over the 500 LOC target, but splitting this class would break encapsulation of its tightly-coupled state (tasks Map, notifications, polling, concurrency, timers)
- **No oh-my-opencode removal** — the extraction copies the logic; oh-my-opencode still has its own copy. A future cleanup can remove the duplicate
- **No TypeScript strict mode initially** — will compile with `strict: false` to minimize refactoring noise, can tighten later
- **No new tests** — this refactor is validated by the existing plugin behavior remaining unchanged. TypeScript compilation + manual testing confirms correctness
- **tsdown bundle** — the plugin system expects a single JS file, so we bundle all modules into one output. No code-splitting or lazy loading

## Task Graph

### Task List

| ID | Task | Depends On | Owner / Agent | Files Touched | Est. |
|----|------|-----------|---------------|---------------|------|
| T1 | Set up TypeScript + tsdown infrastructure | — | coder | `package.json`, `tsconfig.json`, `tsdown.config.ts` | 0.25d |
| T2 | Create types.ts with shared interfaces | — | coder | `src/types.ts` | 0.25d |
| T3 | Extract lib/ utility modules (snapshot, skills, helpers, task-formatting, handoff, preamble) | T2 | coder | `src/lib/*.ts` | 0.5d |
| T4 | Extract lib/persistence.ts and lib/concurrency.ts | T2 | coder | `src/lib/persistence.ts`, `src/lib/concurrency.ts` | 0.25d |
| T5 | Extract lib/prompt-resolver.ts from oh-my-opencode | — | coder | `src/lib/prompt-resolver.ts` | 0.1d |
| T6 | Extract tool definitions (tools/*.ts) | T2, T3, T4 | coder | `src/tools/*.ts` | 0.5d |
| T7 | Extract BackgroundManager class | T2, T3, T4 | coder | `src/background-manager.ts` | 0.5d |
| T8 | Create index.ts entry point + wire everything | T3-T7 | coder | `src/index.ts` | 0.5d |
| T9 | Build, verify output matches original, manual test | T8 | coder | `.opencode/plugins/groundwork.js` | 0.5d |

### Dependency Graph

```
T1 ─────────────────────────────────────────┐
T2 ──┬── T3 ──┬── T6 ──┬── T8 ── T9       │
     ├── T4 ──┤        │                    │
     └── T5 ──┴── T7 ──┘                    │
     (T1 must complete before T9)───────────┘
```

### Parallelization Rules

- **Wave 0** (no dependencies): T1, T2, T5 — all independent, run simultaneously
- **Wave 1** (depends on T2): T3, T4 — can run in parallel
- **Wave 2** (depends on T2, T3, T4): T6, T7 — can run in parallel
- **Wave 3** (depends on T3-T7): T8
- **Wave 4** (depends on T8, T1): T9

## Steer Log

### 2026-05-09 — User feature requests during refactor

- **Trigger**: User observation during Wave 1 execution
- **From**: Original scope (pure structural refactor)
- **To**: Original scope unchanged; two features deferred to post-refactor
- **Rationale**: Adding behavioral changes mid-refactor creates merge conflicts with the structural work
- **Affected sections**: Known Limitations (updated below)

#### Deferred Feature 1: Improved timeout workflow
Current `background_wait` timeout max is 3600s (1 hour). For orchestration sanity checks, a shorter default (300s / 5 min) is more practical. The executor should use 300s timeouts and re-check rather than blocking for 10+ minutes.

#### Deferred Feature 2: Multi-task background_wait
`background_wait` should accept `task_id: string[]` (array) and return on **first** task complete/fail. This enables "wait for any" patterns instead of blocking on one task at a time. Implementation: poll all specified task IDs, return the first one that reaches a terminal state.
