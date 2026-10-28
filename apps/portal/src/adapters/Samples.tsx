import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  AdapterDelivery,
  AdapterFixture,
  DeviceAdapter,
} from "@iot-os/api-client";
import { Button } from "@iot-os/ui/components/button";
import { DataTable, type DataColumn } from "@iot-os/ui/components/data-table";
import { EmptyState } from "@iot-os/ui/components/empty-state";
import { ValueField } from "@iot-os/ui/components/form-fields";
import { RelativeTime } from "@iot-os/ui/components/freshness";
import { Status } from "@iot-os/ui/components/status-mark";
import { InboxIcon, PlusIcon } from "lucide-react";
import { api } from "../lib/api";
import { RequestError } from "../components/forms";

type SampleRow = {
  key: string;
  kind: "sample" | "failed" | "preview";
  at: string | null;
  what: string;
  detail: string;
  error: string | null;
  fixture: AdapterFixture | null;
};

export const formatSize = (bytes: number | null | undefined) =>
  bytes == null
    ? "—"
    : bytes < 1024
      ? `${bytes} B`
      : bytes < 1024 * 1024
        ? `${(bytes / 1024).toFixed(1)} KiB`
        : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

const deliveryWhat = (d: AdapterDelivery) =>
  d.source === "poll"
    ? "Polled record"
    : d.path || (d.source === "webhook" ? "/" : (d.input?.topic ?? "—"));

function deliveryRow(d: AdapterDelivery): SampleRow {
  return {
    key: d.uuid,
    kind: d.kind === "failed" ? "failed" : "sample",
    at: d.received_at,
    what: deliveryWhat(d),
    detail: [d.content_type, d.size != null ? formatSize(d.size) : null]
      .filter(Boolean)
      .join(" · "),
    error: d.error,
    fixture: d.input,
  };
}

/**
 * Real inputs the adapter captured (samples before deployment, failed decodes and
 * discovered devices' previews), each one click from the draft's fixtures (FR-101).
 */
export function Samples({
  org,
  adapter,
  onAdd,
}: {
  org: string;
  adapter: DeviceAdapter;
  onAdd: (fixture: AdapterFixture) => void;
}) {
  const samples = useQuery({
    queryKey: ["adapter-deliveries", org, adapter.uuid, "sample"],
    queryFn: () => api.adapterDeliveries(org, adapter.uuid, "sample"),
    refetchInterval: 3000,
  });
  const failed = useQuery({
    queryKey: ["adapter-deliveries", org, adapter.uuid, "failed"],
    queryFn: () => api.adapterDeliveries(org, adapter.uuid, "failed"),
    refetchInterval: 3000,
  });
  const candidates = useQuery({
    queryKey: ["adapter-candidates", org, adapter.uuid],
    queryFn: () => api.adapterCandidates(org, adapter.uuid),
    refetchInterval: 3000,
  });
  const loading = samples.isPending && failed.isPending;
  const rows = useMemo<SampleRow[] | undefined>(() => {
    if (loading) return undefined;
    const previews: SampleRow[] = (candidates.data ?? []).map((c) => ({
      key: c.uuid,
      kind: "preview",
      at: c.last_seen_at,
      what: c.source_device_id,
      detail: (c.preview.metrics ?? [])
        .map((m) => `${m.name} ${String(m.value)}${m.unit ? ` ${m.unit}` : ""}`)
        .join(", "),
      error: null,
      fixture: c.input ?? null,
    }));
    return [
      ...(samples.data ?? []).map(deliveryRow),
      ...(failed.data ?? []).map(deliveryRow),
      ...previews,
    ].sort((a, b) => Date.parse(b.at ?? "") - Date.parse(a.at ?? ""));
  }, [candidates.data, failed.data, loading, samples.data]);
  const columns = useMemo<DataColumn<SampleRow>[]>(
    () => [
      {
        id: "what",
        header: "Sample",
        mobile: "title",
        value: (r) => r.what,
        cell: (r) => <span className="font-mono break-all">{r.what}</span>,
      },
      {
        id: "kind",
        header: "Kind",
        mobile: "badge",
        value: (r) => r.kind,
        cell: (r) => <Status value={r.kind} domain="ingest" />,
      },
      {
        id: "at",
        header: "Received",
        value: (r) => r.at,
        cell: (r) => <RelativeTime at={r.at} />,
      },
      {
        id: "detail",
        header: "Details",
        value: (r) => r.detail,
        cell: (r) => (
          <span className="text-muted-foreground">
            {r.detail || "—"}
            {r.fixture?.truncated && " · body truncated"}
          </span>
        ),
      },
      {
        id: "error",
        header: "Error",
        value: (r) => r.error,
        cell: (r) =>
          r.error ? (
            <span className="block max-w-xs whitespace-normal text-destructive">{r.error}</span>
          ) : null,
      },
      {
        id: "add",
        header: "Add as fixture",
        headerHidden: true,
        hideable: false,
        align: "end",
        cell: (r) =>
          r.fixture ? (
            <Button
              variant="outline"
              size="sm"
              aria-label={`Add ${r.what} as fixture`}
              onClick={() => onAdd(r.fixture!)}
            >
              <PlusIcon data-icon="inline-start" />
              Add as fixture
            </Button>
          ) : (
            <span className="text-meta text-muted-foreground">No input kept</span>
          ),
      },
    ],
    [onAdd],
  );
  const type = adapter.source.type;
  const empty =
    type === "webhook" ? (
      <EmptyState
        inset
        icon={<InboxIcon />}
        title="Waiting for the first delivery"
        description="Paste the ingest URL and a secret into the vendor cloud. Deliveries appear here within a few seconds; before deployment they are kept as samples and not decoded."
      >
        {adapter.webhook?.ingest_url && (
          <div className="w-full max-w-form text-left">
            <ValueField label="Ingest URL" value={adapter.webhook.ingest_url} mono copy />
          </div>
        )}
      </EmptyState>
    ) : type === "poll" ? (
      <EmptyState
        inset
        icon={<InboxIcon />}
        title="No captured records yet"
        description="Run Fetch now on the Connection tab and add records from its result, or wait for failed records after deployment."
      />
    ) : (
      <EmptyState
        inset
        icon={<InboxIcon />}
        title="No captured samples yet"
        description="Failed decodes and discovered devices appear here once devices publish to the adapter's topics."
      />
    );
  return (
    <section aria-labelledby="adapter-samples-title" className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <h2 id="adapter-samples-title" className="text-heading">
          Captured samples
        </h2>
        <p className="text-meta text-muted-foreground">
          Real inputs this adapter received. Add one to the sample fixtures with
          the fields the decoder sees, then save the draft.
        </p>
      </div>
      <DataTable
        id="adapter-samples"
        label="Captured samples"
        noun={["sample", "samples"]}
        rows={rows}
        rowKey={(r) => `${r.kind}-${r.key}`}
        rowLabel={(r) => r.what}
        columns={columns}
        refreshSeconds={3}
        error={
          samples.error || failed.error ? (
            <RequestError error={samples.error || failed.error} />
          ) : undefined
        }
        empty={empty}
      />
    </section>
  );
}
