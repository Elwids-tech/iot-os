import { describe, expect, it } from "vitest"
import type { TelemetrySample } from "@iot-os/api-client"
import { matchesSample, sampleStatus, wireHex } from "./model"
const sample = {
  id: "one",
  kind: "DDATA",
  topic: "spBv1.0/f/DDATA/g/d",
  status: "decoded",
  metrics: [{ name: "temperature", value: 0 }],
  outcomes: [],
} as unknown as TelemetrySample

describe("telemetry evidence", () => {
  it("does not label a decoded message or pending handoff as stored", () => {
    expect(sampleStatus(sample)).toBe("decoded")
    expect(
      sampleStatus({
        ...sample,
        outcomes: [{ status: "pending" }] as TelemetrySample["outcomes"],
      }),
    ).toBe("pending")
    expect(
      sampleStatus({
        ...sample,
        outcomes: [
          { status: "stored" },
          { status: "storage_retry" },
        ] as TelemetrySample["outcomes"],
      }),
    ).toBe("storage_retry")
  })
  it("filters metrics and message types without losing zero values", () => {
    expect(matchesSample(sample, "temperature", "DDATA")).toBe(true)
    expect(matchesSample(sample, "temperature", "DBIRTH")).toBe(false)
    expect(matchesSample(sample, "unknown", "")).toBe(false)
  })
  it("shows actual binary bytes", () => {
    expect(wireHex("AAH/")).toBe("00 01 ff ")
    expect(wireHex("")).toContain("unavailable")
  })
})
