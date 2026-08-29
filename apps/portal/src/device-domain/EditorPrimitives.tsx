import { createContext, useContext, useState, type ReactNode } from "react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@iot-os/ui/components/alert-dialog"
import { Button } from "@iot-os/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@iot-os/ui/components/card"
import { Checkbox } from "@iot-os/ui/components/checkbox"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@iot-os/ui/components/select"
import { Textarea } from "@iot-os/ui/components/textarea"
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react"
import {
  calibrationOperations,
  canonicalJson,
  createCalibrationOperation,
  dataTypes,
  displayWidgets,
  inputWidgets,
  presentationForType,
  valueSchemaForType,
  type CalibrationOperation,
  type Presentation,
  type ValueSchema,
} from "./model"

const EditorReadOnlyContext = createContext(false)

export function EditorReadOnlyProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <EditorReadOnlyContext.Provider value={value}>{children}</EditorReadOnlyContext.Provider>
}

export function useEditorReadOnly(): boolean {
  return useContext(EditorReadOnlyContext)
}

export function TextField({
  id,
  label,
  value,
  onChange,
  description,
  placeholder,
  required,
  disabled,
}: {
  id: string
  label: string
  value: string | null | undefined
  onChange: (value: string) => void
  description?: string
  placeholder?: string
  required?: boolean
  disabled?: boolean
}) {
  const editorReadOnly = useEditorReadOnly()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled || editorReadOnly}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  )
}

export function NumberField({
  id,
  label,
  value,
  onChange,
  description,
  min,
  max,
  step = "any",
}: {
  id: string
  label: string
  value: number | null | undefined
  onChange: (value: number | undefined) => void
  description?: string
  min?: number
  max?: number
  step?: number | "any"
}) {
  const editorReadOnly = useEditorReadOnly()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        value={value ?? ""}
        min={min}
        max={max}
        step={step}
        disabled={editorReadOnly}
        onChange={(event) =>
          onChange(event.target.value === "" ? undefined : Number(event.target.value))
        }
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  )
}

export function SelectField<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  descriptions,
}: {
  id: string
  label: string
  value: T
  options: readonly T[]
  onChange: (value: T) => void
  descriptions?: Partial<Record<T, string>>
}) {
  const editorReadOnly = useEditorReadOnly()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={(next) => onChange(next as T)} disabled={editorReadOnly}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {option.replaceAll("_", " ")}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {descriptions?.[value] ? <FieldDescription>{descriptions[value]}</FieldDescription> : null}
    </Field>
  )
}

export function BooleanField({
  id,
  label,
  checked,
  onChange,
  description,
}: {
  id: string
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  description?: string
}) {
  const editorReadOnly = useEditorReadOnly()
  return (
    <Field orientation="horizontal">
      <Checkbox id={id} checked={checked} disabled={editorReadOnly} onCheckedChange={(value) => onChange(value === true)} />
      <div className="flex flex-1 flex-col gap-1">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description ? <FieldDescription>{description}</FieldDescription> : null}
      </div>
    </Field>
  )
}

export function StableId({ value }: { value: string }) {
  return (
    <p className="truncate font-mono text-xs text-muted-foreground" title={value}>
      UUID {value}
    </p>
  )
}

