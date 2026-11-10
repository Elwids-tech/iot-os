import { useMemo, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import type { Device, DiscoveryCandidate, Gateway } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@iot-os/ui/components/tabs"
import { statusOf } from "@iot-os/ui/lib/status"
import { EntityPage, PropertyList } from "@iot-os/ui/templates/entity-page"
import { CpuIcon, EllipsisIcon, RouterIcon, ScanSearchIcon } from "lucide-react"
import { api } from "../lib/api"
import { Confirm, RequestError } from "../components/forms"
import { TechnicalDetails } from "./GatewaysPage"
import { GatewayFirmwareDialog } from "./GatewayFirmwareDialog"
import { sourceLabel } from "./OnboardSource"
import {
  devicePath,
  discoveryPath,
  everyPage,
  gatewayDevicesQuery,
  gatewayPath,
  metricCount,
  useDeviceOrganization,
} from "./shared"

/** One table per tab; Devices is the default and leaves the address without `?tab`. */
const tabs = { devices: "Devices", sources: "Sources" } as const
type GatewayTab = keyof typeof tabs

/** One gateway: its presence, the devices behind it and the sources it announces. */
export function GatewayPage() {
  const { org, capabilities } = useDeviceOrganization()
  const { gatewayUuid = "" } = useParams()
  const [params, setParams] = useSearchParams()
  const tab: GatewayTab = params.get("tab") === "sources" ? "sources" : "devices"
  const [firmware, setFirmware] = useState(false)
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
  const devices = useQuery({
    ...gatewayDevicesQuery(org, gatewayUuid),
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
  const gatewayDevices = devices.data
  const back = { to: gatewayPath(org), label: "Gateways" }

  function show(next: GatewayTab) {
    const values = new URLSearchParams(params)
    if (next === "devices") values.delete("tab")
    else values.set("tab", next)
    setParams(values, { replace: true })
  }

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
    <Tabs value={tab} onValueChange={(value) => show(value as GatewayTab)} className="gap-0">
      <EntityPage
        title={gateway.name}
        icon={<RouterIcon />}
        code={gateway.edge_node_id}
        back={back}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setFirmware(true)}>
              <CpuIcon data-icon="inline-start" />
              Firmware
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
        tabs={
          <TabsList variant="line" className="justify-start px-1" aria-label="Gateway sections">
            {(Object.keys(tabs) as GatewayTab[]).map((value) => (
              <TabsTrigger key={value} value={value} className="flex-none">
                {tabs[value]}
              </TabsTrigger>
            ))}
          </TabsList>
        }
        notices={
          gateway.offline_alert ? (
            <Alert>
              <AlertTitle>Gateway offline</AlertTitle>
              <AlertDescription>
                <p>
                  {gateway.offline_alert.cause
                    ? `${statusOf(gateway.offline_alert.cause, "offline_cause").label}. `
                    : ""}
                  Its devices are offline with it; they open no alerts of their own until it is back.
                  {gateway.offline_alert.since && (
                    <>
                      {" "}Offline since <RelativeTime at={gateway.offline_alert.since} />.
                    </>
                  )}
                </p>
                <Link
                  className="underline underline-offset-4"
                  to={`/organizations/${encodeURIComponent(org)}/alerts/${encodeURIComponent(gateway.offline_alert.uuid)}`}
                >
                  Open the alert
                </Link>
              </AlertDescription>
            </Alert>
          ) : undefined
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
        <TabsContent value="devices">
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
        </TabsContent>
        <TabsContent value="sources">
          <DataTable
            id="gateway-sources"
            label="Sources from this gateway"
            noun={["source", "sources"]}
            rows={sources.data?.data}
            rowKey={(c) => c.uuid}
            columns={sourceColumns}
            toolbar={
              <Button asChild variant="outline" size="sm">
                <Link to={discoveryPath(org, gateway.uuid)}>
                  <ScanSearchIcon data-icon="inline-start" />
                  Open in discovery
                </Link>
              </Button>
            }
            error={sources.error ? <RequestError error={sources.error} /> : undefined}
            empty={<EmptyState inset title="No sources announced yet" />}
          />
        </TabsContent>
      </EntityPage>
      {firmware && (
        <GatewayFirmwareDialog
          org={org}
          gateway={gateway}
          devices={devices.isError ? [] : gatewayDevices}
          canManage={capabilities.connections}
          onClose={() => setFirmware(false)}
        />
      )}
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
    </Tabs>
  )
}
