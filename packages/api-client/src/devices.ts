import type {
  CompiledDeviceProfileDefinition,
  DeviceProfileArtifact,
} from "./index"

export type DeviceCapabilities = {
  view: boolean
  manage: boolean
  connections: boolean
  activate: boolean
  command: boolean
}
export type DevicePresence = "unseen" | "online" | "offline" | "unknown"
export type SparkplugMetric = {
  name: string
  datatype: string
  value: unknown
  alias?: number
  timestamp?: string
  historical?: boolean
  is_null?: boolean
  diagnostic?: string
}
export type SparkplugConnection = {
  uuid: string
  name: string
  group_id: string
  host_id: string
  status: "provisioning" | "ready" | "failed"
  diagnostic: string | null
}
export type Gateway = {
  uuid: string
  name: string
  edge_node_id: string
  connection_uuid: string
  group_id: string
  presence: DevicePresence
  last_seen_at: string | null
  sources_count: number
}
export type DiscoveryCandidate = {
  assigned_device_uuid: string | null
  /** Device whose guided setup targets this source before it is reserved; null once assigned. */
  setup_device_uuid?: string | null
  uuid: string
  source_device_id: string
  status: "pending" | "approved" | "rejected"
  presence: DevicePresence
  session_id: string | null
  birth_revision: number
  metrics: SparkplugMetric[]
  last_seen_at: string | null
  gateway: Gateway
  /** Set when a device adapter's gateway reported the source: activate it there by its serial. */
  adapter?: { uuid: string; name: string; candidate_uuid: string | null; serial: string | null } | null
}
export type DeviceMapping = {
  conversion_mode?: "profile" | "custom" | "none"
  ingress_conversion?: import("./index").IngressConversion | null
  parameter_uuid: string
  metric: string
  command_metric: string | null
  datatype?: string
  command_datatype?: string | null
}
export type DeviceDraft = {
  artifact_uuid: string
  candidate_uuid: string | null
  birth_revision: number | null
  mappings: DeviceMapping[]
}
export type DeviceDefinition = {
  schema_version: "device-configuration.v1" | "device-configuration.v2"
  configuration_uuid: string
  device_uuid: string
  organization_uuid: string
  profile_artifact_uuid: string
  profile_hash: string
  profile_canonical_json: string
  birth_revision: number
  source: {
    connection_uuid: string
    candidate_uuid: string
    group_id: string
    edge_node_id: string
    device_id: string
  }
  mappings: DeviceMapping[]
}
export type DeviceConfiguration = {
  uuid: string
  revision: number
  definition_hash: string
  definition: DeviceDefinition
  profile_artifact_uuid: string | null
  profile_uuid: string | null
  profile_name: string | null
  profile_revision: number | null
  created_at: string
}
export type DeviceOperation = {
  uuid: string
  target_state: "active" | "inactive"
  kind: "resume" | "deactivate" | "configure" | "rollback" | "legacy"
  generation: number
  configuration_uuid: string | null
  status: "pending" | "succeeded" | "failed"
  diagnostic: string | null
  created_at: string
  completed_at: string | null
}
export type DeviceLifecycleRequest = {
  operation_uuid: string
  target_state: "active" | "inactive"
  expected_generation: number
}
export type DeviceOperationResponse = {
  data: DeviceDetail
  operation: DeviceOperation
}
export type Device = {
  state_revision: number
  last_applied_configuration_uuid: string | null
  operation: DeviceOperation | null
  uuid: string
  code: string
  name: string
  serial_number: string | null
  description: string | null
  lifecycle: "registered" | "active" | "deactivated" | "archived"
  presence: DevicePresence
  deployment_status: "idle" | "pending" | "applied" | "failed" | "inactive"
  draft_revision: number
  deployment_generation: number
  desired_configuration_uuid: string | null
  applied_configuration_uuid: string | null
  diagnostic: string | null
  last_seen_at: string | null
  candidate: DiscoveryCandidate | null
  /** Profile of the applied configuration, else of the last one the runtime confirmed. */
  profile: { uuid: string; name: string; revision: number } | null
  /** Calendar periods use the site's time zone, else the organization's. */
  site?: { uuid: string; name: string; timezone: string } | null
  tags?: string[]
  attributes?: Record<string, DeviceAttributeValue>
}
export type DeviceAttributeValue = string | number | boolean | null
/** A physical location whose IANA time zone cuts days, months and shifts. */
export type Site = {
  uuid: string
  name: string
  timezone: string
  address: string | null
  latitude: number | null
  longitude: number | null
  devices_count?: number | null
}
export type SiteInput = {
  name: string
  timezone: string
  address?: string | null
  latitude?: number | null
  longitude?: number | null
}
export type DeviceDetail = Device & {
  /** IANA zone that cuts days and months: the site's, else the organization's, else UTC. */
  reporting_timezone?: string
  installations?: {uuid: string; manufacturer_serial: string; adapter_revision_uuid: string; started_at: string; ended_at: string | null}[]
  retention: RetentionSetting
  draft: DeviceDraft | null
  draft_artifact: DeviceProfileArtifact | null
  configurations: DeviceConfiguration[]
}
export type DeviceInput = {
  name: string
  code: string
  serial_number?: string | null
  description?: string | null
  site_uuid?: string | null
  tags?: string[]
  attributes?: Record<string, DeviceAttributeValue>
}
export type Measurement = {
  installation_uuid?: string
  adapter_revision_uuid?: string
  manufacturer_serial?: string
  parameter_uuid: string
  key: string
  label: string
  data_type: string
  unit: string | null
  value: unknown
  quality: "good" | "stale" | "invalid" | "inactive"
  diagnostic?: string
  observed_at: string
  received_at: string
  last_valid_received_at?: string
  historical: boolean
}
export type HistorySeries = {
  /** The newest configuration in the series. */
  configuration_uuid: string
  unit: string | null
  data_type: string
  /** Configuration revisions joined into this series, oldest first, with where each starts. */
  configurations?: Array<{ configuration_uuid: string; from: string }>
  points: Array<{
    at: string
    value: unknown
    min?: number
    max?: number
    count: number
  }>
}
export type HistoryRecord = {
  installation_uuid?: string
  adapter_revision_uuid?: string
  manufacturer_serial?: string
  event_uuid: string
  configuration_uuid: string
  parameter_uuid: string
  received_at: string
  observed_at: string
  data_type: string
  unit: string | null
  value: unknown
  quality: "good" | "stale" | "invalid" | "inactive" | string
  diagnostic?: string
}
export type HistoryRecordsMeta = {
  from: string
  to: string
  limit: number
  page_size: number
  returned: number
  consumed: number
  next_cursor: string | null
  has_more: boolean
  limit_reached: boolean
}
export type HistoryRecordsPage = {
  data: HistoryRecord[]
  meta: HistoryRecordsMeta
}
export type StateHistorySegment = {
  from: string
  to: string
  value: unknown
  known: boolean
  data_type?: string
  configuration_uuid?: string
}
export type StateHistoryDuration = {
  value: unknown
  known: boolean
  data_type?: string
  duration_ms: number
  percentage: number
}
export type StateHistory = {
  from: string
  to: string
  durations: StateHistoryDuration[]
  timeline: StateHistorySegment[]
  sampled: boolean
}
export type UnitDefinition = {
  symbol: string
  name: string
  quantity: string
  /** value_in_base = value * factor + offset */
  factor: number
  offset: number
  aliases: string[]
}
export type UnitCatalogue = {
  quantities: Record<string, { label: string; base: string }>
  units: UnitDefinition[]
}
export type CounterBucket = "15m" | "1h" | "1d" | "1w" | "1mo" | "1y"
/** Counter consumption per calendar bucket. Days and months start in `timezone`. */
export type CounterIncrease = {
  from: string
  to: string
  bucket: CounterBucket
  timezone: string
  unit: string | null
  points: Array<{
    at: string
    increase: number
    samples: number
    /** Decreases treated as a reset or rollover within this bucket. */
    resets: number
    /** The bucket extends outside the requested range or into the future. */
    partial: boolean
  }>
}
export type DeviceCommand = {
  actor_name: string
  uuid: string
  configuration_uuid: string
  parameter_uuid: string
  value: unknown
  status:
    | "prepared"
    | "pending"
    | "sent"
    | "observed"
    | "failed"
    | "timed_out"
    | "uncertain"
    | "already_at_target"
    | "cancelled"
  confirmed_at: string | null
  expires_at: string
  sent_at: string | null
  completed_at: string | null
  diagnostic: string | null
  created_at: string
}
export type RetentionSetting = {
  cleanup?: {
    at: string
    status: string
    deleted_rows: number
    diagnostic: string
  } | null
  cleanup_failures?: number
  days: number
  source: "default" | "platform" | "organization"
  override_days: number | null
  revision: number
  platform_days: number
  cutoff: string
}
export type DeviceValidation = {
  draft_revision: number
  definition: DeviceDefinition
  preview: { valid: boolean; readings: Measurement[] }
}
export function configurationProfile(
  configuration: DeviceConfiguration,
): CompiledDeviceProfileDefinition {
  return JSON.parse(
    configuration.definition.profile_canonical_json,
  ) as CompiledDeviceProfileDefinition
}

export type DeviceDirectoryMeta = {
  current_page: number
  last_page: number
  total: number
}
export type DeviceDirectoryQuery = {
  search?: string
  page?: number
  per_page?: number
  gateway_uuid?: string
  /** Discovery only: pending sources that no device has reserved or claimed in setup. */
  available?: 1
  /** Discovery candidates only. */
  status?: DiscoveryCandidate["status"]
  /** Discovery candidates only: sources no device has reserved yet. */
  unassigned?: boolean
}
