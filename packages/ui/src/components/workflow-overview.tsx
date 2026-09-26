import type { ReactNode } from "react";
import { Badge } from "@iot-os/ui/components/badge";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@iot-os/ui/components/empty";

// Host supplies data, time and optional navigation. No API, router, tenant or
// session singleton is imported here; external applications own their adapter.
export interface LocationOverviewData {
  workflow_name: string;
  deployment_status: string;
  snapshot: null | {
    evaluated_at: string;
    max_age_seconds: number;
    geometry: { coordinates: number[][][] };
    fix: null | {
      event_id: string;
      status: string;
      reason: string;
      observed_at: string | null;
      received_at: string | null;
      historical: boolean;
      point: {
        latitude: number;
        longitude: number;
        accuracy_metres: number | null;
      } | null;
    };
    execution: {
      enabled: boolean;
      stopped_reason: string | null;
      consumer_healthy: boolean;
      state: {
        last_event_id: string;
        condition: string;
        active: boolean;
        expires_at: string | null;
      };
    };
  };
}
export interface AlertOverviewData {
  workflow_name: string;
  active: number;
  unacknowledged_active: number;
  total: number;
  checked_at: string;
  recent: {
    uuid: string;
    episode: number;
    activated_at: string;
    cleared_at: string | null;
    acknowledged_at: string | null;
  }[];
}
const date = (value: string | null, timezone: "browser" | "utc") =>
  value
    ? new Date(value).toLocaleString(
        undefined,
        timezone === "utc" ? { timeZone: "UTC", timeZoneName: "short" } : {},
      )
    : "Unknown";
export function locationPresentation(data: LocationOverviewData, now: number) {
  const snapshot = data.snapshot,
    fix = snapshot?.fix;
  const healthy = Boolean(
    snapshot?.execution.enabled && snapshot.execution.consumer_healthy,
  );
  const observed = Date.parse(fix?.observed_at ?? ""),
    received = Date.parse(fix?.received_at ?? "");
  const expired =
    !snapshot ||
    !Number.isFinite(observed) ||
    !Number.isFinite(received) ||
    now > Math.min(observed, received) + snapshot.max_age_seconds * 1000;
  const validPoint =
    fix?.point &&
    Number.isFinite(fix.point.latitude) &&
    Math.abs(fix.point.latitude) <= 90 &&
    Number.isFinite(fix.point.longitude) &&
    Math.abs(fix.point.longitude) <= 180;
  const usable =
    healthy &&
    validPoint &&
    fix?.status === "valid" &&
    Boolean(fix.point) &&
    (fix.historical || !expired);
  const freshState =
    usable &&
    !fix?.historical &&
    snapshot?.execution.state.last_event_id === fix?.event_id &&
    snapshot?.execution.state.expires_at &&
    Date.parse(snapshot.execution.state.expires_at) >= now;
  return {
    point: usable ? fix!.point : null,
    label: !snapshot
      ? "No applied workflow"
      : !healthy
        ? "Location unavailable"
        : fix?.historical && usable
          ? "Historical location"
          : usable
            ? "Current location"
            : "Unknown location",
    reason: !snapshot
      ? "Activate a location workflow to see its applied view."
      : !healthy
        ? (snapshot.execution.stopped_reason ??
          "Workflow is stopped or its consumer is unavailable.")
        : !fix
          ? "No committed telemetry within retention."
          : fix.status === "valid" && expired && !fix.historical
            ? "The location freshness limit has elapsed."
            : fix.reason.replaceAll("_", " "),
    condition: freshState ? snapshot!.execution.state.condition : "unknown",
  };
}

function GeofenceSketch({
  coordinates,
  point,
}: {
  coordinates: number[][][];
  point: { latitude: number; longitude: number } | null;
}) {
  const ring = coordinates[0] ?? [];
  if (
    ring.length < 4 ||
    ring.length > 10001 ||
    ring.some((p) => p.length !== 2 || p.some((v) => !Number.isFinite(v)))
  )
    return null;
  const latitude = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
  const factor = Math.cos((latitude * Math.PI) / 180);
  const project = (p: number[]) => [p[0] * factor, p[1]];
  const polygon = ring.map(project);
  const marker = point ? project([point.longitude, point.latitude]) : null;
  const all = marker ? [...polygon, marker] : polygon;
  const xs = all.map((p) => p[0]),
    ys = all.map((p) => p[1]);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  const width = Math.max(...xs) - x,
    height = Math.max(...ys) - y;
  const scale = Math.min(
    280 / Math.max(width, 0.000001),
    160 / Math.max(height, 0.000001),
  );
  const draw = (p: number[]) => [
    20 + (280 - width * scale) / 2 + (p[0] - x) * scale,
    20 + (160 - height * scale) / 2 + (y + height - p[1]) * scale,
  ];
  const dot = marker ? draw(marker) : null;
  return (
    <svg
      viewBox="0 0 320 200"
      role="img"
      aria-label={
        point
          ? "Geofence outline and reported location"
          : "Geofence outline; no current location marker"
      }
      className="max-h-48 w-full rounded-md border bg-muted text-primary"
    >
      <polygon
        points={polygon.map((p) => draw(p).join(",")).join(" ")}
        fill="currentColor"
        fillOpacity="0.1"
        stroke="currentColor"
        strokeWidth="2"
      />
      {dot && (
        <circle
          cx={dot[0]}
          cy={dot[1]}
          r="5"
          fill="currentColor"
          stroke="var(--background)"
          strokeWidth="2"
        />
      )}
    </svg>
  );
}

