/** Shared by all panels: at most four in-flight dashboard telemetry requests. */
export function createRequestQueue(limit = 4) {
  let active = 0
  const queue: Array<() => void> = []
  return async function run<T>(
    signal: AbortSignal,
    request: () => Promise<T>,
  ): Promise<T> {
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        const index = queue.indexOf(start)
        if (index >= 0) queue.splice(index, 1)
        reject(new DOMException("Aborted", "AbortError"))
      }
      const start = () => {
        signal.removeEventListener("abort", abort)
        active++
        resolve()
      }
      if (signal.aborted) {
        abort()
        return
      }
      if (active < limit) start()
      else {
        queue.push(start)
        signal.addEventListener("abort", abort, { once: true })
      }
    })
    try {
      signal.throwIfAborted()
      return await request()
    } finally {
      active--
      queue.shift()?.()
    }
  }
}
export const telemetryRequest = createRequestQueue()
