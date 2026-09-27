import type {
  AssistantDetail,
  AssistantEvent,
  AssistantProposal,
  AssistantChange,
  AssistantValue,
} from "@iot-os/api-client"

export function applyTextEvents(
  detail: AssistantDetail,
  events: AssistantEvent[],
): AssistantDetail {
  const unseen = events.filter((event) => event.id > detail.cursor)
  if (!unseen.length) return detail
  return {
    ...detail,
    cursor: Math.max(detail.cursor, ...unseen.map((event) => event.id)),
    runs: detail.runs.map((run) => ({
      ...run,
      answer:
        (run.answer ?? "") +
        unseen
          .filter(
            (event) => event.run_id === run.id && event.type === "text_delta",
          )
          .map((event) => event.payload.delta ?? "")
          .join(""),
    })),
  }
}

export function editedEvidence(
  proposal: Pick<AssistantProposal, "changes">,
  changes: AssistantChange[],
  evidence: AssistantProposal["evidence"],
): AssistantProposal["evidence"] {
  const added: AssistantProposal["evidence"] = []
  changes.forEach((change, index) =>
    Object.entries(change.values).forEach(([key, value]) => {
      if (
        JSON.stringify(value) !==
        JSON.stringify(proposal.changes[index]?.values[key])
      )
        added.push({
          field: `changes.${index}.values.${key}`,
          origin: "user_confirmed",
          note: "Value edited in section review; this overrides the original suggestion.",
        })
    }),
  )
  return [...evidence, ...added]
}

function flatten(
  value: AssistantValue,
  path = "",
  out: Record<string, AssistantValue> = {},
) {
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
    if (!entries.length && path) out[path] = value
    for (const [key, child] of entries)
      flatten(child, path ? `${path}.${key}` : key, out)
  } else if (path) out[path] = value
  return out
}

/** Leaf fields (dotted paths) whose value differs between before and after. */
export function fieldDiff(before: AssistantValue, after: AssistantValue) {
  const left = flatten(before)
  const right = flatten(after)
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((field) => JSON.stringify(left[field]) !== JSON.stringify(right[field]))
    .map((field) => ({ field, before: left[field], after: right[field] }))
}
