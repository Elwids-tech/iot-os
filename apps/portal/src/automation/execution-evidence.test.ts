import { describe, expect, it } from "vitest"
import { evidenceParts, type ExecutionReferences } from "./execution-evidence"

const evidence: ExecutionReferences = {
  workflow_uuid: "w", evaluation_id: "17", captured_at: "2026-10-04T00:00:00Z", at: "2026-10-03T23:00:00Z",
  generation: 1, draft_revision: 1, trace_truncated: false,
  steps: [{ node_id: "source", node_type: "source.parameter.v1" }, { node_id: "limit", node_type: "compare.v1" }],
  actions: [{ id: "intent-a", node_id: "alarm" }],
}

describe("execution evidence links", () => {
  it("resolves citations to the response's evaluation and exact step or intent", () => {
    expect(evidenceParts("False [step:2]; delivery [action:1]. [evaluation]", evidence).filter(part => part.target).map(part => part.target)).toEqual([
      { evaluationId: "17", step: 1 }, { evaluationId: "17", action: "intent-a" }, { evaluationId: "17" },
    ])
  })
  it("does not turn invented or out-of-range references into links", () => {
    const parts = evidenceParts("[step:0] [step:3] [action:2] <script> [step:999999999999999999]", evidence)
    expect(parts.every(part => !part.target)).toBe(true)
    expect(evidenceParts("[step:1]", undefined)).toEqual([{ text: "[step:1]" }])
  })
})
