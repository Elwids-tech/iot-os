#!/usr/bin/env node
// Keeps the atlas honest: every diagram is reachable, every reference resolves and
// every code or docs path it names still exists in the repository.
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const app = join(dirname(fileURLToPath(import.meta.url)), "..")
const repo = join(app, "../..")
const content = join(app, "content")
const ROOT = "system"

const errors = []
const nodes = new Map()
for (const file of readdirSync(content).filter((name) => name.endsWith(".json"))) {
  const node = JSON.parse(readFileSync(join(content, file), "utf8"))
  if (`${node.id}.json` !== file) errors.push(`${file}: id "${node.id}" must match the file name`)
  nodes.set(node.id, node)
}

const paths = (where, list = []) => {
  for (const path of list) {
    if (!existsSync(join(repo, path))) errors.push(`${where}: ${path} does not exist`)
  }
}

for (const node of nodes.values()) {
  const at = `${node.id}.json`
  for (const field of ["title", "kind", "summary"]) {
    if (!node[field]) errors.push(`${at}: missing ${field}`)
  }
  paths(at, node.docs)
  const boxes = new Set()
  for (const box of node.boxes) {
    if (boxes.has(box.id)) errors.push(`${at}: duplicate box "${box.id}"`)
    boxes.add(box.id)
    if (box.opens && !nodes.has(box.opens)) errors.push(`${at}: box "${box.id}" opens unknown diagram "${box.opens}"`)
    paths(`${at} box "${box.id}"`, box.code)
    paths(`${at} box "${box.id}"`, box.docs)
  }
  const edges = new Set()
  for (const edge of node.edges) {
    if (edges.has(edge.id)) errors.push(`${at}: duplicate edge "${edge.id}"`)
    edges.add(edge.id)
    for (const end of [edge.from, edge.to]) {
      if (!boxes.has(end)) errors.push(`${at}: edge "${edge.id}" names unknown box "${end}"`)
    }
  }
  for (const [index, step] of (node.steps ?? []).entries()) {
    if (step.edge && !edges.has(step.edge)) errors.push(`${at}: step ${index + 1} names unknown edge "${step.edge}"`)
    if (step.box && !boxes.has(step.box)) errors.push(`${at}: step ${index + 1} names unknown box "${step.box}"`)
    if (!step.text) errors.push(`${at}: step ${index + 1} has no text`)
  }
}

// Layout: the same geometry as src/Diagram.tsx, so a diagram nobody has looked at
// yet still has no overlapping boxes, no edge drawn through a box and no label
// wider than the gap it sits in.
const CELL_W = 260
const CELL_H = 150
const BOX_W = 184
const BOX_H = 76
const centre = (box) => ({ x: box.at[0] * CELL_W, y: box.at[1] * CELL_H })
const inside = (point, box, margin) =>
  Math.abs(point.x - centre(box).x) < BOX_W / 2 + margin && Math.abs(point.y - centre(box).y) < BOX_H / 2 + margin
for (const node of nodes.values()) {
  const at = `${node.id}.json`
  const byId = new Map(node.boxes.map((box) => [box.id, box]))
  for (const box of node.boxes) {
    if (box.at[0] < 0 || box.at[0] > 4) errors.push(`${at}: box "${box.id}" is outside columns 0 to 4`)
    if (box.at[1] < 0 || box.at[1] > 3.2) errors.push(`${at}: box "${box.id}" is outside rows 0 to 3.2`)
    if (box.label.length > 26) errors.push(`${at}: box "${box.id}" label is longer than 26 characters`)
    if ((box.sub ?? "").length > 40) errors.push(`${at}: box "${box.id}" sub is longer than 40 characters`)
    for (const other of node.boxes) {
      if (other.id < box.id && inside(centre(other), { at: box.at }, BOX_W / 2 + 12 - 0) && Math.abs(centre(other).y - centre(box).y) < BOX_H + 12) {
        errors.push(`${at}: boxes "${other.id}" and "${box.id}" overlap or touch`)
      }
    }
  }
  for (const edge of node.edges) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to || from === to) continue
    const a = centre(from)
    const b = centre(to)
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    const n = { x: (b.y - a.y) / length, y: -(b.x - a.x) / length }
    const control = { x: (a.x + b.x) / 2 + n.x * (edge.bend ?? 0), y: (a.y + b.y) / 2 + n.y * (edge.bend ?? 0) }
    for (let i = 1; i < 40; i += 1) {
      const t = i / 40
      const point = {
        x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * control.x + t ** 2 * b.x,
        y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * control.y + t ** 2 * b.y,
      }
      const hit = node.boxes.find((box) => box !== from && box !== to && inside(point, box, 6))
      if (hit) {
        errors.push(`${at}: edge "${edge.id}" is drawn through box "${hit.id}"`)
        break
      }
    }
    const widest = Math.max(...(edge.label ?? "").split("\n").map((line) => line.length)) * 6.4
    if (edge.label && !edge.bend && a.y === b.y && widest > Math.abs(b.x - a.x) - BOX_W - 4) {
      errors.push(`${at}: edge "${edge.id}" label is wider than the gap between its boxes; shorten it or break it with \\n`)
    }
    const duplicate = node.edges.find((other) => other !== edge && other.from === edge.from && other.to === edge.to)
    if (duplicate) errors.push(`${at}: edges "${edge.id}" and "${duplicate.id}" join the same boxes in the same direction`)
  }
}

const seen = new Set()
const visit = (id) => {
  if (seen.has(id) || !nodes.has(id)) return
  seen.add(id)
  for (const box of nodes.get(id).boxes) if (box.opens) visit(box.opens)
}
visit(ROOT)
if (!nodes.has(ROOT)) errors.push(`missing the root diagram "${ROOT}"`)
for (const id of nodes.keys()) {
  if (!seen.has(id) && !process.argv.includes("--allow-unreachable")) errors.push(`${id}.json: no box opens this diagram`)
}

if (errors.length) {
  for (const error of errors) console.error(`error  ${error}`)
  process.exit(1)
}
console.log(`atlas: ${nodes.size} diagrams, all references resolve`)