export function RepeaterActions({
  label,
  index,
  count,
  onMove,
  onRemove,
}: {
  label: string
  index: number
  count: number
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}) {
  const editorReadOnly = useEditorReadOnly()
  return (
    <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Move ${label} up`}
        disabled={editorReadOnly || index === 0}
        onClick={() => onMove(-1)}
      >
        <ArrowUpIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Move ${label} down`}
        disabled={editorReadOnly || index === count - 1}
        onClick={() => onMove(1)}
      >
        <ArrowDownIcon />
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${label}`} disabled={editorReadOnly}>
            <Trash2Icon />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the item from the draft. Its stable UUID will not be reused.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep item</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onRemove}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function AddButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  const editorReadOnly = useEditorReadOnly()
  return (
    <Button type="button" variant="outline" size="sm" disabled={editorReadOnly} onClick={onClick}>
      <PlusIcon data-icon="inline-start" />
      {children}
    </Button>
  )
}

export function JsonPreview({
  title,
  description,
  value,
  testId,
}: {
  title: string
  description: string
  value: unknown
  testId?: string
}) {
  const editorReadOnly = useEditorReadOnly()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <pre
          data-testid={testId}
          className="max-h-[34rem] overflow-auto rounded-lg bg-muted p-4 font-mono text-xs leading-5"
        >
          {canonicalJson(value)}
        </pre>
      </CardContent>
    </Card>
  )
}

export function ValueSchemaEditor({
  id,
  value,
  presentation,
  onChange,
}: {
  id: string
  value: ValueSchema
  presentation?: Presentation
  onChange: (value: ValueSchema, presentation: Presentation) => void
}) {
  const numeric = ["float64", "int64", "uint64"].includes(value.data_type)
  const textual = ["string", "bytes", "state"].includes(value.data_type)
  const resolvedPresentation = presentation ?? {
    order: 10,
    input: { widget: "number_input" },
    display: { widget: "value_card" },
  }
  const allowedValues = value.constraints.allowed_values?.join(", ") ?? ""

  function changeSchema(next: Partial<ValueSchema>) {
    onChange({ ...value, ...next }, resolvedPresentation)
  }

  function changePresentation(next: Partial<Presentation>) {
    onChange(value, { ...resolvedPresentation, ...next })
  }

  return (
    <FieldGroup className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <SelectField
        id={`${id}-data-type`}
        label="Data type"
        value={value.data_type}
        options={dataTypes}
        onChange={(dataType) =>
          onChange(
            valueSchemaForType(value, dataType),
            presentationForType(resolvedPresentation, dataType),
          )
        }
      />
      {numeric ? (
        <TextField
          id={`${id}-unit`}
          label="Unit code"
          value={value.unit_code}
          placeholder="Cel, %, V, A, W"
          description="Stored as semantic metadata; not repeated in telemetry payloads."
          onChange={(unit) => changeSchema({ unit_code: unit || null })}
        />
      ) : null}
      {numeric ? (
        <NumberField
          id={`${id}-minimum`}
          label="Minimum"
          value={value.constraints.minimum}
          onChange={(minimum) =>
            changeSchema({ constraints: { ...value.constraints, minimum } })
          }
        />
      ) : null}
      {numeric ? (
        <NumberField
          id={`${id}-maximum`}
          label="Maximum"
          value={value.constraints.maximum}
          onChange={(maximum) =>
            changeSchema({ constraints: { ...value.constraints, maximum } })
          }
        />
      ) : null}
      {numeric ? (
        <NumberField
          id={`${id}-multiple`}
          label="Step / multiple of"
          value={value.constraints.multiple_of}
          min={0}
          onChange={(multiple_of) =>
            changeSchema({ constraints: { ...value.constraints, multiple_of } })
          }
        />
      ) : null}
      {textual ? (
        <NumberField
          id={`${id}-min-length`}
          label="Minimum length"
          value={value.constraints.min_length}
          min={0}
          step={1}
          onChange={(min_length) =>
            changeSchema({ constraints: { ...value.constraints, min_length } })
          }
        />
      ) : null}
      {textual ? (
        <NumberField
          id={`${id}-max-length`}
          label="Maximum length"
          value={value.constraints.max_length}
          min={0}
          step={1}
          onChange={(max_length) =>
            changeSchema({ constraints: { ...value.constraints, max_length } })
          }
        />
      ) : null}
      {value.data_type === "state" || value.data_type === "string" ? (
        <TextField
          id={`${id}-allowed-values`}
          label="Allowed values"
          value={allowedValues}
          placeholder="idle, running, fault"
          onChange={(next) =>
            changeSchema({
              constraints: {
                ...value.constraints,
                allowed_values: next
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean),
              },
            })
          }
        />
      ) : null}
      <NumberField
        id={`${id}-order`}
        label="Display order"
        value={resolvedPresentation.order}
        min={0}
        max={10000}
        step={1}
        onChange={(order) => changePresentation({ order: order ?? 0 })}
      />
      {numeric ? (
        <NumberField
          id={`${id}-precision`}
          label="Display precision"
          value={resolvedPresentation.precision}
          min={0}
          max={12}
          step={1}
          onChange={(precision) => changePresentation({ precision })}
        />
      ) : null}
      <SelectField
        id={`${id}-input-widget`}
        label="Input widget"
        value={resolvedPresentation.input?.widget ?? "text_input"}
        options={inputWidgets}
        onChange={(widget) =>
          changePresentation({ input: { ...resolvedPresentation.input, widget } })
        }
      />
      <SelectField
        id={`${id}-display-widget`}
        label="Display widget"
        value={resolvedPresentation.display?.widget ?? "value_card"}
        options={displayWidgets}
        onChange={(widget) => changePresentation({ display: { widget } })}
      />
    </FieldGroup>
  )
}

export function CalibrationEditor({
  id,
  value,
  onChange,
  title = "Calibration pipeline",
}: {
  id: string
  value: CalibrationOperation[]
  onChange: (value: CalibrationOperation[]) => void
  title?: string
}) {
  const editorReadOnly = useEditorReadOnly()
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">
            Operations run in order before semantic validation and storage.
          </p>
        </div>
        <AddButton onClick={() => onChange([...value, createCalibrationOperation()])}>
          Add operation
        </AddButton>
      </div>
      {value.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No calibration. The wire value is used as-is.
        </p>
      ) : null}
      {value.map((operation, index) => (
        <div key={`${operation.op}-${index}`} className="rounded-lg border p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="grid flex-1 gap-4 sm:grid-cols-2">
              <SelectField
                id={`${id}-${index}-op`}
                label={`Operation ${index + 1}`}
                value={operation.op}
                options={calibrationOperations}
                onChange={(op) =>
                  onChange(
                    value.map((item, itemIndex) =>
                      itemIndex === index ? createCalibrationOperation(op) : item,
                    ),
                  )
                }
              />
              {"value" in operation ? (
                <NumberField
                  id={`${id}-${index}-value`}
                  label="Value"
                  value={operation.value}
                  onChange={(next) =>
                    onChange(
                      value.map((item, itemIndex) =>
                        itemIndex === index && "value" in item
                          ? { ...item, value: next ?? 1 }
                          : item,
                      ),
                    )
                  }
                />
              ) : null}
              {operation.op === "power" ? (
                <NumberField
                  id={`${id}-${index}-exponent`}
                  label="Exponent"
                  value={operation.exponent}
                  min={-16}
                  max={16}
                  onChange={(exponent) =>
                    onChange(
                      value.map((item, itemIndex) =>
                        itemIndex === index && item.op === "power"
                          ? { ...item, exponent: exponent ?? 1 }
                          : item,
                      ),
                    )
                  }
                />
              ) : null}
              {operation.op === "clamp" ? (
                <>
                  <NumberField
                    id={`${id}-${index}-minimum`}
                    label="Clamp minimum"
                    value={operation.minimum}
                    onChange={(minimum) =>
                      onChange(
                        value.map((item, itemIndex) =>
                          itemIndex === index && item.op === "clamp"
                            ? { ...item, minimum }
                            : item,
                        ),
                      )
                    }
                  />
                  <NumberField
                    id={`${id}-${index}-maximum`}
                    label="Clamp maximum"
                    value={operation.maximum}
                    onChange={(maximum) =>
                      onChange(
                        value.map((item, itemIndex) =>
                          itemIndex === index && item.op === "clamp"
                            ? { ...item, maximum }
                            : item,
                        ),
                      )
                    }
                  />
                </>
              ) : null}
              {operation.op === "round" ? (
                <NumberField
                  id={`${id}-${index}-precision`}
                  label="Precision"
                  value={operation.precision}
                  min={0}
                  max={12}
                  step={1}
                  onChange={(precision) =>
                    onChange(
                      value.map((item, itemIndex) =>
                        itemIndex === index && item.op === "round"
                          ? { ...item, precision: precision ?? 0 }
                          : item,
                      ),
                    )
                  }
                />
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Move operation ${index + 1} up`}
                disabled={editorReadOnly || index === 0}
                onClick={() => {
                  const next = [...value]
                  ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                  onChange(next)
                }}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Move operation ${index + 1} down`}
                disabled={editorReadOnly || index === value.length - 1}
                onClick={() => {
                  const next = [...value]
                  ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
                  onChange(next)
                }}
              >
                <ArrowDownIcon />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove operation ${index + 1}`}
                disabled={editorReadOnly}
                onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
              >
                <Trash2Icon />
              </Button>
            </div>
          </div>
          {operation.op === "cel" ? (
            <Field className="mt-4">
              <FieldLabel htmlFor={`${id}-${index}-expression`}>Restricted CEL expression</FieldLabel>
              <Textarea
                id={`${id}-${index}-expression`}
                value={operation.expression}
                disabled={editorReadOnly}
                onChange={(event) =>
                  onChange(
                    value.map((item, itemIndex) =>
                      itemIndex === index && item.op === "cel"
                        ? { ...item, expression: event.target.value }
                        : item,
                    ),
                  )
                }
                placeholder="value * 0.1"
              />
            </Field>
          ) : null}
        </div>
      ))}
    </div>
  )
}

export function JsonTextarea({
  id,
  label,
  value,
  onChange,
  description,
  rows = 8,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  description?: string
  rows?: number
}) {
  const [error, setError] = useState<string | null>(null)
  const editorReadOnly = useEditorReadOnly()

  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        className="font-mono text-xs"
        rows={rows}
        value={value}
        disabled={editorReadOnly}
        aria-invalid={Boolean(error)}
        onChange={(event) => {
          const next = event.target.value
          onChange(next)
          try {
            JSON.parse(next)
            setError(null)
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Invalid JSON")
          }
        }}
      />
      {error ? <FieldDescription>{error}</FieldDescription> : description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  )
}
