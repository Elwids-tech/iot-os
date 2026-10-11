import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useFieldArray, useForm } from "react-hook-form"
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
import { FieldDescription, FieldError, FieldGroup, FieldLegend, FieldSet } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { Checkbox } from "@iot-os/ui/components/checkbox"
import { RadioGroup, RadioGroupItem } from "@iot-os/ui/components/radio-group"
import { api } from "../lib/api"
import { useUnsaved } from "../lib/unsaved"
import {
  EditorSheet,
  RequestError,
  SaveBar,
  TextField,
  fieldError,
} from "../components/forms"
import {
  appendLayout,
  appliedParameters,
  dashboardPath,
} from "../dashboards/model"
import type { DeviceOperation } from "./DeviceWorkspace"
import { writableParameters } from "../controls/model"
import { PANEL_LABELS } from "../dashboards/model"
import { PANEL_ICONS } from "../dashboards/icons"
import { panelFor, suggestPanels, type Candidate, type PanelType } from "../dashboards/suggest"

type DetailsForm = Omit<DeviceInput, "tags" | "attributes"> & {
  site_uuid: string
  /** Comma-separated in the form, an array in the API. */
  tags: string
  attributes: Array<{ key: string; value: string }>
}

const savedValues = (d: DeviceDetail): DetailsForm => ({
  name: d.name,
  code: d.code,
  serial_number: d.serial_number ?? "",
  description: d.description ?? "",
  site_uuid: d.site?.uuid ?? "",
  tags: (d.tags ?? []).join(", "),
  attributes: Object.entries(d.attributes ?? {}).map(([key, value]) => ({ key, value: value === null ? "" : String(value) })),
})

