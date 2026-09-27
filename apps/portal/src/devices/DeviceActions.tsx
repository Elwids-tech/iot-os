import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import {
  ApiError,
  type Dashboard,
  type DashboardWidget,
  type DeviceDetail,
  type DeviceInput,
} from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@iot-os/ui/components/alert"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import { FieldGroup } from "@iot-os/ui/components/field"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { api } from "../lib/api"
import { useUnsaved } from "../lib/unsaved"
import {
  EditorSheet,
  RequestError,
  SaveBar,
  TextField,
} from "../components/forms"
import {
  appendLayout,
  appliedParameters,
  COLORS,
  dashboardPath,
  NEUTRAL,
} from "../dashboards/model"
import type { DeviceOperation } from "./DeviceWorkspace"

const savedValues = (d: DeviceDetail): DeviceInput => ({
  name: d.name,
  code: d.code,
  serial_number: d.serial_number ?? "",
  description: d.description ?? "",
})

/** Identity form. Keeps the edit when a newer revision arrives and offers the saved values. */
export function EditDetails({
  org,
  device,
  run,
  busy,
  onClose,
}: {
  org: string
  device: DeviceDetail
  run: DeviceOperation
  busy: boolean
  onClose: () => void
}) {
  const form = useForm<DeviceInput>({ defaultValues: savedValues(device) }),
    [revision, setRevision] = useState(device.draft_revision),
    [error, setError] = useState<unknown>(null)
  const dirty = form.formState.isDirty
  useUnsaved(dirty)
  useEffect(() => {
    if (!dirty) {
      form.reset(savedValues(device))
      setRevision(device.draft_revision)
    }
  }, [device.draft_revision, dirty, form])
  return (
    <EditorSheet
      title="Edit details"
      description="Identity stays the same when its source or profile changes."
      dirty={dirty}
      busy={form.formState.isSubmitting}
      onClose={onClose}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={form.handleSubmit(async (values) => {
          setError(null)
          try {
            const result = await run(() =>
              api.updateDevice(org, device.uuid, {
                ...values,
                draft_revision: revision,
              }),
            )
            form.reset(savedValues(result))
            setRevision(result.draft_revision)
            onClose()
          } catch (reason) {
            setError(reason)
          }
        })}
      >
        <div className="flex-1 overflow-auto p-6">
          <FieldGroup>
            <TextField label="Device name" required {...form.register("name")} />
            <TextField label="Device code" required {...form.register("code")} />
            <TextField label="Serial number" {...form.register("serial_number")} />
            <TextField label="Description" {...form.register("description")} />
            {dirty && device.draft_revision !== revision && (
              <Alert>
                <AlertTitle>Newer saved values are available</AlertTitle>
                <AlertDescription>
                  The saved name is “{device.name}” and code is “{device.code}”.
                  Your form is kept.
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => {
                      form.reset(savedValues(device))
                      setRevision(device.draft_revision)
                    }}
                  >
                    Use saved values
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            <RequestError error={error} />
          </FieldGroup>
        </div>
        <SaveBar
          dirty={dirty}
          busy={busy || form.formState.isSubmitting}
          onCancel={onClose}
          label="Save details"
        />
      </form>
    </EditorSheet>
  )
}

/** Adds a status panel with this device's parameters to a dashboard through the normal revisioned update. */
export function AddToDashboard({
  org,
  device,
  onClose,
}: {
  org: string
  device: DeviceDetail
  onClose: () => void
}) {
  const cache = useQueryClient(),
    navigate = useNavigate()
  const dashboards = useQuery({
    queryKey: ["dashboards", org],
    queryFn: () => api.dashboards(org),
  })
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null)
  const parameters = appliedParameters(device).slice(0, 100)
  const options = (dashboards.data ?? [])
    .filter((d) => d.name.toLowerCase().includes(search.toLowerCase()))
    .map((d) => ({ value: d.uuid, label: d.name }))
  async function add() {
    setBusy(true)
    setError(null)
    try {
      const fresh = await cache.fetchQuery({
        queryKey: ["dashboards", org],
        queryFn: () => api.dashboards(org),
        staleTime: 0,
      })
      const dashboard = fresh.find((d: Dashboard) => d.uuid === selected)
      if (!dashboard) throw new Error("This dashboard no longer exists.")
      const widget: DashboardWidget = {
        id: crypto.randomUUID(),
        schema_version: 2,
        type: "status",
        title: device.name,
        description: "",
        config: {
          sources: parameters.map((parameter, index) => ({
            device_uuid: device.uuid,
            parameter_uuid: parameter.uuid,
            device_name: device.name,
            label: parameter.label,
            unit: parameter.unit,
            data_type: parameter.data_type,
            format: parameter.format,
            display_widget:
              typeof parameter.display?.widget === "string"
                ? parameter.display.widget
                : null,
            precision: null,
            color: COLORS[index % COLORS.length],
            base: { ...NEUTRAL },
            thresholds: [],
          })),
        },
      }
      await api.updateDashboard(org, dashboard.uuid, {
        name: dashboard.name,
        widgets: [...dashboard.widgets, widget],
        layouts: appendLayout(dashboard.layouts, widget.id),
        defaults: dashboard.defaults,
        revision: dashboard.revision,
      })
      void cache.invalidateQueries({ queryKey: ["dashboards", org] })
      void cache.invalidateQueries({ queryKey: ["dashboard", org, dashboard.uuid] })
      toast.success(`Added to ${dashboard.name}`, {
        action: {
          label: "Open",
          onClick: () => navigate(dashboardPath(org, dashboard.uuid)),
        },
      })
      onClose()
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        void cache.invalidateQueries({ queryKey: ["dashboards", org] })
        setError(
          new Error(
            "Someone saved this dashboard while the panel was being added. Nothing was changed. Add it again to use the latest version.",
          ),
        )
      } else setError(reason)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to dashboard</DialogTitle>
          <DialogDescription>
            Adds a status panel with {parameters.length}{" "}
            {parameters.length === 1 ? "parameter" : "parameters"} of{" "}
            {device.name}.
          </DialogDescription>
        </DialogHeader>
        {parameters.length ? (
          <FieldGroup>
            <SearchableSelect
              label="Dashboard"
              value={selected}
              onChange={setSelected}
              search={search}
              onSearchChange={setSearch}
              loading={dashboards.isLoading}
              placeholder="Choose a dashboard"
              emptyText="No dashboards match."
              options={options}
            />
          </FieldGroup>
        ) : (
          <p className="text-sm text-muted-foreground">
            This device has no applied configuration, so there are no
            parameters to show yet.
          </p>
        )}
        {dashboards.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No dashboards yet.{" "}
            <Link className="text-primary underline" to={dashboardPath(org)}>
              Create one
            </Link>
          </p>
        )}
        <RequestError error={error ?? dashboards.error} />
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !selected || !parameters.length}
            onClick={add}
          >
            {busy ? "Adding…" : "Add panel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
