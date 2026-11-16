import { connection } from "@iot-os/api-client"
import { onlineManager } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"
import { apiBaseUrl } from "../lib/api"

/**
 * Starts the connection store for this page (spec 033, research R8) and lets TanStack
 * Query follow it: queries pause while offline and refetch when the API answers again.
 */
export function watchConnection() {
  connection.start({ probeUrl: `${apiBaseUrl.replace(/\/$/, "")}/up` })
  onlineManager.setEventListener((setOnline) => {
    setOnline(connection.getSnapshot().state === "online")
    return connection.subscribe(() => setOnline(connection.getSnapshot().state === "online"))
  })
}

/** Whether the API can be reached, and since when. */
export function useConnection() {
  return useSyncExternalStore(connection.subscribe, connection.getSnapshot)
}
