import { useEffect, useState } from "react"
import { useQueries, type QueryClient } from "@tanstack/react-query"
import type {
  DashboardSource,
  DashboardView,
  DashboardWidget,
  DeviceDetail,
  HistorySeries,
  Measurement,
  StateHistory,
} from "@iot-os/api-client"
import { api } from "../lib/api"
import { resolveRange } from "./model"
import { telemetryRequest } from "./requests"

const unique = (ids: string[]) => [...new Set(ids)]

/** Latest readings per device at the dashboard refresh rate; look up by device id. */
export function useLatest(org: string, deviceIds: string[], refresh: number) {
  const ids = unique(deviceIds)
  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["dashboard-latest", org, id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        telemetryRequest(signal, () => api.deviceLatest(org, id, signal)),
      refetchInterval: refresh ? refresh * 1000 : (false as const),
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: false,
      staleTime: 4000,
    })),
  })
  return (id: string) => queries[ids.indexOf(id)]
}

/** Device details (name, presence, retention, profile precision); look up by device id. */
export function useDevices(
  org: string,
  deviceIds: string[],
  refetchInterval: number | false = false,
) {
  const ids = unique(deviceIds)
  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["dashboard-device", org, id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        telemetryRequest(signal, () => api.device(org, id, signal)),
      staleTime: 30000,
      refetchInterval,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: false,
    })),
  })
  return (id: string) => queries[ids.indexOf(id)]
}

/**
 * Bucketed history per source. Relative ranges resolve at fetch time and the
 * result carries that window, so the chart axis moves with every refresh.
 * `previous` fetches the period just before, for compare ghost lines.
 */
export function useHistory(
  org: string,
  sources: DashboardSource[],
  view: DashboardView,
  window: { from: string; to: string },
  { previous = false, enabled = true } = {},
) {
  const rangeKey = JSON.stringify(view.range)
  return useQueries({
    queries: sources.map((source) => ({
      queryKey: [
        "dashboard-history",
        org,
        source.device_uuid,
        source.parameter_uuid,
        rangeKey,
        previous ? "previous" : "current",
      ],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const range =
          view.range.mode === "relative" ? resolveRange(view.range) : window
        const start = Date.parse(range.from)
        const span = Date.parse(range.to) - start
        const query = previous
          ? { from: new Date(start - span).toISOString(), to: range.from }
          : range
        const series = await telemetryRequest(signal, () =>
          api.deviceHistory(
            org,
            source.device_uuid,
            { parameter_uuid: source.parameter_uuid, ...query, max_points: 500 },
            signal,
          ),
        )
        return { ...range, series }
      },
      enabled,
      staleTime: Infinity,
      gcTime: 30000,
      refetchInterval:
        view.range.mode === "relative" && view.refresh
          ? view.refresh * 1000
          : (false as const),
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: false,
      retry: 1,
    })),
  })
}

/** Alert episodes and recent commands per device, every 30 s; shared by the rail and chart annotations. */
export function useDeviceActivity(org: string, deviceIds: string[]) {
  const ids = unique(deviceIds)
  const options = { refetchInterval: 30000, refetchIntervalInBackground: false, refetchOnWindowFocus: false, staleTime: 25000 }
  const alerts = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["dashboard-alerts", org, id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        telemetryRequest(signal, () =>
          api.alerts(
            org,
            new URLSearchParams({ device: id, per_page: "100" }).toString(),
            signal,
          ),
        ),
      ...options,
    })),
  })
  const commands = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["dashboard-commands", org, id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        telemetryRequest(signal, () => api.deviceCommands(org, id, signal)),
      ...options,
    })),
  })
  return {
    alerts: alerts.flatMap((query, index) =>
      (query.data?.data ?? []).map((alert) => ({ ...alert, device_uuid: alert.device_uuid ?? ids[index] })),
    ),
    commands: commands.flatMap((query, index) =>
      (query.data ?? []).map((command) => ({ ...command, device_uuid: ids[index] })),
    ),
    error: [...alerts, ...commands].find((query) => query.error)?.error,
  }
}

/** A clock for ages ("4 s") that keeps moving while polling is off. */
export function useNow(interval = 5000) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(timer)
  }, [interval])
  return now
}

/**
 * Rows of what a panel has loaded, for Download CSV. Reads the query cache
 * only; nothing is fetched. Empty when the panel has no data loaded.
 */
export function panelCsvRows(
  cache: QueryClient,
  org: string,
  widget: DashboardWidget,
  view: DashboardView,
): unknown[][] {
  const rangeKey = JSON.stringify(view.range)
  const sources = widget.config.sources
  if (widget.type === "timeseries") {
    const rows = sources.flatMap((s) =>
      (
        cache.getQueryData<{ series: HistorySeries[] }>([
          "dashboard-history", org, s.device_uuid, s.parameter_uuid, rangeKey, "current",
        ])?.series ?? []
      ).flatMap((series) =>
        series.points.map((p) => [p.at, s.device_name, s.label, p.value, series.unit, p.min, p.max, p.count]),
      ),
    )
    return rows.length
      ? [["time", "device", "parameter", "average", "unit", "min", "max", "samples"], ...rows]
      : []
  }
  if (widget.type === "state_history" || widget.type === "color_history") {
    const rows = sources.flatMap((s) =>
      (
        cache.getQueryData<StateHistory>([
          "dashboard-state-history", org, s.device_uuid, s.parameter_uuid, rangeKey,
        ])?.timeline ?? []
      ).map((segment) => [segment.from, segment.to, s.device_name, s.label, segment.known ? segment.value : "unknown"]),
    )
    return rows.length ? [["from", "to", "device", "parameter", "value"], ...rows] : []
  }
  if (widget.type === "device_health") {
    const rows = (widget.config.devices ?? []).flatMap((d) => {
      const device = cache.getQueryData<DeviceDetail>(["dashboard-device", org, d.device_uuid])
      return device ? [[device.name, device.presence, device.last_seen_at]] : []
    })
    return rows.length ? [["device", "presence", "last_seen_at"], ...rows] : []
  }
  const rows = sources.flatMap((s) => {
    const reading = cache
      .getQueryData<{ data: Measurement[] }>(["dashboard-latest", org, s.device_uuid])
      ?.data.find((m) => m.parameter_uuid === s.parameter_uuid)
    return reading
      ? [[s.device_name, s.label, reading.value, reading.unit, reading.quality, reading.received_at]]
      : []
  })
  return rows.length
    ? [["device", "parameter", "value", "unit", "quality", "received_at"], ...rows]
    : []
}
