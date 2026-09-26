import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DashboardWidget, DashboardView } from "@iot-os/api-client";
import { Button } from "@iot-os/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@iot-os/ui/components/dialog";
import { FieldGroup } from "@iot-os/ui/components/field";
import { SearchableSelect } from "@iot-os/ui/components/searchable-select";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@iot-os/ui/components/card";
import { api } from "../lib/api";
import { Confirm, RequestError, TextField } from "../components/forms";
import { PanelBody, widgetRegistry } from "./registry";
import { widgetError } from "./model";

export function WorkflowPanelEditor({
  initial,
  org,
  view,
  window,
  onApply,
  onClose,
  onDirty,
}: {
  initial: DashboardWidget;
  org: string;
  view: DashboardView;
  window: { from: string; to: string };
  onApply: (widget: DashboardWidget) => void;
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [widget, setWidget] = useState(() => structuredClone(initial));
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [discard, setDiscard] = useState(false);
  const dirty = JSON.stringify(widget) !== JSON.stringify(initial);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const workflows = useQuery({
    queryKey: ["dashboard-workflow-options", org, search, page],
    queryFn: () => api.dashboardWorkflows(org, search, page),
  });
  const close = () => (dirty ? setDiscard(true) : onClose());
  return (
    <>
      <Dialog open onOpenChange={(open) => !open && close()}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Edit {widgetRegistry[widget.type].label} panel
            </DialogTitle>
            <DialogDescription>
              Preview the applied workflow and latest state. Apply to your
              draft, then save the dashboard. The dashboard's historical time
              range does not change these live panels.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <TextField
              label="Panel title"
              required
              maxLength={120}
              value={widget.title}
              onChange={(e) => setWidget({ ...widget, title: e.target.value })}
            />
            <TextField
              label="Panel description"
              maxLength={1000}
              value={widget.description}
              onChange={(e) =>
                setWidget({ ...widget, description: e.target.value })
              }
            />
            <SearchableSelect
              label="Workflow"
              value={widget.config.workflow_uuid ?? ""}
              selectedLabel={
                workflows.data?.data.find(
                  (w) => w.uuid === widget.config.workflow_uuid,
                )?.name
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
              onChange={(workflow_uuid) =>
                setWidget({ ...widget, config: { sources: [], workflow_uuid } })
              }
              page={page}
              onPageChange={setPage}
              loading={workflows.isFetching}
              hasNextPage={Boolean(
                workflows.data && page < workflows.data.meta.last_page,
              )}
              help="The panel follows this workflow's applied version. Draft edits do not change the live view."
            />
          </FieldGroup>
          <RequestError error={workflows.error} />
          <Card>
            <CardHeader>
              <CardTitle>Live preview</CardTitle>
            </CardHeader>
            <CardContent>
              <PanelBody
                preview
                org={org}
                widget={widget}
                view={view}
                window={window}
              />
            </CardContent>
          </Card>
          {widgetError(widget) && (
            <p role="status" className="text-sm text-muted-foreground">
              {widgetError(widget)}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              disabled={Boolean(widgetError(widget))}
              onClick={() => onApply(widget)}
            >
              Apply to dashboard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Confirm
        open={discard}
        title="Discard panel changes?"
        description="The dashboard draft will not be changed."
        action="Discard changes"
        onClose={() => setDiscard(false)}
        onConfirm={onClose}
      />
    </>
  );
}
