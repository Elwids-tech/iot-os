import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import type { ConnectionStyle, ConnectivitySource, DeviceDetail } from "@iot-os/api-client"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { Status } from "@iot-os/ui/components/status-mark"
import { statusOf } from "@iot-os/ui/lib/status"
import { PropertyList } from "@iot-os/ui/templates/entity-page"
import { api } from "../lib/api"
import { connectivityStatus, formatDuration, offlineAfterText, offlineReason } from "./model"
import { Section } from "./shared"

const styles: Record<ConnectionStyle, string> = {
  stays_connected: "Stays connected",
  connects_to_report: "Connects to report",
}
const sources: Record<ConnectivitySource, string> = {
  default: "Platform default",
  automatic: "Automatic: 3 × reporting interval + poll interval, at least 15 min",
  adapter: "Device adapter",
  profile: "Profile",
  device: "This device",
}

/**
 * How offline detection sees the device (spec 018): its state, when it was last heard and
 * observed, how often it reports, and the Offline after in effect with where it came from.
 * Read-only until offline settings arrive.
 */
export function ConnectivitySection({ org, device }: { org: string; device: DeviceDetail }) {
  const connectivity = useQuery({
    queryKey: ["device-connectivity", org, device.uuid, device.state_revision],
    queryFn: ({ signal }) => api.deviceConnectivity(org, device.uuid, signal),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  })
  const data = connectivity.data
  const state = data?.state
  const status = state ? connectivityStatus(state, device.diagnostic) : null
  const alertPath = (uuid: string) =>
    `/organizations/${encodeURIComponent(org)}/alerts/${encodeURIComponent(uuid)}`
  return (
    <Section title="Offline detection" meta={status ? <Status value={status} domain="connectivity" /> : undefined}>
      {connectivity.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : connectivity.error || !data || !state ? (
        <p className="text-sm text-muted-foreground">Offline detection could not be loaded.</p>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          {data.alert && (
            <p>
              <Link className="text-primary underline-offset-4 hover:underline" to={alertPath(data.alert.uuid)}>
                {offlineReason(data.alert)}
              </Link>
              {data.alert.since && (
                <span className="text-muted-foreground">
                  {" "}· since <RelativeTime at={data.alert.since} />
                </span>
              )}
            </p>
          )}
          {state.state === "unknown" && (
            <p className="text-muted-foreground">
              The runtime could not be reached, so the detection state is unknown. The settings below still apply.
            </p>
          )}
          {state.state === "interrupted" && (
            <p className="text-muted-foreground">
              {state.interruption === "adapter"
                ? "Its adapter is not running. Silence while it is down does not count towards going offline."
                : "The platform lost its broker connection. Silence counts again once it reconnects."}
            </p>
          )}
          <PropertyList
            items={[
              { label: "Last heard", value: <RelativeTime at={state.last_heard_at} never="Not since monitoring started" /> },
              ...(state.last_observed_at
                ? [{ label: "Last observed", value: <RelativeTime at={state.last_observed_at} /> }]
                : []),
              {
                label: "Reporting interval",
                value:
                  state.reporting_interval_seconds !== null
                    ? `About ${formatDuration(state.reporting_interval_seconds)}`
                    : <span className="text-muted-foreground">Not known yet</span>,
              },
              {
                label: "Poll interval",
                value:
                  data.effective.poll_interval_seconds !== null
                    ? formatDuration(data.effective.poll_interval_seconds)
                    : <span className="text-muted-foreground">Not polled</span>,
              },
              {
                label: "Offline after",
                value: (
                  <>
                    {offlineAfterText(state, data.effective.offline_after_seconds)}
                    <span className="block text-meta text-muted-foreground">
                      {sources[data.inherited_from.offline_after_seconds] ?? data.inherited_from.offline_after_seconds}
                    </span>
                  </>
                ),
              },
              { label: "Grace period", value: formatDuration(data.effective.grace_seconds) },
              {
                label: "Style",
                value: (
                  <>
                    {styles[data.effective.style] ?? data.effective.style}
                    {data.style_locked && (
                      <span className="block text-meta text-muted-foreground">
                        Locked: a device adapter feeds this device, so only silence counts.
                      </span>
                    )}
                  </>
                ),
              },
              { label: "Severity", value: statusOf(data.effective.severity).label },
            ]}
          />
        </div>
      )}
    </Section>
  )
}
