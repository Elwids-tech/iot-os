import {
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Background,
  MarkerType,
  Handle,
  Position,
  ReactFlow,
  type NodeProps,
  type Node,
  type Connection,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import { Button } from "@iot-os/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@iot-os/ui/components/dialog";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@iot-os/ui/components/card";
import { Field, FieldGroup, FieldLabel } from "@iot-os/ui/components/field";
import {
  CheckboxField,
  FormSection,
  SelectField,
  TextField,
  TextareaField,
} from "@iot-os/ui/components/form-fields";
import { InlineName } from "@iot-os/ui/components/inline-name";
import { Input } from "@iot-os/ui/components/input";
import { SearchableSelect } from "@iot-os/ui/components/searchable-select";
import { Alert, AlertDescription } from "@iot-os/ui/components/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@iot-os/ui/components/collapsible";
import {
  PlusIcon,
  TrashIcon,
  GitMergeIcon,
  MinusIcon,
  ScanIcon,
  MaximizeIcon,
  MinimizeIcon,
  WorkflowIcon,
  MousePointer2Icon,
  GripVerticalIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CloudOffIcon,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@iot-os/ui/components/tooltip";
import {
  arrangeNodes,
  estimatedSize,
  nodeSummary,
  nodeAppearance,
  nodeLabel,
  nodeName,
  paletteCategories,
  NODE_SIZE,
  type ResourceNames,
} from "./presentation";
import type {
  Workflow,
  Layout,
  NodeType,
  NodeOutcome,
  Diagnostic,
  WorkflowNode,
} from "./types";
import "@xyflow/react/dist/style.css";
import "./workflow-editor.css";
export type * from "./types";
export { duration, nodeLabel, nodeName, nodeSummary } from "./presentation";
export type { ResourceNames } from "./presentation";

type NodeData = {
  label: string;
  /** The author's name for the node, if any; the card falls back to the type label. */
  name?: string;
  category: string;
  node: WorkflowNode;
  definition: NodeType;
  summary: string;
  errors: string[];
  outcome?: NodeOutcome;
  [key: string]: unknown;
};
const fitOptions = { padding: 0.16, minZoom: 0.15, maxZoom: 1 };
const fieldLabel = (key: string) => {
  const text = key.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};
// Outcomes that pass usable evidence downstream; their outgoing edges animate.
const flowing = new Set(["matched", "triggered", "evaluated"]);

/** A side with one port gets an unlabelled handle on the card edge; several ports get labelled rows. */
const GraphNode = memo(function GraphNode({
  data,
  selected,
}: NodeProps<Node<NodeData>>) {
  const inputs = Object.keys(data.definition.inputs ?? {});
  const outputs = Object.keys(data.definition.outputs ?? {});
  const rowInputs = inputs.length > 1 ? inputs : [];
  const rowOutputs = outputs.length > 1 ? outputs : [];
  const { Icon, tone } = nodeAppearance(data.node.type);
  const name = data.name;
  const issues = data.errors.length;
  return (
    <article
      className="workflow-node"
      style={{ "--node-accent": `var(--${tone})` } as CSSProperties}
      data-selected={selected}
      data-invalid={issues > 0}
      data-outcome={data.outcome?.status}
    >
      <div className="workflow-node-heading">
        <Icon className="workflow-node-icon" aria-hidden="true" />
        <p className="workflow-node-title text-heading" title={name ? `${name} · ${data.label}` : data.label}>
          {name ?? data.label}
          {name && <span className="sr-only"> ({data.label})</span>}
        </p>
        {issues > 0 && (
          <span
            className="workflow-node-issues text-micro"
            role="img"
            aria-label={`${issues} issue${issues === 1 ? "" : "s"}`}
            title={data.errors.join("\n")}
          >
            <CircleAlertIcon aria-hidden="true" />
            {issues}
          </span>
        )}
      </div>
      <p className="workflow-node-summary text-meta" title={data.summary}>
        {data.summary}
      </p>
      {data.outcome && (
        <p className="workflow-node-outcome text-meta" title={data.outcome.reason}>
          <span aria-hidden="true" />
          <strong>{data.outcome.label}</strong>
          {data.outcome.reason && <span className="sr-only"> · {data.outcome.reason}</span>}
        </p>
      )}
      {(rowInputs.length > 0 || rowOutputs.length > 0) && (
        <div className="workflow-node-ports text-micro">
          {Array.from(
            { length: Math.max(rowInputs.length, rowOutputs.length) },
            (_, i) => (
              <div className="workflow-port-row" key={i}>
                <span>
                  {rowInputs[i] && (
                    <>
                      <Handle
                        type="target"
                        id={rowInputs[i]}
                        position={Position.Left}
                        aria-label={`Input ${rowInputs[i]}`}
                      />
                      {rowInputs[i]}
                    </>
                  )}
                </span>
                <span>
                  {rowOutputs[i] && (
                    <>
                      {rowOutputs[i]}
                      <Handle
                        type="source"
                        id={rowOutputs[i]}
                        position={Position.Right}
                        aria-label={`Output ${rowOutputs[i]}`}
                      />
                    </>
                  )}
                </span>
              </div>
            ),
          )}
        </div>
      )}
      {inputs.length === 1 && (
        <Handle
          type="target"
          id={inputs[0]}
          position={Position.Left}
          aria-label={`Input ${inputs[0]}`}
        />
      )}
      {outputs.length === 1 && (
        <Handle
          type="source"
          id={outputs[0]}
          position={Position.Right}
          aria-label={`Output ${outputs[0]}`}
        />
      )}
    </article>
  );
});

function CanvasButton({
  label,
  onClick,
  children,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
const nodeTypes = { automation: GraphNode };
type Choice = { value: string; label: string };
// Short, static option lists use a plain select; longer ones get search (shadcn: 2–7 options).
const SELECT_LIMIT = 7;

/** Without the catalog, keep existing connections drawable from the graph's own edges. */
function edgeDefinition(node: WorkflowNode, workflow: Workflow): NodeType {
  const ports = (side: "source" | "target") =>
    Object.fromEntries(
      workflow.edges
        .filter((e) => e[side] === node.id)
        .map((e) => [side === "target" ? e.target_port : e.source_port, "any"]),
    );
  return {
    type: node.type,
    label: nodeLabel(node.type),
    inputs: ports("target"),
    outputs: ports("source"),
    config_schema: {},
    stateful: false,
    permissions: null,
    simulation: false,
  };
}

/** Host owns persistence, permissions, resources and deployment. No portal imports. */
export function WorkflowEditor({
  workflow,
  layout,
  registry,
  diagnostics,
  onChange,
  onLayoutChange,
  renderBinding,
  renderConfig,
  catalog,
  panel,
  outcomes,
  resourceNames,
  onSelectionChange,
  palette = true,
}: {
  workflow: Workflow;
  layout: Layout;
  registry: NodeType[];
  diagnostics: Diagnostic[];
  onChange: (workflow: Workflow) => void;
  onLayoutChange: (layout: Layout) => void;
  renderBinding: (
    node: WorkflowNode,
    update: (node: WorkflowNode) => void,
  ) => ReactNode;
  renderConfig?: (node: WorkflowNode, key: string, update: (node: WorkflowNode) => void) => ReactNode;
  /** Node catalog request state: `error` when it failed, `stale` when served from cache. */
  catalog?: { error?: boolean; stale?: boolean; cachedAt?: string };
  /** Host panel docked beside the canvas in place of the node inspector (e.g. simulation). */
  panel?: { label: string; description?: ReactNode; content: ReactNode };
  /** Per-node results to highlight on the canvas, keyed by node ID. */
  outcomes?: Record<string, NodeOutcome>;
  /** Device and parameter names by UUID, so node summaries can name what bindings point at. */
  resourceNames?: ResourceNames;
  onSelectionChange?: (nodeId: string) => void;
  /** Show the node palette; hosts may hide it in read-mostly modes such as simulation. */
  palette?: boolean;
}) {
  const [selected, setSelected] = useState("");
  const canvasRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const nodeNameRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const [dragging, setDragging] = useState(false);
  const [paletteSearch, setPaletteSearch] = useState("");
  const hostPanel = Boolean(panel);
  const [panelOpen, setPanelOpen] = useState(hostPanel);
  const [flow, setFlow] = useState<ReactFlowInstance<Node<NodeData>> | null>(
    null,
  );
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(false);
  // Fit once per mounted workflow. Until the user pans or zooms, the viewport is
  // still ours and follows canvas size changes; afterwards it is the user's.
  const fitted = useRef(false);
  const userViewport = useRef(false);
  // Expanding the editor remounts React Flow; restore the live viewport, not a saved one.
  const viewport = useRef<Viewport | undefined>(undefined);
  // Width the docked panel covers when it overlays the canvas (narrow editors).
  const covered = () => {
    const canvas = canvasRef.current?.getBoundingClientRect();
    const aside = panelRef.current;
    if (!canvas || !aside || getComputedStyle(aside).position !== "absolute") return 0;
    return Math.max(0, canvas.right - aside.getBoundingClientRect().left);
  };
  const fitCanvas = (duration?: number) => {
    const right = covered();
    void flow?.fitView({
      ...fitOptions,
      duration,
      ...(right ? { padding: { x: fitOptions.padding, y: fitOptions.padding, right: `${right + 24}px` as const } } : {}),
    });
  };
  /** Bring a hidden node into view at the current zoom. */
  const reveal = (id: string) => {
    const canvas = canvasRef.current?.getBoundingClientRect();
    const element = canvasRef.current?.querySelector(
      `.react-flow__node[data-id="${CSS.escape(id)}"]`,
    );
    const internal = flow?.getInternalNode(id);
    if (!flow || !canvas || !element || !internal) return;
    const right = canvas.right - covered();
    const box = element.getBoundingClientRect();
    if (box.left >= canvas.left && box.right <= right && box.top >= canvas.top && box.bottom <= canvas.bottom) return;
    const { zoom } = flow.getViewport();
    const { x, y } = internal.internals.positionAbsolute;
    void flow.setViewport(
      {
        x: (right - canvas.left) / 2 - (x + (internal.measured.width ?? 0) / 2) * zoom,
        y: canvas.height / 2 - (y + (internal.measured.height ?? 0) / 2) * zoom,
        zoom,
      },
      { duration: 200 },
    );
  };
  useEffect(() => {
    if (!flow || fitted.current || !workflow.nodes.length) return;
    fitted.current = true;
    fitCanvas();
  }, [flow, workflow.nodes.length]);
  // A host panel opens with its mode; leaving it keeps the inspector only for a selection.
  useEffect(() => {
    setPanelOpen(hostPanel || Boolean(selected));
  }, [hostPanel]);
  // The canvas width changes when the panel docks or the palette hides.
  const canvasLayout = `${panelOpen}:${palette}`;
  const layoutWas = useRef(canvasLayout);
  useEffect(() => {
    if (layoutWas.current === canvasLayout) return;
    layoutWas.current = canvasLayout;
    if (!flow || !fitted.current) return;
    // Wait for the grid and React Flow's resize observer to settle.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (!userViewport.current) fitCanvas(150);
        else if (selected) reveal(selected);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [canvasLayout]);
  useEffect(() => {
    if (panelOpen && window.matchMedia?.("(max-width: 767px)").matches)
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [panelOpen, selected]);
  const select = (id: string) => {
    setSelected(id);
    onSelectionChange?.(id);
  };
  /** Clicking empty canvas or pressing Escape ends editing, as in Node-RED: one node at a time, chosen on the canvas. */
  const deselect = () => {
    select("");
    if (!panel) setPanelOpen(false);
  };
  const rename = (id: string, name: string) => {
    const labels = { ...layout.labels };
    if (name.trim()) labels[id] = name;
    else delete labels[id];
    onLayoutChange({ ...layout, labels });
  };
  const lookup = useMemo(
    () => new Map(registry.map((r) => [r.type, r])),
    [registry],
  );
  // Before React Flow measures the cards, size them from their port rows.
  const defaultPositions = useMemo(() => {
    const sizes = new Map(
      workflow.nodes.map((n) => {
        const definition = lookup.get(n.type) ?? edgeDefinition(n, workflow);
        return [
          n.id,
          estimatedSize(
            Object.keys(definition.inputs ?? {}).length,
            Object.keys(definition.outputs ?? {}).length,
          ),
        ];
      }),
    );
    return arrangeNodes(workflow, (id) => sizes.get(id) ?? NODE_SIZE);
  }, [workflow.nodes, workflow.edges, lookup]);
  const fit = () => {
    userViewport.current = false;
    fitCanvas(200);
  };
  const userZoom = (change: () => void) => () => {
    userViewport.current = true;
    change();
  };
  const arrange = () => {
    const measured = (id: string) => flow?.getInternalNode(id)?.measured;
    onLayoutChange({
      ...layout,
      positions: arrangeNodes(workflow, (id) => {
        const size = measured(id);
        return size?.width && size.height
          ? { width: size.width, height: size.height }
          : NODE_SIZE;
      }),
    });
    requestAnimationFrame(() => requestAnimationFrame(fit));
  };
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  // The shared SearchableSelect leaves filtering to the host: one search string per picker.
  const [searches, setSearches] = useState<Record<string, string>>({});
  const searchProps = (picker: string) => ({
    search: searches[picker] ?? "",
    onSearchChange: (text: string) =>
      setSearches((current) => ({ ...current, [picker]: text })),
  });
  const matching = (picker: string, choices: Choice[]) => {
    const query = (searches[picker] ?? "").toLowerCase();
    return choices.filter((c) => c.label.toLowerCase().includes(query));
  };
  const labelOf = (n: WorkflowNode) => nodeLabel(n.type, lookup.get(n.type)?.label);
  const nodes = useMemo(
    () =>
      workflow.nodes.map((node) => ({
        id: node.id,
        type: "automation",
        position: layout.positions[node.id] ?? defaultPositions[node.id],
        data: {
          label: nodeLabel(node.type, lookup.get(node.type)?.label),
          name: nodeName(node, layout.labels),
          category: nodeAppearance(node.type).category,
          node,
          definition: lookup.get(node.type) ?? edgeDefinition(node, workflow),
          summary: nodeSummary(node, workflow, resourceNames, layout.labels),
          errors: diagnostics
            .filter((d) => d.node_id === node.id)
            .map((d) => d.message),
          outcome: outcomes?.[node.id],
        },
        selected: selected === node.id,
      })),
    [
      workflow.nodes,
      workflow.edges,
      workflow.bindings,
      layout.positions,
      layout.labels,
      defaultPositions,
      lookup,
      diagnostics,
      outcomes,
      resourceNames,
      selected,
    ],
  );
  const edges = useMemo(
    () =>
      workflow.edges.map((e, i) => {
        const connected = selected === e.source || selected === e.target;
        const active = flowing.has(outcomes?.[e.source]?.status ?? "");
        return {
          id: String(i),
          source: e.source,
          target: e.target,
          sourceHandle: e.source_port,
          targetHandle: e.target_port,
          type: "smoothstep",
          animated: active,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 18,
            height: 18,
            color: connected
              ? "var(--primary)"
              : active
                ? "var(--success)"
                : "var(--muted-foreground)",
          },
          className:
            [connected && "workflow-edge-connected", active && "workflow-edge-active"]
              .filter(Boolean)
              .join(" ") || undefined,
          interactionWidth: 24,
        };
      }),
    [workflow.edges, selected, outcomes],
  );
  const node = workflow.nodes.find((n) => n.id === selected);
  const definition = node && lookup.get(node.type);
  const focusSelection = () =>
    requestAnimationFrame(() =>
      (
        canvasRef.current?.querySelector<HTMLElement>(
          `.react-flow__node[data-id="${CSS.escape(selected)}"]`,
        ) ?? canvasRef.current
      )?.focus(),
    );
  const openPanel = () => {
    if (!panel && !selected && workflow.nodes.length) select(workflow.nodes[0].id);
    setPanelOpen(true);
    requestAnimationFrame(() => (nodeNameRef.current ?? panelHeadingRef.current)?.focus());
  };
  const closePanel = () => {
    setPanelOpen(false);
    focusSelection();
  };
  const deleteSelectedNode = () => {
    if (!node) return;
    onChange({
      ...workflow,
      nodes: workflow.nodes.filter((n) => n.id !== node.id),
      edges: workflow.edges.filter(
        (e) => e.source !== node.id && e.target !== node.id,
      ),
    });
    if (layout.labels?.[node.id] !== undefined) rename(node.id, "");
    select("");
    if (!panel) setPanelOpen(false);
    requestAnimationFrame(() => canvasRef.current?.focus());
  };
  // Delete acts on the canvas only, never on a focused field or control in a panel.
  const handleDeleteKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.key !== "Delete" ||
      event.defaultPrevented ||
      event.repeat ||
      event.nativeEvent.isComposing ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      !(event.target instanceof HTMLElement) ||
      !canvasRef.current?.contains(event.target) ||
      event.target.isContentEditable ||
      event.target.closest(
        'input, textarea, select, [role="textbox"], [role="listbox"], [role="option"], [role="menu"], [role="slider"], [role="spinbutton"]',
      )
    ) return;
    if (!node) return;
    event.preventDefault();
    event.stopPropagation();
    deleteSelectedNode();
  };
  // Escape closes the node's settings and returns focus to the node, unless a menu or list inside them is open.
  const handleEscapeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      panel ||
      expanded ||
      !selected ||
      !(event.target instanceof HTMLElement) ||
      // Popovers render in portals, outside both regions.
      !(canvasRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) ||
      event.target.closest('[aria-expanded="true"]')
    ) return;
    event.preventDefault();
    const id = selected;
    deselect();
    requestAnimationFrame(() =>
      canvasRef.current
        ?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)
        ?.focus(),
    );
  };
  const update = (next: WorkflowNode) =>
    onChange({
      ...workflow,
      nodes: workflow.nodes.map((n) => (n.id === next.id ? next : n)),
    });
  const connect = (c: Connection) => {
    if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return;
    onChange({
      ...workflow,
      edges: [
        ...workflow.edges.filter(
          (e) => e.target !== c.target || e.target_port !== c.targetHandle,
        ),
        {
          source: c.source,
          source_port: c.sourceHandle,
          target: c.target,
          target_port: c.targetHandle,
        },
      ],
    });
  };
  const add = (typeId: string, screenPosition?: { x: number; y: number }) => {
    const type = lookup.get(typeId);
    if (!type || workflow.nodes.length >= 100) return;
    // Placing a node is the user's viewport decision; never auto-fit after it.
    fitted.current = true;
    const id = `node_${crypto.randomUUID().slice(0, 8)}`;
    const config: Record<string, unknown> = Object.fromEntries(
      Object.entries(type.config_schema).map(([key, f]) => [
        key,
        f.enum?.[0] ?? (f.type === "number" ? (f.minimum ?? 0) : ""),
      ]),
    );
    if (type.type === "action.command.v1") {
      delete config.binding;
      delete config.value;
      config.settings = {};
    }
    onChange({
      ...workflow,
      nodes: [...workflow.nodes, { id, type: type.type, config }],
    });
    const positions = Object.fromEntries(nodes.map((n) => [n.id, n.position]));
    const place = () => {
      const bounds = canvasRef.current?.getBoundingClientRect();
      const point =
        screenPosition ??
        (bounds
          ? {
              x: bounds.left + bounds.width / 2,
              y: bounds.top + bounds.height / 2,
            }
          : { x: NODE_SIZE.width / 2, y: NODE_SIZE.height / 2 });
      const center = flow?.screenToFlowPosition(point) ?? point;
      onLayoutChange({
        ...layout,
        positions: {
          ...positions,
          [id]: {
            x: center.x - NODE_SIZE.width / 2,
            y: center.y - NODE_SIZE.height / 2,
          },
        },
      });
    };
    // Re-measure after the empty-state prompt disappears to keep the node at
    // the same screen position even when the canvas moves within the page.
    place();
    requestAnimationFrame(place);
    select(id);
    if (!screenPosition) setPanelOpen(true);
  };
  const unavailable = Boolean(catalog?.error) && !registry.length;
  const paletteNodes = registry.filter((type) =>
    `${type.label} ${type.type} ${nodeAppearance(type.type).category} ${nodeAppearance(type.type).description}`
      .toLowerCase()
      .includes(paletteSearch.toLowerCase()),
  );
  const nodeChoices = workflow.nodes.map((n) => ({
    value: n.id,
    label: nodeName(n, layout.labels) ?? `${labelOf(n)} · ${n.id}`,
  }));
  const choiceLabel = new Map(nodeChoices.map((c) => [c.value, c.label]));
  const ports = (direction: "inputs" | "outputs") =>
    workflow.nodes.flatMap((n) =>
      Object.keys(lookup.get(n.type)?.[direction] ?? {}).map((port) => ({
        value: `${n.id}:${port}`,
        label: `${choiceLabel.get(n.id)} · ${port}`,
      })),
    );
  const nodeTitle = node && (nodeName(node, layout.labels) ?? labelOf(node));
  // Classify each config field once so diagnostics can attach to the controls
  // that take an `error`; the rest stay in the alert list below the fields.
  const configFields =
    node && definition
      ? Object.entries(definition.config_schema)
          .filter(([key]) => key !== "binding")
          .map(([key, f]) => {
            const custom = renderConfig?.(node, key, update);
            const bound =
              f.type === "scalar"
                ? workflow.bindings.find((b) => b.role === node.config.binding)
                    ?.data_type
                : undefined;
            const control: "custom" | "object" | "toggle" | "select" | "search" | "text" =
              custom != null
                ? "custom"
                : f.type === "object"
                  ? "object"
                  : bound === "boolean"
                    ? "toggle"
                    : f.enum
                      ? f.enum.length <= SELECT_LIMIT
                        ? "select"
                        : "search"
                      : "text";
            return { key, f, custom, control, bound };
          })
      : [];
  const nodeDiagnostics = node
    ? diagnostics.filter((d) => d.node_id === node.id)
    : [];
  // The compiler names config fields `config.<key>`.
  const inlineKeys = new Set(
    configFields
      .filter((c) => c.control === "object" || c.control === "select" || c.control === "text")
      .map((c) => `config.${c.key}`),
  );
  const fieldError = (key: string) => {
    const messages = nodeDiagnostics
      .filter((d) => d.field === `config.${key}`)
      .map((d) => d.message);
    return messages.length ? messages.join(" ") : undefined;
  };
  const inspector = (
    <FieldGroup>
      {node && !definition && (
        <Alert>
          <AlertDescription>
            Settings for this node need the node catalog, which is unavailable
            right now. The node and its connections are unchanged.
          </AlertDescription>
        </Alert>
      )}
      {node && definition && (
        <>
          {(node.type === "source.parameter.v1" ||
            node.type === "action.command.v1") &&
            renderBinding(node, update)}
          {configFields.map(({ key, f, custom, control, bound }) => {
            if (control === "custom") return custom;
            const id = `config-${node.id}-${key}`;
            const value = String(node.config[key] ?? "");
            const optional = !f.required;
            const error = fieldError(key);
            const set = (next: unknown) =>
              update({ ...node, config: { ...node.config, [key]: next } });
            if (control === "object")
              return (
                <ObjectField
                  key={node.id + key}
                  id={id}
                  label={key}
                  value={node.config[key]}
                  optional={optional}
                  error={error}
                  onChange={set}
                />
              );
            if (control === "toggle")
              return (
                <CheckboxField
                  key={key}
                  id={id}
                  label="Target state"
                  description="On (true) when checked, off (false) when clear."
                  checked={node.config[key] === true}
                  onCheckedChange={set}
                />
              );
            if (control === "select" || control === "search") {
              const choices = (f.enum ?? []).map((v) => ({ value: v, label: v }));
              return control === "select" ? (
                <SelectField
                  key={key}
                  id={id}
                  label={fieldLabel(key)}
                  value={value}
                  options={choices}
                  optional={optional}
                  error={error}
                  onChange={set}
                />
              ) : (
                <SearchableSelect
                  key={key}
                  label={fieldLabel(key)}
                  value={value}
                  options={matching(id, choices)}
                  {...searchProps(id)}
                  optional={optional}
                  onChange={set}
                />
              );
            }
            return (
              <TextField
                key={key}
                id={id}
                label={fieldLabel(key)}
                type={f.type === "number" ? "number" : "text"}
                min={f.minimum}
                max={f.maximum}
                value={value}
                optional={optional}
                error={error}
                onChange={(e) => {
                  let next: unknown = e.target.value;
                  if (f.type === "number")
                    next = e.target.value === "" ? "" : Number(e.target.value);
                  if (f.type === "scalar" && bound === "number")
                    next = Number(e.target.value);
                  set(next);
                }}
              />
            );
          })}
        </>
      )}
      {nodeDiagnostics
        .filter((d) => !inlineKeys.has(d.field))
        .map((d, i) => (
          <Alert key={i} variant="destructive">
            <AlertDescription>
              {d.field}: {d.message}
            </AlertDescription>
          </Alert>
        ))}
      {node && <TechnicalDetails node={node} definition={definition} />}
      {node && (
        <Button variant="outline" onClick={deleteSelectedNode}>
          <TrashIcon data-icon="inline-start" />
          Delete node
        </Button>
      )}
    </FieldGroup>
  );
  const panelTitle = panel?.label ?? nodeTitle ?? "Node settings";
  const panelDescription = panel
    ? panel.description
    : node
      ? `${labelOf(node)}. ${nodeAppearance(node.type).description} Changes stay in your draft.`
      : "Select a node on the canvas to configure it. Changes stay in your draft.";
  const editor = (
    <div
      data-expanded={expanded}
      className="workflow-editor flex min-w-0 flex-col gap-4"
      onKeyDown={(event) => {
        handleEscapeKey(event);
        handleDeleteKey(event);
      }}
    >
      <div className="workflow-workspace" data-panel={panelOpen} data-palette={palette}>
        <Card size="sm" className="workflow-palette" hidden={!palette}>
          <CardHeader>
            <CardTitle>Nodes</CardTitle>
            <CardDescription>Drag onto the canvas</CardDescription>
            {catalog?.stale && registry.length > 0 && (
              <p
                className="text-xs text-muted-foreground"
                title={
                  catalog.cachedAt
                    ? `Cached ${new Date(catalog.cachedAt).toLocaleString()}`
                    : undefined
                }
              >
                Using cached node catalog
              </p>
            )}
            <Field className="mt-2">
              <FieldLabel className="sr-only" htmlFor="node-palette-search">
                Search nodes
              </FieldLabel>
              <Input
                id="node-palette-search"
                placeholder="Search nodes…"
                value={paletteSearch}
                disabled={unavailable}
                onChange={(event) => setPaletteSearch(event.target.value)}
              />
            </Field>
          </CardHeader>
          <CardContent className="workflow-palette-list">
            {unavailable ? (
              <div role="status" className="workflow-palette-unavailable">
                <CloudOffIcon aria-hidden="true" className="size-4 shrink-0" />
                <p>
                  The node catalog is unavailable right now — existing nodes
                  can still be viewed; adding nodes needs the device runtime.
                </p>
              </div>
            ) : (
              paletteCategories.map((category) => {
                const choices = paletteNodes.filter(
                  (type) => nodeAppearance(type.type).category === category,
                );
                if (!choices.length) return null;
                return (
                  <FormSection key={category} title={category} className="gap-2">
                    {choices.map((type) => {
                      const { Icon, tone, description } = nodeAppearance(
                        type.type,
                      );
                      return (
                        <Tooltip key={type.type}>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              className="workflow-palette-node"
                              style={
                                {
                                  "--node-accent": `var(--${tone})`,
                                } as CSSProperties
                              }
                              disabled={workflow.nodes.length >= 100}
                              draggable={workflow.nodes.length < 100}
                              onDragStart={(event) => {
                                event.dataTransfer.setData(
                                  "application/x-iot-workflow-node",
                                  type.type,
                                );
                                event.dataTransfer.effectAllowed = "copy";
                                setDragging(true);
                              }}
                              onDragEnd={() => setDragging(false)}
                              onClick={() => add(type.type)}
                            >
                              <Icon data-icon="inline-start" />
                              <span className="min-w-0 flex-1 whitespace-normal">
                                {nodeLabel(type.type, type.label)}
                              </span>
                              <GripVerticalIcon data-icon="inline-end" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            {description} Drag to position or select to add.
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </FormSection>
                );
              })
            )}
            {!unavailable && !paletteNodes.length && (
              <p className="text-sm text-muted-foreground">
                {paletteSearch ? "No matching nodes." : "No nodes are available."}
              </p>
            )}
          </CardContent>
        </Card>
        <section className="workflow-canvas-shell" aria-label="Workflow canvas">
          <div className="workflow-canvas-toolbar">
            <div className="flex items-center gap-2 text-sm">
              <WorkflowIcon className="size-4" aria-hidden="true" />
              <span className="font-medium">Flow canvas</span>
              <span className="text-muted-foreground">
                {workflow.nodes.length} nodes · {workflow.edges.length}{" "}
                connections
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <CanvasButton
                label="Zoom out"
                onClick={userZoom(() => void flow?.zoomOut({ duration: 150 }))}
              >
                <MinusIcon />
              </CanvasButton>
              <Button
                variant="outline"
                size="sm"
                aria-label="Reset zoom to 100%"
                onClick={userZoom(() => void flow?.zoomTo(1, { duration: 150 }))}
              >
                {Math.round(zoom * 100)}%
              </Button>
              <CanvasButton
                label="Zoom in"
                onClick={userZoom(() => void flow?.zoomIn({ duration: 150 }))}
              >
                <PlusIcon />
              </CanvasButton>
              <Button
                variant="outline"
                size="sm"
                disabled={!workflow.nodes.length}
                onClick={fit}
              >
                <ScanIcon data-icon="inline-start" />
                Fit view
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!workflow.nodes.length}
                onClick={arrange}
              >
                <GitMergeIcon data-icon="inline-start" />
                Arrange
              </Button>
              <Button
                variant={panelOpen ? "secondary" : "outline"}
                size="sm"
                disabled={!panel && !workflow.nodes.length}
                aria-expanded={panelOpen}
                aria-controls={panelOpen ? panelId : undefined}
                onClick={() => (panelOpen ? closePanel() : openPanel())}
              >
                {panelOpen ? (
                  <PanelRightCloseIcon data-icon="inline-start" />
                ) : (
                  <PanelRightOpenIcon data-icon="inline-start" />
                )}
                {panel?.label ?? "Node settings"}
              </Button>
              <CanvasButton
                label={expanded ? "Exit expanded editor" : "Expand editor"}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? <MinimizeIcon /> : <MaximizeIcon />}
              </CanvasButton>
            </div>
          </div>
          <div
            ref={canvasRef}
            tabIndex={-1}
            aria-label="Workflow canvas"
            className="workflow-canvas"
            data-dragging={dragging}
            onDragOver={(event) => {
              if (
                event.dataTransfer.types.includes(
                  "application/x-iot-workflow-node",
                )
              ) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                setDragging(true);
              }
            }}
            onDrop={(event) => {
              const type = event.dataTransfer.getData(
                "application/x-iot-workflow-node",
              );
              if (!lookup.has(type) || !flow) return;
              event.preventDefault();
              setDragging(false);
              add(type, { x: event.clientX, y: event.clientY });
            }}
          >
            {dragging && (
              <div className="workflow-drop-hint" role="status">
                Drop to add node
              </div>
            )}
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onInit={setFlow}
              onMove={(_, next) => {
                viewport.current = next;
                setZoom(next.zoom);
              }}
              defaultViewport={viewport.current}
              onMoveStart={(event) => {
                // Programmatic fits and reveals have no source event.
                if (event) userViewport.current = true;
              }}
              onPaneClick={deselect}
              connectionLineStyle={{
                stroke: "var(--primary)",
                strokeWidth: 3,
              }}
              nodeTypes={nodeTypes}
              onNodeClick={(_, n) => {
                select(n.id);
                setPanelOpen(true);
              }}
              onConnect={connect}
              onNodesChange={(changes) => {
                const positions = { ...layout.positions };
                let moved = false;
                let next = selected;
                for (const c of changes) {
                  if (c.type === "position" && c.position) {
                    positions[c.id] = c.position;
                    moved = true;
                  }
                  // Keyboard selection (Enter/Space on a focused node) arrives here.
                  if (c.type === "select") {
                    if (c.selected) next = c.id;
                    else if (c.id === next) next = "";
                  }
                }
                if (moved) onLayoutChange({ ...layout, positions });
                if (next !== selected) {
                  select(next);
                  if (next) setPanelOpen(true);
                }
              }}
              onNodeDragStop={(_, n) =>
                onLayoutChange({
                  ...layout,
                  positions: { ...layout.positions, [n.id]: n.position },
                })
              }
              onEdgesDelete={(deleted) =>
                onChange({
                  ...workflow,
                  edges: workflow.edges.filter(
                    (_, i) => !deleted.some((e) => e.id === String(i)),
                  ),
                })
              }
              deleteKeyCode={null}
              minZoom={0.1}
              maxZoom={4}
            >
              <Background gap={24} size={1.2} color="var(--workflow-grid)" />
            </ReactFlow>
          </div>
          <div className="workflow-canvas-footer">
            <MousePointer2Icon
              className="size-3.5 shrink-0"
              aria-hidden="true"
            />
            <span>
              Drag the canvas to pan · Scroll to zoom · Select a node to
              configure · Delete removes the selected node while the canvas
              has focus
            </span>
            <span className="ml-auto hidden sm:inline">Left → right</span>
          </div>
        </section>
        {panelOpen && (
          <aside
            ref={panelRef}
            id={panelId}
            className="workflow-panel"
            aria-labelledby={`${panelId}-title`}
          >
            <div className="workflow-panel-header">
              <div className="min-w-0 flex-1">
                {!panel && node ? (
                  <>
                    {/* The node's name is its panel title: type to rename it, like a Node-RED node's name. */}
                    <h2 id={`${panelId}-title`} className="sr-only">
                      {panelTitle}
                    </h2>
                    <InlineName
                      ref={nodeNameRef}
                      key={node.id}
                      label="Node name"
                      className="h-7 max-w-none min-w-0 text-heading"
                      value={layout.labels?.[node.id] ?? ""}
                      placeholder={nodeName(node) ?? labelOf(node)}
                      maxLength={80}
                      onChange={(event) => rename(node.id, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                  </>
                ) : (
                  <h2
                    ref={panelHeadingRef}
                    id={`${panelId}-title`}
                    tabIndex={-1}
                    className="truncate text-sm font-medium outline-none first-letter:uppercase"
                  >
                    {panelTitle}
                  </h2>
                )}
                {panelDescription && (
                  <p className="text-xs text-muted-foreground">
                    {panelDescription}
                  </p>
                )}
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Collapse ${panel?.label ?? "node settings"}`}
                    onClick={closePanel}
                  >
                    <PanelRightCloseIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Collapse panel</TooltipContent>
              </Tooltip>
            </div>
            <div className="workflow-panel-body">
              {panel ? panel.content : inspector}
            </div>
          </aside>
        )}
      </div>
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Connections · keyboard editing
        </summary>
        <Card className="mt-3">
          <CardHeader>
            <CardTitle>Connections</CardTitle>
            <CardDescription>
              Connect ports here or on the canvas.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid gap-3 md:grid-cols-2">
              <SearchableSelect
                label="Output port"
                value={source}
                options={matching("source", ports("outputs"))}
                {...searchProps("source")}
                onChange={setSource}
              />
              <SearchableSelect
                label="Input port"
                value={target}
                options={matching("target", ports("inputs"))}
                {...searchProps("target")}
                onChange={setTarget}
              />
            </div>
            <Button
              variant="outline"
              disabled={!source || !target}
              onClick={() => {
                const [s, sp] = source.split(":");
                const [t, tp] = target.split(":");
                connect({
                  source: s,
                  sourceHandle: sp,
                  target: t,
                  targetHandle: tp,
                });
              }}
            >
              Connect ports
            </Button>
            {workflow.edges.map((edge, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span>
                  {choiceLabel.get(edge.source) ?? edge.source}.{edge.source_port} →{" "}
                  {choiceLabel.get(edge.target) ?? edge.target}.{edge.target_port}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove connection ${i + 1}`}
                  onClick={() =>
                    onChange({
                      ...workflow,
                      edges: workflow.edges.filter((_, j) => i !== j),
                    })
                  }
                >
                  <TrashIcon />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </details>
    </div>
  );
  return (
    <Dialog open={expanded} onOpenChange={setExpanded}>
      {expanded ? (
        <DialogContent className="inset-0 left-0 top-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col overflow-auto rounded-none p-4 sm:max-w-none">
          <DialogHeader>
            <DialogTitle>Flow editor</DialogTitle>
            <DialogDescription>
              Drag nodes from the palette. Changes stay in your draft.
            </DialogDescription>
          </DialogHeader>
          {editor}
        </DialogContent>
      ) : (
        editor
      )}
    </Dialog>
  );
}

function TechnicalDetails({
  node,
  definition,
}: {
  node: WorkflowNode;
  definition?: NodeType;
}) {
  const ports = (values?: Record<string, string> | null) =>
    Object.entries(values ?? {})
      .map(([port, type]) => `${port} (${type})`)
      .join(", ") || "None";
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="group/technical w-fit px-1.5 text-muted-foreground"
        >
          <ChevronRightIcon
            data-icon="inline-start"
            className="transition-transform group-data-[state=open]/technical:rotate-90"
          />
          Technical details
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-1.5 pt-1 text-xs">
          <dt className="text-muted-foreground">Node type</dt>
          <dd>
            <Tooltip>
              <TooltipTrigger asChild>
                <code tabIndex={0} className="break-all">
                  {node.type}
                </code>
              </TooltipTrigger>
              <TooltipContent>
                Identifier used by the runtime, API and assistant. It stays the
                same when display labels change.
              </TooltipContent>
            </Tooltip>
          </dd>
          <dt className="text-muted-foreground">Node ID</dt>
          <dd>
            <code className="break-all">{node.id}</code>
          </dd>
          {definition && (
            <>
              <dt className="text-muted-foreground">Inputs</dt>
              <dd>{ports(definition.inputs)}</dd>
              <dt className="text-muted-foreground">Outputs</dt>
              <dd>{ports(definition.outputs)}</dd>
              <dt className="text-muted-foreground">State</dt>
              <dd>
                {definition.stateful
                  ? "Keeps state between evaluations"
                  : "Stateless"}
              </dd>
            </>
          )}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ObjectField({
  id,
  label,
  value,
  optional,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: unknown;
  optional?: boolean;
  error?: string;
  onChange: (value: unknown) => void;
}) {
  // A string value is text that did not parse as a JSON object.
  const invalid = typeof value === "string";
  const text = invalid ? value : JSON.stringify(value ?? {}, null, 2);
  return (
    <TextareaField
      id={id}
      label={`${fieldLabel(label)} (GeoJSON)`}
      optional={optional}
      error={invalid ? "Enter a valid JSON object." : error}
      value={text}
      onChange={(e) => {
        try {
          const parsed: unknown = JSON.parse(e.target.value);
          onChange(
            parsed && typeof parsed === "object" && !Array.isArray(parsed)
              ? parsed
              : e.target.value,
          );
        } catch {
          onChange(e.target.value);
        }
      }}
    />
  );
}
