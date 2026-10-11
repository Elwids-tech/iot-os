import { Scenarios } from "./Scenarios";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { OctagonXIcon, PlusIcon, Redo2Icon, SparklesIcon, Undo2Icon } from "lucide-react";
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
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@iot-os/ui/components/alert-dialog";
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
import { StatusMark } from "@iot-os/ui/components/status-mark";
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
import { commandGrants } from "./device-state";
import { activationUnavailableReason } from "./activation";
import { WorkflowAssistant } from "./WorkflowAssistant";
import { usePanel } from "../panel/context";
import type { ExecutionSelection } from "./execution-evidence";
import { ExecutionTimeline } from "./ExecutionTimeline";
import { SimulationPanel } from "./SimulationPanel";
import { defaultSamples, nodeOutcomes, simulationSteps, type SimResult } from "./simulation";
import {
  deploymentState,
  lastActivity,
  relativeTime,
  triggerSummary,
  type DirectorySummary,
} from "./directory";
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
      api.automation<Page<Saved & DirectorySummary>>(
        org,
        `/dag?${new URLSearchParams({ search, page: String(page) })}`,
      ),
  });
  async function change(values: Partial<Settings>) {
    if (!settings.data) return false;
    setBusy(true);
    setError(undefined);
    try {
      await api.automation(org, "/dag/settings", "PUT", {
        ...settings.data.data,
        ...values,
      });
      await cache.invalidateQueries({ queryKey: ["automation-settings", org] });
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const enabled = settings.data?.data.enabled;
  const stopped = settings.data?.data.stopped;
  return (
    <>
      <PageHeader
        title="Automations"
        meta={
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" tabIndex={0}>
                Preview
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              Device automation is an opt-in preview for this organization.
              Behaviour and limits may change; test with simulator devices
              before controlling real equipment.
            </TooltipContent>
          </Tooltip>
        }
        actions={
          enabled && (
            <Button size="sm" asChild>
              <Link to={url(org, "new")}>
                <PlusIcon data-icon="inline-start" />
                Create automation
              </Link>
            </Button>
          )
        }
      >
        <Input
          aria-label="Search automations"
          placeholder="Search automations…"
          className="h-8 max-w-sm"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </PageHeader>
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <RequestError error={error ?? settings.error ?? list.error} />
        {settings.data && !enabled && (
          <Card>
            <CardHeader>
              <CardTitle>Device automations</CardTitle>
              <CardDescription>
                Build rules from telemetry, correlate devices, and review
                actions before activation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button disabled={busy} onClick={() => void change({ enabled: true })}>
                Enable automation preview
              </Button>
            </CardContent>
          </Card>
        )}
        {stopped && (
          <Alert variant="destructive">
            <OctagonXIcon />
            <AlertTitle>Automation actions are stopped</AlertTitle>
            <AlertDescription>
              No automation in this organization can send alerts, events or
              device commands until you resume. Already dispatched commands may
              still reach devices.
            </AlertDescription>
            <AlertAction>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void change({ stopped: false })}>
                Resume
              </Button>
            </AlertAction>
          </Alert>
        )}
        {list.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : list.data?.data.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Automation</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last activity</TableHead>
                <TableHead>Last issue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.data.map((w) => {
                const state = deploymentState(w.deployment_status);
                const activity = lastActivity(w);
                const triggers = triggerSummary(w.triggers);
                const live = w.last_deployment?.target === "active" && w.last_deployment.status === "succeeded" ? w.last_deployment.draft_revision : undefined;
                return (
                  <TableRow key={w.uuid}>
                    <TableCell className="max-w-64">
                      <Link className="font-medium hover:underline" to={url(org, w.uuid)}>
                        {w.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        Draft revision {w.draft_revision}
                        {live !== undefined && live !== w.draft_revision && ` · live revision ${live}`}
                      </p>
                    </TableCell>
                    <TableCell className="max-w-72 whitespace-normal">
                      {triggers || <span className="text-muted-foreground">No device inputs</span>}
                    </TableCell>
                    <TableCell>
                      <StatusMark tone={state.tone}>{state.label}</StatusMark>
                    </TableCell>
                    <TableCell>
                      {activity ? (
                        <>
                          <p>{activity.label}</p>
                          <time className="text-xs text-muted-foreground" dateTime={activity.at} title={new Date(activity.at).toLocaleString()}>
                            {relativeTime(activity.at)}
                          </time>
                        </>
                      ) : (
                        <span className="text-muted-foreground">None yet</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-72 whitespace-normal">
                      {w.last_issue ? (
                        <>
                          <p className="text-destructive">{w.last_issue.message}</p>
                          {w.last_issue.at && (
                            <time className="text-xs text-muted-foreground" dateTime={w.last_issue.at} title={new Date(w.last_issue.at).toLocaleString()}>
                              {w.last_issue.source === "action" ? "Action" : "Deployment"} · {relativeTime(w.last_issue.at)}
                            </time>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">None</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">
            {search
              ? "No automations match this search."
              : "No automations yet. Create a workflow to begin."}
          </p>
        )}
        {list.data && list.data.meta.last_page > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {list.data.meta.last_page}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= list.data.meta.last_page}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        )}
        {enabled && (
          <EmergencyStop
            stopped={Boolean(stopped)}
            busy={busy}
            onChange={(next) => change({ stopped: next })}
          />
        )}
      </div>
    </>
  );
}

/** Organization-wide stop, kept apart from everyday actions and confirmed before it applies. */
function EmergencyStop({
  stopped,
  busy,
  onChange,
}: {
  stopped: boolean;
  busy: boolean;
  onChange: (stopped: boolean) => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <section
      aria-labelledby="automation-emergency-stop"
      className="mt-6 flex flex-col gap-3 rounded-lg border border-destructive/40 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-1">
        <h2 id="automation-emergency-stop" className="text-sm font-medium">
          Emergency stop
        </h2>
        <p className="text-sm text-muted-foreground">
          {stopped
            ? "Automation actions are stopped. Resuming lets active automations send alerts, events and device commands again."
            : "Stop every automation in this organization from sending alerts, events or device commands until you resume."}
        </p>
      </div>
      {stopped ? (
        <Button variant="outline" disabled={busy} onClick={() => void onChange(false)}>
          Resume automations
        </Button>
      ) : (
        <Button variant="destructive" disabled={busy} onClick={() => setConfirming(true)}>
          <OctagonXIcon data-icon="inline-start" />
          Stop all automation actions…
        </Button>
      )}
      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!busy) setConfirming(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop all automation actions?</AlertDialogTitle>
            <AlertDialogDescription>
              Every automation in this organization stops sending alerts,
              integration events and device commands. Queued actions are
              cancelled now, and new ones are cancelled until you resume.
              Workflows stay deployed and keep evaluating. Commands already
              dispatched may still reach devices.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (await onChange(true)) setConfirming(false);
              }}
            >
              Stop all actions
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
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
      <PageHeader
        title={name}
        back={{ to: url(org), label: "Automations" }}
        helpContext={`automation.${tab}`}
        meta={
          <span className="flex items-center gap-2">
            <StatusMark tone={status.tone}>{status.label}</StatusMark>
            <span>Draft {saved?.draft_revision ?? "unsaved"}</span>
            {(dirty || layoutDirty) && <Badge variant="secondary">Unsaved changes</Badge>}
          </span>
        }
      >
        <div className="flex w-full flex-wrap items-center gap-2">
          <div role="group" aria-label="Undo and redo" className="flex items-center">
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
          <div className="ml-auto flex flex-wrap items-center gap-2">
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
          </div>
        </div>
      </PageHeader>
      <div className="flex flex-col gap-4 p-4 md:p-6">
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
