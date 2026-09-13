import { useId, useRef, useState } from "react"
import type { DeviceProfileParameter } from "@iot-os/api-client"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { Switch } from "@iot-os/ui/components/switch"
import { Slider } from "@iot-os/ui/components/slider"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@iot-os/ui/components/toggle-group"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { Button } from "@iot-os/ui/components/button"
import { controlSpec, parseControlValue, type ControlValue } from "./model"

/** Presentation only: edits never overwrite reported state or initiate network reads. */
export function ParameterControl({
  parameter,
  reported,
  pending,
  disabled,
  onCommit,
  onDirty,
}: {
  parameter: DeviceProfileParameter
  reported: unknown
  pending?: unknown
  disabled: boolean
  onCommit: (value: ControlValue) => Promise<void>
  onDirty?: (dirty: boolean) => void
}) {
  const id = useId(),
    spec = controlSpec(parameter)
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")
  const [sending, setSending] = useState(false)
  const lock = useRef(false),
    committed = useRef<string | null>(null)
  const blocked = disabled || sending || pending !== undefined
  const value = draft ?? String(pending ?? reported ?? "")
  function edit(next: string) {
    committed.current = null
    setDraft(next)
    onDirty?.(true)
    setError("")
  }
  function discard() {
    setDraft(null)
    setError("")
    onDirty?.(false)
  }
  async function commit(next: string) {
    if (blocked || lock.current || committed.current === next) return
    try {
      const parsed = parseControlValue(parameter, next)
      if (parsed === reported) {
        committed.current = next
        discard()
        return
      }
      lock.current = true
      setSending(true)
      setError("")
      committed.current = next
      await onCommit(parsed)
      discard()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not send this change.",
      )
    } finally {
      lock.current = false
      setSending(false)
    }
  }
  const inputEvents = {
    onBlur: () => {
      if (draft !== null) void commit(draft)
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault()
        void commit(value)
      }
      if (event.key === "Escape") {
        event.preventDefault()
        discard()
      }
    },
  }
  return (
    <FieldGroup>
      <Field data-disabled={blocked} data-invalid={Boolean(error)}>
        <FieldLabel
          htmlFor={id}
          className="group-data-[disabled=true]/field:opacity-100"
        >
          {parameter.label}
          {parameter.unit ? ` (${parameter.unit})` : ""}
        </FieldLabel>
        {spec.kind === "switch" && (
          <div className="flex items-center gap-3">
            <Switch
              id={id}
              checked={value === "true"}
              disabled={blocked}
              onCheckedChange={(checked) => {
                committed.current = null
                void commit(String(checked))
              }}
            />
            <span className="text-sm">{value === "true" ? "On" : "Off"}</span>
          </div>
        )}
        {spec.kind === "options" &&
          (spec.optionControl === "toggle_group" ||
          (spec.optionControl === "automatic" && spec.options!.length <= 7) ? (
            <ToggleGroup
              type="single"
              variant="outline"
              aria-label={parameter.label}
              value={JSON.stringify(parseOption(value))}
              disabled={blocked}
              onValueChange={(next) => {
                if (next) {
                  committed.current = null
                  void commit(String(JSON.parse(next)))
                }
              }}
              className="flex-wrap"
            >
              {spec.options!.map((option) => (
                <ToggleGroupItem
                  key={JSON.stringify(option)}
                  value={JSON.stringify(option)}
                  aria-label={String(option)}
                >
                  {String(option)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          ) : (
            <SearchableSelect
              label={parameter.label}
              value={value}
              disabled={blocked}
              search={search}
              onSearchChange={setSearch}
              options={spec
                .options!.filter((o) =>
                  String(o).toLowerCase().includes(search.toLowerCase()),
                )
                .map((o) => ({ value: String(o), label: String(o) }))}
              onChange={(next) => {
                committed.current = null
                void commit(next)
              }}
            />
          ))}
        {spec.kind === "slider" && (
          <Slider
            aria-label={parameter.label}
            disabled={blocked}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={[Number(value) || 0]}
            onValueChange={([next]) => edit(String(next))}
            onValueCommit={([next]) => void commit(String(next))}
          />
        )}
        {spec.kind === "color" && (
          <Input
            type="color"
            ref={(element) => {
              if (!element) return
              // React coalesces input/change for colour inputs; listen to the
              // native completion event so closing the picker commits once.
              const finished = () => void commit(element.value.toUpperCase())
              element.addEventListener("change", finished)
              return () => element.removeEventListener("change", finished)
            }}
            aria-label={`${parameter.label} picker`}
            disabled={blocked}
            value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
            onChange={(event) => {
              const next = event.target.value.toUpperCase()
              edit(next)
            }}
            {...inputEvents}
            className="h-10 w-20 cursor-pointer p-1"
          />
        )}
        {["slider", "number", "color", "text"].includes(spec.kind) && (
          <Input
            id={id}
            aria-invalid={Boolean(error)}
            disabled={blocked}
            type={["slider", "number"].includes(spec.kind) ? "number" : "text"}
            step={spec.step ?? "any"}
            min={spec.min}
            max={spec.max}
            maxLength={spec.kind === "color" ? 7 : undefined}
            placeholder={spec.kind === "color" ? "#RRGGBB" : undefined}
            value={value}
            onChange={(event) => edit(event.target.value)}
            {...inputEvents}
          />
        )}
        {spec.kind === "unsupported" && (
          <FieldDescription>
            This parameter type does not have an interactive control.
          </FieldDescription>
        )}
        {draft !== null && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onPointerDown={(event) => event.preventDefault()}
            onClick={discard}
          >
            Cancel edit
          </Button>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </Field>
    </FieldGroup>
  )
  function parseOption(text: string) {
    return spec.options?.find((o) => String(o) === text) ?? text
  }
}
