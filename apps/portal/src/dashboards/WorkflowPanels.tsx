import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  LocationOverview,
  AlertOverview,
} from "@iot-os/ui/components/workflow-overview";
import { Button } from "@iot-os/ui/components/button";
import { Skeleton } from "@iot-os/ui/components/skeleton";
import { api } from "../lib/api";
import { RequestError } from "../components/forms";
import type { PanelProps } from "./registry";
import { telemetryRequest } from "./requests";
import { LocationDashboardPanel } from "../geospatial/LocationDashboardPanel";

export function LocationPanel({ org, widget, view }: PanelProps) {
  if (widget.config.location_device_uuids?.length) {
    return <LocationDashboardPanel org={org} widget={widget} view={view} window={{ from: "", to: "" }} />;
  }
  const id = widget.config.workflow_uuid;
  const query = useQuery({
    queryKey: ["dashboard-workflow-location", org, id],
    queryFn: ({ signal }) =>
      telemetryRequest(signal, () =>
        api.workflowLocationOverview(org, id!, signal),
      ),
    enabled: Boolean(id),
    refetchInterval: view.refresh ? view.refresh * 1000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!id)
    return (
      <p className="text-sm text-muted-foreground">
        Choose a workflow to preview its location.
      </p>
    );
  if (query.error)
    return (
      <RequestError error={query.error}>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>
          Retry location
        </Button>
      </RequestError>
    );
  if (query.isPending) return <Skeleton className="h-32 w-full" />;
  // Age from the server's evaluation clock; advancing it locally also expires
  // cached fixes when automatic refresh is paused or the tab is backgrounded.
  const evaluated = Date.parse(query.data.snapshot?.evaluated_at ?? "");
  const now = Number.isFinite(evaluated)
    ? evaluated + Math.max(0, clock - query.dataUpdatedAt)
    : clock;
  return (
    <LocationOverview data={query.data} now={now} timezone={view.timezone} />
  );
}

export function AlertsPanel({ org, widget, view }: PanelProps) {
  const id = widget.config.workflow_uuid;
  const query = useQuery({
    queryKey: ["dashboard-workflow-alerts", org, id],
    queryFn: ({ signal }) =>
      telemetryRequest(signal, () =>
        api.workflowAlertOverview(org, id!, signal),
      ),
    enabled: Boolean(id),
    refetchInterval: view.refresh ? view.refresh * 1000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });
  if (!id)
    return (
      <p className="text-sm text-muted-foreground">
        Choose a workflow to preview its alerts.
      </p>
    );
  if (query.error)
    return (
      <RequestError error={query.error}>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>
          Retry alerts
        </Button>
      </RequestError>
    );
  if (query.isPending) return <Skeleton className="h-32 w-full" />;
  return (
    <AlertOverview
      data={query.data}
      timezone={view.timezone}
      renderEpisode={(episode) => (
        <Link
          className="underline underline-offset-4"
          to={`/organizations/${org}/alerts/${episode.uuid}`}
        >
          Episode {episode.episode}
        </Link>
      )}
    />
  );
}
