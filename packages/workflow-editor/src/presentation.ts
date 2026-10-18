import {
  RadioIcon,
  HashIcon,
  CalculatorIcon,
  ArrowRightLeftIcon,
  GitCompareArrowsIcon,
  ListFilterIcon,
  Clock3Icon,
  GitMergeIcon,
  GitBranchIcon,
  ActivityIcon,
  TimerIcon,
  HourglassIcon,
  BellRingIcon,
  SendIcon,
  PowerIcon,
  MapPinIcon,
  type LucideIcon,
} from "lucide-react";
import type { Workflow, WorkflowNode } from "./types";

/** Rendered node size at zoom 1; arranged layouts space nodes by it. */
export type NodeSize = { width: number; height: number };
/** A one-port-per-side card; multi-port nodes add a labelled row per port. */
export const NODE_SIZE: NodeSize = { width: 224, height: 52 };
const PORT_ROW = 20;
const COLUMN_GAP = 72;
// Leaves room for a simulation outcome chip, which adds 20px to a card.
const ROW_GAP = 32;
/** Size before React Flow measures a node, from its port rows. */
export function estimatedSize(inputs: number, outputs: number): NodeSize {
  const rows = Math.max(inputs > 1 ? inputs : 0, outputs > 1 ? outputs : 0);
  return { ...NODE_SIZE, height: NODE_SIZE.height + (rows ? rows * PORT_ROW + 1 : 0) };
}

/**
 * Layout is presentation only: no node, edge, or executable configuration changes.
 * Columns follow the graph depth. The first column stacks; later nodes line up with
 * the average centre of their inputs, pushed apart where cards would overlap.
 */
export function arrangeNodes(
  workflow: Workflow,
  sizeOf: (id: string) => NodeSize = () => NODE_SIZE,
) {
  const pending = new Map(workflow.nodes.map((node) => [node.id, 0]));
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  const depths = new Map<string, number>();
  for (const edge of workflow.edges) {
    if (!pending.has(edge.source) || !pending.has(edge.target)) continue;
    pending.set(edge.target, pending.get(edge.target)! + 1);
    children.set(edge.source, [
      ...(children.get(edge.source) ?? []),
      edge.target,
    ]);
    parents.set(edge.target, [...(parents.get(edge.target) ?? []), edge.source]);
  }
  const ready = workflow.nodes
    .filter((node) => pending.get(node.id) === 0)
    .map((node) => node.id);
  for (let index = 0; index < ready.length; index++) {
    const id = ready[index];
    for (const child of children.get(id) ?? []) {
      depths.set(
        child,
        Math.max(depths.get(child) ?? 0, (depths.get(id) ?? 0) + 1),
      );
      pending.set(child, pending.get(child)! - 1);
      if (pending.get(child) === 0) ready.push(child);
    }
  }
  const layers = new Map<number, string[]>();
  for (const node of workflow.nodes) {
    const depth = pending.get(node.id) === 0 ? (depths.get(node.id) ?? 0) : 0;
    layers.set(depth, [...(layers.get(depth) ?? []), node.id]);
  }
  const columns = Array.from(layers).sort(([a], [b]) => a - b);
  const centres = new Map<string, number>();
  const positions: Record<string, { x: number; y: number }> = {};
  let x = 0;
  for (const [, ids] of columns) {
    const cards = ids.map((id) => {
      const inputs = (parents.get(id) ?? []).filter((p) => centres.has(p));
      const target = inputs.length
        ? inputs.reduce((sum, p) => sum + centres.get(p)!, 0) / inputs.length
        : undefined;
      return { id, height: sizeOf(id).height, target };
    });
    // Sorting by target keeps edges from crossing; cards without inputs keep their order at the end.
    cards.sort((a, b) => (a.target ?? Infinity) - (b.target ?? Infinity));
    let bottom: number | undefined;
    const tops = cards.map((card) => {
      const floor = bottom === undefined ? -Infinity : bottom + ROW_GAP;
      const top =
        card.target === undefined
          ? Math.max(floor, 0)
          : Math.max(card.target - card.height / 2, floor);
      bottom = top + card.height;
      return top;
    });
    // Re-centre a column that overlaps pushed down: on its targets, or on 0 for the first column.
    const aligned = cards.flatMap((card, i) =>
      card.target === undefined ? [] : [tops[i] + card.height / 2 - card.target],
    );
    const shift = aligned.length
      ? aligned.reduce((sum, d) => sum + d, 0) / aligned.length
      : (tops[0] + bottom!) / 2;
    cards.forEach((card, i) => {
      positions[card.id] = { x, y: tops[i] - shift };
      centres.set(card.id, tops[i] - shift + card.height / 2);
    });
    x += Math.max(...ids.map((id) => sizeOf(id).width)) + COLUMN_GAP;
  }
  const top = Math.min(0, ...Object.values(positions).map((p) => p.y));
  for (const position of Object.values(positions)) position.y -= top;
  return positions;
}

