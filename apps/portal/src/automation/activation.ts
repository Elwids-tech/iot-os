type Revision = { draft_revision: number; pending_operation_uuid?: string | null }

/** Activation reviews persisted values. A tab-local simulation is optional. */
export function activationUnavailableReason({ busy, dirty, saved, live }: { busy: boolean; dirty: boolean; saved?: Revision; live?: Revision }): string | undefined {
  if (busy) return "Wait for the current operation to finish."
  if (!saved) return "Save this workflow before activation."
  if (dirty) return "Save your changes before activation."
  if (live && live.draft_revision !== saved.draft_revision) return "Review the latest saved revision before activation."
  if (live?.pending_operation_uuid) return "Wait for the current deployment to finish."
  return undefined
}
