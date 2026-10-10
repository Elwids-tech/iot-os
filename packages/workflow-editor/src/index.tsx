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
import { Input } from "@iot-os/ui/components/input";
import { Textarea } from "@iot-os/ui/components/textarea";
import { Badge } from "@iot-os/ui/components/badge";
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
  CloudOffIcon,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@iot-os/ui/components/tooltip";
import {
  arrangeNodes,
  nodeSummary,
  nodeAppearance,
  nodeLabel,
  nodeName,
  paletteCategories,
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
export { nodeLabel, nodeName } from "./presentation";

type NodeData = {
  label: string;
  category: string;
  node: WorkflowNode;
  definition: NodeType;
  errors: string[];
  outcome?: NodeOutcome;
  [key: string]: unknown;
};
const fitOptions = { padding: 0.16, minZoom: 0.2, maxZoom: 1 };
// Outcomes that pass usable evidence downstream; their outgoing edges animate.
const flowing = new Set(["matched", "triggered", "evaluated"]);

const GraphNode = memo(function GraphNode({
  data,
  selected,
}: NodeProps<Node<NodeData>>) {
  const inputs = Object.keys(data.definition.inputs ?? {});
  const outputs = Object.keys(data.definition.outputs ?? {});
  const { Icon, tone } = nodeAppearance(data.node.type);
  const name = nodeName(data.node);
  return (
    <article
      className="workflow-node"
      style={{ "--node-accent": `var(--${tone})` } as CSSProperties}
      data-selected={selected}
      data-invalid={data.errors.length > 0}
      data-outcome={data.outcome?.status}
    >
      <div className="workflow-node-heading">
        <span className="workflow-node-icon">
          <Icon aria-hidden="true" size={18} />
        </span>
        <div className="min-w-0">
          <p className="workflow-node-kind">{name ? data.label : data.category}</p>
          <p className="workflow-node-title">{name ?? data.label}</p>
        </div>
      </div>
      <p className="workflow-node-summary" title={nodeSummary(data.node)}>
        {nodeSummary(data.node)}
      </p>
      {data.outcome && (
        <p className="workflow-node-outcome" title={data.outcome.reason}>
          <span aria-hidden="true" />
          <strong>{data.outcome.label}</strong>
          {data.outcome.reason && <span className="sr-only"> · {data.outcome.reason}</span>}
        </p>
      )}
      <div className="workflow-node-ports">
        {Array.from(
          { length: Math.max(inputs.length, outputs.length) },
          (_, i) => (
            <div className="workflow-port-row" key={i}>
              <span>
                {inputs[i] && (
                  <>
                    <Handle
                      type="target"
                      id={inputs[i]}
                      position={Position.Left}
                      aria-label={`Input ${inputs[i]}`}
                    />
                    {inputs[i]}
                  </>
                )}
              </span>
              <span>
                {outputs[i] && (
                  <>
                    {outputs[i]}
                    <Handle
                      type="source"
                      id={outputs[i]}
                      position={Position.Right}
                      aria-label={`Output ${outputs[i]}`}
                    />
                  </>
                )}
              </span>
            </div>
          ),
        )}
      </div>
      {data.errors.length > 0 && (
        <div className="px-3 pb-3">
          <Badge variant="destructive">{data.errors.length} issue(s)</Badge>
        </div>
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

function Picker({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [search, setSearch] = useState("");
  return (
    <SearchableSelect
      label={label}
      value={value}
      options={choices.filter((c) =>
        c.label.toLowerCase().includes(search.toLowerCase()),
      )}
      search={search}
      onSearchChange={setSearch}
      onChange={onChange}
    />
  );
}

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
  onSelectionChange,
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
  onSelectionChange?: (nodeId: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const canvasRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
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
  // Fit once per mounted workflow; afterwards the viewport is the user's.
  const fitted = useRef(false);
  useEffect(() => {
    if (!flow || fitted.current || !workflow.nodes.length) return;
    fitted.current = true;
    void flow.fitView(fitOptions);
  }, [flow, workflow.nodes.length]);
  // A host panel opens with its mode; leaving it keeps the inspector only for a selection.
  useEffect(() => {
    setPanelOpen(hostPanel || Boolean(selected));
  }, [hostPanel]);
  useEffect(() => {
    if (panelOpen && window.matchMedia?.("(max-width: 767px)").matches)
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [panelOpen, selected]);
  const select = (id: string) => {
    setSelected(id);
    onSelectionChange?.(id);
  };
  const defaultPositions = useMemo(
    () => arrangeNodes(workflow),
    [workflow.nodes, workflow.edges],
  );
  const fit = () => {
    void flow?.fitView({ ...fitOptions, minZoom: 0.15, duration: 200 });
  };
  const arrange = () => {
    onLayoutChange({ ...layout, positions: defaultPositions });
    requestAnimationFrame(() => requestAnimationFrame(fit));
  };
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const lookup = useMemo(
    () => new Map(registry.map((r) => [r.type, r])),
    [registry],
  );
  const labelOf = (n: WorkflowNode) => nodeLabel(n.type, lookup.get(n.type)?.label);
  const nodes = useMemo(
    () =>
      workflow.nodes.map((node) => ({
        id: node.id,
        type: "automation",
        position: layout.positions[node.id] ?? defaultPositions[node.id],
        data: {
          label: nodeLabel(node.type, lookup.get(node.type)?.label),
          category: nodeAppearance(node.type).category,
          node,
          definition: lookup.get(node.type) ?? edgeDefinition(node, workflow),
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
      layout.positions,
      defaultPositions,
      lookup,
      diagnostics,
      outcomes,
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
    requestAnimationFrame(() => panelHeadingRef.current?.focus());
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
          : { x: 116, y: 64 });
      const center = flow?.screenToFlowPosition(point) ?? point;
      onLayoutChange({
        ...layout,
        positions: {
          ...positions,
          [id]: { x: center.x - 116, y: center.y - 64 },
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
    label: nodeName(n) ?? `${labelOf(n)} · ${n.id}`,
  }));
  const choiceLabel = new Map(nodeChoices.map((c) => [c.value, c.label]));
  const ports = (direction: "inputs" | "outputs") =>
    workflow.nodes.flatMap((n) =>
      Object.keys(lookup.get(n.type)?.[direction] ?? {}).map((port) => ({
        value: `${n.id}:${port}`,
        label: `${choiceLabel.get(n.id)} · ${port}`,
      })),
    );
  const nodeTitle = node && (nodeName(node) ?? labelOf(node));
  const inspector = (
    <FieldGroup>
      <Picker
        label="Selected node"
        value={selected}
        choices={nodeChoices}
        onChange={select}
      />
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
          {Object.entries(definition.config_schema)
            .filter(([key]) => key !== "binding")
            .map(([key, f]) =>
              renderConfig?.(node, key, update) ?? (f.type === "object" ? (
                <ObjectField
                  key={node.id + key}
                  label={key}
                  value={node.config[key]}
                  onChange={(value) =>
                    update({
                      ...node,
                      config: { ...node.config, [key]: value },
                    })
                  }
                />
              ) : f.type === "scalar" && workflow.bindings.find((b) => b.role === node.config.binding)?.data_type === "boolean" ? (
                <Picker key={key} label="Target state" value={String(node.config[key] ?? false)} choices={[{ value: "true", label: "On (true)" }, { value: "false", label: "Off (false)" }]} onChange={(value) => update({ ...node, config: { ...node.config, [key]: value === "true" } })} />
              ) : f.enum ? (
                <Picker
                  key={key}
                  label={key.replaceAll("_", " ")}
                  value={String(node.config[key] ?? "")}
                  choices={f.enum.map((v) => ({ value: v, label: v }))}
                  onChange={(v) =>
                    update({
                      ...node,
                      config: { ...node.config, [key]: v },
                    })
                  }
                />
              ) : (
                <Field key={key}>
                  <FieldLabel htmlFor={`config-${node.id}-${key}`}>
                    {key.replaceAll("_", " ")}
                  </FieldLabel>
                  <Input
                    id={`config-${node.id}-${key}`}
                    type={f.type === "number" ? "number" : "text"}
                    min={f.minimum}
                    max={f.maximum}
                    value={String(node.config[key] ?? "")}
                    onChange={(e) => {
                      let value: unknown = e.target.value;
                      if (f.type === "number")
                        value =
                          e.target.value === ""
                            ? ""
                            : Number(e.target.value);
                      if (f.type === "scalar") {
                        const kind = workflow.bindings.find(
                          (b) => b.role === node.config.binding,
                        )?.data_type;
                        if (kind === "number")
                          value = Number(e.target.value);
                        if (kind === "boolean")
                          value = e.target.value === "true";
                      }
                      update({
                        ...node,
                        config: { ...node.config, [key]: value },
                      });
                    }}
                  />
                </Field>
              )),
            )}
        </>
      )}
      {node &&
        diagnostics
          .filter((d) => d.node_id === node.id)
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
      ? `${nodeName(node) ? `${labelOf(node)}. ` : ""}${nodeAppearance(node.type).description} Changes stay in your draft.`
      : "Select a node on the canvas to configure it. Changes stay in your draft.";
  const editor = (
    <div
      data-expanded={expanded}
      className="workflow-editor flex min-w-0 flex-col gap-4"
      onKeyDown={handleDeleteKey}
    >
      <div className="workflow-workspace" data-panel={panelOpen}>
        <Card size="sm" className="workflow-palette">
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
                  <section
                    key={category}
                    aria-label={category}
                    className="flex flex-col gap-2"
                  >
                    <h3 className="text-xs font-medium text-muted-foreground">
                      {category}
                    </h3>
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
                  </section>
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
                onClick={() => {
                  void flow?.zoomOut({ duration: 150 });
                }}
              >
                <MinusIcon />
              </CanvasButton>
              <Button
                variant="outline"
                size="sm"
                aria-label="Reset zoom to 100%"
                onClick={() => {
                  void flow?.zoomTo(1, { duration: 150 });
                }}
              >
                {Math.round(zoom * 100)}%
              </Button>
              <CanvasButton
                label="Zoom in"
                onClick={() => {
                  void flow?.zoomIn({ duration: 150 });
                }}
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
              onMove={(_, viewport) => setZoom(viewport.zoom)}
              onPaneClick={() => select("")}
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
              <div className="min-w-0">
                <h2
                  ref={panelHeadingRef}
                  id={`${panelId}-title`}
                  tabIndex={-1}
                  className="truncate text-sm font-medium outline-none first-letter:uppercase"
                >
                  {panelTitle}
                </h2>
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
              <Picker
                label="Output port"
                value={source}
                choices={ports("outputs")}
                onChange={setSource}
              />
              <Picker
                label="Input port"
                value={target}
                choices={ports("inputs")}
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
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const invalid = typeof value === "string";
  const text = invalid ? value : JSON.stringify(value ?? {}, null, 2);
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={label}>{label} (GeoJSON)</FieldLabel>
      <Textarea
        id={label}
        aria-invalid={invalid}
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
      {invalid && <p role="alert">Enter a valid JSON object.</p>}
    </Field>
  );
}
