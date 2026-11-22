import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "../lib/api"
import { safePath } from "./notification"
import { sync } from "./push"
import { pushSettingsKey, useTurnOnPush } from "./usePush"
import { support } from "./push-support"

/**
 * Once per sign-in: brings this browser's push subscription and the API's device back in
 * step (spec 033, T091). A subscription the API no longer knows tells the person, who can
 * turn push on again with one tap. `elsewhere` is how many browsers the person has push
 * on in at other portal addresses (`GET me`).
 */
export function PushSync({ user, elsewhere = 0 }: { user: number; elsewhere?: number }) {
  const cache = useQueryClient()
  const turnOn = useTurnOnPush(user)
  const { run } = turnOn
  useEffect(() => {
    if (support() !== "supported") return
    let key: string | null = null
    const publicKey = () =>
      cache
        .fetchQuery({ queryKey: pushSettingsKey, queryFn: () => api.pushSettings(), staleTime: 60_000 })
        .then((settings) => (key = settings.available ? settings.public_key : null))
    // sync() runs once per sign-in however often this mounts (React runs effects twice in development).
    sync(user, publicKey)
      .then(async (outcome) => {
        if (outcome === "none") return
        if (outcome === "off") {
          // Push belongs to the address it was turned on at (spec 036, FR-032): said once
          // per browser at this address, to someone who has it on at another.
          if (elsewhere < 1 || !firstTimeHere(user)) return
          const here = await publicKey().catch(() => null)
          if (!here) return
          toast("Alerts are not on at this address", {
            description: "Push alerts you turned on at another address do not arrive here.",
            duration: 30_000,
            action: { label: "Turn on alerts", onClick: () => run(here) },
          })
          return
        }
        void cache.invalidateQueries({ queryKey: pushSettingsKey })
        if (outcome === "stopped" && key) {
          const again = key
          toast.warning("Push stopped on this device", {
            description: "Its registration ended, so alerts no longer reach it.",
            duration: 20_000,
            action: { label: "Turn on again", onClick: () => run(again) },
          })
        }
      })
      // Offline or signed out meanwhile: the next start tries again.
      .catch(() => undefined)
    // Once per sign-in, not again when `run` changes.
  }, [user])
  return null
}

/** Kept when signing out (pwa/personal-state.ts): the notice is about this browser at this address. */
export const ELSEWHERE_NOTICE_KEY = "iot-os.push-elsewhere-notice"

/** True the first time this is asked for the person in this browser at this address. */
function firstTimeHere(user: number): boolean {
  try {
    const told = (window.localStorage.getItem(ELSEWHERE_NOTICE_KEY) ?? "").split(",")
    if (told.includes(String(user))) return false
    window.localStorage.setItem(ELSEWHERE_NOTICE_KEY, [...told.filter(Boolean), String(user)].join(","))
    return true
  } catch {
    // Private browsing: say nothing rather than say it on every start.
    return false
  }
}

/**
 * A tapped notification asks the open window to show its page (src/sw.ts). Going through
 * the router keeps the page's state and asks about unsaved edits, where a reload would not.
 */
export function PushNavigation() {
  const navigate = useNavigate()
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    const open = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; path?: unknown } | null
      if (data?.type === "OPEN_PATH") navigate(safePath(data.path))
    }
    navigator.serviceWorker.addEventListener("message", open)
    return () => navigator.serviceWorker.removeEventListener("message", open)
  }, [navigate])
  return null
}
