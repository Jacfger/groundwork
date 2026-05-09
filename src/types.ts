// ─── Shared TypeScript Interfaces ──────────────────────────────────────────

/** Status values for a background task */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupt' | 'waiting' | 'error'

/** Progress tracking for a running task */
export interface TaskProgress {
  toolCalls: number
  lastUpdate: Date
  lastTool?: string
  lastToolTime?: Date
}

/** The main task state object stored in BackgroundManager.tasks */
export interface TaskInfo {
  id: string
  sessionID?: string
  parentSessionID: string
  status: TaskStatus
  prompt: string
  agent: string
  description?: string
  depends_on?: string[]
  timeout?: number
  createdAt: Date
  queuedAt?: Date
  startedAt?: Date
  completedAt?: Date
  pollCount: number
  lastPollAt?: Date
  lastActivityAt?: Date
  error?: string
  progress?: TaskProgress
  concurrencyKey?: string
  concurrencyGroup?: string
  beforeSnapshot?: any // DirectorySnapshot from snapshot.ts
  result?: TaskResult
  completion_timer?: ReturnType<typeof setTimeout>
  cleanup_timer?: ReturnType<typeof setTimeout>
}

/** Result returned when a task completes */
export interface TaskResult {
  output?: string
  error?: string
  session: string
  parent_session: string
  duration_ms: number
  artifact_paths?: string[]
}

/** Filesystem snapshot entry (file or directory) */
export interface FileSnapshotEntry {
  path: string
  mtime: number
  size: number
  type: 'file' | 'directory'
  children?: FileSnapshotEntry[]
}

/** A detected change between two snapshots */
export interface FileChange {
  path: string
  type: 'added' | 'removed' | 'modified'
}

/** Pending notification to be injected into a parent session */
export interface Notification {
  task_id: string
  session_id: string
  parent_session_id: string
  text: string
  status: string
  timestamp: number
}

/** Summary kept after a task is cleaned up */
export interface CompletedTaskSummary {
  id: string
  description?: string
  agent?: string
  status: string
  result?: TaskResult
  duration?: string
  error?: string
}

/** Launch input for a new background task */
export interface TaskLaunchInput {
  description?: string
  prompt: string
  agent: string
  parentSessionID: string
  parentMessageID?: string
  parentModel?: { providerID: string; modelID: string }
  parentAgent?: string
  timeout?: number
  depends_on?: string[]
}

/** Persistence metadata stored alongside task results */
export interface TaskPersistMetadata {
  id: string
  description?: string
  agent?: string
  status: string
  parent_session: string
  session: string
  started_at?: string
  queued_at?: string
  completed_at?: string
  duration: string
  timeout?: number
  error: string
  failure_context?: string
  has_failure_context?: string
  tool_calls?: number
  last_tool?: string
}

/** Failure context extracted from a failed task's session */
export interface FailureContext {
  messageCount: number
  error?: string
  contextMessages?: Array<{ role: string; content: string }>
  extractedAt: string
}

/** Tool context passed to tool execute functions */
export interface ToolContext {
  sessionID: string
  messageID: string
  agent?: string
}

/** Message info from session messages */
export interface MessageInfo {
  role: string
  agent?: string
  model?: { providerID: string; modelID: string }
}
