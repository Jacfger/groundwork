import { describe, expect, test } from "bun:test"
import {
  createLoopDetector,
  recovery,
  isLoopOutcome,
  LOOP_DEFAULTS,
  type LoopOutcome,
} from "../src/lib/loop-detector.js"

function repeat(s: string, n: number) {
  return s.repeat(n)
}

function drain(detector: ReturnType<typeof createLoopDetector>, text: string, chunk = 1) {
  let result: LoopOutcome | undefined
  for (let i = 0; i < text.length; i += chunk) {
    const r = detector.feed(text.slice(i, i + chunk))
    if (r) result = r
  }
  return result
}

describe("loop detector", () => {
  test("detects exact repeating block", () => {
    const block = "The quick brown fox jumps over the lazy dog. "
    const detector = createLoopDetector({
      source: "text",
      min_period: 10,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
    })
    const result = drain(detector, repeat(block, 4))
    expect(result).toBeDefined()
    expect(result!.type).toBe("loop")
    expect(result!.source).toBe("text")
  })

  test("detects near-identical block with similarity threshold", () => {
    const a = "The quick brown fox jumps over the lazy dog. "
    const b = "The quick brown fox jumps over the lazy cat. "
    const detector = createLoopDetector({
      source: "text",
      min_period: 10,
      max_period: 200,
      similarity: 0.8,
      check_interval: 1,
      min_chars: 0,
    })
    const result = drain(detector, a + b)
    expect(result).toBeDefined()
    expect(result!.type).toBe("loop")
  })

  test("no detection below min_chars", () => {
    const block = "abc "
    const detector = createLoopDetector({
      source: "text",
      min_period: 2,
      max_period: 20,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 9999,
    })
    const result = drain(detector, repeat(block, 10))
    expect(result).toBeUndefined()
  })

  test("no detection below min_period", () => {
    const block = "ab"
    const detector = createLoopDetector({
      source: "text",
      min_period: 100,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
    })
    const result = drain(detector, repeat(block, 60))
    expect(result).toBeUndefined()
  })

  test("no detection for punctuation/symbol repeats", () => {
    const detector = createLoopDetector({
      source: "text",
      min_period: 3,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
    })
    expect(drain(detector, repeat("---", 40))).toBeUndefined()
  })

  test("no detection for varied content", () => {
    const detector = createLoopDetector({
      source: "text",
      min_period: 10,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
    })
    const varied = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} is unique. `).join("")
    expect(drain(detector, varied)).toBeUndefined()
  })

  test("detects reasoning source", () => {
    const block = "A".repeat(50) + " thinking about the problem. "
    const detector = createLoopDetector({
      source: "reasoning",
      min_period: 10,
      max_period: 2000,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
    })
    const result = drain(detector, repeat(block, 3))
    expect(result).toBeDefined()
    expect(result!.source).toBe("reasoning")
  })

  test("detects Unicode loop", () => {
    const block = "\u4F60\u597D\u4E16\u754C\u3002\u8FD9\u662F\u91CD\u590D\u7684\u5185\u5BB9\u3002"
    const detector = createLoopDetector({
      source: "text",
      min_period: 5,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
    })
    const result = drain(detector, repeat(block, 6))
    expect(result).toBeDefined()
    expect(result!.type).toBe("loop")
  })

  test("reset clears state", () => {
    const block = "repeating content here. "
    const detector = createLoopDetector({
      source: "text",
      min_period: 10,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
    })
    expect(drain(detector, repeat(block, 10))).toBeDefined()
    detector.reset()
    const varied = Array.from({ length: 10 }, (_, i) => `Unique sentence ${i}. `).join("")
    expect(drain(detector, varied)).toBeUndefined()
  })

  test("on_detected callback fires", () => {
    const block = "callback test content. "
    const outcomes: LoopOutcome[] = []
    const detector = createLoopDetector({
      source: "text",
      min_period: 10,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
      on_detected: (o) => outcomes.push(o),
    })
    drain(detector, repeat(block, 10))
    expect(outcomes.length).toBeGreaterThan(0)
    expect(outcomes[0].type).toBe("loop")
  })

  test("whitespace normalization catches varied-whitespace repeats", () => {
    const a = "hello   world   foo   bar   "
    const b = "hello   world   foo   bar   "
    const detector = createLoopDetector({
      source: "text",
      min_period: 10,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
    })
    const result = drain(detector, a + b)
    expect(result).toBeDefined()
  })

  test("buffer wraps around at 2 * max_period", () => {
    const block = "x".repeat(20)
    const detector = createLoopDetector({
      source: "text",
      min_period: 10,
      max_period: 50,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
    })
    const result = drain(detector, repeat(block, 20))
    expect(result).toBeDefined()
  })
})

describe("recovery", () => {
  test("attempt 0 returns nudge", () => {
    const r = recovery(0)
    expect(r.action).toBe("nudge")
    if (r.action === "nudge") {
      expect(typeof r.reminder).toBe("string")
      expect(r.reminder.length).toBeGreaterThan(0)
    }
  })

  test("attempt 1 returns abort (default max_nudges=1)", () => {
    const r = recovery(1)
    expect(r.action).toBe("abort")
    if (r.action === "abort") {
      expect(r.attempts).toBe(2)
    }
  })

  test("attempt 0 returns abort when max_nudges=0", () => {
    const r = recovery(0, { max_nudges: 0 })
    expect(r.action).toBe("abort")
    if (r.action === "abort") {
      expect(r.attempts).toBe(1)
    }
  })

  test("nudge reminder includes period", () => {
    const r = recovery(0, { period: 42 })
    if (r.action === "nudge") {
      expect(r.reminder).toContain("42")
    }
  })

  test("custom reminder template", () => {
    const r = recovery(0, { reminder: "Loop at {period} chars", period: 100 })
    if (r.action === "nudge") {
      expect(r.reminder).toBe("Loop at 100 chars")
    }
  })
})

describe("isLoopOutcome", () => {
  test("returns true for valid outcome", () => {
    expect(isLoopOutcome({ type: "loop", period: 10, source: "text" })).toBe(true)
  })

  test("returns false for non-objects", () => {
    expect(isLoopOutcome(null)).toBe(false)
    expect(isLoopOutcome(undefined)).toBe(false)
    expect(isLoopOutcome("loop")).toBe(false)
    expect(isLoopOutcome(42)).toBe(false)
  })

  test("returns false for wrong type field", () => {
    expect(isLoopOutcome({ type: "other" })).toBe(false)
    expect(isLoopOutcome({})).toBe(false)
  })
})

describe("LOOP_DEFAULTS", () => {
  test("has expected values", () => {
    expect(LOOP_DEFAULTS.min_period).toBeGreaterThan(0)
    expect(LOOP_DEFAULTS.max_period).toBeGreaterThan(LOOP_DEFAULTS.min_period)
    expect(LOOP_DEFAULTS.similarity).toBeGreaterThanOrEqual(0)
    expect(LOOP_DEFAULTS.similarity).toBeLessThanOrEqual(1)
    expect(LOOP_DEFAULTS.check_interval).toBeGreaterThan(0)
    expect(LOOP_DEFAULTS.min_chars).toBeGreaterThan(0)
    expect(LOOP_DEFAULTS.max_nudges).toBeGreaterThanOrEqual(0)
  })
})
