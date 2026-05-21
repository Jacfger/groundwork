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

  test("detects tool loops across multiple messages", () => {
    const client = createMockClient()
    const monitor = new LoopMonitor(client, {
      enabled: true,
      max_tool_repeats: 3,
      max_nudges: 2,
    })

    function toolPartUpdatedEvent(sessionID: string, partID: string, messageID: string, tool: string, input: any) {
      return {
        type: "message.part.updated",
        properties: {
          sessionID,
          part: {
            id: partID,
            sessionID,
            messageID,
            type: "tool",
            tool,
            state: { input },
          },
        },
      }
    }

    function messageUpdatedEvent(sessionID: string, messageID: string) {
      return {
        type: "message.updated",
        properties: {
          sessionID,
          info: { id: messageID },
        },
      }
    }

    // Simulate loop: tool call in msg-1, message update msg-2, tool call in msg-3, message update msg-4, tool call in msg-5
    monitor.handleEvent(toolPartUpdatedEvent("s1", "p1", "msg-1", "test_tool", { query: "hello" }))
    monitor.handleEvent(messageUpdatedEvent("s1", "msg-2"))
    monitor.handleEvent(toolPartUpdatedEvent("s1", "p2", "msg-3", "test_tool", { query: "hello" }))
    monitor.handleEvent(messageUpdatedEvent("s1", "msg-4"))
    monitor.handleEvent(toolPartUpdatedEvent("s1", "p3", "msg-5", "test_tool", { query: "hello" }))

    // With the bug, toolCallHistory gets cleared on each message.updated, so we never reach 3 repeats
    // This assertion should fail with the current buggy code
    expect(client.session.prompt).toHaveBeenCalled()
  })

  test("aborts cross-message tool loop after nudges exhausted", () => {
    const client = createMockClient()
    const monitor = new LoopMonitor(client, {
      enabled: true,
      max_tool_repeats: 3,
      max_nudges: 1,
    })

    function toolPartUpdatedEvent(sessionID: string, partID: string, messageID: string, tool: string, input: any) {
      return {
        type: "message.part.updated",
        properties: {
          sessionID,
          part: {
            id: partID,
            sessionID,
            messageID,
            type: "tool",
            tool,
            state: { input },
          },
        },
      }
    }

    function messageUpdatedEvent(sessionID: string, messageID: string) {
      return {
        type: "message.updated",
        properties: {
          sessionID,
          info: { id: messageID },
        },
      }
    }

    // First loop: 3 identical calls across messages → nudge
    monitor.handleEvent(toolPartUpdatedEvent("s1", "p1", "msg-1", "test_tool", { query: "hello" }))
    monitor.handleEvent(messageUpdatedEvent("s1", "msg-2"))
    monitor.handleEvent(toolPartUpdatedEvent("s1", "p2", "msg-3", "test_tool", { query: "hello" }))
    monitor.handleEvent(messageUpdatedEvent("s1", "msg-4"))
    monitor.handleEvent(toolPartUpdatedEvent("s1", "p3", "msg-5", "test_tool", { query: "hello" }))

    expect(client.session.prompt).toHaveBeenCalledTimes(1)
    expect(client.session.abort).toHaveBeenCalledTimes(0)

    // Second loop: 3 more identical calls across messages → abort (nudges exhausted)
    monitor.handleEvent(messageUpdatedEvent("s1", "msg-6"))
    monitor.handleEvent(toolPartUpdatedEvent("s1", "p4", "msg-7", "test_tool", { query: "hello" }))
    monitor.handleEvent(messageUpdatedEvent("s1", "msg-8"))
    monitor.handleEvent(toolPartUpdatedEvent("s1", "p5", "msg-9", "test_tool", { query: "hello" }))
    monitor.handleEvent(messageUpdatedEvent("s1", "msg-10"))
    monitor.handleEvent(toolPartUpdatedEvent("s1", "p6", "msg-11", "test_tool", { query: "hello" }))

    expect(client.session.prompt).toHaveBeenCalledTimes(1) // no additional nudge
    expect(client.session.abort).toHaveBeenCalledTimes(1)
  })

  test("different tool breaks cross-message loop streak", () => {
    const client = createMockClient()
    const monitor = new LoopMonitor(client, {
      enabled: true,
      max_tool_repeats: 3,
      max_nudges: 2,
    })

    function toolPartUpdatedEvent(sessionID: string, partID: string, messageID: string, tool: string, input: any) {
      return {
        type: "message.part.updated",
        properties: {
          sessionID,
          part: {
            id: partID,
            sessionID,
            messageID,
            type: "tool",
            tool,
            state: { input },
          },
        },
      }
    }

    function messageUpdatedEvent(sessionID: string, messageID: string) {
      return {
        type: "message.updated",
        properties: {
          sessionID,
          info: { id: messageID },
        },
      }
    }

    // Two identical calls, then a different tool, then another identical call
    monitor.handleEvent(toolPartUpdatedEvent("s1", "p1", "msg-1", "test_tool", { query: "hello" }))
    monitor.handleEvent(messageUpdatedEvent("s1", "msg-2"))
    monitor.handleEvent(toolPartUpdatedEvent("s1", "p2", "msg-3", "test_tool", { query: "hello" }))
    monitor.handleEvent(messageUpdatedEvent("s1", "msg-4"))
    monitor.handleEvent(toolPartUpdatedEvent("s1", "p3", "msg-5", "other_tool", { query: "hello" }))
    monitor.handleEvent(messageUpdatedEvent("s1", "msg-6"))
    monitor.handleEvent(toolPartUpdatedEvent("s1", "p4", "msg-7", "test_tool", { query: "hello" }))

    // Streak is broken by other_tool, so no loop detected
    expect(client.session.prompt).not.toHaveBeenCalled()
    expect(client.session.abort).not.toHaveBeenCalled()
  })
})
