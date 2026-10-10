import { createContext, useContext, type ReactNode } from "react"
import type { RuntimeStatus } from "@iot-os/api-client"
import { useQuery } from "@tanstack/react-query"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { CloudOffIcon, PauseCircleIcon } from "lucide-react"
import { api } from "../lib/api"
import { formatAge } from "@iot-os/ui/lib/format"

const RuntimeStatusContext = createContext<RuntimeStatus | undefined>(undefined)

/** The shared runtime status, or undefined before the first check. */
export const useRuntimeStatus = () => useContext(RuntimeStatusContext)

/** Polls the runtime once for the whole portal so pages don't each report the same outage. */
export function RuntimeStatusProvider({ org, children }: { org?: string; children: ReactNode }) {
  const status = useQuery({
    queryKey: ["runtime-status", org],
    queryFn: () => api.runtimeStatus(org!),
    enabled: Boolean(org),
    refetchInterval: (query) => (query.state.data?.state === "operational" ? 60000 : 15000),
    retry: false,
  })
  return <RuntimeStatusContext.Provider value={org ? status.data : undefined}>{children}</RuntimeStatusContext.Provider>
}

/** One page-wide explanation of a partial outage, shown above every page. */
export function RuntimeStatusBanner() {
  const status = useRuntimeStatus()
  if (status?.state !== "degraded" && status?.state !== "unavailable") return null
  const paused = status.automations === "paused"
  const [Icon, title, description] =
    status.state === "unavailable"
      ? [CloudOffIcon, "Live device data is unavailable", "Saved devices, dashboards and settings still load. Live values, history and commands return automatically when the device runtime recovers."]
      : status.live_data === "unavailable"
        ? [CloudOffIcon, "Live updates are delayed", "New readings and commands are delayed. Saved data and history still load, and updates resume automatically."]
        : [PauseCircleIcon, "Automations are paused", "Devices, live values, history and commands keep working, but automations aren't evaluating new readings, so they won't raise alerts or send commands. A platform administrator needs to resume automation processing."]
  return (
    <div className="border-b px-4 py-3 md:px-6" role="status">
      <Alert className="border-warning/40 bg-warning/5">
        <Icon />
        <AlertTitle>
          {title}
          {status.since ? <span className="font-normal text-muted-foreground"> · for {formatAge(status.since)}</span> : null}
        </AlertTitle>
        <AlertDescription>
          {description}
          {Icon === CloudOffIcon && paused ? " Automations are paused too." : null}
        </AlertDescription>
      </Alert>
    </div>
  )
}
