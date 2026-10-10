import { useEffect, useState } from "react"
import { useForm, type PathValue } from "react-hook-form"
import { Link } from "react-router-dom"
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
import { useReturnTo } from "./device-setup"
import {
  jsonText,
  kindLabel,
  objectValue,
  readValidation,
  updateConfig,
} from "./authoring"
import { ValidationControls, ParameterPreview } from "./ValidationControls"
import {
  IncomingConversionFields,
  conversionEligible,
} from "./IncomingConversionFields"
import { ConflictReview } from "./ConflictReview"
import { DisplayFields } from "./DisplayFields"
import { UnitField } from "./UnitField"

type WidgetChoice = { value: string; label: string }

const optionWidgets: WidgetChoice[] = [
  { value: "toggle_group", label: "Choice buttons" },
  { value: "searchable_select", label: "Searchable select" },
]

function controlWidgetChoices(
  type: AuthoringParameter["data_type"],
  current: string,
): WidgetChoice[] {
  const automatic = { value: "", label: "Automatic" }
  const choices: WidgetChoice[] =
    type === "boolean"
      ? [automatic, { value: "switch", label: "Switch" }]
      : type === "enum"
        ? [automatic, ...optionWidgets]
        : type === "string"
          ? [
              automatic,
              { value: "text", label: "Text input" },
              { value: "color", label: "Colour picker" },
              ...optionWidgets,
            ]
          : type === "integer" || type === "number"
            ? [
                automatic,
                { value: "number", label: "Number input" },
                { value: "slider", label: "Slider" },
                ...optionWidgets,
              ]
            : [automatic]

  if (current && !choices.some((choice) => choice.value === current)) {
    choices.push({
      value: current,
      label:
        current === "select"
          ? "Automatic choices (legacy)"
          : `Custom widget (${current})`,
    })
  }
  return choices
}

function widgetHelp(type: AuthoringParameter["data_type"], widget: string) {
  if (["toggle_group", "searchable_select", "select"].includes(widget))
    return "Choices come from Allowed values on the Validation tab."
  if (widget === "slider")
    return "Minimum and maximum come from Number range on the Validation tab."
  if (widget === "color")
    return "Uses a colour picker and sets Display format to hex_color."
  if (!widget && type === "enum")
    return "Uses choice buttons for a short list and a searchable select for a longer list."
  if (!widget && ["timestamp", "bytes"].includes(type))
    return "This data type does not yet have an editable control."
  return "Automatic uses the default component for the selected data type and validation."
}

