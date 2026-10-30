import { describe, expect, it } from "vitest"
import { activationUnavailableReason, unappliedChanges } from "./activation"
describe("activation availability", () => {
  const revision = { draft_revision: 5, pending_operation_uuid: null }
  const state = { busy: false, empty: false, saved: revision, live: revision }
  it("allows a reopened saved workflow to activate without a tab-local simulation", () => {
    expect(activationUnavailableReason(state)).toBeUndefined()
  })
  it("lets unsaved workflows activate, because activation saves them first", () => {
    expect(activationUnavailableReason({ ...state, saved: undefined, live: undefined })).toBeUndefined()
  })
  it("blocks empty, stale, busy, pending deployment and outdated binding states", () => {
    for (const override of [{ empty: true }, { live: { draft_revision: 6 } }, { busy: true }, { live: { ...revision, pending_operation_uuid: "pending" } }, { stale: true }])
      expect(activationUnavailableReason({ ...state, ...override })).toBeTruthy()
  })
  it("allows reactivation after the disable acknowledgement clears pending state", () => {
    expect(activationUnavailableReason({ ...state, live: { ...revision, pending_operation_uuid: "disable" } })).toBeTruthy()
    expect(activationUnavailableReason({ ...state, live: { ...revision, pending_operation_uuid: null } })).toBeUndefined()
  })
})
describe("changes to apply", () => {
  const saved = { draft_revision: 5 }
  const running = { ...saved, desired_deployment_uuid: "deployment", active_revision: 5 }
  it("has nothing to apply when the running revision is the saved one and nothing is edited", () => {
    expect(unappliedChanges({ dirty: false, saved, live: running })).toBe(false)
  })
  it("applies edits and saved revisions that are not running yet", () => {
    expect(unappliedChanges({ dirty: true, saved, live: running })).toBe(true)
    expect(unappliedChanges({ dirty: false, saved, live: { ...running, active_revision: 4 } })).toBe(true)
  })
  it("never applies for an automation that is not running, including a failed activation", () => {
    expect(unappliedChanges({ dirty: true, saved, live: { ...saved, desired_deployment_uuid: null } })).toBe(false)
    expect(unappliedChanges({ dirty: true, saved, live: { ...running, deployment_status: "failed" } })).toBe(false)
  })
})
