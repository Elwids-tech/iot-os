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
 * turn push on again with one tap.
 */
export function PushSync({ user }: { user: number }) {
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
      .then((outcome) => {
        if (outcome === "none") return
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
