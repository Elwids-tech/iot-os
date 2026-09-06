import type { AuthoringParameter, JsonValue } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { FieldGroup, FieldDescription } from "@iot-os/ui/components/field"
import { Choice, TextField } from "../components/forms"

export function PresentationOptions({
  options,
  type,
  disabled,
  onChange,
}: {
  options: JsonValue | undefined
  type: AuthoringParameter["data_type"]
  disabled: boolean
  onChange: (options: JsonValue[]) => void
}) {
  if (
    options !== undefined &&
    (!Array.isArray(options) ||
      options.some(
        (value) => !["string", "number", "boolean"].includes(typeof value),
      ))
  ) {
    return (
      <FieldDescription>
        Custom presentation options are preserved. Edit these in Advanced →
        display config.
      </FieldDescription>
    )
  }
  const values = (options ?? []) as (string | number | boolean)[]
  const numeric = ["number", "integer"].includes(type)
  return (
    <FieldGroup>
      <FieldDescription>
        Suggested choices for this control. These do not restrict input; use
        Validation for allowed values.
      </FieldDescription>
      {values.map((value, index) => (
        <FieldGroup
          className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
          key={index}
        >
          {type === "boolean" ? (
            <Choice
              label={"Display option " + (index + 1)}
              disabled={disabled}
              value={String(value)}
              options={[
                { value: "true", label: "True" },
                { value: "false", label: "False" },
              ]}
              onChange={(next) =>
                onChange(
                  values.map((current, i) =>
                    i === index ? next === "true" : current,
                  ),
                )
              }
            />
          ) : (
            <TextField
              label={"Display option " + (index + 1)}
              disabled={disabled}
              value={String(value)}
              type={numeric ? "number" : "text"}
              step={type === "integer" ? "1" : "any"}
              onChange={(event) =>
                onChange(
                  values.map((current, i) =>
                    i === index
                      ? numeric && event.target.value !== ""
                        ? Number(event.target.value)
                        : event.target.value
                      : current,
                  ),
                )
              }
            />
          )}
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => onChange(values.filter((_, i) => i !== index))}
          >
            Remove option {index + 1}
          </Button>
        </FieldGroup>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() =>
          onChange([...values, numeric ? 0 : type === "boolean" ? false : ""])
        }
      >
        Add display option
      </Button>
    </FieldGroup>
  )
}
