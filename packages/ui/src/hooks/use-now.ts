import { useSyncExternalStore } from "react"

const TICK_MS = 15_000

let now = Date.now()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined
let refreshing = false

function tick() {
  now = Date.now()
  listeners.forEach((notify) => notify())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Readers that mount between ticks get the time they mounted: one refresh per burst.
  if (!refreshing) {
    refreshing = true
    queueMicrotask(() => {
      refreshing = false
      tick()
    })
  }
  if (timer === undefined) timer = setInterval(tick, TICK_MS)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

/**
 * The time now, refreshed every 15 s from one timer shared by every reader, and when a
 * reader mounts, so relative times and freshness keep ageing on a page left open (spec
 * 029 SC-005).
 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now, () => now)
}
