import { describe, expect, it } from "vitest"
import { DEFAULT_FRESH_SECONDS, freshnessHint, freshnessWarning, minimumFreshSeconds, suggestedFreshSeconds } from "./freshness"

const parameter = { uuid: "p", key: "temperature", data_type: "number", accepts_command: false, reports_state: true }
const polled = { poll_interval_seconds: 300 }

describe("binding freshness", () => {
  it("keeps the two-minute default for devices that are not polled", () => {
    expect(suggestedFreshSeconds({ poll_interval_seconds: null }, parameter)).toBe(DEFAULT_FRESH_SECONDS)
    expect(suggestedFreshSeconds(undefined, undefined)).toBe(DEFAULT_FRESH_SECONDS)
    expect(freshnessWarning(30, {})).toBeUndefined()
    expect(freshnessHint({})).toBeUndefined()
  })
  it("covers two poll intervals so polled readings are fresh when they arrive", () => {
    expect(minimumFreshSeconds(polled)).toBe(600)
    expect(suggestedFreshSeconds(polled, parameter)).toBe(600)
    expect(suggestedFreshSeconds({ poll_interval_seconds: 60 }, parameter)).toBe(DEFAULT_FRESH_SECONDS)
    expect(suggestedFreshSeconds({ poll_interval_seconds: 86400 }, parameter)).toBe(86400)
  })
  it("uses the profile's stale-after time when it is longer", () => {
    const hourly = { ...parameter, reporting: { stale_after_seconds: 3600 } }
    expect(suggestedFreshSeconds(undefined, hourly)).toBe(3600)
    expect(suggestedFreshSeconds(polled, hourly)).toBe(3600)
    expect(suggestedFreshSeconds(polled, { ...parameter, reporting: null })).toBe(600)
  })
  it("warns when a polled binding's freshness is shorter than two poll intervals", () => {
    expect(freshnessWarning(120, polled)).toBe(
      "This device is polled every 5 min, so its readings arrive up to 5 min after they were observed. Readings older than the freshness when they arrive are ignored and this automation may never act. Use at least 10 min.",
    )
    expect(freshnessWarning(600, polled)).toBeUndefined()
    expect(freshnessHint(polled)).toBe("Counted from when the reading was observed. This device is polled every 5 min.")
  })
})
