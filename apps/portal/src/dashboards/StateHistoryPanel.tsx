import type { ComponentProps } from "react"
import { useQueries } from "@tanstack/react-query"
import type {
  DashboardView,
  DashboardWidget,
  StateHistory,
} from "@iot-os/api-client"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@iot-os/ui/components/empty"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { StateHistoryVisualization } from "../history/StateHistoryVisualization"
import { sourceKey } from "./model"
import { telemetryRequest } from "./requests"

export function HistoryStatePanel({
  org,
  widget,
  view,
  window,
  refreshToken,
  colour = false,
}: {
  org: string
  widget: DashboardWidget
  view: DashboardView
  window: { from: string; to: string }
  refreshToken: number
  colour?: boolean
}) {
  const sources = widget.config.sources
  const histories = useQueries({
    queries: sources.map((source) => ({
      queryKey: [
        "dashboard-state-history",
        org,
        source.device_uuid,
        source.parameter_uuid,
        window.from,
        window.to,
        refreshToken,
      ],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        telemetryRequest(signal, () =>
          api.deviceStateHistory(
            org,
            source.device_uuid,
            {
              parameter_uuid: source.parameter_uuid,
              ...window,
              max_points: 500,
            },
            signal,
          ),
        ),
      staleTime: Infinity,
      gcTime: 30000,
      refetchOnWindowFocus: false,
      retry: 1,
    })),
  })
  const deviceIds = [...new Set(sources.map((source) => source.device_uuid))]
  const devices = useQueries({
    queries: deviceIds.map((id) => ({
      queryKey: ["dashboard-device", org, id],
      queryFn: () => api.device(org, id),
      staleTime: 30000,
      refetchOnWindowFocus: false,
    })),
  })
  if (!sources.length)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No parameters yet</EmptyTitle>
          <EmptyDescription>
            Add compatible parameters to preview their reported history.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  return (
    <div className="flex h-full min-h-64 flex-col gap-5">
      {sources.map((source, index) => {
        const query = histories[index]
        const device = devices[deviceIds.indexOf(source.device_uuid)]?.data
        return (
          <section
            key={sourceKey(source)}
            aria-label={source.label}
            className="flex flex-col gap-3"
          >
            <div>
              <p className="text-sm font-medium">{source.label}</p>
              {source.device_name && (
                <p className="text-xs text-muted-foreground">
                  {source.device_name}
                </p>
              )}
            </div>
            {query.isPending ? (
              <Skeleton className="h-32 w-full" />
            ) : query.error ? (
              <RequestError error={query.error} />
            ) : query.data?.timeline.length ? (
              <StateHistoryVisualization
                history={query.data as StateHistory}
                configurations={device?.configurations ?? []}
                colour={colour}
                timezone={view.timezone}
              />
            ) : (
              <Alert>
                <AlertDescription>
                  No reported values for {source.label} in this range.
                </AlertDescription>
              </Alert>
            )}
          </section>
        )
      })}
    </div>
  )
}

export default function StateHistoryPanel(
  props: ComponentProps<typeof HistoryStatePanel>,
) {
  return <HistoryStatePanel {...props} />
}
