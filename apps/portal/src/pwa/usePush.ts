import { useState, useSyncExternalStore } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "../lib/api"
import { errorMessage } from "../components/forms"
import { subscribeDevice, thisDevice, turnOn } from "./push"

/** Personal push settings (spec 033), shared by My notifications, the bell and the start-up sync. */
export const pushSettingsKey = ["push-settings"] as const

export function usePushSettings(enabled = true) {
  return useQuery({ queryKey: pushSettingsKey, queryFn: () => api.pushSettings(), enabled, staleTime: 60_000 })
}

/** The person signed in here, from the session the app already loaded. */
export function useSignedInUser() {
  return useQuery({ queryKey: ["session"], queryFn: () => api.me(), staleTime: 60_000 }).data
}

/** The device uuid this browser registered for `user`, kept current across tabs. */
export function useThisDevice(user: number | undefined) {
  return useSyncExternalStore(
    subscribeDevice,
    () => (user === undefined ? null : thisDevice(user)),
    () => null,
  )
}

/**
 * **Turn on push on this device**. `run` must be called straight from the click: Safari
 * asks for notification permission only during one, so nothing may wait before it.
 */
export function useTurnOnPush(user: number | undefined) {
  const cache = useQueryClient()
  const [pending, setPending] = useState(false)
  const run = (publicKey: string) => {
    if (user === undefined || pending) return
    setPending(true)
    // Push turned off everywhere stays off: a new device never undoes it (FR-019).
    const before = cache.getQueryData<Awaited<ReturnType<typeof api.pushSettings>>>(pushSettingsKey)
    const offEverywhere = Boolean(before?.levels) && before?.enabled === false
    turnOn(publicKey, user)
      .then((result) => {
        if (result.status === "blocked")
          toast.error("Notifications are blocked", {
            description: "Allow notifications for this site in the browser's or the phone's settings, then try again.",
          })
        else if (result.status === "dismissed") toast("Push stays off", { description: "Notifications weren't allowed." })
        else {
          if (result.device.replaced)
            toast(`${result.device.replaced.label} was removed to make room`, {
              description: "Push works on up to 10 devices; the one unused longest made way for this one.",
            })
          if (offEverywhere)
            toast("This device is ready, but push is off everywhere", {
              description: "Switch on Push notifications under What gets pushed to get alerts here.",
            })
          else if (result.test === "accepted")
            toast.success("Push is on for this device", { description: "Test sent. It arrives in a few seconds." })
          else
            toast.warning("Push is on, but the test didn't get through", {
              description: "Send another test from My notifications in a minute.",
            })
        }
      })
      .catch((error: unknown) => toast.error("Push couldn't be turned on", { description: errorMessage(error) }))
      .finally(() => {
        setPending(false)
        void cache.invalidateQueries({ queryKey: pushSettingsKey })
      })
  }
  return { run, pending }
}
