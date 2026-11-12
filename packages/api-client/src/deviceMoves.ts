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

export type DeviceMoveItemKind = "dashboard" | "automation"

/**
 * What happens to a dashboard or automation that uses a moving device. `keep` on a
 * dashboard that also uses other devices reads **Don't copy**.
 */
export type DeviceMoveItemAction = "move" | "copy" | "keep" | "archive"

/** A choice for one dashboard or automation, overriding the preselected one. */
export type DeviceMoveItemInput = {
  kind: DeviceMoveItemKind
  uuid: string
  action: DeviceMoveItemAction
}

export type DeviceMoveInput = {
  target_organization_uuid: string
  /** 1–100 devices of the organization. */
  device_uuids: string[]
  devices?: DeviceMoveDeviceInput[]
  /** An override the item doesn't offer falls back to the preselected choice. */
  items?: DeviceMoveItemInput[]
  /** Let the target read each device's readings from before the move; off by default. */
  include_history?: boolean
}

export type DeviceMoveConfirmation = DeviceMoveInput & {
  operation_uuid: string
  /** The `preview_hash` of the review the person confirmed. */
  preview_hash: string
  /** Exactly the review's `archives`, each confirmed on its own. */
  confirmed_archives?: { kind: DeviceMoveItemKind; uuid: string }[]
  origin?: "devices" | "device"
}

/** A dashboard or automation of the source that uses a moving device (spec 031 US2). */
export type DeviceMoveReviewItem = {
  kind: DeviceMoveItemKind
  uuid: string
  name: string
  /** False when it also uses devices that stay. */
  uses_only_moving: boolean
  /** The choices the person may make; the first is preselected and archive never is. */
  actions: DeviceMoveItemAction[]
  action: DeviceMoveItemAction
  /** What the chosen action leaves out, as plain phrases. */
  omitted: { panels: string[]; shares: string[]; recipients: string[]; references: string[] }
  /** Its devices that aren't moving; `can_add` offers adding them to the move. */
  other_devices: { count: number; can_add: boolean; device_uuids: string[] } | null
  /** Automations: whether it is on now. */
  running: boolean | null
  /** A moving automation that keeps running in the target, once its devices are active there. */
  arrives_running: boolean | null
  /** What happens to it, in a sentence. */
  outcome: string | null
}

/** How a device reports: a pipe `stays` with its owner; a direct device's own gateway `moves`. */
export type DeviceMoveReportsThrough = {
  kind: "adapter" | "gateway" | "direct"
  name: string
  /** The pipe's owner, or for a direct device its own organization. */
  owner_organization_name: string
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
    /**
     * The device, or one before it, was in the target before: its successor reconnects to
     * the readings recorded there, whatever `include_history` says (ADR-040).
     */
    returns: boolean
    /** Plain sentences, such as "Waiting for the runtime". */
    blockers: string[]
  }[]
  /** Dashboards first, then automations, each by name. */
  items: DeviceMoveReviewItem[]
  ends: {
    alerts: number
    geofence_assignments: number
    /** Applications that keep reading the archived devices and never see the new ones. */
    application_grants: { name: string; devices: number }[]
  }
  profile_copies: { profile: string; revision: number; code: string; reused: boolean }[]
  pipe_owner_sees_raw_messages: boolean
  /** **Include readings from before the move**: the request's `include_history`, part of the hash. */
  history: { offered: boolean; include: boolean }
  summary: string[]
  /** The items to be archived, confirmed on their own. */
  archives: { kind: DeviceMoveItemKind; uuid: string; name: string }[]
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
  /**
   * What happened to each dashboard and automation. `source_uuid` shows to members of the
   * source for what stayed, was archived or was copied from; `target_uuid` to members of the
   * target for what moved or was copied there.
   */
  items: {
    kind: DeviceMoveItemKind
    name: string | null
    action: DeviceMoveItemAction
    source_uuid: string | null
    target_uuid: string | null
    /** A moved automation turned on once its devices are active; false when it arrived off. */
    arrives_running: boolean | null
  }[]
  /** For members of the target: devices that arrived inactive or failed, and automations to turn on. */
  needs_attention: { kind: "device" | "automation"; uuid: string; name: string; reason: string }[]
  failure_reason: string | null
}

/** A device a dashboard or automation still names that moved to another organization (spec 031). */
export type MovedDevice = {
  device_uuid: string
  name: string
  organization_name: string | null
  cutover_at: string
}

/** Where a device moved to, or from (spec 031). */
export type DeviceLink = {
  direction: "moved_to" | "moved_from"
  organization_name: string | null
  cutover_at: string
  /**
   * Whether the readings from before the cutover are shared with the organization the
   * device moved to, and when and why sharing stopped.
   */
  history: {
    included: boolean
    stopped_at: string | null
    stopped_reason: "stopped" | "left_account" | null
  }
}

/**
 * Where a history reading was recorded: `source` for a moved device's readings from
 * before the move that were recorded in another organization (its predecessor's, and
 * what that predecessor's history held from earlier moves, ADR-041); `self` otherwise,
 * including the readings a device moved back recorded in its organization before
 * (ADR-040). A bucket that holds both is `source`.
 */
export type RecordedIn = "self" | "source"

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
