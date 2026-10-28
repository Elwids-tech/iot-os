export type TrailWindow = "1h" | "6h" | "24h" | "7d"

export interface LocationBinding {
  schema_version: "location-binding.v1"
  uuid: string
  revision: number
  organization_uuid: string
  device_uuid: string
  device_name: string
  configuration_uuid: string
  generation: number
  latitude_parameter_uuid: string
  longitude_parameter_uuid: string
  accuracy_parameter_uuid: string | null
  pairing: "same_event"
  max_age_seconds: number
  max_future_skew_seconds: number
  allow_unknown_accuracy: boolean
}

/** Saves a device's binding; `revision` is the saved binding's (0 for a new one), so a concurrent edit gets 409. */
export type LocationBindingInput = Pick<
  LocationBinding,
  | "revision"
  | "configuration_uuid"
  | "latitude_parameter_uuid"
  | "longitude_parameter_uuid"
  | "accuracy_parameter_uuid"
  | "max_age_seconds"
  | "max_future_skew_seconds"
  | "allow_unknown_accuracy"
>

export interface LocationPoint {
  latitude: number
  longitude: number
  accuracy_metres: number | null
}

export interface LocationFix {
  event_id: string
  status: "valid" | "unknown"
  reason: string
  observed_at: string | null
  received_at: string | null
  historical: boolean
  live_eligible: boolean
  point: LocationPoint | null
}

export interface LocationTrailPoint {
  event_id: string
  observed_at: string | null
  received_at: string | null
  historical: boolean
  point: LocationPoint
}

export interface LocationMapDevice {
  device_uuid: string
  device_name: string
  binding_uuid: string
  latest: LocationFix | null
  condition: "inside" | "outside" | "unknown"
  active: boolean
  wandering: boolean
  active_alert: { uuid: string; activated_at: string } | null
  assignment_status: string | null
  deployment_status: string | null
  trail: { segments: LocationTrailPoint[][]; sampled: boolean }
}

export interface GeofencePolicy {
  outside_for_seconds: number
  max_gap_seconds: number
  minimum_samples: number
  uncertainty_metres: number
}

export interface GeofenceAssignment {
  uuid: string
  device: { uuid: string; name: string; code: string }
  workflow_uuid: string
  policy: GeofencePolicy
  desired_geofence_revision: number
  applied_geofence_revision: number | null
  status: string
  diagnostic: string | null
  deployment_status: string
}

export interface Geofence {
  uuid: string
  name: string
  geometry: { type: "Polygon"; coordinates: number[][][] }
  revision: number
  assignments: GeofenceAssignment[]
  created_at: string
  updated_at: string
}

export interface GeofenceActivationBatch {
  uuid: string
  geofence_revision: number
  status: "pending" | "partial_failure" | "succeeded"
  items: Array<{ id: number; assignment_uuid: string; device_uuid: string; operation_uuid: string; target: string; status: string; diagnostic: string | null }>
  created_at: string
  updated_at: string
}

export interface GeofenceEvent {
  uuid: string
  geofence_uuid: string
  geofence_name: string
  assignment_uuid: string
  device_uuid: string
  type: "entered" | "exited" | "wandering_started" | "wandering_resolved"
  source_event_uuid: string | null
  occurred_at: string
}

export interface LocationMapSnapshot {
  schema_version: "location-map.v1"
  trail_window: TrailWindow
  geofence: Pick<Geofence, "uuid" | "name" | "geometry" | "revision"> | null
  devices: LocationMapDevice[]
}

export interface GeofenceInput {
  operation_uuid: string
  expected_revision: number
  name: string
  geometry: Geofence["geometry"]
  assignments: Array<{ device_uuid: string; policy: GeofencePolicy }>
}
