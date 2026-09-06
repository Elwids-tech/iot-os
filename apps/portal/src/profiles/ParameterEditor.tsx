import { useEffect, useState } from "react"
import { useForm, type PathValue } from "react-hook-form"
import type { AuthoringParameter, JsonValue } from "@iot-os/api-client"
import {
  FieldGroup,
  Field,
  FieldLabel,
  FieldDescription,
} from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { Checkbox } from "@iot-os/ui/components/checkbox"
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@iot-os/ui/components/tabs"
import { JsonEditor } from "@iot-os/ui/components/json-editor"
import { Separator } from "@iot-os/ui/components/separator"
import {
  Choice,
  TextField,
  EditorSheet,
  SaveBar,
  RequestError,
  fieldError,
} from "../components/forms"
import { useUnsaved } from "../lib/unsaved"
import { api } from "../lib/api"
import { useStudio } from "./use-studio"
import { jsonText, objectValue, updateConfig } from "./authoring"
import { ValidationControls, ParameterPreview } from "./ValidationControls"
import { PresentationOptions } from "./PresentationOptions"
import { ConflictReview } from "./ConflictReview"
export function ParameterEditor({
  parameter,
  onClose,
}: {
  parameter: AuthoringParameter | null
  onClose: () => void
}) {
  const studio = useStudio(),
    { profile } = studio
  const [revision, setRevision] = useState(profile.draft_revision)
  const [tab, setTab] = useState("basics"),
    [error, setError] = useState<unknown>(null)
  const form = useForm({
    defaultValues: {
      key: parameter?.key ?? "",
      label: parameter?.label ?? "",
      description: parameter?.description ?? "",
      kind: parameter?.kind ?? "measurement",
      data_type: parameter?.data_type ?? "number",
      format: parameter?.format ?? "",
      unit: parameter?.unit ?? "",
      parameter_group_uuid: parameter?.parameter_group_uuid ?? "",
      reports_state: parameter?.reports_state ?? true,
      accepts_command: parameter?.accepts_command ?? false,
      sort_order:
        parameter?.sort_order ??
        Math.max(-1, ...profile.parameters.map((item) => item.sort_order)) + 1,
      validation_logic: jsonText(parameter?.validation_logic),
      display_config: jsonText(parameter?.display_config),
      reporting_config: jsonText(parameter?.reporting_config),
      counter_config: jsonText(parameter?.counter_config),
    },
  })
  const values = form.watch(),
    dirty = form.formState.isDirty,
    busy = form.formState.isSubmitting || studio.busy
  const disabled =
    !studio.capabilities.update ||
    profile.status === "archived" ||
    studio.blocked
  useUnsaved(dirty)
  useEffect(() => {
    const name = fieldError(error, "label")
      ? "label"
      : fieldError(error, "key")
        ? "key"
        : null
    if (name) {
      setTab("basics")
      const frame = requestAnimationFrame(() => form.setFocus(name))
      return () => cancelAnimationFrame(frame)
    }
  }, [error, form])
  function set<K extends keyof typeof values>(
    key: K,
    value: (typeof values)[K],
  ) {
    form.setValue(key, value as PathValue<typeof values, K>, {
      shouldDirty: true,
    })
  }
  function configuration(
    key: "display_config" | "reporting_config" | "counter_config",
    field: string,
    value: JsonValue | undefined,
  ) {
    try {
      set(key, updateConfig(values[key], field, value))
    } catch (reason) {
      setError(reason)
      setTab("advanced")
    }
  }
  let display: Record<string, JsonValue> = {},
    reporting: Record<string, JsonValue> = {},
    counter: Record<string, JsonValue> = {}
  try {
    display = objectValue(values.display_config) ?? {}
    reporting = objectValue(values.reporting_config) ?? {}
    counter = objectValue(values.counter_config) ?? {}
  } catch {}
  let previewParameter: Pick<
    AuthoringParameter,
    "data_type" | "format" | "validation_logic"
  > | null = null
  try {
    previewParameter = {
      data_type: values.data_type,
      format: values.format || null,
      validation_logic: objectValue(values.validation_logic),
    }
  } catch {}
  return (
    <EditorSheet
      title={parameter ? "Edit " + parameter.label : "Add parameter"}
      description="Define one parameter at a time. Advanced fields are optional; existing custom fields are preserved."
      dirty={dirty}
      busy={busy}
      onClose={onClose}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={form.handleSubmit(async (input) => {
          setError(null)
          try {
            await studio.perform(() =>
              api.saveProfileParameter(
                studio.org,
                profile.uuid,
                parameter?.uuid ?? null,
                {
                  ...input,
                  description: input.description || null,
                  format: input.format || null,
                  unit: input.unit || null,
                  parameter_group_uuid: input.parameter_group_uuid || null,
                  validation_logic: objectValue(input.validation_logic),
                  display_config: objectValue(input.display_config),
                  reporting_config: objectValue(input.reporting_config),
                  counter_config: objectValue(input.counter_config),
                  draft_revision: revision,
                },
              ),
            )
            onClose()
          } catch (reason) {
            setError(reason)
          }
        })}
      >
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <div className="overflow-x-auto border-b px-6 py-3">
            <TabsList>
              <TabsTrigger value="basics">Basics</TabsTrigger>
              <TabsTrigger value="behavior">Behavior</TabsTrigger>
              <TabsTrigger value="validation">Validation</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            </TabsList>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <TabsContent value="basics">
              <FieldGroup>
                <TextField
                  label="Parameter label"
                  error={fieldError(error, "label")}
                  required
                  disabled={disabled}
                  placeholder="Voltage L1"
                  {...form.register("label")}
                />
                <TextField
                  label="Stable key"
                  error={fieldError(error, "key")}
                  required
                  disabled={disabled}
                  pattern="[a-zA-Z][a-zA-Z0-9._\-]*"
                  help="Unique within this profile, for example voltage.l1."
                  {...form.register("key")}
                />
                <TextField
                  label="Description"
                  disabled={disabled}
                  {...form.register("description")}
                />
                <Choice
                  label="Group"
                  value={values.parameter_group_uuid}
                  disabled={disabled}
                  options={[
                    { value: "", label: "Ungrouped" },
                    ...profile.parameter_groups.map((group) => ({
                      value: group.uuid,
                      label: group.label,
                    })),
                  ]}
                  onChange={(value) => set("parameter_group_uuid", value)}
                />
                <FieldGroup className="grid gap-4 sm:grid-cols-2">
                  <Choice
                    label="Parameter kind"
                    value={values.kind}
                    disabled={disabled}
                    options={[
                      "state",
                      "measurement",
                      "counter",
                      "event",
                      "derived",
                    ].map((value) => ({
                      value,
                      label: value[0].toUpperCase() + value.slice(1),
                    }))}
                    onChange={(value) => {
                      set("kind", value as typeof values.kind)
                      if (value === "derived") set("accepts_command", false)
                    }}
                  />
                  <Choice
                    label="Data type"
                    value={values.data_type}
                    disabled={disabled}
                    options={[
                      "boolean",
                      "integer",
                      "number",
                      "string",
                      "timestamp",
                      "bytes",
                    ].map((value) => ({ value, label: value }))}
                    onChange={(value) =>
                      set("data_type", value as typeof values.data_type)
                    }
                  />
                </FieldGroup>
                <TextField
                  label="Engineering unit"
                  placeholder="V, °C, kWh…"
                  disabled={disabled}
                  {...form.register("unit")}
                />
                <TextField
                  label="Semantic format"
                  placeholder="Optional, e.g. hex_color"
                  disabled={disabled}
                  {...form.register("format")}
                />
                {parameter && (
                  <Field>
                    <FieldLabel htmlFor="parameter-identity">
                      Immutable identity
                    </FieldLabel>
                    <Input
                      id="parameter-identity"
                      readOnly
                      value={parameter.uuid}
                    />
                    <FieldDescription>
                      This UUID is never changed when you edit the parameter.
                    </FieldDescription>
                  </Field>
                )}
              </FieldGroup>
            </TabsContent>
            <TabsContent value="behavior">
              <FieldGroup>
                <Field orientation="horizontal">
                  <Checkbox
                    id="reports-state"
                    checked={values.reports_state}
                    disabled={disabled}
                    onCheckedChange={(value) =>
                      set("reports_state", value === true)
                    }
                  />
                  <FieldLabel htmlFor="reports-state">Reports state</FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <Checkbox
                    id="accepts-command"
                    checked={values.accepts_command}
                    disabled={disabled || values.kind === "derived"}
                    onCheckedChange={(value) =>
                      set("accepts_command", value === true)
                    }
                  />
                  <FieldLabel htmlFor="accepts-command">
                    Accepts commands
                  </FieldLabel>
                </Field>
                <FieldDescription>
                  Derived parameters are always read-only. These settings
                  describe capabilities, not actual device commands.
                </FieldDescription>
                <Separator />
                <Choice
                  label="Presentation hint"
                  disabled={disabled}
                  value={String(display.widget ?? "")}
                  options={[
                    { value: "", label: "Automatic" },
                    ...Array.from(
                      new Set([
                        "number",
                        "switch",
                        "select",
                        "color",
                        "text",
                        ...(typeof display.widget === "string"
                          ? [display.widget]
                          : []),
                      ]),
                    ).map((value) => ({ value, label: value })),
                  ]}
                  onChange={(value) =>
                    configuration(
                      "display_config",
                      "widget",
                      value || undefined,
                    )
                  }
                />
                {display.widget === "select" && (
                  <PresentationOptions
                    options={display.options}
                    type={values.data_type}
                    disabled={disabled}
                    onChange={(options) =>
                      configuration("display_config", "options", options)
                    }
                  />
                )}
                {["number", "integer"].includes(values.data_type) && (
                  <FieldGroup className="grid gap-4 sm:grid-cols-2">
                    <TextField
                      label="Decimal places"
                      type="number"
                      min="0"
                      max="15"
                      disabled={disabled}
                      value={
                        typeof display.precision === "number"
                          ? display.precision
                          : ""
                      }
                      onChange={(event) =>
                        configuration(
                          "display_config",
                          "precision",
                          event.target.value === ""
                            ? undefined
                            : Number(event.target.value),
                        )
                      }
                    />
                    <TextField
                      label="Input step"
                      type="number"
                      min="0.000000001"
                      step="any"
                      disabled={disabled}
                      value={
                        typeof display.step === "number" ? display.step : ""
                      }
                      onChange={(event) =>
                        configuration(
                          "display_config",
                          "step",
                          event.target.value === ""
                            ? undefined
                            : Number(event.target.value),
                        )
                      }
                    />
                  </FieldGroup>
                )}
                <TextField
                  label="Stale after (seconds)"
                  type="number"
                  min="1"
                  disabled={disabled}
                  help="Optional reporting hint, not an active alarm."
                  value={
                    typeof reporting.stale_after_seconds === "number"
                      ? reporting.stale_after_seconds
                      : ""
                  }
                  onChange={(event) =>
                    configuration(
                      "reporting_config",
                      "stale_after_seconds",
                      event.target.value === ""
                        ? undefined
                        : Number(event.target.value),
                    )
                  }
                />
                {values.kind === "counter" && (
                  <>
                    <Separator />
                    <Field orientation="horizontal">
                      <Checkbox
                        id="counter-monotonic"
                        disabled={disabled}
                        checked={counter.monotonic === true}
                        onCheckedChange={(value) =>
                          configuration(
                            "counter_config",
                            "monotonic",
                            value === true,
                          )
                        }
                      />
                      <FieldLabel htmlFor="counter-monotonic">
                        Counter normally increases
                      </FieldLabel>
                    </Field>
                    <TextField
                      label="Reset behavior"
                      disabled={disabled}
                      placeholder="diagnose"
                      value={String(counter.reset_behavior ?? "")}
                      onChange={(event) =>
                        configuration(
                          "counter_config",
                          "reset_behavior",
                          event.target.value || undefined,
                        )
                      }
                    />
                  </>
                )}
              </FieldGroup>
            </TabsContent>
            <TabsContent value="validation">
              <FieldGroup>
                <ValidationControls
                  text={values.validation_logic}
                  onChange={(value) => set("validation_logic", value)}
                  type={values.data_type}
                  disabled={disabled}
                />
                <Separator />
                {previewParameter ? (
                  <ParameterPreview
                    parameter={previewParameter}
                    revision={revision}
                  />
                ) : (
                  <p>Correct the validation JSON before testing a sample.</p>
                )}
              </FieldGroup>
            </TabsContent>
            <TabsContent value="advanced">
              <FieldGroup>
                <FieldDescription>
                  Edit individual configuration objects. Unknown keys survive
                  normal form edits; invalid JSON cannot be saved.
                </FieldDescription>
                {(
                  [
                    "validation_logic",
                    "display_config",
                    "reporting_config",
                    "counter_config",
                  ] as const
                ).map((key) => (
                  <JsonEditor
                    key={key}
                    label={key.replaceAll("_", " ")}
                    value={values[key]}
                    readOnly={disabled}
                    onChange={(value) => set(key, value)}
                  />
                ))}
              </FieldGroup>
            </TabsContent>
            <div className="mt-5 flex flex-col gap-3">
              <RequestError error={error} />
              <ConflictReview
                error={error}
                local={values}
                selectLatest={(fresh) =>
                  fresh.parameters.find(
                    (item) => item.uuid === parameter?.uuid,
                  ) ?? fresh
                }
                onRebase={(freshRevision) => {
                  setRevision(freshRevision)
                  setError(null)
                }}
              />
            </div>
          </div>
        </Tabs>
        <SaveBar
          dirty={dirty}
          busy={busy}
          disabled={disabled}
          onCancel={onClose}
          label={parameter ? "Save parameter" : "Add parameter"}
        />
      </form>
    </EditorSheet>
  )
}
