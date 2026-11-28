import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdapterActivationBatch, AdapterCandidate, DeviceAdapter } from "@iot-os/api-client";
import { Button } from "@iot-os/ui/components/button";
import { DataTable, type DataColumn } from "@iot-os/ui/components/data-table";
import { RelativeTime } from "@iot-os/ui/components/freshness";
import { Status } from "@iot-os/ui/components/status-mark";
import { PowerIcon } from "lucide-react";
import { toast } from "sonner";
import { RequestError } from "../../components/forms";
import { api } from "../../lib/api";

/** Batches activate at most this many sources (spec 038, research R14). */
const BATCH = 200;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The equipment of an OPC UA data source (spec 038 US4): each one waits here once
 * collecting starts, with its latest values and their quality, and any number of them are
 * activated together, as one batch and one redeployment.
 */
export function OpcuaDevices({ org, adapter, canActivate }: { org: string; adapter: DeviceAdapter; canActivate: boolean }) {
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["adapter-candidates", org, adapter.uuid],
    queryFn: () => api.adapterCandidates(org, adapter.uuid),
    refetchInterval: 5000,
  });
  const [selection, setSelection] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const running = adapter.status === "running";
  const waiting = (c: AdapterCandidate) => !c.device && !c.in_use_in && !c.preview.retained;

  async function activate(rows: AdapterCandidate[], clear: () => void) {
    setBusy(true);
    setError(null);
    try {
      const results: AdapterActivationBatch["results"] = [];
      for (let i = 0; i < rows.length; i += BATCH) {
        let batch = await api.activateAdapterCandidates(org, adapter.uuid, rows.slice(i, i + BATCH).map((c) => ({ candidate_uuid: c.uuid })));
        while (batch.status === "queued" || batch.status === "running") {
          await wait(1000);
          batch = await api.adapterActivationBatch(org, adapter.uuid, batch.uuid);
        }
        results.push(...batch.results);
      }
      const done = results.filter((r) => r.outcome !== "failed").length;
      const failed = results.filter((r) => r.outcome === "failed");
      if (failed.length) toast.error(`${done} of ${rows.length} activated. ${failed[0].message ?? "Some could not be activated."}`);
      else toast.success(done === 1 ? "1 device activated." : `${done} devices activated.`);
      clear();
      await Promise.all(
        [["adapter-candidates", org, adapter.uuid], ["adapter", org, adapter.uuid], ["discovery-directory", org], ["devices", org]].map((queryKey) => cache.invalidateQueries({ queryKey })),
      );
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }

  const columns: DataColumn<AdapterCandidate>[] = [
    {
      id: "name",
      header: "Equipment",
      cell: (c) => (
        <span className="flex flex-col">
          <span className="font-medium">{c.name ?? c.source_device_id}</span>
          <span className="text-meta text-muted-foreground">{c.source_device_id.split("/").slice(0, -1).join(" / ")}</span>
        </span>
      ),
      value: (c) => c.name ?? c.source_device_id,
      sortable: true,
      searchable: true,
      mobile: "title",
    },
    {
      id: "values",
      header: "Values in the last report",
      cell: (c) => (
        <span className="flex flex-col gap-0.5">
          {c.preview.metrics?.map((m) => (
            <span key={m.name} className="flex flex-wrap items-center gap-1.5 text-meta">
              <span className="text-muted-foreground">{m.name}</span>
              <span className="tabular-nums">{m.quality === "bad" || m.value === null ? "Unknown" : `${String(m.value)}${m.unit ? ` ${m.unit}` : ""}`}</span>
              {m.quality && m.quality !== "good" && <Status value={m.quality} domain="opcua_quality" title={m.reason ?? undefined} />}
            </span>
          ))}
        </span>
      ),
      mobile: "meta",
    },
    {
      id: "seen",
      header: "Last report",
      cell: (c) => <RelativeTime at={c.last_seen_at} />,
      value: (c) => c.last_seen_at,
      sortable: true,
      mobile: "meta",
    },
    {
      id: "device",
      header: "Device",
      cell: (c) =>
        c.in_use_in ? (
          <span className="text-muted-foreground">In use in {c.in_use_in.organization_name}</span>
        ) : c.device ? (
          <Link className="underline" to={`/organizations/${org}/devices/${c.device.uuid}/overview`}>
            {c.device.name}
          </Link>
        ) : (
          <Status value="waiting" domain="checklist" />
        ),
      value: (c) => (c.device ? "activated" : "waiting"),
      mobile: "badge",
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <RequestError error={error ?? query.error} />
      <DataTable
        id="opcua-sources"
        label="Equipment"
        noun={["equipment", "equipment"]}
        rows={query.data}
        rowKey={(c) => c.uuid}
        rowLabel={(c) => c.name ?? c.source_device_id}
        columns={columns}
        selectable={canActivate && running}
        canSelect={waiting}
        selection={{ value: selection, onChange: setSelection }}
        bulkActions={({ rows, clear }) => {
          const ready = rows.filter(waiting);
          return (
            <Button size="sm" disabled={busy || !ready.length} onClick={() => void activate(ready, clear)}>
              <PowerIcon />
              {busy ? "Activating…" : `Activate ${ready.length}`}
            </Button>
          );
        }}
        refreshSeconds={5}
        empty={
          running
            ? "No equipment has reported yet. Each equipment of the point map appears here once the server is read."
            : "Deploy the data source to start collecting. Each equipment of the point map then waits here to be activated."
        }
      />
    </div>
  );
}
