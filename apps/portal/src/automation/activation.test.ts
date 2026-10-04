import { describe, expect, it } from "vitest"
import { activationUnavailableReason } from "./activation"
describe("activation availability", () => {
  const revision = { draft_revision: 5, pending_operation_uuid: null }
  const state = { busy: false, dirty: false, saved: revision, live: revision }
  it("allows a reopened saved workflow to activate without a tab-local simulation", () => {
    expect(activationUnavailableReason(state)).toBeUndefined()
  })
  it("blocks unsaved, dirty, stale, busy and pending deployment states", () => {
    for (const override of [{ saved: undefined }, { dirty: true }, { live: { draft_revision: 6 } }, { busy: true }, { live: { ...revision, pending_operation_uuid: "pending" } }])
      expect(activationUnavailableReason({ ...state, ...override })).toBeTruthy()
  })
  it("allows reactivation after the disable acknowledgement clears pending state", () => {
    expect(activationUnavailableReason({ ...state, live: { ...revision, pending_operation_uuid: "disable" } })).toBeTruthy()
    expect(activationUnavailableReason({ ...state, live: { ...revision, pending_operation_uuid: null } })).toBeUndefined()
  })
})