/** Display names for the devices and parameters that bindings point at, keyed by UUID. */
export type ResourceNames = Record<string, string>;
type Context = { workflow?: Workflow; names?: ResourceNames };
type Reading = { name?: string; unit?: string };

const operators: Record<string, string> = {
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  eq: "=",
  add: "+",
  subtract: "−",
  multiply: "×",
  divide: "÷",
};
const aggregates: Record<string, string> = {
  count: "Count",
  sum: "Sum",
  min: "Minimum",
  max: "Maximum",
  average: "Average",
};
const units: Record<string, string> = { C: "°C", F: "°F" };
const unitLabel = (unit: unknown) => units[String(unit)] ?? String(unit ?? "");
const shown = (value: unknown) =>
  value === "" || value == null ? "?" : String(value);
const withUnit = (value: unknown, unit?: string) =>
  unit && value !== "" && value != null ? `${value} ${unit}` : shown(value);
/** Lower-case a label inside a sentence, leaving acronyms such as "LED mode" alone. */
const inline = (label: string) =>
  /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
/** 90 → "1 min 30 s"; blank or invalid → undefined. */
export function duration(value: unknown): string | undefined {
  const total = Number(value);
  if (value === "" || value == null || !Number.isFinite(total) || total < 0)
    return undefined;
  const parts = [
    [Math.floor(total / 3600), "h"],
    [Math.floor((total % 3600) / 60), "min"],
    [total % 60, "s"],
  ].filter(([amount]) => amount);
  return parts.map(([amount, unit]) => `${amount} ${unit}`).join(" ") || "0 s";
}
/** Generated roles (`node_…`, `cmd_…`) say nothing to a reader. */
const roleName = (role: unknown) =>
  typeof role === "string" && role && !/^(node|cmd)_/.test(role)
    ? role.replaceAll("_", " ")
    : undefined;
const bindingFor = (ctx: Context, role: unknown) =>
  ctx.workflow?.bindings.find((b) => b.role === role);
/** Vertices of a single-ring polygon, without the closing point. */
function vertices(geometry: unknown): number | undefined {
  const ring = (geometry as { coordinates?: unknown[][] } | null)?.coordinates?.[0];
  return Array.isArray(ring) && ring.length > 1 ? ring.length - 1 : undefined;
}
/** Command settings keyed by binding role; legacy nodes keep one binding and value. */
function settingsOf(node: WorkflowNode): [string, unknown][] {
  const { settings, binding, value } = node.config;
  if (settings && typeof settings === "object" && !Array.isArray(settings))
    return Object.entries(settings);
  return typeof binding === "string" && binding ? [[binding, value]] : [];
}

/** What arrives on a node's input port: the upstream reading's name and unit. */
function input(ctx: Context, nodeId: string, port: string, depth = 0): Reading {
  const edge = ctx.workflow?.edges.find(
    (e) => e.target === nodeId && e.target_port === port,
  );
  const source = edge && ctx.workflow?.nodes.find((n) => n.id === edge.source);
  return source && depth < 12 ? reading(ctx, source, edge.source_port, depth + 1) : {};
}
function reading(ctx: Context, node: WorkflowNode, port: string, depth: number): Reading {
  const named = nodeName(node);
  const c = node.config;
  switch (node.type) {
    case "source.parameter.v1": {
      const b = bindingFor(ctx, c.binding);
      const parameter = b && ctx.names?.[b.parameter_uuid];
      return { name: parameter ?? named ?? roleName(c.binding), unit: b?.unit || undefined };
    }
    case "constant.v1":
      return { name: named ?? shown(c.value) };
    case "join.v1":
      return input(ctx, node.id, port, depth);
    case "window.v1": {
      const r = input(ctx, node.id, "in", depth);
      return { name: named ?? r.name, unit: c.aggregate === "count" ? undefined : r.unit };
    }
    case "convert.v1":
      return { name: named ?? input(ctx, node.id, "in", depth).name, unit: unitLabel(c.to) };
    case "compare.v1":
      return { name: named ?? summary(ctx, node, depth) };
    case "hysteresis.v1": {
      // As a condition it reads as its activation threshold.
      const r = input(ctx, node.id, "in", depth);
      return { name: named ?? `${r.name ?? "Value"} > ${withUnit(c.activate_above, r.unit)}` };
    }
    default:
      return { name: named ?? nodeAppearance(node.type).label };
  }
}

