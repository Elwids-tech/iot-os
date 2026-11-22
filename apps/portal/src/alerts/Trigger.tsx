import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { WorkflowAlert } from "@iot-os/api-client";
import { EChart, timeSeriesOption, useChartTheme } from "@iot-os/charts";
import { RelativeTime } from "@iot-os/ui/components/freshness";
import { Panel, PanelContent } from "@iot-os/ui/components/panel";
import { Skeleton } from "@iot-os/ui/components/skeleton";
import { formatDateTime, formatNumber } from "@iot-os/ui/lib/format";
import { api } from "../lib/api";
import { devicePath } from "../devices/shared";
import { triggerLimit, triggerSentence } from "./model";

const HOUR = 3_600_000;
/** The chart starts before the alert so the crossing shows: half the episode again, 1 h to 24 h, 30 days in all. */
function chartWindow(alert: WorkflowAlert, now = Date.now()) {
  const activated = Date.parse(alert.activated_at ?? "") || now;
  const to = alert.cleared_at ? Date.parse(alert.cleared_at) + Math.min(HOUR, (now - activated) / 4) : now;
  const lead = Math.min(24 * HOUR, Math.max(HOUR, (to - activated) / 2));
  return { from: Math.max(activated - lead, to - 30 * 24 * HOUR), to: Math.min(to, now), activated };
}

/**
 * What raised an automation alert: a sentence from the execution's definition, and the
 * reading it watches drawn around the episode with the limit across it. The alert keeps no
 * value, so the latest reading is shown as such, not as the value that raised it.
 */
export function TriggerSummary({ org, alert }: { org: string; alert: WorkflowAlert }) {
  const theme = useChartTheme();
  const reading = alert.trigger?.readings[0];
  const sentence = triggerSentence(alert.trigger);
  const limit = triggerLimit(alert.trigger);
  const history = useQuery({
    // One fetch per episode state; an active alert's window moves on with each refetch.
    queryKey: ["alert-trigger-history", org, alert.uuid, alert.cleared_at, reading?.parameter_uuid],
    queryFn: async ({ signal }) => {
      const window = chartWindow(alert);
      const series = await api.deviceHistory(
        org,
        reading!.device_uuid,
        {
          parameter_uuid: reading!.parameter_uuid,
          from: new Date(window.from).toISOString(),
          to: new Date(window.to).toISOString(),
          max_points: 300,
        },
        signal,
      );
      return { window, points: series.flatMap((item) => item.points) };
    },
    enabled: Boolean(reading),
    refetchInterval: alert.cleared_at ? false : 60_000,
  });
  const name = reading?.name ?? "Reading";
  const unit = reading?.unit ?? null;
  const points = useMemo(
    () =>
      (history.data?.points ?? [])
        .map((point) => ({
          time: Date.parse(point.at),
          value: typeof point.value === "number" ? point.value : null,
        }))
        .sort((a, b) => a.time - b.time),
    [history.data],
  );
  const window = history.data?.window;
  const option = useMemo(() => {
    if (!window) return null;
    const days = window.to - window.from > 36 * HOUR;
    return timeSeriesOption(theme, {
      from: window.from,
      to: window.to,
      lines: [{ key: "value", name, color: "var(--series-1)", points }],
      areas: [
        {
          from: window.activated,
          to: alert.cleared_at ? Date.parse(alert.cleared_at) : window.to,
          color: "var(--warning)",
        },
      ],
      thresholds:
        limit === null
          ? undefined
          : [{ value: limit, color: "var(--warning)", label: `Limit ${formatNumber(limit)}${unit ? ` ${unit}` : ""}` }],
      formatTick: (time) =>
        new Date(time).toLocaleString(
          [],
          days
            ? { month: "short", day: "numeric" }
            : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
        ),
      formatTime: (time) => formatDateTime(new Date(time).toISOString()),
      formatValue: (value) => `${formatNumber(value)}${unit ? ` ${unit}` : ""}`,
    });
  }, [theme, window, points, name, unit, limit, alert.cleared_at]);
  if (!sentence && !reading) return null;
  // Not findLast: the image build compiles without the ES2023 library the local toolchain picks up.
  const latest = [...points].reverse().find((point) => point.value !== null);
  const numeric = points.some((point) => point.value !== null);
  return (
    <Panel aria-label="What happened">
      <PanelContent className="flex flex-col gap-3">
        {sentence && <p className="text-heading font-normal">{sentence}</p>}
        {reading &&
          (history.isPending ? (
            <Skeleton className="h-48 w-full" />
          ) : option && numeric ? (
            <EChart
              option={option}
              label={`${name}: ${unit ?? "values"} around this alert${limit === null ? "" : `, with its limit of ${formatNumber(limit)}`}`}
              className="h-48 w-full"
            />
          ) : (
            <p className="text-body text-muted-foreground">
              {history.error
                ? "The readings could not be loaded."
                : "No readings are stored for this time."}
            </p>
          ))}
        {reading && (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body text-muted-foreground">
            {latest && (
              <span>
                {/* A cleared alert's chart ends with the episode, so its last point is not the newest reading. */}
                {alert.cleared_at ? "Last reading shown" : "Latest reading"}{" "}
                <span className="text-foreground tabular-nums">
                  {formatNumber(latest.value!)}
                  {unit ? ` ${unit}` : ""}
                </span>
                , <RelativeTime at={new Date(latest.time).toISOString()} never={null} />
              </span>
            )}
            {alert.trigger && alert.trigger.readings.length > 1 && !alert.trigger.condition && (
              <span>Showing {name}, the first of {alert.trigger.readings.length} readings.</span>
            )}
            <Link
              className="ml-auto underline underline-offset-4 link-target"
              to={devicePath(org, reading.device_uuid)}
            >
              Open the device
            </Link>
          </p>
        )}
      </PanelContent>
    </Panel>
  );
}
