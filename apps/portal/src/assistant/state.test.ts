import { describe, expect, it } from "vitest"
import type { AssistantDetail, AssistantProposal } from "@iot-os/api-client"
import {
  applyTextEvents,
  editedEvidence,
  evidenceTarget,
  evidenceTargets,
  fieldDiff,
} from "./state"

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
  it("replaces the sources of an edited value and keeps a renamed item's other sources", () => {
    const proposal = {
      changes: [
        { operation: "upsert", uuid: null, values: { key: "temp", label: "Temperature", unit: "°C" } },
        { operation: "upsert", uuid: null, values: { key: "humid", label: "Humidity", unit: "%RH" } },
      ],
      evidence: [
        { field: "parameters.temp.key", origin: "user_confirmed", note: "User approved suggested key `temp`." },
        { field: "parameters.temp.unit", origin: "source", source_id: "datasheet", location: "p. 3" },
        { field: "parameters.humid.unit", origin: "suggested" },
        { field: "section", origin: "user_stated" },
      ],
    } satisfies Pick<AssistantProposal, "changes" | "evidence">
    const changes = structuredClone(proposal.changes)
    changes[0].values.key = "temperature"
    const evidence = editedEvidence(proposal, changes, proposal.evidence)
    expect(evidence).toEqual([
      { field: "changes.0.values.unit", origin: "source", source_id: "datasheet", location: "p. 3" },
      { field: "changes.1.values.unit", origin: "suggested" },
      { field: "section", origin: "user_stated" },
      {
        field: "changes.0.values.key",
        origin: "user_confirmed",
        note: "Edited in review. The assistant suggested “temp”.",
      },
    ])
    // The re-addressed sources still resolve against the edited proposal.
    expect(evidenceTarget(evidence[0].field, changes)).toEqual({ index: 0, key: "unit" })
    expect(evidenceTarget("parameters.humid.unit", changes)).toEqual({ index: 1, key: "unit" })
    expect(evidenceTarget("name", [{ operation: "upsert", values: { name: "Probe" } }])).toEqual({ index: 0, key: "name" })
    expect(evidenceTarget("parameters.other.unit", changes)).toBeNull()
  })
  it("matches pointers that still use a renamed key to the item no other pointer names", () => {
    const changes = [
      { operation: "upsert" as const, values: { key: "temperature", unit: "°C" } },
      { operation: "upsert" as const, values: { key: "humid", unit: "%RH" } },
    ]
    const evidence: AssistantProposal["evidence"] = [
      { field: "parameters.temp.key", origin: "user_confirmed" },
      { field: "parameters.temp.unit", origin: "suggested" },
      { field: "parameters.humid.unit", origin: "user_stated" },
      { field: "changes.0.values.key", origin: "user_confirmed" },
      { field: "parameters.gone.unit", origin: "source" },
    ]
    // Two unknown ids but one unnamed item: nothing is guessed.
    expect(evidenceTargets(evidence, changes).map((target) => target?.index ?? null)).toEqual([
      null, null, 1, 0, null,
    ])
    expect(evidenceTargets(evidence.slice(0, 4), changes)).toEqual([
      { index: 0, key: "key" },
      { index: 0, key: "unit" },
      { index: 1, key: "unit" },
      { index: 0, key: "key" },
    ])
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
