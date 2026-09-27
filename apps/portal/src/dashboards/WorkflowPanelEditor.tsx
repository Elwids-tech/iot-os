import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DashboardWidget } from "@iot-os/api-client";
import { SearchableSelect } from "@iot-os/ui/components/searchable-select";
import { api } from "../lib/api";
import { RequestError } from "../components/forms";
import { telemetryRequest } from "./requests";

/** Workflow choice for Location and Alerts panels. */
export function WorkflowPicker({
  org,
  widget,
  onChange,
}: {
  org: string;
  widget: DashboardWidget;
  onChange: (workflowUuid: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const id = widget.config.workflow_uuid;
  const workflows = useQuery({
    queryKey: ["dashboard-workflow-options", org, search, page],
    queryFn: () => api.dashboardWorkflows(org, search, page),
  });
  // The saved workflow may be on another page; its overview (shared with the
  // preview) names it.
  const overview = useQuery({
    queryKey: [
      widget.type === "location"
        ? "dashboard-workflow-location"
        : "dashboard-workflow-alerts",
      org,
      id,
    ],
    queryFn: ({ signal }) =>
      telemetryRequest<{ workflow_name: string }>(signal, () =>
        widget.type === "location"
          ? api.workflowLocationOverview(org, id!, signal)
          : api.workflowAlertOverview(org, id!, signal),
      ),
    enabled: Boolean(id),
    refetchOnWindowFocus: false,
  });
  return (
    <>
      <SearchableSelect
        label="Workflow"
        value={id ?? ""}
        selectedLabel={
          workflows.data?.data.find((w) => w.uuid === id)?.name ??
          overview.data?.workflow_name
        }
        options={(workflows.data?.data ?? []).map((w) => ({
          value: w.uuid,
          label: w.name,
        }))}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        onChange={onChange}
        page={page}
        onPageChange={setPage}
        loading={workflows.isFetching}
        hasNextPage={Boolean(
          workflows.data && page < workflows.data.meta.last_page,
        )}
        help="The panel follows the workflow's applied version."
      />
      <RequestError error={workflows.error} />
    </>
  );
}
