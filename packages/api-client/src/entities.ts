/**
 * The entity hierarchy (spec 009): an organization's tree of typed entities held to
 * rules it chooses. Sites are untouched until spec 009 PR 2 turns them into Site
 * entities.
 */

export type EntityNaming = {
  /** Literals plus `<number>`, `<letter>`, `<letters>` and `<text>`. */
  template: string
  example: string | null
  description: string | null
}

export type EntityType = {
  uuid: string
  key: string
  name: string
  top_level: boolean
  parent_type_keys: string[]
  member_type_keys: string[]
  accepts_devices: boolean
  carries_timezone: boolean
  carries_location: boolean
  naming: EntityNaming | null
  preset_keys: string[]
  entities_count: number
}

export type EntityTypeInput = {
  /** Lowercase letters, digits and underscores; fixed once created. */
  key: string
  name: string
  top_level?: boolean
  parent_type_keys?: string[]
  member_type_keys?: string[]
  accepts_devices?: boolean
  carries_timezone?: boolean
  carries_location?: boolean
  naming_template?: string | null
  naming_example?: string | null
  naming_description?: string | null
}

export type EntityPreset = {
  key: "manufacturing" | "buildings" | "power_distribution" | string
  name: string
  description: string
  version: number
  /** What applying it here would do to each of its types. */
  types: { key: string; name: string; outcome: "add" | "merge" | "present" }[]
}

export type EntityTypeSummary = { key: string; name: string }

/** An entity in a level of the tree or a search result. */
export type EntitySummary = {
  uuid: string
  name: string
  path_name: string
  path: string
  depth: number
  type: EntityTypeSummary
  parent_uuid: string | null
  children_count: number
  archived_at: string | null
}

export type EntityAttributes = Record<string, string | number | boolean | null>

/** Rules an entity breaks since they changed; it keeps working. */
export type EntityOutsideRule = "parent_type" | "naming"

export type Entity = EntitySummary & {
  /** From the top down. */
  ancestors: { uuid: string; name: string; path_name: string }[]
  description: string | null
  timezone: string | null
  /** The nearest time zone at or above, else the organization's, else UTC. */
  effective_timezone: string
  address: string | null
  latitude: number | null
  longitude: number | null
  attributes: EntityAttributes
  outside_rules: EntityOutsideRule[]
  created_at: string | null
  updated_at: string | null
}

export type EntityInput = {
  type_key: string
  parent_uuid?: string | null
  name: string
  /** Suggested from the name when omitted. */
  path_name?: string | null
  description?: string | null
  timezone?: string | null
  address?: string | null
  latitude?: number | null
  longitude?: number | null
  attributes?: EntityAttributes | null
}

export type EntityUpdate = Partial<Omit<EntityInput, "parent_uuid">>

export type EntityMoveImpact = {
  /** The entity and everything below it. */
  entities: number
  /** Devices placed in the branch (not archived). */
  devices: number
  devices_changing_site: number
  devices_changing_timezone: number
  /** Integration applications following a site that would gain or lose devices. */
  applications: { uuid: string; name: string; gains: number; loses: number }[]
}

export type EntityPlacement = {
  uuid: string
  entity: { uuid: string; name: string; path: string; archived: boolean }
  /** Null for a placement from before placement history was kept. */
  started_at: string | null
  ended_at: string | null
  end_reason: "moved" | "unplaced" | "device_archived" | "moved_out" | "entity_archived" | null
  started_by: number | null
  ended_by: number | null
}

export type PlacedDevice = {
  uuid: string
  name: string
  code: string
  lifecycle: string
  entity: { uuid: string; name: string; path: string }
}

/** A parameter as it appears at an entity (spec 009). */
export type EntityPoint = {
  leaf_name: string
  path: string
  /** The path below the entity asked about. */
  relative_path: string
  device: { uuid: string; name: string }
  parameter: { uuid: string; key: string; label: string; unit: string | null }
  via: "placement" | "parameter_placement"
  /** `name_clash`: Not placed: name clash. `not_in_configuration`: the device's configuration no longer has it. */
  state: "placed" | "name_clash" | "not_in_configuration"
  /** Null when unknown: never shown as zero. */
  latest: { value: string | number | boolean; quality: string | null; observed_at: string | null; received_at: string | null } | null
}

export type ParameterPlacement = {
  uuid: string
  parameter_uuid: string
  parameter_key: string
  leaf_name: string
  path: string
  entity: { uuid: string; name: string; path: string }
  started_at: string | null
  ended_at: string | null
}

/** One side of a grouping across the tree (spec 009, FR-023). */
export type EntityMembershipEnd = { uuid: string; name: string; path: string; type_key: string }

export type EntityMembershipPeriod = { started_at: string | null; ended_at: string | null; end_reason: "replaced" | "left" | "archived" | null }

export type EntityMemberships = {
  /** Groups the entity is (or was) a member of. */
  groups: (EntityMembershipPeriod & { group: EntityMembershipEnd })[]
  /** Members the entity holds (or held). */
  members: (EntityMembershipPeriod & { member: EntityMembershipEnd })[]
}
