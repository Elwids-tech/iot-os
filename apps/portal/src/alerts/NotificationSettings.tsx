import { statusOf } from "@iot-os/ui/lib/status";
import { useEffect, useRef, useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  ApiError,
  type NotificationSettings as Settings,
  type AutomationWorkflow,
  type WorkflowDeployment,
  type WorkflowDeploymentInput,
  type WorkflowDeploymentStatus,
  type WorkflowKind,
  type WorkflowListItem,
} from "@iot-os/api-client";
import { Button } from "@iot-os/ui/components/button";
import { FieldDescription } from "@iot-os/ui/components/field";
import { DataTable, RowLink, type DataColumn } from "@iot-os/ui/components/data-table";
import { EmptyState } from "@iot-os/ui/components/empty-state";
import { SwitchField } from "@iot-os/ui/components/form-fields";
import { PageHeader } from "@iot-os/ui/components/page-header";
import { SearchableSelect } from "@iot-os/ui/components/searchable-select";
import { Skeleton } from "@iot-os/ui/components/skeleton";
import { keepToastsAbove } from "@iot-os/ui/components/sonner";
import { Panel, PanelActions, PanelContent, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel";
import { Status, StatusMark } from "@iot-os/ui/components/status-mark";
import { CollectionPage } from "@iot-os/ui/templates/collection-page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table";
import { api } from "../lib/api";
import { useUnsavedContribution } from "../lib/unsaved";
import { Confirm, RequestError } from "../components/forms";
import { useDeviceOrganization } from "../devices/shared";

/** Settings → Notifications and its per-workflow pages. */
export const notificationsPath = (org: string) => `/organizations/${org}/settings/notifications`;

const kindLabels: Record<WorkflowKind, string> = { automation: "Automation", geofence: "Geofence" };

/** Settings → Notifications: every workflow, DAG automations and geofences, with its email state. Each workflow opens its own page. */
export function NotificationsList() {
  const { org, capabilities, query: organization } = useDeviceOrganization();
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["notification-workflows", org, page],
    queryFn: () => api.notificationWorkflows(org, page),
    enabled: capabilities.manage,
    placeholderData: keepPreviousData,
  });
  const rows = query.data?.data ?? [];
  // ponytail: one settings request per listed workflow (25 per page); move email state into the workflow list API if pages grow.
  const settings = useQueries({
    queries: rows.map((workflow) => ({
      queryKey: ["workflow-notifications", org, workflow.uuid],
      queryFn: () => api.workflowNotifications(org, workflow.uuid),
    })),
  });
  const email = new Map(rows.map((workflow, index) => [workflow.uuid, settings[index]?.data]));
  const denied = !organization.isPending && !capabilities.manage;
  const base = notificationsPath(org);
  const columns: DataColumn<WorkflowListItem>[] = [
    {
      id: "workflow",
      header: "Workflow",
      mobile: "title",
      value: (workflow) => workflow.name,
      cell: (workflow) => <RowLink to={`${base}/${workflow.uuid}`}>{workflow.name}</RowLink>,
    },
    {
      id: "kind",
      header: "Kind",
      value: (workflow) => kindLabels[workflow.kind],
      cell: (workflow) => kindLabels[workflow.kind],
    },
    {
      id: "state",
      header: "State",
      mobile: "badge",
      value: (workflow) => workflow.deployment_status,
      cell: (workflow) => <Status value={workflow.deployment_status} domain="automation" />,
    },
    {
      id: "email",
      header: "Email",
      value: (workflow) => (email.get(workflow.uuid)?.enabled ? "On" : "Off"),
      cell: (workflow) => {
        const value = email.get(workflow.uuid);
        return value ? (
          <StatusMark tone={value.enabled ? "good" : "muted"}>{value.enabled ? "On" : "Off"}</StatusMark>
        ) : null;
      },
    },
    {
      id: "recipients",
      header: "Recipients",
      align: "end",
      value: (workflow) => email.get(workflow.uuid)?.recipient_ids.length,
      cell: (workflow) => <span className="tabular-nums">{email.get(workflow.uuid)?.recipient_ids.length}</span>,
    },
    {
      id: "clear",
      header: "On clear",
      value: (workflow) => {
        const value = email.get(workflow.uuid);
        return value && (value.notify_on_clear ? "Email" : "No email");
      },
      cell: (workflow) => {
        const value = email.get(workflow.uuid);
        return value ? (
          <span className="text-muted-foreground">{value.notify_on_clear ? "Email" : "No email"}</span>
        ) : null;
      },
    },
  ];
  return (
    <CollectionPage
      embedded
      title="Notifications"
      helpContext="alerts.notifications"
      description="Who is emailed when each workflow raises or clears an alert."
    >
      {denied ? (
        <EmptyState
          title="Settings unavailable"
          description="You need device management access in this organization."
        />
      ) : (
        <DataTable
          id="notification-workflows"
          label="Workflows"
          noun={["workflow", "workflows"]}
          rows={organization.isPending ? undefined : query.data?.data}
          rowKey={(workflow) => workflow.uuid}
          rowLabel={(workflow) => workflow.name}
          rowHref={(workflow) => `${base}/${workflow.uuid}`}
          columns={columns}
          error={
            organization.error || query.error ? (
              <RequestError error={organization.error ?? query.error} />
            ) : undefined
          }
          pagination={{
            page,
            pageSize: 25,
            total: query.data?.meta.total ?? 0,
            pageCount: query.data?.meta.last_page,
            onPageChange: setPage,
          }}
          empty={
            <EmptyState
              inset
              title="No workflows yet"
              description="Create an automation before configuring its notifications."
            />
          }
        />
      )}
    </CollectionPage>
  );
}

