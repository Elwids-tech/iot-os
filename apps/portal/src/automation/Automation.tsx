import { Scenarios } from "./Scenarios";
import { useEffect, useRef, useState } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@iot-os/api-client";
import {
  WorkflowEditor,
  type Workflow,
  type Layout,
  type NodeType,
  type Diagnostic,
  type Resource,
  type WorkflowNode,
} from "@iot-os/workflow-editor";
import { Button } from "@iot-os/ui/components/button";
import { Badge } from "@iot-os/ui/components/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@iot-os/ui/components/card";
import { Input } from "@iot-os/ui/components/input";
import { Field, FieldGroup, FieldLabel } from "@iot-os/ui/components/field";
import { PageHeader } from "@iot-os/ui/components/page-header";
import { SearchableSelect } from "@iot-os/ui/components/searchable-select";
import { Alert, AlertDescription } from "@iot-os/ui/components/alert";
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
import { commandGrants } from "./device-state";
import { activationUnavailableReason } from "./activation";
import { WorkflowAssistant } from "./WorkflowAssistant";
import { ExecutionTimeline } from "./ExecutionTimeline";
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
type Settings = { enabled: boolean; stopped: boolean; revision: number };
type Page<T> = {
  data: T[];
  meta: { current_page: number; last_page: number; total: number };
};
type SimResult = {
  draft_revision: number;
  steps: {
    trace: {
      node_id: string;
      inputs: Record<
        string,
        { known: boolean; value: unknown; reason?: string }
      >;
      outputs: Record<
        string,
        { known: boolean; value: unknown; reason?: string }
      >;
    };
    intents: { node_id: string; kind: string; trigger: string }[];
  }[];
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
function Directory() {
  const org = useParams().organizationUuid!;
  const cache = useQueryClient();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const settings = useQuery({
    queryKey: ["automation-settings", org],
    queryFn: () => api.automation<{ data: Settings }>(org, "/dag/settings"),
  });
  const list = useQuery({
    queryKey: ["automation-directory", org, search, page],
    queryFn: () =>
      api.automation<Page<Saved>>(
        org,
        `/dag?${new URLSearchParams({ search, page: String(page) })}`,
      ),
  });
  async function change(values: Partial<Settings>) {
    if (!settings.data) return;
    setBusy(true);
    try {
      await api.automation(org, "/dag/settings", "PUT", {
        ...settings.data.data,
        ...values,
      });
      await cache.invalidateQueries({ queryKey: ["automation-settings", org] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader title="Automations" />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <RequestError error={error ?? settings.error ?? list.error} />
        <Card>
          <CardHeader>
            <CardTitle>Device automations</CardTitle>
            <CardDescription>
              Build rules from telemetry, correlate devices, and review actions
              before activation.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {!settings.data?.data.enabled ? (
              <Button
                disabled={busy || !settings.data}
                onClick={() => void change({ enabled: true })}
              >
                Enable automation preview
              </Button>
            ) : (
              <>
                <Button asChild>
                  <Link to={url(org, "new")}>Create automation</Link>
                </Button>
                <Button
                  variant={
                    settings.data.data.stopped ? "outline" : "destructive"
                  }
                  disabled={busy}
                  onClick={() =>
                    void change({ stopped: !settings.data!.data.stopped })
                  }
                >
                  {settings.data.data.stopped
                    ? "Resume automations"
                    : "Stop all automation actions"}
                </Button>
                <Badge variant="outline">Preview</Badge>
              </>
            )}
          </CardContent>
        </Card>
        {settings.data?.data.stopped && (
          <Alert>
            <AlertDescription>
              Organization automation actions are stopped. Already dispatched
              commands may still reach devices.
            </AlertDescription>
          </Alert>
        )}
        <Input
          aria-label="Search automations"
          placeholder="Search automations…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Automation</TableHead>
              <TableHead>Draft</TableHead>
              <TableHead>Deployment</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data?.data.map((w) => (
              <TableRow key={w.uuid}>
                <TableCell>
                  <Link to={url(org, w.uuid)}>{w.name}</Link>
                </TableCell>
                <TableCell>Revision {w.draft_revision}</TableCell>
                <TableCell>
                  <Badge variant="outline">{w.deployment_status}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {list.data?.data.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No automations yet. Create a workflow to begin.
          </p>
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            disabled={!list.data || page >= list.data.meta.last_page}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </>
  );
}

function Workspace() {
  const { organizationUuid: org = "", workflowUuid = "new" } = useParams();
  return <Editor key={`${org}:${workflowUuid}`} org={org} id={workflowUuid} />;
}
function Editor({ org, id }: { org: string; id: string }) {
  const [tab, setTab] = useState("editor");
  const [evidenceTarget, setEvidenceTarget] = useState<(EvidenceTarget & { sequence: number })>();
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
    queryFn: () => api.automation<{ data: NodeType[] }>(org, "/dag/node-types"),
  });
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
  const activationReason = activationUnavailableReason({ busy, dirty, saved, live });
  const reactivating = live?.deployment_status === "inactive" && live.deployment_generation > 0;
  useUnsavedContribution(dirty || layoutDirty);
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
    const start = Math.floor(Date.now() / 60000) * 60000;
    const iso = (seconds: number) =>
      new Date(start + seconds * 1000).toISOString();
    const nodes = graph.nodes.filter((n) => n.type === "source.parameter.v1");
    const steps: unknown[] = [{ at: iso(0), event: null }];
    for (const node of nodes) {
      const b = graph.bindings.find((b) => b.role === node.config.binding)!;
      const raw = sampleValues[b.role] ?? "0";
      const value =
        b.data_type === "boolean"
          ? raw === "true"
          : b.data_type === "number"
            ? Number(raw)
            : raw;
      steps.push({
        at: iso(1),
        event: {
          schema_version: "telemetry.committed.v1",
          event_id: crypto.randomUUID(),
          telemetry_id: crypto.randomUUID(),
          sequence: "1",
          organization_uuid: org,
          device_uuid: b.device_uuid,
          configuration_uuid: b.configuration_uuid,
          generation: b.generation,
          readings: [
            {
              parameter_uuid: b.parameter_uuid,
              key: b.role,
              data_type: b.data_type,
              unit: b.unit || null,
              value,
              quality: "good",
              observed_at: iso(1),
              received_at: iso(1),
              historical: false,
            },
          ],
        },
      });
    }
    const end = Math.max(
      2,
      ...graph.nodes.map((n) =>
        n.type === "window.v1"
          ? Number(n.config.duration_seconds) +
            Number(n.config.slide_seconds) +
            Number(n.config.lateness_seconds)
          : n.type === "sustained.v1"
            ? Number(n.config.seconds) + 2
            : 0,
      ),
    );
    steps.push({ at: iso(end), event: null });
    setSimulation(
      await api.automation<SimResult>(org, `/${saved.uuid}/simulate`, "POST", {
        draft_revision: saved.draft_revision,
        steps,
      }),
    );
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
  if ((id !== "new" && !saved && !detail.error) || registry.isLoading)
    return (
      <div className="p-6">
        <Skeleton className="h-96" />
      </div>
    );
  return (
    <>
      <PageHeader title={name} helpContext={`automation.${tab}`} />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" asChild>
            <Link to={url(org)}>Automations</Link>
          </Button>
          <Badge variant="outline">
            Draft {saved?.draft_revision ?? "unsaved"}
          </Badge>
          <Badge variant="outline">
            {live?.deployment_status ?? "inactive"}
          </Badge>
          {dirty && <Badge variant="secondary">Unsaved changes</Badge>}
          <Button disabled={busy} onClick={() => void run(save)}>
            Save
          </Button>
          <WorkflowAssistant org={org} editorId={id} workflowId={saved?.uuid} name={name} graph={graph} revision={saved?.draft_revision} registry={registry.data?.data ?? []} disabled={busy || (id !== "new" && !saved)} onApply={change} onEvidence={showEvidence} />
          <Button
            variant="outline"
            disabled={!history.length || busy}
            onClick={() => {
              setFuture((f) => [graph, ...f]);
              setGraph(history[history.length - 1]);
              setHistory((h) => h.slice(0, -1));
              setSimulation(undefined);
            }}
          >
            Undo
          </Button>
          <Button
            variant="outline"
            disabled={!future.length || busy}
            onClick={() => {
              setHistory((h) => [...h, graph]);
              setGraph(future[0]);
              setFuture((f) => f.slice(1));
              setSimulation(undefined);
            }}
          >
            Redo
          </Button>
          <Button
            disabled={Boolean(activationReason)}
            title={activationReason}
            onClick={() => setReview(true)}
          >
            {reactivating ? "Reactivate" : "Review activation"}
          </Button>
          {live?.applied_deployment_uuid && (
            <Button
              variant="outline"
              disabled={busy || Boolean(live.pending_operation_uuid)}
              onClick={() => void run(() => deploy("inactive"))}
            >
              Disable
            </Button>
          )}
        </div>
        {activationReason && !busy && <p className="text-sm text-muted-foreground" role="status">{activationReason}</p>}
        <RequestError error={error ?? registry.error ?? detail.error} />
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
              operation identity.{" "}
              <Button
                variant="outline"
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
            </AlertDescription>
          </Alert>
        )}
        {diagnostics
          .filter((d) => !d.node_id)
          .map((d, i) => (
            <Alert key={i} variant="destructive">
              <AlertDescription>{d.message}</AlertDescription>
            </Alert>
          ))}
        <Field>
          <FieldLabel htmlFor="automation-name">Name</FieldLabel>
          <Input
            id="automation-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="editor">Editor</TabsTrigger>
            <TabsTrigger value="simulation">Simulation</TabsTrigger>
            <TabsTrigger value="execution">Execution</TabsTrigger>
          </TabsList>
          <TabsContent value="editor">
            {graph.nodes.length === 0 && (
              <Button
                variant="outline"
                className="mb-4"
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
              registry={(registry.data?.data ?? []).map((type) => type.type === "action.command.v1" ? { ...type, label: "Set Device State" } : type)}
              diagnostics={diagnostics}
              onChange={change}
              onLayoutChange={setLayout}
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
          </TabsContent>
          <TabsContent value="simulation" forceMount className="flex flex-col gap-4 data-[state=inactive]:hidden">
            {saved && <Scenarios org={org} workflowId={saved.uuid} graph={graph} revision={saved.draft_revision} workflowDirty={dirty} />}
            <Card>
              <CardHeader>
                <CardTitle>Simulate saved revision</CardTitle>
                <CardDescription>
                  Supply one reading per source, then advance through the
                  configured windows. No live actions are sent.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  {graph.bindings
                    .filter((b) =>
                      graph.nodes.some(
                        (n) =>
                          n.type === "source.parameter.v1" &&
                          n.config.binding === b.role,
                      ),
                    )
                    .map((b) => (
                      <Field key={b.role}>
                        <FieldLabel htmlFor={`sample-${b.role}`}>
                          {b.role} ({b.unit || b.data_type})
                        </FieldLabel>
                        <Input
                          id={`sample-${b.role}`}
                          value={sampleValues[b.role] ?? "0"}
                          onChange={(e) =>
                            setSampleValues((v) => ({
                              ...v,
                              [b.role]: e.target.value,
                            }))
                          }
                        />
                      </Field>
                    ))}
                  <Button
                    disabled={!saved || dirty || busy}
                    onClick={() => void run(simulate)}
                  >
                    Run simulation
                  </Button>
                  {dirty && (
                    <p className="text-sm text-muted-foreground">
                      Save the graph before simulating.
                    </p>
                  )}
                  {simulation && (
                    <>
                      <Badge variant="outline">
                        Simulated revision {simulation.draft_revision}
                      </Badge>
                      {simulation.steps
                        .flatMap((s) => s.intents)
                        .map((a, i) => (
                          <p key={i}>
                            {a.node_id}: {a.kind} · {a.trigger}
                          </p>
                        ))}
                      <details>
                        <summary>Node input and output trace</summary>
                        <pre className="max-h-96 overflow-auto text-xs">
                          {JSON.stringify(simulation.steps, null, 2)}
                        </pre>
                      </details>
                    </>
                  )}
                </FieldGroup>
              </CardContent>
            </Card>
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
            <ExecutionTimeline key={saved?.uuid ?? "unsaved"} org={org} workflowId={saved?.uuid} registry={registry.data?.data ?? []} evidenceTarget={evidenceTarget} renderAssistant={evaluation => <WorkflowAssistant key={evaluation.id} org={org} editorId={id} workflowId={saved?.uuid} name={name} graph={graph} revision={saved?.draft_revision} registry={registry.data?.data ?? []} disabled={busy || !saved} onApply={change} execution={evaluation} onEvidence={showEvidence} />} />
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
      </div>
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
