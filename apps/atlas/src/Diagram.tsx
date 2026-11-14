import { cn } from "@iot-os/ui/lib/utils"
import { ZoomInIcon } from "lucide-react"
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react"
import type { AtlasNode, Box, Edge, Step } from "./model"

const CELL_W = 260
const CELL_H = 150
const BOX_W = 184
const BOX_H = 76
const PAD = 44
const ZOOM_MS = 420
const EASE = "cubic-bezier(0.3, 0, 0.2, 1)"

type Point = { x: number; y: number }

/** How a diagram arrives: zoomed out of a box, into the page, or just faded. */
export type Enter = { type: "fade" } | { type: "in" } | { type: "out"; fromBox?: string }

export type DiagramHandle = {
  /** Plays the leaving half of a zoom and resolves when it is done. */
  exit(direction: "in" | "out", boxId?: string): Promise<void>
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function centre(box: Box): Point {
  return { x: PAD + box.at[0] * CELL_W + CELL_W / 2, y: PAD + box.at[1] * CELL_H + CELL_H / 2 }
}

/** Where the line from a box's centre towards `to` leaves the box. */
function leave(from: Point, to: Point, gap = 7): Point {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (!dx && !dy) return from
  const t = Math.min(
    dx ? (BOX_W / 2 + gap) / Math.abs(dx) : Infinity,
    dy ? (BOX_H / 2 + gap) / Math.abs(dy) : Infinity,
  )
  return { x: from.x + dx * t, y: from.y + dy * t }
}

type Shape = { d: string; label: Point; anchor: "start" | "middle" | "end" }

function shape(edge: Edge, boxes: Map<string, Box>, paired: boolean): Shape {
  const a = centre(boxes.get(edge.from)!)
  const b = centre(boxes.get(edge.to)!)
  if (edge.from === edge.to) {
    // A loop sits above its box, or below it when the edge bends the other way.
    const side = (edge.bend ?? 1) < 0 ? 1 : -1
    const base = a.y + side * (BOX_H / 2 + 5)
    return {
      d: `M ${a.x - 36} ${base} C ${a.x - 78} ${base + side * 62}, ${a.x + 78} ${base + side * 62}, ${a.x + 36} ${base}`,
      label: { x: a.x, y: base + side * 54 + (side > 0 ? 10 : 0) },
      anchor: "middle",
    }
  }
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  // Unit normal on the left of the direction of travel.
  const n = { x: (b.y - a.y) / length, y: -(b.x - a.x) / length }
  const vertical = Math.abs(b.y - a.y) > Math.abs(b.x - a.x)
  if (edge.bend) {
    const control = { x: (a.x + b.x) / 2 + n.x * edge.bend, y: (a.y + b.y) / 2 + n.y * edge.bend }
    const start = leave(a, control)
    const end = leave(b, control)
    return {
      d: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
      label: { x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x, y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y - 8 },
      anchor: "middle",
    }
  }
  // Two edges between the same boxes run side by side, each on its own left.
  const shift = paired ? 13 : 0
  const start = leave(a, b)
  const end = leave(b, a)
  const from = { x: start.x + n.x * shift, y: start.y + n.y * shift }
  const to = { x: end.x + n.x * shift, y: end.y + n.y * shift }
  const t = edge.labelAt ?? 0.5
  const mid = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
  if (vertical) {
    const side = paired ? Math.sign(n.x) || 1 : 1
    return { d: `M ${from.x} ${from.y} L ${to.x} ${to.y}`, label: { x: mid.x + side * 10, y: mid.y + 4 }, anchor: side > 0 ? "start" : "end" }
  }
  const above = !paired || n.y < 0
  return { d: `M ${from.x} ${from.y} L ${to.x} ${to.y}`, label: { x: mid.x, y: above ? mid.y - 9 : mid.y + 18 }, anchor: "middle" }
}

/** A dot that travels the active edge, again every couple of seconds. */
function Token({ d }: { d: string }) {
  const path = useRef<SVGPathElement>(null)
  const dot = useRef<SVGCircleElement>(null)
  useEffect(() => {
    const line = path.current
    const circle = dot.current
    if (!line || !circle || reducedMotion()) return
    const total = line.getTotalLength()
    const travel = 900
    const cycle = 2100
    let frame = 0
    const began = performance.now()
    const tick = (now: number) => {
      const t = Math.min(((now - began) % cycle) / travel, 1)
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
      const point = line.getPointAtLength(eased * total)
      circle.setAttribute("cx", String(point.x))
      circle.setAttribute("cy", String(point.y))
      circle.setAttribute("opacity", t >= 1 ? "0" : "1")
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [d])
  return (
    <>
      <path ref={path} d={d} fill="none" stroke="none" />
      <circle ref={dot} r={6} opacity={0} className="fill-primary" />
    </>
  )
}

const tones: Record<NonNullable<Box["tone"]>, string> = {
  person: "rounded-full border bg-secondary text-secondary-foreground",
  external: "rounded-lg border border-dashed border-muted-foreground/60 bg-background text-muted-foreground",
  system: "rounded-lg border bg-card text-card-foreground shadow-panel",
  store: "rounded-lg border-2 border-double bg-card text-card-foreground",
  state: "rounded-full border bg-card text-card-foreground shadow-panel",
}

export function Diagram({
  ref,
  node,
  enter,
  step,
  selected,
  onSelect,
  onOpen,
}: {
  ref: Ref<DiagramHandle>
  node: AtlasNode
  enter: Enter
  step: Step | null
  selected: string | null
  onSelect: (box: Box | null) => void
  onOpen: (box: Box) => void
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const entered = useRef(false)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  const boxes = useMemo(() => new Map(node.boxes.map((box) => [box.id, box])), [node])
  const columns = Math.max(...node.boxes.map((box) => box.at[0])) + 1
  const rows = node.rows ?? Math.max(...node.boxes.map((box) => box.at[1])) + 1
  const width = columns * CELL_W + PAD * 2
  const height = rows * CELL_H + PAD * 2
  const shapes = useMemo(
    () =>
      new Map(
        node.edges.map((edge) => [
          edge.id,
          shape(edge, boxes, node.edges.some((other) => other.from === edge.to && other.to === edge.from && other !== edge)),
        ]),
      ),
    [node, boxes],
  )

  useLayoutEffect(() => {
    const element = wrap.current!
    const measure = () => setSize({ w: element.clientWidth, h: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const fit = size ? Math.min(size.w / width, size.h / height, 1.25) : 1
  const placed = (scale: number, focus?: Point) => {
    if (!size) return "none"
    const x = focus ? size.w / 2 - focus.x * scale : (size.w - width * scale) / 2
    const y = focus ? size.h / 2 - focus.y * scale : (size.h - height * scale) / 2
    return `translate(${x}px, ${y}px) scale(${scale})`
  }
  const rest = placed(fit)
  const inside = (boxId?: string) => {
    const box = boxId ? boxes.get(boxId) : undefined
    return box ? placed(fit * 4, centre(box)) : placed(fit * 1.6)
  }

  // Arrive: shrink into place after zooming in, or pull back out of the box we left.
  useLayoutEffect(() => {
    if (!size || entered.current) return
    entered.current = true
    if (reducedMotion()) return
    const from =
      enter.type === "in" ? placed(fit * 0.55) : enter.type === "out" ? inside(enter.fromBox) : rest
    stage.current!.animate(
      [
        { transform: from, opacity: 0 },
        { transform: rest, opacity: 1 },
      ],
      { duration: enter.type === "fade" ? 180 : ZOOM_MS, easing: EASE },
    )
  })

  useImperativeHandle(ref, () => ({
    async exit(direction, boxId) {
      if (!size || reducedMotion()) return
      const to = direction === "in" ? inside(boxId) : placed(fit * 0.55)
      const animation = stage.current!.animate(
        [
          { transform: rest, opacity: 1 },
          { transform: to, opacity: 0 },
        ],
        { duration: ZOOM_MS, easing: EASE, fill: "forwards" },
      )
      // A hidden or throttled tab never finishes the animation; navigate anyway.
      await Promise.race([
        animation.finished.catch(() => undefined),
        new Promise((resolve) => window.setTimeout(resolve, ZOOM_MS + 150)),
      ])
    },
  }))

  const activeEdge = step?.edge ? node.edges.find((edge) => edge.id === step.edge) : undefined
  const lit = new Set<string>(activeEdge ? [activeEdge.from, activeEdge.to] : step?.box ? [step.box] : [])

  return (
    <div ref={wrap} className="absolute inset-0 overflow-hidden" onClick={() => onSelect(null)}>
      <div
        ref={stage}
        className="absolute top-0 left-0 origin-top-left"
        style={{ width, height, transform: rest, visibility: size ? "visible" : "hidden" }}
      >
        <svg width={width} height={height} className="absolute inset-0 overflow-visible" aria-hidden>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground" />
            </marker>
            <marker id="arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-primary" />
            </marker>
          </defs>
          {node.edges.map((edge) => {
            const { d } = shapes.get(edge.id)!
            const active = edge === activeEdge
            return (
              <path
                key={edge.id}
                d={d}
                fill="none"
                strokeWidth={active ? 2.5 : 1.25}
                strokeDasharray={edge.dashed ? "5 5" : undefined}
                markerEnd={active ? "url(#arrow-active)" : "url(#arrow)"}
                className={cn("transition-[stroke,opacity]", active ? "stroke-primary" : "stroke-muted-foreground", step && !active && "opacity-35")}
              />
            )
          })}
          {node.edges.map((edge) => {
            if (!edge.label) return null
            const { label, anchor } = shapes.get(edge.id)!
            const active = edge === activeEdge
            const lines = edge.label.split("\n")
            return (
              <text
                key={edge.id}
                x={label.x}
                y={label.y - (lines.length - 1) * 7}
                textAnchor={anchor}
                className={cn(
                  "stroke-background text-meta transition-opacity [paint-order:stroke]",
                  active ? "fill-primary font-medium" : "fill-muted-foreground",
                  step && !active && "opacity-35",
                )}
                strokeWidth={6}
                strokeLinejoin="round"
              >
                {lines.map((line, index) => (
                  <tspan key={index} x={label.x} dy={index ? 14 : 0}>
                    {line}
                  </tspan>
                ))}
              </text>
            )
          })}
          {activeEdge ? <Token key={activeEdge.id} d={shapes.get(activeEdge.id)!.d} /> : null}
        </svg>
        {node.boxes.map((box) => {
          const point = centre(box)
          const interactive = Boolean(box.opens || box.detail)
          return (
            <button
              key={box.id}
              type="button"
              data-box={box.id}
              aria-label={box.opens ? `${box.label}: zoom in` : box.label}
              aria-pressed={interactive && !box.opens ? selected === box.id : undefined}
              disabled={!interactive}
              onClick={(event) => {
                event.stopPropagation()
                if (box.opens) onOpen(box)
                else onSelect(box)
              }}
              className={cn(
                "absolute flex flex-col items-center justify-center gap-0.5 px-4 text-center transition-[opacity,box-shadow,border-color] outline-none",
                "focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:cursor-pointer enabled:hover:border-primary/70",
                tones[box.tone ?? "system"],
                box.opens && "border-primary/60 ring-1 ring-primary/25",
                (selected === box.id || lit.has(box.id)) && "border-primary ring-2 ring-primary/40",
                step && !lit.has(box.id) && "opacity-45",
              )}
              style={{ left: point.x - BOX_W / 2, top: point.y - BOX_H / 2, width: BOX_W, height: BOX_H }}
            >
              <span className="text-heading leading-tight">{box.label}</span>
              {box.sub ? <span className="text-micro leading-tight text-muted-foreground">{box.sub}</span> : null}
              {box.opens ? (
                <span className="absolute -top-2.5 -right-2.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <ZoomInIcon className="size-3" aria-hidden />
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
