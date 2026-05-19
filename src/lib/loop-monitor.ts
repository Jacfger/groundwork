// ─── Loop Monitor ───────────────────────────────────────────────────────────
// Per-session loop detection that hooks into opencode's event system.
// Monitors message.part.delta events to detect repetitive text/reasoning output
// and intervenes with nudges or aborts.

import {
  createLoopDetector,
  recovery,
  isLoopOutcome,
  type LoopOutcome,
  type LoopDetector,
  LOOP_DEFAULTS,
} from './loop-detector.js'

interface SessionLoopState {
  detectors: Map<string, LoopDetector>
  partTypes: Map<string, "text" | "reasoning">
  attempt: number
  lastMessageID: string
}

export interface LoopMonitorOptions {
  enabled?: boolean
  min_period?: number
  max_period?: number
  similarity?: number
  check_interval?: number
  min_chars?: number
  max_nudges?: number
  reminder?: string
}

export class LoopMonitor {
  private sessions = new Map<string, SessionLoopState>()
  private client: any
  private options: LoopMonitorOptions

  constructor(client: any, options: LoopMonitorOptions = {}) {
    this.client = client
    this.options = options
  }

  private getSession(sessionID: string): SessionLoopState {
    let state = this.sessions.get(sessionID)
    if (!state) {
      state = {
        detectors: new Map(),
        partTypes: new Map(),
        attempt: 0,
        lastMessageID: "",
      }
      this.sessions.set(sessionID, state)
    }
    return state
  }

  handleEvent(event: any): void {
    if (this.options.enabled === false) return

    const props = event.properties

    if (event.type === "message.part.updated") {
      this.handlePartUpdated(props)
    }

    if (event.type === "message.part.delta") {
      this.handlePartDelta(props)
    }

    if (event.type === "session.deleted" || event.type === "session.idle") {
      const sessionID = props?.info?.id ?? props?.sessionID
      if (typeof sessionID === "string") {
        this.sessions.delete(sessionID)
      }
    }
  }

  private handlePartUpdated(props: any): void {
    const part = props?.part
    if (!part) return

    const sessionID: string = part.sessionID ?? props?.sessionID
    if (!sessionID) return

    if (part.type === "text" || part.type === "reasoning") {
      const state = this.getSession(sessionID)
      const partID: string = part.id

      if (!state.detectors.has(partID)) {
        const source: "text" | "reasoning" = part.type === "reasoning" ? "reasoning" : "text"
        state.partTypes.set(partID, source)
        state.detectors.set(
          partID,
          createLoopDetector({
            source,
            min_period: this.options.min_period,
            max_period: this.options.max_period,
            similarity: this.options.similarity,
            check_interval: this.options.check_interval,
            min_chars: this.options.min_chars,
          }),
        )
      }

      if (part.messageID && part.messageID !== state.lastMessageID) {
        state.lastMessageID = part.messageID
      }
    }
  }

  private handlePartDelta(props: any): void {
    const sessionID: string = props?.sessionID
    const partID: string = props?.partID
    const field: string = props?.field
    const delta: string = props?.delta

    if (!sessionID || !partID || !delta) return
    if (field !== "text" && field !== "reasoning") return

    const state = this.sessions.get(sessionID)
    if (!state) return

    const detector = state.detectors.get(partID)
    if (!detector) return

    const outcome = detector.feed(delta)
    if (!outcome) return

    state.detectors.delete(partID)
    state.partTypes.delete(partID)

    const decision = recovery(state.attempt, {
      max_nudges: this.options.max_nudges,
      reminder: this.options.reminder,
      period: outcome.period,
    })
    state.attempt++

    if (decision.action === "nudge") {
      void this.client.session.prompt({
        path: { id: sessionID },
        body: {
          noReply: true,
          parts: [{ type: "text", text: decision.reminder, synthetic: true }],
        },
      }).catch((e: any) => {
        console.warn('[groundwork] loop-detection: failed to send nudge', e)
      })
    } else {
      void this.client.session.abort({ path: { id: sessionID } })
        .catch((e: any) => {
          console.warn('[groundwork] loop-detection: failed to abort session', e)
        })
      this.sessions.delete(sessionID)
    }
  }
}
