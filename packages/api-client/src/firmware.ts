/** Firmware starters, connection settings and full kits (spec 027). */

export type FirmwareTargetKind = "built" | "ai_assisted"
export type FirmwareRole = "direct" | "gateway"

/** A target a starter can be built for. Built targets have a tested example; AI-assisted ones have port templates. */
export type FirmwareTarget = {
  id: string
  name: string
  kind: FirmwareTargetKind
  roles: FirmwareRole[]
  /** The toolchain CI builds the target's starters with; null for AI-assisted targets. */
  toolchain: string | null
}

export type StarterManifestMetric = {
  key: string
  datatype: "Boolean" | "Int64" | "Double" | "String" | "DateTime" | "Bytes"
  unit: string | null
  writable: boolean
  introduced_in: number
  changed_in: number | null
}

export type StarterManifestProfile = {
  code: string
  c_identifier: string
  name: string
  revision: number
  artifact_uuid: string
}

/** iotos-starter.json (contracts/firmware/v1/starter-manifest.schema.json). */
export type StarterManifest = {
  format: 1
  sdk_version: string
  target: { id: string; kind: FirmwareTargetKind; name: string }
  role: FirmwareRole
  generated_at: string
  node: ({ default_health: false } & StarterManifestProfile) | { default_health: true; c_identifier: "gateway_health" }
  device_types: StarterManifestProfile[]
  metrics: Record<string, StarterManifestMetric[]>
  retired: Record<string, { key: string; retired_in: number }[]>
  replaceable: string[]
  developer_paths: string[]
  warnings: { code: "birth_over_tx_buffer"; message: string; subject: string }[]
}

/** A ZIP to save. Settings carry no manifest. */
export type FirmwareArchive = {
  filename: string
  manifest: StarterManifest | null
  archive_base64: string
}

export type FirmwareStarterInput = {
  target: string
  role: FirmwareRole
  /** A published artifact; null for a gateway using the SDK's default health table. */
  node_artifact_uuid?: string | null
  /** Gateway only: one to eight published artifacts. */
  device_type_artifact_uuids?: string[]
  /** Saves the choices on this gateway; needs Device.manage-connections. */
  gateway_uuid?: string
}

/** A gateway's saved firmware choices, without profiles the viewer may not see. */
export type FirmwareSelection = {
  target: string
  node_profile_uuid: string | null
  device_profile_uuids: string[]
}
