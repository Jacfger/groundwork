import { describe, expect, test, mock } from "bun:test"
import { LoopMonitor } from "../src/lib/loop-monitor.js"

describe("LoopMonitor", () => {
  function createMockClient() {
    return {
      session: {
        prompt: mock(() => Promise.resolve()),
        abort: mock(() => Promise.resolve()),
      },
    }
  }

  function partUpdatedEvent(sessionID: string, partID: string, type: "text" | "reasoning") {
    return {
      type: "message.part.updated",
      properties: {
        sessionID,
        part: {
          id: partID,
          sessionID,
          messageID: "msg-1",
          type,
          text: "",
        },
      },
    }
  }

  function deltaEvent(sessionID: string, partID: string, field: string, delta: string) {
    return {
      type: "message.part.delta",
      properties: {
        sessionID,
        partID,
        messageID: "msg-1",
        field,
        delta,
      },
    }
  }

  test("does nothing when disabled", () => {
    const client = createMockClient()
    const monitor = new LoopMonitor(client, { enabled: false })
    monitor.handleEvent(partUpdatedEvent("s1", "p1", "text"))
    monitor.handleEvent(deltaEvent("s1", "p1", "text", "hello world ".repeat(20)))
    expect(client.session.prompt).not.toHaveBeenCalled()
  })

  test("sends nudge on loop detection", () => {
    const client = createMockClient()
    const monitor = new LoopMonitor(client, {
      enabled: true,
      min_period: 5,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
      max_nudges: 1,
    })
    monitor.handleEvent(partUpdatedEvent("s1", "p1", "text"))
    const block = "hello world! "
    monitor.handleEvent(deltaEvent("s1", "p1", "text", block.repeat(10)))
    expect(client.session.prompt).toHaveBeenCalledTimes(1)
    const call = client.session.prompt.mock.calls[0]
    expect(call[0].body.parts[0].text).toContain("repeating")
    expect(call[0].body.parts[0].synthetic).toBe(true)
  })

  test("aborts on second loop after nudges exhausted", () => {
    const client = createMockClient()
    const monitor = new LoopMonitor(client, {
      enabled: true,
      min_period: 5,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
      max_nudges: 1,
    })
    monitor.handleEvent(partUpdatedEvent("s1", "p1", "text"))
    const block = "hello world! "
    monitor.handleEvent(deltaEvent("s1", "p1", "text", block.repeat(10)))
    expect(client.session.prompt).toHaveBeenCalledTimes(1)
    expect(client.session.abort).toHaveBeenCalledTimes(0)
    monitor.handleEvent(partUpdatedEvent("s1", "p2", "text"))
    monitor.handleEvent(deltaEvent("s1", "p2", "text", block.repeat(10)))
    expect(client.session.abort).toHaveBeenCalledTimes(1)
  })

  test("ignores non-text/non-reasoning field deltas", () => {
    const client = createMockClient()
    const monitor = new LoopMonitor(client, {
      enabled: true,
      min_period: 5,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
    })
    monitor.handleEvent(partUpdatedEvent("s1", "p1", "text"))
    monitor.handleEvent(deltaEvent("s1", "p1", "metadata", "some metadata"))
    expect(client.session.prompt).not.toHaveBeenCalled()
  })

  test("handles reasoning parts", () => {
    const client = createMockClient()
    const monitor = new LoopMonitor(client, {
      enabled: true,
      min_period: 5,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
    })
    monitor.handleEvent(partUpdatedEvent("s1", "p1", "reasoning"))
    const block = "thinking about this... "
    monitor.handleEvent(deltaEvent("s1", "p1", "text", block.repeat(10)))
    expect(client.session.prompt).toHaveBeenCalledTimes(1)
  })

  test("cleans up on session.deleted", () => {
    const client = createMockClient()
    const monitor = new LoopMonitor(client, {
      enabled: true,
      min_period: 5,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
    })
    monitor.handleEvent(partUpdatedEvent("s1", "p1", "text"))
    monitor.handleEvent({
      type: "session.deleted",
      properties: { info: { id: "s1" } },
    })
    monitor.handleEvent(deltaEvent("s1", "p1", "text", "hello world! ".repeat(10)))
    expect(client.session.prompt).not.toHaveBeenCalled()
  })

  test("does not double-nudge within same message", () => {
    const client = createMockClient()
    const monitor = new LoopMonitor(client, {
      enabled: true,
      min_period: 5,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
      max_nudges: 2,
    })
    monitor.handleEvent(partUpdatedEvent("s1", "p1", "text"))
    const block = "hello world! "
    monitor.handleEvent(deltaEvent("s1", "p1", "text", block.repeat(10)))
    monitor.handleEvent(deltaEvent("s1", "p1", "text", block.repeat(10)))
    expect(client.session.prompt).toHaveBeenCalledTimes(1)
  })

  test("uses custom reminder when provided", () => {
    const client = createMockClient()
    const monitor = new LoopMonitor(client, {
      enabled: true,
      min_period: 5,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
      reminder: "Custom: loop at {period} chars!",
    })
    monitor.handleEvent(partUpdatedEvent("s1", "p1", "text"))
    monitor.handleEvent(deltaEvent("s1", "p1", "text", "hello world! ".repeat(10)))
    const call = client.session.prompt.mock.calls[0]
    expect(call[0].body.parts[0].text).toContain("Custom:")
  })
})
