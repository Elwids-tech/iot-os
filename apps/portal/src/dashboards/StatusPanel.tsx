import { useQueries } from "@tanstack/react-query"
import type {
  DashboardView,
  DashboardWidget,
  Measurement,
} from "@iot-os/api-client"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@iot-os/ui/components/empty"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { formatValue } from "../devices/shared"
import { bandFor, NEUTRAL, timeLabel } from "./model"
import { telemetryRequest } from "./requests"

export function StatusPanel({
  org,
  widget,
  view,
  simulation,
}: {
  org: string
  widget: DashboardWidget
  view: DashboardView
  simulation?: { source: string; value: number }
}) {
  const ids = [...new Set(widget.config.sources.map((s) => s.device_uuid))]
  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["dashboard-latest", org, id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        telemetryRequest(signal, () => api.deviceLatest(org, id, signal)),
      refetchInterval: view.refresh ? view.refresh * 1000 : (false as const),
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: false,
      staleTime: 4000,
    })),
  })
  if (!widget.config.sources.length)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No parameters yet</EmptyTitle>
          <EmptyDescription>
            Add device parameters to preview their latest readings.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  return (
    <div
      className="grid items-start gap-3"
      style={{
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 13rem), 1fr))",
      }}
    >
      {widget.config.sources.map((source) => {
        const query = queries[ids.indexOf(source.device_uuid)]
        let measurement = query.data?.data.find(
          (m) => m.parameter_uuid === source.parameter_uuid,
        )
        const simulated =
          simulation?.source ===
          source.device_uuid + ":" + source.parameter_uuid
        if (simulated && Number.isFinite(simulation.value))
          measurement = {
            ...measurement,
            parameter_uuid: source.parameter_uuid,
            key: "simulation",
            label: source.label,
            unit: source.unit,
            data_type: source.data_type,
            value: simulation.value,
            quality: "good",
            received_at: new Date().toISOString(),
            observed_at: new Date().toISOString(),
            historical: false,
          } as Measurement
        const state = query.error
          ? { ...NEUTRAL, label: "Unavailable" }
          : bandFor(source, measurement)
        const retained = Boolean(
          measurement?.last_valid_received_at &&
          measurement.value !== null &&
          measurement.value !== undefined,
        )
        const value =
          measurement &&
          typeof measurement.value === "number" &&
          source.precision !== null
            ? measurement.value.toFixed(source.precision)
            : measurement
              ? formatValue(measurement.value)
              : "—"
        return (
          <section
            key={source.device_uuid + ":" + source.parameter_uuid}
            aria-label={source.label}
            className="flex min-w-0 flex-col gap-2 rounded-lg border bg-background p-4"
            style={{ borderInlineStart: `4px solid ${state.color}` }}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 break-words text-sm font-medium">
                {source.label || measurement?.label || "Parameter"}
              </p>
              <Badge variant="secondary">{state.label}</Badge>
            </div>
            {source.device_name && (
              <p className="truncate text-xs text-muted-foreground">
                {source.device_name}
              </p>
            )}
            {query.isPending && !simulated ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className="break-words font-mono text-2xl tabular-nums">
                {value}
                {measurement?.unit || source.unit ? (
                  <span className="ml-1 text-sm text-muted-foreground">
                    {measurement?.unit ?? source.unit}
                  </span>
                ) : null}
              </p>
            )}
            {query.error && (
              <>
                <RequestError error={query.error} />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => query.refetch()}
                >
                  Retry latest reading
                </Button>
              </>
            )}
            {simulated ? (
              <Badge variant="outline">Simulation · not telemetry</Badge>
            ) : measurement ? (
              <>
                <p className="text-xs text-muted-foreground">
                  {retained ? "Last valid value received: " : "Received: "}
                  {timeLabel(
                    retained
                      ? measurement.last_valid_received_at!
                      : measurement.received_at,
                    view.timezone,
                  )}
                </p>
                {retained && (
                  <p className="text-xs text-muted-foreground">
                    Latest diagnostic received:{" "}
                    {timeLabel(measurement.received_at, view.timezone)}
                  </p>
                )}
                {measurement.diagnostic && (
                  <p className="text-xs text-muted-foreground">
                    {measurement.diagnostic}
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Waiting for a reading
              </p>
            )}
          </section>
        )
      })}
    </div>
  )
}
