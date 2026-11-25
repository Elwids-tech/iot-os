/**
 * Turns a window of evaluations (`GET …/{workflow}/series`) and the runtime's current
 * state into what the Execution tab draws: one sentence, a card per step, state bands,
 * the list of changes and how the readings are arriving. Pure, so it is tested directly.
 */

export type SeriesNodeResult = {
  node_id: string; status: string; known: boolean; value: unknown; reason: string
  observed_at?: string | null; side?: "true" | "false" | null
}
export type SeriesPoint = {
  id: string; operation_uuid: string; at: string; trigger: string; outcome: string
  intents: number; generation: number; nodes: SeriesNodeResult[]
}
export type SeriesNode = {
  id: string; type: string
  /** A sustained condition's duration. */
  seconds?: number
  /** An alert's title. */
  title?: string
  binding?: { role: string; device_uuid: string; device_name?: string | null; parameter_label: string; unit: string; data_type: string; fresh_seconds?: number | null }
}
export type Series = { from: string; to: string; data: SeriesPoint[]; nodes: SeriesNode[] }
/** The runtime's stored execution state: when a sustained step started counting. */
export type RuntimeState = { nodes?: Record<string, { since?: string | null; active?: boolean } | undefined> } | null | undefined

export type Tone = "good" | "warning" | "critical" | "info" | "muted"
export type Progress = { elapsedMs: number; totalMs: number; sinceMs: number; dueMs: number }
export type Summary = { tone: Tone; title: string; detail: string; progress?: Progress }
export type StepCard = { id: string; type: string; headline: string; caption: string; tone: Tone; fraction?: number; deciding: boolean }
export type SegmentTone = "on" | "off" | "raised" | "clear" | "fresh" | "unknown" | "none"
export type Segment = { from: number; to: number; label: string; tone: SegmentTone; pointId?: string }
export type Band = { id: string; label: string; segments: Segment[] }
export type Change =
  | { kind: "event"; pointId: string; at: string; tone: Tone; title: string; detail?: string }
  | { kind: "quiet"; points: SeriesPoint[] }
export type Health = { reportGapMs?: number; ageOnArrivalMs?: number; freshMs?: number; gaps: number; suggestedFreshSeconds?: number }

type Titles = (id: string) => string

const isSource = (node: SeriesNode) => node.type.startsWith("source.")
const isAlert = (node: SeriesNode) => node.type === "action.alert.v1"
const isAction = (node: SeriesNode) => node.type.startsWith("action.")

/** A node's result in one evaluation; windows can evaluate a node more than once, the last one stands. */
export function resultOf(point: SeriesPoint | undefined, id: string): SeriesNodeResult | undefined {
  return point ? [...point.nodes].reverse().find((node) => node.node_id === id) : undefined
}

export function formatSpan(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`
  const days = Math.floor(hours / 24)
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`
}

/** A reading as people say it: On/Off for a switch, a rounded number with its unit otherwise. */
export function valueText(result: SeriesNodeResult | undefined, node?: SeriesNode): string | undefined {
  if (!result?.known) return undefined
  const value = result.value
  if (typeof value === "boolean") return isSourceType(node) ? (value ? "On" : "Off") : value ? "True" : "False"
  if (typeof value === "number") {
    const text = String(Math.round(value * 100) / 100)
    return node?.binding?.unit ? `${text} ${node.binding.unit}` : text
  }
  return typeof value === "string" ? value : value === null || value === undefined ? undefined : JSON.stringify(value)
}
const isSourceType = (node?: SeriesNode) => Boolean(node && isSource(node))

const reasons: Record<string, string> = {
  stale: "no fresh reading", "invalid reading": "the last reading was invalid", "reading type mismatch": "the reading has the wrong type",
  "missing input": "an input is missing", "insufficient evidence": "not enough readings yet", "window pending": "the first window has not closed", cooldown: "cooling down",
}
const reasonText = (reason: string | undefined) => reasons[reason ?? ""] ?? (reason || "no usable value")

/**
 * Whether an alert step is raised after each evaluation. A trace says "triggered" for
 * both raising and clearing, so the next decided status tells which one it was.
 */
