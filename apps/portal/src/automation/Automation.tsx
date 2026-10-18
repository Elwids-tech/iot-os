import { Scenarios } from "./Scenarios";
import { Directory } from "./AutomationDirectory";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@iot-os/api-client";
import {
  WorkflowEditor,
  type Workflow,
  type Layout,
  type NodeCatalog,
  type Diagnostic,
  type Resource,
  type WorkflowNode,
} from "@iot-os/workflow-editor";
import { Redo2Icon, SparklesIcon, Undo2Icon } from "lucide-react";
import { Button } from "@iot-os/ui/components/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@iot-os/ui/components/card";
import { Input } from "@iot-os/ui/components/input";
import { Field, FieldGroup, FieldLabel } from "@iot-os/ui/components/field";
import { DraftBar } from "@iot-os/ui/components/draft-bar";
import { InlineName } from "@iot-os/ui/components/inline-name";
import { WorkspacePage } from "@iot-os/ui/templates/workspace-page";
import { SearchableSelect } from "@iot-os/ui/components/searchable-select";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@iot-os/ui/components/dialog";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@iot-os/ui/components/tabs";
import { Skeleton } from "@iot-os/ui/components/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@iot-os/ui/components/tooltip";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@iot-os/ui/components/table";
import reference from "../../../../contracts/rules/v2/workflow.fixture.json";
import { api } from "../lib/api";
import { useUnsavedContribution } from "../lib/unsaved";
import { RequestError } from "../components/forms";
import { GeofenceConfig } from "./GeofenceConfig";
import { DeviceStateConfig, DeviceStateReview } from "./DeviceStateConfig";
import { useResourceNames } from "./resource-names";
import { commandGrants } from "./device-state";
import { activationUnavailableReason } from "./activation";
import { WorkflowAssistant } from "./WorkflowAssistant";
import { usePanel } from "../panel/context";
import type { ExecutionSelection } from "./execution-evidence";
import { ExecutionTimeline } from "./ExecutionTimeline";
import { SimulationPanel } from "./SimulationPanel";
import { defaultSamples, nodeOutcomes, simulationSteps, type SimResult } from "./simulation";
import { deploymentState } from "./directory";
import type { EvidenceTarget } from "./execution-evidence";

type Saved = {
  uuid: string;
  name: string;
  workflow: Workflow;
  draft_revision: number;
  definition_hash: string;
  layout: Layout | null;
  layout_revision: number;
  deployment_generation: number;
  deployment_status: string;
  deployment_diagnostic?: string;
  applied_deployment_uuid?: string;
  pending_operation_uuid?: string;
};
type Page<T> = {
  data: T[];
  meta: { current_page: number; last_page: number; total: number };
};
const empty = (): Workflow => ({
  schema_version: "automation-workflow.v2",
  bindings: [],
  nodes: [],
  edges: [],
});
const url = (org: string, id = "") =>
  `/organizations/${org}/automation${id ? `/${id}` : ""}`;

