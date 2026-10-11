import { useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import type { Device, DiscoveryCandidate, Gateway } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, RowLink, type DataColumn } from "@iot-os/ui/components/data-table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@iot-os/ui/components/dropdown-menu"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { Freshness, RelativeTime } from "@iot-os/ui/components/freshness"
import { Panel, PanelContent, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { Status } from "@iot-os/ui/components/status-mark"
import { EntityPage, PropertyList } from "@iot-os/ui/templates/entity-page"
import { EllipsisIcon, KeyRoundIcon, RouterIcon } from "lucide-react"
import { api } from "../lib/api"
import { Confirm, RequestError } from "../components/forms"
import { GatewayCredentials, TechnicalDetails } from "./GatewaysPage"
import { sourceLabel } from "./OnboardSource"
import { devicePath, discoveryPath, gatewayPath, metricCount, useDeviceOrganization } from "./shared"

/** Every page of a paged list, for pages that look one record up by id. */
async function everyPage<T>(load: (page: number) => Promise<{ data: T[]; meta: { last_page: number } }>) {
  const all: T[] = []
  for (let page = 1, last = 1; page <= last; page++) {
    const result = await load(page)
    all.push(...result.data)
    last = result.meta.last_page
  }
  return all
}

/** One gateway: its presence, the devices behind it and the sources it announces. */
export function GatewayPage() {
  const { org, capabilities } = useDeviceOrganization()
  const { gatewayUuid = "" } = useParams()
  const [credentials, setCredentials] = useState(false)
  const [provisioning, setProvisioning] = useState(false)
  const gateways = useQuery({
    queryKey: ["gateways", org, "all"],
    queryFn: () => everyPage((page) => api.gatewaysPage(org, { page, per_page: 100 })),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  const connections = useQuery({
    queryKey: ["connections", org, "all"],
    queryFn: () => everyPage((page) => api.connectionsPage(org, { page, per_page: 100 })),
  })
  // Devices carry their source's gateway, so the gateway's devices come from the device list.
  const devices = useQuery({
    queryKey: ["devices", org, "all"],
    queryFn: () => everyPage((page) => api.devices(org, { page, per_page: 100 })),
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  })
  const sources = useQuery({
    queryKey: ["discovery-directory", org, "gateway", gatewayUuid],
    queryFn: () => api.discoveryPage(org, { gateway_uuid: gatewayUuid, per_page: 100 }),
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  })
  const gateway: Gateway | undefined =
    gateways.data?.find((g) => g.uuid === gatewayUuid) ?? sources.data?.data[0]?.gateway
  const connection = connections.data?.find((c) => c.uuid === gateway?.connection_uuid)
  const gatewayDevices = useMemo(
    () => devices.data?.filter((d) => d.candidate?.gateway.uuid === gatewayUuid),
    [devices.data, gatewayUuid],
  )
  const back = { to: gatewayPath(org), label: "Gateways" }

  const deviceColumns = useMemo<DataColumn<Device>[]>(
    () => [
      {
        id: "device",
        header: "Device",
        mobile: "title",
        sortable: true,
        value: (d) => d.name,
        cell: (d) => <RowLink to={devicePath(org, d.uuid)}>{d.name}</RowLink>,
      },
      { id: "lifecycle", header: "Lifecycle", mobile: "badge", value: (d) => d.lifecycle, cell: (d) => <Status value={d.lifecycle} /> },
      { id: "presence", header: "Presence", value: (d) => d.presence, cell: (d) => <Status value={d.presence} /> },
      { id: "last-seen", header: "Last seen", sortable: true, value: (d) => d.last_seen_at, cell: (d) => <Freshness at={d.last_seen_at} /> },
    ],
    [org],
  )
  const sourceColumns = useMemo<DataColumn<DiscoveryCandidate>[]>(
    () => [
      {
        id: "source",
        header: "Source",
        mobile: "title",
        value: (c) => sourceLabel(c),
        cell: (c) => <span className={c.source_device_id ? "font-mono text-code" : undefined}>{sourceLabel(c)}</span>,
      },
      { id: "state", header: "State", mobile: "badge", value: (c) => c.status, cell: (c) => <Status value={c.status} /> },
      { id: "metrics", header: "Metrics", align: "end", value: (c) => c.metrics.length, cell: (c) => <span className="tabular-nums">{metricCount(c.metrics.length)}</span> },
    ],
    [],
  )

  if (!gateway)
    return (
      <EntityPage title="Gateway" icon={<RouterIcon />} back={back}>
        {gateways.isPending || sources.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <RequestError error={gateways.error ?? sources.error} />
            <EmptyState
              icon={<RouterIcon />}
              title="Gateway not found"
              description="It may have been removed, or it belongs to another organization."
              action={
                <Button variant="outline" size="sm" asChild>
                  <Link to={back.to}>Back to gateways</Link>
                </Button>
              }
            />
          </>
        )}
      </EntityPage>
    )

  return (
    <EntityPage
      title={gateway.name}
      icon={<RouterIcon />}
      code={gateway.edge_node_id}
      back={back}
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => setCredentials(true)}>
            <KeyRoundIcon data-icon="inline-start" />
            Get credentials
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label="Gateway actions">
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {capabilities.connections && (
                <DropdownMenuItem onSelect={() => setProvisioning(true)}>Apply gateway access</DropdownMenuItem>
              )}
              <DropdownMenuItem asChild>
                <Link to={discoveryPath(org, gateway.uuid)}>Open in discovery</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
      status={
        <>
          <Status value={gateway.presence} />
          <span className="text-muted-foreground">
            Last seen <RelativeTime at={gateway.last_seen_at} never="never" />
          </span>
        </>
      }
      rail={
        <Panel>
          <PanelHeader>
            <PanelTitle>Properties</PanelTitle>
          </PanelHeader>
          <PanelContent className="flex flex-col gap-2">
            <PropertyList
              items={[
                { label: "Connection", value: connection?.name ?? <span className="text-muted-foreground">Unknown</span> },
                { label: "Sources", value: gateway.sources_count === 1 ? "1 source" : `${gateway.sources_count} sources` },
                { label: "Devices", value: gatewayDevices ? gatewayDevices.length : "…" },
              ]}
            />
            <TechnicalDetails
              key={gateway.uuid}
              rows={[
                { label: "Edge node ID", value: gateway.edge_node_id },
                { label: "Group ID", value: gateway.group_id },
                { label: "Gateway ID", value: gateway.uuid },
              ]}
            />
          </PanelContent>
        </Panel>
      }
    >
      <section aria-labelledby="gateway-devices" className="flex flex-col gap-3">
        <h2 id="gateway-devices" className="skin-label text-heading">Devices</h2>
        <DataTable
          id="gateway-devices"
          label="Devices on this gateway"
          noun={["device", "devices"]}
          rows={gatewayDevices}
          rowKey={(d) => d.uuid}
          rowHref={(d) => devicePath(org, d.uuid)}
          columns={deviceColumns}
          error={devices.error ? <RequestError error={devices.error} /> : undefined}
          empty={<EmptyState inset title="No devices use this gateway" description="Devices appear here once a source from this gateway is assigned to them." />}
        />
      </section>
      <section aria-labelledby="gateway-sources" className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h2 id="gateway-sources" className="skin-label text-heading">Sources</h2>
          <Button asChild variant="link" size="sm" className="ml-auto h-auto p-0">
            <Link to={discoveryPath(org, gateway.uuid)}>Open in discovery</Link>
          </Button>
        </div>
        <DataTable
          id="gateway-sources"
          label="Sources from this gateway"
          noun={["source", "sources"]}
          rows={sources.data?.data}
          rowKey={(c) => c.uuid}
          columns={sourceColumns}
          error={sources.error ? <RequestError error={sources.error} /> : undefined}
          empty={<EmptyState inset title="No sources announced yet" />}
        />
      </section>
      {credentials && <GatewayCredentials gateway={gateway} onClose={() => setCredentials(false)} />}
      <Confirm
        open={provisioning}
        title={`Apply access for ${gateway.name}?`}
        description="Writes the gateway's broker user and topic rules. The gateway keeps its credentials; this does not connect it."
        action="Apply access"
        destructive={false}
        onClose={() => setProvisioning(false)}
        onConfirm={async () => {
          await api.provisionGateway(org, gateway.uuid)
          await gateways.refetch()
        }}
      />
    </EntityPage>
  )
}
