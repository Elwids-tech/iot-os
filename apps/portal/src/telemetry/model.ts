import type { TelemetrySample } from "@iot-os/api-client"
export function sampleStatus(sample: TelemetrySample) {
  const outcomes = sample.outcomes ?? []
  if (!outcomes.length) return sample.status
  const statuses = outcomes.map((o) => o.status)
  for (const status of [
    "handoff_failed",
    "rejected",
    "storage_retry",
    "discarded",
    "suspended",
    "pending",
  ])
    if (statuses.includes(status)) return status
  return statuses.every((s) => s === "stored") ? "stored" : sample.status
}
export function matchesSample(
  sample: TelemetrySample,
  filter: string,
  kind: string,
) {
  if (kind && sample.kind !== kind) return false
  return (
    !filter ||
    JSON.stringify([
      sample.topic,
      sample.metrics,
      sample.outcomes,
      sample.diagnostic,
    ])
      .toLowerCase()
      .includes(filter.toLowerCase())
  )
}
export function wireHex(base64: string) {
  if (!base64) return "Wire payload unavailable (capture size limit)."
  return Array.from(atob(base64), (c) =>
    c.charCodeAt(0).toString(16).padStart(2, "0"),
  )
    .map((b, i) => b + ((i + 1) % 16 === 0 ? "\n" : " "))
    .join("")
}