export function alertStates(points: SeriesPoint[], id: string): boolean[] {
  const states: boolean[] = []
  let active = false
  points.forEach((point, index) => {
    const status = resultOf(point, id)?.status
    if (status === "active") active = true
    else if (status === "not_matched") active = false
    else if (status === "triggered") {
      const next = points.slice(index + 1).map((later) => resultOf(later, id)?.status).find((later) => later === "active" || later === "not_matched" || later === "triggered")
      active = next === "active" ? true : next === "not_matched" ? false : !active
    }
    states.push(active)
  })
  return states
}

/** Sustained steps that are counting now: started, and not yet answered true. */
function counting(series: Series, state: RuntimeState, now: number) {
  const last = series.data.at(-1)
  return series.nodes.flatMap((node) => {
    const since = state?.nodes?.[node.id]?.since
    const result = resultOf(last, node.id)
    if (node.type !== "sustained.v1" || !since || (result?.known && result.value === true)) return []
    const sinceMs = Date.parse(since), totalMs = Number(node.seconds) * 1000
    return Number.isFinite(sinceMs) && totalMs > 0 ? [{ node, progress: { sinceMs, totalMs, elapsedMs: Math.max(0, now - sinceMs), dueMs: sinceMs + totalMs } }] : []
  })
}

/** The one sentence at the top: the most pressing thing that is true right now. */
export function summarize(series: Series, state: RuntimeState, now: number, clock: (ms: number) => string): Summary {
  const last = series.data.at(-1)
  if (!last) return { tone: "muted", title: "No evaluations in this period", detail: "One is recorded each time a reading arrives or a timer is due." }
  if (last.outcome === "suspended") return { tone: "critical", title: "The automation is suspended", detail: "Open the latest evaluation to see why." }
  for (const node of series.nodes.filter(isAlert)) {
    const states = alertStates(series.data, node.id)
    if (!states.at(-1)) continue
    const from = states.lastIndexOf(false) + 1
    const raised = Date.parse(series.data[from].at)
    const title = node.title || "Alert"
    return { tone: "critical", title: `Alert raised: ${title}`, detail: `${from === 0 ? "Raised before" : "Raised at"} ${clock(raised)}, ${formatSpan(now - raised)} ago. It clears when the condition ends.` }
  }
  const held = counting(series, state, now)[0]
  if (held) {
    const { progress } = held
    return progress.elapsedMs >= progress.totalMs
      ? { tone: "warning", title: `The condition has held for ${formatSpan(progress.elapsedMs)}`, detail: "The duration has passed. The next fresh reading confirms it.", progress }
      : { tone: "warning", title: `The condition has held for ${formatSpan(progress.elapsedMs)} of ${formatSpan(progress.totalMs)}`, detail: `The action is due at ${clock(progress.dueMs)} if it continues.`, progress }
  }
  const stale = series.nodes.filter(isSource).find((node) => !resultOf(last, node.id)?.known)
  if (stale) {
    const name = [stale.binding?.device_name, stale.binding?.parameter_label].filter(Boolean).join(" · ") || stale.id
    return { tone: "warning", title: "Waiting for a fresh reading", detail: `${name}: ${reasonText(resultOf(last, stale.id)?.reason)}. Nothing is decided until one arrives.` }
  }
  if (last.intents > 0) return { tone: "info", title: "An action was just requested", detail: `Requested at ${clock(Date.parse(last.at))}.` }
  return { tone: "good", title: "Nothing to do right now", detail: `The condition is not met. Last checked at ${clock(Date.parse(last.at))}.` }
}