export function ParameterEditor({
  parameter,
  onClose,
}: {
  parameter: AuthoringParameter | null
  onClose: () => void
}) {
  const studio = useStudio(),
    { profile } = studio
  const { keep } = useReturnTo()
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
      ingress_conversion: parameter?.ingress_conversion ?? null,
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
    if (fieldError(error, "validation_logic")) {
      setTab("validation")
      return
    }
    if (fieldError(error, "display_config")) {
      setTab("behavior")
      return
    }
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
  const currentWidget =
    typeof display.widget === "string" ? display.widget : ""
  const guidedValidation = readValidation(values.validation_logic)
  // Devices, dashboards and history bind to a published parameter's identity.
  const locked = Boolean(parameter?.published)
  const widgetChoices = controlWidgetChoices(values.data_type, currentWidget)
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
      description="Advanced fields are optional. Custom settings are kept."
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
          <div className="overflow-x-auto scrollbar-none border-b px-6 py-3">
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
                  label="Label"
                  error={fieldError(error, "label")}
                  required
                  disabled={disabled}
                  placeholder="Voltage L1"
                  {...form.register("label")}
                />
                <div title="key" className="contents">
                  <TextField
                    label="Key"
                    className="font-mono"
                    error={fieldError(error, "key")}
                    required
                    disabled={disabled || locked}
                    pattern="[a-zA-Z][a-zA-Z0-9._\-]*"
                    help={
                      locked
                        ? "Published parameters keep their key because devices, dashboards and history use it."
                        : "Unique in this profile, for example voltage.l1."
                    }
                    {...form.register("key")}
                  />
                </div>
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
                  <div title="kind" className="contents">
                    <Choice
                      label="Kind"
                      value={values.kind}
                      disabled={disabled || locked}
                      options={[
                        "state",
                        "measurement",
                        "counter",
                        "event",
                        "derived",
                      ].map((value) => ({ value, label: kindLabel(value) }))}
                      onChange={(value) => {
                        set("kind", value as typeof values.kind)
                        if (value === "derived") set("accepts_command", false)
                      }}
                    />
                  </div>
                  <div title="data_type" className="contents">
                    <Choice
                      label="Data type"
                      value={values.data_type}
                      disabled={disabled || locked}
                      options={[
                        "boolean",
                        "integer",
                        "number",
                        "enum",
                        "string",
                        "timestamp",
                        "bytes",
                      ].map((value) => ({ value, label: value }))}
                      onChange={(value) => {
                        const type = value as typeof values.data_type
                        set("data_type", type)
                        if (
                          currentWidget &&
                          !controlWidgetChoices(type, "").some(
                            (choice) => choice.value === currentWidget,
                          )
                        )
                          configuration("display_config", "widget", undefined)
                        if (type !== "string" && values.format === "hex_color")
                          set("format", "")
                      }}
                    />
                  </div>
                </FieldGroup>
                {locked && (
                  <FieldDescription>
                    Published: kind and data type are fixed. Add a new
                    parameter to change them.
                  </FieldDescription>
                )}
                {values.kind === "derived" && (
                  <FieldDescription>
                    Set its formula in{" "}
                    <Link
                      to={keep(
                        "/organizations/" +
                        studio.org +
                        "/device-profiles/" +
                        profile.uuid +
                        "/calculations"
                      )}
                    >
                      Calculations
                    </Link>
                    .
                  </FieldDescription>
                )}
                <div title="unit" className="contents">
                  <UnitField
                    value={values.unit ?? ""}
                    onChange={(unit) => set("unit", unit)}
                    disabled={disabled}
                    locked={locked}
                    error={fieldError(error, "unit")}
                  />
                </div>
                {(conversionEligible(values) || values.ingress_conversion) && (
                  <IncomingConversionFields
                    value={values.ingress_conversion}
                    onChange={(value) => set("ingress_conversion", value)}
                    storedUnit={values.unit}
                    dataType={values.data_type}
                    eligible={conversionEligible(values)}
                    disabled={disabled}
                    onPreset={() => set("unit", "kW")}
                    onValidate={
                      studio.capabilities.validate
                        ? (sample) =>
                            api.previewDeviceProfile(studio.org, profile.uuid, {
                              kind: "conversion",
                              draft_revision: revision,
                              parameter: {
                                ...previewParameter!,
                                kind: values.kind,
                                reports_state: values.reports_state,
                                accepts_command: values.accepts_command,
                                counter_config: counter,
                                ingress_conversion: values.ingress_conversion,
                              },
                              value: sample,
                            })
                        : undefined
                    }
                  />
                )}
                <div title="format" className="contents">
                  <TextField
                    label="Display format"
                    placeholder="Optional"
                    disabled={disabled}
                    {...form.register("format")}
                  />
                </div>
                {parameter && (
                  <Field title="uuid">
                    <FieldLabel htmlFor="parameter-identity">
                      Parameter ID
                    </FieldLabel>
                    <Input
                      id="parameter-identity"
                      className="font-mono"
                      readOnly
                      value={parameter.uuid}
                    />
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
                {values.kind === "derived" && (
                  <FieldDescription>Derived parameters are read-only.</FieldDescription>
                )}
                <Separator />
                <div title="display_config.widget" className="contents">
                  <Choice
                    label="Control"
                    disabled={disabled}
                    value={currentWidget}
                    options={widgetChoices}
                    help={widgetHelp(values.data_type, currentWidget)}
                    onChange={(value) => {
                      configuration(
                        "display_config",
                        "widget",
                        value || undefined,
                      )
                      if (value === "color" && values.format !== "hex_color")
                        set("format", "hex_color")
                    }}
                  />
                </div>
                {["toggle_group", "searchable_select", "select"].includes(
                  currentWidget,
                ) && guidedValidation.mode !== "options" && (
                  <FieldDescription>
                    Add Allowed values on the Validation tab before this
                    control can be used.
                  </FieldDescription>
                )}
                {currentWidget === "slider" &&
                  guidedValidation.mode !== "range" && (
                    <FieldDescription>
                      Add a minimum and maximum with Number range on the
                      Validation tab before this slider can be used.
                    </FieldDescription>
                  )}
                {values.data_type === "enum" &&
                  guidedValidation.mode !== "options" && (
                    <FieldDescription>
                      Enum parameters require at least one unique string under
                      Allowed values on the Validation tab.
                    </FieldDescription>
                  )}
                {["number", "integer"].includes(values.data_type) && (
                  <FieldGroup className="grid gap-4 sm:grid-cols-2">
                    <TextField
                      title="display_config.precision"
                      label="Decimals"
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
                      title="display_config.step"
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
                <DisplayFields
                  dataType={values.data_type}
                  kind={values.kind}
                  display={display}
                  allowedValues={
                    guidedValidation.mode === "options"
                      ? guidedValidation.options
                      : []
                  }
                  disabled={disabled}
                  onChange={(field, value) =>
                    configuration("display_config", field, value)
                  }
                />
                <Separator />
                <TextField
                  title="reporting_config.stale_after_seconds"
                  label="Stale after (seconds)"
                  type="number"
                  min="1"
                  disabled={disabled}
                  help="Reporting hint, not an alarm."
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
                    <Field orientation="horizontal" title="counter_config.monotonic">
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
                    <div title="counter_config.reset_behavior" className="contents">
                      <Choice
                        label="When the counter goes down"
                        disabled={disabled}
                        value={String(counter.reset_behavior ?? "new_segment")}
                        options={[
                          { value: "new_segment", label: "Continue from the new value" },
                          { value: "diagnose", label: "Continue and flag for review" },
                        ]}
                        help="Readings stay valid. Consumption counts from the new value, so a meter reset never stops recording."
                        onChange={(value) =>
                          configuration(
                            "counter_config",
                            "reset_behavior",
                            value || undefined,
                          )
                        }
                      />
                    </div>
                    <TextField
                      title="counter_config.rollover_at"
                      label="Rolls over at (optional)"
                      type="number"
                      min="0"
                      step="any"
                      disabled={disabled}
                      placeholder="For example 99999999"
                      help="For meters that wrap back to zero. A drop that would use more than half of this range counts as a reset instead."
                      value={
                        typeof counter.rollover_at === "number"
                          ? counter.rollover_at
                          : ""
                      }
                      onChange={(event) =>
                        configuration(
                          "counter_config",
                          "rollover_at",
                          event.target.value === ""
                            ? undefined
                            : Number(event.target.value),
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
                  key={values.data_type}
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
                  Other tabs keep keys they don't know. Invalid JSON can't be
                  saved.
                </FieldDescription>
                {(
                  [
                    ["validation_logic", "Validation rule"],
                    ["display_config", "Display settings"],
                    ["reporting_config", "Reporting settings"],
                    ["counter_config", "Counter settings"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} title={key}>
                    <JsonEditor
                      label={label}
                      value={values[key]}
                      readOnly={disabled}
                      onChange={(value) => set(key, value)}
                    />
                  </div>
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
