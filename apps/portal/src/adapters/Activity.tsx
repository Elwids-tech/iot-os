import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  AdapterDelivery,
  AdapterFixture,
  AdapterOutcome,
  DeviceAdapter,
  PollRun,
} from "@iot-os/api-client";
import { Button } from "@iot-os/ui/components/button";
import { DataTable, type DataColumn } from "@iot-os/ui/components/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog";
import { FieldGroup } from "@iot-os/ui/components/field";
import { RelativeTime } from "@iot-os/ui/components/freshness";
import {
  Panel,
  PanelActions,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from "@iot-os/ui/components/panel";
import { Status, StatusMark } from "@iot-os/ui/components/status-mark";
import { formatDateTime } from "@iot-os/ui/lib/format";
import { statusOf } from "@iot-os/ui/lib/status";
import { PropertyList } from "@iot-os/ui/templates/entity-page";
import { PlayIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { api } from "../lib/api";
import { RequestError } from "../components/forms";
import { formatSize } from "./Samples";
import { CursorStartField, cursorStartError } from "./sources/PollSource";
import { localInput } from "./source";

const outcomeOrder: AdapterOutcome[] = [
  "accepted",
  "decoded",
  "duplicate",
  "historical",
  "unauthenticated",
  "stale_signature",
  "too_large",
  "rate_limited",
  "paused",
  "broker_unavailable",
  "bad_request",
  "decode_failed",
  "validation_failed",
];

/** What the source did lately: outcomes, rejected and failed deliveries, poll runs and the cursor (FR-070–FR-073). */
export function Activity({
  org,
  adapter,
  canReset,
  onAddFixture,
}: {
  org: string;
  adapter: DeviceAdapter;
  canReset: boolean;
  onAddFixture: (fixture: AdapterFixture) => void;
}) {
  const webhook = adapter.source.type === "webhook";
  const poll = adapter.source.type === "poll";
  const detail = useQuery({
    queryKey: ["adapter-webhook", org, adapter.uuid],
    queryFn: () => api.adapterWebhook(org, adapter.uuid),
    enabled: webhook,
    refetchInterval: 10000,
  });
  const deliveries = useQuery({
    queryKey: ["adapter-deliveries", org, adapter.uuid, "all"],
    queryFn: () => api.adapterDeliveries(org, adapter.uuid),
    refetchInterval: 10000,
  });
  const runs = useQuery({
    queryKey: ["adapter-poll-runs", org, adapter.uuid],
    queryFn: () => api.adapterPollRuns(org, adapter.uuid),
    enabled: poll,
    refetchInterval: 10000,
  });
  const problems = useMemo(
    () => deliveries.data?.filter((d) => d.kind !== "sample"),
    [deliveries.data],
  );
  const state = adapter.source_state;
  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader>
          <PanelTitle>Source</PanelTitle>
          <PanelActions>
            {state && (
              <StatusMark tone={statusOf(state.state, "source").tone}>
                {state.label || statusOf(state.state, "source").label}
              </StatusMark>
            )}
          </PanelActions>
        </PanelHeader>
        <PanelContent className="flex flex-col gap-4">
          {state?.detail && <p className="text-body text-muted-foreground">{state.detail}</p>}
          {webhook && (
            <OutcomeTiles
              counts={detail.data?.counts}
              loading={detail.isPending}
              error={detail.error}
            />
          )}
          {poll && (
            <Polling
              org={org}
              adapter={adapter}
              runs={runs.data?.data}
              polling={runs.data?.polling ?? adapter.polling}
              canReset={canReset}
            />
          )}
          {!webhook && !poll && (
            <p className="text-body text-muted-foreground">
              MQTT sources report their broker connection in the status bar above.
              Failed decodes are listed below.
            </p>
          )}
        </PanelContent>
      </Panel>
      {poll && <Runs runs={runs.data?.data} error={runs.error} />}
      <Problems
        rows={problems}
        error={deliveries.error}
        webhook={webhook}
        onAddFixture={onAddFixture}
      />
    </div>
  );
}

function OutcomeTiles({
  counts,
  loading,
  error,
}: {
  counts: Partial<Record<"24h" | "7d", Partial<Record<AdapterOutcome, number>>>> | undefined;
  loading: boolean;
  error: unknown;
}) {
  if (error) return <RequestError error={error} />;
  if (loading) return <p className="text-meta text-muted-foreground">Loading outcomes…</p>;
  const day = counts?.["24h"] ?? {};
  const week = counts?.["7d"] ?? {};
  const shown = outcomeOrder.filter((o) => o === "accepted" || day[o] || week[o]);
  return (
    <section aria-labelledby="adapter-outcomes-title" className="flex flex-col gap-2">
      <h3 id="adapter-outcomes-title" className="text-heading">
        Deliveries by outcome
      </h3>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {shown.map((outcome) => {
          const status = statusOf(outcome, "ingest");
          return (
            <li key={outcome} className="flex flex-col gap-1 rounded-lg bg-sunken p-3">
              <StatusMark tone={status.tone} className="text-meta text-muted-foreground">
                {status.label}
              </StatusMark>
              <span className="text-title tabular-nums">
                {(day[outcome] ?? 0).toLocaleString()}
                <span className="sr-only"> in the last 24 hours</span>
              </span>
              <span className="text-meta text-muted-foreground tabular-nums">
                last 24 h · {(week[outcome] ?? 0).toLocaleString()} in 7 days
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Polling({
  org,
  adapter,
  runs,
  polling,
  canReset,
}: {
  org: string;
  adapter: DeviceAdapter;
  runs: PollRun[] | undefined;
  polling: DeviceAdapter["polling"];
  canReset: boolean;
}) {
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const request = useRef(crypto.randomUUID());
  const deployed = !!adapter.applied_revision_uuid && polling?.state !== "not_deployed";
  const refresh = () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: ["adapter", org, adapter.uuid] }),
      cache.invalidateQueries({ queryKey: ["adapter-poll-runs", org, adapter.uuid] }),
    ]);
  async function reset() {
    setBusy(true);
    setError(null);
    try {
      await api.resetAdapterCursor(org, adapter.uuid, {
        request_uuid: request.current,
        start_at: new Date(start).toISOString(),
      });
      setOpen(false);
      toast.success(`Cursor reset requested. Polling resumes from ${formatDateTime(new Date(start).toISOString())}.`);
      await refresh();
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  async function resume() {
    setBusy(true);
    setError(null);
    try {
      await api.resumeAdapterPolling(org, adapter.uuid, { request_uuid: crypto.randomUUID() });
      toast.success("Resume requested. Polling restarts from the committed cursor.");
      await refresh();
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  const totals = (runs ?? []).reduce(
    (sum, run) => ({
      records: sum.records + run.records,
      published: sum.published + run.published,
      failed: sum.failed + run.failed,
      duplicates: sum.duplicates + run.duplicates,
    }),
    { records: 0, published: 0, failed: 0, duplicates: 0 },
  );
  const cursor = polling?.cursor;
  return (
    <div className="flex flex-col gap-4">
      <PropertyList
        items={[
          ...(polling?.reason ? [{ label: "Reason", value: polling.reason }] : []),
          {
            label: "Committed cursor",
            value: cursor?.value ? (
              <span className="flex flex-wrap items-baseline gap-x-2">
                <code className="break-all text-code">{cursor.value}</code>
                {cursor.committed_at && (
                  <span className="text-meta text-muted-foreground">
                    committed <RelativeTime at={cursor.committed_at} />
                  </span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">
                {deployed ? "None committed yet" : "Chosen at the first deployment"}
              </span>
            ),
          },
          {
            label: "Last run",
            value: <RelativeTime at={polling?.last_run_at} />,
          },
          {
            label: "Next run",
            value: polling?.next_run_at ? (
              <time dateTime={polling.next_run_at}>{formatDateTime(polling.next_run_at)}</time>
            ) : (
              <span className="text-muted-foreground">Not scheduled</span>
            ),
          },
        ]}
      />
      {runs && runs.length > 0 && (
        <section aria-labelledby="adapter-run-totals-title" className="flex flex-col gap-2">
          <h3 id="adapter-run-totals-title" className="text-heading">
            Last {runs.length} runs
          </h3>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ["Records", totals.records],
                ["Published", totals.published],
                ["Failed", totals.failed],
                ["Duplicates", totals.duplicates],
              ] as const
            ).map(([label, value]) => (
              <li key={label} className="flex flex-col gap-1 rounded-lg bg-sunken p-3">
                <span className="text-meta text-muted-foreground">{label}</span>
                <span className="text-title tabular-nums">{value.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <RequestError error={!open ? error : null} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!canReset || !deployed || busy}
          onClick={() => {
            request.current = crypto.randomUUID();
            setStart(localInput(Date.now() - 3_600_000));
            setError(null);
            setOpen(true);
          }}
        >
          <RotateCcwIcon data-icon="inline-start" />
          Reset cursor
        </Button>
        {polling?.state === "stopped" && (
          <Button size="sm" disabled={!canReset || busy} onClick={() => void resume()}>
            <PlayIcon data-icon="inline-start" />
            Resume polling
          </Button>
        )}
        {!canReset && (
          <span className="text-meta text-muted-foreground">
            Resetting the cursor and resuming need device and connection management.
          </span>
        )}
        {canReset && !deployed && (
          <span className="text-meta text-muted-foreground">
            Deploy the adapter first; the first deployment asks where the cursor starts.
          </span>
        )}
      </div>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !busy) setOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset the polling cursor</DialogTitle>
            <DialogDescription>
              The applied revision is redeployed and the next run reads from this
              time. Records read again are stored once. The reset is recorded in
              the audit log.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <CursorStartField value={start} onChange={setStart} disabled={busy} />
          </FieldGroup>
          <RequestError error={error} />
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !!cursorStartError(start)} onClick={() => void reset()}>
              Reset cursor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const seconds = (run: PollRun) => {
  const ms = Date.parse(run.finished_at ?? "") - Date.parse(run.started_at);
  return Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : "Running";
};

function Runs({ runs, error }: { runs: PollRun[] | undefined; error: unknown }) {
  const columns = useMemo<DataColumn<PollRun>[]>(
    () => [
      {
        id: "started",
        header: "Started",
        mobile: "title",
        sortable: true,
        value: (r) => r.started_at,
        cell: (r) => <RelativeTime at={r.started_at} />,
      },
      {
        id: "outcome",
        header: "Outcome",
        mobile: "badge",
        value: (r) => r.outcome,
        cell: (r) => <Status value={r.outcome} domain="poll_run" />,
      },
      { id: "duration", header: "Duration", value: seconds, cell: seconds },
      {
        id: "http",
        header: "HTTP",
        align: "end",
        value: (r) => r.http_status,
        cell: (r) => r.http_status ?? "—",
      },
      { id: "pages", header: "Pages", align: "end", value: (r) => r.pages, cell: (r) => r.pages },
      { id: "records", header: "Records", align: "end", value: (r) => r.records, cell: (r) => r.records },
      {
        id: "published",
        header: "Published",
        align: "end",
        value: (r) => r.published,
        cell: (r) => r.published,
      },
      { id: "failed", header: "Failed", align: "end", value: (r) => r.failed, cell: (r) => r.failed },
      {
        id: "duplicates",
        header: "Duplicates",
        align: "end",
        value: (r) => r.duplicates,
        cell: (r) => r.duplicates,
      },
      {
        id: "cursor",
        header: "Cursor",
        value: (r) => `${r.cursor_before ?? ""} → ${r.cursor_after ?? ""}`,
        cell: (r) => (
          <code className="text-code break-all">
            {r.cursor_before ?? "start"} → {r.cursor_after ?? "unchanged"}
          </code>
        ),
      },
      {
        id: "error",
        header: "Error",
        value: (r) => r.error,
        cell: (r) =>
          r.error ? (
            <span className="block max-w-xs whitespace-normal text-destructive">
              {r.error}
              {r.next_attempt_at && (
                <span className="block text-meta text-muted-foreground">
                  Next attempt{" "}
                  <time dateTime={r.next_attempt_at}>{formatDateTime(r.next_attempt_at)}</time>
                </span>
              )}
            </span>
          ) : null,
      },
    ],
    [],
  );
  return (
    <section aria-labelledby="adapter-runs-title" className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <h2 id="adapter-runs-title" className="text-heading">
          Poll runs
        </h2>
        <p className="text-meta text-muted-foreground">The last 20 runs, newest first.</p>
      </div>
      <DataTable
        id="adapter-poll-runs"
        label="Poll runs"
        noun={["run", "runs"]}
        rows={runs}
        rowKey={(r) => r.uuid}
        rowLabel={(r) => `Run ${r.run_id}`}
        columns={columns}
        defaultSort={[{ id: "started", desc: true }]}
        refreshSeconds={10}
        error={error ? <RequestError error={error} /> : undefined}
        empty={
          <p className="p-4 text-body text-muted-foreground">
            No runs yet. Runs start after the first deployment.
          </p>
        }
      />
    </section>
  );
}

function Problems({
  rows,
  error,
  webhook,
  onAddFixture,
}: {
  rows: AdapterDelivery[] | undefined;
  error: unknown;
  webhook: boolean;
  onAddFixture: (fixture: AdapterFixture) => void;
}) {
  const columns = useMemo<DataColumn<AdapterDelivery>[]>(
    () => [
      {
        id: "reason",
        header: "Reason",
        mobile: "title",
        value: (d) => statusOf(d.reason, "ingest").label,
        cell: (d) => statusOf(d.reason, "ingest").label,
      },
      {
        id: "kind",
        header: "Kind",
        mobile: "badge",
        value: (d) => d.kind,
        cell: (d) => <Status value={d.kind} domain="ingest" />,
      },
      {
        id: "received",
        header: "Received",
        sortable: true,
        value: (d) => d.received_at,
        cell: (d) => <RelativeTime at={d.received_at} />,
      },
      {
        id: "address",
        header: "Source address",
        value: (d) => d.source_address,
        cell: (d) => <span className="font-mono">{d.source_address ?? "—"}</span>,
      },
      {
        id: "path",
        header: "Path",
        value: (d) => d.path,
        cell: (d) => <span className="font-mono break-all">{d.path || "—"}</span>,
      },
      {
        id: "size",
        header: "Size",
        align: "end",
        value: (d) => d.size,
        cell: (d) => formatSize(d.size),
      },
      {
        id: "error",
        header: "Error",
        value: (d) => d.error,
        cell: (d) =>
          d.error ? (
            <span className="block max-w-xs whitespace-normal text-destructive">{d.error}</span>
          ) : null,
      },
      {
        id: "add",
        header: "Add as fixture",
        headerHidden: true,
        hideable: false,
        align: "end",
        cell: (d) =>
          d.kind === "failed" && d.input ? (
            <Button
              variant="outline"
              size="sm"
              aria-label={`Add failed delivery ${d.path || d.uuid} as fixture`}
              onClick={() => onAddFixture(d.input!)}
            >
              <PlusIcon data-icon="inline-start" />
              Add as fixture
            </Button>
          ) : null,
      },
    ],
    [onAddFixture],
  );
  return (
    <section aria-labelledby="adapter-problems-title" className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <h2 id="adapter-problems-title" className="text-heading">
          {webhook ? "Rejected and failed deliveries" : "Failed inputs"}
        </h2>
        <p className="text-meta text-muted-foreground">
          The last 20 of each, kept for 7 days. Bodies of unauthenticated
          deliveries are never kept.
        </p>
      </div>
      <DataTable
        id="adapter-problem-deliveries"
        label={webhook ? "Rejected and failed deliveries" : "Failed inputs"}
        noun={["delivery", "deliveries"]}
        rows={rows}
        rowKey={(d) => d.uuid}
        rowLabel={(d) => `${statusOf(d.reason, "ingest").label} ${d.path ?? ""}`.trim()}
        columns={columns}
        defaultSort={[{ id: "received", desc: true }]}
        refreshSeconds={10}
        error={error ? <RequestError error={error} /> : undefined}
        empty={
          <p className="p-4 text-body text-muted-foreground">
            Nothing rejected or failed in the last 7 days.
          </p>
        }
      />
    </section>
  );
}
