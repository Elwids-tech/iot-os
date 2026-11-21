import { useState } from "react"
import type {
  DashboardSource,
  DashboardStateColor,
  DeviceDetail,
  DeviceProfileParameter,
} from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@iot-os/ui/components/field"
import { FormSection } from "@iot-os/ui/components/form-fields"
import { Input } from "@iot-os/ui/components/input"
import { PlusIcon } from "lucide-react"
import { validationOptions } from "../controls/model"
import { stateColor, stateLabel } from "../history/model"
import { appliedParameters, MAX_STATE_COLORS, NEUTRAL, TONE_BANDS } from "./model"
import { displayStates, stateFor } from "./profileDisplay"

export type StateChoice = {
  value: string | boolean
  label: string
  /** The colour the profile gives this value, as a hex the colour input can show. */
  profileColor: string
  /** The panel's own colour, when it sets one. */
  color?: string
  /** The profile lists this value; a value typed in the panel is not. */
  listed: boolean
}

const keyOf = (value: string | boolean) => `${typeof value}:${String(value)}`

/**
 * The values a State history source can colour: On and Off for booleans; for enums the
 * profile's allowed values and labelled states, then any value the panel colours itself.
 */
export function stateChoices(
  source: Pick<DashboardSource, "data_type" | "state_colors">,
  parameter?: DeviceProfileParameter,
): StateChoice[] {
  const states = displayStates(parameter)
  const chosen = source.state_colors ?? []
  const listed: (string | boolean)[] =
    source.data_type === "boolean"
      ? [true, false]
      : [
          ...(parameter ? (validationOptions(parameter) ?? []) : []),
          ...states.map((state) => state.value),
        ].filter((value): value is string => typeof value === "string")
  const seen = new Set<string>()
  const values = [...listed, ...chosen.map((entry) => entry.value)].filter((value) => {
    const key = keyOf(value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return values.map((value) => {
    const state = stateFor(states, value)
    return {
      value,
      label: state?.label ?? stateLabel(value, true, source.data_type),
      profileColor:
        state?.tone === "muted"
          ? NEUTRAL.color
          : state?.tone
            ? TONE_BANDS[state.tone]
            : stateColor(value, true, source.data_type),
      color: stateFor(chosen, value)?.color,
      listed: listed.some((item) => keyOf(item) === keyOf(value)),
    }
  })
}

/** State history: a colour per value for the selected parameter, over the profile's tones. */
export function StateColorsSection({
  source,
  device,
  patchSource,
}: {
  source?: DashboardSource
  device?: DeviceDetail
  patchSource: (patch: Partial<DashboardSource>) => void
}) {
  const [draft, setDraft] = useState("")
  if (!source)
    return (
      <FormSection level={2} title="State colours">
        <p className="text-sm text-muted-foreground">
          Add a parameter under Data first.
        </p>
      </FormSection>
    )
  const parameter = appliedParameters(device).find(
    (p) => p.uuid === source.parameter_uuid,
  )
  const choices = stateChoices(source, parameter)
  const chosen = source.state_colors ?? []
  const setColors = (next: DashboardStateColor[]) =>
    patchSource({ state_colors: next.length ? next : undefined })
  const setColor = (value: string | boolean, color: string) =>
    setColors(
      stateFor(chosen, value)
        ? chosen.map((entry) =>
            entry === stateFor(chosen, value) ? { ...entry, color } : entry,
          )
        : [...chosen, { value, color }],
    )
  const clear = (value: string | boolean) =>
    setColors(chosen.filter((entry) => entry !== stateFor(chosen, value)))
  const typed = draft.trim()
  const canAdd =
    typed !== "" &&
    chosen.length < MAX_STATE_COLORS &&
    !choices.some((choice) => String(choice.value) === typed)
  return (
    <FormSection level={2} title="State colours">
      <FieldGroup>
        <FieldDescription>
          Colours for {source.label} on this panel only. Values without a panel
          colour use the device profile's.
        </FieldDescription>
        {choices.length > 0 ? (
          <ul aria-label={`State colours for ${source.label}`} className="flex flex-col border-t">
            {choices.map((choice) => (
              <li
                key={keyOf(choice.value)}
                className="flex min-h-(--row-h) items-center gap-3 border-b py-1"
              >
                <Input
                  type="color"
                  aria-label={`Colour for ${choice.label}`}
                  className="w-12 shrink-0 p-1"
                  value={choice.color ?? choice.profileColor}
                  onChange={(e) => setColor(choice.value, e.target.value)}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{choice.label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {choice.color ? "Panel colour" : "Profile colour"}
                    {choice.label !== String(choice.value) &&
                      ` · ${String(choice.value)}`}
                  </p>
                </div>
                {choice.color && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={
                      choice.listed
                        ? `Use the profile colour for ${choice.label}`
                        : `Remove ${choice.label}`
                    }
                    onClick={() => clear(choice.value)}
                  >
                    {choice.listed ? "Use profile colour" : "Remove"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            The profile lists no values for {source.label}. Add the values it
            reports to colour them.
          </p>
        )}
        {source.data_type !== "boolean" && (
          <form
            className="grid grid-cols-[1fr_auto] items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!canAdd) return
              setColor(typed, stateColor(typed, true, source.data_type))
              setDraft("")
            }}
          >
            <Field>
              <FieldLabel htmlFor="state-color-value">Another value</FieldLabel>
              <Input
                id="state-color-value"
                value={draft}
                maxLength={120}
                placeholder="As the device reports it"
                onChange={(e) => setDraft(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="outline" disabled={!canAdd}>
              <PlusIcon data-icon="inline-start" />
              Add value
            </Button>
          </form>
        )}
      </FieldGroup>
    </FormSection>
  )
}