/**
 * One line for the node card that shows what the node is configured to do.
 * `workflow` lets a node name its upstream reading and unit; `names` (from the
 * host) turns binding UUIDs into device and parameter names.
 */
export function nodeSummary(
  node: WorkflowNode,
  workflow?: Workflow,
  names?: ResourceNames,
): string {
  return summary({ workflow, names }, node, 0);
}
function summary(ctx: Context, node: WorkflowNode, depth: number): string {
  const c = node.config;
  const operator = operators[String(c.operator)] ?? shown(c.operator);
  const from = (port: string, fallback: string) =>
    input(ctx, node.id, port, depth).name ?? fallback;
  switch (node.type) {
    case "source.parameter.v1": {
      const b = bindingFor(ctx, c.binding);
      if (!b) return c.binding ? String(c.binding) : "Choose a device parameter";
      const device = ctx.names?.[b.device_uuid];
      const parameter = ctx.names?.[b.parameter_uuid] ?? roleName(b.role);
      // A node named after its parameter already says which one it reads.
      const title = nodeName(node)?.toLowerCase();
      const fresh = duration(b.fresh_seconds);
      return [
        device,
        parameter?.toLowerCase() !== title && parameter,
        !device && b.unit,
        fresh && `fresh ${fresh}`,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "constant.v1":
      return shown(c.value);
    case "compare.v1": {
      const r = input(ctx, node.id, "in", depth);
      return `${r.name ?? "Value"} ${operator} ${withUnit(c.value, r.unit)}`;
    }
    case "hysteresis.v1": {
      const { unit } = input(ctx, node.id, "in", depth);
      return `On > ${withUnit(c.activate_above, unit)} · off < ${withUnit(c.clear_below, unit)}`;
    }
    case "math.v1":
      return `${from("a", "A")} ${operator} ${from("b", "B")}`;
    case "boolean.v1":
      return `${from("a", "A")} ${String(c.operator).toUpperCase()} ${from("b", "B")}`;
    case "convert.v1":
      return `${unitLabel(c.from) || "?"} → ${unitLabel(c.to) || "?"}`;
    case "window.v1": {
      const samples = Number(c.minimum_samples);
      return [
        `${aggregates[String(c.aggregate)] ?? shown(c.aggregate)} over ${duration(c.duration_seconds) ?? "?"}`,
        samples > 1 && `≥ ${samples} samples`,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "join.v1":
      return `${from("a", "A")} + ${from("b", "B")} · ${c.mode === "window" ? "windows" : "latest"}`;
    case "branch.v1": {
      const condition = input(ctx, node.id, "in", depth).name;
      return condition ? `If ${inline(condition)}` : "Route true or false";
    }
    case "sustained.v1":
      return `True for ${duration(c.seconds) ?? "?"}`;
    case "cooldown.v1":
      return `At most once per ${duration(c.seconds) ?? "?"}`;
    case "geofence.v1": {
      const points = vertices(c.geometry);
      const uncertainty = Number(c.uncertainty_metres);
      return [
        c.condition === "inside" ? "Inside" : "Outside",
        points ? `${points} points` : "No boundary",
        uncertainty > 0 && `±${uncertainty} m`,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "action.alert.v1":
      return String(c.title || "No alert title");
    case "action.event.v1":
      return String(c.name || "No event name");
    case "action.command.v1": {
      const settings = settingsOf(node);
      if (!settings.length) return "Choose device settings";
      const bindings = settings.map(([role]) => bindingFor(ctx, role));
      const device = bindings[0] && ctx.names?.[bindings[0].device_uuid];
      const values = settings.map(([, value], i) => {
        const b = bindings[i];
        const label = b && ctx.names?.[b.parameter_uuid];
        const text =
          typeof value === "boolean" ? (value ? "on" : "off") : withUnit(value, b?.unit || undefined);
        return label ? `${inline(label)} ${text}` : text;
      });
      return [device ?? (settings.length > 1 && `${settings.length} settings`), values.join(", ")]
        .filter(Boolean)
        .join(" · ");
    }
    default:
      return nodeAppearance(node.type).description;
  }
}

type NodeAppearance = {
  label: string;
  category: string;
  tone: string;
  Icon: LucideIcon;
  description: string;
};
const appearances: Record<string, Omit<NodeAppearance, "label">> = {
  "source.parameter.v1": {
    category: "Inputs",
    tone: "info",
    Icon: RadioIcon,
    description: "Read a parameter from an applied device configuration.",
  },
  "constant.v1": {
    category: "Inputs",
    tone: "info",
    Icon: HashIcon,
    description: "Supply a fixed numeric value.",
  },
  "geofence.v1": {
    category: "Conditions",
    tone: "warning",
    Icon: MapPinIcon,
    description: "Check whether a location is inside or outside a geofence.",
  },
  "math.v1": {
    category: "Calculations",
    tone: "commanded",
    Icon: CalculatorIcon,
    description: "Add, subtract, multiply or divide numeric inputs.",
  },
  "convert.v1": {
    category: "Calculations",
    tone: "commanded",
    Icon: ArrowRightLeftIcon,
    description: "Convert a reading between compatible units.",
  },
  "compare.v1": {
    category: "Conditions",
    tone: "warning",
    Icon: GitCompareArrowsIcon,
    description: "Compare a numeric reading against a threshold.",
  },
  "boolean.v1": {
    category: "Conditions",
    tone: "warning",
    Icon: ListFilterIcon,
    description: "Combine two conditions using AND or OR.",
  },
  "branch.v1": {
    category: "Conditions",
    tone: "warning",
    Icon: GitBranchIcon,
    description: "Send a condition to its true or false path.",
  },
  "hysteresis.v1": {
    category: "Conditions",
    tone: "warning",
    Icon: ActivityIcon,
    description: "Use separate thresholds to activate and clear a condition.",
  },
  "window.v1": {
    category: "Timing & correlation",
    tone: "primary",
    Icon: Clock3Icon,
    description: "Aggregate readings over a finalized time window.",
  },
  "join.v1": {
    category: "Timing & correlation",
    tone: "primary",
    Icon: GitMergeIcon,
    description:
      "Match fresh readings or aligned windows from multiple sources.",
  },
  "sustained.v1": {
    category: "Timing & correlation",
    tone: "primary",
    Icon: TimerIcon,
    description: "Require a condition to remain true for a duration.",
  },
  "cooldown.v1": {
    category: "Timing & correlation",
    tone: "primary",
    Icon: HourglassIcon,
    description: "Limit how often a true condition can pass through.",
  },
  "action.alert.v1": {
    category: "Actions",
    tone: "destructive",
    Icon: BellRingIcon,
    description: "Create or clear an alert as the condition changes.",
  },
  "action.event.v1": {
    category: "Actions",
    tone: "success",
    Icon: SendIcon,
    description: "Emit an event through existing integrations.",
  },
  "action.command.v1": {
    category: "Actions",
    tone: "commanded",
    Icon: PowerIcon,
    description:
      "Control a device: turn an alarm or RGB LED on/off, or set a parameter. Requires an activation grant. Fires when the condition becomes true (including the first known true value).",
  },
};
// Bundled labels mirror services/runtime/internal/dag/registry.go so a node
// never falls back to its type ID when the catalog is unavailable.
const labels: Record<string, string> = {
  "source.parameter.v1": "Device parameter",
  "constant.v1": "Constant",
  "geofence.v1": "Geofence",
  "math.v1": "Arithmetic",
  "convert.v1": "Unit conversion",
  "compare.v1": "Compare",
  "boolean.v1": "Boolean logic",
  "branch.v1": "Branch",
  "hysteresis.v1": "Hysteresis",
  "window.v1": "Time window",
  "join.v1": "Correlate inputs",
  "sustained.v1": "Sustained condition",
  "cooldown.v1": "Cooldown",
  "action.alert.v1": "Alert",
  "action.event.v1": "Integration event",
  "action.command.v1": "Set device state",
};
/** "vendor.flow_meter.v2" → "Vendor flow meter". */
export function humanizeType(type: string): string {
  const words = type
    .replace(/\.v\d+$/, "")
    .split(/[._-]+/)
    .filter(Boolean)
    .join(" ");
  return words ? words[0].toUpperCase() + words.slice(1) : "Node";
}
export const nodeAppearance = (type: string): NodeAppearance =>
  appearances[type]
    ? { ...appearances[type], label: labels[type] }
    : {
        label: humanizeType(type),
        category: "Other",
        tone: "primary",
        Icon: ListFilterIcon,
        description: "Configure this node.",
      };
/** Registry label when it is a real label; type IDs are never primary text. */
export const nodeLabel = (type: string, registryLabel?: string): string =>
  registryLabel && registryLabel !== type
    ? registryLabel
    : nodeAppearance(type).label;
/** Author-chosen node IDs act as names; generated `node_…` IDs do not. */
export const nodeName = (node: WorkflowNode): string | undefined => {
  if (node.id.startsWith("node_")) return undefined;
  const name = node.id.replaceAll("_", " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
};
export const paletteCategories = [
  "Inputs",
  "Calculations",
  "Conditions",
  "Timing & correlation",
  "Actions",
  "Other",
];
