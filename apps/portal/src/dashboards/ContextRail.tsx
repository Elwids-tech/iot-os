import { RelativeTime } from "@iot-os/ui/components/freshness"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import type { Dashboard, DashboardView, DeviceCommand } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { Status, StatusMark } from "@iot-os/ui/components/status-mark"
import { api } from "../lib/api"
import { errorMessage } from "../components/forms"
import { devicePath, formatValue } from "../devices/shared"
import { appliedParameters } from "./model"
import { useDeviceActivity, useDevices, useNow } from "./panelData"
import { presenceLabel, presenceTone } from "./ReadoutPanels"


/** Devices referenced by panel sources and device health panels. */
export const dashboardDevices = (dashboard: Dashboard) => [
  ...new Set(
    dashboard.widgets.flatMap((w) => [
      ...w.config.sources.map((s) => s.device_uuid),
      ...(w.config.devices ?? []).map((d) => d.device_uuid),
      ...(w.config.location_device_uuids ?? []),
    ]),
  ),
]

/** Active alerts, recent commands and presence for the dashboard's devices. Reads only, except Acknowledge. */
export function ContextRail({
  org,
  dashboard,
  canManage,
  timezone,
}: {
  org: string
  dashboard: Dashboard
  canManage: boolean
  timezone: DashboardView["timezone"]
}) {
  const cache = useQueryClient()
  const now = useNow()
  const ids = dashboardDevices(dashboard)
  const activity = useDeviceActivity(org, ids)
  const devices = useDevices(org, ids, 30000)
  const [acknowledging, setAcknowledging] = useState<string | null>(null)
  const deviceName = (id: string) =>
    devices(id)?.data?.name ??
    dashboard.widgets
      .flatMap((w) => [...w.config.sources, ...(w.config.devices ?? [])])
      .find((s) => s.device_uuid === id)?.device_name ??
    "Device"
  const active = activity.alerts
    .filter((a) => a.condition === "active")
    .sort((a, b) => Date.parse(b.activated_at ?? "") - Date.parse(a.activated_at ?? ""))
  const commands = [...activity.commands]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 5)
  const heading = "skin-label flex items-baseline justify-between text-sm font-medium"
  return (
    <aside
      aria-label="Dashboard context"
      className="flex flex-col divide-y text-sm"
    >
      {activity.error ? (
        <p className="px-4 py-3 text-xs text-destructive">
          {errorMessage(activity.error)}
        </p>
      ) : null}
      <section className="flex flex-col gap-2 px-4 py-3">
        <h2 className={heading}>
          Active alerts
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {active.length}
          </span>
        </h2>
        {active.length ? (
          <ul className="flex flex-col gap-3">
            {active.map((alert) => (
              <li key={alert.uuid} className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2">
                  <StatusMark tone={alert.acknowledged_at ? "warning" : "critical"} className="min-w-0">
                    <Link
                      className="truncate hover:underline"
                      to={`/organizations/${encodeURIComponent(org)}/alerts/${encodeURIComponent(alert.uuid)}`}
                    >
                      {alert.workflow_name} · Episode {alert.episode}
                    </Link>
                  </StatusMark>
                  {alert.activated_at && (
                    <span className="ml-auto shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                      <RelativeTime bare className="font-mono" at={alert.activated_at} now={now} timezone={timezone} />
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-3.5 text-xs text-muted-foreground">
                  <span className="min-w-0 truncate">
                    {alert.acknowledged_at ? "Acknowledged" : "Unacknowledged"} ·{" "}
                    {deviceName(alert.device_uuid)}
                  </span>
                  {canManage && !alert.acknowledged_at && (
                    <Button
                      size="xs"
                      variant="outline"
                      className="ml-auto"
                      disabled={acknowledging === alert.uuid}
                      onClick={async () => {
                        setAcknowledging(alert.uuid)
                        try {
                          await api.acknowledgeAlert(org, alert.uuid)
                          await cache.invalidateQueries({ queryKey: ["dashboard-alerts", org] })
                        } catch (error) {
                          toast.error(errorMessage(error))
                        } finally {
                          setAcknowledging(null)
                        }
                      }}
                    >
                      Acknowledge
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No active alerts</p>
        )}
      </section>
      <section className="flex flex-col gap-2 px-4 py-3">
        <h2 className={heading}>Recent commands</h2>
        {commands.length ? (
          <ul className="flex flex-col gap-3">
            {commands.map((command) => {
              const parameter = appliedParameters(devices(command.device_uuid)?.data).find(
                (p) => p.uuid === command.parameter_uuid,
              )
              return (
                <li key={command.uuid} className="flex flex-col gap-1">
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 truncate">
                      {parameter?.label ?? "Parameter"} →{" "}
                      <span className="font-mono">{formatValue(command.value)}</span>
                    </span>
                    <span className="ml-auto shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                      <RelativeTime bare className="font-mono" at={command.created_at} now={now} timezone={timezone} />
                    </span>
                  </div>
                  <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                    <Status value={command.status} />
                    <span className="truncate">
                      · {command.actor_name} · {deviceName(command.device_uuid)}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No recent commands</p>
        )}
      </section>
      <section className="flex flex-col gap-2 px-4 py-3">
        <h2 className={heading}>
          Devices on this dashboard
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {ids.length}
          </span>
        </h2>
        {ids.length ? (
          <ul className="flex flex-col">
            {ids.map((id) => {
              const device = devices(id)?.data
              return (
                <li key={id} className="flex h-(--row-h) items-center gap-2">
                  <Link className="min-w-0 flex-1 truncate hover:underline" to={devicePath(org, id)}>
                    {deviceName(id)}
                  </Link>
                  <StatusMark tone={presenceTone(device?.presence)} className="text-xs">
                    {presenceLabel(device?.presence)}
                  </StatusMark>
                  <span className="w-12 text-right text-xs text-muted-foreground">
                    {device?.last_seen_at && (
                      <RelativeTime bare className="font-mono" at={device.last_seen_at} now={now} timezone={timezone} />
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No devices yet</p>
        )}
      </section>
    </aside>
  )
}
