import { describe, expect, it } from "vitest"
import type { AssistantDetail, AssistantProposal } from "@iot-os/api-client"
import { applyTextEvents, editedEvidence, fieldDiff } from "./state"

describe("assistant streaming and review", () => {
  it("does not repeat streamed text after a snapshot, reconnect, or repeated event", () => {
    const snapshot = {
      cursor: 3,
      runs: [{ id: "run", answer: "Hello" }],
    } as AssistantDetail
    const events = [
      { id: 3, run_id: "run", type: "text_delta", payload: { delta: "Hello" } },
      {
        id: 4,
        run_id: "run",
        type: "text_delta",
        payload: { delta: " world" },
      },
    ]
    const result = applyTextEvents(snapshot, events)
    expect(result.runs[0].answer).toBe("Hello world")
    expect(applyTextEvents(result, events)).toBe(result)
    expect(
      applyTextEvents(result, [
        {
          id: 5,
          run_id: "other",
          type: "text_delta",
          payload: { delta: "private" },
        },
      ]).runs[0].answer,
    ).toBe("Hello world")
  })
  it("keeps unresolved source facts unresolved when another field is edited", () => {
    const proposal = {
      changes: [
        { operation: "upsert", values: { name: "Probe", code: "probe" } },
      ],
      evidence: [
        { field: "unit", origin: "unresolved", note: "Confirm the unit" },
      ],
    } satisfies Pick<AssistantProposal, "changes" | "evidence">
    const evidence = editedEvidence(
      proposal,
      [{ operation: "upsert", values: { name: "My probe", code: "probe" } }],
      proposal.evidence,
    )
    expect(evidence[0].origin).toBe("unresolved")
    expect(evidence[1]).toMatchObject({
      field: "changes.0.values.name",
      origin: "user_confirmed",
    })
    expect(evidence).toHaveLength(2)
  })
  it("lists only changed leaf fields, including nested and removed ones", () => {
    expect(
      fieldDiff(
        { name: "Probe", unit: "C", display: { precision: 1, color: "red" } },
        { name: "Probe", unit: "F", display: { precision: 2 }, tags: ["a"] },
      ),
    ).toEqual([
      { field: "unit", before: "C", after: "F" },
      { field: "display.precision", before: 1, after: 2 },
      { field: "display.color", before: "red", after: undefined },
      { field: "tags.0", before: undefined, after: "a" },
    ])
    expect(fieldDiff({ name: "Probe" }, null)).toEqual([
      { field: "name", before: "Probe", after: undefined },
    ])
  })
})
