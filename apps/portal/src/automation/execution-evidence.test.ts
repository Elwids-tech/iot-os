import { describe, expect, it } from "vitest"
import { evidenceMarkdown, evidenceParts, type ExecutionReferences } from "./execution-evidence"

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
  it("keeps the reply's Markdown and turns references into numbered evidence links", () => {
    const { markdown, targets } = evidenceMarkdown("- **False** [step:2]\n- Requested [action:1] [step:9]", {
      ...evidence, steps: [...evidence.steps, { node_id: "over_*limit*", node_type: "compare.v1" }],
    })
    expect(markdown).toBe("- **False** [Step 2 · limit](#evidence-0)\n- Requested [Action 1 · alarm](#evidence-1) [step:9] (reference unavailable)")
    expect(targets).toEqual([{ evaluationId: "17", step: 1 }, { evaluationId: "17", action: "intent-a" }])
    expect(evidenceMarkdown("[step:3]", { ...evidence, steps: [...evidence.steps, { node_id: "over_*limit*", node_type: "compare.v1" }] }).markdown)
      .toBe("[Step 3 · over\\_\\*limit\\*](#evidence-0)")
    expect(evidenceMarkdown("[step:1]", undefined)).toEqual({ markdown: "[step:1]", targets: [] })
  })
})
