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

/** Layout is presentation only: no node, edge, or executable configuration changes. */
export function arrangeNodes(workflow: Workflow) {
  const pending = new Map(workflow.nodes.map((node) => [node.id, 0]));
  const children = new Map<string, string[]>();
  const depths = new Map<string, number>();
  for (const edge of workflow.edges) {
    if (!pending.has(edge.source) || !pending.has(edge.target)) continue;
    pending.set(edge.target, pending.get(edge.target)! + 1);
    children.set(edge.source, [
      ...(children.get(edge.source) ?? []),
      edge.target,
    ]);
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
  const rows = Math.max(
    1,
    ...Array.from(layers.values(), (layer) => layer.length),
  );
  return Object.fromEntries(
    Array.from(layers).flatMap(([depth, ids]) =>
      ids.map((id, index) => [
        id,
        { x: depth * 304, y: ((rows - ids.length) / 2 + index) * 208 },
      ]),
    ),
  );
}

export function nodeSummary(node: WorkflowNode): string {
  const c = node.config;
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
  switch (node.type) {
    case "source.parameter.v1":
      return c.binding
        ? `${c.binding} · live reading`
        : "Choose a device parameter";
    case "window.v1":
      return `${c.duration_seconds}s · ${c.aggregate} · ${c.minimum_samples} sample(s)`;
    case "compare.v1":
      return `Value ${operators[String(c.operator)] ?? c.operator} ${c.value}`;
    case "boolean.v1":
      return String(c.operator).toUpperCase() + " condition";
    case "join.v1":
      return c.mode === "window"
        ? "Match finalized windows"
        : "Match fresh readings";
    case "action.command.v1":
      return c.settings && typeof c.settings === "object"
        ? `${Object.keys(c.settings).length} selected setting(s)`
        : `${c.binding || "Target"} → ${String(c.value ?? "Set value")}`;
    case "action.alert.v1":
      return String(c.title || "Create or clear alert");
    case "action.event.v1":
      return String(c.name || "Publish integration event");
    case "convert.v1":
      return `${c.from} → ${c.to}`;
    case "constant.v1":
      return String(c.value);
    case "cooldown.v1":
    case "sustained.v1":
      return `${c.seconds} seconds`;
    case "math.v1":
      return `A ${operators[String(c.operator)] ?? c.operator} B`;
    case "hysteresis.v1":
      return `Above ${c.activate_above} / below ${c.clear_below}`;
    case "branch.v1":
      return "Route true or false";
    case "geofence.v1":
      return `True when ${c.condition === "inside" ? "inside" : "outside"} the boundary`;
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
export const nodeName = (node: WorkflowNode): string | undefined =>
  node.id.startsWith("node_") ? undefined : node.id.replaceAll("_", " ");
export const paletteCategories = [
  "Inputs",
  "Calculations",
  "Conditions",
  "Timing & correlation",
  "Actions",
  "Other",
];