export function LocationOverview({
  data,
  now,
  timezone = "browser",
}: {
  data: LocationOverviewData;
  now: number;
  timezone?: "browser" | "utc";
}) {
  const display = locationPresentation(data, now),
    snapshot = data.snapshot;
  return (
    <section
      aria-label={`${data.workflow_name} location`}
      className="flex min-w-0 flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{data.workflow_name}</span>
        <Badge variant={display.point ? "secondary" : "outline"}>
          {display.label}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Deployment: {data.deployment_status.replaceAll("_", " ")} · Rule
        condition: {display.condition}
      </p>
      {snapshot && (
        <GeofenceSketch
          coordinates={snapshot.geometry.coordinates}
          point={display.point}
        />
      )}
      <p className="text-sm">{display.reason}</p>
      {display.point && (
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt>Latitude</dt>
          <dd>{display.point.latitude.toFixed(6)}</dd>
          <dt>Longitude</dt>
          <dd>{display.point.longitude.toFixed(6)}</dd>
          <dt>Reported accuracy</dt>
          <dd>
            {display.point.accuracy_metres === null
              ? "Unknown"
              : `${display.point.accuracy_metres} m`}
          </dd>
        </dl>
      )}
      {snapshot?.fix && (
        <p className="text-xs text-muted-foreground">
          Observed: {date(snapshot.fix.observed_at, timezone)} · Received:{" "}
          {date(snapshot.fix.received_at, timezone)}
          {snapshot.fix.observed_at &&
          now >= Date.parse(snapshot.fix.observed_at)
            ? ` · Age ${Math.floor((now - Date.parse(snapshot.fix.observed_at)) / 1000)}s`
            : ""}
        </p>
      )}
      {snapshot && (
        <p className="text-xs text-muted-foreground">
          Checked: {date(snapshot.evaluated_at, timezone)} · Geofence outline is
          not a street map.
        </p>
      )}
    </section>
  );
}

export function AlertOverview({
  data,
  timezone = "browser",
  renderEpisode,
}: {
  data: AlertOverviewData;
  timezone?: "browser" | "utc";
  renderEpisode?: (episode: AlertOverviewData["recent"][number]) => ReactNode;
}) {
  return (
    <section
      aria-label={`${data.workflow_name} alerts`}
      className="flex min-w-0 flex-col gap-3"
    >
      <p className="font-medium">{data.workflow_name}</p>
      <div className="flex flex-wrap gap-2">
        <Badge variant={data.active ? "warning" : "secondary"}>
          {data.active} active
        </Badge>
        <Badge variant="outline">
          {data.unacknowledged_active} active, unacknowledged
        </Badge>
        <Badge variant="outline">{data.total} total episodes</Badge>
      </div>
      {data.recent.length ? (
        <ul className="flex flex-col gap-3">
          {data.recent.map((episode) => (
            <li
              key={episode.uuid}
              className="flex flex-wrap items-center gap-2"
            >
              {renderEpisode ? (
                renderEpisode(episode)
              ) : (
                <span>Episode {episode.episode}</span>
              )}
              <Badge variant={episode.cleared_at ? "secondary" : "warning"}>
                {episode.cleared_at ? "Cleared" : "Active"}
              </Badge>
              <span className="text-sm">
                {episode.acknowledged_at ? "Acknowledged" : "Unacknowledged"}
              </span>
              <span className="w-full text-xs text-muted-foreground">
                Activated: {date(episode.activated_at, timezone)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No alert episodes</EmptyTitle>
            <EmptyDescription>
              No recorded episodes for this workflow.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <p className="text-xs text-muted-foreground">
        Latest {data.recent.length} episodes · Checked{" "}
        {date(data.checked_at, timezone)}. Acknowledgement does not clear a
        condition.
      </p>
    </section>
  );
}
