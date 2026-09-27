import type {
  CompiledDeviceProfileDefinition,
  JsonObject,
  JsonValue,
} from "@iot-os/api-client"
export const kindLabel = (kind: string) => kind[0].toUpperCase() + kind.slice(1)
export const jsonText = (value: unknown) =>
  JSON.stringify(value ?? null, null, 2)
export function objectValue(text: string): JsonObject | null {
  const parsed: unknown = JSON.parse(text)
  if (parsed === null) return null
  if (typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Use a JSON object or null.")
  return parsed as JsonObject
}
export function updateConfig(
  text: string,
  field: string,
  value: JsonValue | undefined,
): string {
  const config = { ...(objectValue(text) ?? {}) }
  if (value === undefined) delete config[field]
  else config[field] = value
  return jsonText(Object.keys(config).length ? config : null)
}
export function valueReference(node: JsonValue): boolean {
  return (
    typeof node === "object" &&
    node !== null &&
    !Array.isArray(node) &&
    Object.keys(node).length === 1 &&
    node.var === "value"
  )
}
export type Condition = { operator: string; value: JsonValue }
const conditionOps = ["==", "===", "!=", "!==", ">", ">=", "<", "<="]
function condition(node: JsonValue): Condition | null {
  if (
    !node ||
    typeof node !== "object" ||
    Array.isArray(node) ||
    Object.keys(node).length !== 1
  )
    return null
  const operator = Object.keys(node)[0],
    operands = node[operator]
  if (
    !conditionOps.includes(operator) ||
    !Array.isArray(operands) ||
    operands.length !== 2 ||
    !valueReference(operands[0]) ||
    (typeof operands[1] === "object" && operands[1] !== null)
  )
    return null
  return { operator, value: operands[1] }
}
export type GuidedValidation =
  | { mode: "none" }
  | { mode: "range"; min?: number; max?: number }
  | { mode: "options"; options: JsonValue[] }
  | { mode: "conditions"; join: "and" | "or"; conditions: Condition[] }
  | { mode: "custom" }
export function readValidation(text: string): GuidedValidation {
  let definition: JsonObject | null
  try {
    definition = objectValue(text)
  } catch {
    return { mode: "custom" }
  }
  if (definition === null) return { mode: "none" }
  if (
    definition.engine !== "json_logic" ||
    typeof definition.rule !== "object" ||
    definition.rule === null ||
    Array.isArray(definition.rule)
  )
    return { mode: "custom" }
  const rule = definition.rule
  if (Object.keys(rule).length !== 1) return { mode: "custom" }
  if (
    Array.isArray(rule.in) &&
    rule.in.length === 2 &&
    valueReference(rule.in[0]) &&
    Array.isArray(rule.in[1]) &&
    rule.in[1].every((value) => typeof value !== "object" || value === null)
  )
    return { mode: "options", options: rule.in[1] }
  const join = Array.isArray(rule.or) ? "or" : "and"
  const nodes: JsonValue[] = Array.isArray(rule[join])
    ? (rule[join] as JsonValue[])
    : [rule]
  const conditions = nodes.map(condition)
  if (!conditions.length || conditions.some((item) => !item))
    return { mode: "custom" }
  const known = conditions as Condition[]
  if (
    join === "and" &&
    known.length <= 2 &&
    known.every(
      (item) =>
        [">=", "<="].includes(item.operator) && typeof item.value === "number",
    ) &&
    new Set(known.map((item) => item.operator)).size === known.length
  ) {
    return {
      mode: "range",
      min: known.find((item) => item.operator === ">=")?.value as
        number | undefined,
      max: known.find((item) => item.operator === "<=")?.value as
        number | undefined,
    }
  }
  return { mode: "conditions", join, conditions: known }
}
export function validationSummary(value: GuidedValidation): string {
  if (value.mode === "none")
    return "No extra constraints. Values must still match the selected data type."
  if (value.mode === "custom")
    return "This custom rule needs advanced editing; its complete configuration is preserved."
  if (value.mode === "range")
    return (
      "Allow values " +
      [
        value.min !== undefined ? "at least " + value.min : "",
        value.max !== undefined ? "at most " + value.max : "",
      ]
        .filter(Boolean)
        .join(" and ") +
      " (inclusive)."
    )
  if (value.mode === "options")
    return value.options.length
      ? "Allow only: " +
          value.options
            .slice(0, 8)
            .map((item) => JSON.stringify(item))
            .join(", ") +
          (value.options.length > 8
            ? ", and " + (value.options.length - 8) + " more."
            : ".")
      : "Add allowed values; an empty list accepts no values."
  const words: Record<string, string> = {
    "===": "equals (same type)",
    "==": "equals",
    "!==": "does not equal (same type)",
    "!=": "does not equal",
    ">": "is greater than",
    ">=": "is at least",
    "<": "is less than",
    "<=": "is at most",
  }
  return (
    (value.join === "and" ? "All must match: " : "At least one must match: ") +
    value.conditions
      .map(
        (item) =>
          "value " + words[item.operator] + " " + JSON.stringify(item.value),
      )
      .join("; ") +
    "."
  )
}
export function validationRule(text: string, rule: JsonObject | null): string {
  if (!rule) return "null"
  const current = objectValue(text) ?? {}
  return jsonText({
    ...current,
    engine: "json_logic",
    diagnostic_code: current.diagnostic_code ?? "value_out_of_range",
    message:
      current.message ??
      "The value does not satisfy this parameter's constraints.",
    rule,
  })
}
export function rangeRule(min?: number, max?: number): JsonObject | null {
  const rules: JsonObject[] = []
  if (min !== undefined) rules.push({ ">=": [{ var: "value" }, min] })
  if (max !== undefined) rules.push({ "<=": [{ var: "value" }, max] })
  return rules.length === 2 ? { and: rules } : (rules[0] ?? null)
}
export function isArithmetic(node: JsonValue, depth = 0): boolean {
  if (depth > 20) return false
  if (typeof node === "number") return Number.isFinite(node)
  if (
    !node ||
    typeof node !== "object" ||
    Array.isArray(node) ||
    Object.keys(node).length !== 1
  )
    return false
  if (typeof node.var === "string") return true
  const operator = Object.keys(node)[0],
    operands = node[operator]
  return (
    ["+", "-", "*", "/"].includes(operator) &&
    Array.isArray(operands) &&
    operands.length >= 2 &&
    operands.every((operand) => isArithmetic(operand, depth + 1))
  )
}
export type ArtifactChange = {
  area: string
  label: string
  change: string
  before?: unknown
  after?: unknown
}
export function artifactChanges(
  previous: CompiledDeviceProfileDefinition | null,
  next: CompiledDeviceProfileDefinition,
): ArtifactChange[] {
  const changes: ArtifactChange[] = []
  if (
    !previous ||
    ["name", "code", "category"].some(
      (key) =>
        JSON.stringify(
          previous.profile[key as keyof typeof previous.profile],
        ) !== JSON.stringify(next.profile[key as keyof typeof next.profile]),
    )
  )
    changes.push({
      area: "Profile",
      label: next.profile.name,
      change: previous ? "Updated" : "New profile",
      before: previous
        ? {
            name: previous.profile.name,
            code: previous.profile.code,
            category: previous.profile.category,
          }
        : undefined,
      after: {
        name: next.profile.name,
        code: next.profile.code,
        category: next.profile.category,
      },
    })
  for (const area of [
    "parameters",
    "calculations",
    "alarm_templates",
  ] as const) {
    const identity = (item: Record<string, unknown>) =>
      String(item.uuid ?? item.target_parameter_uuid)
    const before = new Map(
      (previous?.[area] ?? []).map((item) => [
        identity(item as unknown as Record<string, unknown>),
        item,
      ]),
    )
    const after = new Map(
      next[area].map((item) => [
        identity(item as unknown as Record<string, unknown>),
        item,
      ]),
    )
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      const old = before.get(key),
        fresh = after.get(key)
      if (JSON.stringify(old) === JSON.stringify(fresh)) continue
      const item = (fresh ?? old) as unknown as Record<string, unknown>
      changes.push({
        area: area.replace("_", " "),
        label: String(
          item.label ??
            item.name ??
            next.parameters.find(
              (parameter) => parameter.uuid === item.target_parameter_uuid,
            )?.label ??
            key,
        ),
        change: !old ? "Added" : !fresh ? "Removed" : "Updated",
        before: old,
        after: fresh,
      })
    }
  }
  if (
    previous &&
    JSON.stringify(previous.parameters.map((parameter) => parameter.uuid)) !==
      JSON.stringify(next.parameters.map((parameter) => parameter.uuid))
  )
    changes.push({
      area: "Parameters",
      label: "Parameter order",
      change: "Updated",
      before: { order: previous.parameters.map((parameter) => parameter.label) },
      after: { order: next.parameters.map((parameter) => parameter.label) },
    })
  return changes
}
/** Short rule for tables: "Between 0 and 480", "3 allowed values", "Custom rule". */
export function ruleLabel(value: GuidedValidation): string {
  if (value.mode === "none") return "None"
  if (value.mode === "custom") return "Custom rule"
  if (value.mode === "range")
    return value.min !== undefined && value.max !== undefined
      ? `Between ${value.min} and ${value.max}`
      : value.min !== undefined
        ? `At least ${value.min}`
        : `At most ${value.max}`
  const count =
    value.mode === "options" ? value.options.length : value.conditions.length
  const noun = value.mode === "options" ? "allowed value" : "condition"
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}
const symbols: Record<string, string> = { "+": "+", "-": "-", "*": "×", "/": "/" }
function formula(node: JsonValue, nested: boolean): string {
  if (typeof node === "number") return String(node)
  const object = node as JsonObject
  if (typeof object.var === "string") return object.var
  const operator = Object.keys(object)[0]
  const text = (object[operator] as JsonValue[])
    .map((operand) => formula(operand, true))
    .join(` ${symbols[operator]} `)
  return nested ? `(${text})` : text
}
/** Arithmetic formula as text, "(l1 + l2) / 2"; null for expressions the builder can't show. */
export const formulaText = (node: JsonValue) =>
  isArithmetic(node) ? formula(node, false) : null
