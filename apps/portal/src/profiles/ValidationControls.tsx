import { useState } from "react"
import type {
  AuthoringParameter,
  JsonObject,
  JsonValue,
  PreviewResult,
} from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@iot-os/ui/components/field"
import { Textarea } from "@iot-os/ui/components/textarea"
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@iot-os/ui/components/alert"
import { JsonEditor } from "@iot-os/ui/components/json-editor"
import { Choice, TextField, RequestError, Confirm } from "../components/forms"
import {
  objectValue,
  rangeRule,
  readValidation,
  validationSummary,
  updateConfig,
  validationRule,
  type Condition,
} from "./authoring"
import { useStudio } from "./use-studio"
import { api } from "../lib/api"
export function ValidationControls({
  text,
  onChange,
  type,
  disabled,
}: {
  text: string
  onChange: (value: string) => void
  type: AuthoringParameter["data_type"]
  disabled: boolean
}) {
  const inferred = readValidation(text)
  const [chosen, setChosen] = useState(inferred.mode)
  const enumNeedsOptions =
    type === "enum" &&
    inferred.mode !== "options" &&
    inferred.mode !== "custom"
  const mode =
    inferred.mode === "custom"
      ? "custom"
      : enumNeedsOptions
        ? "options"
        : chosen
  const [replace, setReplace] = useState<string | null>(null)
  let metadata: JsonObject = {}
  try {
    metadata = objectValue(text) ?? {}
  } catch {}
  function changeMode(next: string) {
    const base =
      inferred.mode === "custom"
        ? (() => {
            try {
              return objectValue(text) ? text : "null"
            } catch {
              return "null"
            }
          })()
        : text
    if (next === "none") onChange("null")
    if (next === "range") onChange(validationRule(base, rangeRule(0, 100)))
    if (next === "options")
      onChange(validationRule(base, { in: [{ var: "value" }, []] }))
    if (next === "conditions")
      onChange(
        validationRule(base, {
          "===": [
            { var: "value" },
            type === "boolean"
              ? true
              : ["enum", "string"].includes(type)
                ? ""
                : 0,
          ],
        }),
      )
    setChosen(next as typeof chosen)
  }
  const numeric = type === "integer" || type === "number"
  const conditions: Condition[] =
    inferred.mode === "conditions"
      ? inferred.conditions
      : inferred.mode === "range"
        ? [
            ...(inferred.min !== undefined
              ? [{ operator: ">=", value: inferred.min }]
              : []),
            ...(inferred.max !== undefined
              ? [{ operator: "<=", value: inferred.max }]
              : []),
          ]
        : []
  const join = inferred.mode === "conditions" ? inferred.join : "and"
  function writeConditions(next: Condition[], conjunction = join) {
    const nodes = next.map((item) => ({
      [item.operator]: [{ var: "value" }, item.value],
    }))
    onChange(
      validationRule(
        text,
        nodes.length === 1 ? nodes[0] : { [conjunction]: nodes },
      ),
    )
  }
  return (
    <FieldGroup>
      <Choice
        label="Value constraints"
        help={validationSummary(inferred)}
        value={mode}
        disabled={disabled}
        options={
          type === "enum"
            ? [
                { value: "options", label: "Allowed values (required)" },
                ...(inferred.mode === "custom"
                  ? [
                      { value: "custom", label: "Custom rule" },
                    ]
                  : []),
              ]
            : [
                { value: "none", label: "No additional constraints" },
                ...(numeric
                  ? [{ value: "range", label: "Number range" }]
                  : []),
                { value: "options", label: "Allowed values" },
                { value: "conditions", label: "All or any conditions" },
                { value: "custom", label: "Custom rule" },
              ]
        }
        onChange={(next) =>
          inferred.mode === "custom" && next !== "custom"
            ? setReplace(next)
            : changeMode(next)
        }
      />
      {mode === "range" && inferred.mode === "range" && (
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Minimum (inclusive)"
            type="number"
            step={type === "integer" ? "1" : "any"}
            value={inferred.min ?? ""}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                validationRule(
                  text,
                  rangeRule(
                    event.target.value === ""
                      ? undefined
                      : Number(event.target.value),
                    inferred.max,
                  ),
                ),
              )
            }
          />
          <TextField
            label="Maximum (inclusive)"
            type="number"
            step={type === "integer" ? "1" : "any"}
            value={inferred.max ?? ""}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                validationRule(
                  text,
                  rangeRule(
                    inferred.min,
                    event.target.value === ""
                      ? undefined
                      : Number(event.target.value),
                  ),
                ),
              )
            }
          />
        </FieldGroup>
      )}
      {mode === "options" &&
        (inferred.mode === "options" || enumNeedsOptions) && (
        <AllowedValues
          key={type}
          options={inferred.mode === "options" ? inferred.options : []}
          type={type}
          disabled={disabled}
          onChange={(values) =>
            onChange(validationRule(text, { in: [{ var: "value" }, values] }))
          }
        />
      )}
      {mode === "conditions" && inferred.mode !== "custom" && (
        <FieldGroup>
          <Choice
            label="Match"
            value={join}
            options={[
              { value: "and", label: "All conditions must match" },
              { value: "or", label: "Any condition can match" },
            ]}
            disabled={disabled}
            onChange={(value) =>
              writeConditions(conditions, value as "and" | "or")
            }
          />
          {conditions.map((item, index) => (
            <FieldGroup
              key={index}
              className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"
            >
              <Choice
                label={"Condition " + (index + 1)}
                value={item.operator}
                options={["===", "!==", "==", "!=", ">", ">=", "<", "<="].map(
                  (value) => ({ value, label: value }),
                )}
                disabled={disabled}
                onChange={(value) =>
                  writeConditions(
                    conditions.map((current, i) =>
                      i === index ? { ...current, operator: value } : current,
                    ),
                  )
                }
              />
              <TextField
                label={"Compare value " + (index + 1)}
                value={String(item.value ?? "")}
                disabled={disabled}
                type={numeric ? "number" : "text"}
                onChange={(event) =>
                  writeConditions(
                    conditions.map((current, i) =>
                      i === index
                        ? {
                            ...current,
                            value: numeric
                              ? Number(event.target.value)
                              : type === "boolean"
                                ? event.target.value === "true"
                                : event.target.value,
                          }
                        : current,
                    ),
                  )
                }
              />
              <Button
                type="button"
                variant="outline"
                disabled={disabled || conditions.length <= 1}
                onClick={() =>
                  writeConditions(conditions.filter((_, i) => i !== index))
                }
              >
                Remove
              </Button>
            </FieldGroup>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              writeConditions([
                ...conditions,
                { operator: "===", value: numeric ? 0 : "" },
              ])
            }
          >
            Add condition
          </Button>
        </FieldGroup>
      )}
      {mode === "custom" && (
        <>
          <Alert>
            <AlertTitle>Custom validation is preserved</AlertTitle>
            <AlertDescription>
              The guided options can't show this rule. Edit its JSON, or choose
              another option to replace it.
            </AlertDescription>
          </Alert>
          <JsonEditor
            label="Custom rule (JSON Logic)"
            value={text}
            onChange={onChange}
            readOnly={disabled}
          />
        </>
      )}
      {mode !== "none" && inferred.mode !== "custom" && (
        <>
          <TextField
            title="diagnostic_code"
            label="Issue code"
            className="font-mono"
            value={String(metadata.diagnostic_code ?? "")}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                updateConfig(text, "diagnostic_code", event.target.value),
              )
            }
          />
          <TextField
            title="message"
            label="Message"
            value={String(metadata.message ?? "")}
            disabled={disabled}
            onChange={(event) =>
              onChange(updateConfig(text, "message", event.target.value))
            }
            help="Shown when a value is rejected."
          />
        </>
      )}
      <Confirm
        open={Boolean(replace)}
        title="Replace custom validation?"
        description="The current custom rule will be replaced. Other valid validation metadata is kept. Cancel to retain the complete original expression."
        action="Replace rule"
        onClose={() => setReplace(null)}
        onConfirm={() => {
          if (replace) changeMode(replace)
        }}
      />
    </FieldGroup>
  )
}
function AllowedValues({
  options,
  type,
  disabled,
  onChange,
}: {
  options: JsonValue[]
  type: AuthoringParameter["data_type"]
  disabled: boolean
  onChange: (values: JsonValue[]) => void
}) {
  const [buffer, setBuffer] = useState(() => options.map(String).join("\n"))
  return (
    <Field>
      <FieldLabel htmlFor="allowed-values">Allowed values</FieldLabel>
      <Textarea
        id="allowed-values"
        disabled={disabled}
        value={buffer}
        onChange={(event) => {
          setBuffer(event.target.value)
          const values = event.target.value
            .split("\n")
            .filter((value) => value.trim() !== "")
            .map((value) =>
              ["number", "integer"].includes(type) &&
              Number.isFinite(Number(value))
                ? Number(value)
                : type === "boolean" && ["true", "false"].includes(value)
                  ? value === "true"
                  : value,
            )
          onChange(values)
        }}
      />
      <FieldDescription>
        One {type === "enum" ? "string" : type} value per line. These values
        constrain input and populate choice controls.
      </FieldDescription>
    </Field>
  )
}
export function ParameterPreview({
  parameter,
  revision,
}: {
  parameter: Pick<
    AuthoringParameter,
    "data_type" | "format" | "validation_logic"
  >
  revision: number
}) {
  const studio = useStudio()
  const [sample, setSample] = useState(
    ["enum", "string", "timestamp", "bytes"].includes(parameter.data_type)
      ? '""'
      : parameter.data_type === "boolean"
        ? "false"
        : "0",
  )
  const [previous, setPrevious] = useState("null")
  const [result, setResult] = useState<{
    result: PreviewResult
    source: string
  } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const source = JSON.stringify({ parameter, sample, previous, revision })
  return (
    <FieldGroup>
      <TextField
        label="Sample value (JSON)"
        value={sample}
        onChange={(event) => setSample(event.target.value)}
        help={
          'Use 42, true, or a quoted string such as "blink". This never sends a device command.'
        }
      />
      <TextField
        label="Previous value (JSON)"
        optional
        value={previous}
        onChange={(event) => setPrevious(event.target.value)}
      />
      <Button
        variant="outline"
        type="button"
        disabled={busy || !studio.capabilities.validate}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            const response = await api.previewDeviceProfile(
              studio.org,
              studio.profile.uuid,
              {
                kind: "validation",
                draft_revision: revision,
                parameter,
                value: JSON.parse(sample) as JsonValue,
                previous_value: JSON.parse(previous) as JsonValue,
              },
            )
            setResult({ result: response, source })
          } catch (reason) {
            setError(reason)
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? "Testing…" : "Test sample value"}
      </Button>
      <RequestError error={error} />
      {result && (
        <Alert variant={result.result.valid ? "default" : "destructive"}>
          <AlertTitle>
            {source !== result.source
              ? "Sample result is outdated"
              : result.result.valid
                ? "Sample accepted"
                : "Sample rejected"}
          </AlertTitle>
          <AlertDescription>
            {source !== result.source
              ? "Run the test again after your changes."
              : result.result.valid
                ? "The candidate configuration accepts this value."
                : result.result.diagnostics
                    .map((item) => item.message)
                    .join(" ")}
          </AlertDescription>
        </Alert>
      )}
    </FieldGroup>
  )
}
