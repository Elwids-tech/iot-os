import type { Workflow } from "@iot-os/workflow-editor"

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]))
  return value
}

export function draftSignature(name: string, workflow: Workflow): string {
  return JSON.stringify(stable({ name, workflow: {
    schema_version: workflow.schema_version,
    bindings: workflow.bindings,
    nodes: workflow.nodes.map(node => ({ ...node, config: Array.isArray(node.config) && !node.config.length ? {} : node.config })),
    edges: workflow.edges,
  } }))
}

export function changedNodes(before: Workflow, after: Workflow) {
  return [
    ...after.nodes.filter(node => JSON.stringify(stable(node)) !== JSON.stringify(stable(before.nodes.find(old => old.id === node.id)))).map(node => ({ node, change: before.nodes.some(old => old.id === node.id) ? "Update" : "Add" })),
    ...before.nodes.filter(node => !after.nodes.some(next => next.id === node.id)).map(node => ({ node, change: "Remove" })),
  ]
}
