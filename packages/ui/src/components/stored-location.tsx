import { Badge } from "@iot-os/ui/components/badge";

// Evidence for an explicitly selected event. This contract makes no claim about
// latest device location, applied workflow state, or a geofence condition.
export interface StoredLocationData {
  event_id: string;
  evaluated_at: string;
  observed_at: string | null;
  received_at: string | null;
  historical: boolean;
  status: "valid" | "unknown";
  reason: string;
  point: { latitude: number; longitude: number; accuracy_metres: number | null } | null;
}
export function StoredLocation({ data }: { data: StoredLocationData }) {
  const point = data.status === "valid" ? data.point : null;
  return <section aria-label="Stored location evidence" className="flex flex-col gap-3">
    <Badge variant="outline">{point ? (data.historical ? "Historical coordinates" : "Stored coordinates") : "Unknown location"}</Badge>
    <p className="text-sm">{data.reason.replaceAll("_", " ")}</p>
    {point && <dl className="grid grid-cols-2 gap-2 text-sm">
      <dt>Latitude</dt><dd>{point.latitude.toFixed(6)}</dd>
      <dt>Longitude</dt><dd>{point.longitude.toFixed(6)}</dd>
      <dt>Reported accuracy</dt><dd>{point.accuracy_metres === null ? "Unknown" : `${point.accuracy_metres} m`}</dd>
    </dl>}
    <dl className="grid gap-2 text-xs text-muted-foreground">
      <dt>Observed (UTC)</dt><dd>{data.observed_at ?? "Unknown"}</dd>
      <dt>Received (UTC)</dt><dd>{data.received_at ?? "Unknown"}</dd>
      <dt>Evaluated (UTC)</dt><dd>{data.evaluated_at}</dd>
      <dt>Selected event</dt><dd className="break-all">{data.event_id}</dd>
    </dl>
    <p className="text-sm text-muted-foreground">This selected event does not establish the latest device position or current geofence condition.</p>
  </section>;
}
