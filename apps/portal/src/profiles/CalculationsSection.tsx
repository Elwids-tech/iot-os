import { useState } from "react"
import { useForm } from "react-hook-form"
import type {
  AuthoringParameter,
  JsonObject,
  JsonValue,
  PreviewResult,
} from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@iot-os/ui/components/table"
import { cn } from "@iot-os/ui/lib/utils"
import { FieldGroup, FieldDescription } from "@iot-os/ui/components/field"
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@iot-os/ui/components/alert"
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@iot-os/ui/components/tabs"
import { JsonEditor } from "@iot-os/ui/components/json-editor"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@iot-os/ui/components/empty"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { api } from "../lib/api"
import { useUnsaved } from "../lib/unsaved"
import {
  Choice,
  TextField,
  EditorSheet,
  SaveBar,
  RequestError,
  Confirm,
  parseObject,
} from "../components/forms"
import { formulaText, isArithmetic, jsonText } from "./authoring"
import { plural } from "./ProfileDirectory"
import { useStudio } from "./use-studio"
import { ConflictReview } from "./ConflictReview"
export function CalculationsSection() {
  const studio = useStudio(),
    [editing, setEditing] = useState<AuthoringParameter | "new" | null>(null),
    [deleting, setDeleting] = useState<AuthoringParameter | null>(null)
  const derived = studio.profile.parameters.filter(
    (item) => item.kind === "derived",
  )
  const [deletionRevision, setDeletionRevision] = useState(
    studio.profile.draft_revision,
  )
  const canEdit =
    studio.capabilities.update &&
    studio.profile.status !== "archived" &&
    !studio.blocked
  const labels = new Map(
    studio.profile.parameters.map((item) => [item.uuid, item.label]),
  )
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground tabular-nums">
          {plural(derived.length, "derived parameter")}
        </span>
        {canEdit && (
          <Button
            className="ml-auto"
            disabled={studio.busy}
            onClick={() => setEditing("new")}
          >
            <PlusIcon data-icon="inline-start" />
            Add calculation
          </Button>
        )}
      </div>
      {!derived.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No calculations yet</EmptyTitle>
            <EmptyDescription>
              A calculation creates a derived parameter from other parameters.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Result parameter</TableHead>
              <TableHead>Formula</TableHead>
              <TableHead>Inputs</TableHead>
              <TableHead>Runs</TableHead>
              <TableHead>On failure</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {derived.map((parameter) => {
              const calculation = parameter.calculation
              return (
                <TableRow key={parameter.uuid}>
                  <TableCell>{parameter.label}</TableCell>
                  <TableCell
                    className={cn(
                      "max-w-80 truncate",
                      calculation ? "font-mono text-xs" : "text-muted-foreground",
                    )}
                  >
                    {calculation
                      ? (formulaText(calculation.expression) ?? "Custom formula")
                      : "No calculation configured yet"}
                  </TableCell>
                  <TableCell
                    className="max-w-80 truncate text-muted-foreground"
                    title={calculation?.inputs
                      .map((input) => input.alias + " = " + (labels.get(input.parameter_uuid) ?? "Missing parameter"))
                      .join(", ")}
                  >
                    {calculation?.inputs
                      .map((input) => labels.get(input.parameter_uuid) ?? "Missing parameter")
                      .join(", ")}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {calculation && "On input change"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {calculation && "Mark invalid"}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={studio.busy}
                        aria-label={
                          (canEdit ? (calculation ? "Edit" : "Configure") : "Inspect") +
                          " calculation for " +
                          parameter.label
                        }
                        onClick={() => setEditing(parameter)}
                      >
                        {canEdit ? (calculation ? "Edit" : "Configure") : "Inspect"}
                      </Button>
                      {calculation && canEdit && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={"Delete calculation for " + parameter.label}
                          disabled={studio.busy}
                          onClick={() => {
                            setDeletionRevision(studio.profile.draft_revision)
                            setDeleting(parameter)
                          }}
                        >
                          <Trash2Icon />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
      {editing && (
        <CalculationEditor
          target={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <Confirm
        open={Boolean(deleting)}
        title="Delete this calculation?"
        description="The derived parameter stays in the draft. It needs a new formula before you publish."
        onClose={() => setDeleting(null)}
        onRefresh={studio.reload}
        onConfirm={async () => {
          if (deleting)
            await studio.perform(() =>
              api.deleteProfileCalculation(
                studio.org,
                studio.profile.uuid,
                deleting.uuid,
                deletionRevision,
              ),
            )
        }}
      />
    </div>
  )
}
/** Operand names follow their position: "Operand 1", then "Operand 1.2" inside it (P8). */
function ArithmeticNode({
  value,
  aliases,
  onChange,
  disabled,
  path = [],
}: {
  value: JsonValue
  aliases: string[]
  onChange: (value: JsonValue) => void
  disabled: boolean
  path?: number[]
}) {
  const kind =
    typeof value === "number"
      ? "constant"
      : value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          typeof value.var === "string"
        ? "input"
        : "operation"
  const node = value as JsonObject,
    operator = kind === "operation" ? Object.keys(node)[0] : "+"
  const operands = kind === "operation" ? (node[operator] as JsonValue[]) : []
  const root = !path.length,
    name = root ? "Formula" : "Operand " + path.map((index) => index + 1).join(".")
  return (
    <FieldGroup className={cn("gap-4", !root && "border-l pl-3")}>
      <Choice
        label={name}
        value={kind}
        disabled={disabled || path.length > 15}
        options={[
          { value: "input", label: "Parameter input" },
          ...(!root ? [{ value: "constant", label: "Constant number" }] : []),
          { value: "operation", label: "Arithmetic operation" },
        ]}
        onChange={(next) =>
          onChange(
            next === "input"
              ? { var: aliases[0] ?? "input" }
              : next === "constant"
                ? 0
                : { "+": [0, 0] },
          )
        }
      />
      {kind === "constant" ? (
        <TextField
          label={name + " value"}
          type="number"
          step="any"
          value={value as number}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      ) : kind === "input" ? (
        <Choice
          label={name + " input"}
          value={String(node.var)}
          disabled={disabled}
          options={Array.from(new Set([...aliases, String(node.var)])).map(
            (alias) => ({
              value: alias,
              label: aliases.includes(alias)
                ? alias
                : alias + " (not declared)",
            }),
          )}
          onChange={(alias) => onChange({ var: alias })}
        />
      ) : (
        <>
          <Choice
            label={root ? "Operation" : name + " operation"}
            value={operator}
            disabled={disabled}
            options={[
              { value: "+", label: "Add" },
              { value: "-", label: "Subtract (two operands)" },
              { value: "*", label: "Multiply" },
              { value: "/", label: "Divide (two operands)" },
            ]}
            onChange={(operation) => onChange({ [operation]: operands })}
          />
          {operands.map((operand, index) => (
            <div className="flex min-w-0 flex-col gap-2" key={index}>
              <ArithmeticNode
                value={operand}
                aliases={aliases}
                disabled={disabled}
                path={[...path, index]}
                onChange={(next) =>
                  onChange({
                    [operator]: operands.map((item, i) =>
                      i === index ? next : item,
                    ),
                  })
                }
              />
              {operands.length > 2 && (
                <Button
                  type="button"
                  variant="ghost"
                  className="self-start"
                  disabled={disabled}
                  onClick={() =>
                    onChange({
                      [operator]: operands.filter((_, i) => i !== index),
                    })
                  }
                >
                  Remove operand {[...path, index].map((i) => i + 1).join(".")}
                </Button>
              )}
            </div>
          ))}
          {["+", "*"].includes(operator) && (
            <Button
              type="button"
              variant="outline"
              className="self-start"
              disabled={disabled || operands.length >= 100}
              onClick={() => onChange({ [operator]: [...operands, 0] })}
            >
              {root ? "Add operand" : "Add operand to " + name.toLowerCase()}
            </Button>
          )}
        </>
      )}
    </FieldGroup>
  )
}
function CalculationEditor({
  target,
  onClose,
}: {
  target: AuthoringParameter | null
  onClose: () => void
}) {
  const studio = useStudio(),
    [revision, setRevision] = useState(studio.profile.draft_revision),
    [error, setError] = useState<unknown>(null)
  const candidates = studio.profile.parameters.filter(
    (item) =>
      item.kind === "derived" &&
      (!item.calculation || item.uuid === target?.uuid),
  )
  const form = useForm({
    defaultValues: {
      target: target?.uuid ?? candidates[0]?.uuid ?? "",
      output_mode: target ? "existing" : "new",
      output_key: "",
      output_label: "",
      output_data_type: "number" as "number" | "integer",
      output_unit: "",
      output_group: "",
      inputs: target?.calculation?.inputs ?? [],
      expression: jsonText(target?.calculation?.expression ?? { "+": [0, 0] }),
    },
  })
  const values = form.watch(),
    dirty = form.formState.isDirty,
    disabled =
      !studio.capabilities.update ||
      studio.profile.status === "archived" ||
      studio.blocked
  const [mode, setMode] = useState(
    target?.calculation && !isArithmetic(target.calculation.expression)
      ? "json"
      : "builder",
  )
  const [replace, setReplace] = useState(false),
    [samples, setSamples] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<{
      source: string
      result: PreviewResult
    } | null>(null),
    [previewBusy, setPreviewBusy] = useState(false)
  useUnsaved(dirty)
  let expression: JsonValue = null
  try {
    expression = JSON.parse(values.expression)
  } catch {}
  const supported =
    expression !== null &&
    typeof expression === "object" &&
    isArithmetic(expression)
  const source = JSON.stringify({ values, samples, revision })
  const setExpression = (value: string) =>
    form.setValue("expression", value, { shouldDirty: true })
  const setInputs = (inputs: typeof values.inputs) =>
    form.setValue("inputs", inputs, { shouldDirty: true })
  return (
    <EditorSheet
      title={target?.calculation ? "Edit calculation" : "Configure calculation"}
      description="Choose the result, name its inputs, then build the formula."
      dirty={dirty}
      busy={form.formState.isSubmitting}
      onClose={onClose}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={form.handleSubmit(async (input) => {
          try {
            setError(null)
            await studio.perform(() =>
              input.output_mode === "new"
                ? api.createProfileCalculation(
                    studio.org,
                    studio.profile.uuid,
                    {
                      engine: "json_logic",
                      expression: parseObject(input.expression, false)!,
                      inputs: input.inputs,
                      trigger: "on_input_change",
                      failure_policy: "mark_invalid",
                      draft_revision: revision,
                      output: {
                        key: input.output_key,
                        label: input.output_label,
                        data_type: input.output_data_type,
                        unit: input.output_unit || null,
                        parameter_group_uuid: input.output_group || null,
                      },
                    },
                  )
                : api.saveProfileCalculation(
                    studio.org,
                    studio.profile.uuid,
                    input.target,
                    {
                      engine: "json_logic",
                      expression: parseObject(input.expression, false)!,
                      inputs: input.inputs,
                      trigger: "on_input_change",
                      failure_policy: "mark_invalid",
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
        <div className="flex-1 overflow-y-auto p-6">
          <FieldGroup>
            {!target && (
              <Choice
                label="Output"
                value={values.output_mode}
                disabled={disabled}
                options={[
                  { value: "new", label: "Create new output" },
                  ...(candidates.length
                    ? [
                        {
                          value: "existing",
                          label: "Use existing derived parameter",
                        },
                      ]
                    : []),
                ]}
                onChange={(v) =>
                  form.setValue("output_mode", v, { shouldDirty: true })
                }
              />
            )}
            {values.output_mode === "new" ? (
              <FieldGroup>
                <TextField
                  label="Output label"
                  required
                  disabled={disabled}
                  {...form.register("output_label")}
                />
                <TextField
                  label="Output key"
                  required
                  disabled={disabled}
                  pattern="[a-zA-Z][a-zA-Z0-9._-]*"
                  {...form.register("output_key")}
                />
                <Choice
                  label="Output numeric type"
                  value={values.output_data_type}
                  disabled={disabled}
                  options={[
                    { value: "number", label: "Number" },
                    { value: "integer", label: "Integer" },
                  ]}
                  onChange={(v) =>
                    form.setValue(
                      "output_data_type",
                      v as "number" | "integer",
                      { shouldDirty: true },
                    )
                  }
                />
                <TextField
                  label="Output unit"
                  disabled={disabled}
                  {...form.register("output_unit")}
                />
                <Choice
                  label="Output group"
                  value={values.output_group}
                  disabled={disabled}
                  options={[
                    { value: "", label: "No group" },
                    ...studio.profile.parameter_groups.map((g) => ({
                      value: g.uuid,
                      label: g.label,
                    })),
                  ]}
                  onChange={(v) =>
                    form.setValue("output_group", v, { shouldDirty: true })
                  }
                />
              </FieldGroup>
            ) : (
              <Choice
                label="Derived output parameter"
                value={values.target}
                disabled={disabled || Boolean(target?.calculation)}
                options={candidates.map((item) => ({
                  value: item.uuid,
                  label: item.label,
                }))}
                onChange={(value) =>
                  form.setValue("target", value, { shouldDirty: true })
                }
              />
            )}
            {values.inputs.map((input, index) => (
              <FieldGroup
                key={index}
                className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto]"
              >
                <Choice
                  label={"Source parameter " + (index + 1)}
                  value={input.parameter_uuid}
                  disabled={disabled}
                  options={[
                    { value: "", label: "Choose parameter" },
                    ...studio.profile.parameters
                      .filter(
                        (item) =>
                          values.output_mode === "new" ||
                          item.uuid !== values.target,
                      )
                      .map((item) => ({
                        value: item.uuid,
                        label: item.label + " · " + item.key,
                      })),
                  ]}
                  onChange={(value) =>
                    setInputs(
                      values.inputs.map((item, i) =>
                        i === index ? { ...item, parameter_uuid: value } : item,
                      ),
                    )
                  }
                />
                <TextField
                  label={"Input alias " + (index + 1)}
                  required
                  value={input.alias}
                  className="font-mono"
                  disabled={disabled}
                  onChange={(event) =>
                    setInputs(
                      values.inputs.map((item, i) =>
                        i === index
                          ? { ...item, alias: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={"Remove input " + (index + 1)}
                  disabled={disabled}
                  onClick={() =>
                    setInputs(values.inputs.filter((_, i) => i !== index))
                  }
                >
                  Remove
                </Button>
              </FieldGroup>
            ))}
            {values.inputs.length > 0 && (
              <FieldDescription>
                Use each alias as a name in the formula. Renaming an alias
                doesn't change custom formulas.
              </FieldDescription>
            )}
            <Button
              type="button"
              variant="outline"
              className="self-start"
              disabled={disabled || values.inputs.length >= 100}
              onClick={() =>
                setInputs([
                  ...values.inputs,
                  {
                    parameter_uuid: "",
                    alias: "input" + (values.inputs.length + 1),
                  },
                ])
              }
            >
              Add named input
            </Button>
            <Tabs value={mode} onValueChange={setMode}>
              <TabsList>
                <TabsTrigger value="builder" disabled={!supported}>
                  Formula builder
                </TabsTrigger>
                <TabsTrigger value="json">Advanced JSON</TabsTrigger>
              </TabsList>
              <TabsContent value="builder">
                {supported && (
                  <ArithmeticNode
                    value={expression}
                    aliases={values.inputs.map((item) => item.alias)}
                    disabled={disabled}
                    onChange={(value) => setExpression(jsonText(value))}
                  />
                )}
              </TabsContent>
              <TabsContent value="json">
                <FieldGroup>
                  {!supported && (
                    <Alert>
                      <AlertTitle>Custom formula is preserved</AlertTitle>
                      <AlertDescription>
                        The visual builder cannot represent this expression. You
                        can keep editing its JSON.
                      </AlertDescription>
                    </Alert>
                  )}
                  <JsonEditor
                    label="Calculation expression"
                    value={values.expression}
                    readOnly={disabled}
                    onChange={setExpression}
                  />
                  {!supported && !disabled && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setReplace(true)}
                    >
                      Replace with an arithmetic formula
                    </Button>
                  )}
                </FieldGroup>
              </TabsContent>
            </Tabs>
            <FieldDescription>
              Samples are only used for this test. They aren't saved.
            </FieldDescription>
            {values.inputs.map((input, index) => (
              <TextField
                key={index}
                label={
                  "Sample " +
                  (input.alias || "input " + (index + 1)) +
                  " (JSON)"
                }
                value={samples[input.alias] ?? "0"}
                onChange={(event) =>
                  setSamples((current) => ({
                    ...current,
                    [input.alias]: event.target.value,
                  }))
                }
              />
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={previewBusy || !studio.capabilities.validate}
              onClick={async () => {
                try {
                  setError(null)
                  setPreviewBusy(true)
                  const result = await api.previewDeviceProfile(
                    studio.org,
                    studio.profile.uuid,
                    {
                      kind: "calculation",
                      output_data_type:
                        values.output_mode === "new"
                          ? values.output_data_type
                          : studio.profile.parameters.find(
                              (p) => p.uuid === values.target,
                            )?.data_type,
                      draft_revision: revision,
                      expression: parseObject(values.expression, false)!,
                      inputs: values.inputs,
                      samples: Object.fromEntries(
                        values.inputs.map((input) => [
                          input.alias,
                          JSON.parse(samples[input.alias] ?? "0"),
                        ]),
                      ),
                    },
                  )
                  setPreview({ result, source })
                } catch (reason) {
                  setError(reason)
                } finally {
                  setPreviewBusy(false)
                }
              }}
            >
              {previewBusy ? "Evaluating…" : "Test formula"}
            </Button>
            {preview && (
              <Alert variant={preview.result.valid ? "default" : "destructive"}>
                <AlertTitle>
                  {preview.source !== source
                    ? "Preview is outdated"
                    : preview.result.valid
                      ? "Formula result: " +
                        JSON.stringify(preview.result.result)
                      : "Formula needs attention"}
                </AlertTitle>
                <AlertDescription>
                  {preview.source !== source
                    ? "Run the test again after changing the formula or inputs."
                    : preview.result.diagnostics
                        .map((item) => item.message)
                        .join(" ") ||
                      "The candidate formula evaluated successfully using these sample values."}
                </AlertDescription>
              </Alert>
            )}
            <RequestError error={error} />
            <ConflictReview
              error={error}
              local={values}
              selectLatest={(fresh) =>
                fresh.parameters.find((item) => item.uuid === values.target)
                  ?.calculation
              }
              onRebase={(value) => {
                setRevision(value)
                setError(null)
              }}
            />
          </FieldGroup>
        </div>
        <SaveBar
          dirty={dirty}
          busy={form.formState.isSubmitting || studio.busy}
          disabled={
            disabled ||
            !values.inputs.length ||
            (values.output_mode === "existing" && !values.target)
          }
          onCancel={onClose}
          label="Save calculation"
        />
      </form>
      <Confirm
        open={replace}
        title="Replace the custom formula?"
        description="The current expression will be replaced with a simple arithmetic starting point. Cancel to keep its JSON unchanged."
        action="Replace formula"
        onClose={() => setReplace(false)}
        onConfirm={() => {
          setExpression(jsonText({ "+": [0, 0] }))
          setMode("builder")
        }}
      />
    </EditorSheet>
  )
}
