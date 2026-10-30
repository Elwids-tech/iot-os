import { duration, type Resource } from "@iot-os/workflow-editor"

/** The editor's freshness when neither the device nor its profile says more. */
export const DEFAULT_FRESH_SECONDS = 120
const MAX_FRESH_SECONDS = 86400

type Device = Pick<Resource, "poll_interval_seconds"> | undefined
type Parameter = Resource["parameters"][number] | undefined

/**
 * Freshness counts from when a reading was observed, but a polled reading reaches the
 * runtime up to one poll interval later, plus the vendor's own delay. A reading older
 * than its freshness on arrival never counts, so polled bindings need two intervals.
 */
export function minimumFreshSeconds(device: Device): number {
  return Math.min(MAX_FRESH_SECONDS, 2 * (device?.poll_interval_seconds ?? 0))
}

/** A new binding's freshness: two minutes, the profile's stale-after time or two poll intervals, whichever is longest. */
export function suggestedFreshSeconds(device: Device, parameter: Parameter): number {
  const staleAfter = Number(parameter?.reporting?.stale_after_seconds) || 0
  return Math.min(MAX_FRESH_SECONDS, Math.max(DEFAULT_FRESH_SECONDS, staleAfter, minimumFreshSeconds(device)))
}

/** Why a polled device's readings would arrive already stale, if they would. */
export function freshnessWarning(freshSeconds: number, device: Device): string | undefined {
  const interval = device?.poll_interval_seconds
  const minimum = minimumFreshSeconds(device)
  if (!interval || freshSeconds >= minimum) return undefined
  return `This device is polled every ${duration(interval)}, so its readings arrive up to ${duration(interval)} after they were observed. Readings older than the freshness when they arrive are ignored and this automation may never act. Use at least ${duration(minimum)}.`
}

/** What the freshness means for a polled device. */
export function freshnessHint(device: Device): string | undefined {
  const interval = device?.poll_interval_seconds
  return interval ? `Counted from when the reading was observed. This device is polled every ${duration(interval)}.` : undefined
}