/** One card per deployed step, in evaluation order, with the step that decides the outcome marked. */
export function stepCards(series: Series, state: RuntimeState, now: number, titles: Titles): StepCard[] {
  const last = series.data.at(-1)
  const held = new Map(counting(series, state, now).map((entry) => [entry.node.id, entry.progress]))
  const alertNow = new Map(series.nodes.filter(isAlert).map((node) => [node.id, alertStates(series.data, node.id).at(-1) ?? false]))
  const cards = series.nodes.map((node): StepCard & { blocks: boolean } => {
    const result = resultOf(last, node.id)
    const base = { id: node.id, type: node.type, deciding: false }
    if (!result) return { ...base, headline: "Not evaluated", caption: titles(node.id), tone: "muted", blocks: false }
    if (isSource(node)) {
      const text = valueText(result, node)
      const where = [node.binding?.device_name, node.binding?.parameter_label].filter(Boolean).join(" · ")
      return text
        ? { ...base, headline: text, caption: where, tone: "info", blocks: false }
        : { ...base, headline: "No fresh reading", caption: where || reasonText(result.reason), tone: "warning", blocks: true }
    }
    if (isAlert(node)) {
      const raised = alertNow.get(node.id)
      return { ...base, headline: raised ? "Raised" : result.status === "waiting" ? "Waiting" : "Not raised", caption: node.title ?? "", tone: raised ? "critical" : "muted", blocks: false }
    }
    if (isAction(node)) {
      const headline = result.status === "triggered" ? "Requested" : result.status === "suppressed" ? "Held back" : result.status === "waiting" ? "Waiting" : "Idle"
      return { ...base, headline, caption: result.status === "suppressed" ? "Already sent, or cooling down" : "", tone: result.status === "triggered" ? "info" : "muted", blocks: false }
    }
    if (node.type === "branch.v1") {
      return result.side
        ? { ...base, headline: result.side === "true" ? "True side" : "False side", caption: "The other side is skipped", tone: "info", blocks: false }
        : { ...base, headline: "No decision", caption: "Its input has no usable value", tone: "warning", blocks: false }
    }
    if (node.type === "sustained.v1") {
      const total = Number(node.seconds) * 1000
      const progress = held.get(node.id)
      if (result.known && result.value === true) return { ...base, headline: `Held for ${formatSpan(total)}`, caption: "The duration has passed", tone: "good", fraction: 1, blocks: false }
      if (progress) return { ...base, headline: `${formatSpan(progress.elapsedMs)} of ${formatSpan(total)}`, caption: result.known ? "Counting" : "Counting · waiting for a fresh reading", tone: "warning", fraction: Math.min(1, progress.elapsedMs / total), blocks: true }
      return { ...base, headline: "Not holding", caption: `Needs ${formatSpan(total)}`, tone: "muted", fraction: 0, blocks: result.known }
    }
    const text = valueText(result, node)
    if (!text) return { ...base, headline: "Unknown", caption: reasonText(result.reason), tone: "warning", blocks: false }
    return { ...base, headline: text, caption: "", tone: result.value === false ? "muted" : "good", blocks: result.value === false }
  })
  // The step to look at: the first that stops the chain, else the action at the end.
  const deciding = cards.find((card) => card.blocks) ?? [...cards].reverse().find((card) => card.type.startsWith("action."))
  return cards.map(({ blocks: _blocks, ...card }) => ({ ...card, deciding: card.id === deciding?.id }))
}

function merge(labels: { label: string; tone: SegmentTone; pointId?: string }[], times: number[], from: number, to: number): Segment[] {
  const segments: Segment[] = []
  if (!times.length || times[0] > from) segments.push({ from, to: times[0] ?? to, label: "No evaluations", tone: "none" })
  labels.forEach((entry, index) => {
    const start = Math.max(from, times[index]), end = index + 1 < times.length ? times[index + 1] : to
    const previous = segments.at(-1)
    if (previous && previous.label === entry.label && previous.tone === entry.tone) previous.to = end
    else if (end > start || index === labels.length - 1) segments.push({ from: start, to: Math.max(end, start), ...entry })
  })
  return segments
}

/** State over the window: each switch input, whether readings were fresh, and each alert. */
export function bands(series: Series, titles: Titles): Band[] {
  const from = Date.parse(series.from), to = Date.parse(series.to)
  const times = series.data.map((point) => Date.parse(point.at))
  const rows: Band[] = []
  const sources = series.nodes.filter(isSource)
  for (const node of sources.filter((source) => source.binding?.data_type === "boolean")) {
    let lastKnown: { label: string; tone: SegmentTone } | undefined
    rows.push({ id: node.id, label: node.binding?.parameter_label ?? titles(node.id), segments: merge(series.data.map((point) => {
      const result = resultOf(point, node.id)
      // A stale gap keeps the last state on this row; the Readings row shows the gap.
      if (result?.known) lastKnown = { label: result.value === true ? "On" : "Off", tone: result.value === true ? "on" : "off" }
      return { ...(lastKnown ?? { label: "No reading", tone: "unknown" as const }), pointId: point.id }
    }), times, from, to) })
  }
  if (sources.length) rows.push({ id: "readings", label: "Readings", segments: merge(series.data.map((point) => {
    const fresh = sources.every((node) => resultOf(point, node.id)?.known)
    return { label: fresh ? "Fresh" : "No fresh reading", tone: fresh ? "fresh" as const : "unknown" as const, pointId: point.id }
  }), times, from, to) })
  for (const node of series.nodes.filter(isAlert)) {
    const states = alertStates(series.data, node.id)
    rows.push({ id: node.id, label: series.nodes.filter(isAlert).length > 1 ? titles(node.id) : "Alert", segments: merge(series.data.map((point, index) => (
      { label: states[index] ? "Raised" : "Clear", tone: states[index] ? "raised" as const : "clear" as const, pointId: point.id }
    )), times, from, to) })
  }
  return rows
}