/** One workflow's notifications on its own page, opened from Settings → Notifications. */
export function WorkflowNotificationsPage() {
  const { org } = useDeviceOrganization();
  const { workflowUuid = "" } = useParams();
  return <WorkflowSettings key={`${org}:${workflowUuid}`} workflow={workflowUuid} back={notificationsPath(org)} />;
}

function WorkflowSettings({
  workflow,
  back,
}: {
  workflow: string;
  back: string;
}) {
  const { org, capabilities, query: organization } = useDeviceOrganization();
  const query = useQuery({
    queryKey: ["workflow-notifications", org, workflow],
    queryFn: () => api.workflowNotifications(org, workflow),
    enabled: capabilities.manage,
  });
  const episodes = new URLSearchParams({ workflow, per_page: "1" }).toString();
  const count = useQuery({
    queryKey: ["alerts", org, "count", episodes],
    queryFn: () => api.alerts(org, episodes),
    enabled: capabilities.view,
  });
  const name = query.data?.workflow_name ?? "Workflow";
  const total = count.data?.meta.total;
  const body = (
    <div className="flex min-w-0 flex-col gap-(--panel-gap)">
      <RequestError error={organization.error ?? query.error} />
      {!organization.isPending && !capabilities.manage ? (
        <EmptyState
          title="Settings unavailable"
          description="You need device management access in this organization."
        />
      ) : query.data ? (
        <>
          {query.data.workflow_kind === "automation" ? (
            <AutomationState org={org} uuid={workflow} />
          ) : (
            <WorkflowState org={org} uuid={workflow} name={name} />
          )}
          <SettingsForm org={org} workflow={workflow} initial={query.data} />
        </>
      ) : query.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : null}
    </div>
  );
  return (
    <>
      <PageHeader
        title={name}
        back={{ to: back, label: "Notifications" }}
        actions={
          total !== undefined && (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/organizations/${org}/alerts?condition=all&workflow=${encodeURIComponent(workflow)}`}>
                {total} {total === 1 ? "alert" : "alerts"}
              </Link>
            </Button>
          )
        }
      />
      <section aria-label="Workflow notifications" className="min-w-0 max-w-form p-4 md:p-6">
        {body}
      </section>
    </>
  );
}

/** A DAG automation's state. It is activated and disabled in its editor, which also grants its device commands. */
function AutomationState({ org, uuid }: { org: string; uuid: string }) {
  const workflow = useQuery({
    queryKey: ["workflow", org, uuid],
    queryFn: () => api.workflow(org, uuid),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  if (workflow.isPending) return <Skeleton className="h-16 w-full" />;
  if (!workflow.data) return <RequestError error={workflow.error} />;
  const { tone, label } = statusOf(workflow.data.deployment_status, "automation");
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Automation</PanelTitle>
      </PanelHeader>
      <PanelContent>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-body">
          <StatusMark tone={tone}>{label}</StatusMark>
          <span className="text-muted-foreground">
            Draft revision {workflow.data.draft_revision}
          </span>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <span className="text-meta text-muted-foreground">Activate or disable it in the editor</span>
            <Button variant="outline" asChild>
              <Link to={`/organizations/${org}/automation/${uuid}`}>Open automation</Link>
            </Button>
          </div>
        </div>
      </PanelContent>
    </Panel>
  );
}

/** Activate and disable (A1) through the deployments endpoint, polling the operation until it settles. */
function WorkflowState({
  org,
  uuid,
  name,
}: {
  org: string;
  uuid: string;
  name: string;
}) {
  const { capabilities } = useDeviceOrganization();
  const cache = useQueryClient();
  const key = ["workflow", org, uuid];
  // Others can deploy too, so the state that enables Activate and Disable is refetched on refocus.
  const workflow = useQuery({
    queryKey: key,
    queryFn: () => api.workflow(org, uuid),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  // A request without a server answer (lost response, 5xx) is kept verbatim, whatever refetches
  // happen meanwhile; the next attempt resolves that operation before sending anything new.
  const unresolved = useRef<WorkflowDeploymentInput | null>(null);
  // Our operation until it settles; after that, polling follows the workflow's pending operation.
  const [mine, setMine] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<WorkflowDeployment | null>(null);
  const [confirm, setConfirm] = useState<"active" | "inactive" | null>(null);
  const data = workflow.data;
  const polled = mine ?? data?.pending_operation_uuid ?? null;
  const deployment = useQuery({
    queryKey: ["workflow-deployment", org, uuid, polled],
    queryFn: () => api.workflowDeployment(org, uuid, polled!),
    enabled: Boolean(polled),
    refetchInterval: (item) =>
      item.state.data?.deployment.status === "pending" ? 1000 : false,
  });
  useEffect(() => {
    const result = deployment.data;
    if (!result) return;
    cache.setQueryData(key, result.data);
    if (result.deployment.status === "pending") return;
    void cache.invalidateQueries({ queryKey: ["notification-workflows", org] });
    if (result.deployment.uuid === mine) {
      setOutcome(result.deployment);
      setMine(null);
    } else setOutcome(null);
  }, [deployment.data]);
  function track(result: {
    data: AutomationWorkflow;
    deployment: WorkflowDeployment;
  }) {
    cache.setQueryData(key, result.data);
    cache.setQueryData(
      ["workflow-deployment", org, uuid, result.deployment.uuid],
      result,
    );
    if (result.deployment.status === "pending") setMine(result.deployment.uuid);
    else {
      setOutcome(result.deployment);
      setMine(null);
      void cache.invalidateQueries({ queryKey: ["notification-workflows", org] });
    }
  }
  async function deploy(target: "active" | "inactive") {
    if (!data) return;
    setOutcome(null);
    let input = unresolved.current;
    if (input) {
      try {
        const earlier = await api.workflowDeployment(
          org,
          uuid,
          input.operation_uuid,
        );
        unresolved.current = null;
        track(earlier);
        if (earlier.deployment.target === target) return;
        throw new Error(
          "An earlier request reached the runtime. Review the workflow state before trying again.",
        );
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error;
        // Never recorded: resend the identical request if it asked for the same state.
        if (input.target_state !== target) input = null;
      }
    }
    input ??= {
      operation_uuid: crypto.randomUUID(),
      target_state: target,
      draft_revision: data.draft_revision,
      expected_generation: data.deployment_generation,
    };
    unresolved.current = input;
    try {
      const result = await api.deployWorkflow(org, uuid, input);
      unresolved.current = null;
      track(result);
    } catch (error) {
      // A 4xx is a definite answer; only a lost or failed response stays unresolved.
      if (error instanceof ApiError && error.status < 500)
        unresolved.current = null;
      throw error;
    }
  }
  if (workflow.isPending) return <Skeleton className="h-16 w-full" />;
  if (!data) return <RequestError error={workflow.error} />;
  const pending =
    Boolean(data.pending_operation_uuid) ||
    deployment.data?.deployment.status === "pending";
  const canActivate = data.deployment_status !== "applied";
  const canDisable = data.applied_deployment_uuid !== null;
  const why = !capabilities.activate
    ? "Needs device activation access"
    : pending
      ? "Waiting for the runtime"
      : !canDisable
        ? "Not running"
        : !canActivate
          ? "Already active"
          : null;
  const { tone, label } = statusOf(data.deployment_status, "automation");
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Workflow</PanelTitle>
      </PanelHeader>
      <PanelContent className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-body">
        <StatusMark tone={tone}>{label}</StatusMark>
        <span className="text-muted-foreground">
          Draft revision {data.draft_revision}
        </span>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {why && <span className="text-meta text-muted-foreground">{why}</span>}
          <Button
            variant="outline"
            disabled={!capabilities.activate || pending || !canDisable}
            onClick={() => setConfirm("inactive")}
          >
            Disable workflow
          </Button>
          <Button
            variant="outline"
            disabled={!capabilities.activate || pending || !canActivate}
            onClick={() => setConfirm("active")}
          >
            Activate
          </Button>
        </div>
      </div>
      {pending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Waiting for the runtime to confirm…
        </p>
      ) : outcome?.status === "succeeded" ? (
        <p role="status" className="text-sm">
          {outcome.target === "active" ? "Workflow activated." : "Workflow disabled."}
        </p>
      ) : outcome?.status === "failed" ? (
        <RequestError
          error={new Error(outcome.diagnostic ?? "The runtime rejected the deployment.")}
        />
      ) : null}
      <RequestError error={workflow.error ?? deployment.error} />
      <Confirm
        open={confirm === "inactive"}
        title={`Disable ${name}?`}
        description="The workflow stops evaluating. Open episodes keep their last condition, and no new episodes or emails are created."
        action="Disable workflow"
        onClose={() => setConfirm(null)}
        onConfirm={() => deploy("inactive")}
        onRefresh={() => workflow.refetch()}
      />
      <Confirm
        open={confirm === "active"}
        title={`Activate ${name}?`}
        description={`Deploys draft revision ${data.draft_revision}. Evaluation starts with the next reading.`}
        action="Activate"
        destructive={false}
        onClose={() => setConfirm(null)}
        onConfirm={() => deploy("active")}
        onRefresh={() => workflow.refetch()}
      />
      </PanelContent>
    </Panel>
  );
}

function SettingsForm({
  org,
  workflow,
  initial,
}: {
  org: string;
  workflow: string;
  initial: Settings;
}) {
  const cache = useQueryClient();
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [discard, setDiscard] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useUnsavedContribution(dirty);
  const recipients = useQuery({
    queryKey: ["notification-recipients", org, workflow, search, page],
    queryFn: () => api.notificationRecipients(org, workflow, search, page),
  });
  const save = useMutation({
    mutationFn: () => api.saveWorkflowNotifications(org, workflow, draft),
    onSuccess: (value) => {
      setBaseline(value);
      setDraft(value);
      setSaved(true);
      cache.setQueryData(["workflow-notifications", org, workflow], value);
    },
  });
  const change = (value: Settings) => {
    setDraft(value);
    setSaved(false);
  };
  const needsRecipient = draft.enabled && !draft.recipient_ids.length;
  return (
    <form
      className="flex flex-col gap-(--panel-gap)"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <Panel>
        <PanelHeader>
          <PanelTitle>Email</PanelTitle>
        </PanelHeader>
        <PanelContent className="flex flex-col gap-4">
        <SwitchField
          id="email-enabled"
          label="Enable email notifications"
          checked={draft.enabled}
          disabled={save.isPending}
          onCheckedChange={(enabled) => change({ ...draft, enabled })}
        />
        <SwitchField
          id="email-recovery"
          label="Email when the condition clears"
          checked={draft.notify_on_clear}
          disabled={save.isPending}
          onCheckedChange={(notify_on_clear) =>
            change({ ...draft, notify_on_clear })
          }
        />
        <FieldDescription>
          Applies to future transitions. Existing episodes are not emailed
          again.
        </FieldDescription>
        </PanelContent>
      </Panel>
      <Panel>
        <PanelHeader>
          <PanelTitle>Recipients</PanelTitle>
          <PanelActions>
            <span className="text-meta text-muted-foreground tabular-nums">
              {draft.recipient_ids.length} of 20
            </span>
          </PanelActions>
        </PanelHeader>
        <PanelContent className="flex flex-col gap-4">
        <SearchableSelect
          label="Add recipient"
          value=""
          placeholder="Choose a member"
          options={(recipients.data?.data ?? [])
            .filter((item) => !draft.recipient_ids.includes(item.id))
            .map((item) => ({
              value: String(item.id),
              label: `${item.name} · ${item.email}`,
            }))}
          search={search}
          onSearchChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          page={page}
          onPageChange={setPage}
          hasNextPage={page < (recipients.data?.meta.last_page ?? 1)}
          loading={recipients.isFetching}
          disabled={save.isPending || draft.recipient_ids.length >= 20}
          help={
            draft.recipient_ids.length >= 20
              ? "The limit of 20 recipients is reached."
              : "Verified members with device viewing access."
          }
          onChange={(value) => {
            const member = recipients.data?.data.find(
              (item) => item.id === Number(value),
            );
            if (member)
              change({
                ...draft,
                recipient_ids: [...draft.recipient_ids, member.id],
                recipients: [...draft.recipients, member],
              });
          }}
        />
        <RequestError error={recipients.error} />
        {draft.recipient_ids.length ? (
          <Table aria-label="Selected recipients">
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>
                  <span className="sr-only">Action</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {draft.recipient_ids.map((id) => {
                const name =
                  draft.recipients.find((item) => item.id === id)?.name ??
                  `Unavailable member (${id})`;
                return (
                  <TableRow key={id}>
                    <TableCell className="whitespace-normal break-words">
                      {name}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={save.isPending}
                        aria-label={`Remove ${name}`}
                        onClick={() =>
                          change({
                            ...draft,
                            recipient_ids: draft.recipient_ids.filter(
                              (value) => value !== id,
                            ),
                            recipients: draft.recipients.filter(
                              (item) => item.id !== id,
                            ),
                          })
                        }
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <p className="text-body text-muted-foreground">No recipients selected.</p>
        )}
        </PanelContent>
      </Panel>
      <RequestError error={save.error} />
      <div ref={keepToastsAbove} className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t bg-background px-4 py-3 md:-mx-6 md:px-6">
        <span role="status" className="mr-auto text-body text-muted-foreground">
          {save.isPending
            ? "Saving…"
            : dirty
              ? needsRecipient
                ? "Add at least one recipient to turn email on"
                : "Unsaved changes"
              : saved
                ? "Notification settings saved."
                : "No unsaved changes"}
        </span>
        {save.error instanceof ApiError && save.error.status === 409 ? (
          <Button type="button" variant="outline" onClick={() => setDiscard(true)}>
            Reload saved settings
          </Button>
        ) : null}
        <Button disabled={save.isPending || !dirty || needsRecipient}>
          {save.isPending ? "Saving…" : "Save notification settings"}
        </Button>
      </div>
      <Confirm
        open={discard}
        title="Reload saved settings?"
        description="This replaces your unsaved preferences with the latest saved settings."
        action="Reload settings"
        destructive={false}
        onClose={() => setDiscard(false)}
        onConfirm={async () => {
          const value = await api.workflowNotifications(org, workflow);
          setBaseline(value);
          setDraft(value);
          save.reset();
          setSaved(false);
          cache.setQueryData(["workflow-notifications", org, workflow], value);
        }}
      />
    </form>
  );
}
