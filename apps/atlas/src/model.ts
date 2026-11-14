// The atlas content model. One JSON file per diagram in ../content; the tree is
// derived from the boxes that open another diagram. scripts/check-atlas.mjs checks
// the same rules outside the browser.

export type Tone = "person" | "external" | "system" | "store" | "state"

export type Box = {
  id: string
  label: string
  sub?: string
  tone?: Tone
  /** Grid position: [column, row]. Fractions are allowed. */
  at: [number, number]
  /** The id of the diagram this box zooms into. */
  opens?: string
  detail?: string
  code?: string[]
  docs?: string[]
}

export type Edge = {
  id: string
  from: string
  to: string
  label?: string
  dashed?: boolean
  /** Where the label sits along a straight edge, 0 to 1. Default 0.5. */
  labelAt?: number
  /** Curve the edge: pixels to the left of its direction of travel (negative: right). */
  bend?: number
}

export type Step = { edge?: string; box?: string; text: string }

export type AtlasNode = {
  id: string
  title: string
  kind: "context" | "containers" | "flow" | "state"
  summary: string
  docs?: string[]
  /** Grid rows to reserve when edges curve below the last box. */
  rows?: number
  boxes: Box[]
  edges: Edge[]
  steps?: Step[]
}

export const ROOT = "system"

const files = import.meta.glob<AtlasNode>("../content/*.json", { eager: true, import: "default" })

export const nodes: Record<string, AtlasNode> = Object.fromEntries(
  Object.values(files).map((node) => [node.id, node]),
)

// A box may name a diagram that is not written yet; until then it does not open.
for (const node of Object.values(nodes)) {
  for (const box of node.boxes) {
    if (box.opens && !nodes[box.opens]) delete box.opens
  }
}

/** The diagram and box that open each diagram. */
export const parents: Record<string, { node: string; box: string }> = {}
for (const node of Object.values(nodes)) {
  for (const box of node.boxes) {
    if (box.opens && nodes[box.opens] && !parents[box.opens]) {
      parents[box.opens] = { node: node.id, box: box.id }
    }
  }
}

/** Diagram ids from the root down to `id`. */
export function trail(id: string): string[] {
  const path = [id]
  while (parents[path[0]]) path.unshift(parents[path[0]].node)
  return path
}

export function children(id: string): string[] {
  return nodes[id].boxes.flatMap((box) => (box.opens && parents[box.opens]?.node === id ? [box.opens] : []))
}

export const kindLabel: Record<AtlasNode["kind"], string> = {
  context: "System context",
  containers: "Containers",
  flow: "Flow",
  state: "State machine",
}