export default function AutomationRoutes() {
  return (
    <Routes>
      <Route index element={<Directory />} />
      <Route path=":workflowUuid" element={<Workspace />} />
    </Routes>
  );
}
function Workspace() {
  const { organizationUuid: org = "", workflowUuid = "new" } = useParams();
  return <Editor key={`${org}:${workflowUuid}`} org={org} id={workflowUuid} />;
}
function Editor({ org, id }: { org: string; id: string }) {
  const [tab, setTab] = useState("editor");
  const [evidenceTarget, setEvidenceTarget] = useState<(EvidenceTarget & { sequence: number })>();
  // A recorded evaluation the assistant explains instead of the draft; cleared from the panel.
  const [explain, setExplain] = useState<ExecutionSelection>();
  const panel = usePanel();
  function showEvidence(target: EvidenceTarget) {
    setTab("execution");
    setEvidenceTarget(current => ({ ...target, sequence: (current?.sequence ?? 0) + 1 }));
  }
  const [saved, setSaved] = useState<Saved>();
  const [graph, setGraph] = useState<Workflow>(empty);
  const [layout, setLayout] = useState<Layout>({ positions: {} });
  const [name, setName] = useState("New automation");
  const [history, setHistory] = useState<Workflow[]>([]);
  const [future, setFuture] = useState<Workflow[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [simulation, setSimulation] = useState<SimResult>();
  const [simulationStep, setSimulationStep] = useState<number | "summary">("summary");
  const [selectedNode, setSelectedNode] = useState("");
  const [sampleValues, setSampleValues] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false);
  const [grantDays, setGrantDays] = useState(7);
  const [rateLimit, setRateLimit] = useState(1);
  const [layoutSaved, setLayoutSaved] = useState(
    JSON.stringify({ positions: {} }),
  );
  const initialized = useRef(false);
  const [pendingOperation, setPendingOperation] = useState<{
    operation_uuid: string;
    target_state: string;
    draft_revision: number;
    expected_generation: number;
    command_grants: unknown[];
  }>();
  const registry = useQuery({
    queryKey: ["automation-registry", org],
    queryFn: () => api.automation<NodeCatalog>(org, "/dag/node-types"),
    retry: 1,
  });
  const nodeTypes = useMemo(
    () => (registry.data?.data ?? []).map((type) => type.type === "action.command.v1" ? { ...type, label: "Set Device State" } : type),
    [registry.data],
  );
  const detail = useQuery({
    queryKey: ["automation", org, saved?.uuid ?? id],
    queryFn: () =>
      api.automation<{ data: Saved }>(org, `/${saved?.uuid ?? id}`),
    enabled: Boolean(saved || id !== "new"),
    refetchInterval: saved?.pending_operation_uuid ? 1500 : 10000,
  });
  useEffect(() => {
    if (detail.data && !initialized.current) {
      const w = detail.data.data;
      initialized.current = true;
      setSaved(w);
      setGraph(w.workflow);
      setName(w.name);
      setLayout(w.layout ?? { positions: {} });
      setLayoutSaved(JSON.stringify(w.layout ?? { positions: {} }));
    }
  }, [detail.data]);
  const live = detail.data?.data ?? saved;
  const dirty = !saved
    ? graph.nodes.length > 0 || name !== "New automation"
    : JSON.stringify(graph) !== JSON.stringify(saved.workflow) ||
      name !== saved.name;
  const layoutDirty = JSON.stringify(layout) !== layoutSaved;
  const needsSave = !saved || dirty || layoutDirty;
  const activationReason = activationUnavailableReason({ busy, dirty, saved, live });
  const reactivating = live?.deployment_status === "inactive" && live.deployment_generation > 0;
  useUnsavedContribution(dirty || layoutDirty);
  const samples = useMemo(() => ({ ...defaultSamples(graph), ...sampleValues }), [graph, sampleValues]);
  const names = useResourceNames(org, graph);
  const outcomes = useMemo(
    () => (tab === "simulation" && simulation ? nodeOutcomes(simulation, simulationStep) : undefined),
    [tab, simulation, simulationStep],
  );
  const actions = useQuery({
    queryKey: ["automation-actions", org, saved?.uuid],
    queryFn: () =>
      api.automation<
        Page<{
          id: string;
          node_id: string;
          kind: string;
          status: string;
          diagnostic?: string;
        }>
      >(org, `/${saved!.uuid}/actions`),
    enabled: Boolean(saved),
    refetchInterval: 5000,
  });
  const execution = useQuery({
    queryKey: [
      "automation-execution",
      org,
      saved?.uuid,
      live?.applied_deployment_uuid,
    ],
    queryFn: () =>
      api.automation<{
        data: {
          enabled: boolean;
          stopped_reason?: string;
          next_timer?: string;
          consumer_healthy: boolean;
        } | null;
      }>(org, `/${saved!.uuid}/execution`),
    enabled: Boolean(live?.applied_deployment_uuid),
    refetchInterval: 5000,
  });
  const change = (next: Workflow) => {
    setHistory((h) => [...h.slice(-49), graph]);
    setFuture([]);
    setGraph(next);
    setSimulation(undefined);
    setDiagnostics([]);
  };
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(e);
      if (e instanceof ApiError && e.status === 409 && saved)
        await detail.refetch();
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    const validation = await api.automation<{
      valid: boolean;
      diagnostics: Diagnostic[];
    }>(org, "/dag/validate", "POST", { workflow: graph });
    setDiagnostics(validation.diagnostics ?? []);
    if (!validation.valid) return;
    let w = saved;
    if (dirty || !w) {
      const response = await api.automation<{ data: Saved }>(
        org,
        w ? `/${w.uuid}` : "",
        w ? "PUT" : "POST",
        {
          name,
          workflow: graph,
          ...(w ? { draft_revision: w.draft_revision } : {}),
        },
      );
      w = response.data;
      initialized.current = true;
      setSaved(w);
      setGraph(w.workflow);
      setHistory([]);
      setFuture([]);
    }
    if (layoutDirty) {
      const response = await api.automation<{ data: Saved }>(
        org,
        `/${w.uuid}/layout`,
        "PUT",
        { layout, layout_revision: w.layout_revision },
      );
      setSaved(response.data);
      setLayoutSaved(JSON.stringify(layout));
    }
    if (id !== "new") await detail.refetch();
  }
  async function simulate() {
    if (!saved || dirty) return;
    const { steps, labels } = simulationSteps(
      graph,
      samples,
      org,
      Math.floor(Date.now() / 60000) * 60000,
      () => crypto.randomUUID(),
    );
    const response = await api.automation<Omit<SimResult, "labels">>(
      org,
      `/${saved.uuid}/simulate`,
      "POST",
      { draft_revision: saved.draft_revision, steps },
    );
    setSimulation({ ...response, labels });
    setSimulationStep("summary");
  }
  async function deploy(target: "active" | "inactive") {
    if (!saved || !live) return;
    const command_grants =
      target === "inactive"
        ? []
        : commandGrants(graph)
            .map((grant) => ({
              ...grant,
              max_per_minute: rateLimit,
              expires_at: new Date(
                Date.now() + grantDays * 86400000,
              ).toISOString(),
            }));
    const input = pendingOperation ?? {
      operation_uuid: crypto.randomUUID(),
      target_state: target,
      draft_revision: saved.draft_revision,
      expected_generation: live.deployment_generation,
      command_grants,
    };
    setPendingOperation(input);
    const response = await api.automation<{ data: Saved }>(
      org,
      `/${saved.uuid}/deployments`,
      "POST",
      input,
    );
    setSaved(response.data);
    setPendingOperation(undefined);
    setReview(false);
    await detail.refetch();
  }
  const undo = () => {
    setFuture((f) => [graph, ...f]);
    setGraph(history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
    setSimulation(undefined);
  };
  const redo = () => {
    setHistory((h) => [...h, graph]);
    setGraph(future[0]);
    setFuture((f) => f.slice(1));
    setSimulation(undefined);
  };
  if ((id !== "new" && !saved && !detail.error) || registry.isLoading)
    return (
      <div className="p-6">
        <Skeleton className="h-96" />
      </div>
    );
  const status = deploymentState(live?.deployment_status ?? "inactive");
  return (
    <>
      <WorkspacePage
        title={name || "Automation"}
        name={
          <InlineName
            id="automation-name"
            label="Name"
            value={name}
            placeholder="Untitled automation"
            onChange={(e) => setName(e.target.value)}
          />
        }
        back={{ to: url(org), label: "Automations" }}
        helpContext={`automation.${tab}`}
        actions={<>
            {live?.applied_deployment_uuid && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || Boolean(live.pending_operation_uuid)}
                onClick={() => void run(() => deploy("inactive"))}
              >
                Disable
              </Button>
            )}
            <Button size="sm" variant={needsSave ? "default" : "outline"} disabled={busy} onClick={() => void run(save)}>
              Save
            </Button>
            <Button
              size="sm"
              variant={needsSave ? "outline" : "default"}
              disabled={Boolean(activationReason)}
              title={activationReason}
              onClick={() => setReview(true)}
            >
              {reactivating ? "Reactivate" : "Review activation"}
            </Button>
</>}
        tools={<>          <div role="group" aria-label="Undo and redo" className="flex items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Undo" disabled={!history.length || busy} onClick={undo}>
                  <Undo2Icon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Undo</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Redo" disabled={!future.length || busy} onClick={redo}>
                  <Redo2Icon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Redo</TooltipContent>
            </Tooltip>
          </div>
          <WorkflowAssistant org={org} editorId={id} workflowId={saved?.uuid} name={name} graph={graph} revision={saved?.draft_revision} registry={nodeTypes} disabled={busy || (id !== "new" && !saved)} onApply={change} onEvidence={showEvidence} execution={explain} onClearExecution={() => setExplain(undefined)} size="sm" />
</>}
        draft={
          <DraftBar
            tone={status.tone}
            status={status.label}
            revision={`Draft ${saved?.draft_revision ?? "unsaved"}`}
            dirty={dirty || layoutDirty}
          />
        }
      >
        {activationReason && !busy && <p className="text-sm text-muted-foreground" role="status">{activationReason}</p>}
        <RequestError error={error ?? detail.error} />
        {saved &&
          live &&
          (live.draft_revision !== saved.draft_revision ||
            live.layout_revision !== saved.layout_revision) && (
            <Alert>
              <AlertDescription>
                <p>
                  A newer revision was saved elsewhere. Your local edits are
                  preserved.
                </p>
                <details>
                  <summary>Review latest saved graph</summary>
                  <pre className="max-h-64 overflow-auto text-xs">
                    {JSON.stringify(live.workflow, null, 2)}
                  </pre>
                </details>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSaved(live);
                      setLayoutSaved(
                        JSON.stringify(live.layout ?? { positions: {} }),
                      );
                      setSimulation(undefined);
                      setError(undefined);
                    }}
                  >
                    Keep local edits on latest revision
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setSaved(live);
                      setGraph(live.workflow);
                      setName(live.name);
                      setLayout(live.layout ?? { positions: {} });
                      setLayoutSaved(
                        JSON.stringify(live.layout ?? { positions: {} }),
                      );
                      setHistory([]);
                      setFuture([]);
                      setSimulation(undefined);
                      setError(undefined);
                    }}
                  >
                    Load latest and discard local edits
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}
        {live?.deployment_diagnostic && (
          <Alert variant="destructive">
            <AlertDescription>{live.deployment_diagnostic}</AlertDescription>
          </Alert>
        )}
        {pendingOperation && (
          <Alert>
            <AlertDescription>
              Deployment response was not confirmed. Retry using the same
              operation identity.
            </AlertDescription>
            <AlertAction>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void run(() =>
                    deploy(
                      pendingOperation.target_state as "active" | "inactive",
                    ),
                  )
                }
              >
                Retry deployment
              </Button>
            </AlertAction>
          </Alert>
        )}
        {diagnostics
          .filter((d) => !d.node_id)
          .map((d, i) => (
            <Alert key={i} variant="destructive">
              <AlertDescription>{d.message}</AlertDescription>
            </Alert>
          ))}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="editor">Editor</TabsTrigger>
            <TabsTrigger value="simulation">Simulation</TabsTrigger>
            <TabsTrigger value="execution">Execution</TabsTrigger>
          </TabsList>
          {/* Editor and Simulation share one canvas so the viewport, selection and drafts persist. */}
          <TabsContent
            value={tab === "simulation" ? "simulation" : "editor"}
            forceMount
            className="flex flex-col gap-4 data-[state=inactive]:hidden"
          >
            {graph.nodes.length === 0 && tab === "editor" && (
              <Button
                variant="outline"
                className="w-fit"
                onClick={() =>
                  change({
                    schema_version: "automation-workflow.v2",
                    bindings: [],
                    nodes: reference.nodes,
                    edges: reference.edges,
                  })
                }
              >
                Start with temperature + pressure → pump template
              </Button>
            )}
            <WorkflowEditor
              workflow={graph}
              layout={layout}
              registry={nodeTypes}
              catalog={{
                error: Boolean(registry.error),
                stale: registry.data?.meta?.stale,
                cachedAt: registry.data?.meta?.cached_at,
              }}
              diagnostics={diagnostics}
              onChange={change}
              onLayoutChange={setLayout}
              onSelectionChange={setSelectedNode}
              outcomes={outcomes}
              resourceNames={names}
              palette={tab !== "simulation"}
              panel={
                tab === "simulation"
                  ? {
                      label: "Simulation",
                      description:
                        "Try synthetic readings against the saved revision. Results are highlighted on the canvas.",
                      content: (
                        <SimulationPanel
                          graph={graph}
                          registry={nodeTypes}
                          revision={saved?.draft_revision}
                          dirty={dirty}
                          busy={busy}
                          values={samples}
                          onValuesChange={setSampleValues}
                          result={simulation}
                          step={simulationStep}
                          onStepChange={setSimulationStep}
                          selected={selectedNode}
                          onRun={() => void run(simulate)}
                        />
                      ),
                    }
                  : undefined
              }
              renderConfig={(node, key, update) => node.type === "action.command.v1" && ["settings", "value"].includes(key) ? <span key={key} hidden /> : node.type === "geofence.v1" && key === "geometry" ? <GeofenceConfig key={node.id + key} org={org} node={node} update={update} /> : undefined}
              renderBinding={(node, update) => node.type === "action.command.v1" ? <DeviceStateConfig key={node.id} org={org} node={node} graph={graph} onChange={change} /> : (
                <BindingPicker
                  key={node.id}
                  org={org}
                  node={node}
                  graph={graph}
                  onChange={(next, nextNode) => {
                    change({
                      ...next,
                      nodes: next.nodes.map((n) =>
                        n.id === node.id ? nextNode : n,
                      ),
                    });
                  }}
                />
              )}
            />
            <div hidden={tab !== "simulation"}>
              {saved && <Scenarios org={org} workflowId={saved.uuid} graph={graph} revision={saved.draft_revision} workflowDirty={dirty} />}
            </div>
          </TabsContent>
          <TabsContent value="execution">
            <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Live execution</CardTitle>
                <CardDescription>
                  Activation becomes applied only after runtime acknowledgement.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p>Deployment: {live?.deployment_status ?? "inactive"}</p>
                <p>
                  Applied version: {live?.applied_deployment_uuid ?? "None"}
                </p>
                {execution.data?.data && (
                  <p>
                    {execution.data.data.enabled ? "Running" : "Suspended"} ·
                    Consumer{" "}
                    {execution.data.data.consumer_healthy
                      ? "healthy"
                      : "unhealthy"}{" "}
                    {execution.data.data.stopped_reason}
                  </p>
                )}
                <RequestError error={execution.error ?? actions.error} />
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Node</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Outcome</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {actions.data?.data.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>{a.node_id}</TableCell>
                        <TableCell>{a.kind}</TableCell>
                        <TableCell>
                          {a.status}
                          {a.diagnostic && (
                            <p className="text-xs text-muted-foreground">
                              {a.diagnostic}
                            </p>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <ExecutionTimeline key={saved?.uuid ?? "unsaved"} org={org} workflowId={saved?.uuid} registry={nodeTypes} evidenceTarget={evidenceTarget} renderAssistant={evaluation => <Button variant="outline" size="sm" disabled={busy || !saved} aria-pressed={explain?.id === evaluation.id} onClick={() => { setExplain(evaluation); panel.openPanel("ask") }}><SparklesIcon data-icon="inline-start" />Explain this execution</Button>} />
            </div>
          </TabsContent>
        </Tabs>
        <Dialog open={review} onOpenChange={setReview}>
          <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-xl">
            <DialogHeader className="shrink-0">
              <DialogTitle>
              {reactivating ? "Reactivate" : "Activate"} revision {saved?.draft_revision}
              </DialogTitle>
              <DialogDescription>
                This replaces the current execution and starts fresh evidence.
                Review the device commands authorized for automatic execution.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup className="min-h-0 overflow-y-auto">
              {simulation?.draft_revision !== saved?.draft_revision && (
                <p className="text-sm text-muted-foreground">
                  Simulation is optional and has not been run for this revision in this tab.
                </p>
              )}
              {graph.nodes
                .filter((n) => n.type === "action.command.v1")
                .map((n) => <DeviceStateReview key={n.id} org={org} node={n} graph={graph} />)}
              <Field>
                <FieldLabel htmlFor="grant-days">
                  Command authorization expires after (days)
                </FieldLabel>
                <Input
                  id="grant-days"
                  type="number"
                  min={1}
                  max={365}
                  value={grantDays}
                  onChange={(e) => setGrantDays(Number(e.target.value))}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="grant-rate">
                  Maximum commands per target per minute
                </FieldLabel>
                <Input
                  id="grant-rate"
                  type="number"
                  min={1}
                  max={60}
                  value={rateLimit}
                  onChange={(e) => setRateLimit(Number(e.target.value))}
                />
              </Field>
              <p className="text-sm text-muted-foreground">
                Alerts use existing notification preferences. Saving or
                activating does not enable email.
              </p>
            </FieldGroup>
            <DialogFooter className="shrink-0">
              <Button variant="outline" onClick={() => setReview(false)}>
                Cancel
              </Button>
              <Button
                disabled={Boolean(activationReason)}
                onClick={() => void run(() => deploy("active"))}
              >
                Approve and activate
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </WorkspacePage>
    </>
  );
}

function BindingPicker({
  org,
  node,
  graph,
  onChange,
}: {
  org: string;
  node: WorkflowNode;
  graph: Workflow;
  onChange: (graph: Workflow, node: WorkflowNode) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [parameterSearch, setParameterSearch] = useState("");
  const binding = graph.bindings.find((b) => b.role === node.config.binding);
  const [device, setDevice] = useState<Resource>();
  const resources = useQuery({
    queryKey: ["automation-resources", org, search, page],
    queryFn: () =>
      api.automation<Page<Resource>>(
        org,
        `/dag/resources?${new URLSearchParams({ search, page: String(page) })}`,
      ),
  });
  const selectedDevice =
    device ??
    resources.data?.data.find((d) => d.device_uuid === binding?.device_uuid);
  const parameters =
    selectedDevice?.parameters.filter((p) =>
      node.type === "action.command.v1"
        ? p.accepts_command && p.reports_state
        : p.reports_state,
    ) ?? [];
  return (
    <>
      <SearchableSelect
        label="Device"
        value={device?.device_uuid ?? binding?.device_uuid ?? ""}
        selectedLabel={selectedDevice?.name ?? binding?.role}
        options={(resources.data?.data ?? []).map((d) => ({
          value: d.device_uuid,
          label: d.name,
        }))}
        search={search}
        onSearchChange={(s) => {
          setSearch(s);
          setPage(1);
        }}
        onChange={(id) =>
          setDevice(resources.data?.data.find((d) => d.device_uuid === id))
        }
        page={page}
        hasNextPage={Boolean(
          resources.data && page < resources.data.meta.last_page,
        )}
        onPageChange={setPage}
        loading={resources.isLoading}
      />
      <SearchableSelect
        label="Parameter"
        value={binding?.parameter_uuid ?? ""}
        options={parameters
          .filter((p) =>
            (p.name ?? p.key)
              .toLowerCase()
              .includes(parameterSearch.toLowerCase()),
          )
          .map((p) => ({
            value: p.uuid,
            label: `${p.name ?? p.key}${p.unit ? ` (${p.unit})` : ""}`,
          }))}
        search={parameterSearch}
        onSearchChange={setParameterSearch}
        disabled={!selectedDevice}
        onChange={(id) => {
          const p = parameters.find((p) => p.uuid === id)!;
          const d = selectedDevice!;
          const role = node.id;
          const data_type =
            p.data_type === "integer" || p.data_type === "number"
              ? "number"
              : p.data_type === "boolean"
                ? "boolean"
                : "string";
          onChange(
            {
              ...graph,
              bindings: [
                ...graph.bindings.filter((b) => b.role !== role),
                {
                  role,
                  device_uuid: d.device_uuid,
                  configuration_uuid: d.configuration_uuid,
                  generation: d.generation,
                  parameter_uuid: p.uuid,
                  data_type,
                  unit: p.unit ?? "",
                  fresh_seconds: 120,
                },
              ],
            },
            {
              ...node,
              config: {
                ...node.config,
                binding: role,
                ...(node.type === "action.command.v1"
                  ? {
                      value:
                        data_type === "boolean"
                          ? false
                          : data_type === "number"
                            ? 0
                            : "",
                    }
                  : {}),
              },
            },
          );
        }}
      />
      {binding && (
        <Field>
          <FieldLabel htmlFor={`fresh-${node.id}`}>
            Reading freshness (seconds)
          </FieldLabel>
          <Input
            id={`fresh-${node.id}`}
            type="number"
            min={1}
            max={86400}
            value={binding.fresh_seconds}
            onChange={(e) =>
              onChange(
                {
                  ...graph,
                  bindings: graph.bindings.map((b) =>
                    b.role === binding.role
                      ? { ...b, fresh_seconds: Number(e.target.value) }
                      : b,
                  ),
                },
                node,
              )
            }
          />
        </Field>
      )}
    </>
  );
}
