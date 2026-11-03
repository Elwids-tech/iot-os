import { useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import type { BulkOnboardingItem, BulkOnboardingRun as Run } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, RefLink, type DataColumn } from "@iot-os/ui/components/data-table"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import {
  Panel,
  PanelActions,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from "@iot-os/ui/components/panel"
import { Status } from "@iot-os/ui/components/status-mark"
import { statusOf } from "@iot-os/ui/lib/status"
import { RefreshCwIcon, XIcon } from "lucide-react"
import { api } from "../lib/api"
import { LoadError, RequestError } from "../components/forms"
import { devicePath } from "./shared"

const COUNTS = ["pending", "activation_requested", "active", "skipped", "failed"] as const
const finished = (run: Run | undefined) => Boolean(run && !["queued", "running"].includes(run.status))

/**
 * Progress of a bulk onboarding run on the Discovery page. It polls until the run finishes,
 * then more slowly until the runtime has confirmed every requested device. Items read
 * active only once the runtime has confirmed them.
 */
export function BulkOnboardingRun({ org, run, onClose }: { org: string; run: string; onClose: () => void }) {
  const [statuses, setStatuses] = useState<string[]>([]),
    [retrying, setRetrying] = useState(false),
    [error, setError] = useState<unknown>(null)
  const query = useInfiniteQuery({
    queryKey: ["bulk-onboarding", org, run],
    queryFn: ({ pageParam }) => api.bulkOnboarding(org, run, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    refetchInterval: (state) => {
      const current = state.state.data?.pages[0]
      if (!current || !finished(current)) return 2000
      return current.counts.active < current.counts.activation_requested ? 10000 : false
    },
    refetchIntervalInBackground: false,
  })
  const current = query.data?.pages[0]
  const items = query.data?.pages.flatMap((page) => page.items)
  const total = current ? COUNTS.filter((key) => key !== "active").reduce((sum, key) => sum + current.counts[key], 0) : 0
  const retry = async () => {
    setRetrying(true)
    setError(null)
    try {
      await api.retryBulkOnboarding(org, run)
      await query.refetch()
    } catch (reason) {
      setError(reason)
    } finally {
      setRetrying(false)
    }
  }
  const columns: DataColumn<BulkOnboardingItem>[] = [
    {
      id: "source",
      header: "Source",
      mobile: "title",
      value: (item) => item.source_device_id,
      cell: (item) => <span className="font-mono text-code">{item.source_device_id}</span>,
    },
    { id: "status", header: "Outcome", mobile: "badge", value: (item) => item.status, cell: (item) => <Status value={item.status} /> },
    {
      id: "reason",
      header: "Reason",
      value: (item) => item.reason,
      cell: (item) => (item.reason ? item.reason : <span className="text-muted-foreground">None</span>),
    },
    {
      id: "device",
      header: "Device",
      value: (item) => item.device_uuid,
      cell: (item) =>
        item.device_uuid ? (
          <RefLink to={devicePath(org, item.device_uuid)}>View device</RefLink>
        ) : (
          <span className="text-muted-foreground">None</span>
        ),
    },
  ]
  return (
    <section aria-label="Bulk onboarding run" className="flex flex-col gap-3">
      <Panel>
        <PanelHeader>
          <PanelTitle>Bulk onboarding</PanelTitle>
          {current && <Status value={current.status} />}
          {current && (
            <PanelDescription>
              {current.profile.name ?? "Profile"} · version {current.profile.revision} · {total.toLocaleString()} sources ·
              started <RelativeTime at={current.started_at ?? current.created_at} />
              {current.finished_at && (
                <>
                  {" "}· finished <RelativeTime at={current.finished_at} />
                </>
              )}
            </PanelDescription>
          )}
          <PanelActions>
            {finished(current) && current!.counts.failed > 0 && (
              <Button size="sm" variant="outline" disabled={retrying} onClick={() => void retry()}>
                <RefreshCwIcon data-icon="inline-start" />
                {retrying ? "Retrying…" : `Retry ${current!.counts.failed.toLocaleString()} failed`}
              </Button>
            )}
            <Button size="icon-sm" variant="ghost" aria-label="Close bulk onboarding" onClick={onClose}>
              <XIcon />
            </Button>
          </PanelActions>
        </PanelHeader>
        <PanelContent className="flex flex-col gap-3">
          <LoadError error={query.error} what="the bulk onboarding" onRetry={() => query.refetch()} busy={query.isFetching} />
          <RequestError error={error} />
          {current && (
            <dl aria-label="Bulk onboarding counts" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {COUNTS.map((key) => (
                <div key={key} className="flex flex-col gap-1">
                  <dt>
                    <Status value={key} />
                  </dt>
                  <dd className="text-title tabular-nums">{current.counts[key].toLocaleString()}</dd>
                </div>
              ))}
            </dl>
          )}
          {current && !finished(current) && (
            <p className="text-meta text-muted-foreground">
              {(total - current.counts.pending).toLocaleString()} of {total.toLocaleString()} processed. You can leave this page; the run continues.
            </p>
          )}
        </PanelContent>
      </Panel>
      <DataTable
        id="bulk-onboarding-items"
        label="Bulk onboarding sources"
        noun={["source", "sources"]}
        rows={items}
        rowKey={(item) => item.source_device_id}
        rowLabel={(item) => item.source_device_id}
        columns={columns}
        bounded
        filters={[
          {
            id: "status",
            label: "Outcome",
            multiple: true,
            options: COUNTS.map((value) => ({ value, label: statusOf(value).label })),
            value: statuses,
            onChange: setStatuses,
            match: (item, value) => value.includes(item.status),
          },
        ]}
        loadMore={{
          hasMore: Boolean(query.hasNextPage),
          loading: query.isFetchingNextPage,
          onLoadMore: () => void query.fetchNextPage(),
          label: "Load more sources",
        }}
      />
    </section>
  )
}
