import { Status } from "@iot-os/ui/components/status-mark"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { useEffect, useRef, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import type { DiscoveryCandidate } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, RefLink, type DataColumn } from "@iot-os/ui/components/data-table"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { useUrlState } from "@iot-os/ui/hooks/use-url-state"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { InboxIcon } from "lucide-react"
import { api } from "../lib/api"
import { RequestError, Confirm, errorMessage } from "../components/forms"
import { devicePath, gatewayPath, useDeviceOrganization, via } from "./shared"
import { OnboardSource, sourceLabel } from "./OnboardSource"
import { BULK_LIMIT, BulkOnboardingDialog } from "./BulkOnboardingDialog"
import { BulkOnboardingRun } from "./BulkOnboardingRun"

/**
 * A source bulk onboarding can take: a device behind the gateway that no device holds or
 * is being set up for, not ignored, and not reported through an adapter. The gateway's own
 * source is onboarded on its own.
 */
export const bulkSelectable = (c: DiscoveryCandidate) =>
  Boolean(c.source_device_id) && !c.assigned_device_uuid && !c.setup_device_uuid && c.status !== "rejected" && !c.adapter

export function DiscoveryPage() {
  const { org, capabilities } = useDeviceOrganization()
  const url = useUrlState()
  const [selected, setSelected] = useState<DiscoveryCandidate | null>(null)
  const [review, setReview] = useState<DiscoveryCandidate | null>(null)
  const search = url.get("search"),
    gateway = url.get("gateway"),
    run = url.get("run"),
    page = Number(url.get("page") || 1)
  const [selection, setSelection] = useState<string[]>([]),
    [allSelected, setAllSelected] = useState(false),
    [selectingAll, setSelectingAll] = useState(false),
    [onboarding, setOnboarding] = useState<DiscoveryCandidate[] | null>(null)
  // Every source loaded so far, so a selection that spans pages keeps each source's metrics.
  const seen = useRef(new Map<string, DiscoveryCandidate>())
  const query = useQuery({
    queryKey: ["discovery-directory", org, search, page, gateway],
    queryFn: () =>
      api.discoveryPage(org, {
        search,
        page,
        gateway_uuid: gateway || undefined,
        per_page: 25,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  useEffect(() => {
    for (const c of query.data?.data ?? []) seen.current.set(c.uuid, c)
  }, [query.data])
  useEffect(() => {
    setSelection([])
    setAllSelected(false)
  }, [gateway])
  useEffect(() => setAllSelected(false), [search])
  const matching = query.data?.meta.total ?? 0
  // Loads every source matching the gateway filter and search, 100 at a time (the API's maximum).
  const selectAll = async () => {
    setSelectingAll(true)
    try {
      const rows: DiscoveryCandidate[] = []
      for (let next = 1, last = 1; next <= last; next++) {
        const result = await api.discoveryPage(org, { search, gateway_uuid: gateway || undefined, page: next, per_page: 100 })
        rows.push(...result.data)
        last = result.meta.last_page
      }
      for (const c of rows) seen.current.set(c.uuid, c)
      const eligible = rows.filter(bulkSelectable)
      setSelection(eligible.map((c) => c.uuid))
      setAllSelected(true)
      const left = rows.length - eligible.length
      if (left)
        toast.info(
          `${left.toLocaleString()} matching ${left === 1 ? "source was" : "sources were"} left out: already onboarded, ignored, or the gateway’s own.`,
        )
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSelectingAll(false)
    }
  }
  const gateways = useQuery({
    queryKey: ["gateways", org, "filter-options"],
    queryFn: () => api.gatewaysPage(org, { per_page: 100 }),
  })
  const gatewayOptions = (gateways.data?.data ?? []).map((g) => ({ value: g.uuid, label: via(org, g).label }))
  // A gateway linked from elsewhere may not be on the first page of options; name it from the rows.
  const chosen = gateways.data?.data.find((g) => g.uuid === gateway) ?? query.data?.data[0]?.gateway
  if (gateway && !gatewayOptions.some((o) => o.value === gateway))
    gatewayOptions.push({ value: gateway, label: chosen ? via(org, chosen).label : "Selected gateway" })
  // Bulk onboarding works on one gateway's sources, for people who may add and activate devices.
  // An adapter's sources are activated through the adapter instead.
  const bulk = Boolean(gateway) && !chosen?.adapter && capabilities.manage && capabilities.activate
  const columns: DataColumn<DiscoveryCandidate>[] = [
    {
      id: "source",
      header: "Source",
      mobile: "title",
      value: (c) => sourceLabel(c),
      cell: (c) => <span className={c.source_device_id ? "font-mono text-code" : "font-medium"}>{sourceLabel(c)}</span>,
    },
    {
      id: "gateway",
      header: "Gateway",
      value: (c) => via(org, c.gateway).label,
      cell: (c) => <RefLink to={via(org, c.gateway).to}>{via(org, c.gateway).label}</RefLink>,
    },
    { id: "state", header: "State", mobile: "badge", value: (c) => c.status, cell: (c) => <Status value={c.status} /> },
    { id: "metrics", header: "Metrics", align: "end", value: (c) => c.metrics.length, cell: (c) => <span className="tabular-nums">{c.metrics.length}</span> },
    {
      id: "device",
      header: "Device",
      value: (c) => (c.assigned_device_uuid ? "Onboarded" : c.setup_device_uuid ? "In setup" : "Not onboarded"),
      cell: (c) =>
        c.assigned_device_uuid ? (
          <RefLink to={devicePath(org, c.assigned_device_uuid)}>View device</RefLink>
        ) : c.setup_device_uuid ? (
          <div className="flex flex-wrap items-center gap-2">
            <RefLink to={`${devicePath(org)}/onboard/${encodeURIComponent(c.setup_device_uuid)}?step=3`}>
              Resume setup
            </RefLink>
            {c.status === "rejected" && capabilities.manage && (
              <Button size="xs" variant="ghost" onClick={() => setReview(c)}>
                Restore
              </Button>
            )}
          </div>
        ) : capabilities.manage ? (
          <div className="relative z-10 flex gap-2">
            {c.status !== "rejected" && (
              <Button size="xs" onClick={() => setSelected(c)}>
                {c.adapter ? "Activate" : "Onboard"}
              </Button>
            )}
            <Button size="xs" variant="ghost" onClick={() => setReview(c)}>
              {c.status === "rejected" ? "Restore" : "Ignore"}
            </Button>
          </div>
        ) : (
          <span className="text-muted-foreground">Not onboarded</span>
        ),
    },
    { id: "last-seen", header: "Last seen", align: "end", value: (c) => c.last_seen_at, cell: (c) => <RelativeTime at={c.last_seen_at} /> },
  ]
  return (
    <>
      <CollectionPage
        title="Discovery"
        description="Sources that gateways announce, waiting to become devices."
        notices={run && <BulkOnboardingRun key={run} org={org} run={run} onClose={() => url.set({ run: null })} />}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to={gatewayPath(org)}>Gateways</Link>
          </Button>
        }
      >
        <DataTable
          id="discovery"
          label="Discovered sources"
          noun={["source", "sources"]}
          rows={query.data?.data}
          rowKey={(c) => c.uuid}
          rowLabel={(c) => sourceLabel(c)}
          columns={columns}
          error={query.error ? <RequestError error={query.error} /> : undefined}
          search={{
            label: "Search discovered sources",
            placeholder: "Search source or gateway",
            value: search,
            onChange: (value) => url.set({ search: value }),
          }}
          filters={[
            {
              id: "gateway",
              label: "Gateway",
              options: gatewayOptions,
              value: gateway ? [gateway] : [],
              onChange: (value) => url.set({ gateway: value[0] ?? null }),
            },
          ]}
          filtered={Boolean(search || gateway)}
          onReset={() => url.clear(["search", "gateway"])}
          groups={[
            { id: "gateway", label: "Gateway", value: (c) => via(org, c.gateway).label },
            { id: "state", label: "State", value: (c) => c.status },
          ]}
          pagination={{
            page,
            pageSize: 25,
            total: query.data?.meta.total ?? 0,
            pageCount: query.data?.meta.last_page,
            onPageChange: (next) => url.set({ page: next > 1 ? String(next) : null }),
          }}
          refreshSeconds={5}
          selectable={bulk}
          canSelect={bulkSelectable}
          selection={
            bulk
              ? {
                  value: selection,
                  onChange: (ids) => {
                    setSelection(ids)
                    setAllSelected(false)
                  },
                }
              : undefined
          }
          selectAll={
            bulk && !allSelected
              ? {
                  count: matching,
                  loading: selectingAll,
                  onSelect: () => void selectAll(),
                  note:
                    matching > BULK_LIMIT ? (
                      <span className="text-meta text-muted-foreground">
                        More than {BULK_LIMIT} match. Search to narrow them, then onboard them in parts.
                      </span>
                    ) : undefined,
                }
              : undefined
          }
          bulkActions={({ ids }) => (
            <>
              {ids.length > BULK_LIMIT && (
                <span className="text-meta text-warning">Onboard at most {BULK_LIMIT} at a time. Split the selection.</span>
              )}
              <Button
                size="sm"
                disabled={ids.length > BULK_LIMIT}
                onClick={() =>
                  setOnboarding(ids.flatMap((id) => (seen.current.get(id) ? [seen.current.get(id)!] : [])))
                }
              >
                Onboard selected
              </Button>
            </>
          )}
          note={
            !gateway && capabilities.manage && capabilities.activate
              ? "Filter by a gateway to select its sources and onboard them together."
              : undefined
          }
          empty={
            <EmptyState
              inset
              icon={<InboxIcon />}
              title="No sources discovered yet"
              description="Sources appear here when a registered gateway connects and announces them."
            />
          }
        />
      </CollectionPage>
      {onboarding && onboarding.length > 0 && (
        <BulkOnboardingDialog
          org={org}
          gateway={onboarding[0].gateway}
          sources={onboarding}
          onClose={() => setOnboarding(null)}
          onStarted={(started) => {
            setOnboarding(null)
            setSelection([])
            setAllSelected(false)
            url.set({ run: started.uuid })
          }}
        />
      )}
      {selected && (
        <OnboardSource
          key={selected.uuid}
          org={org}
          source={selected}
          onClose={() => setSelected(null)}
        />
      )}
      <Confirm
        open={Boolean(review)}
        title={
          review?.status === "rejected"
            ? "Restore this source?"
            : "Ignore this source?"
        }
        description="This changes the review status only. It does not change the gateway or send a device command."
        action={review?.status === "rejected" ? "Restore" : "Ignore"}
        destructive={false}
        onClose={() => setReview(null)}
        onConfirm={async () => {
          if (review)
            await api.reviewCandidate(
              org,
              review.uuid,
              review.status === "rejected" ? "pending" : "rejected",
              review.birth_revision,
            )
          await query.refetch()
        }}
      />
    </>
  )
}
