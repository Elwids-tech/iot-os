import type { Measurement, SparkplugMetric } from "./devices"

export type TelemetryTrace = {
  parameter_uuid: string
  metric: string
  key: string
  raw: unknown
  converted: unknown
  conversion: {
    source_unit?: string | null
    multiplier?: number | null
    offset?: number | null
  } | null
  unit: string | null
  quality: string
  diagnostic?: string
}
export type TelemetryOutcome = {
  device_uuid: string
  configuration_uuid: string
  status: string
  diagnostic?: string
  stages: TelemetryTrace[] | null
  readings: Measurement[] | null
}
export type TelemetrySample = {
  id: string
  topic: string
  kind: string
  source_device_id: string
  received_at: string
  payload_bytes: number
  wire_base64: string
  seq?: number
  bd_seq?: number
  birth_session?: string
  status: string
  diagnostic?: string
  metrics: SparkplugMetric[] | null
  outcomes: TelemetryOutcome[] | null
}
export type TelemetryCapture = {
  id: string
  scope: {
    organization_uuid: string
    gateway_uuid: string
    connection_uuid: string
    edge_node_id: string
    source_device_id: string | null
    device_uuid?: string
    user_id: number
  }
  started_at: string
  expires_at: string
  purge_at: string
  stopped: boolean
  suspended: boolean
  captured: number
  dropped: number
  samples: TelemetrySample[] | null
}
export type TelemetryDiagnosis = {
  explanation: string
  evidence_ids: string[]
  sample_ids: string[]
  suggested_review: string
  next_check: string
  changes_applied: false
}