const fieldLabels: Record<string, string> = {
  name: "Name",
  code: "Code",
  category: "Category",
  key: "Key",
  label: "Label",
  kind: "Kind",
  data_type: "Data type",
  format: "Display format",
  unit: "Stored unit",
  reports_state: "Reports state",
  accepts_command: "Accepts commands",
  ingress_conversion: "Incoming conversion",
  validation: "Validation rule",
  "validation.rule": "Value constraints",
  "validation.message": "Message",
  "validation.diagnostic_code": "Issue code",
  display: "Display settings",
  "display.widget": "Control",
  "display.precision": "Decimals",
  "display.step": "Input step",
  reporting: "Reporting settings",
  "reporting.stale_after_seconds": "Stale after (seconds)",
  counter: "Counter settings",
  "counter.monotonic": "Counter normally increases",
  "counter.reset_behavior": "When the counter resets",
  expression: "Formula",
  inputs: "Inputs",
  trigger: "Runs",
  failure_policy: "On failure",
  type: "Type",
  severity: "Suggested severity",
  enabled_by_default: "On by default",
  condition: "Condition",
  "condition.max_age_seconds": "Maximum age (seconds)",
  parameters: "Parameters",
  order: "Order",
}
export type FieldChange = {
  area: string
  item: string
  field: string
  /** Technical key, shown on hover. */
  path: string
  before: string
  after: string
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const shown = (value: unknown) =>
  value === undefined || value === null
    ? "None"
    : typeof value === "string"
      ? value
      : JSON.stringify(value)
/** One row per changed field; nested settings objects go one level deeper (display.precision). */
export function fieldChanges(changes: ArtifactChange[]): FieldChange[] {
  return changes.flatMap((change) => {
    const row = (path: string, before: unknown, after: unknown) => ({
      area: change.area,
      item: change.label,
      field: fieldLabels[path] ?? path,
      path,
      before: shown(before),
      after: shown(after),
    })
    if (!isObject(change.before) || !isObject(change.after))
      return [{ ...row("", undefined, undefined), field: change.change, before: "", after: "" }]
    const differs = (a: unknown, b: unknown) =>
      JSON.stringify(a) !== JSON.stringify(b)
    const keys = (a: Record<string, unknown>, b: Record<string, unknown>) =>
      [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
        (key) => key !== "uuid" && differs(a[key], b[key]),
      )
    const { before, after } = change
    return keys(before, after).flatMap((key) => {
      const old = before[key],
        fresh = after[key]
      if ((isObject(old) || old == null) && (isObject(fresh) || fresh == null)) {
        const a = isObject(old) ? old : {},
          b = isObject(fresh) ? fresh : {}
        const nested = keys(a, b)
        if (nested.length)
          return nested.map((inner) => row(key + "." + inner, a[inner], b[inner]))
      }
      return [row(key, old, fresh)]
    })
  })
}
