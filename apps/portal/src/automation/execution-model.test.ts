import { describe, expect, it } from "vitest"
import { alertStates, bands, changes, dataHealth, formatSpan, stepCards, summarize, type Series, type SeriesNodeResult, type SeriesPoint } from "./execution-model"

const start = Date.parse("2026-11-24T18:00:00Z")
const iso = (minute: number) => new Date(start + minute * 60000).toISOString()
const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16)
const titles = (id: string) => ({ input: "Door", off: "Is it open?", held: "For 30 minutes", alert: "Alert" })[id] ?? id

const nodes: Series["nodes"] = [
  { id: "input", type: "source.parameter.v1", binding: { role: "door", device_uuid: "d", device_name: "Shop sensor", parameter_label: "Sensor input 1", unit: "", data_type: "boolean", fresh_seconds: 600 } },
  { id: "off", type: "branch.v1" },
  { id: "held", type: "sustained.v1", seconds: 1800 },
  { id: "alert", type: "action.alert.v1", title: "Door open for 30 minutes" },
]
const result = (node_id: string, status: string, value?: unknown, extra: Partial<SeriesNodeResult> = {}): SeriesNodeResult =>
  ({ node_id, status, known: value !== undefined, value: value ?? null, reason: value === undefined ? "stale" : "", ...extra })
/** One evaluation of the door automation: the switch value (undefined = stale) and what the alert step said. */
function point(minute: number, door: boolean | undefined, alert: string, trigger = "telemetry"): SeriesPoint {
  const open = door === false
  return {
    id: String(minute), operation_uuid: "op", at: iso(minute), trigger, outcome: alert === "triggered" ? "triggered" : door === undefined ? "waiting" : "evaluated", intents: alert === "triggered" ? 1 : 0, generation: 1,
    nodes: [
      result("input", door === undefined ? "waiting" : "evaluated", door, { observed_at: door === undefined ? null : iso(minute - 6) }),
      result("off", door === undefined ? "waiting" : "evaluated", undefined, { side: door === undefined ? null : open ? "false" : "true", reason: door === undefined ? "stale" : "" }),
      result("held", open ? (alert === "triggered" || alert === "active" ? "matched" : "waiting") : door === undefined ? "waiting" : "not_matched", door === undefined ? undefined : open && (alert === "triggered" || alert === "active")),
      result("alert", alert),
    ],
  }
}
const series = (data: SeriesPoint[], to: number): Series => ({ from: iso(0), to: iso(to), data, nodes })

