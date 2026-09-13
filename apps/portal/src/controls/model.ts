import {
  configurationProfile,
  type DeviceDetail,
  type DeviceProfileParameter,
} from "@iot-os/api-client"

export type ControlValue = boolean | number | string
export type ControlSpec = {
  kind:
    | "switch"
    | "color"
    | "options"
    | "slider"
    | "number"
    | "text"
    | "unsupported"
  options?: ControlValue[]
  optionControl?: "automatic" | "toggle_group" | "searchable_select"
  suggestions?: ControlValue[]
  min?: number
  max?: number
  step?: number
}

const valueVariable = (value: unknown) =>
  Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).var === "value",
  )

function validationOptions(parameter: DeviceProfileParameter) {
  const rule = parameter.validation?.rule as Record<string, unknown> | undefined
  const membership = rule?.in
  if (
    !Array.isArray(membership) ||
    membership.length !== 2 ||
    !valueVariable(membership[0]) ||
    !Array.isArray(membership[1])
  )
    return undefined

  return membership[1].filter((value: unknown): value is ControlValue => {
    if (parameter.data_type === "boolean") return typeof value === "boolean"
    if (parameter.data_type === "integer") return Number.isSafeInteger(value)
    if (parameter.data_type === "number")
      return typeof value === "number" && Number.isFinite(value)
    if (["enum", "string"].includes(parameter.data_type))
      return typeof value === "string"
    return false
  })
}

function validationRange(parameter: DeviceProfileParameter) {
  const rule = parameter.validation?.rule as Record<string, unknown> | undefined
  const conditions = Array.isArray(rule?.and) ? rule.and : rule ? [rule] : []
  let min: number | undefined, max: number | undefined
  for (const condition of conditions) {
    if (!condition || typeof condition !== "object" || Array.isArray(condition))
      continue
    const node = condition as Record<string, unknown>
    for (const [operator, target] of [
      [">=", "min"],
      ["<=", "max"],
    ] as const) {
      const operands = node[operator]
      if (
        Array.isArray(operands) &&
        operands.length === 2 &&
        valueVariable(operands[0]) &&
        typeof operands[1] === "number" &&
        Number.isFinite(operands[1])
      ) {
        if (target === "min") min = operands[1]
        else max = operands[1]
      }
    }
  }
  return { min, max }
}
export function writableParameters(device?: DeviceDetail) {
  const configuration = device?.configurations.find(
    (c) => c.uuid === device.applied_configuration_uuid,
  )
  return configuration
    ? configurationProfile(configuration).parameters.filter(
        (p) =>
          p.kind === "state" &&
          p.accepts_command &&
          p.reports_state &&
          configuration.definition.mappings.some(
            (m) => m.parameter_uuid === p.uuid && m.command_metric,
          ),
      )
    : []
}
export function controlSpec(parameter: DeviceProfileParameter): ControlSpec {
  const display = parameter.display ?? {}
  const widget = typeof display.widget === "string" ? display.widget : ""
  const options = validationOptions(parameter)
  const optionControl =
    widget === "toggle_group" || widget === "searchable_select"
      ? widget
      : "automatic"
  const usesOptions =
    Boolean(options?.length) &&
    (!widget ||
      widget === "select" ||
      widget === "toggle_group" ||
      widget === "searchable_select")

  if (parameter.data_type === "boolean") return { kind: "switch" }
  if (
    parameter.data_type === "string" &&
    (widget === "color" || (!widget && parameter.format === "hex_color"))
  )
    return { kind: "color" }
  if (widget === "text" && parameter.data_type === "string")
    return { kind: "text" }
  if (parameter.data_type === "enum")
    return options?.length
      ? { kind: "options", options, optionControl }
      : { kind: "unsupported" }

  if (["integer", "number"].includes(parameter.data_type)) {
    if (usesOptions) return { kind: "options", options, optionControl }
    const validation = validationRange(parameter)
    const min =
      validation.min ??
      (typeof display.min === "number" && Number.isFinite(display.min)
        ? display.min
        : undefined)
    const max =
      validation.max ??
      (typeof display.max === "number" && Number.isFinite(display.max)
        ? display.max
        : undefined)
    const step =
      typeof display.step === "number" && display.step > 0
        ? display.step
        : parameter.data_type === "integer"
          ? 1
          : undefined
    return {
      kind:
        widget === "slider" &&
        min !== undefined &&
        max !== undefined &&
        min < max &&
        (parameter.data_type !== "integer" ||
          [min, max, step].every(Number.isSafeInteger))
          ? "slider"
          : "number",
      min,
      max,
      step,
    }
  }
  if (parameter.data_type === "string") {
    if (usesOptions) return { kind: "options", options, optionControl }
    return {
      kind: "text",
      suggestions: Array.isArray(display.options)
        ? display.options.filter((v): v is string => typeof v === "string")
          : undefined,
    }
  }
  return { kind: "unsupported" }
}
export function parseControlValue(
  parameter: DeviceProfileParameter,
  value: string,
): ControlValue {
  let parsed: ControlValue
  if (parameter.data_type === "boolean") {
    if (!["true", "false"].includes(value)) throw new Error("Choose on or off.")
    parsed = value === "true"
  } else if (["number", "integer"].includes(parameter.data_type)) {
    const n = Number(value)
    if (
      !value.trim() ||
      !Number.isFinite(n) ||
      (parameter.data_type === "integer" && !Number.isSafeInteger(n))
    )
      throw new Error("Enter a valid number.")
    parsed = n
  } else {
    parsed = value
  }

  if (
    typeof parsed === "string" &&
    (parameter.format === "hex_color" ||
      parameter.display?.widget === "color")
  ) {
    if (!/^#[0-9a-fA-F]{6}$/.test(value))
      throw new Error("Enter a colour as #RRGGBB.")
    parsed = value.toUpperCase()
  }

  const options = validationOptions(parameter)
  if (options && !options.includes(parsed))
    throw new Error("Choose an allowed value.")
  if (parameter.data_type === "enum" && !options?.length)
    throw new Error("This enum does not define allowed values.")

  if (typeof parsed === "number") {
    const { min, max } = validationRange(parameter)
    if (min !== undefined && parsed < min)
      throw new Error(`Enter a value of at least ${min}.`)
    if (max !== undefined && parsed > max)
      throw new Error(`Enter a value no greater than ${max}.`)
  }
  return parsed
}
export const outstandingCommand = (status: string) =>
  ["prepared", "pending", "sent"].includes(status)
