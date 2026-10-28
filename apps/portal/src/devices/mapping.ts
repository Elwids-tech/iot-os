import {
  ApiError,
  type DeviceDefinition,
  type DeviceDraft,
  type DeviceMapping,
  type DeviceProfileParameter,
  type IngressConversion,
  type SparkplugMetric,
} from "@iot-os/api-client"

type Parameter = Pick<
  DeviceProfileParameter,
  "uuid" | "key" | "label" | "data_type" | "ingress_conversion"
>

const integers = ["Int8", "Int16", "Int32", "Int64", "UInt8", "UInt16", "UInt32", "UInt64"]
const strings = ["String", "Text", "UUID"]
// Mirrors DeviceConfigurationService::compile, which rejects any other pairing.
const accepted: Record<DeviceProfileParameter["data_type"], string[]> = {
  boolean: ["Boolean"],
  integer: integers,
  number: ["Float", "Double", ...integers],
  enum: strings,
  string: strings,
  timestamp: ["DateTime"],
  bytes: ["Bytes"],
}

/** Whether a Sparkplug datatype can feed the parameter; a conversion lets floats feed integers. */
export function metricFits(
  parameter: Parameter,
  datatype: string,
  converted = Boolean(parameter.ingress_conversion),
) {
  return (
    accepted[parameter.data_type].includes(datatype) ||
    (converted && parameter.data_type === "integer" && ["Float", "Double"].includes(datatype))
  )
}

/** The parameter type a Sparkplug datatype reads as natively. */
function nativeType(datatype: string) {
  if (integers.includes(datatype)) return "integer"
  if (datatype === "Float" || datatype === "Double") return "number"
  return Object.entries(accepted).find(([, types]) => types.includes(datatype))?.[0]
}

const normalize = (value: string) => value.toLowerCase().replace(/[\s._-]/g, "")

/** Metrics whose name matches a parameter's label or key and whose type fits it. */
export function autoMatches(
  parameters: Parameter[],
  metrics: SparkplugMetric[],
): DeviceMapping[] {
  return parameters.flatMap((p) => {
    const metric = metrics.find(
      (m) =>
        (normalize(m.name) === normalize(p.label) || normalize(m.name) === normalize(p.key)) &&
        metricFits(p, m.datatype),
    )
    return metric ? [{ parameter_uuid: p.uuid, metric: metric.name, command_metric: null }] : []
  })
}

/** True when the mapping is exactly the automatic match, with no command or conversion added. */
export function isAutoMatch(mapping: DeviceMapping | undefined, match: DeviceMapping | undefined) {
  return Boolean(
    mapping &&
      match &&
      mapping.metric === match.metric &&
      !mapping.command_metric &&
      (mapping.conversion_mode ?? "profile") === "profile",
  )
}

/**
 * Units only matter when the source is not already in the stored form: the profile declares an
 * incoming conversion, the source type differs from the parameter's, or the device sets its own.
 * Discovered Sparkplug metrics carry no unit, so the profile's incoming unit stands in for it.
 */
export function conversionMatters(
  parameter: Parameter,
  mapping: DeviceMapping,
  metric: SparkplugMetric | undefined,
) {
  return (
    (mapping.conversion_mode ?? "profile") !== "profile" ||
    Boolean(parameter.ingress_conversion) ||
    (metric !== undefined && nativeType(metric.datatype) !== parameter.data_type)
  )
}

/** "× 0.1 + 0", the short form for a row; the full equation lives in the expanded fields. */
export function conversionShort(conversion: IngressConversion | null | undefined) {
  if (!conversion) return null
  const from = conversion.source_unit ? `from ${conversion.source_unit} ` : ""
  return `${from}× ${conversion.multiplier} + ${conversion.offset}`
}

export type DraftProblems = {
  /** Messages by parameter UUID and the control they belong to. */
  rows: Record<string, Partial<Record<"metric" | "command" | "conversion", string>>>
  general: string[]
}

/**
 * Splits a 422 from saving or checking a draft into messages per mapping row and the rest. The
 * API keys mapping errors by position (`mappings.2.command_metric`) or, for parameters with no
 * mapping, by parameter UUID (`mappings.<uuid>`).
 */
export function draftProblems(reason: unknown, mappings: DeviceMapping[]): DraftProblems | null {
  if (!(reason instanceof ApiError) || reason.status !== 422) return null
  const payload = reason.payload as { message?: string; errors?: Record<string, string[]> } | null
  const problems: DraftProblems = { rows: {}, general: [] }
  for (const [key, messages] of Object.entries(payload?.errors ?? {})) {
    const match = /^mappings\.([^.]+)(?:\.(.+))?$/.exec(key)
    const uuid = match && (/^\d+$/.test(match[1]) ? mappings[Number(match[1])]?.parameter_uuid : match[1])
    if (!match || !uuid) {
      problems.general.push(...messages)
      continue
    }
    const field = match[2]?.startsWith("command")
      ? "command"
      : match[2] && /conversion/.test(match[2])
        ? "conversion"
        : "metric"
    const row = (problems.rows[uuid] ??= {})
    row[field] = [row[field], ...messages].filter(Boolean).join(" ")
  }
  if (!problems.general.length && !Object.keys(problems.rows).length)
    problems.general.push(payload?.message ?? "The configuration has problems.")
  return problems
}

/** Whether the draft says the same as a compiled configuration, so applying it changes nothing. */
export function sameConfiguration(draft: DeviceDraft, definition: DeviceDefinition | undefined) {
  if (!definition) return false
  const rows = (mappings: DeviceMapping[]) =>
    JSON.stringify(
      mappings
        .map((m) => {
          const mode = m.conversion_mode ?? "profile"
          const c = mode === "custom" ? m.ingress_conversion : null
          return [
            m.parameter_uuid,
            m.metric,
            m.command_metric ?? null,
            mode,
            c ? [c.source_unit, c.multiplier, c.offset] : null,
          ]
        })
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    )
  return (
    draft.artifact_uuid === definition.profile_artifact_uuid &&
    draft.candidate_uuid === definition.source.candidate_uuid &&
    draft.birth_revision === definition.birth_revision &&
    rows(draft.mappings) === rows(definition.mappings)
  )
}