describe("execution model", () => {
  it("formats spans the way people say them", () => {
    expect([45_000, 18 * 60_000, 60 * 60_000, 95 * 60_000, 50 * 3_600_000].map(formatSpan)).toEqual(["45 s", "18 min", "1 h", "1 h 35 min", "2 d 2 h"])
  })

  it("says how long a duration has been counting and when it is due", () => {
    const counting = series([point(5, true, "not_matched"), point(10, false, "not_matched"), point(15, false, "not_matched")], 28)
    const state = { nodes: { held: { since: iso(10) } } }
    const summary = summarize(counting, state, Date.parse(iso(28)), clock)
    expect(summary).toMatchObject({ tone: "warning", title: "The condition has held for 18 min of 30 min", detail: "The action is due at 18:40 if it continues." })
    expect(summary.progress).toMatchObject({ elapsedMs: 18 * 60000, totalMs: 30 * 60000 })
    const cards = stepCards(counting, state, Date.parse(iso(28)), titles)
    expect(cards.map((card) => card.headline)).toEqual(["Off", "False side", "18 min of 30 min", "Not raised"])
    expect(cards.find((card) => card.deciding)?.id).toBe("held")
    expect(cards[2].fraction).toBeCloseTo(0.6)
  })

  it("keeps counting through a stale reading and says the reading is missing on its card", () => {
    const gap = series([point(10, false, "not_matched"), point(21, undefined, "waiting", "timer")], 22)
    const state = { nodes: { held: { since: iso(10) } } }
    expect(summarize(gap, state, Date.parse(iso(22)), clock).title).toBe("The condition has held for 12 min of 30 min")
    const cards = stepCards(gap, state, Date.parse(iso(22)), titles)
    expect(cards[0]).toMatchObject({ headline: "No fresh reading", deciding: true })
    expect(cards[2].caption).toBe("Counting · waiting for a fresh reading")
  })

  it("reads a raised alert from the trace, where triggered means raised or cleared", () => {
    const data = [point(10, false, "not_matched"), point(41, false, "triggered"), point(45, false, "active"), point(48, undefined, "waiting", "timer"), point(50, false, "active"), point(55, true, "triggered"), point(60, true, "not_matched")]
    expect(alertStates(data, "alert")).toEqual([false, true, true, true, true, false, false])
    const raised = series(data.slice(0, 5), 52)
    expect(summarize(raised, {}, Date.parse(iso(52)), clock)).toMatchObject({ tone: "critical", title: "Alert raised: Door open for 30 minutes", detail: "Raised at 18:41, 11 min ago. It clears when the condition ends." })
    expect(stepCards(raised, {}, Date.parse(iso(52)), titles).at(-1)).toMatchObject({ headline: "Raised", tone: "critical" })
  })

  it("says so when nothing is due or nothing was recorded", () => {
    expect(summarize(series([point(5, true, "not_matched")], 6), {}, Date.parse(iso(6)), clock)).toMatchObject({ tone: "good", title: "Nothing to do right now" })
    expect(summarize(series([], 6), {}, Date.parse(iso(6)), clock).title).toBe("No evaluations in this period")
    expect(summarize(series([point(5, undefined, "waiting", "timer")], 6), {}, Date.parse(iso(6)), clock)).toMatchObject({ title: "Waiting for a fresh reading", detail: "Shop sensor · Sensor input 1: no fresh reading. Nothing is decided until one arrives." })
  })

  it("draws the switch, reading gaps and the alert as bands over the window", () => {
    const data = [point(5, true, "not_matched"), point(10, false, "not_matched"), point(21, undefined, "waiting", "timer"), point(25, false, "not_matched"), point(41, false, "triggered"), point(55, true, "triggered")]
    const rows = bands(series(data, 60), titles)
    expect(rows.map((row) => row.label)).toEqual(["Sensor input 1", "Readings", "Alert"])
    // The gap keeps the last switch state; only the Readings row shows it.
    expect(rows[0].segments.map((s) => [s.label, (s.to - s.from) / 60000])).toEqual([["No evaluations", 5], ["On", 5], ["Off", 45], ["On", 5]])
    expect(rows[1].segments.map((s) => s.label)).toEqual(["No evaluations", "Fresh", "No fresh reading", "Fresh"])
    expect(rows[2].segments.map((s) => [s.label, s.tone, (s.to - s.from) / 60000])).toEqual([["No evaluations", "none", 5], ["Clear", "clear", 36], ["Raised", "raised", 14], ["Clear", "clear", 5]])
  })

  it("lists only what changed, newest first, and folds the rest", () => {
    const data = [point(5, true, "not_matched"), point(10, false, "not_matched"), point(15, false, "not_matched"), point(21, undefined, "waiting", "timer"), point(41, false, "triggered"), point(45, false, "active"), point(55, true, "triggered"), { ...point(60, true, "not_matched"), generation: 2 }]
    const list = changes(series(data, 61), titles)
    expect(list.map((entry) => (entry.kind === "event" ? entry.title : `${entry.points.length} quiet`))).toEqual([
      "Version 2 took over", "Alert cleared", "Sensor input 1 turned on", "1 quiet", "Alert raised", "2 quiet", "Sensor input 1 turned off", "1 quiet",
    ])
    expect(list.find((entry) => entry.kind === "event" && entry.title === "Alert raised")).toMatchObject({ pointId: "41", tone: "critical", detail: "Door open for 30 minutes" })
  })

  it("measures how readings arrive and suggests a freshness that covers the wait", () => {
    const data = [0, 5, 10, 15].map((minute) => point(minute, false, "not_matched"))
    data.splice(2, 0, point(9, undefined, "waiting", "timer"))
    expect(dataHealth(series(data, 16))).toEqual({ reportGapMs: 5 * 60000, ageOnArrivalMs: 6 * 60000, freshMs: 10 * 60000, gaps: 1, suggestedFreshSeconds: 22 * 60 })
    const roomy = series(data, 16)
    roomy.nodes = [{ ...nodes[0], binding: { ...nodes[0].binding!, fresh_seconds: 3600 } }, ...nodes.slice(1)]
    expect(dataHealth(roomy).suggestedFreshSeconds).toBeUndefined()
  })
})
