import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { useQueryClient } from "@tanstack/react-query"
import type { DeviceDetail, LocationBinding, LocationBindingInput } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { FieldDescription, FieldGroup, FieldLegend, FieldSet } from "@iot-os/ui/components/field"
import { SwitchField } from "@iot-os/ui/components/form-fields"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { EditorSheet, RequestError, SaveBar, TextField } from "../components/forms"
import { appliedParameters } from "../dashboards/model"
import {
  locationBindingInput,
  locationDraft,
  locationProblems,
  numericParameters,
  type LocationDraft,
} from "../devices/model"
import { api } from "../lib/api"
import { useUnsavedContribution } from "../lib/unsaved"

/** The configuration a binding must name: the applied one, else the one the runtime last confirmed. */
export const bindingConfiguration = (device: DeviceDetail) =>
  device.applied_configuration_uuid ?? device.last_applied_configuration_uuid ?? ""

/** Saves a binding and puts it in the shared list, so maps, geofences and the overview see it at once. */
export function useSaveLocationBinding(org: string) {
  const cache = useQueryClient()
  return async (device: string, input: LocationBindingInput) => {
    try {
      const saved = await api.saveLocationBinding(org, device, input)
      cache.setQueryData<{ data: LocationBinding[] }>(["location-bindings", org], (current) =>
        current && { data: [...current.data.filter((b) => b.device_uuid !== device), saved] },
      )
      return saved
    } finally {
      // Also after a conflict (409): the newer binding brings the revision the next save needs.
      void cache.invalidateQueries({ queryKey: ["location-bindings", org] })
    }
  }
}

/** Which applied-profile parameters are the device's position, and how fresh a position must be. */
export function LocationBindingSheet({
  org,
  device,
  binding,
  onSaved,
  onClose,
}: {
  org: string
  device: DeviceDetail
  binding: LocationBinding | undefined
  onSaved?: (binding: LocationBinding) => void
  onClose: () => void
}) {
  const save = useSaveLocationBinding(org)
  const parameters = useMemo(() => appliedParameters(device), [device])
  const configuration = bindingConfiguration(device)
  const form = useForm<LocationDraft>({ defaultValues: locationDraft(binding, parameters) }),
    [revision, setRevision] = useState(binding?.revision ?? 0),
    [error, setError] = useState<unknown>(null)
  const draft = form.watch()
  const problems = locationProblems(draft, parameters)
  const changed = form.formState.isDirty
  // The sheet also opens inside the dashboard editor, whose own unsaved flag must survive it.
  useUnsavedContribution(changed)
  // Someone else saved: follow it unless this form has changes of its own.
  useEffect(() => {
    if (!changed) {
      form.reset(locationDraft(binding, parameters))
      setRevision(binding?.revision ?? 0)
    }
  }, [binding?.revision])
  const options = numericParameters(parameters).map((p) => ({
    value: p.uuid,
    label: `${p.label} · ${p.key}${p.unit ? ` (${p.unit})` : ""}`,
  }))
  const pick = (field: "latitude" | "longitude" | "accuracy") => (value: string) =>
    form.setValue(field, value, { shouldDirty: true })
  return (
    <EditorSheet
      title={binding ? "Edit location" : "Set up location"}
      description={`Which of ${device.name}'s parameters hold its position. Dashboard maps and geofences use it.`}
      dirty={changed}
      busy={form.formState.isSubmitting}
      onClose={onClose}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={form.handleSubmit(async (values) => {
          setError(null)
          try {
            const saved = await save(device.uuid, locationBindingInput(values, configuration, revision))
            form.reset(locationDraft(saved, parameters))
            setRevision(saved.revision)
            onSaved?.(saved)
            onClose()
          } catch (reason) {
            setError(reason)
          }
        })}
      >
        <div className="flex-1 overflow-auto p-6">
          <FieldGroup>
            {binding && binding.configuration_uuid !== configuration && (
              <Alert>
                <AlertTitle>Saved for an earlier configuration</AlertTitle>
                <AlertDescription>Saving points the location at the configuration in use now.</AlertDescription>
              </Alert>
            )}
            <FieldSet>
              <FieldLegend variant="label">Position</FieldLegend>
              <FieldDescription>
                Latitude and longitude must come from the same reading, in degrees.
              </FieldDescription>
              <ParameterSelect label="Latitude" value={draft.latitude} options={options} onChange={pick("latitude")} error={problems.latitude} />
              <ParameterSelect label="Longitude" value={draft.longitude} options={options} onChange={pick("longitude")} error={problems.longitude} />
              <ParameterSelect
                label="Accuracy"
                optional
                value={draft.accuracy}
                options={[{ value: "", label: "No accuracy parameter" }, ...options]}
                onChange={pick("accuracy")}
                help="Radius in metres that the true position is within."
                error={problems.accuracy}
              />
            </FieldSet>
            <FieldSet>
              <FieldLegend variant="label">Freshness</FieldLegend>
              <TextField
                label="Maximum age (seconds)"
                type="number"
                inputMode="numeric"
                min={1}
                max={86_400}
                help="An older position is stale: maps grey it out and geofences ignore it."
                error={problems.max_age_seconds}
                {...form.register("max_age_seconds")}
              />
              <TextField
                label="Allowed clock skew (seconds)"
                type="number"
                inputMode="numeric"
                min={0}
                max={300}
                help="A position timestamped further than this in the future is ignored."
                error={problems.max_future_skew_seconds}
                {...form.register("max_future_skew_seconds")}
              />
              <SwitchField
                label="Accept positions without accuracy"
                description="When off, a position counts only if its accuracy parameter reports a value."
                checked={draft.allow_unknown_accuracy}
                onCheckedChange={(checked) =>
                  form.setValue("allow_unknown_accuracy", checked, { shouldDirty: true })
                }
              />
            </FieldSet>
            {changed && binding && binding.revision !== revision && (
              <Alert>
                <AlertTitle>Newer saved values are available</AlertTitle>
                <AlertDescription>
                  Someone saved this location while you were editing. Your form is kept.
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => {
                      form.reset(locationDraft(binding, parameters))
                      setRevision(binding.revision)
                      setError(null)
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
          dirty={changed}
          suggested={!binding}
          busy={form.formState.isSubmitting}
          disabled={Object.keys(problems).length > 0 || !configuration}
          onCancel={onClose}
          label="Save location"
        />
      </form>
    </EditorSheet>
  )
}

function ParameterSelect({
  label,
  options,
  ...props
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  help?: string
  error?: string
  optional?: boolean
}) {
  const [search, setSearch] = useState("")
  const term = search.trim().toLowerCase()
  return (
    <SearchableSelect
      {...props}
      label={label}
      placeholder="Choose a parameter"
      emptyText="No number parameters match."
      options={options.filter((o) => o.label.toLowerCase().includes(term))}
      search={search}
      onSearchChange={setSearch}
    />
  )
}