function deviceInput(values: DetailsForm): DeviceInput {
  return {
    ...values,
    site_uuid: values.site_uuid || null,
    tags: values.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    attributes: Object.fromEntries(
      values.attributes
        .filter((row) => row.key.trim())
        .map((row) => [row.key.trim(), row.value]),
    ),
  }
}

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
  const form = useForm<DetailsForm>({ defaultValues: savedValues(device) }),
    [revision, setRevision] = useState(device.draft_revision),
    [error, setError] = useState<unknown>(null),
    [siteSearch, setSiteSearch] = useState("")
  const attributes = useFieldArray({ control: form.control, name: "attributes" })
  const sites = useQuery({ queryKey: ["sites", org], queryFn: () => api.sites(org) })
  const siteOptions = [
    { value: "", label: "No site (organization time zone)" },
    ...(sites.data?.data ?? [])
      .filter((site) => site.name.toLowerCase().includes(siteSearch.trim().toLowerCase()))
      .map((site) => ({ value: site.uuid, label: `${site.name} · ${site.timezone.replaceAll("_", " ")}` })),
  ]
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
                ...deviceInput(values),
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
            <SearchableSelect
              label="Site"
              value={form.watch("site_uuid")}
              options={siteOptions}
              onChange={(value) => form.setValue("site_uuid", value, { shouldDirty: true })}
              search={siteSearch}
              onSearchChange={setSiteSearch}
              loading={sites.isLoading}
              help={fieldError(error, "site_uuid") ?? "Daily, monthly and shift totals use the site's time zone."}
            />
            <TextField
              label="Tags"
              placeholder="Line 2, Energy"
              help="Separate tags with commas. Use them to filter devices and group dashboards."
              error={fieldError(error, "tags")}
              {...form.register("tags")}
            />
            <FieldSet>
              <FieldLegend variant="label">Attributes</FieldLegend>
              <FieldDescription>
                Facts about this device, such as its line or room. Names use lowercase letters, digits, dots, dashes or underscores.
              </FieldDescription>
              {attributes.fields.map((row, index) => (
                <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
                  <Input aria-label={`Attribute ${index + 1} name`} placeholder="line" className="font-mono" {...form.register(`attributes.${index}.key`)} />
                  <Input aria-label={`Attribute ${index + 1} value`} placeholder="2" {...form.register(`attributes.${index}.value`)} />
                  <Button type="button" variant="ghost" size="sm" onClick={() => attributes.remove(index)}>
                    Remove
                  </Button>
                </div>
              ))}
              <FieldError>{fieldError(error, "attributes")}</FieldError>
              <div>
                <Button type="button" variant="outline" size="sm" disabled={attributes.fields.length >= 30} onClick={() => attributes.append({ key: "", value: "" })}>
                  Add attribute
                </Button>
              </div>
            </FieldSet>
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
  initialParameters = [],
  onClose,
}: {
  org: string
  device: DeviceDetail
  /** Parameters to start with, for example the row the user came from. */
  initialParameters?: string[]
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
    [error, setError] = useState<unknown>(null),
    [chosen, setChosen] = useState<string[]>(initialParameters),
    [type, setType] = useState<PanelType | "">("")
  const parameters = appliedParameters(device).slice(0, 100)
  const writable = new Set(writableParameters(device).map((p) => p.uuid))
  const candidates: Candidate[] = parameters
    .filter((p) => chosen.includes(p.uuid))
    .map((parameter) => ({ device: { uuid: device.uuid, name: device.name }, parameter, writable: writable.has(parameter.uuid) }))
  const suggestions = suggestPanels(candidates).slice(0, 3)
  const panelType = type && suggestions.some((s) => s.type === type) ? type : suggestions[0]?.type
  const options = (dashboards.data ?? [])
    .filter((d) => d.name.toLowerCase().includes(search.toLowerCase()))
    .map((d) => ({ value: d.uuid, label: d.name }))
  async function add() {
    if (!panelType) return
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
      const widget: DashboardWidget = panelFor(panelType, candidates)
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
            Choose what to show from {device.name}. Suggestions use each
            parameter's profile.
          </DialogDescription>
        </DialogHeader>
        {parameters.length ? (
          <FieldGroup>
            <FieldSet>
              <FieldLegend variant="label">Parameters</FieldLegend>
              <ul className="flex max-h-48 flex-col overflow-auto rounded-md border p-1">
                {parameters.map((parameter) => {
                  const id = `add-${parameter.uuid}`
                  return (
                    <li key={parameter.uuid} className="flex items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-accent/60">
                      <Checkbox
                        id={id}
                        checked={chosen.includes(parameter.uuid)}
                        onCheckedChange={(checked) =>
                          setChosen((current) =>
                            checked === true ? [...current, parameter.uuid] : current.filter((uuid) => uuid !== parameter.uuid),
                          )
                        }
                      />
                      <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2">
                        <span className="truncate text-sm">{parameter.label}</span>
                        <span className="truncate font-mono text-xs text-muted-foreground">{parameter.unit ?? parameter.data_type}</span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </FieldSet>
            {suggestions.length > 0 && (
              <FieldSet>
                <FieldLegend variant="label">Show as</FieldLegend>
                <RadioGroup value={panelType} onValueChange={(value) => setType(value as PanelType)}>
                  {suggestions.map((suggestion) => {
                    const Icon = PANEL_ICONS[suggestion.type]
                    const id = `show-as-${suggestion.type}`
                    return (
                      <label key={suggestion.type} htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-md border p-2.5 has-[button[data-state=checked]]:border-primary">
                        <RadioGroupItem id={id} value={suggestion.type} className="mt-0.5" />
                        <Icon className="mt-0.5 size-4 text-muted-foreground" />
                        <span className="flex min-w-0 flex-col">
                          <span className="text-sm font-medium">{PANEL_LABELS[suggestion.type]}</span>
                          <span className="text-xs text-muted-foreground">{suggestion.reason}</span>
                        </span>
                      </label>
                    )
                  })}
                </RadioGroup>
              </FieldSet>
            )}
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
            disabled={busy || !selected || !candidates.length || !panelType}
            onClick={add}
          >
            {busy ? "Adding…" : "Add panel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
