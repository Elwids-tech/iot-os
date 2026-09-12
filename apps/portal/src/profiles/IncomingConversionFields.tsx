import { useState } from "react"
import type { IngressConversion, PreviewResult } from "@iot-os/api-client"
import { FieldGroup, FieldDescription } from "@iot-os/ui/components/field"
import { Button } from "@iot-os/ui/components/button"
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@iot-os/ui/components/alert"
import { Choice, TextField, RequestError } from "../components/forms"

export function conversionEligible(p: {
  kind: string
  data_type: string
  reports_state: boolean
  accepts_command: boolean
}) {
  return (
    ["measurement", "counter"].includes(p.kind) &&
    ["number", "integer"].includes(p.data_type) &&
    p.reports_state &&
    !p.accepts_command
  )
}

export function conversionEquation(c?: IngressConversion | null) {
  return c
    ? `stored value = incoming value × ${c.multiplier} + ${c.offset}`
    : "Stored value equals incoming value"
}

export function IncomingConversionFields({
  value,
  onChange,
  storedUnit,
  dataType,
  eligible = true,
  disabled = false,
  toggle = true,
  onPreset,
  onValidate,
}: {
  value: IngressConversion | null
  onChange: (value: IngressConversion | null) => void
  storedUnit: string | null
  dataType: string
  eligible?: boolean
  disabled?: boolean
  toggle?: boolean
  onPreset?: () => void
  onValidate?: (sample: number) => Promise<PreviewResult>
}) {
  const [sample, setSample] = useState("1000")
  const [checked, setChecked] = useState<{
    key: string
    result: PreviewResult
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const key = JSON.stringify({ value, sample, storedUnit, dataType })
  const input = Number(sample)
  const output = value ? input * value.multiplier + value.offset : input
  const valid =
    sample.trim() !== "" &&
    Number.isFinite(input) &&
    Number.isFinite(output) &&
    (!value ||
      (Number.isFinite(value.multiplier) &&
        value.multiplier !== 0 &&
        Number.isFinite(value.offset))) &&
    (dataType !== "integer" || Number.isSafeInteger(output))
  return (
    <FieldGroup>
      {toggle && (
        <Choice
          label="Incoming value conversion"
          value={value ? "enabled" : "none"}
          disabled={disabled}
          options={[
            { value: "none", label: "No conversion" },
            ...(eligible || value
              ? [{ value: "enabled", label: "Scale and offset" }]
              : []),
          ]}
          onChange={(mode) =>
            onChange(
              mode === "none"
                ? null
                : { source_unit: null, multiplier: 1, offset: 0 },
            )
          }
        />
      )}
      {!eligible && value && (
        <Alert variant="destructive">
          <AlertTitle>
            Conversion is not available for this parameter
          </AlertTitle>
          <AlertDescription>
            Use a read-only numeric measurement or counter, or turn conversion
            off before saving.
          </AlertDescription>
        </Alert>
      )}
      {value && (
        <>
          <TextField
            label="Incoming unit"
            value={value.source_unit ?? ""}
            disabled={disabled}
            placeholder="W"
            help="Use the unit sent by the device. Leave blank for a unitless value."
            onChange={(e) =>
              onChange({ ...value, source_unit: e.target.value || null })
            }
          />
          <FieldDescription>
            Stored unit: {storedUnit || "No unit"}
          </FieldDescription>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Multiplier"
              type="number"
              step="any"
              value={value.multiplier}
              disabled={disabled}
              onChange={(e) =>
                onChange({ ...value, multiplier: e.target.valueAsNumber })
              }
            />
            <TextField
              label="Offset"
              type="number"
              step="any"
              value={value.offset}
              disabled={disabled}
              onChange={(e) =>
                onChange({ ...value, offset: e.target.valueAsNumber })
              }
            />
          </FieldGroup>
          {(onPreset || storedUnit === "kW") && (
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                onChange({ source_unit: "W", multiplier: 0.001, offset: 0 })
                onPreset?.()
              }}
            >
              Use watts → kilowatts
            </Button>
          )}
          <FieldDescription>{conversionEquation(value)}</FieldDescription>
          <TextField
            label="Sample incoming value"
            type="number"
            step="any"
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            disabled={disabled}
          />
          <p role="status" className="text-sm">
            {valid
              ? `Received: ${input} ${value.source_unit ?? ""} → Stored: ${output} ${storedUnit ?? ""}`
              : "Enter finite values. The multiplier must not be zero, and integer outputs cannot contain a fraction."}
          </p>
          {onValidate && (
            <Button
              type="button"
              variant="outline"
              disabled={disabled || busy || !valid || !eligible}
              onClick={async () => {
                setBusy(true)
                setError(null)
                try {
                  setChecked({ key, result: await onValidate(input) })
                } catch (reason) {
                  setError(reason)
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? "Testing…" : "Validate converted sample"}
            </Button>
          )}
          {checked?.key === key && (
            <p role="status" className="text-sm">
              {checked.result.valid
                ? `Validated stored value: ${checked.result.result} ${storedUnit ?? ""}`
                : checked.result.diagnostics.map((d) => d.message).join(" ")}
            </p>
          )}
          <RequestError error={error} />
        </>
      )}
      <FieldDescription>
        Only the converted measurement is stored. Value validation and derived
        calculations use that value. A unit label alone never converts a
        reading.
      </FieldDescription>
    </FieldGroup>
  )
}
