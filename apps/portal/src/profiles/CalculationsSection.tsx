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
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@iot-os/ui/components/card"
import { Badge } from "@iot-os/ui/components/badge"
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
import { PlusIcon, PencilIcon, Trash2Icon } from "lucide-react"
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
import { isArithmetic, jsonText } from "./authoring"
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
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Derived calculations</CardTitle>
            <CardDescription>
              Pure formulas using current values from this profile. No network,
              history, or device actions.
            </CardDescription>
          </div>
          {canEdit && (
            <Button
              disabled={
                studio.busy || !derived.some((item) => !item.calculation)
              }
              onClick={() => setEditing("new")}
            >
              <PlusIcon data-icon="inline-start" />
              Add calculation
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!derived.length && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Add a derived parameter first</EmptyTitle>
              <EmptyDescription>
                In Parameters, add a value with the Derived kind. Then choose
                the inputs and formula here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {derived.map((parameter) => (
          <div
            key={parameter.uuid}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
          >
            <div className="flex flex-col gap-2">
              <p className="font-medium">{parameter.label}</p>
              <p className="text-sm text-muted-foreground">
                {parameter.calculation
                  ? parameter.calculation.inputs
                      .map(
                        (input) =>
                          input.alias +
                          " ← " +
                          (studio.profile.parameters.find(
                            (item) => item.uuid === input.parameter_uuid,
                          )?.label ?? "Missing parameter"),
                      )
                      .join(" · ")
                  : "No calculation configured yet"}
              </p>
              <Badge variant="secondary">
                {parameter.calculation
                  ? "On input change · mark invalid on failure"
                  : "Needs a formula"}
              </Badge>
            </div>
            <div className="flex gap-1">
              <Button
                variant="outline"
                disabled={studio.busy}
                onClick={() => setEditing(parameter)}
              >
                <PencilIcon data-icon="inline-start" />
                {canEdit
                  ? parameter.calculation
                    ? "Edit"
                    : "Configure"
                  : "Inspect"}
              </Button>
              {parameter.calculation && canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
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
          </div>
        ))}
        {editing && (
          <CalculationEditor
            target={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
          />
        )}
        <Confirm
          open={Boolean(deleting)}
          title="Delete this calculation?"
          description="The derived parameter stays in your draft. It will need another formula before publishing."
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
      </CardContent>
    </Card>
  )
}
function ArithmeticNode({
  value,
  aliases,
  onChange,
  disabled,
  depth = 0,
  root = false,
}: {
  value: JsonValue
  aliases: string[]
  onChange: (value: JsonValue) => void
  disabled: boolean
  depth?: number
  root?: boolean
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
  return (
    <FieldGroup className="rounded-lg border p-3">
      <Choice
        label={root ? "Formula output" : "Operand type"}
        value={kind}
        disabled={disabled || depth > 15}
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
          label="Constant value"
          type="number"
          step="any"
          value={value as number}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      ) : kind === "input" ? (
        <Choice
          label="Named input"
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
            label="Operation"
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
                depth={depth + 1}
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
                  disabled={disabled}
                  onClick={() =>
                    onChange({
                      [operator]: operands.filter((_, i) => i !== index),
                    })
                  }
                >
                  Remove operand {index + 1}
                </Button>
              )}
            </div>
          ))}
          {["+", "*"].includes(operator) && (
            <Button
              type="button"
              variant="outline"
              disabled={disabled || operands.length >= 100}
              onClick={() => onChange({ [operator]: [...operands, 0] })}
            >
              Add operand
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
      description="Choose a derived output, name its inputs, then build a formula. Published revisions remain unchanged."
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
              api.saveProfileCalculation(
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
            {values.inputs.map((input, index) => (
              <FieldGroup key={index} className="rounded-lg border p-3">
                <Choice
                  label={"Source parameter " + (index + 1)}
                  value={input.parameter_uuid}
                  disabled={disabled}
                  options={[
                    { value: "", label: "Choose parameter" },
                    ...studio.profile.parameters
                      .filter((item) => item.uuid !== values.target)
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
                  disabled={disabled}
                  help="Use this exact name in the formula. Renaming an alias does not rewrite custom expressions."
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
                  variant="outline"
                  disabled={disabled}
                  onClick={() =>
                    setInputs(values.inputs.filter((_, i) => i !== index))
                  }
                >
                  Remove input
                </Button>
              </FieldGroup>
            ))}
            <Button
              type="button"
              variant="outline"
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
                    root
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
              Test with sample inputs before saving. Samples are never persisted
              and do not query devices.
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
          disabled={disabled || !values.inputs.length || !values.target}
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
