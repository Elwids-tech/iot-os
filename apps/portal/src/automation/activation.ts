type Revision = { draft_revision: number; pending_operation_uuid?: string | null }
type Live = Revision & { deployment_status?: string; desired_deployment_uuid?: string | null; active_revision?: number | null }

/** Running, or being applied; a failed activation runs nothing and needs activating again. */
export const isRunning = (live?: Live): live is Live => Boolean(live?.desired_deployment_uuid) && live?.deployment_status !== "failed"

/** Activation saves pending edits first and reviews the saved values. A tab-local simulation is optional. */
export function activationUnavailableReason({ busy, empty, saved, live, stale }: { busy: boolean; empty: boolean; saved?: Revision; live?: Revision; stale?: boolean }): string | undefined {
  if (busy) return "Wait for the current operation to finish."
  if (empty) return "Add nodes before activation."
  if (live && saved && live.draft_revision !== saved.draft_revision) return "Review the latest saved revision before activation."
  if (live?.pending_operation_uuid) return "Wait for the current deployment to finish."
  // Deploy would fail with binding_changed.
  if (stale) return "A device changed since this automation was set up. Use its current configuration before activation."
  return undefined
}

/**
 * Whether a running automation has graph edits or a saved revision that is not running yet. Layout
 * edits (positions, node names) never reach the runtime, so they alone leave nothing to apply.
 */
export function unappliedChanges({ dirty, saved, live }: { dirty: boolean; saved?: Revision; live?: Live }): boolean {
  if (!isRunning(live)) return false
  return dirty || live.active_revision !== saved?.draft_revision
}
