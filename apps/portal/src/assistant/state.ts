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

/**
 * The change and top-level value an evidence pointer is about, or null. The assistant writes
 * pointers such as `name` or `parameters.temp.unit` (naming the item by its key, code, name or
 * uuid); a reviewed proposal uses `changes.0.values.unit`. Resolve against the proposal's own
 * changes so a renamed key still finds its sources.
 */
export function evidenceTarget(field: string, changes: AssistantChange[]) {
  const parts = field.split(".")
  if (parts[0] === "changes" && parts[2] === "values") {
    const index = Number(parts[1])
    const values = changes[index]?.values
    return values && Object.hasOwn(values, parts[3] ?? "")
      ? { index, key: parts[3] }
      : null
  }
  for (const [index, change] of changes.entries()) {
    const ids = [
      change.uuid,
      change.values.key,
      change.values.code,
      change.values.name,
    ].filter((id): id is string => typeof id === "string" && id !== "")
    const at =
      changes.length === 1 ? -1 : parts.findIndex((part) => ids.includes(part))
    if (changes.length > 1 && at < 0) continue
    const key = parts
      .slice(at + 1)
      .find((part) => Object.hasOwn(change.values, part))
    if (key) return { index, key }
  }
  return null
}

/**
 * Targets for every evidence entry. A pointer may name an item by an id it no longer has,
 * such as a key renamed before reviews kept pointers by index; when the unknown ids and
 * the items no assistant pointer names pair up one to one, they are matched in order.
 */
export function evidenceTargets(
  evidence: AssistantProposal["evidence"],
  changes: AssistantChange[],
) {
  const direct = evidence.map((item) => evidenceTarget(item.field, changes))
  const idOf = (field: string) => {
    const parts = field.split(".")
    return parts.length >= 3 && parts[0] !== "changes" ? parts[1] : null
  }
  const named = new Set(
    direct.flatMap((target, i) =>
      target && idOf(evidence[i].field) ? [target.index] : [],
    ),
  )
  const spare = changes.flatMap((_, index) => (named.has(index) ? [] : [index]))
  const unknown = [
    ...new Set(
      evidence.flatMap((item, i) => {
        const id = direct[i] ? null : idOf(item.field)
        return id ? [id] : []
      }),
    ),
  ]
  if (changes.length < 2 || !unknown.length || unknown.length !== spare.length)
    return direct
  return evidence.map((item, i) => {
    const id = idOf(item.field)
    if (direct[i] || !id) return direct[i]
    const index = spare[unknown.indexOf(id)]
    const key = item.field
      .split(".")
      .slice(2)
      .find((part) => Object.hasOwn(changes[index].values, part))
    return key ? { index, key } : null
  })
}

/** Starts the note left on a value you changed in review. */
export const EDITED_NOTE = "Edited in review."

const shown = (value: AssistantValue | undefined) =>
  value === undefined || value === null
    ? "no value"
    : typeof value === "object"
      ? "a different value"
      : `“${String(value)}”`

/**
 * Evidence for the edited proposal: an edited value's sources are replaced by one note that
 * you changed it and what was suggested, and every other source is re-addressed by change
 * index so it still lines up after a rename.
 */
export function editedEvidence(
  proposal: Pick<AssistantProposal, "changes">,
  changes: AssistantChange[],
  evidence: AssistantProposal["evidence"],
): AssistantProposal["evidence"] {
  const edited: AssistantProposal["evidence"] = []
  const replaced = new Set<string>()
  changes.forEach((change, index) =>
    Object.entries(change.values).forEach(([key, value]) => {
      const before = proposal.changes[index]?.values[key]
      if (JSON.stringify(value) === JSON.stringify(before)) return
      replaced.add(`${index}.${key}`)
      edited.push({
        field: `changes.${index}.values.${key}`,
        origin: "user_confirmed",
        note: `${EDITED_NOTE} The assistant suggested ${shown(before)}.`,
      })
    }),
  )
  const targets = evidenceTargets(evidence, proposal.changes)
  const kept = evidence.flatMap((item, i) => {
    const target = targets[i]
    if (!target) return [item]
    if (replaced.has(`${target.index}.${target.key}`)) return []
    return [{ ...item, field: `changes.${target.index}.values.${target.key}` }]
  })
  return [...kept, ...edited]
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
