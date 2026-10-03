import {
  memo,
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@iot-os/ui/components/sheet";
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
  PlusIcon,
  TrashIcon,
  GitMergeIcon,
  SlidersHorizontalIcon,
  MinusIcon,
  ScanIcon,
  MaximizeIcon,
  MinimizeIcon,
  WorkflowIcon,
  MousePointer2Icon,
  GripVerticalIcon,
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
  paletteCategories,
} from "./presentation";
import type {
  Workflow,
  Layout,
  NodeType,
  Diagnostic,
  WorkflowNode,
} from "./types";
import "@xyflow/react/dist/style.css";
import "./workflow-editor.css";
export type * from "./types";

type NodeData = {
  label: string;
  node: WorkflowNode;
  definition: NodeType;
  errors: string[];
  [key: string]: unknown;
};
const GraphNode = memo(function GraphNode({
  data,
  selected,
}: NodeProps<Node<NodeData>>) {
  const inputs = Object.keys(data.definition.inputs ?? {});
  const outputs = Object.keys(data.definition.outputs ?? {});
  const { Icon, tone } = nodeAppearance(data.node.type);
  return (
    <article
      className="workflow-node"
      style={{ "--node-accent": `var(--${tone})` } as CSSProperties}
      data-selected={selected}
      data-invalid={data.errors.length > 0}
    >
      <div className="workflow-node-heading">
        <span className="workflow-node-icon">
          <Icon aria-hidden="true" size={18} />
        </span>
        <div className="min-w-0">
          <p className="workflow-node-kind">{data.label}</p>
          <p className="workflow-node-title">
            {data.node.id.startsWith("node_")
              ? data.label
              : data.node.id.replaceAll("_", " ")}
          </p>
        </div>
      </div>
      <p className="workflow-node-summary" title={nodeSummary(data.node)}>
        {nodeSummary(data.node)}
      </p>
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

/** Host owns persistence, permissions, resources and deployment. No portal imports. */
export function WorkflowEditor({
  workflow,
  layout,
  registry,
  diagnostics,
  onChange,
  onLayoutChange,
  renderBinding,
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
}) {
  const [selected, setSelected] = useState("");
  const canvasRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [paletteSearch, setPaletteSearch] = useState("");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [flow, setFlow] = useState<ReactFlowInstance<Node<NodeData>> | null>(
    null,
  );
  const [zoom, setZoom] = useState(layout.viewport?.zoom ?? 1);
  const [expanded, setExpanded] = useState(false);
  const defaultPositions = useMemo(
    () => arrangeNodes(workflow),
    [workflow.nodes, workflow.edges],
  );
  const fit = () => {
    void flow?.fitView({
      padding: 0.16,
      minZoom: 0.15,
      maxZoom: 1,
      duration: 200,
    });
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
  const nodes = useMemo(
    () =>
      workflow.nodes.map((node) => ({
        id: node.id,
        type: "automation",
        position: layout.positions[node.id] ?? defaultPositions[node.id],
        data: {
          label: lookup.get(node.type)?.label ?? node.type,
          node,
          definition:
            lookup.get(node.type) ?? ({ inputs: {}, outputs: {} } as NodeType),
          errors: diagnostics
            .filter((d) => d.node_id === node.id)
            .map((d) => d.message),
        },
        selected: selected === node.id,
      })),
    [
      workflow.nodes,
      layout.positions,
      defaultPositions,
      lookup,
      diagnostics,
      selected,
    ],
  );
  const edges = useMemo(
    () =>
      workflow.edges.map((e, i) => ({
        id: String(i),
        source: e.source,
        target: e.target,
        sourceHandle: e.source_port,
        targetHandle: e.target_port,
        type: "smoothstep",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 18,
          height: 18,
          color:
            selected === e.source || selected === e.target
              ? "var(--primary)"
              : "var(--muted-foreground)",
        },
        className:
          selected === e.source || selected === e.target
            ? "workflow-edge-connected"
            : undefined,
        interactionWidth: 24,
      })),
    [workflow.edges, selected],
  );
  const node = workflow.nodes.find((n) => n.id === selected);
  const definition = node && lookup.get(node.type);
  const deleteSelectedNode = () => {
    if (!node) return;
    onChange({
      ...workflow,
      nodes: workflow.nodes.filter((n) => n.id !== node.id),
      edges: workflow.edges.filter(
        (e) => e.source !== node.id && e.target !== node.id,
      ),
    });
    setSelected("");
    setInspectorOpen(false);
    requestAnimationFrame(() => canvasRef.current?.focus());
  };
  const handleDeleteKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.key !== "Delete" ||
      event.defaultPrevented ||
      event.repeat ||
      event.nativeEvent.isComposing ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      !(event.target instanceof HTMLElement) ||
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
    const id = `node_${crypto.randomUUID().slice(0, 8)}`;
    const config = Object.fromEntries(
      Object.entries(type.config_schema).map(([key, f]) => [
        key,
        f.enum?.[0] ?? (f.type === "number" ? (f.minimum ?? 0) : ""),
      ]),
    );
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
        viewport: flow?.getViewport() ?? layout.viewport,
        positions: {
          ...positions,
          [id]: { x: center.x - 116, y: center.y - 64 },
        },
      });
    };
    // Pin the current viewport so React Flow does not auto-fit the first drop.
    // Re-measure after the empty-state prompt disappears to keep the node at
    // the same screen position even when the canvas moves within the page.
    place();
    requestAnimationFrame(place);
    setSelected(id);
    if (!screenPosition) setInspectorOpen(true);
  };
  const paletteNodes = registry.filter((type) =>
    `${type.label} ${type.type} ${nodeAppearance(type.type).category} ${nodeAppearance(type.type).description}`
      .toLowerCase()
      .includes(paletteSearch.toLowerCase()),
  );
  const ports = (direction: "inputs" | "outputs") =>
    workflow.nodes.flatMap((n) =>
      Object.keys(lookup.get(n.type)?.[direction] ?? {}).map((port) => ({
        value: `${n.id}:${port}`,
        label: `${n.id} · ${port}`,
      })),
    );
  const editor = (
    <div
      data-expanded={expanded}
      className="workflow-editor flex min-w-0 flex-col gap-4"
      onKeyDown={handleDeleteKey}
    >
      <div className="workflow-workspace">
        <Card size="sm" className="workflow-palette">
          <CardHeader>
            <CardTitle>Nodes</CardTitle>
            <CardDescription>Drag onto the canvas</CardDescription>
            <Field className="mt-2">
              <FieldLabel className="sr-only" htmlFor="node-palette-search">
                Search nodes
              </FieldLabel>
              <Input
                id="node-palette-search"
                placeholder="Search nodes…"
                value={paletteSearch}
                onChange={(event) => setPaletteSearch(event.target.value)}
              />
            </Field>
          </CardHeader>
          <CardContent className="workflow-palette-list">
            {paletteCategories.map((category) => {
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
                              {type.label}
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
            })}
            {!paletteNodes.length && (
              <p className="text-sm text-muted-foreground">
                No matching nodes.
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
                variant="outline"
                size="sm"
                disabled={!workflow.nodes.length}
                onClick={() => {
                  if (!selected) setSelected(workflow.nodes[0].id);
                  setInspectorOpen(true);
                }}
              >
                <SlidersHorizontalIcon data-icon="inline-start" />
                Edit node
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
              onPaneClick={() => setSelected("")}
              fitViewOptions={{ padding: 0.16, minZoom: 0.65, maxZoom: 1 }}
              connectionLineStyle={{
                stroke: "var(--primary)",
                strokeWidth: 3,
              }}
              nodeTypes={nodeTypes}
              onNodeClick={(_, n) => {
                setSelected(n.id);
                setInspectorOpen(true);
              }}
              onConnect={connect}
              onNodesChange={(changes) => {
                const positions = { ...layout.positions };
                let moved = false;
                for (const c of changes) {
                  if (c.type === "position" && c.position) {
                    positions[c.id] = c.position;
                    moved = true;
                  }
                }
                if (moved) onLayoutChange({ ...layout, positions });
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
              onMoveEnd={(_, viewport) =>
                onLayoutChange({ ...layout, viewport })
              }
              defaultViewport={layout.viewport}
              fitView={!layout.viewport}
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
              configure · Delete to remove selected node
            </span>
            <span className="ml-auto hidden sm:inline">Left → right</span>
          </div>
        </section>
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
                  {edge.source}.{edge.source_port} → {edge.target}.
                  {edge.target_port}
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
      <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{definition?.label ?? "Node"} settings</SheetTitle>
            <SheetDescription>
              {node
                ? nodeAppearance(node.type).description
                : "Select a node to configure."}{" "}
              Changes stay in your draft.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            <FieldGroup>
              <Picker
                label="Selected node"
                value={selected}
                choices={workflow.nodes.map((n) => ({
                  value: n.id,
                  label: `${lookup.get(n.type)?.label ?? n.type} · ${n.id}`,
                }))}
                onChange={setSelected}
              />
              {node && definition && (
                <>
                  {(node.type === "source.parameter.v1" ||
                    node.type === "action.command.v1") &&
                    renderBinding(node, update)}
                  {Object.entries(definition.config_schema)
                    .filter(([key]) => key !== "binding")
                    .map(([key, f]) =>
                      f.type === "object" ? (
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
                          <FieldLabel htmlFor={`config-${key}`}>
                            {key.replaceAll("_", " ")}
                          </FieldLabel>
                          <Input
                            id={`config-${key}`}
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
                      ),
                    )}
                  {diagnostics
                    .filter((d) => d.node_id === node.id)
                    .map((d, i) => (
                      <Alert key={i} variant="destructive">
                        <AlertDescription>
                          {d.field}: {d.message}
                        </AlertDescription>
                      </Alert>
                    ))}
                  <Button
                    variant="outline"
                  onClick={deleteSelectedNode}
                  >
                    <TrashIcon data-icon="inline-start" />
                    Delete node
                  </Button>
                </>
              )}
            </FieldGroup>
          </div>
        </SheetContent>
      </Sheet>
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
