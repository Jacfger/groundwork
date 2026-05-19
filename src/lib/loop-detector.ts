// ─── Loop Detector ──────────────────────────────────────────────────────────
// Pure loop-detection algorithm ported from anomalyco/opencode PR #21112.
// Detects repeating blocks in reasoning or text streams.

export type LoopOutcome = {
  type: "loop"
  period: number
  source: "reasoning" | "text"
}

export const LOOP_DEFAULTS = {
  min_period: 10,
  max_period: 2000,
  similarity: 1.0,
  check_interval: 100,
  min_chars: 200,
  max_nudges: 1,
} as const

const REMINDER =
  "<system-reminder>\nYour output is repeating in a loop with period ~{period} characters. Stop repeating and take a different, concrete action.\n</system-reminder>"

const ALPHANUMERIC = /[\p{L}\p{N}]/u

function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

function similarity(first: string, second: string, threshold: number) {
  const length = Math.max(first.length, second.length)
  if (length === 0) return 1.0
  if (Math.abs(first.length - second.length) > (1 - threshold) * length) return 0
  let matches = 0
  const shorter = Math.min(first.length, second.length)
  for (let i = 0; i < shorter; i++) {
    if (first[i] === second[i]) matches++
  }
  return matches / length
}

export function isLoopOutcome(value: unknown): value is LoopOutcome {
  return typeof value === "object" && value !== null && (value as LoopOutcome).type === "loop"
}

export function recovery(
  attempt: number,
  options?: { max_nudges?: number; reminder?: string; period?: number },
): { action: "nudge"; reminder: string } | { action: "abort"; period: number; attempts: number } {
  const nudges = options?.max_nudges ?? LOOP_DEFAULTS.max_nudges
  const period = options?.period ?? 0
  if (attempt < nudges) {
    const template = options?.reminder ?? REMINDER
    return { action: "nudge", reminder: template.replace("{period}", String(period)) }
  }
  return { action: "abort", period, attempts: attempt + 1 }
}

export interface LoopDetectorOptions {
  source: "reasoning" | "text"
  min_period?: number
  max_period?: number
  similarity?: number
  check_interval?: number
  min_chars?: number
  on_detected?: (outcome: LoopOutcome) => void
}

export function createLoopDetector(options: LoopDetectorOptions) {
  const minPeriod = options.min_period ?? LOOP_DEFAULTS.min_period
  const maxPeriod = options.max_period ?? LOOP_DEFAULTS.max_period
  const threshold = options.similarity ?? LOOP_DEFAULTS.similarity
  const interval = options.check_interval ?? LOOP_DEFAULTS.check_interval
  const minChars = options.min_chars ?? LOOP_DEFAULTS.min_chars
  const capacity = 2 * maxPeriod
  const source = options.source

  let buffer = ""
  let total = 0
  let last = 0

  function detect(): LoopOutcome | undefined {
    const length = buffer.length
    if (length < 2 * minPeriod) return undefined

    const upper = Math.min(Math.floor(length / 2), maxPeriod)
    const lower = minPeriod

    for (let period = upper; period >= lower; period--) {
      const tail = length - 1
      const mid = length - 1 - Math.floor(period / 2)
      if (buffer[tail] !== buffer[tail - period]) continue
      if (buffer[mid] !== buffer[mid - period]) continue

      const first = normalize(buffer.slice(length - 2 * period, length - period))
      const second = normalize(buffer.slice(length - period))

      const score = threshold >= 1.0 ? (first === second ? 1.0 : 0) : similarity(first, second, threshold)
      if (score < threshold) continue
      if (!ALPHANUMERIC.test(second)) continue

      const outcome: LoopOutcome = { type: "loop", period, source }
      options.on_detected?.(outcome)
      return outcome
    }

    return undefined
  }

  return {
    feed(delta: string): LoopOutcome | undefined {
      buffer += delta
      total += delta.length
      if (buffer.length > capacity) buffer = buffer.slice(buffer.length - capacity)
      if (total < minChars) return undefined
      if (total - last < interval) return undefined
      last = total
      return detect()
    },

    reset() {
      buffer = ""
      total = 0
      last = 0
    },
  }
}

export type LoopDetector = ReturnType<typeof createLoopDetector>