/** What changed, newest first; evaluations that changed nothing fold into one line. */
export function changes(series: Series, titles: Titles): Change[] {
  const list: Change[] = []
  const alerts = series.nodes.filter(isAlert).map((node) => ({ node, states: alertStates(series.data, node.id) }))
  const switches = series.nodes.filter((node) => isSource(node) && node.binding?.data_type === "boolean")
  const known = new Map<string, unknown>()
  series.data.forEach((point, index) => {
    const events: Change[] = []
    const add = (tone: Tone, title: string, detail?: string) => events.push({ kind: "event", pointId: point.id, at: point.at, tone, title, detail })
    const previous = series.data[index - 1]
    if (previous && previous.generation !== point.generation) add("info", `Version ${point.generation} took over`, "State started fresh with this deployment.")
    if (point.outcome === "suspended" && previous?.outcome !== "suspended") add("critical", "Execution suspended")
    for (const node of switches) {
      const result = resultOf(point, node.id)
      if (!result?.known) continue
      if (known.has(node.id) && known.get(node.id) !== result.value) add("info", `${node.binding?.parameter_label ?? titles(node.id)} turned ${result.value === true ? "on" : "off"}`, node.binding?.device_name ?? undefined)
      known.set(node.id, result.value)
    }
    for (const { node, states } of alerts) {
      const before = index > 0 ? states[index - 1] : false
      const title = node.title || undefined
      if (states[index] && !before) add("critical", "Alert raised", title)
      if (!states[index] && before) add("good", "Alert cleared", title)
    }
    for (const node of series.nodes.filter((entry) => isAction(entry) && !isAlert(entry))) {
      if (resultOf(point, node.id)?.status === "triggered") add("info", `${titles(node.id)} requested`)
    }
    const tail = list.at(-1)
    if (events.length) list.push(...events)
    else if (tail?.kind === "quiet") tail.points.push(point)
    else list.push({ kind: "quiet", points: [point] })
  })
  return list.reverse()
}

const median = (values: number[]) => {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** How readings arrive against how long they count as fresh, and how often they lapsed. */
export function dataHealth(series: Series): Health {
  const sources = series.nodes.filter(isSource)
  const arrivals = series.data.filter((point) => point.trigger === "telemetry")
  const times = arrivals.map((point) => Date.parse(point.at))
  // Readings that arrive together are one report.
  const gaps = times.slice(1).map((time, index) => time - times[index]).filter((gap) => gap > 1000)
  const ages = arrivals.flatMap((point) => sources.flatMap((node) => {
    const result = resultOf(point, node.id)
    const observed = result?.observed_at ? Date.parse(result.observed_at) : NaN
    return result?.known && Number.isFinite(observed) && observed > 0 ? [Date.parse(point.at) - observed] : []
  }))
  const fresh = sources.flatMap((node) => (node.binding?.fresh_seconds ? [node.binding.fresh_seconds * 1000] : []))
  const freshMs = fresh.length ? Math.min(...fresh) : undefined
  let lapses = 0, wasFresh = true
  for (const point of series.data) {
    const isFresh = sources.every((node) => resultOf(point, node.id)?.known)
    if (wasFresh && !isFresh) lapses++
    wasFresh = isFresh
  }
  const reportGapMs = median(gaps), ageOnArrivalMs = median(ages)
  // A reading must outlive the wait for the next one, counted from when it was taken.
  const needed = reportGapMs !== undefined && ageOnArrivalMs !== undefined ? reportGapMs + ageOnArrivalMs : undefined
  const tight = freshMs !== undefined && needed !== undefined && freshMs < needed
  return { reportGapMs, ageOnArrivalMs, freshMs, gaps: sources.length ? lapses : 0, suggestedFreshSeconds: tight ? Math.ceil((needed * 2) / 60000) * 60 : undefined }
}
