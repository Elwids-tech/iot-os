/**
 * Moving devices to another organization of the same billing account (spec 031,
 * ADR-039). A move stops the active devices, then archives each one here as moved and
 * creates a linked device in the target. Pipes stay with their owner.
 */

/** Where the person may move the organization's devices. */
export type DeviceMoveTargets = {
  data: { uuid: string; name: string }[]
  /** Present for an owner of the billing account with room for another organization. */
  new_organization?: { billing_account_uuid: string }
}

/** One device's overrides in a review or a confirmation. */
export type DeviceMoveDeviceInput = {
  uuid: string
  name?: string
  code?: string
  site_uuid?: string | null
}

export type DeviceMoveInput = {
  target_organization_uuid: string
  /** 1–100 devices of the organization. */
  device_uuids: string[]
  devices?: DeviceMoveDeviceInput[]
}

export type DeviceMoveConfirmation = DeviceMoveInput & {
  operation_uuid: string
  /** The `preview_hash` of the review the person confirmed. */
  preview_hash: string
  origin?: "devices" | "device"
}

/** How a device reports: a pipe `stays` with its owner; a direct device's own gateway `moves`. */
export type DeviceMoveReportsThrough = {
  kind: "adapter" | "gateway" | "direct"
  name: string
  outcome: "stays" | "moves"
}

/** What a move would do. It changes nothing. */
export type DeviceMoveReview = {
  preview_hash: string
  /** False while any device has a blocker. */
  can_confirm: boolean
  devices: {
    uuid: string
    name: string
    code: string
    successor: { name: string; code: string; site_uuid: string | null }
    reports_through: DeviceMoveReportsThrough | null
    arrives_active: boolean
    /** Plain sentences, such as "Waiting for the runtime". */
    blockers: string[]
  }[]
  /** Dashboards and automations stay in the source until they can come along (spec 031 PR 4). */
  items: never[]
  ends: {
    alerts: number
    geofence_assignments: number
    /** Applications that keep reading the archived devices and never see the new ones. */
    application_grants: { name: string; devices: number }[]
  }
  profile_copies: { profile: string; revision: number; code: string; reused: boolean }[]
  pipe_owner_sees_raw_messages: boolean
  history: { offered: boolean; include: boolean }
  summary: string[]
  archives: never[]
}

/** 409 for a review that went stale: the fresh one to confirm instead. */
export type DeviceMoveStale = { message: string; review: DeviceMoveReview }

export type DeviceMoveStatus = "stopping" | "completed" | "failed"
export type DeviceMoveDeviceState = "waiting" | "stopping" | "stopped" | "moved" | "failed"
export type DeviceMoveSuccessorState = "pending" | "active" | "inactive" | "failed"

/**
 * A move as the person sees it. Each side is named, but uuids show only to members: of
 * the source for predecessors, of the target for successors and how they arrived.
 */
export type DeviceMove = {
  uuid: string
  status: DeviceMoveStatus
  source: { uuid: string | null; name: string | null }
  target: { uuid: string | null; name: string | null }
  confirmed_at: string
  cutover_at: string | null
  /** Devices the runtime has not stopped yet; the move waits with no timeout. */
  waiting_for: { devices_stopping: number }
  devices: {
    predecessor_uuid: string | null
    successor_uuid: string | null
    name: string
    state: DeviceMoveDeviceState
    successor_state: DeviceMoveSuccessorState | null
    successor_reason: string | null
  }[]
  items: never[]
  needs_attention: { kind: "device"; uuid: string; name: string; reason: string }[]
  failure_reason: string | null
}

/** Where a device moved to, or from (spec 031). */
export type DeviceLink = {
  direction: "moved_to" | "moved_from"
  organization_name: string | null
  cutover_at: string
}

/**
 * What brings a device's messages in. `hosted` is true when another organization of the
 * billing account owns it; then nothing else of the pipe is shown.
 */
export type DevicePipe = {
  kind: "adapter" | "gateway"
  name: string
  owner_organization_name: string
  online: boolean
  hosted: boolean
}
