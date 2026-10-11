import { Status } from "@iot-os/ui/components/status-mark"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import type { DiscoveryCandidate } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, RefLink, type DataColumn } from "@iot-os/ui/components/data-table"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { useUrlState } from "@iot-os/ui/hooks/use-url-state"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { InboxIcon } from "lucide-react"
import { api } from "../lib/api"
import { RequestError, Confirm } from "../components/forms"
import { devicePath, gatewayPath, useDeviceOrganization } from "./shared"
import { OnboardSource, sourceLabel } from "./OnboardSource"

export function DiscoveryPage() {
  const { org, capabilities } = useDeviceOrganization()
  const url = useUrlState()
  const [selected, setSelected] = useState<DiscoveryCandidate | null>(null)
  const [review, setReview] = useState<DiscoveryCandidate | null>(null)
  const search = url.get("search"),
    gateway = url.get("gateway"),
    page = Number(url.get("page") || 1)
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
  const gateways = useQuery({
    queryKey: ["gateways", org, "filter-options"],
    queryFn: () => api.gatewaysPage(org, { per_page: 100 }),
  })
  const gatewayOptions = (gateways.data?.data ?? []).map((g) => ({ value: g.uuid, label: g.name }))
  // A gateway linked from elsewhere may not be on the first page of options; name it from the rows.
  if (gateway && !gatewayOptions.some((o) => o.value === gateway))
    gatewayOptions.push({ value: gateway, label: query.data?.data[0]?.gateway.name ?? "Selected gateway" })
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
      value: (c) => c.gateway.name,
      cell: (c) => <RefLink to={gatewayPath(org, c.gateway.uuid)}>{c.gateway.name}</RefLink>,
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
                Onboard
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
            { id: "gateway", label: "Gateway", value: (c) => c.gateway.name },
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
